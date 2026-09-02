/**
 * Shared HTTP helpers for LLM providers.
 *
 * All providers call their APIs with raw fetch, so rate limits (429) and
 * transient server errors (5xx) need explicit retry handling here.
 *
 * TIMEOUTS ARE WALL-CLOCK, MEASURED, AND SHARED ACROSS RETRIES. The previous
 * shape — a single fire-once `AbortSignal.timeout` handed to fetch — enforced
 * nothing this code could observe: the timer measures timer-schedulable time,
 * not wall time, and the error message printed the CONFIGURED number rather
 * than anything measured. A "timed out after 120000ms" was logged for a call
 * that had held the pipeline for 17 minutes, and the log could not contradict
 * it because elapsed was never measured. Now one `Date.now()` deadline covers
 * every attempt, every backoff sleep, and the body read; each attempt's abort
 * timer gets only the REMAINING budget; and a timeout always reports actual
 * elapsed next to the budget, so claimed and actual cannot diverge silently.
 */

import { logger } from '../logger.js';

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

export interface RetryOptions {
  /** Maximum retry attempts after the initial request (default 2). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 1000). */
  baseDelayMs?: number;
  /**
   * Hard wall-clock budget in ms for the WHOLE call — first attempt, every
   * retry, every backoff sleep, and the response body read. Checked with
   * `Date.now()` before each attempt and each sleep, and enforced mid-attempt
   * by an abort timer scoped to the remaining budget.
   */
  timeoutMs?: number;
  /**
   * External abort (e.g. a caller's phase budget). Combined with the deadline
   * for every attempt, so an in-flight request is cancelled the moment the
   * caller aborts — never retried.
   */
  signal?: AbortSignal;
}

/** An Error that provider catch-blocks recognise the same way they always have. */
function namedError(name: 'TimeoutError' | 'AbortError', message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * fetch() with exponential backoff on 429/5xx and transient network errors.
 * Honors the `retry-after` header when present. Non-retryable statuses
 * (4xx other than 408/429) are returned immediately for the caller to handle.
 *
 * When `options.timeoutMs` is set it is a hard wall-clock bound on the whole
 * call; on expiry the thrown error has `name === 'TimeoutError'` and states
 * both the budget and the ACTUAL measured elapsed time.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const timeoutMs = options.timeoutMs;
  const startedAt = Date.now();
  const deadline = timeoutMs !== undefined ? startedAt + timeoutMs : undefined;

  const timeoutError = (): Error => {
    const elapsedMs = Date.now() - startedAt;
    // Budget and measured elapsed side by side — the log line that would have
    // exposed a 120s claim against 17 minutes of wall time.
    logger.error('LLM API call exceeded its wall-clock budget', {
      url,
      budgetMs: timeoutMs,
      elapsedMs,
    });
    return namedError(
      'TimeoutError',
      `request exceeded its ${timeoutMs}ms budget (actual elapsed ${elapsedMs}ms)`,
    );
  };

  const abortError = (): Error => {
    const reason = options.signal?.reason;
    if (reason instanceof Error) return reason;
    return namedError('AbortError', 'request aborted by caller');
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) throw abortError();

    // Each attempt gets only the REMAINING budget, so retries share one
    // deadline instead of each restarting the clock.
    let attemptSignal = init.signal ?? undefined;
    if (deadline !== undefined || options.signal) {
      const parts: AbortSignal[] = [];
      if (deadline !== undefined) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw timeoutError();
        parts.push(AbortSignal.timeout(remaining));
      }
      if (options.signal) parts.push(options.signal);
      attemptSignal = parts.length === 1 ? parts[0] : AbortSignal.any(parts);
    }

    try {
      const response = await fetch(
        url,
        attemptSignal === init.signal ? init : { ...init, signal: attemptSignal },
      );

      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        return response;
      }

      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      const delay = retryAfter ?? baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random());
      // Drain the body so the connection can be reused.
      await response.text().catch(() => undefined);
      // Never sleep past the deadline — a backoff that outlives the budget is
      // the budget silently not being one.
      if (deadline !== undefined && Date.now() + delay >= deadline) throw timeoutError();
      logger.warn('LLM API request failed with retryable status, backing off', {
        url,
        status: response.status,
        attempt: attempt + 1,
        delayMs: Math.round(delay),
      });
      await sleep(delay);
    } catch (error) {
      lastError = error;
      const name = error instanceof Error ? error.name : '';
      // Our own deadline fired mid-attempt: restate it with measured elapsed
      // rather than surfacing the bare DOMException.
      if (name === 'TimeoutError') {
        throw deadline !== undefined ? timeoutError() : error;
      }
      // Caller aborts (whatever the reason's name) are never retried.
      if (name === 'AbortError' || options.signal?.aborted) {
        throw error;
      }
      if (attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random());
      if (deadline !== undefined && Date.now() + delay >= deadline) throw timeoutError();
      logger.warn('LLM API network error, retrying', {
        url,
        error: error instanceof Error ? error.message : String(error),
        attempt: attempt + 1,
        delayMs: Math.round(delay),
      });
      await sleep(delay);
    }
  }

  // Unreachable, but satisfies the compiler.
  throw lastError instanceof Error ? lastError : new Error('LLM API request failed');
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30000);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 30000);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
