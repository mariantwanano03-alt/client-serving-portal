/**
 * Thin wrapper around fetch() for Groq API calls.
 *
 * Converts non-OK HTTP responses into a GroqError carrying the HTTP status
 * code, so retry logic can distinguish transient (429/5xx) from permanent
 * (400/401/403/404/422) failures.
 *
 * A FORCE_GROQ_429 environment variable is available for testing: when set
 * to '1', groqFetch throws a synthetic GroqError(429) without hitting the
 * network. This lets us test the retry path without exhausting quota.
 */

export class GroqError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Groq ${status}: ${body.slice(0, 500)}`);
    this.name = 'GroqError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Fetch from the Groq API, mapping non-OK responses to GroqError.
 * Respects FORCE_GROQ_429=1 for testing retry behavior without burning quota.
 */
export async function groqFetch(path: string, init: RequestInit): Promise<Response> {
  if (process.env.FORCE_GROQ_429 === '1') {
    throw new GroqError(429, 'forced by FORCE_GROQ_429 env var');
  }

  const res = await fetch(`https://api.groq.com${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GroqError(res.status, body);
  }
  return res;
}
