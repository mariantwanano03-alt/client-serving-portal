import { NextResponse } from 'next/server';
import { getAuthenticatedCaller } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { extractClientFromTranscript, type ExtractedClient } from '@/lib/ai/extract';

type ApproveBody = {
  sessionId?: string;
};

export async function POST(req: Request) {
  let activeSessionId: string | null = null;

  try {
    const caller = await getAuthenticatedCaller(req);
    if (!caller) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (!caller.profile.is_active || (caller.profile.role !== 'senior_dev_pm' && caller.profile.role !== 'administrator')) {
      return NextResponse.json(
        { error: 'Only an active Senior Developer / PM or Administrator can approve discovery.' },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as ApproveBody;
    const sessionId = body.sessionId;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }
    activeSessionId = sessionId;

    // Load Discovery Session
    const { data: session, error: sessionErr } = await supabaseAdmin
      .from('discovery_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: 'Discovery session not found' }, { status: 404 });
    }

    if (session.generation_status === 'complete') {
      return NextResponse.json({ ok: true, alreadyComplete: true });
    }

    const transcript = (session.transcript || '').trim();
    if (!transcript) {
      return NextResponse.json(
        { error: 'Cannot approve discovery session without a transcript. Record or enter meeting transcript first.' },
        { status: 400 }
      );
    }

    const step = async (status: string, reason: string | null = null) => {
      await supabaseAdmin
        .from('discovery_sessions')
        .update({
          generation_status: status,
          failure_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
    };

    // Step 1: Extracting
    await step('extracting');
    let extracted: ExtractedClient;
    if (session.extraction && typeof session.extraction === 'object' && Object.keys(session.extraction).length > 0) {
      extracted = session.extraction as ExtractedClient;
    } else {
      extracted = await extractClientFromTranscript(transcript);
      await supabaseAdmin
        .from('discovery_sessions')
        .update({ extraction: extracted })
        .eq('id', sessionId);
    }

    // Step 2: Promoting Client
    await step('promoting');
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', session.client_id)
      .single();

    if (client && !client.promoted_at) {
      const updates: Record<string, unknown> = {
        status: 'active',
        promoted_at: new Date().toISOString(),
      };

      if (extracted.company_name) updates.name = extracted.company_name;
      if (extracted.email) updates.email = extracted.email;
      if (extracted.phone) updates.phone = extracted.phone;
      if (extracted.primary_contact) updates.primary_contact = extracted.primary_contact;
      if (extracted.billing_details) updates.billing_details = extracted.billing_details;

      await supabaseAdmin.from('clients').update(updates).eq('id', client.id);

      // If project was using a placeholder name, update it with client name
      if (extracted.company_name) {
        await supabaseAdmin
          .from('projects')
          .update({ name: `${extracted.company_name} — Platform Solution` })
          .eq('id', session.project_id)
          .eq('name', session.meeting_title);
      }
    }

    // Step 3: Insert Client Contacts (Idempotent)
    if (extracted.contacts && extracted.contacts.length > 0) {
      const { data: existingContacts } = await supabaseAdmin
        .from('client_contacts')
        .select('name')
        .eq('client_id', session.client_id);

      const existingNames = new Set((existingContacts || []).map((c) => c.name.toLowerCase()));
      const contactsToInsert = extracted.contacts
        .filter((c) => !existingNames.has(c.name.toLowerCase()))
        .map((c) => ({
          client_id: session.client_id,
          name: c.name,
          role: c.role || null,
          email: c.email || null,
          phone: c.phone || null,
        }));

      if (contactsToInsert.length > 0) {
        await supabaseAdmin.from('client_contacts').insert(contactsToInsert);
      }
    }

    // Step 4: Insert Requirements (idempotent per discovery session)
    if (extracted.requirements && extracted.requirements.length > 0) {
      // Remove any rows previously inserted by THIS session.
      // Rows from other sessions (or NULL session) are untouched.
      const { error: delErr } = await supabaseAdmin
        .from('requirements')
        .delete()
        .eq('project_id', session.project_id)
        .eq('discovery_session_id', session.id);
      if (delErr) throw new Error(`requirements dedupe failed: ${delErr.message}`);

      // Determine the next ref number based on what remains for the project.
      const { data: existingReqs } = await supabaseAdmin
        .from('requirements')
        .select('requirement_ref')
        .eq('project_id', session.project_id);

      const startIndex = (existingReqs?.length ?? 0) + 1;

      const { error: insErr } = await supabaseAdmin.from('requirements').insert(
        extracted.requirements.map((r: { title: string; priority?: string }, i: number) => ({
          project_id: session.project_id,
          discovery_session_id: session.id,
          requirement_ref: `REQ-${String(startIndex + i).padStart(3, '0')}`,
          title: r.title,
          priority: r.priority ?? 'medium',
          status: 'draft',
        }))
      );
      if (insErr) throw new Error(`requirements insert failed: ${insErr.message}`);
    }

    // Step 5: Complete
    await step('complete');

    // Audit Log
    await supabaseAdmin.from('audit_entries').insert({
      actor_user_id: caller.user.id,
      action: 'discovery.approved',
      entity_type: 'discovery_session',
      entity_id: session.id,
      project_id: session.project_id,
      after_value: {
        status: 'complete',
        client_id: session.client_id,
        promoted: true,
      },
    });

    return NextResponse.json({ ok: true, complete: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown approval error';
    console.error('Discovery approval error:', error);

    if (activeSessionId) {
      await supabaseAdmin
        .from('discovery_sessions')
        .update({
          generation_status: 'failed',
          failure_reason: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeSessionId);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
