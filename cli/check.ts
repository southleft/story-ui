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
import { storiesGlobCoversMdx } from './setup.js';

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

export async function runChecks(opts: { server?: string; cwd?: string } = {}): Promise<CheckReport> {
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
  summary.componentsPath = config.componentsPath;

  // 2. Import path resolves: an npm package present, or a local directory.
  const importPath: string = config.importPath || '';
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    const dir = config.componentsPath || path.resolve(cwd, config.generatedStoriesPath || './src/stories/generated/', importPath);
    const exists = fs.existsSync(dir);
    items.push({ id: 'import-path', ok: exists, detail: exists ? `local components at ${path.relative(cwd, dir) || '.'}` : `local import path ${importPath} does not resolve to a directory`, fix: exists ? undefined : 'set componentsPath and importPath in story-ui.config.js to the component directory' });
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
  items.push({ id: 'generated-dir', ok: fs.existsSync(generatedDir), detail: fs.existsSync(generatedDir) ? `generated stories go to ${path.relative(cwd, generatedDir)}` : `${path.relative(cwd, generatedDir)} does not exist yet`, fix: fs.existsSync(generatedDir) ? undefined : `mkdir -p ${path.relative(cwd, generatedDir)}` });
  const mainPath = ['main.ts', 'main.tsx', 'main.js', 'main.mjs'].map(f => path.join(cwd, '.storybook', f)).find(f => fs.existsSync(f));
  if (mainPath) {
    const main = fs.readFileSync(mainPath, 'utf-8');
    const covered = storiesGlobCoversMdx(main);
    const hasStories = /stories\s*:/.test(main);
    items.push({ id: 'storybook-globs', ok: hasStories ? covered : null, detail: !hasStories ? '.storybook/main has no stories array to inspect' : covered ? 'Storybook\'s stories globs include the Story UI MDX entries' : 'Storybook\'s stories globs do not cover the Story UI MDX entries', fix: covered ? undefined : 'add "../src/**/*.mdx" (or the StoryUI/StoryUIV2 paths) to stories in .storybook/main' });
    const managerFile = ['manager.ts', 'manager.tsx', 'manager.js'].map(f => path.join(cwd, '.storybook', f)).find(f => fs.existsSync(f));
    const wired = managerFile ? /StoryUI\/manager/.test(fs.readFileSync(managerFile, 'utf-8')) : false;
    items.push({ id: 'manager-addon', ok: wired ? true : null, detail: wired ? 'manager addon wired: the workspace opens at ?path=/workspace/' : 'manager addon not wired (Storybook 9+): the workspace is only available as the docs entry', fix: wired ? undefined : 'npx story-ui update, or add "import \'../src/stories/StoryUI/manager\';" to .storybook/manager.ts' });
  } else {
    items.push({ id: 'storybook-globs', ok: false, detail: 'no .storybook/main.* found', fix: 'run this from the project that hosts Storybook' });
  }

  // 5. A provider key.
  const env = { ...readEnv(cwd), ...process.env } as Record<string, string | undefined>;
  const keyName = PROVIDER_KEYS.find(k => env[k] && !/your-.*-key|api-key-here/.test(env[k] as string));
  items.push({ id: 'provider-key', ok: Boolean(keyName), detail: keyName ? `${keyName} is set` : 'no provider API key in .env or the environment', fix: keyName ? undefined : 'put ANTHROPIC_API_KEY=… (or OPENAI_API_KEY / GEMINI_API_KEY) in .env' });

  // 6. The server, if asked or if the config names a port.
  const port = Number(env.VITE_STORY_UI_PORT || env.PORT || config.mcpPort || 4001);
  summary.port = port;
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

export async function checkCommand(opts: { server?: string; json?: boolean } = {}): Promise<boolean> {
  if (opts.json) {
    // Nothing but the report on stdout: the config loader and discovery log
    // freely, and a script parsing this must not have to skip lines.
    process.env.STORY_UI_LOG_LEVEL = 'none';
    const saved = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };
    console.log = () => {}; console.info = () => {}; console.warn = () => {}; console.debug = () => {};
    let report: CheckReport;
    try { report = await runChecks({ server: opts.server }); }
    finally { Object.assign(console, saved); }
    console.log(JSON.stringify(report, null, 2));
    return report.ok;
  }
  const report = await runChecks({ server: opts.server });
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
