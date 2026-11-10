import { NextResponse } from 'next/server';
import { generateDocumentCore, type DocumentTypeKey } from '@/lib/ai/generate';

export async function POST(req: Request) {
  try {
    const { projectId, documentType } = await req.json();

    if (!projectId || !documentType) {
      return NextResponse.json({ error: 'Missing projectId or documentType' }, { status: 400 });
    }

    const result = await generateDocumentCore(projectId, documentType as DocumentTypeKey);

    return NextResponse.json({ success: true, documentId: result.documentId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown AI generation error';
    console.error('AI Generation error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
