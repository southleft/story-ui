/**
 * Render a generated story in the host project's own Playwright and save a
 * PNG, so a human can look at what the numbers describe.
 *
 * Reuses the engine's render harness from dist/ (it waits for the DOM to
 * STOP changing, not merely to be non-empty) with tooling resolved from the
 * HOST project, exactly as verification does. If dist is not built the
 * fallback drives Playwright directly from the project's node_modules.
 *
 * Every failure is reported as `{ taken: false, reason }` — a missing PNG must
 * never read as "the story rendered nothing".
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const dist = (root, rel) => pathToFileURL(path.join(root, 'dist', rel)).href;

/**
 * The full story id for a generated file, from Storybook's index.
 *
 * The completion carries `storybookId` (the component prefix) and
 * `fileName`; the index knows the rest. Matching on importPath is
 * authoritative; the prefix and the title are fallbacks for an index that
 * has not caught up yet.
 */
export async function resolveStoryId(storybook, { fileName, storybookId, title }, timeoutMs = 20_000) {
  const base = storybook.replace(/\/+$/, '');
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let indexed = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/index.json?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const index = await res.json();
        const entries = Object.values(index?.entries ?? {});
        indexed = entries.length;
        const stories = entries.filter(e => e?.type === 'story');
        const byFile = fileName ? stories.find(e => typeof e.importPath === 'string' && e.importPath.endsWith('/' + fileName)) : null;
        if (byFile) return { storyId: byFile.id, matchedBy: 'importPath' };
        const byPrefix = storybookId ? stories.find(e => e.id.startsWith(storybookId + '--')) : null;
        if (byPrefix) return { storyId: byPrefix.id, matchedBy: 'storybookId' };
        const byTitle = title ? stories.find(e => e.title === title) : null;
        if (byTitle) return { storyId: byTitle.id, matchedBy: 'title' };
      } else {
        lastError = `index.json HTTP ${res.status}`;
      }
    } catch (e) {
      lastError = e?.message || String(e);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { storyId: null, reason: `not in Storybook's index after ${timeoutMs}ms (${indexed} entries indexed${lastError ? `; last error: ${lastError}` : ''})` };
}

export async function screenshotStory({ storyUiRoot, project, storybook, storyId, outPath, timeoutMs = 30_000 }) {
  // Preferred: the engine's own harness, with host tooling.
  try {
    const { resolveHostTooling } = await import(dist(storyUiRoot, 'story-generator/verify/hostTooling.js'));
    const { renderStory } = await import(dist(storyUiRoot, 'story-generator/verify/renderHarness.js'));
    const tooling = resolveHostTooling(project);
    if (!tooling) return { taken: false, reason: `playwright not resolvable from ${project}` };
    const r = await renderStory({ storybookUrl: storybook, storyId, tooling, timeoutMs });
    let taken = false;
    if (r.page) {
      try {
        await r.page.screenshot({ path: outPath, fullPage: true });
        taken = true;
      } catch (e) {
        await r.dispose();
        return { taken: false, reason: `screenshot failed: ${e?.message || e}`, rendered: r.ok, renderReason: r.reason };
      }
    }
    await r.dispose();
    return {
      taken,
      path: taken ? outPath : null,
      rendered: r.ok,
      renderReason: r.reason ?? null,
      failureClass: r.failureClass ?? null,
      isErrorPlaceholder: r.isErrorPlaceholder,
      pageErrors: r.pageErrors,
      consoleErrors: r.consoleErrors.slice(0, 10),
      navMs: r.navMs,
      via: 'dist/renderHarness',
      ...(taken ? {} : { reason: r.reason || 'render returned no page' }),
    };
  } catch (e) {
    const fallback = await rawScreenshot({ project, storybook, storyId, outPath, timeoutMs });
    return { ...fallback, distError: e?.message || String(e) };
  }
}

/** Playwright straight from the project, when dist/ is unavailable. */
async function rawScreenshot({ project, storybook, storyId, outPath, timeoutMs }) {
  const anchor = path.join(project, 'package.json');
  if (!fs.existsSync(anchor)) return { taken: false, reason: `no package.json at ${project}`, via: 'raw' };
  const req = createRequire(anchor);
  let pw;
  try { pw = req('playwright'); } catch { try { pw = req('playwright-core'); } catch { return { taken: false, reason: 'playwright not installed in the project', via: 'raw' }; } }
  let browser;
  const pageErrors = [];
  try {
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', err => pageErrors.push(err.message));
    await page.goto(`${storybook.replace(/\/+$/, '')}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForFunction(() => {
      const root = document.querySelector('#storybook-root');
      return root && root.childElementCount > 0;
    }, null, { timeout: timeoutMs }).catch(() => { /* screenshot whatever is there */ });
    await page.waitForTimeout(800);
    await page.screenshot({ path: outPath, fullPage: true });
    return { taken: true, path: outPath, pageErrors, via: 'raw' };
  } catch (e) {
    return { taken: false, reason: e?.message || String(e), pageErrors, via: 'raw' };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Release the process-wide browser the harness may have opened. */
export async function closeBrowsers(storyUiRoot) {
  try {
    const { closeBrowserSession } = await import(dist(storyUiRoot, 'story-generator/verify/browserSession.js'));
    await closeBrowserSession();
  } catch { /* nothing to close */ }
}
