#!/usr/bin/env node
/**
 * Smoke bench — every user-facing flow of the V2 workspace, driven through a
 * real browser against a running server + Storybook, per environment.
 *
 *   node bench/smoke.mjs [options] dir:mcpPort:sbPort [dir:mcpPort:sbPort ...]
 *
 * Options:
 *   --flows 1-5,8        which flows to run (default: all thirteen)
 *   --gen name,name      environments that also run the generation flows 6–13
 *                        (default: every environment). Others run 1–5 only.
 *   --out DIR            results root (default bench/results/smoke-<stamp>)
 *   --timeout SECONDS    per generation (default 360)
 *   --surface auto|manager|docs
 *                        where the workspace is driven from for flows 4+:
 *                        the manager page (?path=/workspace/) or the docs
 *                        entry inside the preview iframe. auto = manager when
 *                        the route renders, else docs (recorded as a note).
 *   --headed             show the browser
 *
 * Every flow yields PASS / FAIL / SKIP with a one-line reason; a FAIL also
 * gets a screenshot, the console errors and the 4xx/5xx responses seen while
 * it ran. Absent and zero look different: a flow that could not run is SKIP
 * with the reason, never a silent PASS.
 *
 * Playwright is the PROJECT's (verification uses the same one); when a
 * project lacks it, react-mantine's is used and the report says so. The bench
 * adds no dependency to any project and edits nothing outside its results
 * directory — the story files it creates are the ordinary output of using the
 * workspace, and are listed in the report so they can be removed.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MANTINE = path.resolve(ROOT, '../test-storybooks/react-mantine');

/* ------------------------------------------------------------------ args */

const args = process.argv.slice(2);
const opt = { flows: null, gen: null, out: null, timeout: 360, surface: 'auto', headed: false };
const envSpecs = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--flows') opt.flows = parseRange(args[++i]);
  else if (a === '--gen') opt.gen = args[++i].split(',').map(s => s.trim()).filter(Boolean);
  else if (a === '--out') opt.out = args[++i];
  else if (a === '--timeout') opt.timeout = Number(args[++i]);
  else if (a === '--surface') opt.surface = args[++i];
  else if (a === '--headed') opt.headed = true;
  else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30).join('\n')); process.exit(0); }
  else if (a.startsWith('--')) { console.error(`unknown option ${a}`); process.exit(2); }
  else envSpecs.push(a);
}
if (envSpecs.length === 0) { console.error('usage: node bench/smoke.mjs dir:mcpPort:sbPort ...'); process.exit(2); }

function parseRange(s) {
  const out = new Set();
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out;
}

