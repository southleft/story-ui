/**
 * First-attempt bench — how often is the FIRST model output already right?
 *
 * WHY THIS EXISTS. The pipeline hides its own failure rate. Validation
 * self-heals up to three times, browser verification repairs, and the
 * shippable gate regenerates up to three times — and a story that cost four
 * model calls and two rewrites reports exactly what a story that was correct
 * immediately reports: "Verified". That is fine for the user and useless for
 * us, because we are about to invest in PREVENTION (better pre-generation
 * knowledge, a better prompt) and there is currently no number to move.
 *
 * So this bench drives the real server over the real SSE endpoint and records,
 * per prompt, what happened BEFORE any healing:
 *
 *   validationAttempts   did the first model output pass static validation?
 *   repairRan/Improved   did browser verification have to repair it, and did it help?
 *   gateAttempts         how many full regenerations the gate spent, and why
 *   firstAttemptClean    all three, as one boolean
 *
 * WHERE IT SITS AMONG THE OTHER BENCHES. resolution.mjs measures KNOWLEDGE
 * (deterministic, free, run on every change). componentSelection.mjs measures
 * JUDGEMENT (LLM, noisy, run rarely). This one measures the PIPELINE — it
 * costs real model calls and minutes, so it is a before/after instrument for a
 * prevention change, not something to run on every commit.
 *
 * ABSENT IS NOT ZERO. Every number this bench cannot measure is recorded as
 * null and printed as `?`, never as 0 and never as "clean". A run verification
 * could not judge is counted in neither column; the percentage is over what
 * was judged, and the count of unjudged runs is printed beside it.
 *
 *   node bench/firstAttempt.mjs --server http://localhost:4109 --storybook http://localhost:6109
 *   node bench/firstAttempt.mjs --server http://localhost:4110 --suite 6 --keep
 *   node bench/firstAttempt.mjs --server http://localhost:4110 --only c01,c05,w03
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRecord, summarise, headline, formatTable, formatSummary } from './lib/firstAttemptRecord.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);

/** This repository, found from the script's location — never a machine path. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the Storybook fixtures live. Same convention as resolution.mjs: only
 * their LOCATION is configurable, because they are separate checkouts.
 */
const PROJECTS_ROOT = process.env.STORY_UI_TEST_PROJECTS
  ? path.resolve(process.env.STORY_UI_TEST_PROJECTS)
  : path.resolve(REPO, '..', 'test-storybooks');

/**
 * The prompt set, in the script so two runs are comparable.
 *
 * Ten "classic" and ten "workspace" prompts spanning simple → complex. They
 * are only prompts; the split names where they were first collected, and is
 * kept so a subset can be taken evenly across the range rather than off the
 * easy end.
 */
