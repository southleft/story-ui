/**
 * Render a generated story in a real browser.
 *
 * This replaces a check that could not work: the previous validator fetched
 * `iframe.html` as text and regexed it for errors. Storybook renders
 * client-side, so that response is byte-identical whether the story exists,
 * works, or was never written — verified by md5. Nothing short of executing the
 * page can observe whether a story actually rendered.
 */

import fs from 'fs';
import { logger } from '../logger.js';
import type { HostTooling } from './hostTooling.js';
import { currentBrowser } from './browserSession.js';

export interface RenderResult {
  ok: boolean;
  /** Why the render failed, when ok is false. */
  reason?: string;
  /**
   * WHOSE failure this was, when ok is false.
   *
   * 'code' — the page loaded and the story did not put anything on it.
   * 'infrastructure' — we never got far enough to find out: chromium would
   *   not launch, the connection was refused, the tab died. That is a fact
   *   about this machine, and blaming the story for it spends an LLM call
   *   rewriting code that was already correct.
   */
  failureClass?: 'code' | 'infrastructure';
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
/** How long a story is allowed to stay in Storybook's 'preparing' state before that is reported as infrastructure. */
const PREPARING_CAP_MS = 60_000;

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
  /**
   * A browser to render in; its lifetime is the caller's. When omitted, the
   * process-wide session browser is used if one is open (browserSession.ts),
   * else a private one is launched and closed with the page — the original
   * behaviour, for callers that never opt in.
   */
  browser?: any;
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
  let context: any;
  let page: any;
  // True only when this call launched the browser itself. A borrowed browser
  // belongs to whoever acquired it; we give back the context and nothing more.
  let ownsBrowser = false;

  const dispose = async () => {
    try { await page?.close(); } catch { /* already gone */ }
    try { await context?.close(); } catch { /* already gone */ }
    if (ownsBrowser) {
      try { await browser?.close(); } catch { /* already gone */ }
    }
  };

