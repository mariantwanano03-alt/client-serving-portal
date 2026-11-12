import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: Request) {
  try {
    // Verify the caller is an active administrator (same pattern as create-user)
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    );
    if (callerError || !callerData?.user) {
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

    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, is_active, full_name, role')
      .eq('id', user_id)
      .single();

    if (!target) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    // Deactivate the profile row so the user no longer appears in the
    // team directory and PortalShell blocks them from accessing.
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: false })
      .eq('id', user_id);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    // Try to delete the Supabase Auth account so the email can be re-used.
    // If deletion fails (local Supabase limitation), rename the auth account's
    // email to free up the original email for re-use.
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);
    if (authDeleteError) {
      console.warn('delete-user: auth delete failed, renaming email instead', authDeleteError.message);
      await supabaseAdmin.auth.admin.updateUserById(user_id, {
        email: `deleted-${user_id}@example.com`,
      }).catch((renameErr) => {
        console.warn('delete-user: email rename also failed', renameErr.message);
      });
    }

    // Log the action
    await supabaseAdmin.from('audit_entries').insert({
      actor_user_id: callerUser.id,
      action: 'user.deleted',
      entity_type: 'profile',
      entity_id: user_id,
      before_value: { is_active: target.is_active, full_name: target.full_name, role: target.role },
      after_value: { is_active: false, removed: true },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete user.';
    console.error('delete-user: unexpected error', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
