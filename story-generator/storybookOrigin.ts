/**
 * Which Storybook is THIS request's Storybook?
 *
 * Three answers compete: the origin the panel reported (it runs inside
 * Storybook's docs iframe, so `window.location.origin` is where the user is
 * looking), `storybookMcpUrl` from story-ui.config.js (written by `init`
 * with the conventional port, and left there when the port changes), and the
 * environment's guess. The config used to win outright, so a project whose
 * Storybook had moved to another port verified — and polled the index —
 * against whatever answered on the old one: "Story did not appear in the
 * index" for a story that was indexed within seconds where the user could
 * see it.
 *
 * The panel's origin is a fact about the running session; the config is a
 * declaration that can go stale. The origin wins when the server can reach
 * it. When it cannot — a hosted deployment whose public origin is not
 * routable from the server — the configured URL stands, and the choice is
 * logged either way so a verification against the wrong Storybook is never
 * silent.
 */

export type StorybookUrlSource = 'caller' | 'configured' | 'environment' | 'none';

export interface StorybookUrlChoice {
  url: string | undefined;
  source: StorybookUrlSource;
  /** One line for the log: what was chosen over what, and why. */
  note?: string;
}

export interface ChooseStorybookUrlOptions {
  /** `window.location.origin` as the panel sent it. */
  callerOrigin?: string;
  /** `config.storybookMcpUrl`. */
  configured?: string;
  /** `getStorybookUrl()` — environment, or the conventional guess. */
  fallback?: string | null;
  /** Does `${url}/index.json` answer? Injected for tests. */
  reachable?: (url: string) => Promise<boolean>;
}

const trim = (u?: string | null) => (u ? u.replace(/\/+$/, '') : undefined);

/** GET `${url}/index.json` with a short timeout; any HTTP answer counts as reachable. */
export async function storybookAnswers(url: string, timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${trim(url)}/index.json`, { signal: controller.signal, cache: 'no-store' } as RequestInit);
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function chooseStorybookUrl(opts: ChooseStorybookUrlOptions): Promise<StorybookUrlChoice> {
  const caller = trim(opts.callerOrigin);
  const configured = trim(opts.configured);
  const fallback = trim(opts.fallback);
  const reachable = opts.reachable ?? storybookAnswers;

  if (caller && configured && caller !== configured) {
    if (await reachable(caller)) {
      return {
        url: caller,
        source: 'caller',
        note: `using the panel's own origin ${caller} over story-ui.config's storybookMcpUrl ${configured}`,
      };
    }
    return {
      url: configured,
      source: 'configured',
      note: `the panel's origin ${caller} did not answer from this server; using story-ui.config's storybookMcpUrl ${configured}`,
    };
  }
  if (caller) return { url: caller, source: 'caller' };
  if (configured) return { url: configured, source: 'configured' };
  if (fallback) return { url: fallback, source: 'environment' };
  return { url: undefined, source: 'none' };
}
