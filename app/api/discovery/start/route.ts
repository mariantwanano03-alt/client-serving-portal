import { NextResponse } from 'next/server';
import { getAuthenticatedCaller } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

type StartDiscoveryBody = {
  meetingTitle?: string;
  meetingDate?: string;
};

export async function POST(req: Request) {
  let createdClientId: string | null = null;
  let createdProjectId: string | null = null;
  let createdSessionId: string | null = null;

  try {
    const caller = await getAuthenticatedCaller(req);
    if (!caller) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as StartDiscoveryBody;
    const now = Date.now();
    const base36 = now.toString(36).toUpperCase();
    const dateStr = body.meetingDate || new Date().toISOString().split('T')[0];
    const meetingTitle = body.meetingTitle?.trim() || `Discovery — ${dateStr}`;
    const clientName = body.meetingTitle?.trim() || `Unnamed — ${dateStr}`;
    const clientCode = `PEND-${base36}`;
    const projectRef = `PRJ-${base36}`;


    // 1. Insert Provisional Client
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .insert({
        client_code: clientCode,
        name: clientName,
        status: 'provisional',
        created_by: caller.user.id,
      })
      .select('id')
      .single();

    if (clientErr || !client) {
      throw new Error(`Failed to create provisional client: ${clientErr?.message}`);
    }
    createdClientId = client.id;

    // 2. Insert Project pointing to client
    const { data: project, error: projErr } = await supabaseAdmin
      .from('projects')
      .insert({
        project_reference: projectRef,
        client_id: client.id,
        name: meetingTitle,
        stage: 'discovery',
        status: 'active',

      })
      .select('id')
      .single();

    if (projErr || !project) {
      throw new Error(`Failed to create project: ${projErr?.message}`);
    }
    createdProjectId = project.id;

    // 3. Insert Discovery Session
    const { data: session, error: sessErr } = await supabaseAdmin
      .from('discovery_sessions')
      .insert({
        client_id: client.id,
        project_id: project.id,
        meeting_title: meetingTitle,
        meeting_date: dateStr,
        generation_status: 'pending',
        created_by: caller.user.id,
      })
      .select('id')
      .single();

    if (sessErr || !session) {
      throw new Error(`Failed to create discovery session: ${sessErr?.message}`);
    }
    createdSessionId = session.id;

    // 4. Link origin_discovery_id to client
    await supabaseAdmin
      .from('clients')
      .update({ origin_discovery_id: session.id })
      .eq('id', client.id);

    return NextResponse.json({
      sessionId: session.id,
      projectId: project.id,
    });
  } catch (error: unknown) {
    // Compensating deletes for clean rollback
    if (createdSessionId) {
      await supabaseAdmin.from('discovery_sessions').delete().eq('id', createdSessionId);
    }
    if (createdProjectId) {
      await supabaseAdmin.from('projects').delete().eq('id', createdProjectId);
    }
    if (createdClientId) {
      await supabaseAdmin.from('clients').delete().eq('id', createdClientId);
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
