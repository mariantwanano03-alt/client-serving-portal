import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ExtractedClient } from './extract';
import { groqFetch } from './groq';
import { withRetry } from './retry';

export type DocumentTypeKey = 'requirements' | 'prd' | 'quotation' | 'sla' | 'prompt_md';

export type GenerateDocumentResult = {
  documentId: string;
  revisionId: string;
  title: string;
  type: string;
  content: string;
};

/**
 * Core generation engine shared across /api/generate-document and discovery pipelines.
 */
export async function generateDocumentCore(
  projectId: string,
  documentType: DocumentTypeKey,
  options?: {
    customContext?: string;
    actorUserId?: string | null;
  }
): Promise<GenerateDocumentResult> {

  // 1. Fetch Project Details
  const { data: project, error: projError } = await supabaseAdmin
    .from('projects')
    .select('name, clients(name)')
    .eq('id', projectId)
    .single();

  if (projError || !project) {
    throw new Error(`Project not found: ${projError?.message || projectId}`);
  }

  const relatedClient = project.clients as unknown as { name?: string } | { name?: string }[] | null;
  const clientName = Array.isArray(relatedClient)
    ? relatedClient[0]?.name
    : relatedClient?.name;

  // 2. Fetch Discovery Context if not explicitly provided
  let discoveryContext = options?.customContext || '';

  if (!discoveryContext) {
    // Check discovery_sessions first
    const { data: session } = await supabaseAdmin
      .from('discovery_sessions')
      .select('transcript, meeting_title')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (session?.transcript) {
      discoveryContext = `Meeting: ${session.meeting_title || 'Discovery'}\nTranscript:\n${session.transcript}`;
    } else {
      // Fall back to discovery_records
      const { data: discoveries } = await supabaseAdmin
        .from('discovery_records')
        .select('summary, notes, transcript_ref')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (discoveries && discoveries.length > 0) {
        discoveryContext = discoveries
          .map((d) => `Summary: ${d.summary || 'N/A'}\nNotes: ${d.notes || 'N/A'}\nTranscript: ${d.transcript_ref || 'N/A'}`)
          .join('\n\n---\n\n');
      }
    }
  }

  // 3. Fetch existing generated documents for additional context
  const { data: existingDocs } = await supabaseAdmin
    .from('documents')
    .select('title, type, document_revisions(content)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  const srsDoc = existingDocs?.find((d) => d.title.includes('Software Requirements Specification'));
  const srsContext = srsDoc?.document_revisions?.[0]?.content || '';

  const prdDoc = existingDocs?.find((d) => d.title.includes('Product Requirements Document'));
  const prdContext = prdDoc?.document_revisions?.[0]?.content || '';

  let systemPrompt = '';
  let docTitle = '';
  let docTypeLabel = '';

  if (documentType === 'requirements') {
    systemPrompt = `You are a Senior Systems Analyst at X Spark. Based on the discovery notes/transcript, generate a detailed Software Requirements Specification (SRS).
Use clear numbered headings. Include: 1. System Overview, 2. Scope, 3. Assumptions, 4. Stakeholders, 5. Functional Requirements, 6. Workflow, 7. Data Requirements, 8. Acceptance Criteria, 9. Risks.

CONTEXT:\n${discoveryContext || 'No transcript provided.'}`;
    docTitle = 'Software Requirements Specification - ' + (project.name || 'Project');
    docTypeLabel = 'Specification (SOW)';
  } else if (documentType === 'prd') {
    const contextToUse = srsContext || discoveryContext;
    systemPrompt = `You are a Product Manager at X Spark. Based on the following context, generate a comprehensive Product Requirements Document (PRD).
Use clear numbered headings. Include: 1. Overview, 2. Problem Statement, 3. Vision, 4. Users, 5. Scope, 6. User Journeys, 7. Requirements, 8. Business Rules, 9. Data, 10. UX, 11. Non-Functional, 12. Acceptance Criteria.

CONTEXT:\n${contextToUse || 'No context provided.'}`;
    docTitle = 'Product Requirements Document - ' + (project.name || 'Project');
    docTypeLabel = 'Specification (SOW)';
  } else if (documentType === 'quotation') {
    const contextToUse = srsContext || discoveryContext;
    systemPrompt = `You are a Senior Project Manager at X Spark. Based on the context below, generate a formal Proposal with 3 TIERS: Basic, Standard, and Premium.
Use the following structure (Do not use markdown like ** or #):
PROPOSAL
Project: ${project.name || '[Project Name]'}
Client: ${clientName || '[Client Company]'}
1. COMPANY DETAILS
2. PROJECT OVERVIEW
3. PROPOSED SOLUTIONS (TIER 1: BASIC, TIER 2: STANDARD, TIER 3: PREMIUM)
4. TERMS AND CONDITIONS
5. ACCEPTANCE & SIGN-OFF

CONTEXT:\n${contextToUse}`;
    docTitle = 'Proposal (3 Options) - ' + (project.name || 'Project');
    docTypeLabel = 'Proposal';
  } else if (documentType === 'sla') {
    const contextToUse = srsContext || discoveryContext;
    systemPrompt = `You are a legal consultant at X Spark. Generate a standard Service Level Agreement (SLA) based on the context. Include Parties, Scope, SLAs, Responsibilities, Payment Terms.
CONTEXT:\n${contextToUse}`;
    docTitle = 'Service Level Agreement - ' + (project.name || 'Project');
    docTypeLabel = 'Service Agreement';
  } else if (documentType === 'prompt_md') {
    const contextToUse = prdContext || srsContext || discoveryContext;
    systemPrompt = `You are a Senior Developer at X Spark. Your task is to generate a strict System Prompt for an AI Coding Assistant to build this project.
The output must be a pure Markdown (.md) file. Do not use conversational text. Just output the markdown.
Structure:
# System Prompt: ${project.name || 'Project'}
## Role
## Tech Stack
## Database Schema
## Core Features to Build
## UI/UX Guidelines
## Step-by-Step Build Instructions

CONTEXT:\n${contextToUse}`;
    docTitle = 'Dev Prompt (.md) - ' + (project.name || 'Project');
    docTypeLabel = 'Prompt File';
  } else {
    throw new Error(`Invalid document type: ${documentType}`);
  }

  // 4. Send to Groq API (with retry on transient errors)
  const aiResponse = await withRetry(async () => {
    const res = await groqFetch('/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Generate the document now.' },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });
    return res.json();
  });
  const generatedText = aiResponse.choices?.[0]?.message?.content;

  if (!generatedText) {
    throw new Error('Groq returned empty text for document generation.');
  }

  const isPromptMd = documentType === 'prompt_md';
  const initialStatus = isPromptMd ? 'approved' : 'pending_review';

  // 5. Insert Document Head
  const { data: docData, error: docErr } = await supabaseAdmin
    .from('documents')
    .insert({
      project_id: projectId,
      title: docTitle,
      type: docTypeLabel,
      status: initialStatus,
    })
    .select('id')
    .single();

  if (docErr || !docData) {
    throw new Error(`Failed to create document record: ${docErr?.message}`);
  }

  // 6. Insert Revision #1
  const { data: revData, error: revErr } = await supabaseAdmin
    .from('document_revisions')
    .insert({
      document_id: docData.id,
      revision_no: 1,
      content: generatedText,
      ai_generated: true,
      status: initialStatus,
    })
    .select('id')
    .single();

  if (revErr || !revData) {
    throw new Error(`Failed to save document revision: ${revErr?.message}`);
  }

  // 7. Link current_revision_id on documents
  await supabaseAdmin
    .from('documents')
    .update({ current_revision_id: revData.id })
    .eq('id', docData.id);

  // 8. Record audit entry
  await supabaseAdmin.from('audit_entries').insert({
    actor_user_id: options?.actorUserId ?? null,
    action: 'document.ai_generated',
    entity_type: 'document',
    entity_id: docData.id,
    project_id: projectId,
    before_value: { status: initialStatus },
    after_value: {
      document_type: documentType,
      revision_no: 1,
      ai_model: 'Groq GPT-OSS-120B',
      status: initialStatus,
    },
  });

  return {
    documentId: docData.id,
    revisionId: revData.id,
    title: docTitle,
    type: docTypeLabel,
    content: generatedText,
  };
}

/**
 * Adapter function mandated by Part D:
 * Automatically generates both PRD and SRS document revisions for a project.
 */
export async function generatePrdAndSrs(args: {
  projectId: string;
  discoverySessionId: string;
  transcript: string;
  extracted: ExtractedClient;
}): Promise<void> {
  const context = `Meeting Transcript:\n${args.transcript}\n\nClient Name: ${args.extracted.company_name || 'N/A'}\nKey Requirements:\n${args.extracted.requirements.map((r) => `- ${r.title} (${r.priority || 'medium'})`).join('\n')}`;

  // 1. Generate SRS (Software Requirements Specification)
  await generateDocumentCore(args.projectId, 'requirements', {
    customContext: context,
  });

  // 2. Generate PRD (Product Requirements Document)
  await generateDocumentCore(args.projectId, 'prd', {
    customContext: context,
  });
}
