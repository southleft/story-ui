/**
 * A story that does not render is never displayed as if it did.
 *
 * The pure parts of the canvas's "does not render" state: the verdict read
 * off a completion and off the live preview document, the one-line reason
 * (URLs to basenames, cut at 200), and the per-file record Home reads —
 * the manifest keeps verification counts, not finding ids, so a card cannot
 * otherwise tell a render failure from any other blocker.
 */

import { describe, it, expect } from 'vitest';
import {
  findRenderFailure,
  formatRenderFailureReason,
  basenameOf,
  renderFailureLine,
  readFrameStatus,
  rememberRenderFailure,
  forgetRenderFailure,
  renderFailureFor,
  readRenderFailures,
  REASON_MAX,
  DEFAULT_REASON,
  RENDER_FAILED_KEY,
  RENDER_FAILED_MAX,
  RENDER_FAILED_SKEW_MS,
  type StorageLike,
} from '../templates/StoryUIV2/renderFailure.js';
import { summarizeVerification } from '../templates/StoryUIV2/useSessions.js';
import type { VerificationFinding } from '../templates/StoryUIV2/useGeneration.js';

const finding = (id: string, severity: VerificationFinding['severity'] = 'blocker'): VerificationFinding => ({
  id, severity, class: 'code', message: `finding ${id}`,
});

describe('findRenderFailure', () => {
  it('finds the render-failed finding among others', () => {
    const f = findRenderFailure([finding('contrast', 'warning'), finding('render-failed')]);
    expect(f?.id).toBe('render-failed');
  });

  it('is null for no findings, and for other blockers', () => {
    expect(findRenderFailure(undefined)).toBeNull();
    expect(findRenderFailure([])).toBeNull();
    expect(findRenderFailure([finding('fake-field')])).toBeNull();
  });
});

