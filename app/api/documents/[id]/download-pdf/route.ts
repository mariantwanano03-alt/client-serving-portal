import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { ALL_ROLES, requireRole } from '@/lib/authz'

function getAuthenticatedClient(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
  }
  return supabase
}

// ─── GET /api/documents/[id]/download-pdf ────────────────────────────────────
// Download a document as PDF. Generates a real PDF from the document content.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRole(
    req,
    ALL_ROLES,
    'You do not have permission to view project documents.'
  )
  if (denied) return denied
  try {
    const { id } = await params
    const client = getAuthenticatedClient(req)

    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    // Get the document and its newest revision (the editable source).
    const { data: document, error: docError } = await client
      .from('documents')
      .select('id, title, type, status, project_id, current_revision_id')
      .eq('id', id)
      .single()

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    }

    const { data: revisions } = await client
      .from('document_revisions')
      .select('id, revision_no, content, storage_ref, uploaded_file_path, uploaded_file_name, uploaded_mime_type')
      .eq('document_id', id)
      .order('revision_no', { ascending: false })

    const latestRev =
      revisions?.find((revision) => revision.id === document.current_revision_id) ||
      revisions?.[0] ||
      null
    const content = latestRev?.content || null

    // Get project and client info for filename
    const { data: project } = await client
      .from('projects')
      .select('name, client_id')
      .eq('id', document.project_id)
      .single()

    let clientName = 'Client'
    let clientCode = 'CLIENT'
    if (project?.client_id) {
      const { data: clientData } = await client
        .from('clients')
        .select('name, client_code')
        .eq('id', project.client_id)
        .single()
      if (clientData) {
        clientName = clientData.name
        clientCode = clientData.client_code
      }
    }
    const safeClientName = clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const docType = document.type?.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'document'
    const fileName = `${safeClientName}_${docType}.pdf`

    // Uploaded binary documents keep their stored file. PDFs are returned
    // directly; text/markdown files are rendered into a new PDF below.
    if (!content && latestRev?.uploaded_file_path) {
      const admin = getSupabaseAdmin()
      const bucket = latestRev.storage_ref?.split('/')[0] || 'document-uploads'
      const { data: storedFile, error: storedError } = await admin.storage
        .from(bucket)
        .download(latestRev.uploaded_file_path)
      if (storedError || !storedFile) {
        return NextResponse.json(
          { error: storedError?.message || 'Stored document could not be downloaded.' },
          { status: 500 }
        )
      }
      const mime = latestRev.uploaded_mime_type || 'application/pdf'
      const extension = mime.includes('word') ? '.docx' : '.pdf'
      return new NextResponse(await storedFile.arrayBuffer(), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Disposition': `attachment; filename="${fileName.replace(/\.pdf$/, extension)}"`,
        },
      })
    }

    if (!content) {
      return NextResponse.json({ error: 'Document has no content to download.' }, { status: 400 })
    }

    // Generate PDF using jspdf (server-side via dynamic import)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let jsPDFModule: any
    try {
      jsPDFModule = await import('jspdf')
    } catch {
      return NextResponse.json({ error: 'PDF generation library unavailable.' }, { status: 500 })
    }

    const PDFConstructor = jsPDFModule.default || jsPDFModule
    const pdf = new PDFConstructor()

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 40
    const usableWidth = pageWidth - margin * 2
    let y = margin

    const addWrappedText = (text: string, fontSize: number, fontStyle: 'normal' | 'bold' | 'italic' = 'normal') => {
      pdf.setFontSize(fontSize)
      pdf.setFont('helvetica', fontStyle)
      const lines = pdf.splitTextToSize(text, usableWidth)
      for (const line of lines) {
        if (y + fontSize > pageHeight - margin) {
          pdf.addPage()
          y = margin
        }
        pdf.text(line, margin, y)
        y += fontSize * 1.5
      }
      return y
    }

    // Header
    pdf.setFontSize(20)
    pdf.setFont('helvetica', 'bold')
    pdf.text(document.title, margin, y)
    y += 15

    pdf.setFontSize(11)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(100, 100, 100)
    pdf.text(`Client: ${clientName} (${clientCode})`, margin, y)
    y += 8
    pdf.text(`Project: ${project?.name || 'Unassigned'}`, margin, y)
    y += 8
    pdf.text(`Type: ${document.type || 'Document'}  |  Status: ${document.status}`, margin, y)
    y += 16

    // Content
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Content', margin, y)
    y += 10

    const paragraphs = content.split(/\n\n+/)
    for (const para of paragraphs) {
      const trimmed = para.trim()
      if (!trimmed) continue

      const lines = trimmed.split(/\n/)
      for (const line of lines) {
        const lineTrimmed = line.trim()
        if (!lineTrimmed) continue

        const isBullet = /^[\-\*•]\s/.test(lineTrimmed)
        const isNumbered = /^\d+\.\s/.test(lineTrimmed)
        const isHeading = /^(#{1,6}\s)|^[A-Z][A-Z\s]+:?$/.test(lineTrimmed) && lineTrimmed.length < 80

        if (isHeading) {
          y = addWrappedText(lineTrimmed.replace(/^#{1,6}\s*/, ''), 13, 'bold')
          y += 4
        } else if (isBullet || isNumbered) {
          const bulletText = isBullet ? '• ' : lineTrimmed
          y = addWrappedText(bulletText, 11, 'normal')
        } else {
          y = addWrappedText(lineTrimmed, 11, 'normal')
        }
        y += 4
      }
      y += 6
    }

    // Footer with page numbers
    const totalPages = pdf.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i)
      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(150, 150, 150)
      pdf.text(`Client Serving Portal · X Spark`, margin, pageHeight - 20)
      pdf.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 30, pageHeight - 20)
    }

    const pdfBuffer = pdf.output('arraybuffer')

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': pdfBuffer.byteLength.toString(),
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
