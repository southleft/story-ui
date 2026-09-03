/**
 * The panel's origin names the Storybook the user is looking at; the config's
 * storybookMcpUrl is a declaration that goes stale when the port changes.
 * The origin wins when the server can reach it, and the choice is narrated.
 */
import { describe, it, expect } from 'vitest';
import { chooseStorybookUrl } from '../story-generator/storybookOrigin.js';

const answers = (ok: string[]) => async (url: string) => ok.includes(url);

describe('chooseStorybookUrl', () => {
  it('prefers the reachable caller origin over a differing configured URL, and says so', async () => {
    const c = await chooseStorybookUrl({
      callerOrigin: 'http://localhost:6116/',
      configured: 'http://localhost:6006',
      reachable: answers(['http://localhost:6116', 'http://localhost:6006']),
    });
    expect(c.url).toBe('http://localhost:6116');
    expect(c.source).toBe('caller');
    expect(c.note).toContain('6006');
  });

  it('keeps the configured URL when the caller origin does not answer from the server', async () => {
    const c = await chooseStorybookUrl({
      callerOrigin: 'https://app.example.com',
      configured: 'http://localhost:6006',
      reachable: answers(['http://localhost:6006']),
    });
    expect(c.url).toBe('http://localhost:6006');
    expect(c.source).toBe('configured');
    expect(c.note).toContain('did not answer');
  });

  it('does not probe when caller and configured agree', async () => {
    let probed = 0;
    const c = await chooseStorybookUrl({
      callerOrigin: 'http://localhost:6006',
      configured: 'http://localhost:6006/',
      reachable: async () => { probed++; return true; },
    });
    expect(c.url).toBe('http://localhost:6006');
    expect(probed).toBe(0);
  });

  it('falls through caller → configured → environment → none', async () => {
    expect((await chooseStorybookUrl({ callerOrigin: 'http://localhost:6103' })).source).toBe('caller');
    expect((await chooseStorybookUrl({ configured: 'http://localhost:6006' })).source).toBe('configured');
    expect((await chooseStorybookUrl({ fallback: 'http://localhost:6006' })).source).toBe('environment');
    expect((await chooseStorybookUrl({})).source).toBe('none');
  });
});
