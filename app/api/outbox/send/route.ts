import { NextResponse } from 'next/server';
import { supabaseAdmin, getCallerProfile } from '@/lib/supabase-server';

const SISTER_SYSTEM_DELIVERABLES_URL = 'https://api.external-system.com/webhooks/deliverables';
const MOCK_SISTER_SYSTEM_TOKEN = 'MOCK_SISTER_SYSTEM_TOKEN';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

/**
 * Outbound Sender — Pushes an approved document to the external Sister System.
 *
 * Only Senior Developer / PM or Administrator may trigger this.
 * Called from the Project Workspace "Send to Client" action on Quotation / SLA.
 */
export async function POST(req: Request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return respond(500, { error: 'server_not_configured' });
    }

    // Authorize caller — only senior_dev_pm or administrator
    const caller = await getCallerProfile(req.headers.get('authorization'));
    if (!caller) {
      return respond(401, { error: 'unauthorized' });
    }
    if (!caller.is_active) {
      return respond(403, { error: 'inactive_user' });
    }
    if (caller.role !== 'senior_dev_pm' && caller.role !== 'administrator') {
      return respond(403, { error: 'senior_approver_required' });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const documentId =
      typeof body?.documentId === 'string'
        ? body.documentId
        : typeof body?.document_id === 'string'
          ? body.document_id
          : null;
    const projectId =
      typeof body?.projectId === 'string'
        ? body.projectId
        : typeof body?.project_id === 'string'
          ? body.project_id
          : null;

    if (!documentId || !UUID_PATTERN.test(documentId)) {
      return respond(400, { error: 'invalid_document_id' });
    }
    if (!projectId || !UUID_PATTERN.test(projectId)) {
      return respond(400, { error: 'invalid_project_id' });
    }

    // Fetch the document with its current revision
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .select(`
        id,
        project_id,
        title,
        type,
        status,
        document_revisions (
          id,
          content,
          revision_no,
          status,
          created_at
        )
      `)
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return respond(404, { error: 'document_not_found' });
    }

    if (document.status !== 'approved') {
      return respond(409, { error: 'document_not_approved' });
    }

    const revisions = (document as any).document_revisions || [];
    const currentRevision = revisions[0] || null;

    const payload = {
      document_id: document.id,
      project_id: document.project_id,
      document_title: document.title,
      document_type: document.type,
      document_status: document.status,
      revision_no: currentRevision?.revision_no || null,
      content: currentRevision?.content || null,
      sent_by: caller.id,
      sent_at: new Date().toISOString(),
    };

    // Push to Sister System drop-off URL
    const sisterResponse = await fetch(SISTER_SYSTEM_DELIVERABLES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOCK_SISTER_SYSTEM_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!sisterResponse.ok) {
      const errorText = await sisterResponse.text();
      console.error('Sister system delivery failed:', errorText);
      return respond(502, { error: 'sister_system_delivery_failed' });
    }

    const sisterResult = await sisterResponse.json();

    // Update document status to sent_to_client
    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({
        status: 'sent_to_client',
        sent_to_client_at: new Date().toISOString(),
        sent_to_client_by: caller.id,
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('Document status update failed:', updateError);
      return respond(500, { error: 'document_status_update_failed' });
    }

    // Log to audit_entries
    const { error: auditError } = await supabaseAdmin
      .from('audit_entries')
      .insert({
        actor_user_id: caller.id,
        action: 'document.sent_to_sister_system',
        entity_type: 'document',
        entity_id: documentId,
        before_value: { status: 'approved' },
        after_value: { status: 'sent_to_client', sister_system_response: sisterResult },
      });

    if (auditError) {
      console.error('Audit insert failed:', auditError);
    }

    return respond(200, {
      success: true,
      document_id: documentId,
      status: 'sent_to_client',
      sister_system: sisterResult,
    });
  } catch (error) {
    console.error('Outbox send failed:', error);
    return respond(500, { error: 'internal_error' });
  }
}

export async function GET() {
  return respond(405, { error: 'method_not_allowed' });
}