export const PROMPTS = [
  { id: 'c01', suite: 'classic', complexity: 'simple', prompt: 'A primary button labelled "Save changes" next to a secondary "Cancel" button' },
  { id: 'c02', suite: 'classic', complexity: 'simple', prompt: 'A small card with a title, one line of text and a primary button' },
  { id: 'c03', suite: 'classic', complexity: 'simple', prompt: 'A success alert that says "Your profile was updated" with a dismiss button' },
  { id: 'c04', suite: 'classic', complexity: 'medium', prompt: 'Create a navigation bar with logo and menu links' },
  { id: 'c05', suite: 'classic', complexity: 'medium', prompt: 'A login form with email, password, a "Remember me" checkbox and a submit button, with inline validation messages' },
  { id: 'c06', suite: 'classic', complexity: 'medium', prompt: 'A pricing table with three tiers (Starter, Pro, Team), a feature list per tier and the middle tier highlighted' },
  { id: 'c07', suite: 'classic', complexity: 'medium', prompt: 'A user profile card with avatar, name, role, three stats and Follow / Message buttons' },
  { id: 'c08', suite: 'classic', complexity: 'complex', prompt: 'A settings page with a left sidebar of sections and a form on the right for the Profile section, with a sticky save bar' },
  { id: 'c09', suite: 'classic', complexity: 'complex', prompt: 'A data table of orders with sortable columns, a status badge per row, row selection checkboxes and pagination' },
  { id: 'c10', suite: 'classic', complexity: 'complex', prompt: 'An analytics dashboard with four stat tiles, a chart placeholder area, a recent activity list and a date range filter' },
  { id: 'w01', suite: 'workspace', complexity: 'simple', prompt: 'A badge that says "New" in the brand colour' },
  { id: 'w02', suite: 'workspace', complexity: 'simple', prompt: 'A text input labelled "Email address" with helper text and an error state' },
  { id: 'w03', suite: 'workspace', complexity: 'simple', prompt: 'A modal dialog titled "Delete project?" with a warning message, Cancel and a destructive Delete button' },
  { id: 'w04', suite: 'workspace', complexity: 'medium', prompt: 'A hero section with a headline, supporting text, a primary and a secondary call to action, and an image placeholder' },
  { id: 'w05', suite: 'workspace', complexity: 'medium', prompt: 'A newsletter signup card with a heading, an email field and a subscribe button, with a success state' },
  { id: 'w06', suite: 'workspace', complexity: 'medium', prompt: 'A notifications list with five items, unread items emphasised, and a "Mark all as read" action' },
  { id: 'w07', suite: 'workspace', complexity: 'medium', prompt: 'A product card grid, three columns, each with image, name, price, rating and an add-to-cart button' },
  { id: 'w08', suite: 'workspace', complexity: 'complex', prompt: 'A three-step checkout wizard with a stepper, a shipping form on step one, and Back / Continue buttons' },
  { id: 'w09', suite: 'workspace', complexity: 'complex', prompt: 'A kanban board with three columns (To do, In progress, Done) and cards with title, assignee avatar and a priority tag' },
  { id: 'w10', suite: 'workspace', complexity: 'complex', prompt: 'An inbox layout with a message list on the left, the selected message on the right, a reply box, and a toolbar with archive and delete' },
];

/**
 * A subset of n prompts, taken EVENLY across the ordered set.
 *
 * Taking the first n would take the three simple classics and call the result
 * a first-attempt rate; the complexity range is the point of the set.
 */
export function selectSuite(prompts, n) {
  if (!n || n >= prompts.length) return prompts;
  const step = prompts.length / n;
  return Array.from({ length: n }, (_, i) => prompts[Math.floor(i * step)]);
}

// ============================================================
// Driving one generation
// ============================================================

/**
 * POST /mcp/generate-story-stream and collect every SSE event.
 *
 * The request shape is the panel's (templates/StoryUI/StoryUIPanel.tsx): a
 * fresh story, no conversation, no images, `storybookUrl` sent unconditionally
 * so browser verification knows where to look. Without it the server verifies
 * against port 6006 by convention and reports a story that indexed fine as
 * missing — which would show up here as a fake gate regeneration.
 */
