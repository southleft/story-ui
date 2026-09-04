/**
 * Why a generated story can fail to reach Storybook's index, and how to tell.
 *
 * Storybook invalidates its story index from watchpack over Node's
 * `fs.watch` — not from Vite's watcher, and not differently between versions:
 * 10.1.2, 10.5.6, 10.5.10 and 10.6.0 create the same watch set, on Vite 7 and
 * Vite 8 alike, and each indexed a new file in about a second on the same
 * project that, minutes earlier, had lost every event for ten minutes on
 * 10.5.6. The version is not the variable.
 *
 * On macOS the mechanism is this. watchpack watches every ancestor of the
 * project up to `/Users` (so a renamed parent is noticed), and libuv folds
 * every `fs.watch` handle in the process into ONE FSEventStream whose roots
 * are those paths — the stream carries every file event under the home
 * directory, and libuv drops fseventsd's "events were dropped" flag on the
 * floor without rescanning. What was traced: a Storybook whose handles on
 * `/Users/<me>` kept receiving events while its handle on the project's
 * stories directory received none, for ten minutes, then recovered without a
 * restart; fresh Node processes watching the same directories in that window
 * got nothing either. A handle on `/private` (a project under /tmp) silenced
 * the project's events every time. The trigger for the ten-minute silence
 * was not isolated; the condition is the OS's, not the process's, and a
 * version bump does not reach it.
 *
 * `WATCHPACK_POLLING=<ms>` makes watchpack stat its directories on a timer
 * instead of calling `fs.watch` at all (zero calls in the traced run; a new
 * file indexed in about a second), so nothing FSEvents does or fails to do
 * can reach the index. It is the one fix that does not depend on the machine
 * being quiet.
 *
 * None of this can be read from a version number, so the only honest check
 * is a live one: write a story, watch the index, take it back out.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type WatcherRisk = 'fsevents' | 'none' | 'unknown';

export interface WatcherAdvice {
  risk: WatcherRisk;
  /** One line for a check report. */
  detail: string;
  /** The command that removes the risk, when there is one. */
  fix?: string;
}

/** Read a package's version from the project's node_modules, or '' when absent. */
export function installedVersion(cwd: string, pkg: string): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', pkg, 'package.json'), 'utf8')).version || '';
  } catch {
    return '';
  }
}

/**
 * watchpack's own reading of WATCHPACK_POLLING: a number is an interval in
 * ms, "false" or empty is off, anything else is on (its default interval).
 */
export function watchpackPolling(value: string | undefined): number | boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (String(Number(value)) === value) return Number(value);
  return true;
}

export const POLLING_FIX = 'npx story-ui update (routes the storybook script through a launcher that sets it), or start with WATCHPACK_POLLING=1000 npm run storybook';

/** Marks the polling preamble older versions wrote into .storybook/main. */
export const WATCHER_POLLING_MARKER = 'Story UI: keep the story-index watcher alive';

/** The launcher `init`/`update` write into the .storybook directory. */
export const WATCHER_LAUNCHER_FILE = 'story-ui-storybook.mjs';

/**
 * WHY A LAUNCHER AND NOT A LINE IN .storybook/main.
 *
 * Story UI used to write this into the Storybook config:
 *
 *   if (process.platform === 'darwin' && !process.env.WATCHPACK_POLLING)
 *     process.env.WATCHPACK_POLLING = '1000';
 *
 * on the reasoning that the config is evaluated in Storybook's own process
 * before any watcher is created. The second half is true and irrelevant.
 * watchpack does not read the variable when it creates a watcher; its
 * DirectoryWatcher module reads it ONCE, at module scope, to compute a
 * `FORCE_POLLING` constant — and Storybook's core-server imports watchpack at
 * ITS module scope, which happens before the user's config file is loaded.
 *
 * Measured, by proxying `process.env` and logging each access with a stack:
 *
 *   [read ] undefined  watchpack/lib/DirectoryWatcher.js <- getWatcherManager
 *   [read ] undefined  .storybook/main.ts:1
 *   [write] "1000"     .storybook/main.ts:1
 *
 * The preamble ran second. Every project that took the fix was still watching
 * with fs.watch, while `check` reported polling was configured because the
 * marker was in the file — a check that could not fail, on a fix that did
 * nothing. That combination is the reason this comment is this long.
 *
 * The variable has to be in the environment before Node loads Storybook, so
 * this launcher sets it and then imports Storybook's own binary, forwarding
 * argv untouched. Storybook's dispatcher re-execs a child process, which
 * inherits the environment, so the value reaches the process that watches.
 */