const STAMP = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
const OUT = opt.out ? path.resolve(opt.out) : path.join(ROOT, 'bench', 'results', `smoke-${STAMP}`);
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'run.log');
const say = (...a) => {
  const line = `${new Date().toTimeString().slice(0, 8)} ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
};

const GEN_TIMEOUT = opt.timeout * 1000;
const PROMPT_NEW = 'A small card with a title, one line of text and a primary button';
const PROMPT_UPDATE = 'Center the title';
const PROMPT_RELOAD = 'A simple alert banner with a dismiss button';
const PROMPT_EDGE = 'Build a “Résumé” card 🎉';
const TEXTAREA = 'textarea[aria-label="Describe what to build"]';
const IS_MAC = process.platform === 'darwin';

/* ------------------------------------------------------------- helpers */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadPlaywright(dir) {
  for (const from of [dir, MANTINE]) {
    try {
      const req = createRequire(path.join(from, 'package.json'));
      const pw = req('playwright');
      const exe = pw.chromium.executablePath();
      if (fs.existsSync(exe)) return { pw, from, version: req('playwright/package.json').version };
    } catch { /* try the next */ }
  }
  return null;
}

async function readConfig(dir) {
  const file = ['story-ui.config.js', 'story-ui.config.mjs', 'story-ui.config.cjs'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
  if (!file) return null;
  try {
    const m = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
    return m.default || m;
  } catch (e) {
    // A CommonJS config in a "type": "module" project: load it as .cjs from a scratch copy.
    if (!/module is not defined|require is not defined/.test(String(e?.message))) throw e;
    const tmp = path.join(OUT, `.config-${path.basename(dir)}.cjs`);
    fs.copyFileSync(file, tmp);
    const req = createRequire(tmp);
    const m = req(tmp);
    return m.default || m;
  }
}

/**
 * Console errors Storybook's own manager prints when a SECOND preview iframe
 * (the workspace canvas, a Home thumbnail) sends channel events it cannot
 * attribute. Real, caused by Story UI's extra frames, but not a workspace
 * crash — reported as a warning so it does not hide other errors.
 */
const CHANNEL_NOISE = /unable to determine the source of the event/;
function splitErrors(errs) {
  const noise = errs.filter(t => CHANNEL_NOISE.test(t));
  const real = errs.filter(t => !CHANNEL_NOISE.test(t));
  return { noise, real };
}

function listStories(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const out = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!/\.stories\.(tsx|jsx|ts|js|vue|svelte)$/.test(f)) continue;
    const p = path.join(dir, f);
    out.set(f, fs.readFileSync(p, 'utf8'));
  }
  return out;
}

function newFiles(before, after) {
  return [...after.keys()].filter(f => !before.has(f));
}

function importsOf(code) {
  const out = [];
  const re = /^\s*import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}

const ICON_PACKAGES = [/^@tabler\/icons/, /^lucide-react/, /^@mui\/icons-material/, /^@carbon\/icons-react/, /^@atlaskit\/icon/, /^react-icons/, /^@radix-ui\/react-icons/, /^@heroicons/, /^@phosphor-icons/, /^@fortawesome/, /^@shopify\/polaris-icons/];
const ALLOWED_ALWAYS = [/^react(-dom)?(\/.*)?$/, /^@storybook\//, /^storybook(\/|$)/, /^@testing-library\//, /^vitest$/];

function checkImports(code, importPath, importStyle) {
  const specs = importsOf(code);
  const local = /^[./]/.test(importPath || '');
  const bad = [];
  for (const s of specs) {
    if (ALLOWED_ALWAYS.some(r => r.test(s))) continue;
    if (ICON_PACKAGES.some(r => r.test(s))) continue;
    if (/^\.\.?\//.test(s)) { if (local) continue; bad.push(s); continue; }
    if (/\.(css|scss|sass|less)$/.test(s)) continue;
    if (importPath && (s === importPath || s.startsWith(importPath + '/'))) continue;
    // a scope alone ("@atlaskit") means any package in the scope
    if (importPath && /^@[^/]+$/.test(importPath) && s.startsWith(importPath + '/')) continue;
    bad.push(s);
  }
  return { specs, bad };
}

async function pollFile(file, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (predicate(content)) return content;
    await sleep(300);
  }
  return null;
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/* --------------------------------------------------------- the runner */

class EnvRun {
  constructor(spec, pw) {
    const [dir, mcp, sb] = spec.split(':');
    this.dir = path.resolve(dir);
    this.name = path.basename(this.dir);
    this.mcp = Number(mcp);
    this.sb = Number(sb);
    this.sbUrl = `http://localhost:${this.sb}`;
    this.mcpUrl = `http://localhost:${this.mcp}`;
    this.pw = pw;
    this.results = [];
    this.notes = [];
    this.outDir = path.join(OUT, this.name);
    fs.mkdirSync(this.outDir, { recursive: true });
    this.consoleErrors = [];
    this.netErrors = [];
    this.surface = 'manager';
    this.state = {}; // story file names etc, carried between flows
  }

  note(s) { this.notes.push(s); say(`    note: ${s}`); }

  attach(page) {
    page.on('console', m => {
      if (m.type() === 'error') this.consoleErrors.push({ t: Date.now(), text: m.text().slice(0, 600), url: m.location()?.url });
    });
    page.on('pageerror', e => this.consoleErrors.push({ t: Date.now(), text: `pageerror: ${String(e?.message || e).slice(0, 600)}` }));
    page.on('response', r => {
      const s = r.status();
      if (s >= 400) this.netErrors.push({ t: Date.now(), status: s, url: r.url().slice(0, 300), method: r.request().method() });
    });
    page.on('requestfailed', r => {
      const f = r.failure()?.errorText || '';
      if (/aborted/i.test(f)) return; // navigations abort in-flight fetches; not a defect
      this.netErrors.push({ t: Date.now(), status: 'failed', url: r.url().slice(0, 300), method: r.method(), error: f });
    });
  }

  /** Locators against the surface the workspace is driven from. */
  $(sel) { return this.surface === 'docs' ? this.page.frameLocator('#storybook-preview-iframe').locator(sel) : this.page.locator(sel); }

  /** Storybook's own preview iframe inside the workspace canvas. */
  canvasFrame() {
    return this.surface === 'docs'
      ? this.page.frameLocator('#storybook-preview-iframe').frameLocator('.suiw-canvas-body iframe')
      : this.page.frameLocator('.suiw-canvas-body iframe');
  }

  async run(flows, gen) {
    const { chromium } = this.pw.pw;
    this.browser = await chromium.launch({ headless: !opt.headed });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 900 } });
    this.page = await this.context.newPage();
    this.attach(this.page);
    this.config = await readConfig(this.dir).catch(e => { this.note(`config failed to load: ${e.message}`); return null; });
    const gp = this.config?.generatedStoriesPath || './src/stories/generated/';
    this.generatedDir = path.isAbsolute(gp) ? gp : path.resolve(this.dir, gp);
    say(`  importPath=${this.config?.importPath} generated=${path.relative(this.dir, this.generatedDir)} playwright=${this.pw.version} from ${path.basename(this.pw.from)}`);

    const table = [
      [1, 'manager page renders (focus true/false)', () => this.flow1()],
      [2, 'docs-page entry renders', () => this.flow2()],
      [3, 'classic panel renders', () => this.flow3()],
      [4, 'header: components drawer, switcher, New', () => this.flow4()],
      [5, 'composer: attach, settings, send, mic', () => this.flow5()],
      [6, 'generation', () => this.flow6()],
      [7, 'update with diff', () => this.flow7()],
      [8, 'select + inspector edit/undo', () => this.flow8()],
      [9, 'history + Cmd/Ctrl+Z', () => this.flow9()],
      [10, 'switcher actions: open, hand off, delete', () => this.flow10()],
      [11, 'home: recent work thumbnail', () => this.flow11()],
      [12, 'reload mid-generation recovers', () => this.flow12()],
      [13, 'emoji + quotes prompt', () => this.flow13()],
    ];
    for (const [n, title, fn] of table) {
      if (flows && !flows.has(n)) continue;
      if (n >= 6 && !gen) { this.record(n, title, 'SKIP', 'generation flows not selected for this environment'); continue; }
      const started = Date.now();
      const ce0 = this.consoleErrors.length; const ne0 = this.netErrors.length;
      let status = 'PASS', reason = '';
      try {
        const r = await fn();
        if (r && r.status) { status = r.status; reason = r.reason || ''; }
        else if (typeof r === 'string') reason = r;
      } catch (e) {
        status = e?.status || 'FAIL';
        reason = e?.status ? e.reason : `threw: ${String(e?.message || e).split('\n')[0].slice(0, 300)}`;
      }
      const evidence = {
        console: this.consoleErrors.slice(ce0).map(x => x.text),
        network: this.netErrors.slice(ne0).map(x => `${x.status} ${x.method} ${x.url}${x.error ? ' ' + x.error : ''}`),
      };
      let screenshot = null;
      if (status === 'FAIL') {
        screenshot = path.join(this.outDir, `flow-${String(n).padStart(2, '0')}-${slug(title)}.png`);
        try { await this.page.screenshot({ path: screenshot, fullPage: false }); } catch (e) { screenshot = `screenshot failed: ${e.message}`; }
      }
      this.record(n, title, status, reason, { evidence, screenshot, ms: Date.now() - started });
    }
    await this.browser.close().catch(() => {});
  }

  record(n, title, status, reason, extra = {}) {
    this.results.push({ flow: n, title, status, reason, ...extra });
    say(`  [${status}] ${n}. ${title}${reason ? ' — ' + reason : ''}${extra.ms ? ` (${(extra.ms / 1000).toFixed(1)}s)` : ''}`);
  }

  fail(reason) { const e = new Error(reason); e.status = 'FAIL'; e.reason = reason; return e; }
  skip(reason) { const e = new Error(reason); e.status = 'SKIP'; e.reason = reason; return e; }

  /** Console errors since a mark, formatted for a reason line. */
  errorsSince(mark) { return this.consoleErrors.slice(mark).map(x => x.text); }

  async gotoManager(focus) {
    const url = `${this.sbUrl}/?path=/workspace/`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await this.page.evaluate(v => {
      if (v === null) localStorage.removeItem('story-ui-focus'); else localStorage.setItem('story-ui-focus', v);
      sessionStorage.removeItem('story-ui-v2-pending');
    }, focus);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  async workspaceReady(timeout = 60_000) {
    await this.$('.suiw-root').first().waitFor({ state: 'visible', timeout });
    await this.$(TEXTAREA).first().waitFor({ state: 'visible', timeout });
    // Send is gated on the server probe; "Connected" means the workspace can act.
    await this.$('.suiw-conn').filter({ hasText: 'Connected' }).first().waitFor({ state: 'visible', timeout }).catch(() => {});
  }

  /** Open the workspace on the chosen surface, on Home (no story open). */
  async openWorkspace() {
    if (this.surface === 'manager') {
      await this.gotoManager(null);
      try { await this.workspaceReady(45_000); return; }
      catch (e) {
        if (opt.surface === 'manager') throw this.fail(`manager page never rendered the workspace: ${e.message.split('\n')[0]}`);
        this.note('manager route ?path=/workspace/ did not render; driving the docs entry instead');
        this.surface = 'docs';
      }
    }
    await this.page.goto(`${this.sbUrl}/?path=/docs/story-ui-workspace--docs`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await this.workspaceReady(90_000);
  }

  /** Go Home whichever screen is showing. */
  async goHome() {
    // Flows can be selected individually: make sure the workspace is open at all.
    if (!(await this.$('.suiw-root').count())) await this.openWorkspace();
    const nw = this.$('.suiw-new');
    if (await nw.count()) { await nw.first().click(); }
    await this.$(TEXTAREA).first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Type a prompt, send it, wait for Stop then for Send to come back. */
  async generate(prompt, { expectStop = true, afterStart } = {}) {
    const ta = this.$(TEXTAREA).first();
    await ta.fill(prompt);
    const send = this.$('[aria-label="Send"]').first();
    await send.waitFor({ state: 'visible', timeout: 10_000 });
    const started = Date.now();
    const enabled = await send.isEnabled();
    if (!enabled) {
      const gate = await this.$('.suiw-gate').first().textContent().catch(() => '');
      throw this.fail(`Send stayed disabled with text in the box${gate ? ` — gate says: ${gate.trim().slice(0, 160)}` : ''}`);
    }
    await send.click();
    let stopSeen = false;
    if (expectStop) {
      try { await this.$('[aria-label="Stop"]').first().waitFor({ state: 'visible', timeout: 20_000 }); stopSeen = true; }
      catch { /* the run may have ended before we looked */ }
    }
    if (afterStart) await afterStart();
    await this.$('[aria-label="Send"]').first().waitFor({ state: 'visible', timeout: GEN_TIMEOUT });
    // busy is off once Send is back; give the turn's badge a moment to land
    await sleep(800);
    return { ms: Date.now() - started, stopSeen };
  }

  async lastAssistantText() {
    const bodies = this.$('.suiw-turn--assistant .suiw-turn-body');
    const n = await bodies.count();
    return n ? (await bodies.nth(n - 1).textContent() || '').trim() : '';
  }

  async alertText() {
    const a = this.$('[role="alert"]');
    return (await a.count()) ? (await a.first().textContent() || '').trim().slice(0, 300) : '';
  }

  async iframeStoryId(timeout = 30_000) {
    const frame = this.$('.suiw-canvas-body iframe').first();
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await frame.count()) {
        // The canvas navigates its frame with location.replace, so the `src`
        // attribute is usually empty; the frame's own location is the truth.
        const href = await frame.evaluate(el => { try { return el.contentWindow?.location?.href || el.getAttribute('src') || ''; } catch { return el.getAttribute('src') || ''; } }).catch(() => '');
        const m = href && href.match(/[?&]id=([^&]+)/);
        if (m) return decodeURIComponent(m[1]);
      }
      await sleep(400);
    }
    return null;
  }

  /** Did the story actually render in the canvas frame? Storybook's error display counts as no. */
  async previewRendered(timeout = 15_000) {
    const frame = this.canvasFrame();
    const started = Date.now();
    let last = { hasContent: false, error: '' };
    while (Date.now() - started < timeout) {
      try {
        const err = frame.locator('.sb-errordisplay, #error-message');
        if (await err.count() && await err.first().isVisible()) {
          last = { hasContent: false, error: ((await err.first().textContent()) || '').replace(/\s+/g, ' ').trim().slice(0, 200) };
          return last;
        }
        const root = frame.locator('#storybook-root');
        if (await root.count()) {
          const n = await root.first().evaluate(el => el.childElementCount).catch(() => 0);
          if (n > 0) return { hasContent: true, error: '' };
        }
      } catch { /* frame mid-navigation */ }
      await sleep(500);
    }
    return last;
  }

  /* ------------------------------------------------------------ flows */

  async flow1() {
    if (opt.surface === 'docs') throw this.skip('--surface docs');
    const problems = []; const warns = [];
    // Each state in a FRESH context: Storybook persists its own layout, so a
    // sidebar folded by focus=true must not leak into the focus=false check.
    for (const focus of ['true', 'false']) {
      const ctx = await this.browser.newContext({ viewport: { width: 1440, height: 900 } });
      // The preference must exist BEFORE the first load: a first load without
      // it folds the sidebar (focus defaults on) and Storybook persists that
      // layout, which a later focus=false has nothing to restore from.
      await ctx.addInitScript(v => { try { if (!localStorage.getItem('story-ui-focus')) localStorage.setItem('story-ui-focus', v); } catch {} }, focus);
      const page = await ctx.newPage();
      this.attach(page);
      const mark = this.consoleErrors.length;
      const url = `${this.sbUrl}/?path=/workspace/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      let box = null;
      try {
        await page.locator('.suiw-root').first().waitFor({ state: 'visible', timeout: 45_000 });
        await page.locator(TEXTAREA).first().waitFor({ state: 'visible', timeout: 45_000 });
        box = await page.locator('.suiw-root').first().boundingBox();
        if (!box || box.width < 1 || box.height < 1) problems.push(`focus=${focus}: .suiw-root rect is ${JSON.stringify(box)}`);
        const tree = page.locator('#storybook-explorer-tree');
        const sidebarVisible = (await tree.count()) ? await tree.first().isVisible() : false;
        if (focus === 'true' && sidebarVisible) problems.push('focus=true: Storybook sidebar is still visible');
        if (focus === 'false' && !sidebarVisible) problems.push('focus=false: Storybook sidebar is hidden (#storybook-explorer-tree not visible)');
        await sleep(2000);
      } catch (e) { problems.push(`focus=${focus}: workspace never rendered (${e.message.split('\n')[0].slice(0, 120)})`); }
      const { noise, real } = splitErrors(this.errorsSince(mark));
      if (real.length) problems.push(`focus=${focus}: ${real.length} console error(s): ${real.slice(0, 2).map(s => s.slice(0, 200)).join(' || ')}`);
      if (noise.length) warns.push(`focus=${focus}: ${noise.length} Storybook channel warnings ("unable to determine the source of the event")`);
      await page.screenshot({ path: path.join(this.outDir, `flow-01-focus-${focus}.png`) }).catch(() => {});
      this.state[`focus-${focus}-box`] = box;
      await ctx.close().catch(() => {});
    }
    if (problems.length) throw this.fail([...problems, ...warns].join(' | '));
    const sz = b => b ? `${Math.round(b.width)}×${Math.round(b.height)}` : '?';
    return `rect ${sz(this.state['focus-true-box'])} (focus) / ${sz(this.state['focus-false-box'])} (sidebar shown)${warns.length ? '; WARN ' + warns.join('; ') : ''}`;
  }

  async flow2() {
    const mark = this.consoleErrors.length;
    await this.page.goto(`${this.sbUrl}/?path=/docs/story-ui-workspace--docs`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const frame = this.page.frameLocator('#storybook-preview-iframe');
    try { await frame.locator(TEXTAREA).first().waitFor({ state: 'visible', timeout: 90_000 }); }
    catch (e) {
      const body = await frame.locator('body').textContent().catch(() => '');
      throw this.fail(`textarea never appeared in the docs page: ${e.message.split('\n')[0].slice(0, 120)}; body starts "${(body || '').trim().slice(0, 120)}"`);
    }
    await sleep(1500);
    const { noise, real } = splitErrors(this.errorsSince(mark));
    if (real.length) throw this.fail(`${real.length} console error(s): ${real.slice(0, 2).map(s => s.slice(0, 200)).join(' || ')}`);
    return noise.length ? `WARN ${noise.length} Storybook channel warnings` : '';
  }

  async flow3() {
    const mark = this.consoleErrors.length;
    await this.page.goto(`${this.sbUrl}/?path=/docs/story-ui-story-generator--docs`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const frame = this.page.frameLocator('#storybook-preview-iframe');
    try { await frame.locator('textarea, [aria-label="Chat history"]').first().waitFor({ state: 'visible', timeout: 90_000 }); }
    catch (e) {
      const body = await frame.locator('body').textContent().catch(() => '');
      throw this.fail(`classic panel never rendered: ${e.message.split('\n')[0].slice(0, 120)}; body starts "${(body || '').trim().slice(0, 120)}"`);
    }
    await sleep(1500);
    const { noise, real } = splitErrors(this.errorsSince(mark));
    if (real.length) throw this.fail(`${real.length} console error(s): ${real.slice(0, 2).map(s => s.slice(0, 200)).join(' || ')}`);
    return noise.length ? `WARN ${noise.length} Storybook channel warnings` : '';
  }

  async flow4() {
    await this.openWorkspace();
    const notes = [];
    // Components drawer
    const comp = this.$('.suiw-header button').filter({ hasText: 'Components' }).first();
    await comp.waitFor({ state: 'visible', timeout: 15_000 });
    try { await comp.click({ timeout: 15_000 }); }
    catch (e) { throw this.fail(`Components button not clickable (disabled until Connected?): ${e.message.split('\n')[0].slice(0, 120)}`); }
    const dialog = this.$('[role="dialog"]').filter({ hasText: 'Components' }).first();
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    const rows = this.$('[role="list"][aria-label="Discovered components"] [role="listitem"]');
    const started = Date.now();
    let n = 0;
    while (Date.now() - started < 30_000) { n = await rows.count(); if (n > 0) break; await sleep(400); }
    if (n === 0) {
      const txt = (await dialog.textContent() || '').trim().slice(0, 200);
      throw this.fail(`Components drawer lists no components after 30s; dialog text: "${txt}"`);
    }
    notes.push(`drawer lists ${n} components`);
    await this.page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

    // Story switcher: needs an open story
    const cards = this.$('.suiw-recent-card');
    if (await cards.count()) {
      await cards.first().click();
      const sw = this.$('.suiw-switcher').first();
      await sw.waitFor({ state: 'visible', timeout: 20_000 });
      await sw.click();
      const find = this.$('input[aria-label="Find a story"]').first();
      await find.waitFor({ state: 'visible', timeout: 5_000 });
      const total = await this.$('[role="listbox"][aria-label="Stories"] [role="option"]').count();
      await find.fill('zzqqxx-no-such-story');
      await this.$('.suiw-switcher-empty').first().waitFor({ state: 'visible', timeout: 5_000 });
      await find.fill('');
      const back = await this.$('[role="listbox"][aria-label="Stories"] [role="option"]').count();
      if (back < 1) throw this.fail('switcher lists no stories after clearing the search');
      notes.push(`switcher lists ${total} stories, search filters`);
      await this.page.keyboard.press('Escape');
      const nw = this.$('.suiw-new');
      if (!(await nw.count()) || !(await nw.first().isVisible())) throw this.fail('"+ New" is not in the header while a story is open');
      notes.push('New visible');
      await this.goHome();
    } else {
      notes.push('switcher: no story in this project yet (covered by flow 10 after generation)');
    }
    return notes.join('; ');
  }

  async flow5() {
    await this.goHome();
    const notes = [];
    // "+" opens a file chooser
    const plus = this.$('[aria-label="Attach images or files"]').first();
    await plus.waitFor({ state: 'visible', timeout: 10_000 });
    const chooser = await Promise.all([
      this.page.waitForEvent('filechooser', { timeout: 8_000 }).catch(() => null),
      plus.click(),
    ]).then(r => r[0]);
    if (!chooser) throw this.fail('"+" did not open a file chooser within 8s');
    notes.push('file chooser opened');
    // gear
    const gear = this.$('[aria-label="Generation settings"]').first();
    await gear.click();
    const pop = this.$('.suiw-settings').first();
    await pop.waitFor({ state: 'visible', timeout: 5_000 });
    const txt = (await pop.textContent()) || '';
    if (!/Generation settings/.test(txt)) throw this.fail(`settings popover has no "Generation settings" heading; text: "${txt.trim().slice(0, 120)}"`);
    const hasProvider = await this.$('#suiw-provider').count();
    const hasModel = await this.$('#suiw-model').count();
    if (!hasProvider || !hasModel) throw this.fail(`settings popover lacks ${!hasProvider ? 'Provider' : ''}${!hasProvider && !hasModel ? ' and ' : ''}${!hasModel ? 'Model' : ''} select; text: "${txt.trim().slice(0, 160)}"`);
    const provider = (await this.$('#suiw-provider').first().textContent() || '').trim();
    const model = (await this.$('#suiw-model').first().textContent() || '').trim();
    notes.push(`settings: provider=${provider || '(blank)'} model=${model || '(blank)'}`);
    if (!provider || !model) notes.push('WARN: a settings select shows no value');
    await this.page.keyboard.press('Escape');
    await pop.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    // Send disabled when empty
    await this.$(TEXTAREA).first().fill('');
    const send = this.$('[aria-label="Send"]').first();
    if (await send.isEnabled()) throw this.fail('Send is enabled with an empty prompt');
    notes.push('Send disabled when empty');
    // microphone
    const mic = this.$('[aria-label="Dictate"], [aria-label="Stop dictating"]').first();
    if (!(await mic.count())) throw this.fail('microphone button is missing from the composer');
    const micEnabled = await mic.isEnabled();
    if (!micEnabled) {
      await mic.hover({ force: true }).catch(() => {});
      const tip = this.$('[role="tooltip"]').first();
      const tipText = await tip.textContent({ timeout: 3_000 }).catch(() => '');
      if (!tipText) {
        // Radix puts the tooltip on the trigger's wrapper; a disabled button swallows hover. Try the parent.
        await mic.locator('..').hover({ force: true }).catch(() => {});
        const t2 = await tip.textContent({ timeout: 3_000 }).catch(() => '');
        if (!t2) throw this.fail('microphone is disabled and no tooltip explains why');
        notes.push(`mic disabled, tooltip: "${t2.trim().slice(0, 80)}"`);
      } else notes.push(`mic disabled, tooltip: "${tipText.trim().slice(0, 80)}"`);
    } else notes.push('mic enabled');
    return notes.join('; ');
  }

  async flow6() {
    await this.goHome();
    const before = listStories(this.generatedDir);
    const mark = this.consoleErrors.length;
    const { ms, stopSeen } = await this.generate(PROMPT_NEW);
    const problems = [];
    if (!stopSeen) problems.push('Stop button never appeared');
    const alert = await this.alertText();
    if (alert) problems.push(`error callout: "${alert}"`);
    const storyId = await this.iframeStoryId(30_000);
    if (!storyId) problems.push('preview iframe has no story id in its src after 30s');
    else {
      this.state.storyId = storyId;
      // The frame navigating to the story is not the story rendering.
      const render = await this.previewRendered();
      if (render.error) problems.push(`preview shows a Storybook error: "${render.error}"`);
      else if (!render.hasContent) problems.push('preview #storybook-root is empty');
    }
    const badges = this.$('.suiw-verify .rt-Badge');
    const nb = await badges.count();
    const badge = nb ? (await badges.nth(nb - 1).textContent() || '').trim() : '';
    if (!/Verified|issue|Not verified/i.test(badge)) problems.push(`verification badge missing or unexpected: "${badge}"`);
    const summary = (await this.$('.suiw-steps-summary').first().textContent().catch(() => '')) || '';
    if (!/\d+ steps?/.test(summary) || !/(Show|Hide) steps/.test(summary)) problems.push(`steps summary line missing or malformed: "${summary.trim()}"`);
    const reply = await this.lastAssistantText();
    if (!reply) problems.push('assistant reply bubble is empty');
    const after = listStories(this.generatedDir);
    const created = newFiles(before, after);
    if (created.length === 0) problems.push(`no new story file in ${path.relative(this.dir, this.generatedDir)}`);
    else {
      if (created.length > 1) problems.push(`${created.length} new files for one generation: ${created.join(', ')}`);
      const file = created[0];
      this.state.file = path.join(this.generatedDir, file);
      this.state.fileName = file;
      const { specs, bad } = checkImports(after.get(file), this.config?.importPath, this.config?.importStyle);
      this.state.imports = specs;
      if (bad.length) problems.push(`imports outside the design system: ${bad.join(', ')}`);
    }
    const errs = this.errorsSince(mark);
    const note = `${(ms / 1000).toFixed(0)}s, badge "${badge}", file ${this.state.fileName || '-'}, imports: ${(this.state.imports || []).join(', ')}${errs.length ? `; ${errs.length} console error(s) during the run` : ''}`;
    this.state.gen6 = note;
    if (problems.length) throw this.fail(`${problems.join(' | ')} (${note})`);
    return note;
  }

  async flow7() {
    if (!this.state.file) throw this.skip('no story from flow 6');
    const before = listStories(this.generatedDir);
    const linesBefore = fs.readFileSync(this.state.file, 'utf8').split('\n').length;
    const { ms } = await this.generate(PROMPT_UPDATE);
    const problems = [];
    const alert = await this.alertText();
    if (alert) problems.push(`error callout: "${alert}"`);
    const after = listStories(this.generatedDir);
    const created = newFiles(before, after);
    if (created.length) problems.push(`update created new file(s) instead of editing ${this.state.fileName}: ${created.join(', ')}`);
    const turnDiff = this.$('.suiw-turn-diff');
    const seg = this.$('.rt-SegmentedControlItem').filter({ hasText: 'Changes' });
    const hasTurnDiff = await turnDiff.count();
    const hasSeg = await seg.count();
    if (!hasTurnDiff && !hasSeg) problems.push('no Changes segment and no diff line in the thread');
    let changed = 0;
    if (hasSeg) {
      await seg.first().click();
      const lines = this.$('.suiw-diff-line--add, .suiw-diff-line--del');
      await lines.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      changed = await lines.count();
      if (changed < 1) problems.push('Changes view shows no changed lines');
      const prev = this.$('.rt-SegmentedControlItem').filter({ hasText: 'Preview' }).first();
      if (await prev.count()) await prev.click();
    } else if (hasTurnDiff) {
      await turnDiff.locator('button', { hasText: 'Show changes' }).first().click().catch(() => {});
      changed = await this.$('.suiw-diff-line--add, .suiw-diff-line--del').count();
      if (changed < 1) problems.push('"Show changes" opened no diff lines');
    }
    const linesAfter = fs.readFileSync(this.state.file, 'utf8').split('\n').length;
    const drift = Math.abs(linesAfter - linesBefore) / Math.max(1, linesBefore);
    if (drift >= 0.10) problems.push(`file went from ${linesBefore} to ${linesAfter} lines (${(drift * 100).toFixed(0)}%) for "Center the title"`);
    const describe = hasTurnDiff ? (await turnDiff.first().textContent() || '').trim() : '';
    const note = `${(ms / 1000).toFixed(0)}s, ${changed} changed lines in the diff view, ${linesBefore}→${linesAfter} lines${describe ? `, thread: "${describe.slice(0, 80)}"` : ''}`;
    if (problems.length) throw this.fail(`${problems.join(' | ')} (${note})`);
    return note;
  }

  async flow8() {
    if (!this.state.file) throw this.skip('no story from flow 6');
    const original = fs.readFileSync(this.state.file, 'utf8');
    const select = this.$('.suiw-toolbar button').filter({ hasText: 'Select' }).first();
    await select.waitFor({ state: 'visible', timeout: 10_000 });
    if (!(await select.isEnabled())) throw this.fail('Select button is disabled with a story in the preview');
    await select.click();
    const frame = this.canvasFrame();
    // The preview document has Storybook's own hidden buttons before the story's; take the first VISIBLE one under the story root.
    let button = frame.locator('#storybook-root button:visible').first();
    try { await button.waitFor({ state: 'visible', timeout: 15_000 }); }
    catch {
      button = frame.locator('button:visible').first();
      try { await button.waitFor({ state: 'visible', timeout: 5_000 }); }
      catch { throw this.fail(`no visible <button> in the rendered story to select (frame has ${await frame.locator('button').count()} button elements)`); }
    }
    try { await button.click({ timeout: 5_000 }); }
    catch { await button.click({ force: true, timeout: 5_000 }); }
    const aside = this.$('aside[aria-label="Inspector"]').first();
    try { await aside.waitFor({ state: 'visible', timeout: 15_000 }); }
    catch { throw this.fail('inspector did not open after clicking a button in the preview'); }
    // wait for props (or the "no props" sentence)
    const started = Date.now();
    let nProps = 0;
    while (Date.now() - started < 25_000) {
      nProps = await aside.locator('.suiw-prop').count();
      const txt = (await aside.textContent()) || '';
      if (nProps > 0 || /declares no directly editable|Could not|error/i.test(txt) && !/Reading properties/.test(txt)) break;
      await sleep(400);
    }
    const asideText = ((await aside.textContent()) || '').trim();
    if (nProps === 0) throw this.fail(`inspector opened with no props; text: "${asideText.slice(0, 200)}"`);
    const chip = (await this.$('.suiw-selection-row .rt-Badge').first().textContent().catch(() => '') || '').trim();
    const notes = [`inspector: ${nProps} props for "${chip}"`];
    const enumProp = aside.locator('.suiw-prop').filter({ has: aside.locator('.rt-SelectTrigger') }).first();
    if (!(await enumProp.count())) {
      await this.$('[aria-label="Close inspector"]').first().click();
      return { status: 'PASS', reason: notes.join('; ') + '; no enum prop offered, edit not exercised' };
    }
    const propName = (await enumProp.locator('.rt-Text').first().textContent() || '').trim();
    const trigger = enumProp.locator('.rt-SelectTrigger').first();
    const currentLabel = (await trigger.textContent() || '').trim();
    await trigger.click();
    const options = this.$('[role="option"]');
    await options.first().waitFor({ state: 'visible', timeout: 5_000 });
    const labels = [];
    const n = await options.count();
    for (let i = 0; i < n; i++) labels.push((await options.nth(i).textContent() || '').trim());
    const pick = labels.find(l => l && !/^— default —$/.test(l) && l !== currentLabel);
    if (!pick) { await this.page.keyboard.press('Escape'); throw this.fail(`enum ${propName} offers no alternative value (options: ${labels.join(', ')})`); }
    await options.filter({ hasText: new RegExp(`^${pick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click();
    const status = this.$('.suiw-inspector-status').first();
    let statusText = '';
    try {
      await this.$('.suiw-inspector-status').filter({ hasText: /Applied ·/ }).first().waitFor({ state: 'visible', timeout: 10_000 });
      statusText = (await status.textContent() || '').trim();
    } catch {
      const t = (await status.textContent().catch(() => '')) || '';
      throw this.fail(`no "Applied ·" status within 10s after choosing ${propName}=${pick}; status: "${t.trim()}"; inspector: "${asideText.slice(0, 160)}"`);
    }
    notes.push(`set ${propName}=${pick}: ${statusText.replace(/Undo$/, '').trim()}`);
    const valueRe = new RegExp(`${propName}\\s*=\\s*(["'{])\\s*["']?${pick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const onDisk = await pollFile(this.state.file, c => c && valueRe.test(c), 5_000);
    if (!onDisk) throw this.fail(`file does not contain ${propName}=${pick} after "Applied" (${notes.join('; ')})`);
    // Undo
    const undo = status.locator('button', { hasText: 'Undo' }).first();
    if (!(await undo.count())) throw this.fail(`no Undo after apply (status: "${statusText}")`);
    await undo.click();
    const t0 = Date.now(); let after = statusText;
    while (Date.now() - t0 < 10_000) { after = (await status.textContent().catch(() => '')) || ''; if (after.trim() !== statusText && !/Applying/.test(after)) break; await sleep(300); }
    if (after.trim() === statusText) throw this.fail('status did not change after Undo');
    const reverted = await pollFile(this.state.file, c => c === original, 8_000);
    if (!reverted) {
      const now = fs.readFileSync(this.state.file, 'utf8');
      const stillHas = valueRe.test(now);
      throw this.fail(`file did not revert after Undo (${stillHas ? `still contains ${propName}=${pick}` : 'content differs from the pre-edit file'}; status now "${after.trim()}")`);
    }
    notes.push(`undo: "${after.trim().slice(0, 60)}", file reverted`);
    await this.$('[aria-label="Close inspector"]').first().click();
    await aside.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => { throw this.fail('× did not close the inspector'); });
    return notes.join('; ');
  }

  async flow9() {
    if (!this.state.file) throw this.skip('no story from flow 6');
    const hist = this.$('.suiw-history-trigger').first();
    await hist.waitFor({ state: 'visible', timeout: 10_000 });
    if (!(await hist.isEnabled())) throw this.fail('History button is disabled with a story open');
    await hist.click();
    const heading = this.$('text=Earlier versions').first();
    await heading.waitFor({ state: 'visible', timeout: 5_000 });
    const rows = this.$('text=/^v\\d+$/');
    const t0 = Date.now(); let n = 0;
    while (Date.now() - t0 < 10_000) { n = await rows.count(); if (n >= 2) break; await sleep(300); }
    const popText = (await this.$('[data-radix-popper-content-wrapper], .rt-PopoverContent').last().textContent().catch(() => '')) || '';
    if (n < 2) { await this.page.keyboard.press('Escape'); throw this.fail(`history lists ${n} version(s) after an update and a prop edit; popover: "${popText.trim().slice(0, 160)}"`); }
    await this.page.keyboard.press('Escape');
    await heading.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    const before = fs.readFileSync(this.state.file, 'utf8');
    const turnsBefore = await this.$('.suiw-turn--assistant').count();
    // focus nothing text-like
    await this.page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur(); });
    if (this.surface === 'docs') await this.page.frameLocator('#storybook-preview-iframe').locator('.suiw-toolbar').first().click({ position: { x: 2, y: 2 } }).catch(() => {});
    await this.page.keyboard.press(IS_MAC ? 'Meta+z' : 'Control+z');
    const changed = await pollFile(this.state.file, c => c !== null && c !== before, 15_000);
    const restoredTurn = this.$('.suiw-turn--assistant .suiw-turn-body').filter({ hasText: /Restored version|Could not restore/ }).last();
    const turnText = (await restoredTurn.textContent({ timeout: 5_000 }).catch(() => '')) || '';
    if (!changed) throw this.fail(`file unchanged 15s after ${IS_MAC ? 'Cmd' : 'Ctrl'}+Z (${n} versions listed; thread: "${turnText.trim().slice(0, 120) || 'no restore message'}")`);
    const turnsAfter = await this.$('.suiw-turn--assistant').count();
    return `${n} versions listed; undo restored (${turnText.trim().slice(0, 80) || `thread grew ${turnsBefore}→${turnsAfter}`})`;
  }

  async flow10() {
    if (!this.state.file) throw this.skip('no story from flow 6');
    const notes = [];
    const sw = this.$('.suiw-switcher').first();
    await sw.waitFor({ state: 'visible', timeout: 10_000 });
    const openSwitcher = async () => {
      if (!(await this.$('input[aria-label="Find a story"]').count())) { await sw.click(); await this.$('input[aria-label="Find a story"]').first().waitFor({ state: 'visible', timeout: 5_000 }); }
    };
    await openSwitcher();
    const find = this.$('input[aria-label="Find a story"]').first();
    await find.fill('zzqqxx-no-such-story');
    await this.$('.suiw-switcher-empty').first().waitFor({ state: 'visible', timeout: 5_000 });
    await find.fill('');
    notes.push('search filters');
    // Open in Storybook
    // The id the FILE declares is the truth; the iframe only has it once the story rendered.
    const declared = (fs.readFileSync(this.state.file, 'utf8').match(/^\s*id:\s*['"]([^'"]+)['"]/m) || [])[1];
    const storyId = this.state.storyId || await this.iframeStoryId(5_000) || declared;
    const openBtn = this.$('.suiw-switcher-actions button').filter({ hasText: 'Open in Storybook' }).first();
    if (!(await openBtn.isEnabled())) throw this.fail('"Open in Storybook" is disabled with a story open');
    const [popup] = await Promise.all([
      this.context.waitForEvent('page', { timeout: 10_000 }).catch(() => null),
      openBtn.click(),
    ]);
    if (!popup) throw this.fail('"Open in Storybook" opened no new page within 10s');
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const url = popup.url();
    await popup.close().catch(() => {});
    if (!storyId || !url.includes(encodeURIComponent(storyId)) && !url.includes(storyId)) throw this.fail(`new page url "${url}" does not contain the story id "${storyId}"`);
    notes.push('Open in Storybook → new tab with the id');
    // Hand off
    await openSwitcher();
    const hand = this.$('.suiw-switcher-actions button').filter({ hasText: 'Hand off' }).first();
    await hand.waitFor({ state: 'visible', timeout: 5_000 });
    if (await hand.isEnabled()) {
      await hand.click();
      const dlg = this.$('[role="dialog"]').filter({ hasText: 'Hand off this story' }).first();
      try { await dlg.waitFor({ state: 'visible', timeout: 8_000 }); }
      catch { throw this.fail('Hand off is enabled but no dialog opened'); }
      const dtext = (await dlg.textContent() || '').replace(/\s+/g, ' ').trim();
      notes.push(`hand off dialog: "${dtext.slice(0, 100)}"`);
      await this.page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    } else {
      const anchor = this.$('.suiw-tooltip-anchor').first();
      await anchor.hover({ force: true }).catch(() => {});
      await anchor.focus().catch(() => {});
      const tip = (await this.$('[role="tooltip"]').first().textContent({ timeout: 4_000 }).catch(() => '')) || '';
      if (!tip.trim()) throw this.fail('Hand off is disabled and no tooltip gives a reason (dead button)');
      notes.push(`hand off disabled: "${tip.trim()}"`);
      await this.page.keyboard.press('Escape');
    }
    // Delete → cancel
    await openSwitcher();
    const del = this.$('.suiw-switcher-actions button').filter({ hasText: 'Delete story' }).first();
    if (!(await del.isEnabled())) throw this.fail('"Delete story…" is disabled with a story open');
    await del.click();
    const adlg = this.$('[role="alertdialog"]').filter({ hasText: 'Delete this story?' }).first();
    try { await adlg.waitFor({ state: 'visible', timeout: 8_000 }); }
    catch { throw this.fail('Delete opened no confirm dialog'); }
    await adlg.locator('button', { hasText: 'Cancel' }).first().click();
    await adlg.waitFor({ state: 'hidden', timeout: 5_000 });
    if (!fs.existsSync(this.state.file)) throw this.fail('Cancel on the delete dialog still deleted the file');
    notes.push('delete confirm shown and cancelled');
    return notes.join('; ');
  }

  async flow11() {
    if (!this.state.file) throw this.skip('no story from flow 6');
    const nw = this.$('.suiw-new').first();
    await nw.waitFor({ state: 'visible', timeout: 10_000 });
    await nw.click();
    const heading = this.$('h2').filter({ hasText: 'Recent work' }).first();
    try { await heading.waitFor({ state: 'visible', timeout: 15_000 }); }
    catch { throw this.fail('Home shows no "Recent work" after New'); }
    const cards = this.$('.suiw-recent-card');
    const n = await cards.count();
    if (n < 1) throw this.fail('Recent work has no cards');
    const first = cards.first();
    const title = (await first.locator('.rt-Text').first().textContent() || '').trim();
    const thumb = first.locator('.suiw-thumb iframe');
    try { await thumb.first().waitFor({ state: 'attached', timeout: 15_000 }); }
    catch {
      const t = (await first.locator('.suiw-thumb').first().textContent().catch(() => '')) || '';
      throw this.fail(`first recent card ("${title}") has no thumbnail iframe after 15s (thumb text: "${t.trim()}")`);
    }
    const src = await thumb.first().getAttribute('src');
    return `${n} recent cards; first "${title}" has a thumbnail (${src})`;
  }

  async flow12() {
    await this.goHome();
    const before = listStories(this.generatedDir);
    const mark = this.consoleErrors.length;
    const ta = this.$(TEXTAREA).first();
    await ta.fill(PROMPT_RELOAD);
    const send = this.$('[aria-label="Send"]').first();
    if (!(await send.isEnabled())) throw this.fail('Send disabled');
    const started = Date.now();
    await send.click();
    await this.$('[aria-label="Stop"]').first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    await sleep(5_000);
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    try { await this.$('.suiw-root').first().waitFor({ state: 'visible', timeout: 60_000 }); }
    catch { throw this.fail('workspace did not render after reload'); }
    const recovering = this.$('.suiw-step-label').filter({ hasText: 'Reconnecting to your in-progress generation' }).first();
    let sawRecovery = false;
    try { await recovering.waitFor({ state: 'visible', timeout: 20_000 }); sawRecovery = true; } catch { /* maybe already done */ }
    // completion: the preview shows a story and recovery is over
    let storyId = null; let finished = false;
    const deadline = started + GEN_TIMEOUT;
    while (Date.now() < deadline) {
      const rec = await recovering.count() ? await recovering.isVisible() : false;
      const id = await this.iframeStoryId(1_000);
      const busy = await this.$('[aria-label="Stop"]').count();
      if (id && !rec && !busy) { storyId = id; finished = true; break; }
      await sleep(2_000);
    }
    const after = listStories(this.generatedDir);
    const created = newFiles(before, after);
    const problems = [];
    if (!sawRecovery) problems.push('no "Reconnecting to your in-progress generation" state after reload');
    if (!finished) {
      const alert = await this.alertText();
      const notice = (await this.$('[role="status"]').filter({ hasText: /./ }).allTextContents().catch(() => [])).join(' | ');
      problems.push(`no completed story in the preview within ${opt.timeout}s (alert: "${alert}"; status: "${notice.slice(0, 160)}"; files created: ${created.join(', ') || 'none'})`);
    }
    if (created.length > 1) problems.push(`duplicate story files: ${created.join(', ')}`);
    if (created.length === 0) problems.push('no story file was written');
    const errs = this.errorsSince(mark);
    const note = `${((Date.now() - started) / 1000).toFixed(0)}s, recovery state ${sawRecovery ? 'shown' : 'NOT shown'}, files: ${created.join(', ') || 'none'}, story ${storyId || '-'}${errs.length ? `; ${errs.length} console error(s)` : ''}`;
    if (problems.length) throw this.fail(`${problems.join(' | ')} (${note})`);
    this.state.file12 = created[0] ? path.join(this.generatedDir, created[0]) : null;
    return note;
  }

  async flow13() {
    await this.goHome();
    const before = listStories(this.generatedDir);
    const ne0 = this.netErrors.length;
    const { ms } = await this.generate(PROMPT_EDGE);
    const problems = [];
    const alert = await this.alertText();
    if (alert) problems.push(`error callout: "${alert}"`);
    const server5xx = this.netErrors.slice(ne0).filter(x => typeof x.status === 'number' && x.status >= 500 && x.url.includes(`:${this.mcp}`));
    if (server5xx.length) problems.push(`server 5xx: ${server5xx.map(x => `${x.status} ${x.url}`).join(', ')}`);
    const failedTurn = await this.$('.suiw-turn--assistant .suiw-turn-body[data-accent-color="red"]').count();
    if (failedTurn) problems.push('assistant turn rendered as failed');
    const after = listStories(this.generatedDir);
    const created = newFiles(before, after);
    if (created.length === 0) problems.push('no story file written');
    const storyId = await this.iframeStoryId(20_000);
    if (!storyId) problems.push('no story in the preview');
    const userTurn = (await this.$('.suiw-turn--user .suiw-turn-body').last().textContent().catch(() => '')) || '';
    if (!userTurn.includes('Résumé') || !userTurn.includes('🎉')) problems.push(`user turn lost characters: "${userTurn.trim().slice(0, 80)}"`);
    const note = `${(ms / 1000).toFixed(0)}s, file ${created.join(', ') || '-'}, story ${storyId || '-'}`;
    if (problems.length) throw this.fail(`${problems.join(' | ')} (${note})`);
    return note;
  }
}

/* ---------------------------------------------------------------- main */

async function main() {
  say(`smoke bench ${STAMP} → ${OUT}`);
  const all = [];
  for (const spec of envSpecs) {
    const dir = path.resolve(spec.split(':')[0]);
    const name = path.basename(dir);
    say('');
    say(`=== ${name} (${spec})`);
    const pw = loadPlaywright(dir);
    const gen = !opt.gen || opt.gen.includes(name);
    if (!pw) {
      say('  no Playwright with a Chromium found in the project or react-mantine — skipping');
      all.push({ name, spec, results: [{ flow: 0, title: 'setup', status: 'SKIP', reason: 'no Playwright available' }], notes: [] });
      continue;
    }
    // reachability — other agents share some of these ports; wait out a brief restart
    let health = false, index = false;
    for (let attempt = 0; attempt < 24 && !(health && index); attempt++) {
      if (attempt) { say(`  waiting for server/storybook (${attempt * 5}s)`); await sleep(5000); }
      health = await fetch(`http://127.0.0.1:${spec.split(':')[1]}/health`, { signal: AbortSignal.timeout(4000) }).then(r => r.ok).catch(() => false);
      index = await fetch(`http://127.0.0.1:${spec.split(':')[2]}/index.json`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok).catch(() => false);
    }
    if (!health || !index) {
      say(`  server ${health ? 'ok' : 'DOWN'}, storybook ${index ? 'ok' : 'DOWN'} — skipping`);
      all.push({ name, spec, results: [{ flow: 0, title: 'setup', status: 'SKIP', reason: `server ${health ? 'ok' : 'down'}, storybook ${index ? 'ok' : 'down'}` }], notes: [] });
      continue;
    }
    const run = new EnvRun(spec, pw);
    if (opt.surface === 'docs') run.surface = 'docs';
    try { await run.run(opt.flows, gen); }
    catch (e) { say(`  environment aborted: ${e.message}`); run.record(0, 'environment', 'FAIL', `aborted: ${e.message.split('\n')[0]}`); await run.browser?.close().catch(() => {}); }
    all.push({ name, spec, surface: run.surface, results: run.results, notes: run.notes, state: { file: run.state.file, file12: run.state.file12, storyId: run.state.storyId, imports: run.state.imports }, consoleErrors: run.consoleErrors, netErrors: run.netErrors, playwright: { version: pw.version, from: pw.from } });
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(all[all.length - 1], null, 2));
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(all, null, 2));
  const md = matrix(all);
  fs.writeFileSync(path.join(OUT, 'matrix.md'), md);
  say('');
  console.log(md);
  say(`results: ${OUT}`);
}

function matrix(all) {
  const flows = Array.from({ length: 13 }, (_, i) => i + 1);
  const head = `| env | ${flows.join(' | ')} |\n|---|${flows.map(() => '---').join('|')}|`;
  const rows = all.map(e => {
    const cells = flows.map(f => { const r = e.results.find(x => x.flow === f); return r ? r.status : '—'; });
    return `| ${e.name}${e.surface === 'docs' ? ' (docs surface)' : ''} | ${cells.join(' | ')} |`;
  });
  const lines = ['# Smoke matrix', '', head, ...rows, '', '## Details', ''];
  for (const e of all) {
    lines.push(`### ${e.name}`, '');
    for (const n of e.notes || []) lines.push(`- note: ${n}`);
    for (const r of e.results) {
      lines.push(`- **${r.flow}. ${r.title}** — ${r.status}${r.reason ? `: ${r.reason}` : ''}${r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : ''}`);
      if (r.status === 'FAIL') {
        if (r.screenshot) lines.push(`  - screenshot: ${r.screenshot}`);
        for (const c of (r.evidence?.console || []).slice(0, 6)) lines.push(`  - console: ${c.replace(/\n/g, ' ').slice(0, 300)}`);
        for (const c of (r.evidence?.network || []).slice(0, 6)) lines.push(`  - network: ${c}`);
      } else if (r.evidence && (r.evidence.console.length || r.evidence.network.length)) {
        lines.push(`  - (passed with ${r.evidence.console.length} console error(s), ${r.evidence.network.length} failed/4xx+ response(s))`);
        for (const c of (r.evidence?.console || []).slice(0, 3)) lines.push(`  - console: ${c.replace(/\n/g, ' ').slice(0, 300)}`);
        for (const c of (r.evidence?.network || []).slice(0, 3)) lines.push(`  - network: ${c}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

main().catch(e => { console.error(e); process.exit(1); });
