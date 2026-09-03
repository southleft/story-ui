/**
 * Fidelity bench — does a generated story use the RIGHT components, the RIGHT
 * variants, stay inside the design system, and does an ITERATION change only
 * what was asked?
 *
 * This is the LLM-in-the-loop bench: slow, costs tokens, and its scoring is
 * deterministic even though its subject is not. It complements
 * bench/resolution.mjs (what the engine KNOWS, free, seconds) — never use it
 * to measure a filesystem property.
 *
 *   node bench/fidelity.mjs --plan
 *   node bench/fidelity.mjs --only pricing-page
 *   node bench/fidelity.mjs --server http://localhost:4101 --storybook http://localhost:6101 \
 *        --project ../test-storybooks/react-mantine --rounds 2 --image ./shot.png --strict
 *
 * Per scenario it captures every SSE event with a timestamp, scores the code
 * (bench/fidelity/score.mjs), screenshots the rendered story through the
 * host project's Playwright, and writes:
 *
 *   bench/results/<timestamp>/<scenario>[.rN].json   events + code + scores
 *   bench/results/<timestamp>/<scenario>[.rN][.step].png
 *   bench/results/<timestamp>/report.md              the table a human reads
 *   bench/results/<timestamp>/run.log                everything printed
 *
 * Exit code is 0 unless --strict, in which case any failed step exits 1. A
 * check that could not run is reported as n/a and never counted as a failure:
 * absent and zero must not look alike.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';

import { scenarios, byId, DEFAULT_FORBIDDEN, defaultForbiddenFor } from './fidelity/scenarios.mjs';
import { streamGenerate, describeEvent } from './fidelity/sse.mjs';
import { resolveStoryId, screenshotStory, closeBrowsers } from './fidelity/screenshot.mjs';
import { scoreStep, issuesFrom, pinSurvived, stepSummary } from './fidelity/score.mjs';

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);

const STORY_UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opts = {
  server: arg('server', 'http://localhost:4101').replace(/\/+$/, ''),
  storybook: arg('storybook', 'http://localhost:6101').replace(/\/+$/, ''),
  project: path.resolve(arg('project', path.join(STORY_UI_ROOT, '..', 'test-storybooks', 'react-mantine'))),
  // `--scenarios` is an alias of `--only`; either selects by id.
  only: (arg('only', '') || arg('scenarios', '')) ? (arg('only', '') || arg('scenarios', '')).split(',').map(s => s.trim()).filter(Boolean) : null,
  generic: flag('generic'),
  rounds: Math.max(1, Number(arg('rounds', '1')) || 1),
  provider: arg('provider', ''),
  model: arg('model', ''),
  image: arg('image', ''),
  out: path.resolve(arg('out', path.join(STORY_UI_ROOT, 'bench', 'results'))),
  timeoutMs: (Number(arg('timeout', '720')) || 720) * 1000,
  plan: flag('plan'),
  strict: flag('strict'),
  reverify: flag('reverify'),
  freshBases: flag('fresh-bases'),
  noScreenshot: flag('no-screenshot'),
  verbose: flag('verbose'),
  check: flag('check'),
};

if (flag('help')) {
  console.log(`node bench/fidelity.mjs [--plan] [--only id,id] [--rounds N] [--server URL] [--storybook URL]
    [--project DIR] [--provider claude|openai|gemini] [--model ID] [--image PNG] [--out DIR]
    [--timeout SECONDS] [--strict] [--reverify] [--fresh-bases] [--no-screenshot] [--generic]

  --plan          print the scenarios and exit; no server needed
  --only          comma-separated scenario ids (bases are generated on demand); --scenarios is an alias
  --generic       library-agnostic scoring for a project that is not react-mantine: component-NAME
                  expectations (mustUse/mustUseAnyOf/mustNot) are reported n/a, and replaced by
                  catalog conformance (every design-system import is in GET /mcp/components, at
                  least 3 distinct catalog components used as JSX) and token conformance (every
                  var(--x) is declared by the project, via dist/ tokenConformance). Text, forbidden
                  patterns, pins, divergence, verification and timing are unchanged
  --rounds        repeat every selected scenario N times
  --image         PNG for the image scenario (skipped, not failed, without it)
  --strict        exit 1 if any step failed
  --reverify      also run dist/ verifyStory standalone on each result
  --fresh-bases   regenerate a derived scenario's base instead of reusing this run's
  --check         load the project config and preflight both servers, then exit; no generation
  --verbose       print llm_text narration events as they stream (always stored in the JSON)`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Selection and plan                                                  */
/* ------------------------------------------------------------------ */

const selected = opts.only
  ? opts.only.map(id => byId(id) || (() => { console.error(`unknown scenario: ${id}`); process.exit(2); })())
  : scenarios;

function describeExpect(e = {}) {
  const parts = [];
  const names = [];
  if (e.mustUseComponents?.length) names.push(`use ${e.mustUseComponents.join('+')}`);
  if (e.mustUseAnyOf?.length) names.push(`any of ${e.mustUseAnyOf.map(g => Array.isArray(g) ? `[${g.join('|')}]` : g).join(' ')}`);
  if (e.mustNotUseComponents?.length) names.push(`not ${e.mustNotUseComponents.join('+')}`);
  if (names.length) parts.push(opts.generic ? `(n/a in --generic: ${names.join('; ')})` : names.join('; '));
  if (opts.generic) parts.push('catalog conformance (>=3 distinct catalog components); declared tokens only');
  if (e.mustContainText?.length) parts.push(`text ${e.mustContainText.map(t => JSON.stringify(t)).join(',')}`);
  if (e.maxDivergence !== undefined) parts.push(`divergence<=${e.maxDivergence}`);
  if (e.maxTimeToPreviewMs !== undefined) parts.push(`preview<=${e.maxTimeToPreviewMs}ms`);
  return parts.join('; ');
}

