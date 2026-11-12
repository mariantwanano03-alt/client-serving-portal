import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const ALLOWED_ROLES = new Set(['junior_developer', 'senior_dev_pm', 'administrator']);

type CreateUserBody = {
  full_name?: string;
  email?: string;
  password?: string;
  role?: string;
};

async function rollbackAuthUser(client: typeof supabaseAdmin, userId: string) {
  await client.auth.admin.deleteUser(userId).catch(() => {
    // Ignore rollback errors
  });
}

function extractUser(res: any): { id: string } | null {
  if (!res) return null;
  if (res.data?.user) return res.data.user;
  if (res.user) return res.user;
  return null;
}

function getErrorStatus(err: any): number | undefined {
  if (!err) return undefined;
  if (err.status) return err.status;
  if (err.statusCode) return err.statusCode;
  if (err.code === '23505') return 422;
  if (err.message && err.message.includes('already exists')) return 422;
  if (err.message && err.message.includes('duplicate')) return 422;
  return undefined;
}

export async function POST(req: Request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server is not configured for account creation (missing SUPABASE_SERVICE_ROLE_KEY).' },
        { status: 500 }
      );
    }

    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    );
    if (callerError || !callerData?.user) {
      console.error('create-user: caller auth failed', callerError);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const callerUser = callerData.user;

    const callerProfile = await supabaseAdmin
      .from('profiles')
      .select('role, is_active')
      .eq('id', callerUser.id)
      .single();
    if (!callerProfile.data || callerProfile.data.role !== 'administrator') {
      return NextResponse.json(
        { error: 'Only an active Administrator can create users.' },
        { status: 403 }
      );
    }

    const body = (await req.json()) as CreateUserBody;
    console.log('create-user: request body', body);

    const fullName = body.full_name?.trim() ?? '';
    const email = body.email?.trim().toLowerCase() ?? '';
    const password = body.password ?? '';
    const role = body.role ?? '';

    if (!fullName || !email) {
      return NextResponse.json({ error: 'Full name and email are required.' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters.' },
        { status: 400 }
      );
    }
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Unknown role selected.' }, { status: 400 });
    }

    let authUser: { id: string } | null = null;

    // Attempt 1: create the auth user
    let createError: any = null;
    let createdData: any = null;
    try {
      const res: any = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      createdData = res.data;
      createError = res.error;
    } catch (err: any) {
      createError = err;
    }

    console.log('create-user: first create attempt', { error: createError?.message, status: createError?.status });

    if (createError) {
      const status = getErrorStatus(createError);

      if (status === 422) {
        // Email already exists in auth. Find the profile with this email,
        // delete that specific auth account, then retry once.
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name, is_active')
          .eq('email', email)
          .single();

        if (existingProfile) {
          console.log('create-user: deleting existing auth account for', email, existingProfile.id);
          await supabaseAdmin.auth.admin.deleteUser(existingProfile.id).catch((delErr) => {
            console.warn('create-user: could not delete existing auth account', delErr.message);
          });
        }

        // Retry creation once
        let retryData: any = null;
        let retryError: any = null;
        try {
          const res: any = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName },
          });
          retryData = res.data;
          retryError = res.error;
        } catch (err: any) {
          retryError = err;
        }

        console.log('create-user: retry attempt', { error: retryError?.message, status: retryError?.status });

        if (retryError || !extractUser({ data: retryData, error: retryError })) {
          return NextResponse.json(
            { error: retryError?.message || 'Could not create user after cleanup.' },
            { status: 500 }
          );
        }
        authUser = extractUser({ data: retryData, error: retryError });
      } else {
        console.error('create-user: createUser failed', createError);
        throw createError || new Error('Could not create auth user.');
      }
    } else {
      authUser = extractUser({ data: createdData, error: null });
    }

    if (!authUser) {
      return NextResponse.json({ error: 'Could not create auth user.' }, { status: 500 });
    }

    // Create/update the profile row
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
      {
        id: authUser.id,
        full_name: fullName,
        email,
        role,
        is_active: true,
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      await rollbackAuthUser(supabaseAdmin, authUser.id);
      console.error('create-user: profile upsert failed', profileError);
      throw profileError;
    }

    await supabaseAdmin.from('audit_entries').insert({
      actor_user_id: callerUser.id,
      action: 'user.created',
      entity_type: 'profile',
      entity_id: authUser.id,
      after_value: { full_name: fullName, email, role },
    });

    return NextResponse.json({ success: true, userId: authUser.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not create user: unknown error';
    console.error('create-user: unexpected error', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
