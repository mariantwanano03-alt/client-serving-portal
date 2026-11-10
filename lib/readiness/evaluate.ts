import { supabaseAdmin } from '@/lib/supabase/admin';

export type ReadinessEvaluationResult = {
  checkId: string;
  items: { criterion: string; mandatory: boolean; overridable: boolean; result: string }[];
};

/**
 * Server-side evaluation of pre-development readiness criteria.
 */
export async function recomputeProjectReadiness(
  projectId: string,
  actorUserId?: string | null
): Promise<ReadinessEvaluationResult> {
  // 1. Fetch current documents
  const { data: documents } = await supabaseAdmin
    .from('documents')
    .select('id, title, type, status, document_revisions(status)')
    .eq('project_id', projectId);

  const docs = documents || [];

  const isDocApproved = (keywords: string[]): boolean => {
    return docs.some((doc) => {
      const titleLower = (doc.title || '').toLowerCase();
      const match = keywords.some((kw) => titleLower.includes(kw.toLowerCase()));
      if (!match) return false;
      if ((doc.status || '').toLowerCase().includes('approved')) return true;
      const revs = doc.document_revisions as unknown as { status: string }[] | null;
      return Boolean(revs?.[0]?.status?.toLowerCase().includes('approved'));
    });
  };

  const hasApprovedSRS = isDocApproved(['srs', 'software requirements specification', 'requirements specification']);
  const hasApprovedPRD = isDocApproved(['prd', 'product requirements document']);
  const hasApprovedSLA = isDocApproved(['sla', 'service level agreement']);
  const hasApprovedQuotation = isDocApproved(['quotation', 'proposal', 'quote']);

  // 2. Fetch deposits
  const { data: deposits } = await supabaseAdmin
    .from('deposits')
    .select('status')
    .eq('project_id', projectId);

  const hasConfirmedDeposit = (deposits || []).some((d) => d.status === 'paid');

  // 3. Fetch development links
  const { data: devLinks } = await supabaseAdmin
    .from('development_links')
    .select('link_type, url, verified')
    .eq('project_id', projectId);

  const hasVerifiedRepo = (devLinks || []).some(
    (l) => Boolean(l.verified) && (l.link_type === 'repository' || (l.url || '').includes('github') || (l.url || '').includes('gitlab'))
  );

  // 4. Fetch client contacts
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('client_id')
    .eq('id', projectId)
    .single();

  let hasClientContact = false;
  if (project?.client_id) {
    const { count } = await supabaseAdmin
      .from('client_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', project.client_id);
    hasClientContact = (count || 0) > 0;
  }

  const criteria = [
    {
      criterion: 'SRS approved by Senior PM',
      mandatory: true,
      overridable: false,
      result: hasApprovedSRS ? 'passed' : 'outstanding',
    },
    {
      criterion: 'PRD approved by Senior PM',
      mandatory: true,
      overridable: false,
      result: hasApprovedPRD ? 'passed' : 'outstanding',
    },
    {
      criterion: 'SLA approved by Senior PM',
      mandatory: true,
      overridable: false,
      result: hasApprovedSLA ? 'passed' : 'outstanding',
    },
    {
      criterion: 'Quotation approved by Senior PM',
      mandatory: true,
      overridable: false,
      result: hasApprovedQuotation ? 'passed' : 'outstanding',
    },
    {
      criterion: 'SLA Signed by Client',
      mandatory: true,
      overridable: false,
      result: 'outstanding',
    },
    {
      criterion: 'Initial Deposit Paid',
      mandatory: true,
      overridable: false,
      result: hasConfirmedDeposit ? 'passed' : 'outstanding',
    },
    {
      criterion: 'Final Payment Paid',
      mandatory: true,
      overridable: false,
      result: 'outstanding',
    },
    {
      criterion: 'Source repository initialized and verified',
      mandatory: true,
      overridable: false,
      result: hasVerifiedRepo ? 'passed' : 'outstanding',
    },
    {
      criterion: 'Client technical contact assigned',
      mandatory: false,
      overridable: true,
      result: hasClientContact ? 'passed' : 'outstanding',
    },
  ];

  // 5. Upsert readiness check
  const { data: existingCheck } = await supabaseAdmin
    .from('readiness_checks')
    .select('id')
    .eq('project_id', projectId)
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let checkId = existingCheck?.id;

  if (!checkId) {
    const { data: newCheck } = await supabaseAdmin
      .from('readiness_checks')
      .insert({
        project_id: projectId,
        run_by: actorUserId ?? null,
        result: 'pending',
      })
      .select('id')
      .single();
    checkId = newCheck?.id;
  }

  if (checkId) {
    // Delete old items and insert fresh evaluation
    await supabaseAdmin.from('readiness_items').delete().eq('readiness_check_id', checkId);

    await supabaseAdmin.from('readiness_items').insert(
      criteria.map((c) => ({
        readiness_check_id: checkId,
        criterion: c.criterion,
        mandatory: c.mandatory,
        overridable: c.overridable,
        result: c.result,
      }))
    );
  }

  return {
    checkId: checkId || '',
    items: criteria,
  };
}
