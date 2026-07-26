/**
 * Resolve verification tooling from the HOST project rather than shipping it.
 *
 * Storybook already installs Playwright and axe-core into any project using the
 * a11y or vitest addons, so verification costs the user zero new dependencies
 * and always matches the browser their own tests run against. Story UI's own
 * dependency list must never grow to support this.
 *
 * Every resolution failure returns null and is reported honestly as
 * "not verified". Silently downgrading to a weaker check is how the previous
 * runtime validator ended up reporting success unconditionally.
 */

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger.js';

export interface HostTooling {
  /** Playwright's module namespace, loaded from the host project. */
  playwright: any;
  /** Absolute path to axe-core's minified bundle, for page injection. */
  axePath: string | null;
  /** Where resolution was anchored, for diagnostics. */
  resolvedFrom: string;
}

let cached: { key: string; value: HostTooling | null } | undefined;

/**
 * Anchor resolution at the project's package.json so we walk the HOST's
 * node_modules, not Story UI's.
 */
function anchorFor(projectRoot: string): string | null {
  const pkg = path.join(projectRoot, 'package.json');
  return fs.existsSync(pkg) ? pkg : null;
}

/**
 * Resolve Playwright and axe-core from the host project.
 * Returns null when the project cannot support browser verification.
 */
export function resolveHostTooling(projectRoot: string = process.cwd()): HostTooling | null {
  const key = path.resolve(projectRoot);
  if (cached && cached.key === key) return cached.value;

  const result = (() => {
    const anchor = anchorFor(key);
    if (!anchor) {
      logger.log(`⚠️ Verification unavailable: no package.json at ${key}`);
      return null;
    }

    const req = createRequire(anchor);

    let playwright: any;
    try {
      playwright = req('playwright');
    } catch {
      // playwright-core is what some Storybook setups pull in; it exposes the
      // same launch API and is equally usable for our purposes.
      try {
        playwright = req('playwright-core');
      } catch {
        logger.log('⚠️ Verification unavailable: playwright is not installed in this project');
        return null;
      }
    }

    let axePath: string | null = null;
    try {
      axePath = req.resolve('axe-core/axe.min.js');
    } catch {
      try {
        // Some versions only expose the unminified entry.
        axePath = req.resolve('axe-core');
      } catch {
        // Accessibility probing degrades; rendering checks still work.
        logger.log('ℹ️ axe-core not resolvable — accessibility checks will be skipped');
      }
    }

    return { playwright, axePath, resolvedFrom: anchor };
  })();

  cached = { key, value: result };
  if (result) {
    logger.log(`🔍 Verification tooling resolved from ${path.dirname(result.resolvedFrom)}`);
  }
  return result;
}

/**
 * Confirm a browser can actually launch. Playwright resolving does not mean its
 * browser binaries were downloaded, and that failure must surface as
 * "not verified" rather than as a defect in the user's story.
 */
export async function canLaunchBrowser(tooling: HostTooling): Promise<{ ok: boolean; error?: string }> {
  try {
    const browser = await tooling.playwright.chromium.launch({ headless: true });
    await browser.close();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/** Test seam. */
export function __resetHostToolingCache(): void {
  cached = undefined;
}
