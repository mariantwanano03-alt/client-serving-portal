import { groqFetch } from './groq';
import { withRetry } from './retry';

export type ExtractedContact = {
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type ExtractedRequirement = {
  title: string;
  priority?: 'high' | 'medium' | 'low';
};

export type ExtractedClient = {
  company_name: string | null;
  email: string | null;
  phone: string | null;
  primary_contact: string | null;
  billing_details: string | null;
  contacts: ExtractedContact[];
  requirements: ExtractedRequirement[];
};

export async function extractClientFromTranscript(transcript: string): Promise<ExtractedClient> {
  const systemPrompt = `You are an expert business analyst and information extractor.
Analyze the following meeting transcript and extract structured information about the client organization, key stakeholders, and project requirements.

Return a JSON object conforming STRICTLY to this structure:
{
  "company_name": string | null,
  "email": string | null,
  "phone": string | null,
  "primary_contact": string | null,
  "billing_details": string | null,
  "contacts": [
    {
      "name": string,
      "role": string | null,
      "email": string | null,
      "phone": string | null
    }
  ],
  "requirements": [
    {
      "title": string,
      "priority": "high" | "medium" | "low"
    }
  ]
}

STRICT INSTRUCTIONS:
- If a field is not clearly stated in the transcript, return null.
- Do not guess or infer company names from greetings, informal banter, or general terms.
- Only include contacts whose names are explicitly mentioned in the text.
- Extract concrete functional or business requirements discussed in the meeting. For priority, default to "medium" unless specified as urgent, high, or nice-to-have.
- You must return valid JSON only.`;

  const json = await withRetry(async () => {
    const res = await groqFetch('/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `TRANSCRIPT:\n${transcript}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });
    return res.json();
  });
  const rawContent = json.choices?.[0]?.message?.content;

  if (!rawContent) {
    throw new Error('Groq returned empty extraction content.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: unknown) {
    throw new Error(`Failed to parse extraction JSON: ${err instanceof Error ? err.message : 'Invalid JSON'}`);
  }

  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  const cleanStringOrNull = (val: unknown): string | null => {
    if (typeof val === 'string' && val.trim().length > 0 && val.trim().toLowerCase() !== 'null') {
      return val.trim();
    }
    return null;
  };

  const contactsRaw = Array.isArray(obj.contacts) ? obj.contacts : [];
  const contacts: ExtractedContact[] = contactsRaw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof c.name === 'string' && c.name.trim().length > 0)
    .map((c) => ({
      name: (c.name as string).trim(),
      role: cleanStringOrNull(c.role),
      email: cleanStringOrNull(c.email),
      phone: cleanStringOrNull(c.phone),
    }));

  const requirementsRaw = Array.isArray(obj.requirements) ? obj.requirements : [];
  const requirements: ExtractedRequirement[] = requirementsRaw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && typeof r.title === 'string' && r.title.trim().length > 0)
    .map((r) => {
      let priority: 'high' | 'medium' | 'low' = 'medium';
      if (typeof r.priority === 'string') {
        const p = r.priority.toLowerCase();
        if (p === 'high' || p === 'medium' || p === 'low') {
          priority = p;
        }
      }
      return {
        title: (r.title as string).trim(),
        priority,
      };
    });

  return {
    company_name: cleanStringOrNull(obj.company_name),
    email: cleanStringOrNull(obj.email),
    phone: cleanStringOrNull(obj.phone),
    primary_contact: cleanStringOrNull(obj.primary_contact),
    billing_details: cleanStringOrNull(obj.billing_details),
    contacts,
    requirements,
  };
}
