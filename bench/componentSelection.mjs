/**
 * Component-selection bench.
 *
 * The question this answers is the one that decides whether a user commits
 * after one prompt or after six: did the model reach for the RIGHT components
 * from this project's design system, and use them correctly?
 *
 * Every other gate we have can pass while the answer is no. A composition that
 * hand-rolls pagination out of Card and Grid, when the library ships a
 * DataTable, renders correctly, verifies clean, passes a11y, and shows a
 * provenance panel full of real design system components — and reads as
 * not-of-this-design-system to the person who owns it.
 *
 * The first version of this bench scored 5/5 on its first run and therefore
 * measured nothing. These cases are deliberately harder: dense, stateful,
 * multi-region compositions of the kind a PM actually asks for, where the
 * library ships a composite that is easy to miss.
 *
 *   node bench/componentSelection.mjs --mcp http://localhost:4101
 *   node bench/componentSelection.mjs --no-manifest      # A/B the Storybook context
 *   node bench/componentSelection.mjs --cases 3 --only crm
 *
 * Deliberately not a unit test: it spends real LLM calls.
 */

import { extractProps } from '../dist/story-generator/knowledge/propExtractor.js';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);

const MCP = arg('mcp', 'http://localhost:4101');
const ONLY = arg('only', null);
const LIMIT = Number(arg('cases', '0')) || Infinity;
const USE_MANIFEST = !flag('no-manifest');
const PROJECT = arg('project', '/Users/tjpitre/Sites/test-storybooks/react-mantine');
const IMPORT_PATH = arg('import', '@mantine/core');

/**
 * expect     at least one of each group must appear — the composite that exists
 * avoidTags  raw HTML that means the model rebuilt something already shipped
 * minRegions rough density check: a dashboard that returns one card is not the
 *            thing that was asked for, and is the most common way a complex
 *            prompt quietly under-delivers
 */
const CASES = [
  {
    id: 'crm-contact',
    prompt: 'A CRM contact detail view: header with avatar, name, company and status; '
      + 'tabs for Activity, Notes and Deals; an activity timeline; and a right sidebar '
      + 'with contact fields and an owner assignment dropdown',
    expect: [['Tabs'], ['Timeline', 'List', 'Stack'], ['Avatar'], ['Select', 'NativeSelect']],
    avoidTags: ['table', 'select'],
    minRegions: 3,
  },
  {
    id: 'financial-calculator',
    prompt: 'A loan calculator with inputs for amount, interest rate and term, '
      + 'a slider for the down payment, a computed monthly payment summary, '
      + 'and an amortization table for the first twelve months',
    expect: [['NumberInput', 'TextInput'], ['Slider'], ['Table']],
    avoidTags: ['table', 'input'],
    minRegions: 3,
  },
  {
    id: 'monitoring',
    prompt: 'A service monitoring dashboard: four status tiles with uptime percentages, '
      + 'a filterable incident table with severity badges, and a side panel listing '
      + 'on-call engineers with an escalate button on each',
    expect: [['Table'], ['Badge'], ['SimpleGrid', 'Grid']],
    avoidTags: ['table'],
    minRegions: 3,
  },
  {
    id: 'inventory-bulk',
    prompt: 'A product inventory manager with row checkboxes for bulk selection, '
      + 'a bulk actions toolbar that appears when rows are selected, '
      + 'sortable columns, and pagination',
    expect: [['Table'], ['Checkbox'], ['Pagination']],
    avoidTags: ['table', 'input'],
    minRegions: 2,
  },
  {
    id: 'settings-accordion',
    prompt: 'An account settings page with collapsible sections for profile, security '
      + 'and billing, each containing a form, and a sticky save bar at the bottom',
    expect: [['Accordion'], ['TextInput'], ['Button']],
    avoidTags: ['input', 'details'],
    minRegions: 2,
  },
];