export function watcherLauncherSource(): string {
  return `#!/usr/bin/env node
// Written by Story UI. Starts Storybook with WATCHPACK_POLLING set on macOS, where
// Storybook's story-index watcher (watchpack over fs.watch) shares one FSEvents stream
// rooted at your home directory: a burst of file activity anywhere under it drops events
// silently, and a new story then never appears until Storybook restarts. Polling stats the
// directories instead, so nothing FSEvents does can reach it.
//
// This has to happen before Node loads Storybook — watchpack reads the variable once, when
// its module is first evaluated, which is before .storybook/main is read. Setting it inside
// the config is too late and has no effect.
//
// Everything after the script name is passed to Storybook unchanged, so this file is a
// drop-in for the \`storybook\` command. Delete it and restore the plain command if you set
// WATCHPACK_POLLING yourself.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

if (process.platform === 'darwin' && !process.env.WATCHPACK_POLLING) {
  process.env.WATCHPACK_POLLING = '1000';
}

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('storybook/package.json', { paths: [process.cwd(), import.meta.dirname] });
const pkg = require(pkgPath);
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.storybook;
await import(pathToFileURL(path.join(path.dirname(pkgPath), bin)).href);
`;
}

/** The command a package script must run for the launcher to be in play. */
const LAUNCHER_CMD = `node ./.storybook/${WATCHER_LAUNCHER_FILE}`;

/**
 * Route a package script through the launcher.
 *
 * Only a script that runs Storybook's binary directly is rewritten, and only
 * the `storybook dev` token within it — flags, ports and everything around it
 * survive. A script that runs another script (`npm run storybook`) is left
 * alone: it starts a child that inherits the environment the launcher sets.
 * Returns null when there is nothing to do.
 */
