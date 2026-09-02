/**
 * Combine one durability run's environments into README.md.
 *
 *   node bench/durability/summarize.mjs bench/results/durability-<stamp>
 *
 * Reads, per environment, `<env>.env.txt` (setup facts written by
 * durability.sh) and `<env>/<stamp>/summary.json` (the fidelity bench's
 * per-step verdicts, which in --generic mode carry catalog, token, forbidden
 * and verification detail). Writes README.md next to them and prints it.
 *
 * An environment that never reached the bench still gets rows: the setup
 * outcome IS the result for it, and a missing table row would look like a
 * run that was never attempted.
 */

import fs from 'fs';
import path from 'path';

const dir = path.resolve(process.argv[2] || '.');
if (!fs.existsSync(dir)) { console.error(`not a directory: ${dir}`); process.exit(2); }

const envFiles = fs.readdirSync(dir).filter(f => f.endsWith('.env.txt')).sort();
const ms = (n) => typeof n === 'number' ? `${(n / 1000).toFixed(1)}s` : '–';

function readFacts(file) {
  const facts = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) facts[line.slice(0, i)] = line.slice(i + 1);
  }
  return facts;
}

function readSummary(facts) {
  if (!facts.runDir) return null;
  const f = path.join(facts.runDir, 'summary.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

/** The bench's own per-scenario JSON, for the issue list. */
function readScenarioIssues(facts, scenario) {
  if (!facts.runDir) return [];
  const f = path.join(facts.runDir, `${scenario}.json`);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).issues || []; } catch { return []; }
}

const cell = (p) => p === true ? 'ok' : p === false ? 'FAIL' : 'n/a';
const esc = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

const setupRows = [];
const rows = [];
const issueBlocks = [];
const knowledgeRows = [];

