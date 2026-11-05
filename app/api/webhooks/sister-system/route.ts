import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const MAX_BODY_BYTES = 64 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type JsonObject = Record<string, unknown>;

function respond(status: number, body: JsonObject) {
  return NextResponse.json(body, { status });
}

function readString(body: JsonObject, keys: string[], maxLength: number): string | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, maxLength);
    }
  }
  return null;
}

function readAmount(body: JsonObject): number | null {
  const value = body.amount;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Task 5 — Sister System webhook receiver (inbound).
 *
 * Mock security: verifies the x-sister-system-secret header.
 * Uses the Supabase service role key (external systems have no user session).
 *
 * Listens for:
 *   - `payment_confirmed` : inserts into payment_confirmations, marks deposit paid
 *   - `document_signed`    : marks document + revision as signed; advances
 *                             project to completed when an SLA/Service Agreement
 *                             is signed
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SISTER_WEBHOOK_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'Sister System webhook is not configured. Set SISTER_WEBHOOK_SECRET, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.'
    );
    return respond(500, { error: 'webhook_not_configured' });
  }

  // Mock security: simple header check (no HMAC yet)
  const providedSecret = request.headers.get('x-sister-system-secret');
  if (!providedSecret || providedSecret !== secret) {
    return respond(401, { error: 'invalid_signature' });
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return respond(413, { error: 'payload_too_large' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return respond(400, { error: 'invalid_json' });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return respond(400, { error: 'invalid_payload' });
  }

  const body = parsed as JsonObject;
  const eventType = (readString(body, ['event_type', 'eventType', 'type', 'event'], 60) ?? '').toLowerCase();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------------------------------------------------------------------
  // payment_confirmed → record verified payment, mark deposit paid
  // ---------------------------------------------------------------------
  if (eventType === 'payment_confirmed') {
    const eventId = readString(body, ['event_id', 'eventId', 'id'], 200);
    const provider = readString(body, ['provider', 'source'], 80);
    const projectId = readString(body, ['project_id', 'projectId'], 64);
    const depositId = readString(body, ['deposit_id', 'depositId'], 64);
    const externalReference = readString(
      body,
      ['external_reference', 'externalReference', 'payment_reference', 'reference'],
      200
    );
    const currency = (readString(body, ['currency'], 3) ?? 'ZAR').toUpperCase();
    const paymentStatus = (readString(body, ['status'], 40) ?? 'paid').toLowerCase();
    const amount = readAmount(body);
    const paymentDate = readString(body, ['payment_date', 'paymentDate'], 10) ?? null;

    if (!eventId) return respond(400, { error: 'event_id_required' });
    if (!provider) return respond(400, { error: 'provider_required' });
    if (!projectId || !UUID_PATTERN.test(projectId)) {
      return respond(400, { error: 'invalid_project_id' });
    }
    if (!externalReference) return respond(400, { error: 'external_reference_required' });
    if (amount === null || amount <= 0) return respond(400, { error: 'invalid_amount' });
    if (!/^[A-Z]{3}$/.test(currency)) return respond(400, { error: 'invalid_currency' });
    if (paymentDate && !DATE_PATTERN.test(paymentDate)) {
      return respond(400, { error: 'invalid_payment_date' });
    }

    if (depositId && !UUID_PATTERN.test(depositId)) {
      return respond(400, { error: 'invalid_deposit_id' });
    }

    if (paymentStatus !== 'paid' && paymentStatus !== 'confirmed' && paymentStatus !== 'succeeded' && paymentStatus !== 'settled') {
      return respond(202, { status: 'ignored', reason: `payment_status_${paymentStatus}` });
    }

    // Insert payment confirmation
    const { error: pcError } = await supabase.from('payment_confirmations').insert({
      project_id: projectId,
      deposit_id: depositId ?? null,
      amount,
      currency,
      reference: externalReference,
      external_reference: externalReference,
      provider,
      confirmed_by: null,
      created_at: new Date().toISOString(),
    });

    if (pcError) {
      console.error('Payment confirmation insert failed:', pcError);
      return respond(500, { error: 'payment_confirmation_failed' });
    }

    // Mark the corresponding deposit as paid
    if (depositId) {
      const { error: depError } = await supabase
        .from('deposits')
        .update({ status: 'paid' })
        .eq('id', depositId);

      if (depError) {
        console.error('Deposit status update failed:', depError);
      }
    }

    // Audit entry
    await supabase.from('audit_entries').insert({
      actor_user_id: null,
      action: 'payment_confirmed',
      entity_type: 'payment_confirmation',
      entity_id: projectId,
      project_id: projectId,
      before_value: { status: 'awaiting_payment' },
      after_value: { status: 'paid', external_reference: externalReference, amount, currency, provider },
    });

    return respond(200, { status: 'payment_confirmed_processed' });
  }

  // ---------------------------------------------------------------------
  // document_signed → mark document + revision as signed
  // ---------------------------------------------------------------------
  if (eventType === 'document_signed') {
    const documentId = readString(body, ['document_id', 'documentId'], 64);
    const signedFileUrl = readString(body, ['signed_file_url', 'signedFileUrl', 'file_url'], 500);
    if (!documentId || !UUID_PATTERN.test(documentId)) {
      return respond(400, { error: 'invalid_document_id' });
    }

    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, project_id, current_revision_id, status, type')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return respond(404, { error: 'document_not_found' });
    }

    const revisionId = document.current_revision_id;

    const { error: revisionError } = revisionId
      ? await supabase.from('document_revisions').update({ status: 'signed' }).eq('id', revisionId)
      : { error: null };

    const { error: docUpdateError } = await supabase
      .from('documents')
      .update({
        status: 'signed',
        ...(signedFileUrl ? { storage_ref: signedFileUrl } : {}),
      })
      .eq('id', documentId);

    if (revisionError || docUpdateError) {
      console.error('Sister System document_signed update failed:', revisionError || docUpdateError);
      return respond(500, { error: 'document_update_failed' });
    }

    // Audit entry
    await supabase.from('audit_entries').insert({
      actor_user_id: null,
      action: 'document.signed',
      entity_type: 'document',
      entity_id: documentId,
      project_id: document.project_id,
      before_value: { status: document.status },
      after_value: { status: 'signed', signed_file_url: signedFileUrl },
    });

    // If a Service Agreement (SLA) is signed by the client, mark the project complete.
    if (document.type === 'Service Agreement' || document.type === 'SLA') {
      const { error: stageError } = await supabase.from('projects').update({
        stage: 'completed',
        status: 'completed',
      }).eq('id', document.project_id);

      if (stageError) {
        console.error('Sister System stage advance failed:', stageError);
      } else {
        await supabase.from('project_stage_history').insert({
          project_id: document.project_id,
          from_stage: null,
          to_stage: 'completed',
          status: 'completed',
          changed_by: null,
        });

        await supabase.from('audit_entries').insert({
          actor_user_id: null,
          action: 'project.stage_transition',
          entity_type: 'project',
          entity_id: document.project_id,
          project_id: document.project_id,
          before_value: { stage: null },
          after_value: { stage: 'completed' },
        });
      }
    }

    return respond(200, { status: 'document_signed_processed', document_id: documentId });
  }

  // Unhandled event types are acknowledged so the Sister System does not retry.
  return respond(202, { status: 'event_unhandled', event_type: eventType });
}

export async function GET() {
  return respond(405, { error: 'method_not_allowed' });
}
