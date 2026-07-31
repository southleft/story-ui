/**
 * Restoring a conversation from the manifest.
 *
 * The manifest is shared with the V1 panel, so its stored reply format is V1's:
 * `[SUCCESS] **Created: "Title"**` followed by the model's prose. V2 renders
 * prose directly, which made a restored conversation the one place that marker
 * appeared — the same reply read one way when generated and another way when
 * reopened.
 *
 * Presentation-only by necessity: rewriting the stored format would break V1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanReply, pollForCompletedEntry, ACTIVE_GRACE_MS } from '../templates/StoryUIV2/useSessions.js';
import {
  resolveIndexedStoryId,
  RECOVERY_WINDOW_MS,
  RECOVERY_HARD_CEILING_MS,
} from '../templates/StoryUIV2/useGeneration.js';

describe('cleanReply', () => {
  it('drops the created header, keeping the prose', () => {
    const stored = '[SUCCESS] **Created: "Dashboard Overview"**\n\nI put together a dashboard with stat tiles.';
    expect(cleanReply(stored)).toBe('I put together a dashboard with stat tiles.');
  });

  it('drops the updated header too', () => {
    const stored = '[SUCCESS] **Updated: "Dashboard Overview"**\n\nDone! The button is full width now.';
    expect(cleanReply(stored)).toBe('Done! The button is full width now.');
  });

  it('keeps failure text, dropping only the token', () => {
    // Losing the message would leave the user with a blank turn and no idea
    // what went wrong.
    expect(cleanReply('[ERROR] The model returned no code')).toBe('The model returned no code');
  });

  it('leaves a plain reply untouched', () => {
    expect(cleanReply('I added a mute switch at the top.')).toBe('I added a mute switch at the top.');
  });

  it('does not strip a bracketed phrase from the middle of a reply', () => {
    const stored = 'I used Badge for the [SUCCESS] state indicator.';
    expect(cleanReply(stored)).toBe(stored);
  });
});

describe('resolveIndexedStoryId', () => {
  const entries = {
    'dashboard-overview-ab80cbab--docs': { type: 'docs', title: 'Generated/Dashboard Overview' },
    'dashboard-overview-ab80cbab--default': { type: 'story', title: 'Generated/Dashboard Overview' },
    'generated-notification-settings-panel--default': { type: 'story', title: 'Generated/Notification Settings Panel' },
  };

  it('prefers the story entry over the docs entry', () => {
    expect(resolveIndexedStoryId(entries, 'dashboard-overview-ab80cbab'))
      .toBe('dashboard-overview-ab80cbab--default');
  });

  it('falls back to the title-derived id when the filename slug was ignored', () => {
    // Storybook derives ids from the title when the meta declares none.
    expect(resolveIndexedStoryId(entries, 'notification-settings-panel-addff419', 'Notification Settings Panel'))
      .toBe('generated-notification-settings-panel--default');
  });

  it('returns null rather than guessing when nothing matches', () => {
    // A wrong guess here would open somebody else's story in the canvas.
    expect(resolveIndexedStoryId(entries, 'nothing-like-this', 'Nothing Like This')).toBeNull();
  });
});

/**
 * The recovery poller's give-up decision.
 *
 * The base window alone was the defect: a verification-repair pass
 * legitimately ran long, the four-minute window expired, and the thread
 * showed the gave-up message for a generation that later completed fine.
 * The poller now also asks /story-ui/active-generations, and while the
 * server claims the generation it keeps waiting — up to a hard ceiling.
 */
