/**
 * Render a generated story in a real browser.
 *
 * This replaces a check that could not work: the previous validator fetched
 * `iframe.html` as text and regexed it for errors. Storybook renders
 * client-side, so that response is byte-identical whether the story exists,
 * works, or was never written — verified by md5. Nothing short of executing the
 * page can observe whether a story actually rendered.
 */

import { logger } from '../logger.js';
import type { HostTooling } from './hostTooling.js';

export interface RenderResult {
  ok: boolean;
  /** Why the render failed, when ok is false. */
  reason?: string;
  /** Uncaught page errors — invisible to the old text-fetch approach. */
  pageErrors: string[];
  /** console.error output during render. */
  consoleErrors: string[];
  /** True when Story UI's own fallback placeholder rendered instead of a story. */
  isErrorPlaceholder: boolean;
  /** Playwright Page, left open for probes. Caller must call dispose(). */
  page?: any;
  dispose: () => Promise<void>;
  navMs: number;
}

/** Text of the fallback story Story UI writes when generation fails. */
const ERROR_PLACEHOLDER_MARKERS = [
  'Story Generation Error',
  'The AI-generated story contained syntax errors',
];

export interface RenderOptions {
  storybookUrl: string;
  storyId: string;
  tooling: HostTooling;
  /** Budget for navigation + first paint. */
  timeoutMs?: number;
}

/**
 * Navigate to a story's isolated iframe URL and wait for it to actually mount.
 *
 * Waits on #storybook-root having content rather than a fixed sleep — the old
 * pipeline slept 3000ms unconditionally, which was both slower than necessary
 * and no guarantee.
 */
export async function renderStory(options: RenderOptions): Promise<RenderResult> {
  const { storybookUrl, storyId, tooling, timeoutMs = 15000 } = options;
  const started = Date.now();

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let browser: any;
  let page: any;

  const dispose = async () => {
    try { await page?.close(); } catch { /* already gone */ }
    try { await browser?.close(); } catch { /* already gone */ }
  };

  try {
    browser = await tooling.playwright.chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    page.on('pageerror', (err: Error) => pageErrors.push(err.message));
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const url = `${storybookUrl.replace(/\/+$/, '')}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Storybook mounts into #storybook-root. Waiting for non-empty content is
    // the earliest reliable signal that the story itself rendered.
    try {
      await page.waitForFunction(
        () => {
          const root = document.querySelector('#storybook-root') || document.querySelector('#root');
          return !!root && root.childElementCount > 0;
        },
        { timeout: timeoutMs },
      );
    } catch {
      await dispose();
      return {
        ok: false,
        reason: 'Story did not mount — #storybook-root stayed empty',
        pageErrors, consoleErrors, isErrorPlaceholder: false,
        dispose: async () => {}, navMs: Date.now() - started,
      };
    }

    const bodyText: string = await page.evaluate(() => document.body.innerText || '');
    const isErrorPlaceholder = ERROR_PLACEHOLDER_MARKERS.some(m => bodyText.includes(m));

    return {
      ok: true,
      pageErrors, consoleErrors, isErrorPlaceholder,
      page,
      dispose,
      navMs: Date.now() - started,
    };
  } catch (error) {
    await dispose();
    const message = error instanceof Error ? error.message : String(error);
    logger.log(`⚠️ Render failed for ${storyId}: ${message}`);
    return {
      ok: false,
      reason: message,
      pageErrors, consoleErrors, isErrorPlaceholder: false,
      dispose: async () => {}, navMs: Date.now() - started,
    };
  }
}

/**
 * Wait for a story to appear in Storybook's index.
 *
 * Polls /index.json rather than sleeping. Also the honest way to distinguish
 * "the story is broken" from "Storybook has not noticed the file yet" — a
 * distinction the panel needs, since Storybook's watcher can stop delivering
 * events entirely.
 */
export async function waitForStoryIndexed(
  storybookUrl: string,
  storyIdPrefix: string,
  timeoutMs = 10000,
  intervalMs = 250,
): Promise<{ indexed: boolean; storyId?: string }> {
  const deadline = Date.now() + timeoutMs;
  const base = storybookUrl.replace(/\/+$/, '');

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/index.json?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const index: any = await res.json();
        const entries = index?.entries ?? {};
        const match =
          Object.keys(entries).find(id => id.startsWith(`${storyIdPrefix}--`) && entries[id].type === 'story') ||
          Object.keys(entries).find(id => id.startsWith(`${storyIdPrefix}--`));
        if (match) return { indexed: true, storyId: match };
      }
    } catch {
      // Storybook may not be up yet; keep polling until the deadline.
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { indexed: false };
}
