/**
 * Resolving a generated story in Storybook's index.
 *
 * This has now been the same bug twice, in two different resolvers: the panel's
 * canvas stayed empty, and verification reported `not_verified`, both for
 * stories that had rendered perfectly well. The cause in each case was assuming
 * Storybook indexes a story under the filename slug the server chose.
 *
 * It does not. A story only keeps that id if its meta declares one; otherwise
 * Storybook derives the id from the TITLE. So a file written as
 * `notification-settings-panel-addff419.stories.tsx` indexes as
 * `generated-notification-settings-panel`, and prefix matching never resolves.
 *
 * These tests pin the fallback chain so the third occurrence fails here rather
 * than in front of a user.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForStoryIndexed } from '../story-generator/verify/renderHarness.js';

const index = (entries: Record<string, any>) => ({
  ok: true,
  json: async () => ({ entries }),
});

const mockIndex = (entries: Record<string, any>) => {
  const fetchMock = vi.fn().mockResolvedValue(index(entries));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('waitForStoryIndexed', () => {
  it('resolves by the server-chosen id prefix when the meta declares one', async () => {
    mockIndex({
      'notification-settings-panel-addff419--default': { type: 'story', title: 'Generated/Notification Settings Panel' },
    });

    const result = await waitForStoryIndexed('http://localhost:6101', 'notification-settings-panel-addff419', 1000);

    expect(result).toEqual({ indexed: true, storyId: 'notification-settings-panel-addff419--default' });
  });

  it('falls back to the title-derived id when Storybook ignored the filename slug', async () => {
    // No entry starts with the filename slug — this is the case that reported
    // `not_verified` for a story that had rendered fine.
    mockIndex({
      'generated-notification-settings-panel--default': { type: 'story', title: 'Generated/Notification Settings Panel' },
    });

    const result = await waitForStoryIndexed(
      'http://localhost:6101',
      'notification-settings-panel-addff419',
      1000,
      50,
      'Notification Settings Panel',
    );

    expect(result).toEqual({ indexed: true, storyId: 'generated-notification-settings-panel--default' });
  });

  it("matches on the entry's own title when neither id shape lines up", async () => {
    // Title is authoritative: no id-derivation rule can distort it.
    mockIndex({
      'some-other-prefix--default': { type: 'story', title: 'Generated/Notification Settings Panel' },
    });

    const result = await waitForStoryIndexed(
      'http://localhost:6101',
      'notification-settings-panel-addff419',
      1000,
      50,
      'Notification Settings Panel',
    );

    expect(result).toEqual({ indexed: true, storyId: 'some-other-prefix--default' });
  });

  it('prefers a story entry over a docs entry sharing the prefix', async () => {
    mockIndex({
      'my-panel-abc123--docs': { type: 'docs', title: 'Generated/My Panel' },
      'my-panel-abc123--default': { type: 'story', title: 'Generated/My Panel' },
    });

    const result = await waitForStoryIndexed('http://localhost:6101', 'my-panel-abc123', 1000);

    expect(result.storyId).toBe('my-panel-abc123--default');
  });

  it('reports not indexed rather than guessing when nothing matches', async () => {
    // The honest answer. Returning some unrelated story here would make
    // verification report on a composition the user never asked for.
    mockIndex({
      'unrelated-story--default': { type: 'story', title: 'Generated/Unrelated' },
    });

    const result = await waitForStoryIndexed(
      'http://localhost:6101',
      'notification-settings-panel-addff419',
      400,
      50,
      'Notification Settings Panel',
    );

    expect(result).toEqual({ indexed: false });
  });

  it('keeps polling through a Storybook that is not up yet', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(index({ 'my-panel-abc123--default': { type: 'story', title: 'Generated/My Panel' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await waitForStoryIndexed('http://localhost:6101', 'my-panel-abc123', 2000, 25);

    expect(result.indexed).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
