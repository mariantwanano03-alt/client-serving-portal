import { NextResponse } from 'next/server';
import { supabaseAdmin, getCallerProfile } from '@/lib/supabase-server';
import { PDFDocument, StandardFonts } from 'pdf-lib';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req.headers.get('authorization'));
    if (!caller) {
      return respond(401, { error: 'unauthorized' });
    }
    if (!caller.is_active) {
      return respond(403, { error: 'inactive_user' });
    }

    const { searchParams } = new URL(req.url);
    const revisionId = searchParams.get('revisionId');
    if (!revisionId) {
      return respond(400, { error: 'revisionId is required' });
    }

    // Load revision + document + project
    const { data: revision, error: revError } = await supabaseAdmin
      .from('document_revisions')
      .select('id, document_id, revision_no, source, storage_ref, uploaded_file_path, uploaded_file_name, content, ai_generated')
      .eq('id', revisionId)
      .single();

    if (revError || !revision) {
      return respond(404, { error: 'revision not found' });
    }

    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .select('id, project_id, title, type, status')
      .eq('id', revision.document_id)
      .single();

    if (docError || !document) {
      return respond(404, { error: 'document not found' });
    }

    // Access check: caller must be able to view the project (staff role)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (!profile || !['senior_dev_pm', 'junior_developer', 'administrator'].includes(profile.role)) {
      return respond(403, { error: 'insufficient permissions' });
    }

    const safeTitle = (document.title || 'document').replace(/[^a-zA-Z0-9.\-]/g, '_');
    const fileName = `${safeTitle}-rev${revision.revision_no}.pdf`;

    // Case 1: Uploaded PDF — sign a short-lived URL and redirect
    if (revision.source === 'uploaded' && revision.uploaded_file_path) {
      const { data: signedData, error: signedErr } = await supabaseAdmin.storage
        .from('document-uploads')
        .createSignedUrl(revision.uploaded_file_path, 60);

      if (signedErr || !signedData?.signedUrl) {
        return respond(500, { error: 'could not generate signed download URL' });
      }

      return NextResponse.redirect(signedData.signedUrl, 302);
    }

    // Case 2: AI-generated or manual — build a PDF from content
    const content = revision.content || '';
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 11;
    const margin = 50;
    const maxWidth = page.getWidth() - 2 * margin;

    // Wrap text into lines
    const words = content.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    let y = page.getHeight() - margin;
    let currentPage = page;
    for (const line of lines) {
      if (y < margin) {
        currentPage = pdfDoc.addPage([612, 792]);
        y = currentPage.getHeight() - margin;
      }
      currentPage.drawText(line, { x: margin, y, size: fontSize, font });
      y -= fontSize * 1.5;
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': pdfBytes.length.toString(),
      },
    });
  } catch (error) {
    console.error('Document download failed:', error);
    return respond(500, { error: 'internal_error' });
  }
}

export async function POST() {
  return respond(405, { error: 'method_not_allowed' });
}
