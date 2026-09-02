/**
 * Access policy for the Story UI server.
 *
 * The server writes files into the user's repository, spends their API keys,
 * and can run git on their behalf. It shipped with no authentication and a
 * README that said to put it on a public URL. Two modes now exist and the
 * server refuses to be in neither:
 *
 *  - Loopback (default): bind 127.0.0.1 only, and reject any request whose
 *    Host header is not a loopback name, so a page a developer visits cannot
 *    reach the server through DNS rebinding. Other local origins are trusted,
 *    the same boundary Vite and Storybook themselves draw.
 *
 *  - Token: `STORY_UI_TOKEN` is set. Every API request must carry it as a
 *    bearer header, an `x-story-ui-token` header, or the cookie the server
 *    sets when a browser first arrives with `?token=`. The cookie exists so a
 *    hosted Storybook behind the proxy stays usable from a shared link.
 *
 * Public exposure (`STORYBOOK_PROXY_ENABLED`, a non-loopback `STORY_UI_HOST`,
 * or a Railway environment) without a token is refused at startup unless
 * `STORY_UI_ALLOW_UNAUTHENTICATED=true` is set deliberately.
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface AccessPolicy {
  /** Address to bind. Loopback unless the deployment asks for more. */
  host: string;
  /** Whether the server is meant to be reachable from other machines. */
  publicMode: boolean;
  /** Shared secret, when configured. */
  token: string | null;
  /** True when public mode was allowed without a token, explicitly. */
  unauthenticatedPublic: boolean;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);
const COOKIE_NAME = 'story_ui_token';

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  // Host may carry a port; IPv6 literals are bracketed.
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

function isLoopbackAddress(addr: string): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === 'localhost';
}

export function resolveAccessPolicy(env: NodeJS.ProcessEnv = process.env): AccessPolicy {
  const token = (env.STORY_UI_TOKEN || '').trim() || null;
  const requestedHost = (env.STORY_UI_HOST || '').trim();
  const proxyEnabled = env.STORYBOOK_PROXY_ENABLED === 'true';
  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);
  const publicMode = proxyEnabled || onRailway || (requestedHost !== '' && !isLoopbackAddress(requestedHost));
  const host = requestedHost || (publicMode ? '0.0.0.0' : '127.0.0.1');
  const allowUnauth = env.STORY_UI_ALLOW_UNAUTHENTICATED === 'true';

  if (publicMode && !token && !allowUnauth) {
    throw new Error(
      'Story UI is configured to be reachable from other machines ' +
        `(${proxyEnabled ? 'STORYBOOK_PROXY_ENABLED' : onRailway ? 'Railway' : `STORY_UI_HOST=${requestedHost}`}) ` +
        'but STORY_UI_TOKEN is not set. Anyone who can reach it could write files into your ' +
        'repository and spend your API keys. Set STORY_UI_TOKEN to a long random value, or set ' +
        'STORY_UI_ALLOW_UNAUTHENTICATED=true if you really mean to run it open.',
    );
  }

  return { host, publicMode, token, unauthenticatedPublic: publicMode && !token };
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function presentedToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-story-ui-token'];
  if (typeof header === 'string' && header) return header.trim();
  const cookie = readCookie(req, COOKIE_NAME);
  if (cookie) return cookie;
  return null;
}

function tokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Paths that must answer without a token: health for the platform, nothing else. */
const OPEN_PATHS = new Set(['/health']);

/**
 * Express middleware enforcing the policy. Mount before every route.
 *
 * In token mode a browser arriving at any path with `?token=` gets the cookie
 * and a redirect to the same path without it, so the secret does not sit in
 * the address bar or in Storybook's iframe URLs.
 */
export function accessControl(policy: AccessPolicy) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (OPEN_PATHS.has(req.path)) return next();

    if (policy.token) {
      const fromQuery = typeof req.query.token === 'string' ? req.query.token : null;
      if (fromQuery && req.method === 'GET') {
        if (!tokensMatch(fromQuery, policy.token)) return deny(res, 'Invalid token');
        const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.setHeader(
          'Set-Cookie',
          `${COOKIE_NAME}=${encodeURIComponent(fromQuery)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
        );
        const url = new URL(req.originalUrl, 'http://placeholder');
        url.searchParams.delete('token');
        return res.redirect(302, url.pathname + url.search);
      }
      const presented = presentedToken(req);
      if (!presented || !tokensMatch(presented, policy.token)) {
        return deny(res, 'This Story UI server requires a token. Send it as "Authorization: Bearer <token>", or open the site once with ?token=<token>.');
      }
      return next();
    }

    // No token: loopback only. The bind address already keeps other machines
    // out; the Host check keeps a rebound DNS name from reaching it through
    // the developer's own browser.
    if (!policy.unauthenticatedPublic && !isLoopbackHost(req.headers.host)) {
      return deny(res, `Story UI only answers loopback requests without a token (got Host "${req.headers.host ?? ''}"). Set STORY_UI_TOKEN to expose it.`);
    }
    return next();
  };
}

function deny(res: Response, message: string) {
  res.status(401).json({ success: false, error: message, code: 'UNAUTHORIZED' });
}

export const __test = { isLoopbackHost, presentedToken, COOKIE_NAME };
