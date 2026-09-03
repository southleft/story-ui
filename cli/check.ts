/**
 * `story-ui check` — did the install work?
 *
 * An agent that just ran `init` has no way to know whether the result is
 * usable short of starting everything and reading logs. This answers the
 * questions that matter, each with a fact behind it, and exits non-zero
 * when something is broken. `--json` prints the same report for a script.
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { loadUserConfig } from '../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../story-generator/enhancedComponentDiscovery.js';
import { extractProps } from '../story-generator/knowledge/propExtractor.js';
import { readConfiguredPort, storiesGlobCoversMdx, storybookMainSyntaxError, managerHeadPort, readScriptPort } from './setup.js';
import { isUsableApiKey } from './envFile.js';
import { relativeImportResolves, localImportForComponents } from '../story-generator/configLoader.js';
import { resolveHostTooling, canLaunchBrowser } from '../story-generator/verify/hostTooling.js';
import { closeBrowserSession } from '../story-generator/verify/browserSession.js';
import { describeLaunchFailure } from '../story-generator/verify/verifyStory.js';
import { storybookWatcherAdvice, watchpackPolling, installedVersion, probeStorybookWatcher, removeStaleProbes, mainConfiguresPolling } from '../story-generator/verify/storybookWatcher.js';

/** a < b for dotted versions; prerelease tags ignored. */
import { semverLt } from '../story-generator/semver.js';
export { semverLt };

export interface CheckItem {
  id: string;
  ok: boolean | null;
  /** One line a human reads. */
  detail: string;
  /** What to do when ok is false. */
  fix?: string;
}

export interface CheckReport {
  ok: boolean;
  items: CheckItem[];
  summary: { components: number; importPath?: string; componentsPath?: string; port?: number; server?: string };
}

const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'];

