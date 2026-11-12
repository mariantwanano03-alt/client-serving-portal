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
        { status: 403 });
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
      return NextResponse.json({ ok: true, alreadyComplete: true, projectId: session.project_id });
    }

    const transcript = (session.transcript || '').trim();
    if (!transcript) {
      return NextResponse.json(
        { error: 'Cannot approve discovery session without a transcript. Record or enter meeting transcript first.' },
        { status: 400 });
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

    // Step 2: Create Client
    await step('promoting');

    const companyName = extracted.company_name || session.meeting_title || 'Untitled Client';
    const clientCode = `CLI-${Date.now().toString(36).toUpperCase()}`;

    const { data: newClient, error: clientErr } = await supabaseAdmin
      .from('clients')
      .insert({
        id: crypto.randomUUID(),
        client_code: clientCode,
        name: companyName,
        email: extracted.email || null,
        phone: extracted.phone || null,
        primary_contact: extracted.primary_contact || null,
        billing_details: extracted.billing_details || null,
        created_by: caller.user.id,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr || !newClient) {
      console.error('Client insert failed:', clientErr)
      throw new Error(clientErr?.message || 'Failed to create client');
    }

    // Step 3: Create Project
    const projectReference = `PRJ-${Date.now().toString(36).toUpperCase()}`;
    const projectName = `${companyName} — Platform Solution`;

    const { data: newProject, error: projectErr } = await supabaseAdmin
      .from('projects')
      .insert({
        id: crypto.randomUUID(),
        project_reference: projectReference,
        client_id: newClient.id,
        name: projectName,
        stage: 'scoping',
        status: 'active',
        created_by: caller.user.id,
        client_creation_status: 'created',
        is_provisional: false,
      })
      .select()
      .single();

    if (projectErr || !newProject) {
      throw new Error(projectErr?.message || 'Failed to create project');
    }

    // Step 4: Link Session to Client and Project
    await supabaseAdmin
      .from('discovery_sessions')
      .update({
        client_id: newClient.id,
        project_id: newProject.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    // Step 5: Insert Client Contacts (Idempotent)
    if (extracted.contacts && extracted.contacts.length > 0) {
      const { data: existingContacts } = await supabaseAdmin
        .from('client_contacts')
        .select('name')
        .eq('client_id', newClient.id);

      const existingNames = new Set((existingContacts || []).map((c) => c.name.toLowerCase()));
      const contactsToInsert = extracted.contacts
        .filter((c) => !existingNames.has(c.name.toLowerCase()))
        .map((c) => ({
          id: crypto.randomUUID(),
          client_id: newClient.id,
          name: c.name,
          role: c.role || null,
          email: c.email || null,
          phone: c.phone || null,
        }));

      if (contactsToInsert.length > 0) {
        await supabaseAdmin.from('client_contacts').insert(contactsToInsert);
      }
    }

    // Step 6: Insert Requirements (Idempotent per discovery session)
    if (extracted.requirements && extracted.requirements.length > 0) {
      const startIndex = 1;

      const { error: insErr } = await supabaseAdmin.from('requirements').insert(
        extracted.requirements.map((r: { title: string; priority?: string }, i: number) => ({
          id: crypto.randomUUID(),
          project_id: newProject.id,
          requirement_ref: `REQ-${String(startIndex + i).padStart(3, '0')}`,
          title: r.title,
          priority: r.priority ?? 'medium',
          status: 'draft',
          created_by: caller.user.id,
        }))
      );
      if (insErr) throw new Error(`requirements insert failed: ${insErr.message}`);
    }

    // Step 7: Generate Documents (PRD/SRS pipeline)
    // TODO: Integrate generatePrdAndSrs pipeline here when available

    // Step 8: Mark Complete
    await step('complete');

    // Audit Log
    await supabaseAdmin.from('audit_entries').insert({
      actor_user_id: caller.user.id,
      action: 'discovery.approved',
      entity_type: 'discovery_session',
      entity_id: session.id,
      project_id: newProject.id,
      after_value: {
        status: 'complete',
        client_id: newClient.id,
        project_id: newProject.id,
        promoted: true,
      },
    });

    return NextResponse.json({ ok: true, complete: true, projectId: newProject.id });
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
