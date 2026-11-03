import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin, getCallerProfile } from '@/lib/supabase-server';

const ALLOWED_ROLES = new Set(['junior_developer', 'senior_dev_pm', 'administrator']);

type CreateUserBody = {
  full_name?: string;
  email?: string;
  password?: string;
  role?: string;
};

// Remove the auth user if the profile row could not be created, so we don't
// leave an auth account without a profile that can never sign in.
async function rollbackAuthUser(client: SupabaseClient, userId: string) {
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

    const caller = await getCallerProfile(req.headers.get('authorization'));
    if (!caller) {
      return NextResponse.json({ error: 'You must be signed in to create users.' }, { status: 401 });
    }
    if (caller.role !== 'administrator' || caller.is_active === false) {
      return NextResponse.json(
        { error: 'Only an active Administrator can create users.' },
        { status: 403 }
      );
    }

    const body = (await req.json()) as CreateUserBody;
    const fullName = body.full_name?.trim() ?? '';
    const email = body.email?.trim().toLowerCase() ?? '';
    const password = body.password ?? '';
    const role = body.role ?? '';

    if (!fullName || !email) {
      return NextResponse.json({ error: 'Full name and email are required.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters.' },
        { status: 400 }
      );
    }
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Unknown role selected.' }, { status: 400 });
    }

    // 1. Create the auth account. email_confirm so the user can sign in
    //    immediately with the temporary password (no confirmation email).
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
      throw createError || new Error('Could not create auth user.');
    }

    // 2. Create the matching profile with the chosen role. A trigger
    //    (on_auth_user_created) may already have inserted a default profile
    //    row for the new auth account, so upsert ours on top of it.
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
      throw profileError;
    }

    // 3. Audit the account creation (PRD BR-13: significant actions audited).
    await supabaseAdmin.from('audit_entries').insert({
      actor_user_id: caller.id,
      action: 'user.created',
      entity_type: 'profile',
      entity_id: created.user.id,
      after_value: { full_name: fullName, email, role },
    });

    return NextResponse.json({ success: true, userId: created.user.id });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Could not create user: unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
