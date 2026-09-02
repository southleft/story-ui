/**
 * Layout arithmetic, checked in a real browser.
 *
 * Reported from manual testing: compositions had ragged left edges and did not
 * sit on the grid. That reads as an aesthetic complaint and is not one —
 * `lg={5}` beside `lg={6}` in a sixteen-column grid is a sum that does not
 * reach sixteen.
 *
 * These pin the CONSERVATISM as much as the detection. This probe has more
 * opportunity to produce confident nonsense than any other: real designs have
 * deliberate asymmetry, partial final rows and intentional indentation. A
 * verification system that fails correct work is worse than none.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { resolveHostTooling } from '../story-generator/verify/hostTooling.js';
import { acquireBrowser, closeBrowserSession } from '../story-generator/verify/browserSession.js';
import { runLayoutProbe } from '../story-generator/verify/probes/layout.js';

/**
 * These launch a real Chromium. Everything else in the suite is pure.
 *
 * Observed twice: the whole file failing while a Storybook dev server and
 * other Playwright scripts were competing for the same browser, then passing
 * on the next run with no code change. That is an environmental race, not a
 * logic defect — but a suite that fails at random is a suite people stop
 * reading, which costs more than the flake does.
 *
 * Retries are scoped to this file so a genuine regression elsewhere still
 * fails on the first attempt.
 */

const tooling = resolveHostTooling('/Users/tjpitre/Sites/test-storybooks/react-mantine');
let browser: any;

beforeAll(async () => {
  if (!tooling) return;
  // The shared session browser — the same one the pipeline renders in.
  browser = await acquireBrowser(tooling).catch(() => undefined);
}, 60_000);

afterAll(async () => { await closeBrowserSession(); });

/** Render bare markup and run the probe against it. */
async function probe(html: string) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent(`<div id="storybook-root">${html}</div>`);
  await page.waitForTimeout(60);
  const result = await runLayoutProbe(page);
  await page.close();
  return result;
}

const grid = (children: string, cols = 16) =>
  `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px">${children}</div>`;
const cell = (span: number, h = 60) =>
  `<div style="grid-column:span ${span};height:${h}px;background:#eee">x</div>`;

describe.runIf(tooling)('layout probe — grid coverage', { retry: 2 }, () => {
  it('flags a row that leaves a large part of the grid empty', async () => {
    // The reported defect: 5 + 6 of 16.
    const r = await probe(grid(cell(5) + cell(6)));
    expect(r.problems.some(p => p.kind === 'grid_underfilled')).toBe(true);
    expect(r.problems[0].message).toContain('11 of 16');
  }, 30_000);

  it('passes a row that fills the grid', async () => {
    const r = await probe(grid(cell(4).repeat(4)));
    expect(r.problems.filter(p => p.kind === 'grid_underfilled')).toHaveLength(0);
  }, 30_000);

  it('allows a small designed inset', async () => {
    // 15 of 16 is a margin someone chose, not dead space.
    const r = await probe(grid(cell(15)));
    expect(r.problems.filter(p => p.kind === 'grid_underfilled')).toHaveLength(0);
  }, 30_000);

  it('does not fault a partial LAST row', async () => {
    // Seven cards in a four-up grid wrap to 4 + 3. The short row is correct,
    // and faulting it would flag most working galleries.
    const r = await probe(grid(cell(4).repeat(7)));
    expect(r.problems.filter(p => p.kind === 'grid_underfilled')).toHaveLength(0);
  }, 30_000);

  it('ignores grids too narrow for the question to mean anything', async () => {
    const r = await probe(grid(cell(1), 2));
    expect(r.metrics.grids).toBe(0);
  }, 30_000);

  it('stays silent when a span cannot be read honestly', async () => {
    // `auto` placement is not countable. One unknown child makes the row
    // unmeasurable rather than under-counted — guessing here would flag
    // correct layouts constantly.
    const r = await probe(grid('<div style="height:60px">a</div>' + cell(4)));
    expect(r.problems.filter(p => p.kind === 'grid_underfilled')).toHaveLength(0);
  }, 30_000);
});

describe.runIf(tooling)('layout probe — ragged edges', { retry: 2 }, () => {
  const stack = (offsets: number[]) =>
    `<div>${offsets.map(o => `<div style="margin-left:${o}px;height:40px">item</div>`).join('')}</div>`;

  it('flags stacked blocks a few pixels out of line', async () => {
    const r = await probe(stack([0, 3, 0, 1]));
    expect(r.problems.some(p => p.kind === 'ragged_edges')).toBe(true);
  }, 30_000);

  it('accepts a clean stack', async () => {
    const r = await probe(stack([0, 0, 0, 0]));
    expect(r.problems.filter(p => p.kind === 'ragged_edges')).toHaveLength(0);
  }, 30_000);

  it('treats a real indent as deliberate, not ragged', async () => {
    // 32px in is a decision. Only small, accidental offsets are the defect.
    const r = await probe(stack([0, 32, 0, 0]));
    expect(r.problems.filter(p => p.kind === 'ragged_edges')).toHaveLength(0);
  }, 30_000);

  it('does not expect a horizontal row to share a left edge', async () => {
    const row = `<div style="display:flex">${[0, 1, 2].map(() => '<div style="width:100px;height:40px">c</div>').join('')}</div>`;
    const r = await probe(row);
    expect(r.problems.filter(p => p.kind === 'ragged_edges')).toHaveLength(0);
  }, 30_000);
});
