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
  await client.auth.admin.deleteUser(userId);
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

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created?.user) {
      const status = (createError as { status?: number })?.status;
      if (status === 422) {
        return NextResponse.json(
          { error: 'A user with this email already exists.' },
          { status: 409 }
        );
      }
      console.error('create-user: createUser failed', createError);
      throw createError || new Error('Could not create auth user.');
    }

    const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
      {
        id: created.user.id,
        full_name: fullName,
        role,
        is_active: true,
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      await rollbackAuthUser(supabaseAdmin, created.user.id);
      console.error('create-user: profile upsert failed', profileError);
      throw profileError;
    }

    await supabaseAdmin.from('audit_entries').insert({
      actor_user_id: callerUser.id,
      action: 'user.created',
      entity_type: 'profile',
      entity_id: created.user.id,
      after_value: { full_name: fullName, email, role },
    });

    return NextResponse.json({ success: true, userId: created.user.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not create user: unknown error';
    console.error('create-user: unexpected error', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
