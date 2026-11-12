import { NextResponse } from 'next/server';
import { supabaseAdmin, getCallerProfile } from '@/lib/supabase-server';

const ALLOWED_SENDABLE_TYPES = new Set(['Quotation', 'Service Agreement', 'Proposal']);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

/**
 * Task 5 — Outbox: log a document or quotation that is ready to be pushed to the external
 * "Sister System". Called when a Senior Developer / PM approves (and is then
 * expected to send) a Quotation or SLA.
 *
 * Only seniors with approval authority (or an administrator) may enqueue.
 */
export async function POST(req: Request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return respond(500, { error: 'server_not_configured' });
    }

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

    const quotationId =
      typeof body?.quotationId === 'string'
        ? body.quotationId
        : typeof body?.quotation_id === 'string'
          ? body.quotation_id
          : null;

    if (!documentId && !quotationId) {
      return respond(400, { error: 'document_id or quotation_id required' });
    }

    if (documentId && !UUID_PATTERN.test(documentId)) {
      return respond(400, { error: 'invalid_document_id' });
    }

    if (quotationId && !UUID_PATTERN.test(quotationId)) {
      return respond(400, { error: 'invalid_quotation_id' });
    }

    // Handle document send
    if (documentId) {
      const { data: document, error: docError } = await supabaseAdmin
        .from('documents')
        .select('id, project_id, type, status')
        .eq('id', documentId)
        .single();

      if (docError || !document) {
        return respond(404, { error: 'document_not_found' });
      }

      if (document.status !== 'approved') {
        return respond(409, { error: 'document_not_approved' });
      }

      if (!ALLOWED_SENDABLE_TYPES.has(String(document.type))) {
        return respond(400, { error: 'document_not_sendable' });
      }

      const { data: outboxMessage, error: outboxError } = await supabaseAdmin
        .from('outbox_messages')
        .insert({
          document_id: document.id,
          destination: 'sister_system',
          status: 'queued',
          payload: {
            document_id: document.id,
            project_id: document.project_id,
            document_type: document.type,
            status: 'approved',
            sent_by: caller.id,
            sent_at: new Date().toISOString(),
          },
        })
        .select('id')
        .single();

      if (outboxError || !outboxMessage) {
        return respond(500, { error: 'outbox_insert_failed' });
      }

      return respond(200, { success: true, outbox_message_id: outboxMessage.id, document_id: document.id });
    }

    // Handle quotation send
    if (quotationId) {
      const { data: quotation, error: quoteError } = await supabaseAdmin
        .from('quotations')
        .select('id, project_id, type, status, title, currency')
        .eq('id', quotationId)
        .single();

      if (quoteError || !quotation) {
        return respond(404, { error: 'quotation_not_found' });
      }

      if (quotation.status !== 'approved') {
        return respond(409, { error: 'quotation_not_approved' });
      }

      const { data: outboxMessage, error: outboxError } = await supabaseAdmin
        .from('outbox_messages')
        .insert({
          quotation_id: quotation.id,
          destination: 'sister_system',
          status: 'queued',
          payload: {
            quotation_id: quotation.id,
            project_id: quotation.project_id,
            document_type: 'quotation',
            status: 'approved',
            sent_by: caller.id,
            sent_at: new Date().toISOString(),
          },
        })
        .select('id')
        .single();

      if (outboxError || !outboxMessage) {
        return respond(500, { error: 'outbox_insert_failed' });
      }

      return respond(200, { success: true, outbox_message_id: outboxMessage.id, quotation_id: quotation.id });
    }

    return respond(400, { error: 'document_id or quotation_id required' });
  } catch (error) {
    console.error('Outbox send-documents failed:', error);
    return respond(500, { error: 'internal_error' });
  }
}

export async function GET() {
  return respond(405, { error: 'method_not_allowed' });
}
