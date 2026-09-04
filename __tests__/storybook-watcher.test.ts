/**
 * Storybook's index watcher is fs.watch, and on macOS fs.watch is one
 * FSEvents stream rooted at the home directory that drops events under load
 * and never recovers. That is not a version: 10.1.2, 10.5.6, 10.5.10 and
 * 10.6.0 all indexed a new file in ~1s on the project that had lost every
 * event for ten minutes. So the check does not read a version range — it
 * writes a story and watches the index — and its static advice names the
 * platform and the polling switch that removes fs.watch from the picture.
 *
 * Nothing here touches the repo's own node_modules: versions are read from
 * a temp dir, and Storybook is a stubbed fetch.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  installedVersion, watchpackPolling, storybookWatcherAdvice, storybookWatcherHint,
  probeStorybookWatcher, removeStaleProbes, POLLING_FIX,
  ensureWatcherLauncher, pollingIsConfigured, WATCHER_POLLING_MARKER,
  WATCHER_LAUNCHER_FILE, routeScriptThroughLauncher, removeWatcherPollingPreamble,
} from '../story-generator/verify/storybookWatcher.js';

const project = (storybookVersion: string | null) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbw-'));
  if (storybookVersion) {
    fs.mkdirSync(path.join(dir, 'node_modules', 'storybook'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'storybook', 'package.json'), JSON.stringify({ version: storybookVersion }));
  }
  fs.mkdirSync(path.join(dir, 'src', 'stories', 'generated'), { recursive: true });
  return dir;
};

describe('installedVersion', () => {
  it('reads the version from node_modules and returns "" when the package is absent', () => {
    expect(installedVersion(project('10.5.6'), 'storybook')).toBe('10.5.6');
    expect(installedVersion(project(null), 'storybook')).toBe('');
    expect(installedVersion(project('10.5.6'), 'vite')).toBe('');
  });
});

describe('watchpackPolling', () => {
  it('reads the variable the way watchpack does', () => {
    expect(watchpackPolling(undefined)).toBe(false);
    expect(watchpackPolling('')).toBe(false);
    expect(watchpackPolling('false')).toBe(false);
    expect(watchpackPolling('1000')).toBe(1000);
    expect(watchpackPolling('true')).toBe(true);
  });
});

describe('storybookWatcherAdvice', () => {
  it('names the FSEvents risk and the polling fix on macOS, for every 10.x alike', () => {
    for (const v of ['10.1.2', '10.5.6', '10.5.10', '10.6.0']) {
      const advice = storybookWatcherAdvice({ platform: 'darwin', storybookVersion: v, polling: false });
      expect(advice.risk).toBe('fsevents');
      expect(advice.detail).toContain(`Storybook ${v}`);
      expect(advice.detail).toContain('FSEvents');
      expect(advice.fix).toContain(POLLING_FIX);
      expect(advice.detail).not.toMatch(/or newer|upgrade|stopped indexing/);
    }
  });
  it('reports no risk once polling is on, and says which interval', () => {
    const advice = storybookWatcherAdvice({ platform: 'darwin', storybookVersion: '10.5.6', polling: 1000 });
    expect(advice.risk).toBe('none');
    expect(advice.detail).toContain('WATCHPACK_POLLING=1000');
    expect(advice.fix).toBeUndefined();
  });
  it('does not claim the macOS finding for other platforms, and says so', () => {
    const advice = storybookWatcherAdvice({ platform: 'linux', storybookVersion: '10.5.6', polling: false });
    expect(advice.risk).toBe('none');
    expect(advice.detail).toContain('linux');
    expect(advice.fix).toBeUndefined();
  });
  it('is unknown without Storybook', () => {
    expect(storybookWatcherAdvice({ platform: 'darwin', storybookVersion: '', polling: false }).risk).toBe('unknown');
  });
});

describe('storybookWatcherHint', () => {
  it('reads the version from the project and the switch from the environment', () => {
    const cwd = project('10.5.6');
    expect(storybookWatcherHint(cwd, {}, 'darwin')).toContain('Storybook 10.5.6 on macOS');
    expect(storybookWatcherHint(cwd, {}, 'darwin')).toContain('WATCHPACK_POLLING=1000');
    expect(storybookWatcherHint(cwd, { WATCHPACK_POLLING: 'true' }, 'darwin')).toBe('');
    expect(storybookWatcherHint(cwd, {}, 'win32')).toBe('');
    expect(storybookWatcherHint(project(null), {}, 'darwin')).toBe('');
  });
});

/** A Storybook whose watcher is alive: the index lists whatever is on disk. */
const liveStorybook = (generatedDir: string) => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    const entries: Record<string, { title: string }> = {};
    for (const name of fs.readdirSync(generatedDir)) {
      if (!name.endsWith('.stories.ts')) continue;
      const m = fs.readFileSync(path.join(generatedDir, name), 'utf8').match(/title: "([^"]+)"/);
      if (m) entries[name] = { title: m[1] };
    }
    return { ok: true, status: 200, json: async () => ({ entries }) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};

