import { NextResponse } from 'next/server';

import { supabaseAdmin, getCallerProfile } from '@/lib/supabase-server';

type ToggleStatusBody = {
  user_id?: string;
  is_active?: boolean;
};

// GoTrue has no "forever" keyword, so an (effectively) permanent ban is
// expressed as a very long duration. "none" lifts the ban entirely.
const PERMANENT_BAN = '876000h'; // 100 years

export async function POST(req: Request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server is not configured for account suspension (missing SUPABASE_SERVICE_ROLE_KEY).' },
        { status: 500 }
      );
    }

    const caller = await getCallerProfile(req.headers.get('authorization'));
    if (!caller) {
      return NextResponse.json(
        { error: 'You must be signed in to change account status.' },
        { status: 401 }
      );
    }
    if (caller.role !== 'administrator' || caller.is_active === false) {
      return NextResponse.json(
        { error: 'Only an active Administrator can change account status.' },
        { status: 403 }
      );
    }

    const body = (await req.json()) as ToggleStatusBody;
    const userId = body.user_id?.trim() ?? '';
    const nextActive = body.is_active;

    if (!userId || typeof nextActive !== 'boolean') {
      return NextResponse.json(
        { error: 'user_id and is_active (boolean) are required.' },
        { status: 400 }
      );
    }
    // An admin must never be able to lock themselves out of the portal.
    if (userId === caller.id) {
      return NextResponse.json(
        { error: 'You cannot change the status of your own account.' },
        { status: 400 }
      );
    }

    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, is_active')
      .eq('id', userId)
      .single();

    if (!target) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    // 1. Ban / unban at the auth layer. This is what actually blocks login:
    //    Supabase Auth (GoTrue) rejects credential grants for banned accounts,
    //    while the profiles flag alone does not. (PRD BR-01: only
    //    authenticated, ACTIVE internal users may access the portal.)
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: nextActive ? 'none' : PERMANENT_BAN,
    });
    if (banError) {
      throw banError;
    }

    // 2. Mirror the state onto the profile row for the directory UI.
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: nextActive })
      .eq('id', userId);

    if (profileError) {
      // Revert the auth-level ban so the two layers never disagree.
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        ban_duration: nextActive ? PERMANENT_BAN : 'none',
      });
      throw profileError;
    }

    // 3. Audit the governance action (PRD BR-13: significant actions audited).
    await supabaseAdmin.from('audit_entries').insert({
      actor_user_id: caller.id,
      action: nextActive ? 'user.reactivated' : 'user.suspended',
      entity_type: 'profile',
      entity_id: userId,
      before_value: { is_active: target.is_active },
      after_value: { is_active: nextActive },
    });

    return NextResponse.json({ success: true, is_active: nextActive });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Could not update account status: unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
