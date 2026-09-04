/**
 * A story that does not render.
 *
 * Two things can put Storybook's red error page in the preview: Vite cannot
 * load the story module ("Failed to fetch dynamically imported module", an
 * import that resolves to nothing) or the story throws while rendering. In
 * both cases Storybook draws its own error display in the iframe, and the
 * canvas used to present that page as the result — a red stack trace framed
 * as "here is what you asked for", then again as a thumbnail on Home.
 *
 * The rule is that the workspace never displays something that is actively
 * broken. This module holds the pure parts of honouring it:
 *
 *  - reading the verdict off a completion (`findRenderFailure`) and off the
 *    live preview document (`readFrameStatus`);
 *  - turning the harness's evidence into one calm line (`formatRenderFailureReason`);
 *  - remembering a failure for the file on Home. The manifest persists only
 *    the verification's counts, never the finding ids, so a card cannot tell
 *    a render failure from any other blocker — this client-side record is
 *    the missing bit, bounded by the entry's `updatedAt` so a repair or a
 *    regeneration retires it on its own.
 */

import type { VerificationFinding } from './useGeneration';

export const RENDER_FAILED_ID = 'render-failed';

/** The finding the verifier emits when the story never put anything on the page. */
export function findRenderFailure(
  findings: ReadonlyArray<VerificationFinding> | null | undefined,
): VerificationFinding | null {
  if (!findings) return null;
  return findings.find(f => f.id === RENDER_FAILED_ID) ?? null;
}

/** The longest reason the failed state shows. */
export const REASON_MAX = 200;

export const DEFAULT_REASON = 'Storybook could not load the story.';

