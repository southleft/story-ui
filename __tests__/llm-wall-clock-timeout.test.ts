/**
 * The stated LLM timeout must be a HARD wall-clock bound on the whole call.
 *
 * The defect these pin: a "timed out after 120000ms" error was logged for a
 * call that had actually held the pipeline for 17 minutes. The timeout was a
 * fire-once `AbortSignal.timeout` handed to fetch — a timer, not a wall-clock
 * check — the retry loop's backoff sleeps were outside it, and the error
 * message printed the CONFIGURED number, so nothing measured could contradict
 * it. Now fetchWithRetry owns one Date.now() deadline across every attempt
 * and sleep, accepts an external abort, and always reports measured elapsed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchWithRetry } from '../story-generator/llm-providers/http-utils.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** A fetch that never resolves — it only rejects when its signal aborts. */
function installHangingFetch() {
  const spy = vi.fn((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // hangs forever — the test would time out, loudly
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

/** A fetch that instantly answers with the given status every time. */
function installStatusFetch(status: number) {
  const spy = vi.fn(async () => new Response('upstream unhappy', { status }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe('fetchWithRetry wall-clock budget', () => {
  it('bounds a hung request to the budget and reports MEASURED elapsed', async () => {
    installHangingFetch();
    const started = Date.now();

    await expect(
      fetchWithRetry('https://llm.example/v1', { method: 'POST' }, { timeoutMs: 120 }),
    ).rejects.toMatchObject({
      name: 'TimeoutError',
      message: expect.stringMatching(/120ms budget \(actual elapsed \d+ms\)/),
    });

    // Wall time, not just a claim: the whole call ended near the budget.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('shares ONE deadline across retries — backoff can never sleep past it', async () => {
    // Instant 503s invite retries; a 10s base backoff would sleep far past a
    // 150ms budget if each attempt restarted the clock.
    const spy = installStatusFetch(503);
    const started = Date.now();

    await expect(
      fetchWithRetry('https://llm.example/v1', { method: 'POST' }, {
        timeoutMs: 150,
        baseDelayMs: 10_000,
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });

    expect(Date.now() - started).toBeLessThan(2_000);
    // It tried, got a retryable status, and refused to sleep over the line.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is cancelled mid-flight by an external signal and never retried', async () => {
    const spy = installHangingFetch();
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('verification budget of 100ms exhausted')), 30);

    await expect(
      fetchWithRetry('https://llm.example/v1', { method: 'POST' }, {
        timeoutMs: 60_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow('verification budget of 100ms exhausted');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately when the external signal is already aborted', async () => {
    const spy = installHangingFetch();
    const controller = new AbortController();
    controller.abort(new Error('phase over'));

    await expect(
      fetchWithRetry('https://llm.example/v1', { method: 'POST' }, {
        timeoutMs: 60_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow('phase over');

    expect(spy).not.toHaveBeenCalled();
  });

  it('leaves a successful response untouched', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;

    const response = await fetchWithRetry('https://llm.example/v1', { method: 'POST' }, { timeoutMs: 5_000 });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('still returns non-retryable error statuses to the caller', async () => {
    installStatusFetch(400);
    const response = await fetchWithRetry('https://llm.example/v1', { method: 'POST' }, { timeoutMs: 5_000 });
    expect(response.status).toBe(400);
  });
});
