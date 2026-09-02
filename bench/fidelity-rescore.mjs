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
import { scenarios, DEFAULT_FORBIDDEN } from './fidelity/scenarios.mjs';
import { scoreStep, issuesFrom } from './fidelity/score.mjs';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('usage: node bench/fidelity-rescore.mjs <results dir>'); process.exit(2); }
const importPath = process.argv[3] || '@mantine/core';
const withDefaults = (expect = {}) => ({ ...expect, forbiddenPatterns: [...DEFAULT_FORBIDDEN, ...(expect.forbiddenPatterns || [])] });

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
    st.score = scoreStep({ code: st.code, expect, events: st.events || [], completion: st.completion, errorEvent, importPath, previousCode: st.previousCode, divergence: st.divergence ?? undefined, pins: st.pins });
    // The pins the harness used are not stored on the step; keep its verdict.
    if (st.score.checks.pins?.pass == null && storedPins && storedPins.pass != null) st.score.checks.pins = storedPins;
    st.issues = issuesFrom(st.label, { events: st.events || [], completion: st.completion, score: st.score });
    if (st.score.pass === false) r.pass = false;
    const c = st.score.checks; const v = c.verification || {};
    const cell = (x) => x?.pass === true ? 'ok' : x?.pass === false ? 'FAIL' : 'n/a';
    rows.push(`| ${st.label} | ${st.score.pass ? 'PASS' : 'FAIL'} | ${cell(c.completion)} | ${cell(c.adherence)} | ${cell(c.requirements)} | ${cell(c.forbidden)} | ${cell(v)} ${v.checksRun != null ? `${v.checksRun}/${v.checksTotal}` : ''} | ${v.blockers?.length ?? 0} | ${c.divergence?.divergence != null ? c.divergence.divergence.toFixed(3) : '–'} | ${cell(c.text)} | ${cell(c.pins)} | ${st.issues.filter(i => i.kind === 'fail' || i.kind === 'error').map(i => i.text).join('; ').slice(0, 160)} |`);
  });
  if (r.pass) passed++; else failed++;
  fs.writeFileSync(path.join(dir, f), JSON.stringify(r, null, 2));
}
const md = [`# Fidelity run ${path.basename(dir)} — rescored ${new Date().toISOString()}`, '', `${passed} pass, ${failed} fail`, '',
  '| step | result | completion | adherence | requirements | forbidden | verification | blockers | divergence | text | pins | notes |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
fs.writeFileSync(path.join(dir, 'report-rescored.md'), md);
console.log(md);
