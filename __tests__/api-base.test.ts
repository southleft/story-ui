/**
 * resolveApiBase() — one resolver for both hosts of the workspace.
 *
 * The docs page (preview, Vite) and the manager page (esbuild, no Vite env)
 * must agree on which server they talk to, so the precedence is pinned here:
 *
 *   base:  VITE_STORY_UI_EDGE_URL > window.__STORY_UI_EDGE_URL__
 *          > <meta story-ui-edge-url> / STORYBOOK_STORY_UI_EDGE_URL
 *          > Railway same-origin > http://localhost:<port>
 *   port:  VITE_STORY_UI_PORT > window.__STORY_UI_PORT__ > window.STORY_UI_MCP_PORT
 *          > <meta story-ui-port> > STORYBOOK_STORY_UI_PORT > 4001
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_STORY_UI_PORT, resolveApiBase, resolveStoryUiPort } from '../templates/StoryUIV2/apiBase';

const win = (overrides: Record<string, unknown> = {}, hostname = 'localhost') => ({
  location: { hostname, origin: `https://${hostname}` },
  ...overrides,
});

const doc = (metas: Record<string, string>) => ({
  querySelector: (selector: string) => {
    const name = selector.match(/name="([^"]+)"/)?.[1] ?? '';
    return name in metas ? ({ content: metas[name] } as HTMLMetaElement) : null;
  },
});

describe('resolveApiBase', () => {
  it('defaults to localhost:4001 with nothing configured', () => {
    expect(resolveApiBase({ window: win() })).toBe(`http://localhost:${DEFAULT_STORY_UI_PORT}`);
    expect(resolveApiBase({})).toBe('http://localhost:4001');
  });

  it('prefers the Vite edge URL over everything', () => {
    expect(
      resolveApiBase({
        env: { VITE_STORY_UI_EDGE_URL: 'https://edge.example/', VITE_STORY_UI_PORT: '9999' },
        window: win({ __STORY_UI_EDGE_URL__: 'https://window.example' }, 'app.up.railway.app'),
        document: doc({ 'story-ui-edge-url': 'https://meta.example' }),
        processEnv: { STORYBOOK_STORY_UI_EDGE_URL: 'https://sb.example' },
      }),
    ).toBe('https://edge.example');
  });

  it('then the runtime window override', () => {
    expect(
      resolveApiBase({
        window: win({ __STORY_UI_EDGE_URL__: 'https://window.example' }, 'app.up.railway.app'),
        document: doc({ 'story-ui-edge-url': 'https://meta.example' }),
      }),
    ).toBe('https://window.example');
  });

  it('then a <meta name="story-ui-edge-url">, then STORYBOOK_STORY_UI_EDGE_URL (manager hosts)', () => {
    expect(
      resolveApiBase({
        window: win({}, 'app.up.railway.app'),
        document: doc({ 'story-ui-edge-url': 'https://meta.example' }),
        processEnv: { STORYBOOK_STORY_UI_EDGE_URL: 'https://sb.example' },
      }),
    ).toBe('https://meta.example');
    expect(
      resolveApiBase({
        window: win({}, 'app.up.railway.app'),
        processEnv: { STORYBOOK_STORY_UI_EDGE_URL: 'https://sb.example' },
      }),
    ).toBe('https://sb.example');
  });

  it('uses the same origin on Railway when no edge URL is given', () => {
    expect(resolveApiBase({ window: win({ __STORY_UI_PORT__: '4101' }, 'demo.up.railway.app') })).toBe(
      'https://demo.up.railway.app',
    );
  });

  it('ignores blank values rather than treating them as configured', () => {
    expect(
      resolveApiBase({
        env: { VITE_STORY_UI_EDGE_URL: '   ', VITE_STORY_UI_PORT: '' },
        window: win({ __STORY_UI_EDGE_URL__: '', __STORY_UI_PORT__: '4101' }),
      }),
    ).toBe('http://localhost:4101');
  });

  it('never returns a trailing slash', () => {
    expect(resolveApiBase({ window: win({ __STORY_UI_EDGE_URL__: 'https://a.example///' }) })).toBe('https://a.example');
  });

  it('is safe with no window or document at all (server-side / test hosts)', () => {
    expect(() => resolveApiBase({ window: undefined, document: undefined })).not.toThrow();
  });
});

describe('resolveStoryUiPort', () => {
  it('walks the port sources in order', () => {
    const all = {
      env: { VITE_STORY_UI_PORT: '1' },
      window: win({ __STORY_UI_PORT__: '2', STORY_UI_MCP_PORT: 3 }),
      document: doc({ 'story-ui-port': '4' }),
      processEnv: { STORYBOOK_STORY_UI_PORT: '5' },
    };
    expect(resolveStoryUiPort(all)).toBe('1');
    expect(resolveStoryUiPort({ ...all, env: {} })).toBe('2');
    expect(resolveStoryUiPort({ ...all, env: {}, window: win({ STORY_UI_MCP_PORT: 3 }) })).toBe('3');
    expect(resolveStoryUiPort({ ...all, env: {}, window: win() })).toBe('4');
    expect(resolveStoryUiPort({ ...all, env: {}, window: win(), document: doc({}) })).toBe('5');
    expect(resolveStoryUiPort({ env: {}, window: win(), document: doc({}), processEnv: {} })).toBe('4001');
  });

  it('feeds the port into the localhost base', () => {
    expect(resolveApiBase({ window: win(), document: doc({ 'story-ui-port': '4103' }) })).toBe('http://localhost:4103');
    expect(resolveApiBase({ window: win({ STORY_UI_MCP_PORT: 4104 }) })).toBe('http://localhost:4104');
  });
});
