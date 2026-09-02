/**
 * A Storybook that is down is not a Storybook whose watcher has died.
 *
 * waitForStoryIndexed swallowed the fetch error and returned `indexed:
 * false`; verifyStory then told the user to restart a server that was never
 * up, or said the story "did not appear in the index" — the same words a
 * story indexed on :6103 got when verification was looking at :6006. Every
 * reason now names the URL it checked, and unreachable is its own outcome.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForStoryIndexed, describeFetchError } from '../story-generator/verify/renderHarness.js';
import { classifyIndexMiss } from '../story-generator/verify/verifyStory.js';

afterEach(() => vi.unstubAllGlobals());

const refused = () => {
  const err: any = new TypeError('fetch failed');
  err.cause = { code: 'ECONNREFUSED', address: '127.0.0.1', port: 6103, message: 'connect ECONNREFUSED 127.0.0.1:6103' };
  return err;
};

describe('describeFetchError', () => {
  it('names the cause Node hides behind "fetch failed"', () => {
    expect(describeFetchError(refused())).toBe('ECONNREFUSED 127.0.0.1:6103');
  });
  it('falls back to the message when there is no cause', () => {
    expect(describeFetchError(new Error('socket hang up'))).toBe('socket hang up');
  });
});

describe('waitForStoryIndexed reachability', () => {
  it('reports unreachable, with the error, when no poll ever answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(refused()));
    const result = await waitForStoryIndexed('http://localhost:6103', 'chip-group-abc123', 120, 20);
    expect(result).toEqual({ indexed: false, reachable: false, error: 'ECONNREFUSED 127.0.0.1:6103' });
  });

  it('treats an error page as unreachable, naming the status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' }));
    const result = await waitForStoryIndexed('http://localhost:6103', 'chip-group-abc123', 120, 20);
    expect(result.reachable).toBe(false);
    expect(result.error).toBe('HTTP 502 Bad Gateway from http://localhost:6103/index.json');
  });

  it('reports reachable-but-not-indexed when the index answered without the story', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ entries: { 'other--default': { type: 'story', title: 'Generated/Other' } } }),
    }));
    const result = await waitForStoryIndexed('http://localhost:6103', 'chip-group-abc123', 120, 20);
    expect(result).toEqual({ indexed: false, reachable: true });
  });
});

describe('classifyIndexMiss', () => {
  const url = 'http://localhost:6103';
  const fresh = { stale: false, onDisk: 3, indexed: 3 };

  it('says unreachable, names the URL and the error, and never blames the watcher', () => {
    const miss = classifyIndexMiss(url, { reachable: false, error: 'ECONNREFUSED 127.0.0.1:6103' }, fresh, 'chip-group-abc123');
    expect(miss.reason).toContain('Storybook at http://localhost:6103 is not reachable');
    expect(miss.reason).toContain('ECONNREFUSED 127.0.0.1:6103');
    expect(miss.reason).not.toMatch(/watcher|Restart/i);
    expect(miss.finding.id).toBe('storybook-unreachable');
    expect(miss.finding.class).toBe('infrastructure');
    expect(miss.finding.repairable).toBe(false);
  });

  it('says stale only when the index answered with fewer stories than the disk holds', () => {
    const miss = classifyIndexMiss(url, { reachable: true }, { stale: true, onDisk: 4, indexed: 3 }, 'chip-group-abc123');
    expect(miss.finding.id).toBe('stale-index');
    expect(miss.reason).toContain('http://localhost:6103');
    expect(miss.reason).toMatch(/Restart Storybook/);
  });

  it('says not indexed, at that URL, when the index answered and the counts agree', () => {
    const miss = classifyIndexMiss(url, { reachable: true }, fresh, 'chip-group-abc123');
    expect(miss.finding.id).toBe('not-indexed');
    expect(miss.reason).toBe('Story did not appear in the index at http://localhost:6103 — it may not have been picked up yet');
  });

  it('never promotes a stale count into a diagnosis when the server was down', () => {
    // indexIsStale returns 0 indexed on a refused fetch; that must not read as a dead watcher.
    const miss = classifyIndexMiss(url, { reachable: false, error: 'ECONNREFUSED' }, { stale: true, onDisk: 4, indexed: 0 }, 'x');
    expect(miss.finding.id).toBe('storybook-unreachable');
  });
});
