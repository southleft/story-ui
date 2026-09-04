/**
 * A project to borrow Playwright from, for the tests that drive a real browser.
 *
 * Verification deliberately resolves `playwright` and `axe-core` from the
 * CONSUMING project rather than from Story UI's own dependencies — that is the
 * behaviour under test, and the reason this repository does not depend on
 * Playwright itself. So the browser-driving tests need some project on the
 * machine that has it installed.
 *
 * That project used to be named by an absolute path, which meant the tests ran
 * on exactly one machine and published a maintainer's home directory to a
 * public repository. It is now discovered:
 *
 *   1. `STORY_UI_TEST_PROJECT` — an explicit path, for CI or an unusual layout.
 *   2. `STORY_UI_TEST_PROJECTS` (or `../test-storybooks`) — the conventional
 *      sibling directory of Storybook fixtures; the first entry that has a
 *      usable Playwright wins.
 *   3. The repository itself and its siblings, in case Playwright is installed
 *      somewhere else nearby.
 *
 * When nothing on the machine has Playwright, this returns null and every
 * caller skips through `describe.runIf(...)`. That is the honest outcome: a
 * browser test that cannot start a browser has not passed, and it must not
 * look as though it did.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveHostTooling, type HostTooling } from '../../story-generator/verify/hostTooling.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories to try, in order of how likely they are to be the right answer. */
function candidates(): string[] {
  const out: string[] = [];
  const add = (dir: string | undefined) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!out.includes(resolved)) out.push(resolved);
  };

  add(process.env.STORY_UI_TEST_PROJECT);

  const fixtures = process.env.STORY_UI_TEST_PROJECTS
    ? path.resolve(process.env.STORY_UI_TEST_PROJECTS)
    : path.resolve(REPO_ROOT, '..', 'test-storybooks');
  try {
    for (const entry of fs.readdirSync(fixtures, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) add(path.join(fixtures, entry.name));
    }
  } catch { /* no fixtures directory on this machine */ }

  add(REPO_ROOT);
  try {
    const siblings = path.resolve(REPO_ROOT, '..');
    for (const entry of fs.readdirSync(siblings, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) add(path.join(siblings, entry.name));
    }
  } catch { /* unreadable parent */ }

  return out;
}

/**
 * Is this Playwright's browser actually on disk?
 *
 * Resolving the `playwright` package is not enough, and the difference is not
 * academic: the first fixture found alphabetically had Playwright installed
 * from an older release whose Chromium had never been downloaded, so every
 * probe test failed at `browser.newPage()` instead of skipping. A candidate
 * that cannot launch is not a candidate.
 *
 * `canLaunchBrowser` is the thorough check, but it is async and the callers
 * need an answer at collection time for `describe.runIf`. The executable's
 * existence is the same fact, synchronously. When Playwright will not say
 * where its binary is (a custom channel, a remote endpoint), that is not
 * evidence of breakage, so the candidate is accepted and the launch decides.
 */
function browserIsInstalled(tooling: HostTooling): boolean {
  try {
    const executable = tooling.playwright?.chromium?.executablePath?.();
    if (!executable) return true;
    return fs.existsSync(executable);
  } catch {
    return true;
  }
}

let cached: { value: HostTooling | null } | undefined;

/**
 * Tooling from the first candidate project whose Playwright can actually run,
 * or null. Cached: the search touches the filesystem and every probe test asks.
 */
export function testHostTooling(): HostTooling | null {
  if (cached) return cached.value;
  let value: HostTooling | null = null;
  for (const dir of candidates()) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    const tooling = resolveHostTooling(dir);
    if (tooling && browserIsInstalled(tooling)) { value = tooling; break; }
  }
  if (!value && !process.env.CI) {
    console.warn(
      '[tests] No project with Playwright found, so the browser-driven probe tests are skipped. ' +
      'Set STORY_UI_TEST_PROJECT=/path/to/a/storybook-project (one that has run `npx playwright install chromium`) to run them.',
    );
  }
  cached = { value };
  return value;
}
