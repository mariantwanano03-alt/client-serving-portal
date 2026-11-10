import { NextResponse } from 'next/server';
import { supabaseAdmin, getCallerProfile } from '@/lib/supabase-server';
import { canUploadDocuments } from '@/lib/roles';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME_TYPES = new Set(['application/pdf']);

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req.headers.get('authorization'));
    if (!caller) {
      return respond(401, { error: 'unauthorized' });
    }
    if (!caller.is_active) {
      return respond(403, { error: 'inactive_user' });
    }
    if (!canUploadDocuments(caller.role)) {
      return respond(403, { error: 'senior_or_admin_required' });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const documentId = formData.get('documentId') as string | null;
    const projectId = formData.get('projectId') as string | null;
    const documentType = formData.get('documentType') as string | null;
    const title = formData.get('title') as string | null;

    if (!file) {
      return respond(400, { error: 'file is required' });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return respond(415, { error: 'only PDF files are allowed' });
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      return respond(413, { error: 'file exceeds 20 MB limit' });
    }

    // Determine the target document
    let targetDocumentId: string;
    let targetProjectId: string;

    if (documentId) {
      targetDocumentId = documentId;
      const { data: existingDoc, error: docError } = await supabaseAdmin
        .from('documents')
        .select('id, project_id, type, title')
        .eq('id', documentId)
        .single();
      if (docError || !existingDoc) {
        return respond(404, { error: 'document not found' });
      }
      targetProjectId = existingDoc.project_id;
    } else if (projectId) {
      targetProjectId = projectId;

      const { data: newDoc, error: createErr } = await supabaseAdmin
        .from('documents')
        .insert({
          project_id: projectId,
          title: title || 'Untitled Document',
          type: documentType || null,
          status: 'draft',
        })
        .select('id')
        .single();

      if (createErr || !newDoc) {
        return respond(500, { error: 'could not create document: ' + createErr?.message });
      }
      targetDocumentId = newDoc.id;
    } else {
      return respond(400, { error: 'documentId or (projectId + title) is required' });
    }

    // Upload to storage
    const timestamp = Date.now();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-]/g, '_');
    const filePath = `documents/${targetProjectId}/${targetDocumentId}/${timestamp}-${safeFileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('document-uploads')
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      return respond(500, { error: 'upload failed: ' + uploadError.message });
    }

    // Determine next revision number
    const { data: existingRevisions } = await supabaseAdmin
      .from('document_revisions')
      .select('revision_no')
      .eq('document_id', targetDocumentId)
      .order('revision_no', { ascending: false })
      .limit(1);

    const nextRevisionNo = (existingRevisions?.[0]?.revision_no ?? 0) + 1;

    // Insert new revision
    const { data: newRevision, error: revError } = await supabaseAdmin
      .from('document_revisions')
      .insert({
        document_id: targetDocumentId,
        revision_no: nextRevisionNo,
        ai_generated: false,
        source: 'uploaded',
        storage_ref: filePath,
        uploaded_file_path: filePath,
        uploaded_file_name: file.name,
        uploaded_file_size: arrayBuffer.byteLength,
        uploaded_mime_type: file.type,
        created_by: caller.id,
        status: 'pending_review',
      })
      .select('id, revision_no')
      .single();

    if (revError || !newRevision) {
      return respond(500, { error: 'could not create revision: ' + revError?.message });
    }

    return respond(200, {
      success: true,
      revisionId: newRevision.id,
      documentId: targetDocumentId,
      revisionNo: newRevision.revision_no,
    });
  } catch (error) {
    console.error('Document upload failed:', error);
    return respond(500, { error: 'internal_error' });
  }
}

export async function GET() {
  return respond(405, { error: 'method_not_allowed' });
}