  try {
    browser = options.browser ?? currentBrowser();
    if (!browser) {
      browser = await tooling.playwright.chromium.launch({ headless: true });
      ownsBrowser = true;
    }
    // A fresh context per render: the isolation a new browser gave (storage,
    // cookies, no shared state) at a few milliseconds instead of a second.
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    page.on('pageerror', (err: Error) => pageErrors.push(err.message));
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const url = `${storybookUrl.replace(/\/+$/, '')}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    /**
     * Wait for the story to mount, and know WHY it has not yet.
     *
     * Storybook mounts into #storybook-root. An empty root is three
     * different situations, and they must not share a verdict:
     *
     *  - Storybook is still PREPARING the story (body carries
     *    `sb-show-preparing-story`, or its loader is on screen). A brand-new
     *    story that imports modules Vite has not seen yet can take longer
     *    than the render timeout to compile; observed: a fresh table story
     *    was reported "did not mount" after 20s and rendered in the user's
     *    own iframe ten seconds later, which cost a repair call that could
     *    only make correct code worse. Preparing is waited out to a hard cap
     *    and, past it, is an infrastructure verdict.
     *  - Storybook shows its ERROR display (`sb-show-errordisplay`): the story
     *    threw. That is the code's failure, and the message is right there.
     *  - Nothing is preparing and nothing errored, and the root is still
     *    empty at the timeout: the story rendered nothing. Code failure.
     */
    const prepareCapMs = Math.max(timeoutMs, PREPARING_CAP_MS);
    const mountStarted = Date.now();
    const isMounted = () => {
      const root = document.querySelector('#storybook-root') || document.querySelector('#root');
      return !!root && root.childElementCount > 0;
    };
    const classify = async (): Promise<{ preparing: boolean; errored: boolean; errorText: string }> => {
      try {
        const r = await page.evaluate(() => {
          const cls = document.body?.className || '';
          const errorEl = document.querySelector('#error-message, .sb-errordisplay');
          const errored = /sb-show-errordisplay/.test(cls) || (!!errorEl && (errorEl as HTMLElement).offsetParent !== null);
          const preparing = /sb-show-preparing-(story|docs)/.test(cls)
            || !!document.querySelector('.sb-preparing-story, .sb-preparing-docs, .sb-loader');
          return { preparing, errored, errorText: errored ? (errorEl?.textContent || '').trim().slice(0, 500) : '' };
        });
        return r && typeof r === 'object' ? r : { preparing: false, errored: false, errorText: '' };
      } catch {
        return { preparing: false, errored: false, errorText: '' };
      }
    };
    let mountState: 'mounted' | 'empty' | 'preparing' | 'errored' = 'empty';
    let storybookError = '';
    // First wait: the render timeout, as before.
    try {
      await page.waitForFunction(isMounted, { timeout: timeoutMs });
      mountState = 'mounted';
    } catch {
      const state = await classify();
      if (state.errored) {
        mountState = 'errored'; storybookError = state.errorText;
      } else if (state.preparing) {
        // Storybook is still compiling. Wait it out to the cap, re-checking
        // that it is still preparing rather than quietly empty.
        const remaining = prepareCapMs - (Date.now() - mountStarted);
        try {
          await page.waitForFunction(isMounted, { timeout: Math.max(1000, remaining) });
          mountState = 'mounted';
        } catch {
          const again = await classify();
          if (again.errored) { mountState = 'errored'; storybookError = again.errorText; }
          else mountState = again.preparing ? 'preparing' : 'empty';
        }
      } else {
        mountState = 'empty';
      }
    }

    if (mountState !== 'mounted') {
      await dispose();
      if (mountState === 'preparing') {
        return {
          ok: false,
          reason: `Storybook was still preparing the story after ${Math.round(prepareCapMs / 1000)}s (a cold compile of new imports, or a stalled dev server)`,
          failureClass: 'infrastructure',
          pageErrors, consoleErrors, isErrorPlaceholder: false,
          dispose: async () => {}, navMs: Date.now() - started,
        };
      }
      return {
        ok: false,
        reason: mountState === 'errored'
          ? `Storybook showed an error while rendering the story: ${storybookError || 'no message'}`
          : 'Story did not mount — #storybook-root stayed empty and Storybook was not preparing anything',
        failureClass: 'code',
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
    // Throwing out of launch/goto means we never rendered anything, so we
    // learned nothing about the story. Reported as infrastructure so it can
    // neither block nor trigger a repair: "Storybook restarted mid-run" and
    // "the generated code is broken" must not produce the same verdict.
    return {
      ok: false,
      reason: message,
      failureClass: 'infrastructure',
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
/**
 * Is Storybook's index behind the filesystem?
 *
 * "Story did not appear in the index" has two very different causes, and
 * reporting them as one thing cost three false diagnoses in a single session:
 * the story is broken, or the dev server's file watcher has died. The second
 * happens routinely on a Storybook that has been running for hours, and it is
 * not a defect in anything we generated.
 *
 * Comparing counts answers it without guessing: if more generated story files
 * exist on disk than the index knows about, the index is stale, full stop.
 * That also gives the user something actionable — restart Storybook — instead
 * of a story blamed for its host's watcher.
 */
export async function indexIsStale(
  storybookUrl: string,
  generatedDir: string,
): Promise<{ stale: boolean; onDisk: number; indexed: number }> {
  let onDisk = 0;
  try {
    onDisk = fs.readdirSync(generatedDir).filter(f => /\.stories\.[jt]sx?$/.test(f)).length;
  } catch {
    return { stale: false, onDisk: 0, indexed: 0 };
  }

  let indexed = 0;
  try {
    const res = await fetch(`${storybookUrl.replace(/\/+$/, '')}/index.json?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return { stale: false, onDisk, indexed: 0 };
    const index: any = await res.json();
    const entries = index?.entries ?? {};
    // Distinct stories, not entries: one file yields a --docs and one or more
    // story entries, so counting entries would never match a file count.
    const distinct = new Set<string>();
    for (const [id, entry] of Object.entries<any>(entries)) {
      if (typeof entry?.importPath === 'string' && entry.importPath.includes('generated')) {
        distinct.add(entry.importPath);
      } else if (String(entry?.title || '').startsWith('Generated/')) {
        distinct.add(id.replace(/--[^-]*$/, ''));
      }
    }
    indexed = distinct.size;
  } catch {
    return { stale: false, onDisk, indexed: 0 };
  }

  return { stale: onDisk > indexed, onDisk, indexed };
}

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

/**
 * Wait until the dev server has recompiled a story before judging it.
 *
 * The repair loop writes a fix, re-verifies, and keeps the result only if it
 * strictly reduces blockers. Measured, that never happened — and not because
 * the repairs were wrong. A grid fix changing `lg={12}` to `lg={16}` was
 * verified against the PREVIOUS render, reported as no improvement, and
 * discarded; probing the same story a minute later showed zero problems.
 *
 * Storybook can take longer than ten seconds to recompile, so no fixed sleep
 * is both safe and fast. Vite serves the transformed module at the source
 * path, so the honest signal is the module TEXT changing — which needs no
 * guess about what the change should look like, only that one happened.
 *
 * Returns true when the change is live, false on timeout. A timeout is not an
 * error: the caller proceeds and simply risks the stale reading it always had.
 */
export async function waitForRecompile(
  storybookUrl: string,
  /** Path relative to the project root, e.g. `src/stories/generated/x.stories.tsx`. */
  modulePath: string,
  /** Module text captured BEFORE the write. */
  previousText: string | null,
  timeoutMs = 25000,
  intervalMs = 500,
): Promise<boolean> {
  if (previousText === null) return false;
  const base = storybookUrl.replace(/\/+$/, '');
  const url = `${base}/${modulePath.replace(/^\/+/, '')}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
      if (res.ok) {
        const text = await res.text();
        if (text !== previousText) return true;
      }
    } catch {
      // Dev server busy recompiling; keep polling until the deadline.
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** The dev server's current transformed text for a module, or null. */
export async function moduleText(storybookUrl: string, modulePath: string): Promise<string | null> {
  try {
    const base = storybookUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/${modulePath.replace(/^\/+/, '')}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
