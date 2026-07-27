/**
 * Component-selection bench.
 *
 * The question this answers is the one that decides whether a user commits
 * after one prompt or after six: did the model reach for the RIGHT components
 * from this project's design system?
 *
 * Every gate we already have can pass while the answer is no. A composition
 * that hand-rolls pagination out of Card and Grid, when the library ships a
 * DataTable, renders correctly, verifies clean, passes a11y, and shows a
 * provenance panel full of real design system components — and reads as
 * not-of-this-design-system to the person who owns it. Selection is invisible
 * to everything else we measure.
 *
 * Deliberately not a unit test: it spends real LLM calls. Run it when changing
 * anything that touches prompt assembly, discovery or the catalog.
 *
 *   node bench/componentSelection.mjs --mcp http://localhost:4101 [--cases n]
 *
 * The corpus is intentionally small and hand-labelled. A large auto-generated
 * one would measure agreement with a generator, not fidelity to a design system.
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const MCP = arg('mcp', 'http://localhost:4101');
const LIMIT = Number(arg('cases', '0')) || Infinity;

/**
 * Each case says what a competent author of THIS design system would reach for.
 *
 *  expect     at least one of these must appear — the composite that exists
 *  avoid      a primitive that means the model rebuilt something already shipped
 *  forbidden  packages outside the design system, which are never acceptable
 */
const CASES = [
  {
    id: 'pricing-table',
    prompt: 'A pricing table with three tiers and a highlighted recommended plan',
    expect: [['Card', 'Paper'], ['Button'], ['Badge', 'ThemeIcon']],
    avoid: [],
  },
  {
    id: 'data-table',
    prompt: 'A sortable inventory table with product name, SKU, stock level and row actions',
    // The point of the case: a library with a Table should not get <table>.
    expect: [['Table', 'DataTable']],
    avoid: ['table'],
  },
  {
    id: 'settings-tabs',
    prompt: 'A settings page with tabbed sections for profile, notifications and billing',
    expect: [['Tabs']],
    avoid: [],
  },
  {
    id: 'search-form',
    prompt: 'A search form with a text field, a category dropdown and a submit button',
    // A real input, not a div styled to look like one.
    expect: [['TextInput', 'Input', 'TextField'], ['Select', 'NativeSelect'], ['Button']],
    avoid: ['input'],
  },
  {
    id: 'confirm-dialog',
    prompt: 'A confirmation dialog asking the user to confirm deleting an account',
    expect: [['Modal', 'Dialog']],
    avoid: [],
  },
];

async function generate(prompt) {
  const res = await fetch(`${MCP}/mcp/generate-story-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, provider: 'claude' }),
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
      try {
        const e = JSON.parse(l.slice(6));
        if (e.type === 'completion') completion = e.data;
      } catch { /* partial frame */ }
    }
  }
  return completion;
}

/** Imported names, grouped by the package they came from. */
function importsOf(code) {
  return [...code.matchAll(/import\s*(?:type\s*)?{([^}]+)}\s*from\s*['"]([^'"]+)['"]/g)]
    .map(m => ({
      from: m[2],
      names: m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean),
    }));
}

/** Raw HTML tags used in JSX — how "rebuilt it by hand" shows up. */
function rawTags(code, tag) {
  return new RegExp(`<${tag}[\\s>]`).test(code);
}

async function main() {
  const cases = CASES.slice(0, LIMIT);
  console.log(`Component-selection bench — ${cases.length} case(s) against ${MCP}\n`);

  const results = [];
  for (const c of cases) {
    process.stdout.write(`${c.id.padEnd(16)} `);
    let completion;
    try {
      completion = await generate(c.prompt);
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      results.push({ id: c.id, ok: false, reason: String(e.message) });
      continue;
    }
    if (!completion?.code) {
      console.log('no code returned');
      results.push({ id: c.id, ok: false, reason: 'no code' });
      continue;
    }

    const code = completion.code;
    const imports = importsOf(code);
    const used = new Set(imports.flatMap(i => i.names));

    // Every expectation group needs at least one member present.
    const missing = c.expect.filter(group => !group.some(n => used.has(n)));
    const handRolled = (c.avoid || []).filter(tag => rawTags(code, tag));

    // Anything outside the design system, the project, or Storybook itself.
    const foreign = imports
      .map(i => i.from)
      .filter(f => !f.startsWith('.') && !/^(react|@storybook)/.test(f))
      .filter(f => !/mantine|chakra|mui|antd|vuetify|shoelace/i.test(f))
      .filter(f => !/icons/i.test(f));

    const ok = missing.length === 0 && handRolled.length === 0 && foreign.length === 0;
    results.push({
      id: c.id, ok,
      used: [...used].slice(0, 12),
      missing: missing.map(g => g.join('|')),
      handRolled, foreign,
      verification: completion.verification?.outcome,
    });

    console.log(
      ok ? 'PASS' : 'FAIL',
      missing.length ? `| missing: ${missing.map(g => g.join('|')).join(', ')}` : '',
      handRolled.length ? `| hand-rolled <${handRolled.join('>, <')}>` : '',
      foreign.length ? `| foreign: ${foreign.join(', ')}` : '',
    );
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} selected the right components.`);
  // Reported separately: a story can verify clean and still choose badly, which
  // is the entire reason this bench exists.
  const verified = results.filter(r => r.verification === 'verified').length;
  console.log(`${verified}/${results.length} also verified in the browser.`);
  console.log('\n' + JSON.stringify(results, null, 1));
}

main().catch(e => { console.error(e); process.exit(1); });