if (opts.plan) {
  console.log(`Fidelity bench plan — ${selected.length} scenario(s), ${opts.rounds} round(s), project ${opts.project}`);
  console.log(`server ${opts.server}   storybook ${opts.storybook}   provider ${opts.provider || '(server default)'}   model ${opts.model || '(server default)'}`);
  console.log(`default forbidden patterns (every step): ${DEFAULT_FORBIDDEN.map(p => `/${p}/`).join('  ')}\n  (the competing-library pattern is rebuilt at run time around the project's importPath)\n`);
  for (const s of selected) {
    console.log(`${s.id}  [${s.kind}]${s.base ? `  base=${s.base}` : ''}`);
    if (s.kind !== 'update' && s.kind !== 'prop-edit') {
      console.log(`  prompt : ${s.prompt.length > 110 ? s.prompt.slice(0, 107) + '...' : s.prompt}`);
      console.log(`  expect : ${describeExpect(s.expect) || '(nothing beyond defaults)'}`);
      if (s.kind === 'image') console.log(`  image  : ${opts.image || 'NONE — this scenario will be SKIPPED without --image'}`);
    }
    if (s.propEdit) console.log(`  edit   : ${s.propEdit.component}[${s.propEdit.occurrence}].${s.propEdit.prop} = ${JSON.stringify(s.propEdit.value)} via POST /mcp/edit-prop, then assert the pin survives the follow-up`);
    for (const [i, f] of (s.followUps || []).entries()) {
      console.log(`  follow-up ${i + 1}: ${JSON.stringify(f.prompt)}`);
      console.log(`     expect : ${describeExpect(f.expect)}`);
    }
  }
  const bases = [...new Set(selected.filter(s => s.base && !selected.some(x => x.id === s.base)).map(s => s.base))];
  if (bases.length) console.log(`\nbases generated on demand (not selected themselves): ${bases.join(', ')}`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Run setup                                                           */
/* ------------------------------------------------------------------ */

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const runDir = path.join(opts.out, stamp);
fs.mkdirSync(runDir, { recursive: true });
const logFile = fs.createWriteStream(path.join(runDir, 'run.log'), { flags: 'a' });
const log = (...parts) => { const line = parts.join(' '); console.log(line); logFile.write(line + '\n'); };

/**
 * The project's own config: import path and where stories are written.
 *
 * Tries require, then import, then — because a CommonJS config inside a
 * `"type": "module"` project satisfies neither loader — the two fields this
 * bench needs are read from the file's text. Which route answered is
 * recorded in the report, so a default is never mistaken for a fact.
 */
async function readProjectConfig(project) {
  const fallback = { importPath: '@mantine/core', generatedStoriesPath: './src/stories/generated/' };
  for (const name of ['story-ui.config.js', 'story-ui.config.cjs', 'story-ui.config.mjs', 'story-ui.config.ts']) {
    const file = path.join(project, name);
    if (!fs.existsSync(file)) continue;
    try {
      const mod = createRequire(path.join(project, 'package.json'))(file);
      return { ...fallback, ...(mod.default || mod), _source: `${name} (require)` };
    } catch { /* try the next loader */ }
    try {
      const mod = await import(pathToFileURL(file).href);
      return { ...fallback, ...(mod.default || mod), _source: `${name} (import)` };
    } catch { /* fall back to text */ }
    const text = fs.readFileSync(file, 'utf8');
    const field = (k) => text.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`))?.[1];
    const parsed = {};
    for (const k of ['importPath', 'generatedStoriesPath', 'componentFramework']) { const v = field(k); if (v) parsed[k] = v; }
    if (Object.keys(parsed).length) return { ...fallback, ...parsed, _source: `${name} (text scan: ${Object.keys(parsed).join(',')})` };
    log(`config ${name} exists but could not be loaded or scanned; using defaults`);
  }
  return { ...fallback, _source: 'defaults (no config found)' };
}
const projectConfig = await readProjectConfig(opts.project);
const generatedDir = path.resolve(opts.project, projectConfig.generatedStoriesPath || './src/stories/generated');
const importPath = projectConfig.importPath;

// editDivergence is the engine's own measure, imported from dist so the bench
// and the pipeline cannot disagree about what "minimal" means.
let editDivergence = null;
try {
  ({ editDivergence } = await import(pathToFileURL(path.join(STORY_UI_ROOT, 'dist', 'story-generator', 'postProcessStory.js')).href));
} catch (e) {
  log(`WARNING: dist/story-generator/postProcessStory.js not importable (${e.message}). Run \`npm run build\`; divergence will be reported as not measured.`);
}

/**
 * What --generic scores against, in place of Mantine component names.
 *
 *   catalog  GET /mcp/components/inventory (name + importPath per component)
 *            when the server has it, else GET /mcp/components (names only —
 *            default imports are then unverifiable, and say so).
 *   tokens   the project's declared CSS custom properties, read with the
 *            engine's own readStylingFacts, checked with its checkTokenUsage
 *            — both from dist/, so the bench and the pipeline agree on what
 *            "declared" means.
 *
 * Every field carries its provenance; a missing catalog or an empty token set
 * makes the check n/a, and the report says which.
 */
const genericKnowledge = { catalog: null, tokens: null, icons: null };

async function loadGenericKnowledge() {
  // Catalog
  const tryRoute = async (route) => {
    const r = await fetch(`${opts.server}${route}`, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  try {
    const inv = await tryRoute('/mcp/components/inventory');
    const rows = Array.isArray(inv?.components) ? inv.components : null;
    if (rows && rows.length) {
      genericKnowledge.catalog = {
        source: '/mcp/components/inventory',
        names: new Set(rows.map(r => r.name)),
        importPaths: new Map(rows.map(r => [r.name, r.importPath])),
        byOrigin: rows.reduce((acc, r) => { acc[r.source || '?'] = (acc[r.source || '?'] || 0) + 1; return acc; }, {}),
        described: rows.filter(r => r.hasDescription).length,
      };
    } else {
      throw new Error(`inventory answered with ${rows ? 'zero components' : 'no components array'}`);
    }
  } catch (e) {
    const invError = e.message;
    try {
      const list = await tryRoute('/mcp/components');
      if (Array.isArray(list) && list.length) {
        genericKnowledge.catalog = { source: '/mcp/components', names: new Set(list.map(c => c.name)), importPaths: null, byOrigin: null, described: null, inventoryError: invError };
      } else {
        genericKnowledge.catalog = { source: null, names: new Set(), reason: `inventory: ${invError}; /mcp/components answered ${Array.isArray(list) ? 'zero components' : 'a non-array'}` };
      }
    } catch (e2) {
      genericKnowledge.catalog = { source: null, names: new Set(), reason: `inventory: ${invError}; /mcp/components: ${e2.message}` };
    }
  }
  const cat = genericKnowledge.catalog;
  log(cat.names.size
    ? `catalog: ${cat.names.size} components from ${cat.source}${cat.byOrigin ? ` (${Object.entries(cat.byOrigin).map(([k, v]) => `${v} ${k}`).join(', ')}; ${cat.described} with a description)` : ' (names only; default imports unverifiable)'}${cat.inventoryError ? ` — inventory route failed: ${cat.inventoryError}` : ''}`
    : `catalog: NONE — ${cat.reason}; catalog conformance will be n/a`);

  // Tokens
  try {
    const { readStylingFacts } = await import(pathToFileURL(path.join(STORY_UI_ROOT, 'dist', 'story-generator', 'knowledge', 'stylingFacts.js')).href);
    const { checkTokenUsage } = await import(pathToFileURL(path.join(STORY_UI_ROOT, 'dist', 'story-generator', 'knowledge', 'tokenConformance.js')).href);
    // readStylingFacts wants the generated DIRECTORY NAME (it excludes those stories from the idiom sample), not the path.
    const facts = readStylingFacts(opts.project, path.basename(generatedDir), importPath);
    const known = new Set(facts.tokens.flatMap(g => g.names));
    genericKnowledge.tokens = { known, check: checkTokenUsage, sources: facts.sources, groups: facts.tokens.map(g => `${g.category}:${g.names.length}`) };
    log(known.size
      ? `tokens: ${known.size} declared (${genericKnowledge.tokens.groups.join(', ')}) from ${facts.sources.projectFiles} project + ${facts.sources.packageFiles} package stylesheet(s)`
      : `tokens: NONE declared (${facts.sources.lookedAtNothing ? 'no stylesheet found to read' : `${facts.sources.projectFiles} project + ${facts.sources.packageFiles} package stylesheet(s) read`}); token conformance will be n/a`);
  } catch (e) {
    genericKnowledge.tokens = { known: null, check: null, error: e.message };
    log(`tokens: dist knowledge modules not importable (${e.message}); token conformance will be n/a`);
  }

  // Icon packages the engine derives and allows (project or design-system
  // dependency whose manifest says icons). Imports from them are icons, not
  // catalog components.
  try {
    const { derivedIconPackages } = await import(pathToFileURL(path.join(STORY_UI_ROOT, 'dist', 'story-generator', 'knowledge', 'iconFacts.js')).href);
    const pkgs = derivedIconPackages(opts.project, importPath, projectConfig.iconImports?.package);
    genericKnowledge.icons = { packages: pkgs.map(p => p.name), exports: Object.fromEntries(pkgs.map(p => [p.name, p.exports.length])) };
    log(pkgs.length ? `icons: ${pkgs.map(p => `${p.name} (${p.via}, ${p.exports.length} exports)`).join(', ')} — imports from these are not judged against the catalog` : 'icons: no installed icon package derived');
  } catch (e) {
    genericKnowledge.icons = { packages: [], error: e.message };
    log(`icons: dist iconFacts not importable (${e.message})`);
  }
}

const imageInput = (() => {
  if (!opts.image) return null;
  const file = path.resolve(opts.image);
  if (!fs.existsSync(file)) { console.error(`--image not found: ${file}`); process.exit(2); }
  const ext = path.extname(file).toLowerCase().replace('.', '');
  const mediaType = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/png';
  return { type: 'base64', data: fs.readFileSync(file).toString('base64'), mediaType, _file: file };
})();

async function preflight() {
  const problems = [];
  try {
    const r = await fetch(`${opts.server}/mcp/providers`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) problems.push(`server ${opts.server} answered ${r.status} on /mcp/providers`);
    else {
      const j = await r.json();
      const names = (j.providers || []).filter(p => p.configured).map(p => `${p.type}(${(p.models || []).slice(0, 3).join(',')})`);
      log(`server ok: providers configured: ${names.join(' ') || 'none'}`);
      if (opts.provider && !(j.providers || []).some(p => p.type === opts.provider && p.configured)) problems.push(`provider ${opts.provider} is not configured on the server`);
    }
  } catch (e) { problems.push(`server ${opts.server} unreachable: ${e.message}`); }
  // Storybook drops connections for a few seconds during a Vite full reload
  // (which every new story file triggers). A transient refusal must not
  // abort a run, so the probe is retried before it counts.
  let storybookError = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(`${opts.storybook}/index.json`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) { storybookError = `answered ${r.status} on /index.json`; }
      else { log(`storybook ok: ${Object.keys((await r.json()).entries || {}).length} entries indexed${attempt > 1 ? ` (after ${attempt} attempts)` : ''}`); storybookError = null; break; }
    } catch (e) { storybookError = `unreachable: ${e.message}`; }
    await new Promise(res => setTimeout(res, 3000));
  }
  if (storybookError) problems.push(`storybook ${opts.storybook} ${storybookError} (4 attempts over 12s)`);
  if (!fs.existsSync(generatedDir)) problems.push(`generated stories dir not found: ${generatedDir} (is --project right? the server's cwd must be this project)`);
  return problems;
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

const readStory = (fileName) => { try { return fs.readFileSync(path.join(generatedDir, fileName), 'utf8'); } catch { return null; } };
// The "another design system" pattern is rebuilt around the project's own
// importPath, so `@mui/` is forbidden on Mantine and `@mantine/` on MUI.
const forbiddenDefaults = defaultForbiddenFor(importPath);
const withDefaults = (expect = {}) => ({ ...expect, forbiddenPatterns: [...forbiddenDefaults, ...(expect.forbiddenPatterns || [])] });

/** One generation, scored. `update` carries { fileName, title } for follow-ups. */
async function generationStep({ label, prompt, expect, update, images, pins, tag }) {
  const body = { prompt, storybookUrl: opts.storybook };
  if (opts.provider) body.provider = opts.provider;
  if (opts.model) body.model = opts.model;
  if (update) { body.fileName = update.fileName; body.isUpdate = true; body.originalTitle = update.title; }
  if (images) body.images = images.map(({ _file, ...rest }) => rest);

  const previousCode = update ? (readStory(update.fileName) ?? update.code ?? null) : null;

  log(`\n--- ${label}${update ? `  (update of ${update.fileName})` : ''}`);
  log(`    prompt: ${prompt}`);
  // `llm_text` (model narration, not in streamTypes.ts) is stored in the JSON
  // but arrives many times a second; only --verbose prints it.
  let narration = 0;
  const stream = await streamGenerate(opts.server, body, {
    onEvent: e => { if (e.type === 'llm_text' && !opts.verbose) { narration++; return; } log('   ', describeEvent(e)); },
    timeoutMs: opts.timeoutMs,
  });
  if (narration) log(`    (${narration} llm_text narration events captured, not printed; --verbose shows them)`);
  if (stream.transportError) log(`    TRANSPORT: ${stream.transportError}`);
  log(`    stream closed after ${(stream.elapsedMs / 1000).toFixed(1)}s, ${stream.events.length} events, ${stream.heartbeats} heartbeats`);

  const completion = stream.completion;
  const fileName = completion?.fileName || update?.fileName || stream.events.find(e => e.type === 'preview_ready')?.data?.fileName || null;
  const title = completion?.title || stream.events.find(e => e.type === 'preview_ready')?.data?.title || update?.title || null;
  // The file on disk is what Storybook renders; the completion's code is what
  // the server believed it wrote. Both are kept; disk is scored when present.
  const diskCode = fileName ? readStory(fileName) : null;
  const code = diskCode ?? completion?.code ?? null;
  if (diskCode && completion?.code && diskCode !== completion.code) log(`    NOTE: file on disk differs from completion.code (${diskCode.length} vs ${completion.code.length} chars); scoring the file`);

  let divergence;
  if (previousCode && code && editDivergence) divergence = editDivergence(previousCode, code).divergence;

  const score = scoreStep({
    code, expect, events: stream.events, completion,
    errorEvent: stream.errorEvent || (stream.transportError ? { data: { code: 'TRANSPORT', message: stream.transportError } } : undefined),
    importPath, previousCode, divergence, pins,
    generic: opts.generic, catalog: genericKnowledge.catalog, tokens: genericKnowledge.tokens, icons: genericKnowledge.icons,
  });

  const shot = await captureScreenshot({ tag, fileName, storybookId: completion?.storybookId, title });
  const reverify = opts.reverify && fileName ? await reverifyStory({ storybookId: completion?.storybookId, title }) : null;

  const step = {
    label, kind: update ? 'update' : 'generate', request: { ...body, images: images ? images.map(i => ({ file: i._file, mediaType: i.mediaType, bytes: i.data.length })) : undefined },
    startedAt: new Date(Date.now() - stream.elapsedMs).toISOString(),
    elapsedMs: stream.elapsedMs, httpStatus: stream.httpStatus, transportError: stream.transportError, heartbeats: stream.heartbeats,
    events: stream.events, completion, fileName, title,
    code, previousCode, divergence: divergence ?? null,
    screenshot: shot, reverify, score,
  };
  step.issues = issuesFrom(label, { events: stream.events, completion, score });
  logScore(step);
  return step;
}

async function captureScreenshot({ tag, fileName, storybookId, title }) {
  if (opts.noScreenshot) return { taken: false, reason: '--no-screenshot' };
  if (!fileName) return { taken: false, reason: 'no fileName to look up' };
  const resolved = await resolveStoryId(opts.storybook, { fileName, storybookId, title });
  if (!resolved.storyId) { log(`    screenshot: not taken — ${resolved.reason}`); return { taken: false, reason: resolved.reason }; }
  const outPath = path.join(runDir, `${tag}.png`);
  const shot = await screenshotStory({ storyUiRoot: STORY_UI_ROOT, project: opts.project, storybook: opts.storybook, storyId: resolved.storyId, outPath });
  log(shot.taken
    ? `    screenshot: ${path.relative(STORY_UI_ROOT, outPath)} (story ${resolved.storyId}, rendered=${shot.rendered ?? '?'}${shot.isErrorPlaceholder ? ', ERROR PLACEHOLDER' : ''}${shot.pageErrors?.length ? `, ${shot.pageErrors.length} page error(s)` : ''})`
    : `    screenshot: not taken — ${shot.reason}`);
  return { ...shot, storyId: resolved.storyId, matchedBy: resolved.matchedBy };
}

async function reverifyStory({ storybookId, title }) {
  if (!storybookId) return { ran: false, reason: 'no storybookId in completion' };
  try {
    const { verifyStory } = await import(pathToFileURL(path.join(STORY_UI_ROOT, 'dist', 'story-generator', 'verify', 'verifyStory.js')).href);
    const t0 = Date.now();
    const r = await verifyStory({ storybookUrl: opts.storybook, storyIdPrefix: storybookId, title: title || 'x', projectRoot: opts.project, generatedDir, framework: projectConfig.componentFramework || 'react' });
    const out = { ran: true, ms: Date.now() - t0, outcome: r.outcome, reason: r.reason, storyId: r.storyId, findings: r.findings.map(f => ({ severity: f.severity, class: f.class, message: f.message })), coverage: r.coverage ? Object.fromEntries(Object.entries(r.coverage).map(([k, v]) => [k, v.ran])) : null, metrics: r.metrics };
    log(`    reverify: ${out.outcome}${out.reason ? ` (${out.reason})` : ''}, ${out.findings.length} finding(s), ${out.ms}ms`);
    return out;
  } catch (e) {
    log(`    reverify: could not run — ${e.message}`);
    return { ran: false, reason: e.message };
  }
}

/** GET editable-props, then POST edit-prop; scored on whether the edit landed. */
async function propEditStep({ label, fileName, propEdit, tag }) {
  log(`\n--- ${label}: ${propEdit.component}[${propEdit.occurrence}].${propEdit.prop} = ${JSON.stringify(propEdit.value)} on ${fileName}`);
  const before = readStory(fileName);
  const checks = {};
  let offered = null;
  try {
    const q = new URLSearchParams({ component: propEdit.component, fileName, occurrence: String(propEdit.occurrence) });
    const r = await fetch(`${opts.server}/mcp/editable-props?${q}`, { signal: AbortSignal.timeout(60_000) });
    const j = await r.json().catch(() => ({}));
    offered = { status: r.status, component: j.component, propCount: (j.props || []).length, current: j.current };
    const p = (j.props || []).find(x => x.name === propEdit.prop);
    offered.prop = p || null;
    const valueOffered = p ? (p.kind !== 'enum' || (p.options || []).includes(String(propEdit.value)) || p.open === true) : false;
    checks.offered = { pass: r.ok && Boolean(p) && valueOffered, status: r.status, propFound: Boolean(p), kind: p?.kind, options: p?.options, open: p?.open, valueOffered };
    log(`    editable-props: ${r.status}, ${offered.propCount} props; ${propEdit.prop} ${p ? `${p.kind}${p.options ? ` [${p.options.join('|')}]` : ''}${p.open ? ' (open)' : ''}` : 'NOT OFFERED'}`);
  } catch (e) {
    checks.offered = { pass: null, reason: `editable-props failed: ${e.message}` };
    log(`    editable-props: failed — ${e.message}`);
  }

  let edit = null;
  let code = before;
  try {
    const r = await fetch(`${opts.server}/mcp/edit-prop`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName, component: propEdit.component, occurrence: propEdit.occurrence, prop: propEdit.prop, value: propEdit.value }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = await r.json().catch(() => ({}));
    edit = { status: r.status, ok: j.ok === true, error: j.error, previous: j.previous, component: j.component, occurrencesInSource: j.occurrencesInSource, pins: j.pins };
    code = readStory(fileName) ?? j.code ?? before;
    const survived = code ? pinSurvived(code, propEdit) : { pass: false, reason: 'no code' };
    checks.edit = { pass: r.ok && j.ok === true && survived.pass === true, status: r.status, error: j.error, found: survived.found, occurrences: survived.occurrences };
    log(`    edit-prop: ${r.status}${j.error ? ` ${j.error}` : ''}; attribute now ${JSON.stringify(survived.found)} (${survived.occurrences} <${propEdit.component}> in file); pins on file: ${(j.pins || []).length}`);
  } catch (e) {
    checks.edit = { pass: false, reason: `edit-prop failed: ${e.message}` };
    log(`    edit-prop: failed — ${e.message}`);
  }
  checks.divergence = before && code && editDivergence ? { ...(() => { const d = editDivergence(before, code).divergence; return { pass: d <= 0.05, divergence: d, maxDivergence: 0.05 }; })() } : { pass: null };

  const shot = await captureScreenshot({ tag, fileName, title: null });
  const failed = Object.entries(checks).filter(([, c]) => c.pass === false).map(([k]) => k);
  const step = {
    label, kind: 'prop-edit', propEdit, fileName, offered, edit, previousCode: before, code, screenshot: shot,
    score: { pass: failed.length === 0, failed, notMeasured: Object.entries(checks).filter(([, c]) => c.pass === null).map(([k]) => k), checks },
  };
  step.issues = failed.map(k => ({ step: label, kind: 'fail', text: `${k}: ${JSON.stringify(checks[k])}` }));
  logScore(step);
  return step;
}

function logScore(step) {
  const c = step.score.checks;
  const cell = (x) => x?.pass === true ? 'ok' : x?.pass === false ? 'FAIL' : 'n/a';
  log(`    score: ${step.score.pass ? 'PASS' : 'FAIL'}  ` + Object.keys(c).map(k => `${k}=${cell(c[k])}`).join(' '));
  for (const i of step.issues) if (i.kind === 'fail' || i.kind === 'error') log(`      ! ${i.text}`);
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

/** Latest known state of each base story in this run, by scenario id. */
const stories = new Map();
const results = [];

async function ensureBase(baseId, round) {
  if (!opts.freshBases && stories.has(baseId)) return stories.get(baseId);
  const base = byId(baseId);
  if (!base) throw new Error(`base scenario not found: ${baseId}`);
  log(`\n=== base ${baseId} (generated for a derived scenario)`);
  const r = await runScenario(base, round, { asBase: true });
  results.push(r);
  const state = stories.get(baseId);
  if (!state?.fileName) throw new Error(`base ${baseId} produced no story file; derived scenario cannot run`);
  return state;
}

async function runScenario(s, round, { asBase = false } = {}) {
  const suffix = opts.rounds > 1 ? `.r${round}` : '';
  const tagBase = `${s.id}${suffix}`;
  const started = Date.now();
  const result = { scenario: s.id, kind: s.kind, base: s.base ?? null, round, asBase, startedAt: new Date().toISOString(), steps: [], skipped: null };
  let stepNo = 0;
  const nextTag = (label) => `${tagBase}${stepNo++ ? `.${label}` : ''}`;

  try {
    if (s.kind === 'image' && !imageInput) {
      result.skipped = 'no --image given';
      log(`\n=== ${s.id}: SKIPPED (no --image given)`);
    } else if (s.kind === 'new' || s.kind === 'image') {
      const step = await generationStep({ label: `${s.id}`, prompt: s.prompt, expect: withDefaults(s.expect), images: s.kind === 'image' ? [imageInput] : undefined, tag: nextTag('gen') });
      result.steps.push(step);
      if (step.fileName) stories.set(s.id, { fileName: step.fileName, title: step.title, code: step.code });
      await runFollowUps(s, result, nextTag);
    } else if (s.kind === 'update') {
      const base = await ensureBase(s.base, round);
      log(`\n=== ${s.id} on ${base.fileName}`);
      await runFollowUps(s, result, nextTag, base);
    } else if (s.kind === 'prop-edit') {
      const base = await ensureBase(s.base, round);
      log(`\n=== ${s.id} on ${base.fileName}`);
      const edit = await propEditStep({ label: `${s.id} edit`, fileName: base.fileName, propEdit: s.propEdit, tag: nextTag('edit') });
      result.steps.push(edit);
      stories.set(s.base, { ...base, code: edit.code });
      // Only assert survival of a pin that was actually set; a failed edit is
      // its own failure and must not also read as "the model dropped it".
      const pins = edit.score.checks.edit?.pass ? [s.propEdit] : [];
      await runFollowUps(s, result, nextTag, stories.get(s.base), pins);
    } else {
      throw new Error(`unknown scenario kind: ${s.kind}`);
    }
  } catch (e) {
    result.error = e?.stack || String(e);
    log(`    SCENARIO ERROR: ${e?.message || e}`);
  }

  result.durationMs = Date.now() - started;
  result.pass = !result.error && !result.skipped && result.steps.length > 0 && result.steps.every(st => st.score.pass);
  result.issues = result.steps.flatMap(st => st.issues || []);
  if (result.error) result.issues.push({ step: s.id, kind: 'error', text: `harness error: ${String(e2(result.error)).slice(0, 300)}` });
  fs.writeFileSync(path.join(runDir, `${tagBase}.json`), JSON.stringify(result, null, 2));
  log(`=== ${s.id}: ${result.skipped ? 'SKIPPED' : result.pass ? 'PASS' : 'FAIL'} in ${(result.durationMs / 1000).toFixed(0)}s -> ${path.relative(STORY_UI_ROOT, path.join(runDir, `${tagBase}.json`))}`);
  return result;
}
const e2 = (s) => s.split('\n')[0];

async function runFollowUps(s, result, nextTag, base, pins) {
  const state = base ?? stories.get(s.id);
  for (const [i, f] of (s.followUps || []).entries()) {
    if (!state?.fileName) { log(`    follow-up ${i + 1} skipped: no story file to update`); break; }
    const step = await generationStep({ label: `${s.id} follow-up ${i + 1}`, prompt: f.prompt, expect: withDefaults(f.expect), update: { fileName: state.fileName, title: state.title, code: state.code }, pins, tag: nextTag(`followup${i + 1}`) });
    result.steps.push(step);
    state.code = step.code ?? state.code;
    state.title = step.title ?? state.title;
    stories.set(base ? s.base : s.id, state);
  }
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

function writeReport() {
  const cell = (x) => x?.pass === true ? 'ok' : x?.pass === false ? 'FAIL' : 'n/a';
  const ms = (n) => typeof n === 'number' ? `${(n / 1000).toFixed(1)}s` : '–';
  const rows = [];
  for (const r of results) {
    if (r.skipped) { rows.push(`| ${r.scenario} | ${r.kind} | SKIPPED | | | | | | | | | | | ${r.skipped} |`); continue; }
    if (!r.steps.length) { rows.push(`| ${r.scenario} | ${r.kind} | ERROR | | | | | | | | | | | ${e2(r.error || 'no steps ran')} |`); continue; }
    for (const st of r.steps) {
      const c = st.score.checks;
      const t = c.timing || {};
      const v = c.verification || {};
      const blockers = v.blockers?.length ? v.blockers.length : (v.pass === null ? '–' : 0);
      const checks = v.checksRun != null ? `${v.checksRun}/${v.checksTotal}` : '–';
      const div = c.divergence?.divergence != null ? c.divergence.divergence.toFixed(3) : '–';
      const label = st.label === r.scenario ? r.scenario : `${r.scenario} › ${st.label.replace(r.scenario, '').trim()}`;
      const roundTag = opts.rounds > 1 ? ` (r${r.round})` : '';
      const notes = st.issues.filter(i => i.kind === 'fail' || i.kind === 'error').map(i => i.text).join('; ').slice(0, 160)
        + (st.screenshot?.taken ? '' : ` [no screenshot: ${st.screenshot?.reason}]`);
      const catalogCell = c.catalog?.pass != null ? `${cell(c.catalog)} ${c.catalog.usedDistinct}/${c.catalog.minDistinct}${c.catalog.notInCatalog?.length ? ` (${c.catalog.notInCatalog.length} unknown)` : ''}` : 'n/a';
      const tokenCell = c.tokens?.pass != null ? `${cell(c.tokens)} ${c.tokens.violations?.length ?? 0} invented / ${c.tokens.varUses} var()` : `n/a${c.tokens?.varUses ? ` (${c.tokens.varUses} var() unchecked)` : ''}`;
      const genericCells = opts.generic ? ` ${catalogCell} | ${tokenCell} |` : '';
      rows.push(`| ${label}${roundTag} | ${st.kind} | ${st.score.pass ? 'PASS' : 'FAIL'} | ${cell(c.completion ?? c.edit)} | ${cell(c.adherence ?? c.offered)} | ${cell(c.requirements)} |${genericCells} ${cell(c.forbidden)} | ${cell(c.verification)} ${checks} | ${blockers} | ${div}${c.divergence?.maxDivergence != null ? ` (≤${c.divergence.maxDivergence})` : ''} | ${cell(c.text)} | ${cell(c.pins)} | ${ms(t.tPreviewMs)} / ${ms(t.tTotalMs)}${t.llmCalls != null ? ` (${t.llmCalls} llm)` : ''} | ${notes.replace(/\|/g, '/')} |`);
    }
  }

  const stepCount = results.reduce((n, r) => n + r.steps.length, 0);
  const passed = results.filter(r => r.pass).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.pass && !r.skipped).length;

  const issues = results.flatMap(r => r.issues.map(i => ({ ...i, scenario: r.scenario, round: r.round })));
  const order = { error: 0, fail: 1, retry: 2, phase: 3, notice: 4, validation: 5, not_verified: 6, pins: 7, autofix: 8, warning: 9, info: 10 };
  issues.sort((a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99));

  const md = [
    `# Fidelity bench — ${stamp}`,
    '',
    `- project: \`${opts.project}\` (importPath \`${importPath}\`, config ${projectConfig._source})`,
    `- server: ${opts.server}   storybook: ${opts.storybook}`,
    `- provider/model: ${opts.provider || 'server default'} / ${opts.model || 'server default'}`,
    `- scenarios: ${results.length} run (${passed} pass, ${failed} fail, ${skipped} skipped), ${stepCount} steps, ${opts.rounds} round(s)`,
    `- divergence measured by dist \`editDivergence\`: ${editDivergence ? 'yes' : 'NO — dist not built, reported as n/a'}`,
    ...(opts.generic ? [
      `- mode: **--generic** — component-name expectations reported n/a; catalog: ${genericKnowledge.catalog?.names?.size ? `${genericKnowledge.catalog.names.size} components from ${genericKnowledge.catalog.source}` : `NONE (${genericKnowledge.catalog?.reason})`}; tokens: ${genericKnowledge.tokens?.known?.size ? `${genericKnowledge.tokens.known.size} declared (${genericKnowledge.tokens.groups.join(', ')})` : `none declared${genericKnowledge.tokens?.error ? ` (${genericKnowledge.tokens.error})` : genericKnowledge.tokens?.sources?.lookedAtNothing ? ' (no stylesheet found to read)' : ''}`}`,
    ] : []),
    '',
    `Cells: \`ok\` passed, \`FAIL\` failed, \`n/a\` could not be measured (never counted as a failure). Verify column shows checksRun/checksTotal from the completion.${opts.generic ? ' Catalog column: distinct catalog components used as JSX / floor. Tokens column: invented var(--x) names / total var() uses.' : ''}`,
    '',
    opts.generic
      ? '| scenario › step | kind | result | completion | adherence | mustUse | catalog | tokens | forbidden | verify | blockers | divergence | text | pins | tPreview / tTotal | notes |'
      : '| scenario › step | kind | result | completion | adherence | mustUse | forbidden | verify | blockers | divergence | text | pins | tPreview / tTotal | notes |',
    opts.generic ? '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '## Issues observed',
    '',
    ...(issues.length ? issues.map(i => `- **${i.kind}** \`${i.scenario}\`${opts.rounds > 1 ? ` r${i.round}` : ''} — ${i.step !== i.scenario ? `${i.step}: ` : ''}${i.text.replace(/\n/g, ' ')}`) : ['- none']),
    '',
    '## Artifacts',
    '',
    ...results.flatMap(r => r.steps.map(st => `- \`${r.scenario}\` ${st.label}: ${st.fileName ? `\`${st.fileName}\`` : 'no file'}${st.screenshot?.taken ? ` — ![${st.label}](${path.basename(st.screenshot.path)})` : ` — no screenshot (${st.screenshot?.reason || 'unknown'})`}`)),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'report.md'), md);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    stamp, opts: { ...opts }, importPath,
    generic: opts.generic ? {
      // Names and import paths are stored so bench/fidelity-rescore.mjs can re-judge the run without the server.
      catalog: genericKnowledge.catalog ? { source: genericKnowledge.catalog.source, size: genericKnowledge.catalog.names.size, byOrigin: genericKnowledge.catalog.byOrigin ?? null, reason: genericKnowledge.catalog.reason ?? null, names: [...genericKnowledge.catalog.names], importPaths: genericKnowledge.catalog.importPaths ? Object.fromEntries(genericKnowledge.catalog.importPaths) : null } : null,
      tokens: genericKnowledge.tokens ? { known: genericKnowledge.tokens.known?.size ?? 0, groups: genericKnowledge.tokens.groups ?? null, sources: genericKnowledge.tokens.sources ?? null, error: genericKnowledge.tokens.error ?? null } : null,
      icons: genericKnowledge.icons ?? null,
    } : null,
    results: results.map(r => ({ scenario: r.scenario, kind: r.kind, round: r.round, pass: r.pass, skipped: r.skipped, error: r.error ? e2(r.error) : null, durationMs: r.durationMs, steps: r.steps.map(st => stepSummary(st)) })),
  }, null, 2));
  return { passed, failed, skipped, stepCount };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

log(`Fidelity bench ${stamp}`);
log(`project ${opts.project}  importPath ${importPath} (${projectConfig._source})  generated ${path.relative(opts.project, generatedDir)}`);
log(`server ${opts.server}  storybook ${opts.storybook}  provider ${opts.provider || '(default)'}  model ${opts.model || '(default)'}  rounds ${opts.rounds}${opts.generic ? '  mode --generic' : ''}`);
if (imageInput) log(`image ${imageInput._file} (${imageInput.mediaType}, ${Math.round(imageInput.data.length / 1024)} KB base64)`);

const problems = await preflight();
if (problems.length) {
  for (const p of problems) log(`PREFLIGHT: ${p}`);
  log('Nothing measured.');
  // No run happened, so no results directory should claim one did.
  logFile.end();
  fs.rmSync(runDir, { recursive: true, force: true });
  process.exit(2);
}
if (opts.generic) await loadGenericKnowledge();
if (opts.check) {
  log(`preflight ok; editDivergence from dist: ${editDivergence ? 'yes' : 'NO'}; ${selected.length} scenario(s) selected. Exiting (--check).`);
  logFile.end();
  fs.rmSync(runDir, { recursive: true, force: true });
  process.exit(0);
}

let interrupted = false;
process.on('SIGINT', () => { interrupted = true; log('\nSIGINT — finishing the current step, then writing the report'); });

const t0 = Date.now();
outer: for (let round = 1; round <= opts.rounds; round++) {
  for (const s of selected) {
    if (interrupted) break outer;
    log(`\n${'='.repeat(78)}\n=== ${s.id}  [${s.kind}]  round ${round}/${opts.rounds}`);
    results.push(await runScenario(s, round));
  }
}

await closeBrowsers(STORY_UI_ROOT);
const summary = writeReport();
log(`\n${'='.repeat(78)}`);
log(`${summary.passed} pass, ${summary.failed} fail, ${summary.skipped} skipped across ${results.length} scenario run(s), ${summary.stepCount} step(s), ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
log(`report: ${path.relative(process.cwd(), path.join(runDir, 'report.md'))}`);
logFile.end();
process.exit(opts.strict && summary.failed > 0 ? 1 : 0);
