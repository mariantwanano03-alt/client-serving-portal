import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const SISTER_SYSTEM_API_KEY = process.env.SISTER_SYSTEM_API_KEY;

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    // 1. Bearer token auth
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return respond(401, { error: 'unauthorized' });
    }
    const token = authHeader.slice(7).trim();
    if (token !== SISTER_SYSTEM_API_KEY) {
      return respond(401, { error: 'unauthorized' });
    }

    // 2. Parse request body
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const email = typeof body?.email === 'string' ? body.email.trim() : null;
    const clientId = typeof body?.client_id === 'string' ? body.client_id.trim() : null;

    if (!email && !clientId) {
      return respond(400, { error: 'email_or_client_id_required' });
    }

    // 3. Resolve client_id
    let resolvedClientId: string | null = clientId;

    if (!resolvedClientId && email) {
      // Search client_contacts first
      const { data: contactMatches } = await supabaseAdmin
        .from('client_contacts')
        .select('client_id')
        .ilike('email', email)
        .limit(1);

      if (contactMatches && contactMatches.length > 0) {
        resolvedClientId = contactMatches[0].client_id;
      } else {
        // Fall back to clients table
        const { data: clientMatches } = await supabaseAdmin
          .from('clients')
          .select('id')
          .ilike('email', email)
          .limit(1);
        if (clientMatches && clientMatches.length > 0) {
          resolvedClientId = clientMatches[0].id;
        }
      }
    }

    if (!resolvedClientId) {
      return respond(404, { error: 'client_not_found' });
    }

    // 4. Fetch client with contacts
    const { data: clientData, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*, client_contacts(*)')
      .eq('id', resolvedClientId)
      .single();

    if (clientError || !clientData) {
      return respond(404, { error: 'client_not_found' });
    }

    const client = {
      id: clientData.id,
      client_code: clientData.client_code,
      name: clientData.name,
      email: clientData.email,
      phone: clientData.phone,
      billing_details: clientData.billing_details,
      contacts: (clientData as any).client_contacts || [],
    };

    // 5. Fetch projects
    const { data: projectsData, error: projectsError } = await supabaseAdmin
      .from('projects')
      .select('id, project_reference, name, stage, status, created_at')
      .eq('client_id', resolvedClientId)
      .order('created_at', { ascending: false });

    const projects = (projectsData || []).map((p) => ({
      id: p.id,
      project_reference: p.project_reference,
      name: p.name,
      stage: p.stage,
      status: p.status,
      created_at: p.created_at,
    }));

    // 6. Fetch deliverables
    const projectIds = projects.map((p) => p.id);

    // SLAs
    const { data: slasData } = await supabaseAdmin
      .from('slas')
      .select('id, project_id, terms, start_date, end_date, document_ref, created_at')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false });

    // Quotations - sent to client
    const { data: quotationsData } = await supabaseAdmin
      .from('quotations')
      .select('id, project_id, title, currency, status, validity_date, current_revision_id, created_at')
      .in('project_id', projectIds)
      .eq('status', 'sent_to_client')
      .order('created_at', { ascending: false });

    // Documents - PRD/SRS where status = 'sent_to_client'
    const { data: documentsData } = await supabaseAdmin
      .from('documents')
      .select('id, project_id, title, type, status, current_revision_id, created_at')
      .in('project_id', projectIds)
      .eq('status', 'sent_to_client')
      .order('created_at', { ascending: false });

    // Development links - verified only
    const { data: devLinksData } = await supabaseAdmin
      .from('development_links')
      .select('id, project_id, link_type, url, verified, verified_at')
      .in('project_id', projectIds)
      .eq('verified', true)
      .order('created_at', { ascending: false });

    // Milestones - deposits and payment confirmations
    const { data: depositsData } = await supabaseAdmin
      .from('deposits')
      .select('id, project_id, amount, currency, due_date, trigger, status, created_at')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false });

    const { data: paymentsData } = await supabaseAdmin
      .from('payment_confirmations')
      .select('id, project_id, deposit_id, amount, currency, reference, provider, external_reference, created_at')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false });

    // Get document revision storage refs for URL construction
    const docIds = (documentsData || []).map((d) => d.id);
    let revisionMap: Record<string, string> = {};
    if (docIds.length > 0) {
      const { data: revisions } = await supabaseAdmin
        .from('document_revisions')
        .select('document_id, storage_ref, revision_no')
        .in('document_id', docIds)
        .order('revision_no', { ascending: false });
      if (revisions) {
        for (const rev of revisions) {
          if (!revisionMap[rev.document_id]) {
            revisionMap[rev.document_id] = rev.storage_ref;
          }
        }
      }
    }

    // Get quotation revision storage refs for URL construction
    const quotationIds = (quotationsData || []).map((q) => q.current_revision_id).filter(Boolean);
    let quotationRevisionMap: Record<string, string> = {};
    if (quotationIds.length > 0) {
      const { data: quotationRevisions } = await supabaseAdmin
        .from('document_revisions')
        .select('document_id, storage_ref, revision_no')
        .in('document_id', quotationIds)
        .order('revision_no', { ascending: false });
      if (quotationRevisions) {
        for (const rev of quotationRevisions) {
          if (!quotationRevisionMap[rev.document_id]) {
            quotationRevisionMap[rev.document_id] = rev.storage_ref;
          }
        }
      }
    }

    // Build deliverables
    const deliverables = {
      sla: (slasData || []).map((s) => ({
        id: s.id,
        project_id: s.project_id,
        title: s.terms ? s.terms.slice(0, 80) : 'SLA',
        document_ref: s.document_ref,
        start_date: s.start_date,
        end_date: s.end_date,
        created_at: s.created_at,
      })),
      quotation: (quotationsData || []).map((q) => ({
        id: q.id,
        project_id: q.project_id,
        title: q.title,
        currency: q.currency,
        status: q.status,
        validity_date: q.validity_date,
        created_at: q.created_at,
        current_revision_id: q.current_revision_id,
        storage_ref: quotationRevisionMap[q.current_revision_id],
      })),
      documents: (documentsData || []).map((d) => ({
        id: d.id,
        project_id: d.project_id,
        title: d.title,
        type: d.type,
        status: d.status,
        storage_ref: revisionMap[d.id],
        created_at: d.created_at,
      })),
      dev_links: (devLinksData || []).map((l) => ({
        id: l.id,
        project_id: l.project_id,
        link_type: l.link_type,
        url: l.url,
        verified: l.verified,
        verified_at: l.verified_at,
      })),
      milestones: (depositsData || []).map((d) => ({
        id: d.id,
        project_id: d.project_id,
        amount: d.amount,
        currency: d.currency,
        due_date: d.due_date,
        trigger: d.trigger,
        status: d.status,
        created_at: d.created_at,
        type: 'deposit',
      })).concat((paymentsData || []).map((p) => ({
        id: p.id,
        project_id: p.project_id,
        amount: p.amount,
        currency: p.currency,
        due_date: null,
        trigger: p.provider,
        status: 'confirmed',
        created_at: p.created_at,
        type: 'payment_confirmation',
        reference: p.reference,
        external_reference: p.external_reference,
      }))),
    };

    return respond(200, {
      success: true,
      client,
      projects,
      deliverables,
    });
  } catch (error) {
    console.error('Pull data error:', error);
    return respond(500, { error: 'internal_error' });
  }
}

export async function GET() {
  return respond(405, { error: 'method_not_allowed' });
}
