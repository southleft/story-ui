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

/**
 * Three defect shapes a designer measured live on a battery of 22 Carbon
 * stories that verification had passed: a pill stretched by its stack, a
 * toolbar spread across the page by equal auto tracks, a row of spans one
 * column short. Bare markup, no React: without a fiber the author is unknown,
 * which must block (nothing here is attributed to a library).
 */
const pill = (text: string, extra = '') =>
  `<span style="display:inline-flex;box-sizing:border-box;padding:0 8px;background:#ddd;max-width:208px;height:24px;${extra}">${text}</span>`;
const button = (text: string, extra = '') =>
  `<button style="padding:0 16px;height:32px;${extra}">${text}</button>`;
const columnStack = (children: string, extra = '') =>
  `<div style="display:grid;grid-auto-flow:row;row-gap:8px;width:600px;${extra}">${children}</div>`;

describe.runIf(tooling)('layout probe — stretched hug-content controls', { retry: 2 }, () => {
  it('flags a pill stretched to its max-width by a grid stack', async () => {
    // The reported defect: a 3-character Tag at 208px, its max-inline-size.
    const r = await probe(columnStack(pill('New') + '<p>copy</p>'));
    const hits = r.problems.filter(p => p.kind === 'stretched_control');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('208px wide');
    expect(hits[0].message).toContain('justify-self: start');
    expect(r.metrics.stretchedControls).toBe(1);
  }, 30_000);

  it('flags a button stretched to the full width of a column flex parent', async () => {
    const r = await probe(`<div style="display:flex;flex-direction:column;width:600px">${button('Save')}<p>copy</p></div>`);
    const hits = r.problems.filter(p => p.kind === 'stretched_control');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('align-self: start');
  }, 30_000);

  it('leaves an element the source sized on purpose alone', async () => {
    // `width: 100%` is a decision. The computed width is the same number as
    // a stretch, so this has to be read from what was written.
    const r = await probe(columnStack(pill('New', 'width:100%;max-width:none')));
    expect(r.problems.filter(p => p.kind === 'stretched_control')).toHaveLength(0);
  }, 30_000);

  it('leaves an element that opted out of stretching alone', async () => {
    const r = await probe(columnStack(pill('New', 'justify-self:start')));
    expect(r.problems.filter(p => p.kind === 'stretched_control')).toHaveLength(0);
  }, 30_000);

  it('does not mistake a paragraph, an input, or a card for a pill', async () => {
    const r = await probe(columnStack(
      '<p>Short text</p>' +
      '<input value="x" />' +
      '<div style="background:#eee;padding:16px;height:120px">A card with a background and room to breathe</div>',
    ));
    expect(r.problems.filter(p => p.kind === 'stretched_control')).toHaveLength(0);
  }, 30_000);

  it('does not report a padded pill whose width is its own', async () => {
    // A row does not stretch its items in the inline axis; the pill hugs.
    const r = await probe(`<div style="display:flex;gap:8px;width:600px">${pill('New')}${pill('Sale')}</div>`);
    expect(r.problems.filter(p => p.kind === 'stretched_control')).toHaveLength(0);
  }, 30_000);
});

