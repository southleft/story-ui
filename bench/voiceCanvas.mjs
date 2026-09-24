/**
 * Voice canvas bench — does Jev turn the demo script into the right edits?
 *
 * Replays a spoken session step by step against a real project's catalog,
 * carrying the canvas code forward exactly as the Voice Canvas does, and
 * checks each result against what the step should have produced. Jev is
 * called for real (TYPESAFE_API_KEY), so this costs fractions of a cent a
 * run; no LLM is called — a `fallback` is recorded, not executed.
 *
 *   cd ../college-town && node ../story-ui/bench/voiceCanvas.mjs
 *   node bench/voiceCanvas.mjs --project ../college-town [--verbose] [--no-pointer]
 *
 * Prints one line at the end:
 *   voice script: N/M as expected · fast path K/M · median Jev Xms · $Y
 *
 * A step whose Jev call failed is NOT RUN — counted in neither column and
 * said out loud, so a dead key never reads as a wrong answer.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const flag = n => args.includes(`--${n}`);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(REPO, 'dist');
const project = path.resolve(arg('project', process.cwd()));
process.chdir(project);

// The project's .env holds the key, as it does for the server.
const envFile = path.join(project, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.TYPESAFE_API_KEY) {
  console.log(`NOT RUN: TYPESAFE_API_KEY is not set (looked in ${envFile})`);
  process.exit(2);
}

const load = rel => import(pathToFileURL(path.join(DIST, rel)).href);
const { loadUserConfig } = await load('story-generator/configLoader.js');
const { getCanvasComponents } = await load('mcp-server/routes/canvasGenerate.js');
const { voicePropsFor } = await load('mcp-server/routes/canvasVoice.js');
const { decideVoiceEdit } = await load('story-generator/voice/decide.js');
const { EMPTY_CANVAS_CODE, parseCanvas } = await load('story-generator/voice/canvasTree.js');
const { readStorybookGlobals } = await load('story-generator/voice/storybookGlobals.js');

// Discovery is chatty; keep the bench output readable.
const quiet = !flag('verbose');
const realLog = console.log;
if (quiet) console.log = () => {};
const config = loadUserConfig();
const catalog = await getCanvasComponents(config);
const propsFor = name => voicePropsFor(config, name);
const globals = readStorybookGlobals(project);
console.log = realLog;

const has = re => code => re.test(code);
const last = tag => code => { const t = parseCanvas(code); return [...t.nodes].reverse().find(n => n.tag === tag)?.id ?? null; };

/**
 * The demo, in order. `expect` is what a correct canvas contains afterwards;
 * `outcome` is the kind a correct decision returns. `pointer` is what the
 * person pointed at in the video, found from the code at that moment.
 */
const SCRIPT = [
  { say: 'Add a card titled Invite a teammate and a description saying give someone access to your account',
    outcome: 'applied', expect: [has(/<CardTitle>Invite a teammate<\/CardTitle>/i), has(/<CardDescription>Give someone access to your account<\/CardDescription>/i)] },
  { say: 'Add an email input', outcome: 'applied', expect: [has(/<Input\b[^>]*type="email"/)] },
  { say: 'Change the placeholder text to email address', outcome: 'applied', expect: [has(/placeholder="email address"/)] },
  { say: 'Add a checkbox', outcome: 'applied', expect: [has(/<Checkbox\b/)] },
  { say: 'Update the text to say send welcome email', outcome: 'applied', pointer: last('Label'), expect: [has(/>Send welcome email</)] },
  { say: 'Check the box by default', outcome: 'applied', pointer: last('Checkbox'), expect: [has(/<Checkbox\b[^>]*\b(defaultChecked|checked)\b/)] },
  { say: 'Add a send button', outcome: 'applied', expect: [has(/<Button\b/)] },
  { say: 'The text should be send', outcome: 'applied', pointer: last('Button'), expect: [has(/<Button\b[^>]*>Send<\/Button>/)] },
  { say: 'Make the button full width', outcome: 'fallback', pointer: last('Button') },
  // A project whose toolbar declares a theme switches it; one that does not
  // hands the restyle to the model.
  { say: 'Black UI', outcome: globals.some(g => g.items.some(i => /dark/i.test(`${i.value} ${i.title ?? ''}`))) ? 'setting' : 'fallback', keep: true },
  { say: 'Make the accent color green', outcome: 'fallback' },
  { say: 'update the title to say', outcome: 'incomplete', keep: true },
  { say: 'undo that', outcome: 'command', keep: true },
  { say: 'um hold on a second', outcome: 'ignored', keep: true },
];

const usePointer = !flag('no-pointer');
let code = EMPTY_CANVAS_CODE;
let recent = null;
const rows = [];
let usd = 0;

realLog(`voice canvas bench · ${path.basename(project)} · ${catalog.length} components · ${globals.length} preview setting(s) · pointer ${usePointer ? 'on' : 'off'}\n`);

for (const [i, step] of SCRIPT.entries()) {
  const pointer = usePointer && step.pointer ? step.pointer(code) : null;
  let out;
  try {
    if (quiet) console.log = () => {};
    out = await decideVoiceEdit({ transcript: step.say, code, pointer, recent }, { catalog, propsFor, globals });
  } catch (e) {
    out = { kind: 'error', reason: e.message, steps: [], stats: { ms: 0, calls: 0, questions: 0, usd: 0 } };
  } finally {
    console.log = realLog;
  }
  // A failed Jev call surfaces as a fallback whose reason names Jev.
  const notRun = out.kind === 'error' || (out.kind === 'fallback' && /^Jev |TYPESAFE/.test(out.reason));
  const next = out.kind === 'applied' ? out.code : code;
  const okKind = out.kind === step.outcome;
  const okCode = !step.expect || step.expect.every(f => f(next));
  const ok = !notRun && okKind && okCode;
  usd += out.stats.usd || 0;
  rows.push({ ok, notRun, fast: out.kind !== 'fallback', ms: out.stats.ms, questions: out.stats.questions });

  const mark = notRun ? 'NOT RUN' : ok ? 'ok  ' : 'MISS';
  const detail = out.kind === 'applied' || out.kind === 'setting' ? out.summary : out.kind === 'command' ? out.command : out.reason;
  realLog(`${String(i + 1).padStart(2)} ${mark} ${step.say}`);
  realLog(`      → ${out.kind}${okKind ? '' : ` (expected ${step.outcome})`}: ${detail}` +
    ` · ${out.stats.calls} call(s), ${out.stats.questions} q, ${out.stats.ms}ms${pointer ? ` · pointer ${pointer}` : ''}`);
  if (!ok || flag('verbose')) {
    for (const s of out.steps) realLog(`        ${s.step}: ${s.value}${s.confidence !== undefined ? ` (${s.confidence.toFixed(2)})` : ''}`);
  }
  if (!okCode && out.kind === 'applied') realLog(`      code did not contain what this step should produce`);
  if (!step.keep) code = next;
  if (out.kind === 'applied') recent = out.touched || null;
}

const judged = rows.filter(r => !r.notRun);
const msList = judged.map(r => r.ms).filter(Boolean).sort((a, b) => a - b);
const median = msList.length ? msList[Math.floor(msList.length / 2)] : 0;
const notRun = rows.length - judged.length;
realLog(`\n--- final canvas ---\n${code}`);
realLog(
  `voice script: ${judged.filter(r => r.ok).length}/${judged.length} as expected` +
  ` · fast path ${judged.filter(r => r.fast).length}/${judged.length}` +
  ` · median Jev ${median}ms · $${usd.toFixed(5)}` +
  (notRun ? ` · ${notRun} NOT RUN` : ''),
);
