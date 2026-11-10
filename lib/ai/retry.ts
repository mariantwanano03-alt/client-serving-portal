/**
 * Retry a function with exponential backoff + jitter.
 *
 * Retries only on transient errors:
 * - HTTP status codes: 429, 500, 502, 503, 504 (via `err.status`)
 * - Network errors / other thrown errors with no `.status` property
 *
 * Non-transient errors (400, 401, 403, 404, 422) fail immediately.
 *
 * Defaults: 3 attempts total (1 initial + 2 retries), base delay 800ms,
 * max delay 6000ms.
 *
 * Errors thrown by `fetch` have no `.status` property, so they are
 * treated as transient and retried.
 */

export type RetryOptions = {
  /** Default 3 (1 initial + 2 retries) */
  maxAttempts?: number;
  /** Default 800ms */
  baseDelayMs?: number;
  /** Default 6000ms */
  maxDelayMs?: number;
  /** Default `isTransientStatus` */
  retryOn?: (status: number) => boolean;
}

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  const maxDelayMs = opts.maxDelayMs ?? 6000;
  const retryOn = opts.retryOn ?? isTransientStatus;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      const shouldRetry = status !== undefined ? retryOn(status) : true;

      if (!shouldRetry || attempt === maxAttempts) {
        throw err;
      }

      // Exponential backoff with jitter
      const expo = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelayMs);
      const delay = Math.min(expo + jitter, maxDelayMs);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  // Unreachable — the loop either returns or throws
  throw lastErr;
}