/** A Storybook whose watcher is dead: the index never changes. */
const frozenStorybook = () => (async () => ({ ok: true, status: 200, json: async () => ({ entries: { 'x--y': { title: 'X' } } }) })) as unknown as typeof fetch;

describe('probeStorybookWatcher', () => {
  it('reports alive when the index picks the probe up, and removes the probe', async () => {
    const generatedDir = path.join(project('10.5.6'), 'src', 'stories', 'generated');
    const sb = liveStorybook(generatedDir);
    const result = await probeStorybookWatcher({ storybookUrl: 'http://localhost:6110/', generatedDir, fetchImpl: sb.fetchImpl, timeoutMs: 2000, intervalMs: 10 });
    expect(result.outcome).toBe('alive');
    expect(sb.calls[0]).toBe('http://localhost:6110/index.json');
    expect(fs.readdirSync(generatedDir)).toEqual([]);
  });

  it('reports dead when the index never changes, after the timeout, and removes the probe', async () => {
    const generatedDir = path.join(project('10.5.6'), 'src', 'stories', 'generated');
    const result = await probeStorybookWatcher({ storybookUrl: 'http://localhost:6110', generatedDir, fetchImpl: frozenStorybook(), timeoutMs: 120, intervalMs: 10 });
    expect(result.outcome).toBe('dead');
    if (result.outcome === 'dead') expect(result.ms).toBeGreaterThanOrEqual(120);
    expect(fs.readdirSync(generatedDir)).toEqual([]);
  });

  it('reports unreachable, without writing anything, when Storybook does not answer', async () => {
    const generatedDir = path.join(project('10.5.6'), 'src', 'stories', 'generated');
    const refused = (async () => { throw new Error('ECONNREFUSED 127.0.0.1:6110'); }) as unknown as typeof fetch;
    const result = await probeStorybookWatcher({ storybookUrl: 'http://localhost:6110', generatedDir, fetchImpl: refused, timeoutMs: 100, intervalMs: 10 });
    expect(result).toEqual({ outcome: 'unreachable', error: 'ECONNREFUSED 127.0.0.1:6110' });
    expect(fs.readdirSync(generatedDir)).toEqual([]);
  });

  it('skips, without writing, when the stories directory does not exist', async () => {
    const generatedDir = path.join(project('10.5.6'), 'nowhere');
    const result = await probeStorybookWatcher({ storybookUrl: 'http://localhost:6110', generatedDir, fetchImpl: frozenStorybook(), timeoutMs: 100, intervalMs: 10 });
    expect(result.outcome).toBe('skipped');
  });

  it('the probe is CSF every framework can index: TypeScript, no JSX, hidden from the sidebar', async () => {
    const generatedDir = path.join(project('10.5.6'), 'src', 'stories', 'generated');
    let seen = '';
    const peek = (async () => {
      for (const name of fs.readdirSync(generatedDir)) seen = fs.readFileSync(path.join(generatedDir, name), 'utf8');
      return { ok: true, status: 200, json: async () => ({ entries: {} }) };
    }) as unknown as typeof fetch;
    await probeStorybookWatcher({ storybookUrl: 'http://localhost:6110', generatedDir, fetchImpl: peek, timeoutMs: 60, intervalMs: 10 });
    expect(seen).toMatch(/^\/\/ Written by `story-ui check`/);
    expect(seen).toContain("export default { title: \"Story UI/Watcher Probe ");
    expect(seen).toContain("tags: ['!dev', '!autodocs']");
    expect(seen).toContain('export const Probe = {};');
    expect(seen).not.toContain('<');
  });
});

describe('removeStaleProbes', () => {
  it('removes only probe files an interrupted check left behind', () => {
    const generatedDir = path.join(project('10.5.6'), 'src', 'stories', 'generated');
    fs.writeFileSync(path.join(generatedDir, '__story-ui-watcher-probe-dead0.stories.ts'), '');
    fs.writeFileSync(path.join(generatedDir, 'real-card.stories.tsx'), '');
    expect(removeStaleProbes(generatedDir)).toEqual(['__story-ui-watcher-probe-dead0.stories.ts']);
    expect(fs.readdirSync(generatedDir)).toEqual(['real-card.stories.tsx']);
    expect(removeStaleProbes(path.join(generatedDir, 'missing'))).toEqual([]);
  });
});

