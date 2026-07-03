/**
 * Shared HTTP helpers for LLM providers.
 *
 * All providers call their APIs with raw fetch, so rate limits (429) and
 * transient server errors (5xx) need explicit retry handling here.
 */

import { logger } from '../logger.js';

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

export interface RetryOptions {
  /** Maximum retry attempts after the initial request (default 2). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 1000). */
  baseDelayMs?: number;
}

/**
 * fetch() with exponential backoff on 429/5xx and transient network errors.
 * Honors the `retry-after` header when present. Non-retryable statuses
 * (4xx other than 408/429) are returned immediately for the caller to handle.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        return response;
      }

      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      const delay = retryAfter ?? baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random());
      logger.warn('LLM API request failed with retryable status, backing off', {
        url,
        status: response.status,
        attempt: attempt + 1,
        delayMs: Math.round(delay),
      });
      // Drain the body so the connection can be reused.
      await response.text().catch(() => undefined);
      await sleep(delay);
    } catch (error) {
      lastError = error;
      // Timeouts (AbortSignal) and caller aborts should not be retried;
      // transient network errors should.
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError' || attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random());
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
