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
    /**
     * The browser sees "Failed to fetch dynamically imported module"; the
     * REASON is in the body of the module request Vite answered 500 to —
     * "Failed to resolve import '../../components' from …". Without it the
     * repair model is told the story did not load and left to guess why.
     */
    page.on('response', (res: any) => {
      try {
        const status = res.status();
        const url: string = res.url();
        if (status < 400 || !/\.(stories|story)\.[jt]sx?(\?|$)|\/src\//.test(url)) return;
        res.text().then((body: string) => {
          let message = body;
          try { const j = JSON.parse(body); message = j.message || j.error || body; } catch { /* html or text */ }
          message = String(message).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
          if (message) pageErrors.push(`Module request ${status} for ${url.replace(/\?.*$/, '').split('/').slice(-2).join('/')}: ${message}`);
        }).catch(() => {});
      } catch { /* a closed page */ }
    });
    page.on('console', (msg: any) => {
      if (msg.type() !== 'error') return;
      // React logs with format strings: the text is "does not recognize the
      // `%s` prop" and the prop name is an ARGUMENT. Recorded verbatim, no
      // pattern could name the prop — nine invented props on one story went
      // unflagged. Substitute the arguments the way the console would.
      let text: string = msg.text();
      try {
        const args: any[] = msg.args?.() ?? [];
        const values: string[] = [];
        for (const a of args.slice(1)) {
          const v = typeof a?.toString === 'function' ? String(a.toString()) : '';
          values.push(v.replace(/^JSHandle@/, ''));
        }
        let i = 0;
        text = text.replace(/%[sdifoOc]/g, () => (i < values.length ? values[i++] : ''));
      } catch { /* keep the raw text */ }
      consoleErrors.push(text);
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
    /**
     * The preview reloads itself while a brand-new story is being verified.
     *
     * Vite serves the new file with a full reload of the preview iframe (the
     * panel survives it via sessionStorage for the same reason), and a reload
     * that lands between two evaluate calls surfaces as "Execution context
     * was destroyed, most likely because of a navigation". Observed on a
     * modal-dialog story one second into verification: correct code,
     * reported as "could not render", and the user shown "not verified".
     * A reload is not a verdict on the story, so the mount-and-settle phase
     * is simply run again on the page that came back — twice at most.
     */
    const RELOADED = /Execution context was destroyed|because of a navigation|frame was detached/i;

    /**
     * Storybook failing to LOAD the story is not the story failing to render.
     *
     * `importers[path] is not a function` is Storybook's own story-store
     * asking its importer map for a module the preview bundle does not have
     * yet — the index knows about a file Vite has not served. Measured on
     * react-mantine: a correct dashboard was blamed for it, sent through a
     * repair that could not help, and then regenerated from scratch, three
     * minutes for a file that was fine. The same is true of a dynamic import
     * that failed to fetch and of Storybook not finding a story it just
     * indexed. None of them are defects a model can fix, and charging them to
     * the code makes the tool look broken while it rewrites correct work.
     */
    const STORYBOOK_LOADER_ERROR = /importers\[|Couldn't find story matching|Failed to fetch dynamically imported module|Unable to load story|error loading dynamically imported module/i;
    const prepareCapMs = Math.max(timeoutMs, PREPARING_CAP_MS);
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
      } catch (error) {
        if (RELOADED.test(error instanceof Error ? error.message : String(error))) throw error;
        return { preparing: false, errored: false, errorText: '' };
      }
    };
    // An object, not two `let`s: TypeScript narrows a `let` assigned inside
    // a closure to its initial literal at the use site below.
    const mount: { state: 'mounted' | 'empty' | 'preparing' | 'errored'; error: string } = { state: 'empty', error: '' };

    const mountAndSettle = async () => {
      const mountStarted = Date.now();
      mount.state = 'empty';
      mount.error = '';
      // First wait: the render timeout, as before.
      try {
        await page.waitForFunction(isMounted, { timeout: timeoutMs });
        mount.state = 'mounted';
      } catch (error) {
        if (RELOADED.test(error instanceof Error ? error.message : String(error))) throw error;
        const state = await classify();
        if (state.errored) {
          mount.state = 'errored'; mount.error = state.errorText;
        } else if (state.preparing) {
          // Storybook is still compiling. Wait it out to the cap, re-checking
          // that it is still preparing rather than quietly empty.
          const remaining = prepareCapMs - (Date.now() - mountStarted);
          try {
            await page.waitForFunction(isMounted, { timeout: Math.max(1000, remaining) });
            mount.state = 'mounted';
          } catch (again_error) {
            if (RELOADED.test(again_error instanceof Error ? again_error.message : String(again_error))) throw again_error;
            const again = await classify();
            if (again.errored) { mount.state = 'errored'; mount.error = again.errorText; }
            else mount.state = again.preparing ? 'preparing' : 'empty';
          }
        } else {
          mount.state = 'empty';
        }
      }
      if (mount.state !== 'mounted') return;

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
    };

    // A root that is empty with nothing preparing and nothing errored, on a
    // story that entered the index moments ago, is the index running ahead of
    // Storybook's story module: the same story mounts on the next load.
    // Observed three times on react-mantine — a correct file reported
    // "rendered nothing" and rewritten by a repair. One reload, then the
    // verdict stands.
    let emptyRetried = false;
    let loaderRetried = false;
    for (let reloads = 0; ; reloads++) {
      try {
        await mountAndSettle();
        if (mount.state === 'empty' && !emptyRetried) {
          emptyRetried = true;
          logger.log(`🔁 ${storyId} mounted nothing on first load; reloading once before calling it a render failure`);
          try { await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs }); } catch { /* the loop re-waits */ }
          continue;
        }
        // The module map catches up on the next load far more often than not.
        if (mount.state === 'errored' && STORYBOOK_LOADER_ERROR.test(mount.error) && !loaderRetried) {
          loaderRetried = true;
          logger.log(`🔁 Storybook could not load ${storyId}'s module on first try (${mount.error.slice(0, 80)}); reloading once`);
          try { await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs }); } catch { /* the loop re-waits */ }
          continue;
        }
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!RELOADED.test(message) || reloads >= 2) throw error;
        logger.log(`🔁 The preview reloaded while ${storyId} was rendering (Vite picked up the new file); waiting for it again`);
        try { await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }); } catch { /* the loop re-waits for the mount */ }
      }
    }

    if (mount.state !== 'mounted') {
      await dispose();
      if (mount.state === 'preparing') {
        return {
          ok: false,
          reason: `Storybook was still preparing the story after ${Math.round(prepareCapMs / 1000)}s (a cold compile of new imports, or a stalled dev server)`,
          failureClass: 'infrastructure',
          pageErrors, consoleErrors, isErrorPlaceholder: false,
          dispose: async () => {}, navMs: Date.now() - started,
        };
      }
      const loaderFailure = mount.state === 'errored' && STORYBOOK_LOADER_ERROR.test(mount.error);
      const reason = loaderFailure
        ? `Storybook could not load the story's module: ${mount.error}. Its index names the file but the preview bundle has not served it — restart Storybook if this persists. The story's code was never executed, so nothing about it was measured.`
        : mount.state === 'errored'
          ? `Storybook showed an error while rendering the story: ${mount.error || 'no message'}`
          : 'Story did not mount — #storybook-root stayed empty and Storybook was not preparing anything';
      // Always say WHY in the log. "Story failed to render in the browser"
      // with the cause only inside a finding made every diagnosis a guess.
      logger.warn(`⚠️ ${storyId} did not render: ${reason.slice(0, 220)}`);
      return {
        ok: false,
        reason,
        failureClass: loaderFailure ? 'infrastructure' : 'code',
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

  return { stale: onDisk - indexed > 1, onDisk, indexed };
}

export async function waitForStoryIndexed(
  storybookUrl: string,
  storyIdPrefix: string,
  timeoutMs = 10000,
  intervalMs = 250,
  title?: string,
  /**
   * The story's file name. When given, a title match must come from THIS
   * file: on react-mantine the title fallback matched an older story with
   * the same title, and the workspace previewed that one until the new id
   * was indexed.
   */
  fileName?: string,
): Promise<IndexLookup> {
  const deadline = Date.now() + timeoutMs;
  const base = storybookUrl.replace(/\/+$/, '');
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const candidates = [storyIdPrefix];
  if (title) candidates.push(`generated-${slug(title)}`, slug(title));

  // Whether ANY poll got an index back. Without this, a Storybook that was
  // not running and a Storybook whose watcher had died produced the same
  // `indexed: false`, and the caller told the user to restart a server that
  // was never up.
  let reachable = false;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/index.json?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''} from ${base}/index.json`;
      }
      if (res.ok) {
        reachable = true;
        const index: any = await res.json();
        const entries = index?.entries ?? {};
        const ids = Object.keys(entries);

        for (const prefix of candidates) {
          if (!prefix) continue;
          const match =
            ids.find(id => id.startsWith(`${prefix}--`) && entries[id].type === 'story') ||
            ids.find(id => id.startsWith(`${prefix}--`));
          if (match) return { indexed: true, storyId: match, reachable: true };
        }

        // Last resort: the entry's own title, which no id-derivation rule can
        // distort.
        if (title) {
          const fromThisFile = (id: string) =>
            !fileName || (typeof entries[id].importPath === 'string' && entries[id].importPath.endsWith(`/${fileName}`));
          const byTitle = ids.find(
            id => entries[id].type === 'story' &&
              typeof entries[id].title === 'string' &&
              entries[id].title.replace(/^Generated\//, '').toLowerCase() === title.toLowerCase() &&
              fromThisFile(id),
          );
          if (byTitle) return { indexed: true, storyId: byTitle, reachable: true };
        }
      }
    } catch (err) {
      // Storybook may not be up yet; keep polling until the deadline, but
      // remember why, so a server that never answered is reported as such.
      lastError = describeFetchError(err);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return reachable ? { indexed: false, reachable: true } : { indexed: false, reachable: false, error: lastError };
}

/**
 * The result of looking for a story in Storybook's index.
 *
 * `reachable: false` means no poll ever received an index — the server is
 * down, refusing connections, or answering with an error — and `error` says
 * which. `reachable: true, indexed: false` means the index answered and the
 * story was not in it. The two need opposite advice.
 */
export interface IndexLookup {
  indexed: boolean;
  storyId?: string;
  reachable: boolean;
  /** The last failure seen when unreachable, e.g. "ECONNREFUSED" or "HTTP 502". */
  error?: string;
}

/**
 * The failure behind a fetch that threw, named by its cause when there is
 * one. Node wraps a refused connection as `TypeError: fetch failed` with the
 * useful part — `ECONNREFUSED 127.0.0.1:6103` — on `cause`.
 */
export function describeFetchError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string; address?: string; port?: number } } | undefined;
  const cause = e?.cause;
  if (cause?.code) {
    const where = cause.address ? ` ${cause.address}${cause.port ? `:${cause.port}` : ''}` : '';
    return `${cause.code}${where}`;
  }
  if (cause?.message) return cause.message;
  return e?.message || String(err);
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
 * THE TIMEOUT IS 45s BECAUSE 25s WAS INSIDE THE DISTRIBUTION. Measured on the
 * Carbon fixture, invalidation after a write took 1s, 1s, 2s, 4s, 5s, 9s and
 * 15s on the same project within an hour — the same edit shape each time, the
 * spread coming from how busy the machine was. A 25s cap therefore expired on
 * ordinary slow cases, not on broken ones, and each expiry cost far more than
 * the wait: the repair was then judged against the previous render, looked
 * like no improvement, was discarded, and the gate spent 80-100s regenerating
 * a story whose repair had in fact been correct. Seven expiries in one
 * twenty-prompt run. Waiting is nearly free; regenerating is not.
 *
 * Returns the outcome, never a bare boolean, because the ways this can fail
 * are not one thing and were reported as one. `no_baseline` means the module
 * could not be read BEFORE the write, so there is nothing to compare and the
 * wait never happened; `timeout` means it was read and did not change. Both
 * used to log "Storybook did not recompile in time", which sent an
 * investigation after the dev server when the real answer was that the poll
 * had no baseline. The caller proceeds either way and simply risks the stale
 * reading it always had — but it now says which risk it is taking.
 */
export interface RecompileResult {
  live: boolean;
  reason: 'changed' | 'timeout' | 'no_baseline' | 'unreachable';
  waitedMs: number;
  /** Bytes seen before and last seen after, for a log line that can be acted on. */
  beforeBytes: number | null;
  afterBytes: number | null;
  /** HTTP status of the last poll, when one completed. */
  status?: number;
}

export async function waitForRecompile(
  storybookUrl: string,
  /** Path relative to the project root, e.g. `src/stories/generated/x.stories.tsx`. */
  modulePath: string,
  /** Module text captured BEFORE the write. */
  previousText: string | null,
  timeoutMs = 45000,
  intervalMs = 500,
): Promise<RecompileResult> {
  const started = Date.now();
  if (previousText === null) {
    return { live: false, reason: 'no_baseline', waitedMs: 0, beforeBytes: null, afterBytes: null };
  }
  const base = storybookUrl.replace(/\/+$/, '');
  const url = `${base}/${modulePath.replace(/^\/+/, '')}`;
  const deadline = started + timeoutMs;
  let afterBytes: number | null = null;
  let status: number | undefined;
  let everReached = false;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
      status = res.status;
      if (res.ok) {
        everReached = true;
        const text = await res.text();
        afterBytes = text.length;
        if (text !== previousText) {
          return { live: true, reason: 'changed', waitedMs: Date.now() - started, beforeBytes: previousText.length, afterBytes, status };
        }
      }
    } catch {
      // Dev server busy recompiling; keep polling until the deadline.
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return {
    live: false,
    reason: everReached ? 'timeout' : 'unreachable',
    waitedMs: Date.now() - started,
    beforeBytes: previousText.length,
    afterBytes,
    status,
  };
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
