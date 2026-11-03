import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  let recordId: string | null = null;

  try {
    const body = await req.json();
    const { audioUrl } = body;
    recordId = body.recordId;

    if (!audioUrl || !recordId) {
      return NextResponse.json({ error: 'Missing audioUrl or recordId' }, { status: 400 });
    }

    // 1. Extract the file path from the URL (everything after the bucket name)
    const urlParts = audioUrl.split('/discovery-media/');
    const filePath = urlParts.length > 1 ? urlParts[1] : null;
    
    if (!filePath) throw new Error('Could not parse file path from URL');

    // 2. Download the file securely using Supabase Admin
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('discovery-media')
      .download(filePath);

    if (downloadError) throw new Error(`Storage download failed: ${downloadError.message}`);
    if (!fileData) throw new Error('No file data returned from storage');

    // 3. Prepare file for Groq (Force audio/webm since the browser records in that format)
    const file = new File([fileData], 'audio.webm', { type: 'audio/webm' });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', 'whisper-large-v3-turbo');

    // 4. Send to Groq API
    console.log('Sending audio to Groq...');
    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      throw new Error(`Groq API error (${groqResponse.status}): ${errorText}`);
    }

    const transcription = await groqResponse.json();
    console.log('Groq transcription success:', transcription.text);

    // 5. Save transcript to database
    await supabaseAdmin
      .from('discovery_records')
      .update({ 
        transcript: transcription.text, 
        transcription_status: 'completed' 
      })
      .eq('id', recordId);

    return NextResponse.json({ success: true, text: transcription.text });
  } catch (error: any) {
    console.error('Transcription error:', error);
    
    if (recordId) {
      try {
        await supabaseAdmin
          .from('discovery_records')
          .update({ transcription_status: 'failed' })
          .eq('id', recordId);
      } catch (dbError) {
        console.error('Failed to update status to failed:', dbError);
      }
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}