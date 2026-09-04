/**
 * Two false blockers the cross-library bench produced, each of which cost a
 * repair pass that could fix nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testHostTooling } from './helpers/hostProject.js';
import { acquireBrowser, closeBrowserSession } from '../story-generator/verify/browserSession.js';
import { runInteractionProbe } from '../story-generator/verify/probes/interaction.js';
import { runDomCensus } from '../story-generator/verify/probes/domCensus.js';

const tooling = testHostTooling();
let browser: any;
beforeAll(async () => { if (tooling) browser = await acquireBrowser(tooling).catch(() => undefined); }, 60_000);
afterAll(async () => { await closeBrowserSession(); });

describe.runIf(tooling)('probe false blockers', { retry: 2 }, () => {
  it('an MUI-style outlined input (aria-hidden fieldset beside the real input) is not a fake field', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root"><label for="q">Search users</label>' +
      '<div class="MuiInputBase-root" style="position:relative;display:inline-flex;border:1px solid #ccc;padding:8px">' +
      '<input id="q" placeholder="Search users" />' +
      '<fieldset aria-hidden="true" style="position:absolute;inset:0;border:1px solid #ccc;pointer-events:none"><legend><span>Search users</span></legend></fieldset>' +
      '</div></div>',
    );
    const r = await runDomCensus(page);
    await page.close();
    expect(r.problems.filter(p => p.kind === 'fake_field')).toEqual([]);
  });

  it('an accordion that pushes content below it is a disclosure, not an in-flow overlay', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root">' +
      '<button id="t" aria-expanded="false" aria-controls="panel" onclick="var p=document.getElementById(\'panel\');p.hidden=!p.hidden;this.setAttribute(\'aria-expanded\',String(!p.hidden))">Billing</button>' +
      '<div id="panel" hidden><p>Invoices are sent monthly.</p><p>Second line.</p></div>' +
      '<p id="after">Content that moves down when the panel opens.</p>' +
      '</div>',
    );
    const r = await runInteractionProbe(page);
    await page.close();
    expect(r.flowBreakingOverlays).toEqual([]);
  });

  it('a menu trigger whose popup is in flow is still reported', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root">' +
      '<button id="t" aria-haspopup="menu" aria-expanded="false" aria-controls="m" onclick="var m=document.getElementById(\'m\');m.hidden=!m.hidden;this.setAttribute(\'aria-expanded\',String(!m.hidden))">Actions</button>' +
      '<ul id="m" role="menu" hidden><li role="menuitem">Edit</li><li role="menuitem">Delete</li><li role="menuitem">Archive</li></ul>' +
      '<p>Row below the menu.</p>' +
      '</div>',
    );
    const r = await runInteractionProbe(page);
    await page.close();
    expect(r.flowBreakingOverlays.length).toBe(1);
  });
});