describe('the launcher that actually sets WATCHPACK_POLLING', () => {
  const main = `import type { StorybookConfig } from '@storybook/react-vite';

// Story UI: keep the story-index watcher alive. On macOS, Storybook's story-index watcher
// drops events silently.
if (process.platform === 'darwin' && !process.env.WATCHPACK_POLLING) process.env.WATCHPACK_POLLING = '1000';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
};
export default config;
`;

  const project = (scripts: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-'));
    fs.mkdirSync(path.join(dir, '.storybook'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts }, null, 2));
    return dir;
  };

  it('rewrites only the storybook invocation, keeping every flag', () => {
    expect(routeScriptThroughLauncher('storybook dev -p 6109 --no-open'))
      .toBe(`node ./.storybook/${WATCHER_LAUNCHER_FILE} dev -p 6109 --no-open`);
    expect(routeScriptThroughLauncher('npx storybook dev -p 6006'))
      .toBe(`node ./.storybook/${WATCHER_LAUNCHER_FILE} dev -p 6006`);
    // A build is not a watch, and a script that calls another script inherits
    // the environment the launcher sets, so neither is touched.
    expect(routeScriptThroughLauncher('storybook build')).toBeNull();
    expect(routeScriptThroughLauncher('concurrently "npm run storybook" "npm run story-ui"')).toBeNull();
    // Idempotent.
    const once = routeScriptThroughLauncher('storybook dev -p 6006')!;
    expect(routeScriptThroughLauncher(once)).toBeNull();
  });

  it('installs the launcher, points the script at it, and reports it', () => {
    const dir = project({ storybook: 'storybook dev -p 6006', build: 'storybook build' });
    const result = ensureWatcherLauncher(dir);
    expect(result.file).toBe('created');
    expect(result.scripts).toEqual(['storybook']);
    const scripts = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts;
    expect(scripts.storybook).toContain(WATCHER_LAUNCHER_FILE);
    expect(scripts.build).toBe('storybook build');
    // The launcher must set the variable BEFORE it imports Storybook — the whole
    // point of the file. Anything else is the bug it exists to fix.
    const src = fs.readFileSync(path.join(dir, '.storybook', WATCHER_LAUNCHER_FILE), 'utf8');
    expect(src.indexOf('WATCHPACK_POLLING')).toBeLessThan(src.indexOf("require.resolve('storybook/package.json'"));
    // Running it again changes nothing.
    const again = ensureWatcherLauncher(dir);
    expect(again.file).toBe('unchanged');
    expect(again.scripts).toEqual([]);
    expect(pollingIsConfigured(dir)).toBe(true);
  });

  it('says so when no script starts Storybook directly', () => {
    const dir = project({ dev: 'vite' });
    const result = ensureWatcherLauncher(dir);
    expect(result.scripts).toEqual([]);
    expect(result.note).toContain('No package script starts Storybook directly');
    expect(pollingIsConfigured(dir)).toBe(false);
  });

  it('deletes the preamble that never worked, so nothing reads it as a fix', () => {
    const dir = project({ storybook: 'storybook dev' });
    fs.writeFileSync(path.join(dir, '.storybook', 'main.ts'), main);
    const result = ensureWatcherLauncher(dir);
    expect(result.removedDeadPreamble).toBe('main.ts');
    const after = fs.readFileSync(path.join(dir, '.storybook', 'main.ts'), 'utf8');
    expect(after).not.toContain('WATCHPACK_POLLING');
    expect(after).not.toContain(WATCHER_POLLING_MARKER);
    // The rest of the config survives intact.
    expect(after).toContain("stories: ['../src/**/*.stories.tsx']");
    expect(after).toContain("import type { StorybookConfig }");
    expect(removeWatcherPollingPreamble(after)).toBeNull();
  });

  it('does not count the dead preamble as polling', () => {
    // This is the regression that mattered: `check` reported polling configured
    // because the marker was in the config, while watchpack had read the
    // variable before that line ever ran.
    const dir = project({ storybook: 'storybook dev' });
    fs.writeFileSync(path.join(dir, '.storybook', 'main.ts'), main);
    expect(pollingIsConfigured(dir)).toBe(false);
  });
});
