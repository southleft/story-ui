/**
 * One fetch for every call the workspace makes to the Story UI server.
 *
 * The server may require a token (STORY_UI_TOKEN). A browser page cannot read
 * server env, so the token reaches the page one of three ways, checked in
 * order: a runtime global the host sets (`window.__STORY_UI_TOKEN__`), a Vite
 * build variable (`VITE_STORY_UI_TOKEN`), or the cookie the server set when
 * the site was first opened with `?token=` — that last case needs nothing
 * from us beyond sending credentials on same-origin requests, which fetch
 * already does.
 */
export function resolveToken(): string | null {
  try {
    const w = window as unknown as { __STORY_UI_TOKEN__?: string };
    if (typeof w.__STORY_UI_TOKEN__ === 'string' && w.__STORY_UI_TOKEN__) return w.__STORY_UI_TOKEN__;
  } catch { /* no window */ }
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    if (env?.VITE_STORY_UI_TOKEN) return env.VITE_STORY_UI_TOKEN;
  } catch { /* no import.meta.env */ }
  return null;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = resolveToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
