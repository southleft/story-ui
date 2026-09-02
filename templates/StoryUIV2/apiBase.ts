/**
 * Where the Story UI MCP server is.
 *
 * One resolver for both hosts of the workspace — the MDX docs page in the
 * preview iframe and the manager tab — so the two can never disagree about
 * which server they talk to.
 *
 * The first four sources are the order the MDX page has always used, kept
 * as they were: explicit edge URL from Vite env, runtime edge override, a
 * Railway deployment (same origin), then `http://localhost:<port>`.
 *
 * The port itself comes from the first of:
 *   1. `import.meta.env.VITE_STORY_UI_PORT`  — the preview (Vite) only
 *   2. `window.__STORY_UI_PORT__`             — legacy runtime override
 *   3. `window.STORY_UI_MCP_PORT`             — what the MDX wrapper sets
 *   4. `<meta name="story-ui-port" content>`  — settable from manager-head.html
 *   5. `process.env.STORYBOOK_STORY_UI_PORT`  — the one env the manager build
 *                                                actually inlines (STORYBOOK_*)
 *   6. `4001`
 *
 * The manager bundle is built by Storybook's esbuild, not the project's Vite,
 * so `import.meta.env` is empty there; 3–5 exist for that host. `import.meta`
 * is read through optional chaining everywhere because esbuild replaces it
 * with an empty object in IIFE output and vitest defines its own.
 */

type Host = {
  window?: any;
  document?: Pick<Document, 'querySelector'> | undefined;
  env?: Record<string, any> | undefined;
  processEnv?: Record<string, string | undefined> | undefined;
};

export const DEFAULT_STORY_UI_PORT = '4001';
export const PORT_META_NAME = 'story-ui-port';
export const EDGE_META_NAME = 'story-ui-edge-url';

const nonEmpty = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null;

function readMeta(document: Host['document'], name: string): string | null {
  try {
    const el = document?.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null | undefined;
    return nonEmpty(el?.content ?? null);
  } catch {
    return null;
  }
}

function currentHost(): Host {
  let env: Record<string, any> | undefined;
  try {
    // Written as the literal `import.meta.env`: Vite's dev server only
    // injects the env object into modules that contain that exact text, and
    // this file is served from node_modules, so `import.meta?.env` (what an
    // optional chain compiles to) silently read nothing and every docs page
    // pointed at port 4001. esbuild's IIFE output turns `import.meta` into an
    // empty object, so `.env` is undefined there rather than a throw.
    env = (import.meta as any).env;
  } catch {
    env = undefined;
  }
  return {
    window: typeof window !== 'undefined' ? window : undefined,
    document: typeof document !== 'undefined' ? document : undefined,
    env,
    processEnv: typeof process !== 'undefined' && process?.env ? process.env : undefined,
  };
}

/** The port alone, for hosts that need to say where they looked. */
export function resolveStoryUiPort(host: Host = currentHost()): string {
  const { window: win, document: doc, env, processEnv } = host;
  return (
    nonEmpty(env?.VITE_STORY_UI_PORT) ||
    nonEmpty(win?.__STORY_UI_PORT__) ||
    nonEmpty(win?.STORY_UI_MCP_PORT) ||
    readMeta(doc, PORT_META_NAME) ||
    nonEmpty(processEnv?.STORYBOOK_STORY_UI_PORT) ||
    DEFAULT_STORY_UI_PORT
  );
}

/** The MCP server base URL, no trailing slash. */
export function resolveApiBase(host: Host = currentHost()): string {
  const { window: win, document: doc, env, processEnv } = host;
  const fromEnv = nonEmpty(env?.VITE_STORY_UI_EDGE_URL);
  const fromWindow = nonEmpty(win?.__STORY_UI_EDGE_URL__);
  const fromMeta = readMeta(doc, EDGE_META_NAME) || nonEmpty(processEnv?.STORYBOOK_STORY_UI_EDGE_URL);
  const hostname: string = win?.location?.hostname ?? '';
  const isRailway = /up\.railway\.app$/.test(hostname);
  const base =
    fromEnv ||
    fromWindow ||
    fromMeta ||
    (isRailway ? String(win.location.origin) : `http://localhost:${resolveStoryUiPort(host)}`);
  return base.replace(/\/+$/, '');
}