export function routeScriptThroughLauncher(script: string): string | null {
  if (!script || script.includes(WATCHER_LAUNCHER_FILE)) return null;
  const re = /(^|&&\s*|\|\|\s*|;\s*|"\s*)((?:npx|pnpm exec|yarn|bun x|bunx)\s+)?storybook(\s+dev\b)/;
  const m = re.exec(script);
  if (!m) return null;
  return script.replace(re, `$1${LAUNCHER_CMD}$3`);
}

export interface LauncherResult {
  /** What happened to the launcher file. */
  file: 'created' | 'updated' | 'unchanged';
  /** Scripts rewritten to go through it. */
  scripts: string[];
  /** Set when .storybook/main still carried the preamble that never worked. */
  removedDeadPreamble?: string;
  /** Set when no script runs Storybook directly, so nothing could be routed. */
  note?: string;
}

/**
 * Strip the preamble older versions wrote into .storybook/main. It is inert
 * (see above) and leaving it there makes a later reader believe polling is on.
 * Null when the file does not carry it.
 */
export function removeWatcherPollingPreamble(mainContent: string): string | null {
  if (!mainContent.includes(WATCHER_POLLING_MARKER)) return null;
  const lines = mainContent.split('\n');
  const start = lines.findIndex(l => l.includes(WATCHER_POLLING_MARKER));
  let end = start;
  // The block is the comment lines plus the single assignment that follows.
  while (end < lines.length && (lines[end].startsWith('//') || lines[end].includes('WATCHPACK_POLLING'))) end++;
  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  // Collapse the blank line the block leaves behind.
  while (kept[start] === '' && kept[start - 1] === '') kept.splice(start, 1);
  return kept.join('\n');
}

/** Do the project's own files put polling in Storybook's environment? */
export function pollingIsConfigured(cwd: string): boolean {
  if (!fs.existsSync(path.join(cwd, '.storybook', WATCHER_LAUNCHER_FILE))) return false;
  try {
    const scripts = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {};
    if (Object.values(scripts).some((s: any) => typeof s === 'string' && s.includes(WATCHER_LAUNCHER_FILE))) return true;
  } catch { /* no package.json to read */ }
  return false;
}

/**
 * Install the launcher and point the project's Storybook script at it.
 * Idempotent: safe to run on every `update`.
 */
export function ensureWatcherLauncher(cwd: string): LauncherResult {
  const sbDir = path.join(cwd, '.storybook');
  fs.mkdirSync(sbDir, { recursive: true });
  const target = path.join(sbDir, WATCHER_LAUNCHER_FILE);
  const source = watcherLauncherSource();
  let file: LauncherResult['file'] = 'created';
  if (fs.existsSync(target)) {
    file = fs.readFileSync(target, 'utf8') === source ? 'unchanged' : 'updated';
  }
  if (file !== 'unchanged') fs.writeFileSync(target, source);

  const result: LauncherResult = { file, scripts: [] };

  const pkgPath = path.join(cwd, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts || {};
    let changed = false;
    for (const [name, cmd] of Object.entries(scripts)) {
      if (typeof cmd !== 'string') continue;
      const routed = routeScriptThroughLauncher(cmd);
      if (routed) { scripts[name] = routed; result.scripts.push(name); changed = true; }
    }
    if (changed) {
      pkg.scripts = scripts;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    } else if (!pollingIsConfigured(cwd)) {
      result.note = `No package script starts Storybook directly, so nothing was rewritten — start it with \`${LAUNCHER_CMD} dev\` (or set WATCHPACK_POLLING=1000 yourself) for the index to keep up on macOS`;
    }
  } catch {
    result.note = 'package.json could not be read, so the Storybook script was left alone';
  }

  for (const name of ['main.ts', 'main.mts', 'main.tsx', 'main.js', 'main.mjs', 'main.cjs']) {
    const mainPath = path.join(sbDir, name);
    if (!fs.existsSync(mainPath)) continue;
    const stripped = removeWatcherPollingPreamble(fs.readFileSync(mainPath, 'utf8'));
    if (stripped !== null) {
      fs.writeFileSync(mainPath, stripped);
      result.removedDeadPreamble = name;
    }
    break;
  }

  return result;
}

export function storybookWatcherAdvice(input: {
  platform: NodeJS.Platform;
  storybookVersion: string;
  polling: number | boolean;
}): WatcherAdvice {
  const { platform, storybookVersion, polling } = input;
  if (!storybookVersion) return { risk: 'unknown', detail: 'Storybook is not installed here, so its file watcher cannot be assessed' };
  // Measured on 10.1.2 through 10.6.0. Before 10 the index is not refreshed
  // for a new file at all (the version item says so); nothing here applies.
  if (Number(storybookVersion.split('.')[0]) < 10) {
    return { risk: 'unknown', detail: `Storybook ${storybookVersion} does not refresh its index for new files live; the watcher finding was measured on 10.x` };
  }
  if (polling) {
    return {
      risk: 'none',
      detail: `Storybook ${storybookVersion} watches by polling (WATCHPACK_POLLING=${polling}) — new stories are found by stat, not by fs.watch, so a dropped FSEvents stream cannot hide them`,
    };
  }
  if (platform === 'darwin') {
    return {
      risk: 'fsevents',
      detail: `Storybook ${storybookVersion} watches with fs.watch; on macOS that is one FSEvents stream rooted at your home directory, and a burst of file activity anywhere under it (an install, a large copy) drops events silently — the watcher then never sees a new story until Storybook restarts`,
      fix: `${POLLING_FIX}  (polling; immune to dropped events — restart Storybook this way)`,
    };
  }
  return { risk: 'none', detail: `Storybook ${storybookVersion} watches with fs.watch (${platform}; the FSEvents drop measured on macOS does not apply)` };
}

/**
 * The sentence verification appends when a story never reached the index.
 * Version-independent, because the failure is: it names the mechanism and
 * the two things that help, and stays silent where neither was measured.
 */
export function storybookWatcherHint(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const version = installedVersion(cwd, 'storybook');
  const polling = watchpackPolling(env.WATCHPACK_POLLING) || (pollingIsConfigured(cwd) ? 1000 : false);
  const advice = storybookWatcherAdvice({ platform, storybookVersion: version, polling });
  if (advice.risk !== 'fsevents') return '';
  return ` Storybook ${version} on macOS watches with fs.watch through one FSEvents stream rooted at your home directory; a burst of file activity anywhere under it drops events silently and the watcher does not recover. Restart Storybook with WATCHPACK_POLLING=1000 (polling, immune to this), and run npx story-ui update so it polls from then on.`;
}

export type WatcherProbeOutcome =
  | { outcome: 'alive'; ms: number; file: string }
  | { outcome: 'dead'; ms: number; file: string }
  | { outcome: 'unreachable'; error: string }
  | { outcome: 'skipped'; reason: string };

export interface WatcherProbeOptions {
  storybookUrl: string;
  /** Directory Storybook's stories globs cover; the probe is written here. */
  generatedDir: string;
  /** How long a live watcher gets. 10.x indexes in ~1s; 8s is generous. */
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}

const PROBE_PREFIX = '__story-ui-watcher-probe-';

/**
 * Write a minimal CSF file into the stories directory, poll `/index.json`
 * until its title appears, and remove the file. TypeScript without JSX and a
 * `.stories.ts` name, so every framework's glob matches it and the indexer —
 * which parses CSF statically — needs nothing to compile.
 *
 * "alive" and "dead" are the two answers the check wants; "unreachable" is
 * kept separate because a Storybook that is down is not one whose watcher
 * died, and telling the user to restart a server that was never up sends
 * them the wrong way.
 */
export async function probeStorybookWatcher(opts: WatcherProbeOptions): Promise<WatcherProbeOutcome> {
  const { storybookUrl, generatedDir, timeoutMs = 8000, intervalMs = 250, fetchImpl = fetch } = opts;
  const url = `${storybookUrl.replace(/\/+$/, '')}/index.json`;
  const readIndex = async (): Promise<Record<string, { title?: string }>> => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const json = await res.json() as { entries?: Record<string, { title?: string }> };
    return json.entries || {};
  };

  try {
    await readIndex();
  } catch (err) {
    return { outcome: 'unreachable', error: err instanceof Error ? err.message : String(err) };
  }
  if (!fs.existsSync(generatedDir)) return { outcome: 'skipped', reason: `${generatedDir} does not exist` };

  const token = crypto.randomBytes(4).toString('hex');
  const title = `Story UI/Watcher Probe ${token}`;
  const file = path.join(generatedDir, `${PROBE_PREFIX}${token}.stories.ts`);
  const source = `// Written by \`story-ui check\` to see whether Storybook notices a new file; removed within seconds.\nexport default { title: ${JSON.stringify(title)}, tags: ['!dev', '!autodocs'] };\nexport const Probe = {};\n`;
  const started = Date.now();
  try {
    fs.writeFileSync(file, source);
    while (Date.now() - started < timeoutMs) {
      await new Promise(r => setTimeout(r, intervalMs));
      try {
        const entries = await readIndex();
        if (Object.values(entries).some(e => e.title === title)) {
          return { outcome: 'alive', ms: Date.now() - started, file };
        }
      } catch { /* a transient error mid-poll is not an answer; keep polling */ }
    }
    return { outcome: 'dead', ms: Date.now() - started, file };
  } finally {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
}

/** Probe files an interrupted check may have left behind. */
export function removeStaleProbes(generatedDir: string): string[] {
  let removed: string[] = [];
  try {
    for (const name of fs.readdirSync(generatedDir)) {
      if (name.startsWith(PROBE_PREFIX)) {
        fs.unlinkSync(path.join(generatedDir, name));
        removed.push(name);
      }
    }
  } catch { removed = []; }
  return removed;
}
