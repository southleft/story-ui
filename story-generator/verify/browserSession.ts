/**
 * One browser per process, shared by everything that renders during a
 * generation.
 *
 * Verification used to launch a fresh Chromium for every render — the launch
 * probe, the runtime validator, verification, and each repair pass — up to six
 * per generation, each around a second of pure startup. None of those renders
 * needs its own browser; each needs its own PAGE. A browser context gives a
 * render the isolation it had (fresh storage, no shared state) for a few
 * milliseconds instead.
 *
 * Reference-counted. `acquireBrowser` launches lazily once and hands the same
 * Browser to every caller; `releaseBrowser` closes it when the last holder
 * lets go; `closeBrowserSession` closes it unconditionally, for a `finally`.
 * `warmBrowser` launches without taking a reference — the launch probe uses it
 * so the browser it proved can launch is the one the renders reuse.
 *
 * A caller that never opts in sees the old behaviour exactly: renderHarness
 * launches and closes a private browser when no session is open.
 */

import type { HostTooling } from './hostTooling.js';
import { logger } from '../logger.js';

interface Session {
  /** Shared so concurrent acquires await ONE launch rather than racing two. */
  launching: Promise<any>;
  browser: any | null;
  refs: number;
}

let session: Session | null = null;

function isConnected(browser: any): boolean {
  try {
    return typeof browser?.isConnected === 'function' ? browser.isConnected() === true : !!browser;
  } catch {
    return false;
  }
}

async function ensureLaunched(tooling: HostTooling): Promise<any> {
  if (session?.browser && !isConnected(session.browser)) {
    // Chromium crashed, or something closed it behind our back. A stale
    // handle that throws on newContext() is worse than a relaunch.
    logger.debug('Shared browser is no longer connected — relaunching');
    session = null;
  }

  if (session) return session.launching;

  const current: Session = {
    launching: tooling.playwright.chromium.launch({ headless: true }),
    browser: null,
    refs: 0,
  };
  session = current;
  try {
    current.browser = await current.launching;
  } catch (error) {
    // Leave nothing half-open: the next caller must try again, not await a
    // rejected promise forever.
    if (session === current) session = null;
    throw error;
  }
  return current.browser;
}

/**
 * The shared browser, launching it on first use. Every caller must pair this
 * with `releaseBrowser()` or rely on a `closeBrowserSession()` further out.
 */
export async function acquireBrowser(tooling: HostTooling): Promise<any> {
  const browser = await ensureLaunched(tooling);
  if (session) session.refs += 1;
  return browser;
}

/**
 * Launch the shared browser without holding a reference to it. Proves a
 * browser CAN launch and leaves it open so the proof is not thrown away; it is
 * closed by `closeBrowserSession()` or by the next acquire/release cycle
 * reaching zero holders.
 */
export async function warmBrowser(tooling: HostTooling): Promise<any> {
  return ensureLaunched(tooling);
}

/** The shared browser if one is open and alive, else null. Takes no reference. */
export function currentBrowser(): any | null {
  const browser = session?.browser;
  return browser && isConnected(browser) ? browser : null;
}

/** Drop one reference; closes the browser when the last holder releases. */
export async function releaseBrowser(): Promise<void> {
  if (!session) return;
  session.refs = Math.max(0, session.refs - 1);
  if (session.refs === 0) await closeBrowserSession();
}

/** Close the shared browser regardless of holders. Safe to call when none is open. */
export async function closeBrowserSession(): Promise<void> {
  const current = session;
  session = null;
  if (!current) return;

  let browser = current.browser;
  if (!browser) {
    try {
      browser = await current.launching;
    } catch {
      return; // never launched; nothing to close
    }
  }
  try {
    await browser.close();
  } catch {
    // already gone
  }
}
