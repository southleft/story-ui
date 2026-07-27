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

    /**
     * Wait for the DOM to STOP CHANGING, not merely to be non-empty.
     *
     * `childElementCount > 0` is the earliest signal that something mounted,
     * and probing there measures a story mid-render. Carbon reported two
     * accessibility blockers on correct code: a sort button whose text had not
     * arrived yet ("Buttons must have discernible text" — it reads
     * "Deployment" a moment later), and an overflow menu whose
     * `aria-labelledby` pointed at a tooltip Carbon had not rendered yet (it
     * resolves to "Options"). Both were false, and a verification system that
     * fails correct work is worse than none.
     *
     * Two consecutive identical samples, then stop. Cheap, framework-agnostic,
     * and bounded so a story with a live animation or a polling timer cannot
     * hold verification open.
     */
    const settleDeadline = Date.now() + Math.min(3000, timeoutMs);
    let previous = -1;
    let stableReadings = 0;
    while (Date.now() < settleDeadline && stableReadings < 2) {
      const signature: number = await page.evaluate(
        () => document.querySelectorAll('*').length + (document.body.innerText || '').length,
      );
      stableReadings = signature === previous ? stableReadings + 1 : 0;
      previous = signature;
      if (stableReadings < 2) await page.waitForTimeout(120);
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
  /**
   * The story's title, which is authoritative when the id is not.
   *
   * Generated stories only sometimes declare an explicit `id:` in their meta.
   * When they don't, Storybook derives the id from the title instead, so a file
   * written as `notification-settings-panel-addff419.stories.tsx` indexes as
   * `generated-notification-settings-panel`. Matching the filename slug alone
   * then never resolves, and verification reported `not_verified` for stories
   * that had rendered perfectly well.
   *
   * This mirrors waitForStory in templates/StoryUIV2/useGeneration.ts, where the
   * same mismatch left the canvas empty. Both resolvers have to agree.
   */
  title?: string,
): Promise<{ indexed: boolean; storyId?: string }> {
  const deadline = Date.now() + timeoutMs;
  const base = storybookUrl.replace(/\/+$/, '');
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const candidates = [storyIdPrefix];
  if (title) candidates.push(`generated-${slug(title)}`, slug(title));

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/index.json?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const index: any = await res.json();
        const entries = index?.entries ?? {};
        const ids = Object.keys(entries);

        for (const prefix of candidates) {
          if (!prefix) continue;
          const match =
            ids.find(id => id.startsWith(`${prefix}--`) && entries[id].type === 'story') ||
            ids.find(id => id.startsWith(`${prefix}--`));
          if (match) return { indexed: true, storyId: match };
        }

        // Last resort: the entry's own title, which no id-derivation rule can
        // distort.
        if (title) {
          const byTitle = ids.find(
            id => entries[id].type === 'story' &&
              typeof entries[id].title === 'string' &&
              entries[id].title.replace(/^Generated\//, '').toLowerCase() === title.toLowerCase(),
          );
          if (byTitle) return { indexed: true, storyId: byTitle };
        }
      }
    } catch {
      // Storybook may not be up yet; keep polling until the deadline.
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { indexed: false };
}