const URL_RE = /\bhttps?:\/\/[^\s'")\]]+/g;
/** An absolute filesystem path with an extension: /Users/x/src/foo.stories.tsx */
const ABS_PATH_RE = /(?:^|(?<=[\s"'(:]))\/(?:[\w.@~-]+\/)+[\w.@~-]+\.\w+/g;

/** The last path segment, without a query string or fragment. */
export function basenameOf(urlOrPath: string): string {
  let s = urlOrPath;
  try {
    if (/^https?:\/\//.test(s)) {
      const u = new URL(s);
      s = u.pathname;
      // A bare origin has no file to name; the host is the honest fallback.
      if (!s || s === '/') return u.host;
    }
  } catch {
    // Not a URL after all; treat it as a path.
  }
  s = s.replace(/[?#].*$/, '');
  const segments = s.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? s;
}

/**
 * One line, for people: the verifier's evidence with every URL and absolute
 * path reduced to the file's basename, whitespace collapsed, and cut at
 * REASON_MAX. A stack trace's worth of `http://localhost:6206/src/stories/
 * generated/…?t=1725…` says nothing a basename does not, and it is what made
 * the old message unreadable.
 */
export function formatRenderFailureReason(
  evidence: string | null | undefined,
  fallback: string = DEFAULT_REASON,
): string {
  // The verifier joins the harness's reason and every page error with
  // " | ". The first is the cause; the rest are its consequences, and they
  // stay in the findings list where there is room for them.
  const primary = (evidence ?? '').split(' | ')[0] ?? '';
  let text = primary
    .replace(URL_RE, m => basenameOf(m))
    .replace(ABS_PATH_RE, m => basenameOf(m))
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  if (text.length > REASON_MAX) text = `${text.slice(0, REASON_MAX - 1).trimEnd()}…`;
  return text;
}

/**
 * Storybook's own loader failing, rather than the story failing.
 *
 * `importers[path] is not a function` is Storybook asking its importer map
 * for a module the preview bundle has not served — its index knows about the
 * file, Vite has not caught up. The composition was never executed, so
 * telling someone "this story does not render" points them at code that is
 * very likely fine; the fix is to reload, or to restart Storybook.
 */
const LOADER_FAILURE = /importers\[|Couldn't find story matching|Failed to fetch dynamically imported module|Unable to load story|error loading dynamically imported module/i;

export function isLoaderFailure(reason: string | null | undefined): boolean {
  return LOADER_FAILURE.test(reason ?? '');
}

/** The line under an assistant turn whose story did not load. */
export function renderFailureLine(reason: string): string {
  if (isLoaderFailure(reason)) {
    return 'Storybook could not load this story\u2019s module — its index has the file but the preview has not served it yet. '
      + 'The story itself was never run. Reload, and restart Storybook if it keeps happening.';
  }
  return `The story could not be loaded: ${reason.replace(/\.+$/, '')}.`;
}

/* ---- the live preview document ------------------------------------------ */

/**
 * What the preview iframe is showing right now.
 *
 *  - `failed`: Storybook's error display is up (`sb-show-errordisplay` on
 *    the body — the class its WebView sets in `showErrorDisplay`, for a
 *    module that would not load and for a story that threw alike).
 *  - `ok`: the story rendered (`sb-show-main`).
 *  - `loading`: preparing, no story yet, or a document that has not got that
 *    far. A story that is still compiling is NOT a failure, and must never
 *    be reported as one.
 *  - `unavailable`: no document to read — cross-origin, or not attached yet.
 */
export type FrameStatus = 'loading' | 'ok' | 'failed' | 'unavailable';

export interface FrameVerdict {
  status: FrameStatus;
  /** The error display's headline, formatted, when the status is `failed`. */
  reason?: string;
}

/** The slice of Document the verdict needs, so it can be tested without a DOM. */
export interface FrameDocumentLike {
  body?: { classList?: { contains(name: string): boolean } | null } | null;
  querySelector?(selector: string): { textContent?: string | null } | null;
}

export const SB_ERROR_CLASS = 'sb-show-errordisplay';
export const SB_MAIN_CLASS = 'sb-show-main';

export function readFrameStatus(doc: FrameDocumentLike | null | undefined): FrameVerdict {
  const classes = doc?.body?.classList;
  if (!classes) return { status: 'unavailable' };
  if (classes.contains(SB_ERROR_CLASS)) {
    const headline = doc?.querySelector?.('#error-message')?.textContent ?? '';
    return { status: 'failed', reason: formatRenderFailureReason(headline) };
  }
  if (classes.contains(SB_MAIN_CLASS)) return { status: 'ok' };
  return { status: 'loading' };
}

/* ---- remembering a failure for Home -------------------------------------- */

export const RENDER_FAILED_KEY = 'story-ui-v2-render-failed';

/** Records kept, oldest dropped first. Home shows a handful of cards. */
export const RENDER_FAILED_MAX = 40;

/**
 * How much later than the manifest's `updatedAt` a record may be stamped
 * and still describe that write. The server upserts the entry and then
 * emits the completion the record is taken from, so the record is normally
 * the later of the two by milliseconds; anything the pipeline does next —
 * a repair, a regeneration — moves `updatedAt` past this by whole seconds.
 */
export const RENDER_FAILED_SKEW_MS = 10_000;

export interface RenderFailureRecord {
  reason: string;
  /** When the failure was observed (ms since epoch). */
  at: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function readRenderFailures(storage: StorageLike | null = defaultStorage()): Record<string, RenderFailureRecord> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(RENDER_FAILED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, RenderFailureRecord> = {};
    for (const [file, rec] of Object.entries(parsed as Record<string, unknown>)) {
      const r = rec as Partial<RenderFailureRecord> | null;
      if (r && typeof r.reason === 'string' && typeof r.at === 'number' && Number.isFinite(r.at)) {
        out[file] = { reason: r.reason, at: r.at };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeRenderFailures(records: Record<string, RenderFailureRecord>, storage: StorageLike | null): void {
  if (!storage) return;
  try {
    const entries = Object.entries(records);
    if (entries.length === 0) {
      storage.removeItem(RENDER_FAILED_KEY);
      return;
    }
    entries.sort((a, b) => b[1].at - a[1].at);
    storage.setItem(RENDER_FAILED_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, RENDER_FAILED_MAX))));
  } catch {
    /* private mode, or quota — Home falls back to live detection */
  }
}

export function rememberRenderFailure(
  fileName: string,
  reason: string,
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now(),
): void {
  if (!fileName) return;
  const records = readRenderFailures(storage);
  records[fileName] = { reason, at: now };
  writeRenderFailures(records, storage);
}

export function forgetRenderFailure(fileName: string, storage: StorageLike | null = defaultStorage()): void {
  if (!fileName) return;
  const records = readRenderFailures(storage);
  if (!(fileName in records)) return;
  delete records[fileName];
  writeRenderFailures(records, storage);
}

/**
 * The remembered reason for a file, if the record still describes the
 * version on disk: the manifest's `updatedAt` must not be later than the
 * record (plus skew). A record the file has since moved past is dropped on
 * the way out, so a repaired story stops being marked the first time Home
 * looks at it.
 */
export function renderFailureFor(
  fileName: string | null | undefined,
  updatedAt: string | null | undefined,
  storage: StorageLike | null = defaultStorage(),
): string | null {
  if (!fileName) return null;
  const records = readRenderFailures(storage);
  const rec = records[fileName];
  if (!rec) return null;
  const updated = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isNaN(updated) && updated > rec.at + RENDER_FAILED_SKEW_MS) {
    delete records[fileName];
    writeRenderFailures(records, storage);
    return null;
  }
  return rec.reason;
}