describe.runIf(tooling)('layout probe — gap outliers', { retry: 2 }, () => {
  it('flags controls spread by equal auto tracks in a horizontal grid', async () => {
    // Carbon's horizontal Stack: display:grid; grid-auto-flow:column. Two
    // buttons in a 1200px container land at 0 and 606.
    // Buttons size to their label, as a library's do (Carbon: inline-size:
    // max-content); a button stretched to its track is check 4's finding.
    const r = await probe(`<div style="display:grid;grid-auto-flow:column;column-gap:12px;width:1200px">${button('Create report', 'width:max-content')}${button('Invite teammate', 'width:max-content')}</div>`);
    const hits = r.problems.filter(p => p.kind === 'gap_outlier');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('declared gap is 12px');
    expect(hits[0].message).toContain('Invite teammate');
  }, 30_000);

  it('flags three small controls floated by space-evenly', async () => {
    const r = await probe(`<div style="display:flex;justify-content:space-evenly;gap:8px;width:1200px">${button('One')}${button('Two')}${button('Three')}</div>`);
    expect(r.problems.filter(p => p.kind === 'gap_outlier')).toHaveLength(1);
  }, 30_000);

  it('treats two controls pushed to opposite edges as an anchored pair', async () => {
    // Back … Next. Deliberate, and common.
    const r = await probe(`<div style="display:flex;justify-content:space-between;width:1200px">${button('Back')}${button('Next')}</div>`);
    expect(r.problems.filter(p => p.kind === 'gap_outlier')).toHaveLength(0);
  }, 30_000);

  it('ignores a title beside a button — a layout, not a toolbar', async () => {
    // Also: the heading's symmetric UA margin is rhythm, not a one-sided shim.
    const r = await probe(`<div style="display:grid;grid-auto-flow:column;column-gap:12px;width:1200px"><h2>Orders</h2>${button('Export', 'width:max-content')}</div>`);
    expect(r.problems.filter(p => p.kind === 'gap_outlier')).toHaveLength(0);
  }, 30_000);

  it('accepts a grouped toolbar', async () => {
    const r = await probe(`<div style="display:flex;gap:8px;width:1200px">${button('Archive')}${button('Delete')}${button('More')}</div>`);
    expect(r.problems.filter(p => p.kind === 'gap_outlier')).toHaveLength(0);
  }, 30_000);

  it('flags a one-sided margin that drops one field of a pair', async () => {
    // Two equal cells; the second wrapped in marginTop:1rem.
    const field = '<div><label style="display:block;height:16px">Name</label><input style="display:block;height:40px" /></div>';
    const r = await probe(`<div style="display:grid;grid-template-columns:1fr 1fr;column-gap:16px;width:800px"><div>${field}</div><div><div style="margin-top:16px">${field}</div></div></div>`);
    const hits = r.problems.filter(p => p.kind === 'gap_outlier');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('margin-top: 16px');
    expect(hits[0].message).toContain('16px apart');
  }, 30_000);

  it('does not flag an icon nudged down to a taller neighbour', async () => {
    // Optical alignment: a 20px icon dropped to the first line of a 60px block.
    const r = await probe(`<div style="display:flex;gap:8px;width:800px"><svg width="20" height="20" style="margin-top:14px"></svg><div style="height:60px">Two lines of<br/>notification text</div></div>`);
    expect(r.problems.filter(p => p.kind === 'gap_outlier')).toHaveLength(0);
  }, 30_000);

  it('does not flag a margin every cell shares', async () => {
    const r = await probe(`<div style="display:flex;gap:8px;width:800px"><div style="margin-top:16px;height:40px">a</div><div style="margin-top:16px;height:40px">b</div></div>`);
    expect(r.problems.filter(p => p.kind === 'gap_outlier')).toHaveLength(0);
  }, 30_000);
});

describe.runIf(tooling)('layout probe — ragged grid rows', { retry: 2 }, () => {
  it('flags three equal spans that stop one column short', async () => {
    // The reported defect: `lg={5}` ×3 = 15 of 16.
    const r = await probe(grid(cell(5) + cell(5) + cell(5)));
    const hits = r.problems.filter(p => p.kind === 'grid_ragged');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('15 of 16');
    expect(hits[0].message).toContain('5 + 5 + 6');
    expect(r.metrics.raggedRows).toBe(1);
  }, 30_000);

  it('flags a row two columns short', async () => {
    const r = await probe(grid(cell(7) + cell(7)));
    expect(r.problems.filter(p => p.kind === 'grid_ragged')).toHaveLength(1);
  }, 30_000);

  it('leaves a single inset reading column to check 1\'s judgement', async () => {
    const r = await probe(grid(cell(15)));
    expect(r.problems.filter(p => p.kind === 'grid_ragged')).toHaveLength(0);
  }, 30_000);

  it('passes a row that fills the grid', async () => {
    const r = await probe(grid(cell(4).repeat(4)));
    expect(r.problems.filter(p => p.kind === 'grid_ragged')).toHaveLength(0);
  }, 30_000);

  it('treats an explicit line placement as intentional', async () => {
    const r = await probe(grid(cell(5) + cell(5) + '<div style="grid-column:12 / 17;height:60px">x</div>'));
    expect(r.problems.filter(p => p.kind === 'grid_ragged')).toHaveLength(0);
  }, 30_000);

  it('does not fault the partial LAST row of a multi-row grid', async () => {
    const r = await probe(grid(cell(4).repeat(4) + cell(5) + cell(5) + cell(5)));
    expect(r.problems.filter(p => p.kind === 'grid_ragged')).toHaveLength(0);
  }, 30_000);

  it('hands a large shortfall to check 1 rather than reporting it twice', async () => {
    const r = await probe(grid(cell(5) + cell(6)));
    expect(r.problems.filter(p => p.kind === 'grid_ragged')).toHaveLength(0);
    expect(r.problems.filter(p => p.kind === 'grid_underfilled')).toHaveLength(1);
  }, 30_000);
});