async function generate(prompt) {
  const res = await fetch(`${MCP}/mcp/generate-story-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, provider: 'claude', useStorybookMcp: USE_MANIFEST }),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', completion = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const l of lines) {
      if (!l.startsWith('data: ')) continue;
      try { const e = JSON.parse(l.slice(6)); if (e.type === 'completion') completion = e.data; } catch { /* partial */ }
    }
  }
  return completion;
}

function importsOf(code) {
  return [...code.matchAll(/import\s*(?:type\s*)?{([^}]+)}\s*from\s*['"]([^'"]+)['"]/g)]
    .map(m => ({
      from: m[2],
      names: m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean),
    }));
}

/**
 * Props React or the DOM accept anywhere; never a library's fault.
 *
 * Includes standard HTML attributes, because a component that renders a DOM
 * element passes them straight through. `Table.Td colSpan` was flagged as a
 * hallucination on the first hardened run; it is plain HTML.
 */
const UNIVERSAL = new Set([
  'key', 'ref', 'style', 'className', 'children', 'id', 'role', 'title', 'tabIndex',
  'component', 'renderRoot', 'href', 'target', 'rel', 'type', 'name', 'value',
  'onClick', 'onChange', 'onSubmit', 'onBlur', 'onFocus', 'onKeyDown', 'onMouseEnter', 'onMouseLeave',
  // HTML passthrough
  'colSpan', 'rowSpan', 'scope', 'headers', 'span', 'placeholder', 'disabled', 'checked',
  'readOnly', 'required', 'autoFocus', 'autoComplete', 'maxLength', 'minLength',
  'min', 'max', 'step', 'pattern', 'multiple', 'accept', 'alt', 'src', 'srcSet',
  'width', 'height', 'loading', 'defaultValue', 'defaultChecked', 'htmlFor', 'form',
  'colspan', 'rowspan',
]);

/** Every JSX attribute name used anywhere in a set of files. */
function propsUsedIn(files) {
  const used = new Set();
  for (const f of files) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/<[A-Z][A-Za-z0-9.]*\s+([^/>]*?)\/?>/gs)) {
      for (const a of m[1].matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)=/g)) used.add(a[1]);
    }
  }
  return used;
}

/** Every .stories.* file in the project that we did not generate. */
function teamStoryFiles(projectRoot, generatedFragment = 'generated') {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === generatedFragment) continue;
        walk(full, depth + 1);
      } else if (/\.stories\.[jt]sx?$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(projectRoot, 'src'));
  return out;
}

/**
 * Props the design system does not appear to accept.
 *
 * A hallucinated prop is the most direct way a generation costs a round trip:
 * it renders, it looks almost right, and the value silently does nothing.
 *
 * Validated against a UNION vocabulary rather than per-component sets, because
 * per-component was measurably wrong. propExtractor reads only locally declared
 * props, so every prop a library inherits from a shared base is invisible to
 * it — for Mantine that is the entire style-prop system, and the first run
 * flagged `Text.c`, `Text.fw` and `Group.mb`, all of which are correct.
 *
 * The vocabulary is therefore: props the library declares anywhere, plus every
 * prop the team uses in their OWN stories. A prop the team writes is valid by
 * definition, which is the same principle the rest of this work relies on and
 * needs no knowledge of any particular library's inheritance scheme.
 */
function invalidProps(code, vocabulary, designSystemNames) {
  if (!vocabulary || vocabulary.size === 0) return [];
  const bad = [];
  for (const m of code.matchAll(/<([A-Z][A-Za-z0-9.]*)\s+([^/>]*?)\/?>/gs)) {
    const [, comp, attrs] = m;
    // Only design system components. A local project component defines its own
    // props, which this vocabulary knows nothing about — the first run flagged
    // `PriceTag.amount` on a component the project itself ships.
    const base = comp.split('.')[0];
    if (!designSystemNames.has(base)) continue;
    for (const a of attrs.matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)=/g)) {
      const prop = a[1];
      if (UNIVERSAL.has(prop) || prop.startsWith('data-') || prop.startsWith('aria-')) continue;
      if (/^on[A-Z]/.test(prop)) continue;
      if (!vocabulary.has(prop)) bad.push(`${comp}.${prop}`);
    }
  }
  return [...new Set(bad)];
}

/** Distinct top-level visual regions, as a crude density signal. */
function regionCount(code) {
  const containers = (code.match(/<(Paper|Card|Section|Fieldset|Accordion|Tabs\.Panel)\b/g) || []).length;
  return containers;
}

async function main() {
  let cases = CASES;
  if (ONLY) cases = cases.filter(c => c.id.includes(ONLY));
  cases = cases.slice(0, LIMIT);

  process.stdout.write('Building prop vocabulary… ');
  const vocabulary = new Set();
  try {
    const extracted = await extractProps(IMPORT_PATH, PROJECT);
    for (const c of Object.values(extracted?.components ?? {})) {
      for (const p of c.props || []) vocabulary.add(p.name);
    }
  } catch { /* declared props unavailable; team usage still carries it */ }
  const teamFiles = teamStoryFiles(PROJECT);
  for (const p of propsUsedIn(teamFiles)) vocabulary.add(p);
  console.log(`${vocabulary.size} prop names (${teamFiles.length} team stories)`);

  console.log(`\nBench — ${cases.length} case(s), Storybook context ${USE_MANIFEST ? 'ON' : 'OFF'}, ${MCP}\n`);

  const results = [];
  for (const c of cases) {
    process.stdout.write(`${c.id.padEnd(22)} `);
    let completion;
    try { completion = await generate(c.prompt); }
    catch (e) { console.log(`ERROR ${e.message}`); results.push({ id: c.id, ok: false, error: e.message }); continue; }
    if (!completion?.code) { console.log('no code'); results.push({ id: c.id, ok: false, error: 'no code' }); continue; }

    const code = completion.code;
    const imports = importsOf(code);
    const used = new Set(imports.flatMap(i => i.names));
    const dsNames = new Set(
      imports.filter(i => i.from === IMPORT_PATH || i.from.startsWith(`${IMPORT_PATH}/`))
        .flatMap(i => i.names),
    );

    const missing = c.expect.filter(g => !g.some(n => used.has(n))).map(g => g.join('|'));
    const handRolled = (c.avoidTags || []).filter(t => new RegExp(`<${t}[\\s>]`).test(code));
    const foreign = imports.map(i => i.from)
      .filter(f => !f.startsWith('.') && !/^(react|@storybook)/.test(f))
      .filter(f => !new RegExp(IMPORT_PATH.split('/')[0].replace('@', ''), 'i').test(f))
      .filter(f => !/icons/i.test(f));
    const bogus = invalidProps(code, vocabulary, dsNames);
    const regions = regionCount(code);
    const thin = regions < (c.minRegions || 0);

    const ok = !missing.length && !handRolled.length && !foreign.length && !bogus.length && !thin;
    results.push({
      id: c.id, ok, missing, handRolled, foreign,
      invalidProps: bogus.slice(0, 6), regions,
      verification: completion.verification?.outcome,
      blockers: completion.verification?.findings?.filter(f => f.severity === 'blocker').length ?? 0,
      lines: code.split('\n').length,
    });

    console.log([
      ok ? 'PASS' : 'FAIL',
      missing.length ? `missing:${missing.join(',')}` : '',
      handRolled.length ? `raw<${handRolled.join(',')}>` : '',
      bogus.length ? `badProps:${bogus.slice(0, 3).join(',')}` : '',
      thin ? `thin:${regions}regions` : '',
      foreign.length ? `foreign:${foreign.join(',')}` : '',
      `[${completion.verification?.outcome ?? '?'}]`,
    ].filter(Boolean).join(' '));
  }

  const pass = results.filter(r => r.ok).length;
  const verified = results.filter(r => r.verification === 'verified').length;
  console.log(`\nselection+usage: ${pass}/${results.length}`);
  console.log(`verified:        ${verified}/${results.length}`);
  console.log(`\n${JSON.stringify(results, null, 1)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