function readEnv(cwd: string): Record<string, string> {
  const p = path.join(cwd, '.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export async function runChecks(opts: { server?: string; storybook?: string; cwd?: string } = {}): Promise<CheckReport> {
  const cwd = opts.cwd || process.cwd();
  const items: CheckItem[] = [];
  const summary: CheckReport['summary'] = { components: 0 };

  // 1. Config
  const configPath = ['story-ui.config.js', 'story-ui.config.mjs', 'story-ui.config.cjs', 'story-ui.config.json']
    .map(f => path.join(cwd, f)).find(f => fs.existsSync(f));
  if (!configPath) {
    items.push({ id: 'config', ok: false, detail: 'no story-ui.config.js in this directory', fix: 'npx story-ui init --yes' });
    return { ok: false, items, summary };
  }
  let config: any;
  try {
    config = await loadUserConfig();
    items.push({ id: 'config', ok: true, detail: `${path.basename(configPath)} loads (${config.importPath ? `importPath ${config.importPath}` : 'no importPath'})` });
  } catch (err) {
    items.push({ id: 'config', ok: false, detail: `${path.basename(configPath)} failed to load: ${err instanceof Error ? err.message : String(err)}`, fix: 'fix the config, or re-run init with --force' });
    return { ok: false, items, summary };
  }
  summary.importPath = config.importPath;
  // As init writes it — project-relative — not the loader's resolved absolute.
  summary.componentsPath = config.componentsPath
    ? (path.isAbsolute(config.componentsPath) && !path.relative(cwd, config.componentsPath).startsWith('..')
      ? `./${path.relative(cwd, config.componentsPath).split(path.sep).join('/')}`
      : config.componentsPath)
    : undefined;

  // 2. Import path resolves: an npm package present, or a local directory.
  const importPath: string = config.importPath || '';
  let ownPackageName = '';
  try { ownPackageName = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')).name || ''; } catch { /* no package.json */ }
  const isOwnName = Boolean(importPath) && Boolean(ownPackageName) && (importPath === ownPackageName || importPath.startsWith(ownPackageName + '/'));
  if (importPath.startsWith('.') || importPath.startsWith('/') || isOwnName) {
    // The project's own package name is local source, not an npm package:
    // nothing can install it, so the directory is what must exist.
    const generatedFrom = path.resolve(cwd, config.generatedStoriesPath || './src/stories/generated/');
    const dir = config.componentsPath || path.resolve(generatedFrom, importPath);
    const exists = fs.existsSync(dir);
    const where = `local components at ${path.relative(cwd, dir) || '.'}`;
    // The directory existing is not enough: the specifier a story writes
    // must resolve from the generated directory, which means a module file
    // or a directory WITH an index. `../../components` over a directory
    // without one failed every story at Vite's resolver.
    const resolves = !importPath.startsWith('.') || config.importStyle === 'individual' || relativeImportResolves(generatedFrom, importPath);
    let resolveFix: string | undefined;
    if (exists && !resolves && config.componentsPath) {
      const better = localImportForComponents(generatedFrom, config.componentsPath, cwd);
      resolveFix = better.importStyle
        ? `no barrel found for ${path.relative(cwd, config.componentsPath)}: add an index.ts that exports the components, or set importStyle: 'individual' in story-ui.config.js (re-running npx story-ui init --force does this)`
        : `set importPath: '${better.importPath}' in story-ui.config.js (the barrel at ${path.relative(cwd, better.barrel || '')} re-exports the components), or re-run npx story-ui init --force`;
    }
    items.push({
      id: 'import-path', ok: exists && resolves,
      detail: !exists
        ? (isOwnName ? `importPath ${importPath} is this project's own package name and componentsPath does not resolve to a directory` : `local import path ${importPath} does not resolve to a directory`)
        : !resolves
          ? `importPath ${importPath} does not resolve from ${path.relative(cwd, generatedFrom)}: no index module there, so every generated story would fail with "Failed to resolve import"`
          : (isOwnName ? `${where} (importPath ${importPath} is this project's own package name — local source)` : `${where}, imported as ${importPath}${config.importStyle === 'individual' ? ' (per-component paths)' : ''}`),
      fix: exists && resolves ? undefined : resolveFix || 'set componentsPath and importPath in story-ui.config.js to the component directory (importPath relative to the generated stories directory, resolving to a module or a directory with an index), or re-run init --force',
    });
  } else if (importPath === 'your-component-library') {
    items.push({ id: 'import-path', ok: false, detail: 'importPath is the placeholder "your-component-library" — init found neither an npm design system nor a component directory', fix: 'npx story-ui init --force --components-path ./path/to/components (or set importPath/componentsPath in story-ui.config.js)' });
  } else if (importPath) {
    const pkgDir = path.join(cwd, 'node_modules', ...importPath.split('/').slice(0, importPath.startsWith('@') ? 2 : 1));
    const exists = fs.existsSync(pkgDir);
    items.push({ id: 'import-path', ok: exists, detail: exists ? `${importPath} is installed` : `${importPath} is not in node_modules`, fix: exists ? undefined : `install it: npm install ${importPath.split('/').slice(0, importPath.startsWith('@') ? 2 : 1).join('/')}` });
  } else {
    items.push({ id: 'import-path', ok: false, detail: 'config has no importPath', fix: 'set importPath (an npm specifier or a relative path from the generated stories directory)' });
  }

  // 3. Discovery — the number the prompt will be built from.
  try {
    const discovery = new EnhancedComponentDiscovery(config);
    const components = await discovery.discoverAll();
    summary.components = components.length;
    // Props come from the extractor (declarations, cva maps, story docs), the
    // same source the prompt is built from — discovery alone knows names.
    let withProps = components.filter((c: any) => Array.isArray(c.props) && c.props.length > 0).length;
    try {
      const extracted = config.importPath ? await extractProps(config.importPath, cwd) : null;
      if (extracted?.components) {
        const names = new Set(components.map((c: any) => c.name));
        withProps = Object.entries(extracted.components).filter(([n, f]: [string, any]) => names.has(n) && Array.isArray(f?.props) && f.props.length > 0).length;
      }
    } catch { /* discovery count still stands */ }
    items.push({
      id: 'discovery', ok: components.length > 0,
      detail: components.length > 0
        ? `${components.length} component(s) discovered, ${withProps} with props (e.g. ${components.slice(0, 5).map((c: any) => c.name).join(', ')})`
        : 'discovery found no components',
      fix: components.length > 0 ? undefined : 'check importPath/componentsPath; for a local library the directory must hold component files',
    });
  } catch (err) {
    items.push({ id: 'discovery', ok: false, detail: `discovery threw: ${err instanceof Error ? err.message : String(err)}` });
  }

  // 4. Generated stories directory and Storybook globs.
  const generatedDir = path.resolve(cwd, config.generatedStoriesPath || './src/stories/generated/');
  // Verification needs Playwright AND a downloaded browser; the package alone
  // fails at launch with a boxed multi-line error that read as a crash.
  {
    let detail = 'Playwright is not installed — stories will be generated but not rendered for verification';
    let ok: boolean | null = null;
    let fix: string | undefined = 'npm install -D playwright && npx playwright install chromium';
    try {
      const tooling = resolveHostTooling(cwd);
      if (tooling) {
        // executablePath() is computed, not checked: it named chromium-1187
        // on a machine that had 1200–1234. Only a launch tells the truth.
        const launch = await canLaunchBrowser(tooling);
        await closeBrowserSession();
        if (launch.ok) { ok = true; detail = 'Playwright and its browser are installed — verification can run'; fix = undefined; }
        else { ok = false; detail = describeLaunchFailure(launch.error || ''); fix = 'npx playwright install chromium'; }
      }
    } catch { /* stays not-installed */ }
    items.push({ id: 'verification', ok, detail, fix });
  }

  // The package itself: init run from npx used to leave it uninstalled.
  {
    const pkg = path.join(cwd, 'node_modules', '@tpitre', 'story-ui', 'package.json');
    const installed = fs.existsSync(pkg);
    let ver = '';
    try { ver = installed ? JSON.parse(fs.readFileSync(pkg, 'utf8')).version : ''; } catch { /* unreadable */ }
    items.push({
      id: 'package', ok: installed,
      detail: installed ? `@tpitre/story-ui ${ver} is installed in this project` : '@tpitre/story-ui is not installed in this project',
      fix: installed ? undefined : 'npm install --save-dev @tpitre/story-ui',
    });
  }

  // Storybook's version. 9.1 never refreshed its story index for a new file
  // in testing (with stories present at boot, after editing another story,
  // after touching main.ts), so a generated story only appeared after a
  // restart. 10 is what the flow matrix runs against.
  {
    let sbVersion = '';
    try { sbVersion = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', 'storybook', 'package.json'), 'utf8')).version || ''; } catch { /* not installed here */ }
    const major = Number(sbVersion.split('.')[0]);
    // No 10.x range is named here: 10.1.2, 10.5.6, 10.5.10 and 10.6.0 (on
    // Vite 7 and 8) all indexed a new file in ~1s in the same session that
    // saw 10.5.6 index nothing for ten minutes. The watcher item below tells
    // the two apart by trying, which a version number cannot.
    items.push({
      id: 'storybook-version',
      ok: sbVersion ? major >= 10 : null,
      detail: sbVersion
        ? (major >= 10
            ? `Storybook ${sbVersion}`
            : `Storybook ${sbVersion} — new stories are not picked up live before 10; generated stories appear only after a restart`)
        : 'Storybook is not installed in this project',
      fix: sbVersion && major < 10 ? 'npx storybook@latest upgrade' : undefined,
    });
  }

  // Storybook's file watcher, live. Whether a new story reaches the index is
  // a property of the OS's event stream at this moment (macOS drops it; see
  // storybookWatcher.ts), so it is checked by writing a story and watching
  // for it — when a Storybook can be reached. Without one, the assessment
  // is static: platform and WATCHPACK_POLLING.
  {
    const generatedDir = path.resolve(cwd, config.generatedStoriesPath || './src/stories/generated/');
    const env = { ...readEnv(cwd), ...process.env } as Record<string, string | undefined>;
    const sbVersion = installedVersion(cwd, 'storybook');
    const advice = storybookWatcherAdvice({ platform: process.platform, storybookVersion: sbVersion, polling: watchpackPolling(env.WATCHPACK_POLLING) || (mainConfiguresPolling(cwd) ? 1000 : false) });
    const storybookUrl = opts.storybook || env.STORYBOOK_URL || (env.STORYBOOK_PORT ? `http://localhost:${env.STORYBOOK_PORT}` : undefined);
    if (!storybookUrl || !sbVersion) {
      items.push({
        id: 'storybook-watcher', ok: null,
        detail: `${advice.detail}${storybookUrl ? '' : ' — pass --storybook <url> (or set STORYBOOK_URL) with Storybook running to test the watcher live'}${advice.fix ? `; to rule it out: ${advice.fix}` : ''}`,
        fix: advice.fix,
      });
    } else {
      const stale = removeStaleProbes(generatedDir);
      const probe = await probeStorybookWatcher({ storybookUrl, generatedDir });
      const left = stale.length ? ` (removed ${stale.length} probe file${stale.length === 1 ? '' : 's'} an earlier check left behind)` : '';
      if (probe.outcome === 'alive') {
        items.push({ id: 'storybook-watcher', ok: true, detail: `Storybook at ${storybookUrl} indexed a new story in ${probe.ms}ms — its file watcher is alive${left}` });
      } else if (probe.outcome === 'dead') {
        items.push({
          id: 'storybook-watcher', ok: false,
          detail: `Storybook at ${storybookUrl} is running but its file watcher is not delivering events: a story written to ${path.relative(cwd, generatedDir)} was not indexed in ${Math.round(probe.ms / 1000)}s. Every generated story is invisible until Storybook restarts. ${advice.risk === 'fsevents' ? 'On macOS this is fs.watch\'s FSEvents stream (rooted at your home directory) having dropped events; it does not recover on its own' : advice.detail}${left}`,
          fix: advice.risk === 'fsevents' ? `restart Storybook with ${advice.fix}` : 'restart Storybook',
        });
      } else if (probe.outcome === 'unreachable') {
        items.push({ id: 'storybook-watcher', ok: null, detail: `no Storybook at ${storybookUrl} (${probe.error}) — start it to test its file watcher live. ${advice.detail}`, fix: advice.fix });
      } else {
        items.push({ id: 'storybook-watcher', ok: null, detail: `watcher probe skipped: ${probe.reason}. ${advice.detail}`, fix: advice.fix });
      }
    }
  }

  items.push({ id: 'generated-dir', ok: fs.existsSync(generatedDir), detail: fs.existsSync(generatedDir) ? `generated stories go to ${path.relative(cwd, generatedDir)}` : `${path.relative(cwd, generatedDir)} does not exist yet`, fix: fs.existsSync(generatedDir) ? undefined : `mkdir -p ${path.relative(cwd, generatedDir)}` });
  // Read what init wrote, before anything that depends on the port.
  const env = { ...readEnv(cwd), ...process.env } as Record<string, string | undefined>;
  // .env first, then the story-ui script — the same order update uses. Reading
  // only .env sent mui-material's check to 4001, where another project's
  // server answered, and reported it as this project's.
  const port = readConfiguredPort(cwd)?.port ?? Number(env.PORT || config.mcpPort || 4001);
  summary.port = port;

  // The `story-ui` script starts the server. It is the third place the port
  // lives, and init once wrote 4001 into it whatever .env said, so the
  // server came up where neither the docs page nor the manager was looking.
  {
    const scriptPortValue = readScriptPort(cwd);
    const hasScript = (() => { try { return typeof JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'))?.scripts?.['story-ui'] === 'string'; } catch { return false; } })();
    if (!hasScript) {
      items.push({ id: 'script-port', ok: null, detail: 'package.json has no "story-ui" script (npm run story-ui will not work; start the server with npx story-ui start)', fix: `npx story-ui update (adds "story-ui": "story-ui start --port ${port}")` });
    } else if (scriptPortValue === null) {
      items.push({ id: 'script-port', ok: false, detail: `the "story-ui" script names no --port, so npm run story-ui starts on 4001 while .env/manager-head expect ${port}`, fix: `npx story-ui update (sets --port ${port} in the script)` });
    } else if (scriptPortValue !== port) {
      items.push({ id: 'script-port', ok: false, detail: `the "story-ui" script starts the server on port ${scriptPortValue} but .env says ${port} — npm run story-ui would come up where the workspace is not looking`, fix: `npx story-ui update (rewrites the script's --port to ${port}), or set VITE_STORY_UI_PORT=${scriptPortValue} in .env` });
    } else {
      items.push({ id: 'script-port', ok: true, detail: `the "story-ui" script starts the server on port ${port}, the same as .env` });
    }
  }

  const mainPath = ['main.ts', 'main.tsx', 'main.js', 'main.mjs'].map(f => path.join(cwd, '.storybook', f)).find(f => fs.existsSync(f));
  if (mainPath) {
    const main = fs.readFileSync(mainPath, 'utf-8');
    // Does the file still parse? init splices text into it, and a splice
    // that broke it ("Expected } but found viteFinal") is invisible to every
    // other item here — they read the file as a string.
    const syntax = storybookMainSyntaxError(main, path.basename(mainPath));
    items.push({
      id: 'storybook-main-syntax', ok: !syntax,
      detail: syntax
        ? `.storybook/${path.basename(mainPath)}:${syntax.line}:${syntax.column} does not parse: ${syntax.message} — Storybook cannot start`
        : `.storybook/${path.basename(mainPath)} parses`,
      fix: syntax ? `open .storybook/${path.basename(mainPath)} at line ${syntax.line} and fix the syntax (a missing comma before a property init inserted is the usual cause)` : undefined,
    });
    const covered = storiesGlobCoversMdx(main);
    // Storybook's own scaffold quotes the key (`"stories": [`).
    const hasStories = /["']?stories["']?\s*:/.test(main);
    items.push({ id: 'storybook-globs', ok: hasStories ? covered : null, detail: !hasStories ? '.storybook/main has no stories array to inspect' : covered ? 'Storybook\'s stories globs include the Story UI MDX entries' : 'Storybook\'s stories globs do not cover the Story UI MDX entries', fix: covered ? undefined : 'add "../src/**/*.mdx" (or the StoryUI/StoryUIV2 paths) to stories in .storybook/main' });
    const managerFile = ['manager.ts', 'manager.tsx', 'manager.js'].map(f => path.join(cwd, '.storybook', f)).find(f => fs.existsSync(f));
    const wired = managerFile ? /StoryUI\/manager/.test(fs.readFileSync(managerFile, 'utf-8')) : false;
    items.push({ id: 'manager-addon', ok: wired ? true : null, detail: wired ? 'manager addon wired: the workspace opens at ?path=/workspace/' : 'manager addon not wired (Storybook 9+): the workspace is only available as the docs entry', fix: wired ? undefined : 'npx story-ui update, or add "import \'../src/stories/StoryUI/manager\';" to .storybook/manager.ts' });
    // The manager page cannot read .env; it reads the port from a <meta> in
    // manager-head.html. Without it, or with a stale one, the page talks to
    // port 4001 and shows whatever project's server is there as "Connected".
    const headPath = path.join(cwd, '.storybook', 'manager-head.html');
    const headPort = fs.existsSync(headPath) ? managerHeadPort(fs.readFileSync(headPath, 'utf-8')) : null;
    const headFix = `npx story-ui update (writes <meta name="story-ui-port" content="${port}"> into .storybook/manager-head.html)`;
    if (!wired) {
      items.push({ id: 'manager-head', ok: null, detail: headPort ? `manager-head.html names port ${headPort} (unused until the manager addon is wired)` : 'no manager-head.html port (not needed while the manager addon is not wired)' });
    } else if (!headPort) {
      items.push({ id: 'manager-head', ok: false, detail: `.storybook/manager-head.html has no story-ui-port meta — the workspace page would talk to port 4001, not ${port}`, fix: headFix });
    } else if (Number(headPort) !== port) {
      items.push({ id: 'manager-head', ok: false, detail: `.storybook/manager-head.html names port ${headPort} but the config/.env port is ${port} — the workspace page would talk to the wrong server`, fix: headFix });
    } else {
      items.push({ id: 'manager-head', ok: true, detail: `manager-head.html points the workspace page at port ${port}` });
    }
  } else {
    items.push({ id: 'storybook-globs', ok: false, detail: 'no .storybook/main.* found', fix: 'run this from the project that hosts Storybook' });
  }

  // 5. A provider key. A placeholder, "undefined", or a dozen characters
  // is a line, not a key; the server would start and every request fail.
  const keyName = PROVIDER_KEYS.find(k => isUsableApiKey(env[k]));
  const placeholderName = keyName ? undefined : PROVIDER_KEYS.find(k => env[k] !== undefined && env[k] !== '');
  items.push({
    id: 'provider-key', ok: Boolean(keyName),
    detail: keyName
      ? `${keyName} is set`
      : placeholderName
        ? `${placeholderName} is set to a placeholder or an invalid value ("${String(env[placeholderName]).slice(0, 12)}…" — not a key)`
        : 'no provider API key in .env or the environment',
    fix: keyName ? undefined : `put ${placeholderName || 'ANTHROPIC_API_KEY'}=<your real key> in .env (or OPENAI_API_KEY / GEMINI_API_KEY), or re-run npx story-ui init --api-key <key>`,
  });

  // 6. The server, if asked or if the config names a port.
  const server = opts.server || `http://localhost:${port}`;
  summary.server = server;
  try {
    const res = await fetch(`${server}/health`, { signal: AbortSignal.timeout(1500) });
    items.push({ id: 'server', ok: res.ok, detail: res.ok ? `server answering at ${server}` : `server at ${server} answered ${res.status}` });
  } catch {
    items.push({ id: 'server', ok: null, detail: `no server at ${server} (not running — start it with npm run story-ui)` });
  }

  const ok = items.every(i => i.ok !== false);
  return { ok, items, summary };
}

export async function checkCommand(opts: { server?: string; storybook?: string; json?: boolean } = {}): Promise<boolean> {
  if (opts.json) {
    // Nothing but the report on stdout: the config loader and discovery log
    // freely, and a script parsing this must not have to skip lines.
    process.env.STORY_UI_LOG_LEVEL = 'none';
    const saved = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };
    console.log = () => {}; console.info = () => {}; console.warn = () => {}; console.debug = () => {};
    let report: CheckReport;
    try { report = await runChecks({ server: opts.server, storybook: opts.storybook }); }
    finally { Object.assign(console, saved); }
    console.log(JSON.stringify(report, null, 2));
    return report.ok;
  }
  const report = await runChecks({ server: opts.server, storybook: opts.storybook });
  console.log(chalk.bold('\n🩺 Story UI check\n'));
  for (const i of report.items) {
    const mark = i.ok === true ? chalk.green('✔') : i.ok === false ? chalk.red('✖') : chalk.yellow('•');
    console.log(`${mark} ${i.detail}`);
    if (i.ok === false && i.fix) console.log(chalk.gray(`    fix: ${i.fix}`));
  }
  console.log('');
  console.log(report.ok ? chalk.green('Ready.') : chalk.red('Not ready — fix the items marked ✖.'));
  return report.ok;
}
