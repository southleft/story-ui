/**
 * Route the server's outbound HTTP through a corporate proxy when one is set.
 *
 * Every LLM provider calls its API with Node's built-in fetch, which ignores
 * HTTPS_PROXY / HTTP_PROXY. Behind a proxy-only network every generation
 * therefore failed with a connection error that named the provider, not the
 * proxy. Installing undici's EnvHttpProxyAgent as the global dispatcher
 * routes all of that fetch traffic through the proxy, honouring NO_PROXY.
 *
 * undici 7, not 6: measured against a local CONNECT proxy, an undici 6
 * dispatcher is silently ignored by Node 26's fetch — every request goes
 * direct and nothing errors. 7 is honoured on Node 20 through 26.
 *
 * Loopback is always exempt. The server calls its own Storybook and index on
 * localhost; sent to a corporate proxy those fail, and a user setting
 * HTTPS_PROXY for the LLM call should not have to know that.
 *
 * The decision is logged either way, so "proxy active" and "no proxy" are
 * distinguishable after the fact — an enterprise user debugging a blocked
 * call needs to know which one the server did.
 */

import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { logger } from './logger.js';

const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

export interface ProxySettings {
  httpProxy?: string;
  httpsProxy?: string;
  /** Comma-separated, as NO_PROXY is written; always includes loopback. */
  noProxy: string;
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name] ?? env[name.toLowerCase()];
  return value?.trim() || undefined;
}

/** Proxy settings from the environment, or null when no proxy is set. */
export function resolveProxySettings(env: NodeJS.ProcessEnv = process.env): ProxySettings | null {
  const httpProxy = read(env, 'HTTP_PROXY');
  // HTTPS traffic falls back to HTTP_PROXY, as curl and most tools do.
  const httpsProxy = read(env, 'HTTPS_PROXY') ?? httpProxy;
  if (!httpProxy && !httpsProxy) return null;

  const declared = (read(env, 'NO_PROXY') ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  const noProxy = [...new Set([...declared, ...LOOPBACK])].join(',');
  return { httpProxy, httpsProxy, noProxy };
}

/** A proxy URL with any credentials replaced, safe to log. */
export function redactProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '(unparseable proxy URL)';
  }
}

/** Install the proxy dispatcher once at startup. Returns whether one was installed. */
export function installOutboundProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  const settings = resolveProxySettings(env);
  if (!settings) {
    logger.debug('Outbound proxy: none (HTTPS_PROXY / HTTP_PROXY unset), connecting directly');
    return false;
  }
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent(settings));
  } catch (err) {
    // A malformed proxy URL must not take the server down; say so loudly.
    logger.warn(`Outbound proxy NOT installed, connecting directly: ${(err as Error).message}`);
    return false;
  }
  const via = settings.httpsProxy ?? settings.httpProxy!;
  logger.info(`Outbound proxy: ${redactProxyUrl(via)} (bypassing: ${settings.noProxy})`);
  return true;
}