describe('pollForCompletedEntry', () => {
  const PROMPT = 'build a settings dashboard';

  const json = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  /** A manifest entry that passes every identity and freshness test. */
  const doneEntry = () => ({
    id: 'settings-dashboard-ab12',
    fileName: 'settings-dashboard-ab12.stories.tsx',
    title: 'Settings Dashboard',
    source: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversation: [
      { role: 'user', content: PROMPT },
      { role: 'ai', content: 'Done.' },
    ],
    metadata: { prompt: PROMPT },
  });

  /**
   * Fetch stub routed on path. `manifest` is called once per poll cycle and
   * returns its next batch (last batch repeats); `active` likewise.
   */
  const serve = (manifest: unknown[][], active: Array<ReturnType<typeof json>>) => {
    let m = 0;
    let a = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/story-ui/manifest/poll')) {
        return json({ entries: manifest[Math.min(m++, manifest.length - 1)] });
      }
      if (url.includes('/story-ui/active-generations')) {
        return active[Math.min(a++, active.length - 1)];
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps polling past the base window while the server claims the generation', async () => {
    // The defect scenario: the base window has already elapsed, but the
    // server's active list still contains this prompt — so the poller must
    // wait, and return the entry when the manifest write finally lands.
    const pending = { prompt: PROMPT, fileName: null, title: null, startedAt: Date.now() - RECOVERY_WINDOW_MS - 10_000 };
    serve(
      [[], [], [doneEntry()]],
      [json({ active: [{ prompt: PROMPT, fileName: null, startedAt: pending.startedAt }] })],
    );

    const result = pollForCompletedEntry('http://x', pending);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await result)?.fileName).toBe('settings-dashboard-ab12.stories.tsx');
  });

  it('matches the active entry on fileName too, when the stash has one', async () => {
    // An update to a known file must not be kept alive by someone else's
    // generation that happens to share the prompt text.
    const pending = {
      prompt: PROMPT,
      fileName: 'settings-dashboard-ab12.stories.tsx',
      title: null,
      startedAt: Date.now() - RECOVERY_WINDOW_MS - 10_000,
    };
    serve(
      [[]],
      [json({ active: [{ prompt: PROMPT, fileName: 'other-file.stories.tsx', startedAt: pending.startedAt }] })],
    );

    const result = pollForCompletedEntry('http://x', pending);
    await vi.advanceTimersByTimeAsync(ACTIVE_GRACE_MS + 10_000);
    expect(await result).toBeNull();
  });

  it('gives up at the base window when the endpoint 404s (older server)', async () => {
    // Absence of the endpoint must not break recovery — it must merely not
    // extend it. This is exactly the pre-endpoint behaviour.
    const pending = { prompt: PROMPT, fileName: null, title: null, startedAt: Date.now() - RECOVERY_WINDOW_MS - 10_000 };
    const fetchMock = serve([[]], [json({ error: 'not found' }, 404)]);

    expect(await pollForCompletedEntry('http://x', pending)).toBeNull();
    // One manifest look and one active look — no pointless retrying of a
    // route the server does not have.
    expect(fetchMock.mock.calls.filter(([u]) => u.includes('active-generations'))).toHaveLength(1);
  });

  it('gives up past the base window when the server never claimed the generation', async () => {
    const pending = { prompt: PROMPT, fileName: null, title: null, startedAt: Date.now() - RECOVERY_WINDOW_MS - 10_000 };
    serve([[]], [json({ active: [] })]);

    expect(await pollForCompletedEntry('http://x', pending)).toBeNull();
  });

  it('grants a short grace after the active entry disappears, then gives up', async () => {
    // The manifest write lands just before the entry is removed in the
    // server's finally, so the polls inside the grace window are the ones
    // that see it. Here nothing ever lands: the poller must stop soon after
    // the claim disappears, not run to the hard ceiling.
    const pending = { prompt: PROMPT, fileName: null, title: null, startedAt: Date.now() - RECOVERY_WINDOW_MS - 10_000 };
    serve(
      [[]],
      [json({ active: [{ prompt: PROMPT, fileName: null, startedAt: pending.startedAt }] }), json({ active: [] })],
    );

    const result = pollForCompletedEntry('http://x', pending);
    let settled = false;
    result.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(settled).toBe(false); // claim just disappeared — still in grace
    await vi.advanceTimersByTimeAsync(ACTIVE_GRACE_MS + 6_000);
    expect(settled).toBe(true);
    expect(await result).toBeNull();
  });

  it('a manifest match landing inside the grace window is still returned', async () => {
    const pending = { prompt: PROMPT, fileName: null, title: null, startedAt: Date.now() - RECOVERY_WINDOW_MS - 10_000 };
    serve(
      [[], [doneEntry()]],
      [json({ active: [{ prompt: PROMPT, fileName: null, startedAt: pending.startedAt }] }), json({ active: [] })],
    );

    const result = pollForCompletedEntry('http://x', pending);
    await vi.advanceTimersByTimeAsync(6_000);
    expect((await result)?.fileName).toBe('settings-dashboard-ab12.stories.tsx');
  });

  it('never polls past the hard ceiling, active claim or not', async () => {
    const pending = { prompt: PROMPT, fileName: null, title: null, startedAt: Date.now() - RECOVERY_HARD_CEILING_MS - 1_000 };
    const fetchMock = serve(
      [[]],
      [json({ active: [{ prompt: PROMPT, fileName: null, startedAt: pending.startedAt }] })],
    );

    expect(await pollForCompletedEntry('http://x', pending)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('inside the base window, behaves exactly as before', async () => {
    const pending = { prompt: PROMPT, fileName: null, title: null, startedAt: Date.now() };
    serve([[], [doneEntry()]], [json({ active: [] })]);

    const result = pollForCompletedEntry('http://x', pending);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await result)?.fileName).toBe('settings-dashboard-ab12.stories.tsx');
  });
});