for (const file of envFiles) {
  const facts = readFacts(path.join(dir, file));
  const env = facts.env || file.replace('.env.txt', '');
  const summary = readSummary(facts);
  let cfg = {};
  try { cfg = JSON.parse(facts.configFacts || '{}'); } catch { /* keep empty */ }

  setupRows.push(`| ${env} | ${esc(facts.outcome)}${facts.reason ? ` — ${esc(facts.reason)}` : ''} | ${esc(facts.install)} (v${esc(facts.installedVersion || '?')}) | ${esc(facts.config)}${facts.initDetected ? ` — init chose ${esc(facts.initDetected)}` : ''} | \`${esc(cfg.importPath || '?')}\` ${cfg.importStyle || ''} | ${esc(facts.apiKey)} | ${esc(facts.playwright)} | ${facts.serverUpS ?? '–'}s / ${facts.storybookUpS ?? '–'}s${facts.storybookEntries ? ` (${facts.storybookEntries} entries)` : ''} | ${facts.benchExit ?? '–'} / ${facts.benchS ?? '–'}s |`);

  if (summary?.generic) {
    const g = summary.generic;
    knowledgeRows.push(`| ${env} | ${g.catalog?.size ? `${g.catalog.size} from ${g.catalog.source}${g.catalog.byOrigin ? ` (${Object.entries(g.catalog.byOrigin).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}` : `NONE — ${esc(g.catalog?.reason)}`} | ${g.tokens?.known ? `${g.tokens.known} (${(g.tokens.groups || []).join(', ')})` : `none${g.tokens?.sources?.lookedAtNothing ? ' — no stylesheet found to read' : g.tokens?.error ? ` — ${esc(g.tokens.error)}` : ''}`} |`);
  }

  if (!summary) {
    rows.push(`| ${env} | – | – | ${esc(facts.outcome)}: ${esc(facts.reason || 'no bench run')} | – | – | – | – |`);
    continue;
  }

  for (const r of summary.results) {
    if (r.skipped || !r.steps.length) {
      rows.push(`| ${env} | ${r.scenario} | – | ${r.skipped ? `SKIPPED (${esc(r.skipped)})` : `ERROR (${esc(r.error)})`} | – | – | – | – |`);
      continue;
    }
    for (const st of r.steps) {
      const v = st.verification || {};
      const c = st.catalog || {};
      const t = st.tokens || {};
      const fb = st.forbidden || {};
      const outcome = st.completion?.pass === false
        ? `FAILED — ${esc(st.completion.reason)}`
        : `${st.pass ? 'PASS' : 'FAIL'}${st.failed?.length ? ` (${st.failed.join(', ')})` : ''}${st.screenshot ? (st.screenshot.rendered === false ? ' — rendered=false' : st.screenshot.isErrorPlaceholder ? ' — ERROR PLACEHOLDER' : '') : ''}`;
      const verify = v.outcome
        ? `${v.outcome}${v.checksRun != null ? ` ${v.checksRun}/${v.checksTotal}` : ''}, ${v.blockers?.length ?? 0} blocker(s)${v.warnings?.length ? `, ${v.warnings.length} warning(s)` : ''}${v.outcome === 'not_verified' && v.reason ? ` — ${esc(v.reason)}` : ''}`
        : 'absent';
      const catalog = c.pass == null
        ? `n/a${c.reason ? ` — ${esc(c.reason)}` : ''}`
        : `${cell(c.pass)} ${c.usedDistinct}/${c.minDistinct} distinct${c.notInCatalog?.length ? `; unknown: ${c.notInCatalog.map(n => n.name).join(', ')}` : ''}${c.unverifiable?.length ? `; unverifiable: ${c.unverifiable.map(u => u.name).join(', ')}` : ''}`;
      const forbidden = fb.pass == null ? 'n/a' : fb.hits?.length ? `${fb.hits.reduce((n, h) => n + h.count, 0)} hit(s): ${fb.hits.map(h => `${h.matches?.[0] ? JSON.stringify(h.matches[0].slice(0, 40)) : h.pattern} x${h.count}`).join('; ')}` : '0';
      const tokens = t.pass == null
        ? `n/a${t.varUses ? ` (${t.varUses} var() unchecked)` : ''}${t.reason && !/generic/.test(t.reason) ? ` — ${esc(t.reason)}` : ''}`
        : t.violations?.length ? `${t.violations.length} of ${t.varUses}: ${t.violations.map(x => `--${x.name}`).join(', ')}` : `0 of ${t.varUses} var()`;
      rows.push(`| ${env} | ${r.scenario}${st.label !== r.scenario ? ` › ${esc(st.label.replace(r.scenario, '').trim())}` : ''} | ${ms(st.tPreviewMs)} (total ${ms(st.tTotalMs)}${st.llmCalls != null ? `, ${st.llmCalls} llm` : ''}) | ${esc(outcome)} | ${esc(verify)} | ${esc(catalog)} | ${esc(forbidden)} | ${esc(tokens)} |`);
    }

    const issues = readScenarioIssues(facts, r.scenario).filter(i => ['error', 'fail', 'retry', 'phase', 'not_verified', 'repair', 'not_measured', 'warning'].includes(i.kind));
    if (issues.length) issueBlocks.push(`### ${env} › ${r.scenario}\n\n${issues.map(i => `- **${i.kind}** ${esc(i.text).slice(0, 400)}`).join('\n')}`);
  }
}

const md = [
  `# Durability bench — ${path.basename(dir)}`,
  '',
  `Generic fidelity scoring (\`bench/fidelity.mjs --generic\`) across ${envFiles.length} environment(s), from the packed tarball. Component-name expectations are n/a by design; catalog conformance and declared-token conformance stand in for them.`,
  '',
  '## Results',
  '',
  '| env | scenario | time to preview | outcome | verification | catalog conformance | forbidden hits | invented tokens |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  '## What each environment offered the model',
  '',
  '| env | catalog | declared tokens |',
  '|---|---|---|',
  ...(knowledgeRows.length ? knowledgeRows : ['| – | – | – |']),
  '',
  '## Setup',
  '',
  '| env | outcome | tarball install | config | importPath | API key | Playwright | server / storybook up | bench exit / s |',
  '|---|---|---|---|---|---|---|---|---|',
  ...setupRows,
  '',
  '## Issues, per scenario',
  '',
  ...(issueBlocks.length ? issueBlocks.flatMap(b => [b, '']) : ['- none recorded', '']),
  '## Files',
  '',
  ...envFiles.map(f => { const env = f.replace('.env.txt', ''); return `- \`${env}.md\` — that environment's fidelity report; \`${env}/\` — the full run; \`${env}.server.log\`, \`${env}.storybook.log\`, \`${env}.setup.log\``; }),
  '',
].join('\n');

fs.writeFileSync(path.join(dir, 'README.md'), md);
console.log(md);