async function generate({ server, storybook, prompt, timeoutMs }) {
  const events = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${server}/mcp/generate-story-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt.prompt,
        conversation: [{ role: 'user', content: prompt.prompt }],
        isUpdate: false,
        storybookUrl: storybook || undefined,
        useStorybookMcp: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { events, durationMs: Date.now() - startedAt, transportError: { code: `HTTP_${res.status}`, message: await res.text().catch(() => res.statusText) } };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try { events.push(JSON.parse(line.slice(6))); } catch { /* a partial frame; the next chunk completes it */ }
      }
    }
    return { events, durationMs: Date.now() - startedAt, transportError: null };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      events,
      durationMs: Date.now() - startedAt,
      transportError: { code: aborted ? 'TIMEOUT' : 'TRANSPORT', message: aborted ? `no completion within ${Math.round(timeoutMs / 1000)}s` : String(err?.message ?? err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Remove what the run wrote, so the project is left as it was found.
 *
 * DELETE /story-ui/stories/:id removes the file AND the manifest entry, and it
 * resolves the id the same way the panel does. A story left behind changes the
 * next run's Storybook index, so cleanup is part of the measurement, not tidying.
 */
async function deleteStory(server, record) {
  const id = record.fileName || record.storyId;
  if (!id) return { deleted: false, reason: 'run produced no file' };
  try {
    const res = await fetch(`${server}/story-ui/stories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) return { deleted: true };
    return { deleted: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { deleted: false, reason: String(err?.message ?? err) };
  }
}

// ============================================================
// Run
// ============================================================

async function main() {
  const server = (arg('server', 'http://localhost:4001')).replace(/\/$/, '');
  const storybook = (arg('storybook', '')).replace(/\/$/, '');
  const projectArg = arg('project', '');
  const project = projectArg
    ? (path.isAbsolute(projectArg) ? projectArg : path.resolve(PROJECTS_ROOT, projectArg))
    : null;
  const timeoutMs = Number(arg('timeout', '600')) * 1000;
  const keep = flag('keep');

  const only = arg('only', '');
  let prompts = only
    ? PROMPTS.filter(p => only.split(',').map(s => s.trim()).includes(p.id))
    : selectSuite(PROMPTS, Number(arg('suite', '0')) || 0);
  if (prompts.length === 0) {
    console.error(`No prompts selected. Known ids: ${PROMPTS.map(p => p.id).join(', ')}`);
    process.exit(2);
  }

  // A server that is not there must fail loudly and immediately, not as
  // twenty transport errors that look like twenty bad generations.
  try {
    const probe = await fetch(`${server}/mcp/components`, { signal: AbortSignal.timeout(10000) });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.error(`Story UI server unreachable at ${server}/mcp/components: ${err?.message ?? err}`);
    console.error('Start it with:  cd <project> && PORT=<port> node <story-ui>/dist/mcp-server/index.js');
    process.exit(2);
  }
  if (!storybook) {
    console.log('WARNING: no --storybook given. Browser verification will look for Storybook by convention,');
    console.log('         so verification may report "not verified" and those runs will be UNJUDGED, not clean.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(REPO, 'bench', 'results', 'first-attempt', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const envLabel = arg('name', project ? path.basename(project) : server);
  console.log(`first-attempt bench · ${envLabel} · ${prompts.length} prompt(s) · server ${server}${storybook ? ` · storybook ${storybook}` : ''}`);
  console.log(`results → ${path.relative(process.cwd(), outDir) || outDir}\n`);

  const records = [];
  for (const [i, prompt] of prompts.entries()) {
    process.stdout.write(`[${i + 1}/${prompts.length}] ${prompt.id} (${prompt.complexity}) … `);
    const { events, durationMs, transportError } = await generate({ server, storybook, prompt, timeoutMs });
    const record = buildRecord({ prompt, events, durationMs, env: envLabel, transportError });
    const cleanup = keep ? { deleted: false, reason: 'kept (--keep)' } : await deleteStory(server, record);
    record.cleanup = cleanup;
    records.push(record);
    /**
     * The events are stored beside the record so a finished run can be
     * RE-SCORED when the definition changes, instead of re-paying for it —
     * `llm_text` excluded, because the code streams through it token by token
     * and it is 90% of the bytes for none of the facts.
     */
    fs.writeFileSync(
      path.join(outDir, `${prompt.id}.json`),
      JSON.stringify({ ...record, events: events.filter(e => e?.type !== 'llm_text') }, null, 2),
    );
    const mark = record.firstAttemptClean === true ? 'CLEAN'
      : record.firstAttemptClean === false ? 'dirty' : 'UNKNOWN';
    console.log(`${mark}  val ${record.validation.attempts ?? '?'} · gate ${record.gate.attempts ?? '?'} · ${record.modelCalls ?? '?'} calls · ${record.seconds ?? '?'}s`);
    if (!keep && !cleanup.deleted) console.log(`        NOT CLEANED UP: ${cleanup.reason}`);
  }

  const summary = summarise(records);
  console.log('');
  console.log(formatTable(records));
  console.log('');
  console.log(formatSummary(summary));

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
    env: envLabel, server, storybook: storybook || null, project,
    startedAt: stamp, prompts: prompts.map(p => p.id), summary, headline: headline(summary),
  }, null, 2));

  // Exit code reports whether the RUN was valid, not whether the pipeline
  // scored well: a low first-attempt rate is the finding, not a bench failure.
  const broken = records.filter(r => r.outcome === 'transport-error' || r.outcome === 'incomplete').length;
  if (broken) console.log(`\n${broken} run(s) never completed — this run is INCOMPLETE, not a measurement.`);
  process.exit(broken ? 1 : 0);
}

// Importable for tests without running anything.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
