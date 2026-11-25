import { NextResponse } from 'next/server'
import { denyBusinessOperation, resolveCaller } from '@/lib/authz'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { canAccessProject } from '@/lib/project-access'
import { writeAudit } from '@/lib/audit'

const ALLOWED_TYPES = [
  'Requirements', 'Quotation', 'Proposal', 'Timeline', 'SLA',
  'Purchase Order', 'Invoice', 'PRD', 'SRS', 'Handover', 'Other',
]
const ALLOWED_MIME = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const MAX_BYTES = 10 * 1024 * 1024

// POST /api/documents/[id]/upload — upload an existing project document.
// Uploads always enter review; they are never marked approved automatically.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyBusinessOperation(req)
  if (denied) return denied

  const resolved = await resolveCaller(req)
  if (!resolved.caller) return resolved.response

  try {
    const { id } = await params
    const formData = await req.formData()
    const file = formData.get('file')
    const type = String(formData.get('type') || '').trim()
    const title = String(formData.get('title') || '').trim()

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Choose a document file to upload.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Documents must be 10 MB or smaller.' }, { status: 400 })
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: 'Upload a PDF, Word, text or Markdown document.' },
        { status: 400 }
      )
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Choose a supported document type.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    if (!(await canAccessProject(admin, resolved.caller.user.id, resolved.caller.role, id))) {
      return NextResponse.json({ error: 'You do not have access to this project.' }, { status: 403 })
    }

    const { data: project } = await admin
      .from('projects')
      .select('id, name, project_reference')
      .eq('id', id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    const { data: bucketName } = await admin.rpc('pts_document_bucket')
    const bucket = typeof bucketName === 'string' && bucketName ? bucketName : 'document-uploads'
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${id}/${crypto.randomUUID()}-${safeName}`

    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(storagePath, file, { contentType: file.type, upsert: false })
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const documentTitle = title || safeName
    const { data: document, error: documentError } = await admin
      .from('documents')
      .insert({ project_id: id, type, title: documentTitle, status: 'pending_review' })
      .select('id, project_id, title, type, status')
      .single()
    if (documentError || !document) {
      await admin.storage.from(bucket).remove([storagePath])
      return NextResponse.json({ error: documentError?.message || 'Could not record document.' }, { status: 500 })
    }

    const textContent = file.type.startsWith('text/') ? await file.text() : null
    const { error: revisionError } = await admin.from('document_revisions').insert({
      document_id: document.id,
      revision_no: 1,
      content: textContent,
      status: 'pending_review',
      created_by: resolved.caller.user.id,
      ai_generated: false,
      source: 'uploaded',
      storage_ref: `${bucket}/${storagePath}`,
      uploaded_file_path: storagePath,
      uploaded_file_name: safeName,
      uploaded_file_size: file.size,
      uploaded_mime_type: file.type,
    })
    if (revisionError) {
      await admin.from('documents').delete().eq('id', document.id)
      await admin.storage.from(bucket).remove([storagePath])
      return NextResponse.json({ error: revisionError.message }, { status: 500 })
    }

    await writeAudit(resolved.caller.db, {
      action: 'document.uploaded',
      entity_type: 'document',
      entity_id: document.id,
      after_value: {
        title: documentTitle,
        type,
        file_name: safeName,
        project: project.name,
        status: 'pending_review',
      },
    })

    return NextResponse.json({
      message: 'Document uploaded and submitted for review.',
      document,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not upload document.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
