import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: Request) {
  try {
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    );
    if (callerError || !callerData?.user) {
      console.error('delete-user: caller auth failed', callerError);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const callerUser = callerData.user;

    const callerProfile = await supabaseAdmin
      .from('profiles')
      .select('role, is_active')
      .eq('id', callerUser.id)
      .single();
    if (!callerProfile.data || callerProfile.data.role !== 'administrator') {
      return NextResponse.json({ error: 'administrator_required' }, { status: 403 });
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return NextResponse.json({ error: 'user_id_required' }, { status: 400 });
    }

    // Prevent self-deletion
    if (user_id === callerUser.id) {
      return NextResponse.json({ error: 'cannot_delete_self' }, { status: 400 });
    }

    // Deactivate and soft-delete the profile to avoid
    // foreign key violations from tables referencing profiles.id
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('id', user_id);

    if (error) {
      console.error('delete-user: deactivate failed', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log the action
    await supabaseAdmin.from('audit_entries').insert({
      actor_user_id: callerUser.id,
      action: 'user.deleted',
      entity_type: 'profile',
      entity_id: user_id,
      before_value: { is_active: true },
      after_value: { is_active: false },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete user.';
    console.error('delete-user: unexpected error', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
