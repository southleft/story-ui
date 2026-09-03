import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveHostTooling } from '../story-generator/verify/hostTooling.js';
import { acquireBrowser, closeBrowserSession } from '../story-generator/verify/browserSession.js';
import { runOverflowProbe } from '../story-generator/verify/probes/overflow.js';

const tooling = resolveHostTooling('/Users/tjpitre/Sites/test-storybooks/react-mantine');
let browser: any;
beforeAll(async () => { if (!tooling) return; browser = await acquireBrowser(tooling).catch(() => undefined); }, 60_000);
afterAll(async () => { await closeBrowserSession(); });

async function probe(html: string) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent(`<style>body{margin:0;font-family:Arial}</style><div id="storybook-root">${html}</div>`);
  await page.waitForTimeout(60);
  const result = await runOverflowProbe(page);
  await page.close();
  return result;
}
const tile = (inner: string, w = 200) =>
  `<div style="display:grid;grid-template-columns:repeat(3,${w}px);gap:16px;padding:24px">
     <div style="border:1px solid #999;padding:16px;overflow:visible">${inner}</div>
     <div style="border:1px solid #999;padding:16px">ARTICLES<div style="font-size:48px">128</div></div>
     <div style="border:1px solid #999;padding:16px">FOLLOWERS<div style="font-size:48px">1,240</div></div>
   </div>`;

describe.runIf(tooling)('overflow probe — content escaping its box', { retry: 2 }, () => {
  it('flags a stat value wider than its tile, with the pixels and the fix', async () => {
    const r = await probe(tile(`SEA MILES<div style="font-size:64px;white-space:nowrap;font-weight:700">34,600 <span style="font-size:20px">nm</span></div>`));
    const hits = r.problems.filter(p => p.kind === 'content_escapes');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('34,600');
    expect(hits[0].message).toMatch(/paints \d+px outside the right edge/);
    expect(hits[0].message).toContain('type scale');
  }, 30_000);

  it('passes a value that fits', async () => {
    const r = await probe(tile(`SEA MILES<div style="font-size:32px">34,600</div>`));
    expect(r.problems.filter(p => p.kind === 'content_escapes')).toHaveLength(0);
  }, 30_000);

  it('ignores a badge the source positioned outside the card on purpose', async () => {
    const r = await probe(`<div style="position:relative;border:1px solid #999;width:300px;height:120px;margin:40px">
      <span style="position:absolute;top:-12px;right:-12px;background:#c00;color:#fff;padding:4px 8px">New</span>Body</div>`);
    expect(r.problems.filter(p => p.kind === 'content_escapes')).toHaveLength(0);
  }, 30_000);
});

describe.runIf(tooling)('overflow probe — clipped text', { retry: 2 }, () => {
  it('flags text cut off by overflow hidden without an ellipsis', async () => {
    const r = await probe(`<div style="width:160px;border:1px solid #999;overflow:hidden;white-space:nowrap;padding:8px">A very long product name that will not fit here</div>`);
    const hits = r.problems.filter(p => p.kind === 'text_clipped');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('cut off');
  }, 30_000);

  it('accepts an ellipsis truncation', async () => {
    const r = await probe(`<div style="width:160px;border:1px solid #999;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:8px">A very long product name that will not fit here</div>`);
    expect(r.problems.filter(p => p.kind === 'text_clipped')).toHaveLength(0);
  }, 30_000);
});

describe.runIf(tooling)('overflow probe — overlap, page width, empty boxes', { retry: 2 }, () => {
  it('flags two in-flow siblings that overlap', async () => {
    const r = await probe(`<div style="width:600px;white-space:nowrap"><div style="display:inline-block;width:200px;background:#eee;padding:8px">Left</div><div style="display:inline-block;position:relative;left:-120px;width:200px;background:#ddd;padding:8px">Right</div></div>`);
    const hits = r.problems.filter(p => p.kind === 'sibling_overlap');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('overlap');
  }, 30_000);

  it('does not flag a negative-margin overlap the source wrote', async () => {
    const r = await probe(`<div><div style="display:inline-block;width:40px;height:40px;border-radius:50%;background:#aaa"></div><div style="display:inline-block;width:40px;height:40px;border-radius:50%;background:#888;margin-left:-12px"></div></div>`);
    expect(r.problems.filter(p => p.kind === 'sibling_overlap')).toHaveLength(0);
  }, 30_000);

  it('flags a page wider than the viewport and names the widest element', async () => {
    const r = await probe(`<div style="width:1600px;background:#eee;padding:8px">Wide table</div>`);
    const hits = r.problems.filter(p => p.kind === 'page_overflow');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('wider than the viewport');
  }, 30_000);

  it('flags an empty bordered tile and accepts one with an icon', async () => {
    const r = await probe(`<div style="display:flex;gap:16px"><div style="border:1px solid #999;width:200px;height:120px"></div><div style="border:1px solid #999;width:200px;height:120px"><svg width="24" height="24"><circle cx="12" cy="12" r="10"/></svg></div><hr style="width:200px"></div>`);
    const hits = r.problems.filter(p => p.kind === 'empty_box');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('nothing inside');
  }, 30_000);
});