describe('formatRenderFailureReason', () => {
  it('reduces a Vite module URL to the file basename, query string dropped', () => {
    const evidence =
      'TypeError: Failed to fetch dynamically imported module: http://localhost:6206/src/stories/generated/customer-table-12c7d4fb.stories.tsx?t=1756800000000';
    expect(formatRenderFailureReason(evidence)).toBe(
      'TypeError: Failed to fetch dynamically imported module: customer-table-12c7d4fb.stories.tsx',
    );
  });

  it('reduces absolute filesystem paths but leaves relative import specifiers alone', () => {
    const evidence =
      'Failed to resolve import "../../does-not-exist" from /Users/me/proj/src/stories/generated/foo.stories.tsx';
    expect(formatRenderFailureReason(evidence)).toBe(
      'Failed to resolve import "../../does-not-exist" from foo.stories.tsx',
    );
  });

  it('collapses whitespace and stack-trace line breaks to one line', () => {
    expect(formatRenderFailureReason('Error: boom\n    at render (x.js:1)\n\n  at   y')).toBe(
      'Error: boom at render (x.js:1) at y',
    );
  });

  it('cuts at REASON_MAX with an ellipsis', () => {
    const long = 'x'.repeat(REASON_MAX + 50);
    const out = formatRenderFailureReason(long);
    expect(out.length).toBe(REASON_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('falls back when the evidence is empty', () => {
    expect(formatRenderFailureReason('')).toBe(DEFAULT_REASON);
    expect(formatRenderFailureReason(undefined)).toBe(DEFAULT_REASON);
    expect(formatRenderFailureReason('   \n ', 'custom')).toBe('custom');
  });

  it('keeps the cause and leaves the page errors to the findings list', () => {
    // The verifier joins reason and page errors with " | "; the first is the
    // cause, and the one line the canvas and the chat have room for.
    const evidence = 'Story did not render at http://localhost:6101/src/a/b.tsx | ReferenceError: Foo is not defined';
    expect(formatRenderFailureReason(evidence)).toBe('Story did not render at b.tsx');
  });
});

describe('basenameOf', () => {
  it('names the file, without query or hash', () => {
    expect(basenameOf('http://localhost:6206/src/x/y.tsx?t=1#frag')).toBe('y.tsx');
    expect(basenameOf('/Users/me/proj/src/y.tsx')).toBe('y.tsx');
  });
  it('names the host for a bare origin', () => {
    expect(basenameOf('http://localhost:6206/')).toBe('localhost:6206');
  });
});

describe('renderFailureLine', () => {
  it('ends the sentence once', () => {
    expect(renderFailureLine('Foo is not defined.')).toBe('The story could not be loaded: Foo is not defined.');
    expect(renderFailureLine('Foo is not defined')).toBe('The story could not be loaded: Foo is not defined.');
  });
  it('keeps a truncation ellipsis', () => {
    expect(renderFailureLine('abc…')).toBe('The story could not be loaded: abc….');
  });
});

/* ---- the live document --------------------------------------------------- */

const doc = (classes: string[], errorMessage?: string) => ({
  body: { classList: { contains: (c: string) => classes.includes(c) } },
  querySelector: (sel: string) => (sel === '#error-message' && errorMessage !== undefined ? { textContent: errorMessage } : null),
});

describe('readFrameStatus', () => {
  it("reports Storybook's error display as failed, with the headline as the reason", () => {
    const v = readFrameStatus(doc(['sb-show-errordisplay'], 'Failed to fetch dynamically imported module: http://localhost:6206/src/s/a.stories.tsx'));
    expect(v.status).toBe('failed');
    expect(v.reason).toBe('Failed to fetch dynamically imported module: a.stories.tsx');
  });

  it('reports a rendered story as ok', () => {
    expect(readFrameStatus(doc(['sb-show-main', 'sb-main-padded'])).status).toBe('ok');
  });

  it('never calls a story that is still preparing a failure', () => {
    expect(readFrameStatus(doc(['sb-show-preparing-story'])).status).toBe('loading');
    expect(readFrameStatus(doc(['sb-show-preparing-docs'])).status).toBe('loading');
    expect(readFrameStatus(doc([])).status).toBe('loading');
    expect(readFrameStatus(doc(['sb-show-nopreview'])).status).toBe('loading');
  });

  it('is unavailable without a readable document', () => {
    expect(readFrameStatus(null).status).toBe('unavailable');
    expect(readFrameStatus({ body: null }).status).toBe('unavailable');
    expect(readFrameStatus({}).status).toBe('unavailable');
  });

  it('falls back to the default reason when the error display has no headline', () => {
    expect(readFrameStatus(doc(['sb-show-errordisplay'], '')).reason).toBe(DEFAULT_REASON);
    expect(readFrameStatus(doc(['sb-show-errordisplay'])).reason).toBe(DEFAULT_REASON);
  });
});

/* ---- the record Home reads ------------------------------------------------ */

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
};

describe('render-failure record', () => {
  const T0 = Date.parse('2026-09-02T10:00:00.000Z');

  it('remembers a failure and reports it for the same write', () => {
    const s = memoryStorage();
    rememberRenderFailure('a.stories.tsx', 'Foo is not defined', s, T0);
    // The manifest was written just before the completion arrived.
    expect(renderFailureFor('a.stories.tsx', new Date(T0 - 500).toISOString(), s)).toBe('Foo is not defined');
    // Within the skew after, too (the entry stamped a moment later).
    expect(renderFailureFor('a.stories.tsx', new Date(T0 + 2_000).toISOString(), s)).toBe('Foo is not defined');
  });

  it('retires the record once the file has been written again', () => {
    const s = memoryStorage();
    rememberRenderFailure('a.stories.tsx', 'Foo is not defined', s, T0);
    const later = new Date(T0 + RENDER_FAILED_SKEW_MS + 1_000).toISOString();
    expect(renderFailureFor('a.stories.tsx', later, s)).toBeNull();
    // Dropped on the way out, not just hidden.
    expect(readRenderFailures(s)['a.stories.tsx']).toBeUndefined();
  });

  it('forgets on request, and clears the key when nothing is left', () => {
    const s = memoryStorage();
    rememberRenderFailure('a.stories.tsx', 'x', s, T0);
    forgetRenderFailure('a.stories.tsx', s);
    expect(renderFailureFor('a.stories.tsx', undefined, s)).toBeNull();
    expect(s.data.has(RENDER_FAILED_KEY)).toBe(false);
  });

  it('answers null for unknown files, missing storage, and garbage', () => {
    const s = memoryStorage();
    expect(renderFailureFor('nope.stories.tsx', undefined, s)).toBeNull();
    expect(renderFailureFor('nope.stories.tsx', undefined, null)).toBeNull();
    s.setItem(RENDER_FAILED_KEY, '{not json');
    expect(renderFailureFor('a.stories.tsx', undefined, s)).toBeNull();
    s.setItem(RENDER_FAILED_KEY, JSON.stringify({ 'a.stories.tsx': { reason: 5 } }));
    expect(renderFailureFor('a.stories.tsx', undefined, s)).toBeNull();
  });

  it('keeps the newest records when over the cap', () => {
    const s = memoryStorage();
    for (let i = 0; i < RENDER_FAILED_MAX + 5; i++) {
      rememberRenderFailure(`f${i}.stories.tsx`, `r${i}`, s, T0 + i);
    }
    const kept = readRenderFailures(s);
    expect(Object.keys(kept).length).toBe(RENDER_FAILED_MAX);
    expect(kept['f0.stories.tsx']).toBeUndefined();
    expect(kept[`f${RENDER_FAILED_MAX + 4}.stories.tsx`]?.reason).toBe(`r${RENDER_FAILED_MAX + 4}`);
  });

  it('remembers nothing for an empty file name', () => {
    const s = memoryStorage();
    rememberRenderFailure('', 'x', s, T0);
    expect(s.data.size).toBe(0);
  });
});

/* ---- the badge ------------------------------------------------------------ */

describe('summarizeVerification', () => {
  it('marks a render failure so the badge can say so instead of counting it', () => {
    const s = summarizeVerification({
      outcome: 'issues',
      findings: [{ id: 'render-failed', severity: 'blocker', class: 'code', message: 'Story failed to render in the browser' }],
    });
    expect(s?.renderFailed).toBe(true);
    expect(s?.blockers).toBe(1);
  });

  it('leaves the flag off for every other blocker', () => {
    const s = summarizeVerification({
      outcome: 'issues',
      findings: [{ id: 'fake-field', severity: 'blocker', class: 'code', message: 'x' }],
    });
    expect(s?.renderFailed).toBeUndefined();
  });
});
