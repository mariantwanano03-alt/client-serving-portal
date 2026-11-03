import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { projectId, documentType } = await req.json();

    if (!projectId || !documentType) {
      return NextResponse.json({ error: 'Missing projectId or documentType' }, { status: 400 });
    }

    // 1. Fetch Project Details
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('name, clients(name)')
      .eq('id', projectId)
      .single();

    const relatedClient = project?.clients as unknown as { name?: string } | { name?: string }[] | null;
    const clientName = Array.isArray(relatedClient)
      ? relatedClient[0]?.name
      : relatedClient?.name;

    // 2. Fetch Approved Discovery Transcripts
    const { data: discoveries } = await supabaseAdmin
      .from('discovery_records')
      .select('summary, notes, transcript')
      .eq('project_id', projectId)
      .eq('status', 'approved'); 

    if (!discoveries || discoveries.length === 0) {
      return NextResponse.json({ error: 'No approved discovery records found.' }, { status: 400 });
    }

    const discoveryContext = discoveries.map(d => 
      `Summary: ${d.summary || 'N/A'}\nNotes: ${d.notes || 'N/A'}\nTranscript: ${d.transcript || 'N/A'}`
    ).join('\n\n---\n\n');

    // 3. Fetch existing generated documents to use as context
    const { data: existingDocs } = await supabaseAdmin
      .from('documents')
      .select('title, type, document_revisions(content)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    const srsDoc = existingDocs?.find(d => d.title.includes('Software Requirements Specification'));
    const srsContext = srsDoc?.document_revisions?.[0]?.content || '';

    const prdDoc = existingDocs?.find(d => d.title.includes('Product Requirements Document'));
    const prdContext = prdDoc?.document_revisions?.[0]?.content || '';

    let systemPrompt = '';
    let docTitle = '';
    let docTypeLabel = '';
    
    if (documentType === 'requirements') {
      systemPrompt = `You are a Senior Systems Analyst at X Spark. Based on the approved discovery notes, generate a detailed Software Requirements Specification (SRS).
      Use clear numbered headings. Include: 1. System Overview, 2. Scope, 3. Assumptions, 4. Stakeholders, 5. Functional Requirements, 6. Workflow, 7. Data Requirements, 8. Acceptance Criteria, 9. Risks.`;
      docTitle = 'Software Requirements Specification - ' + (project?.name || 'Project');
      docTypeLabel = 'Specification (SOW)';

    } else if (documentType === 'prd') {
      const contextToUse = srsContext || discoveryContext;
      systemPrompt = `You are a Product Manager at X Spark. Based on the following context, generate a comprehensive Product Requirements Document (PRD).
      Use clear numbered headings. Include: 1. Overview, 2. Problem Statement, 3. Vision, 4. Users, 5. Scope, 6. User Journeys, 7. Requirements, 8. Business Rules, 9. Data, 10. UX, 11. Non-Functional, 12. Acceptance Criteria.
      
      CONTEXT:\n${contextToUse}`;
      docTitle = 'Product Requirements Document - ' + (project?.name || 'Project');
      docTypeLabel = 'Specification (SOW)';

    } else if (documentType === 'quotation') {
      const contextToUse = srsContext || discoveryContext;
      systemPrompt = `You are a Senior Project Manager at X Spark. Based on the context below, generate a formal Proposal with 3 TIERS: Basic, Standard, and Premium.
      
      Use the following structure (Do not use markdown like ** or #):
      
      PROPOSAL
      Project: ${project?.name || '[Project Name]'}
      Client: ${clientName || '[Client Company]'}
      
      1. COMPANY DETAILS
      Service Provider: X Spark (Pty) Ltd
      Address: 546 16th Road, Building 2, Constantia Park, Midrand, Johannesburg, 1685, South Africa
      
      2. PROJECT OVERVIEW
      [2-3 sentences summarizing the project from the context]
      
      3. PROPOSED SOLUTIONS
      
      TIER 1: BASIC
      Scope: [List 2-3 core features]
      Timeline: [e.g., 4 weeks]
      Total Investment: [Price in ZAR]
      
      TIER 2: STANDARD
      Scope: [List 4-5 features, including everything in Basic]
      Timeline: [e.g., 8 weeks]
      Total Investment: [Price in ZAR]
      
      TIER 3: PREMIUM
      Scope: [List 6+ features, including AI integrations, advanced security, etc.]
      Timeline: [e.g., 12 weeks]
      Total Investment: [Price in ZAR]
      
      4. TERMS AND CONDITIONS
      - Upfront Deposit: 40% upon acceptance.
      - VAT (15%) applies to all prices.
      
      5. ACCEPTANCE & SIGN-OFF
      Prepared By: Khaya Cokoto (CEO, X Spark)
      
      CONTEXT:\n${contextToUse}`;
      docTitle = 'Proposal (3 Options) - ' + (project?.name || 'Project');
      docTypeLabel = 'Proposal';

    } else if (documentType === 'sla') {
      const contextToUse = srsContext || discoveryContext;
      systemPrompt = `You are a legal consultant at X Spark. Generate a standard Service Level Agreement (SLA) based on the context. Include Parties, Scope, SLAs, Responsibilities, Payment Terms.
      CONTEXT:\n${contextToUse}`;
      docTitle = 'Service Level Agreement - ' + (project?.name || 'Project');
      docTypeLabel = 'Service Agreement';

    } else if (documentType === 'prompt_md') {
      const contextToUse = prdContext || srsContext || discoveryContext;
      systemPrompt = `You are a Senior Developer at X Spark. Your task is to generate a strict System Prompt for an AI Coding Assistant (like Claude Code or Cursor) to build this project.
      
      The output must be a pure Markdown (.md) file. Do not use conversational text. Just output the markdown.
      
      Structure the .md file like this:
      # System Prompt: ${project?.name || 'Project'}
      
      ## Role
      You are an expert Full-Stack Developer. Your task is to build the following application.
      
      ## Tech Stack
      - Next.js 14 (App Router)
      - TypeScript
      - Tailwind CSS
      - Supabase (PostgreSQL, Auth, Storage)
      
      ## Database Schema
      [Extract the entities and relationships from the context and write the SQL CREATE TABLE statements]
      
      ## Core Features to Build
      [Bullet point list of the exact features to implement]
      
      ## UI/UX Guidelines
      [Description of the UI style, layout, and components needed]
      
      ## Step-by-Step Build Instructions
      1. Initialize the Next.js app.
      2. Set up Supabase auth.
      3. Create the database tables.
      4. Build the UI components.
      5. Implement the business logic.
      
      CONTEXT:\n${contextToUse}`;
      docTitle = 'Dev Prompt (.md) - ' + (project?.name || 'Project');
      docTypeLabel = 'Prompt File';

    } else {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
    }

    // 4. Send to Groq
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate the document now.` }
        ],
        temperature: 0.3, 
        max_tokens: 4000,
      }),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      throw new Error(`Groq API error (${groqResponse.status}): ${errorText}`);
    }

    const aiResponse = await groqResponse.json();
    const generatedText = aiResponse.choices[0].message.content;

    // 5. Save Document
    const { data: docData, error: docErr } = await supabaseAdmin
      .from('documents')
      .insert({
        project_id: projectId,
        title: docTitle,
        type: docTypeLabel,
        status: documentType === 'prompt_md' ? 'approved' : 'pending_review', // .md files don't need approval
      })
      .select('id')
      .single();

    if (docErr || !docData) throw new Error('Failed to create document record: ' + docErr?.message);

    const { error: revErr } = await supabaseAdmin
      .from('document_revisions')
      .insert({
        document_id: docData.id,
        revision_no: 1,
        content: generatedText,
        ai_generated: true,
        ai_model: 'Groq GPT-OSS-120B',
        ai_model_version: 'v1',
        ai_generated_at: new Date().toISOString(),
        status: documentType === 'prompt_md' ? 'approved' : 'pending_review',
      });

    if (revErr) throw new Error('Failed to save document content: ' + revErr.message);

    return NextResponse.json({ success: true, documentId: docData.id });
  } catch (error: any) {
    console.error('AI Generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}