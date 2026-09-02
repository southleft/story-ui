#!/usr/bin/env node
/**
 * Re-grade a finished fidelity run with the current scorer and scenarios.
 *
 *   node bench/fidelity-rescore.mjs bench/results/<timestamp>
 *
 * The raw material (events, code, completion, divergence) is what the run
 * recorded; only the scores and the issues list are recomputed. Writes
 * report-rescored.md beside the original report and rewrites each JSON's
 * `score`/`issues`. Pins are re-checked from the prop-edit request recorded
 * on the step when present.
 */
import fs from 'node:fs';
import path from 'node:path';
import { scenarios, defaultForbiddenFor } from './fidelity/scenarios.mjs';
import { scoreStep, issuesFrom, stepSummary } from './fidelity/score.mjs';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('usage: node bench/fidelity-rescore.mjs <results dir>'); process.exit(2); }
/**
 * importPath and --generic knowledge come from the run's own summary.json
 * when it has one (fidelity.mjs writes opts, importPath and, in --generic
 * mode, the catalog it fetched). An explicit argv[3] still overrides.
 */
const summaryFile = path.join(dir, 'summary.json');
const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf-8')) : null;
const importPath = process.argv[3] || summary?.importPath || '@mantine/core';
const generic = process.argv.includes('--generic') || Boolean(summary?.opts?.generic);
let catalog = null;
if (generic && summary?.generic?.catalog?.names?.length) {
  const g = summary.generic.catalog;
  catalog = { source: g.source, names: new Set(g.names), importPaths: g.importPaths ? new Map(Object.entries(g.importPaths)) : null };
}
let tokens = null;
if (generic && summary?.opts?.project) {
  try {
    const { pathToFileURL } = await import('node:url');
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const { readStylingFacts } = await import(pathToFileURL(path.join(root, 'dist', 'story-generator', 'knowledge', 'stylingFacts.js')).href);
    const { checkTokenUsage } = await import(pathToFileURL(path.join(root, 'dist', 'story-generator', 'knowledge', 'tokenConformance.js')).href);
    const facts = readStylingFacts(summary.opts.project, 'generated', importPath);
    tokens = { known: new Set(facts.tokens.flatMap(g => g.names)), check: checkTokenUsage, sources: facts.sources };
  } catch (e) { console.error(`tokens not recomputed: ${e.message}`); }
}
if (generic) console.error(`generic rescore: importPath ${importPath}; catalog ${catalog ? `${catalog.names.size} names from summary.json` : 'not stored in summary.json — each step keeps the catalog verdict it was given'}; tokens ${tokens ? `${tokens.known.size} declared` : 'not recomputed — stored verdicts kept'}`);
const withDefaults = (expect = {}) => ({ ...expect, forbiddenPatterns: [...defaultForbiddenFor(importPath), ...(expect.forbiddenPatterns || [])] });

const rows = [];
let passed = 0, failed = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  const sc = scenarios.find(s => s.id === r.scenario);
  if (!sc || !Array.isArray(r.steps)) continue;
  r.pass = true;
  let followUpIndex = 0;
  r.steps.forEach((st, i) => {
    // A prop-edit step is scored by the harness's own edit checks; the generation
    // scorer would read its lack of a stream as a failure.
    if (st.kind === 'prop-edit') { if (st.score?.pass === false) r.pass = false; return; }
    const isBase = i === 0 && st.kind !== 'update';
    const expect = withDefaults(isBase ? sc.expect : sc.followUps?.[followUpIndex++]?.expect);
    const storedPins = st.score?.checks?.pins;
    const errorEvent = st.events?.find(e => e.type === 'error') || (st.transportError ? { data: { code: 'TRANSPORT', message: st.transportError } } : undefined);
    const stored = st.score?.checks || {};
    st.score = scoreStep({ code: st.code, expect, events: st.events || [], completion: st.completion, errorEvent, importPath, previousCode: st.previousCode, divergence: st.divergence ?? undefined, pins: st.pins, generic, catalog, tokens });
    // A generic check that could not be recomputed keeps the verdict the run
    // recorded; it was computed against the live server at the time.
    if (generic && !catalog && stored.catalog && stored.catalog.pass != null) st.score.checks.catalog = stored.catalog;
    if (generic && !tokens && stored.tokens && stored.tokens.pass != null) st.score.checks.tokens = stored.tokens;
    if (generic) {
      st.score.failed = Object.entries(st.score.checks).filter(([, c]) => c.pass === false).map(([k]) => k);
      st.score.notMeasured = Object.entries(st.score.checks).filter(([, c]) => c.pass === null).map(([k]) => k);
      st.score.pass = st.score.failed.length === 0;
    }
    // The pins the harness used are not stored on the step; keep its verdict.
    if (st.score.checks.pins?.pass == null && storedPins && storedPins.pass != null) st.score.checks.pins = storedPins;
    st.issues = issuesFrom(st.label, { events: st.events || [], completion: st.completion, score: st.score });
    if (st.score.pass === false) r.pass = false;
    const c = st.score.checks; const v = c.verification || {};
    const cell = (x) => x?.pass === true ? 'ok' : x?.pass === false ? 'FAIL' : 'n/a';
    rows.push(`| ${st.label} | ${st.score.pass ? 'PASS' : 'FAIL'} | ${cell(c.completion)} | ${cell(c.adherence)} | ${cell(c.requirements)} | ${cell(c.forbidden)} | ${cell(v)} ${v.checksRun != null ? `${v.checksRun}/${v.checksTotal}` : ''} | ${v.blockers?.length ?? 0} | ${c.divergence?.divergence != null ? c.divergence.divergence.toFixed(3) : '–'} | ${cell(c.text)} | ${cell(c.pins)} | ${st.issues.filter(i => i.kind === 'fail' || i.kind === 'error').map(i => i.text).join('; ').slice(0, 160)} |`);
  });
  if (r.pass) passed++; else failed++;
  r.issues = r.steps.flatMap(st => st.issues || []);
  fs.writeFileSync(path.join(dir, f), JSON.stringify(r, null, 2));
  // Keep summary.json in step with the rescored JSONs, so anything reading
  // the summary (bench/durability/summarize.mjs) sees the same verdicts.
  if (summary) {
    const sr = summary.results.find(x => x.scenario === r.scenario && x.round === r.round);
    if (sr) { sr.pass = r.pass; sr.steps = r.steps.map(st => stepSummary(st)); }
  }
}
if (summary) {
  summary.rescoredAt = new Date().toISOString();
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
}
const md = [`# Fidelity run ${path.basename(dir)} — rescored ${new Date().toISOString()}`, '', `${passed} pass, ${failed} fail`, '',
  '| step | result | completion | adherence | requirements | forbidden | verification | blockers | divergence | text | pins | notes |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
fs.writeFileSync(path.join(dir, 'report-rescored.md'), md);
console.log(md);
