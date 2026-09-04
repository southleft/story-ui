/**
 * A violation on the story ROOT is the harness's environment, not the story.
 *
 * Radix and every `aria-hidden`-based overlay mark `#storybook-root`
 * aria-hidden while a Select, Dialog or Popover is open. When the interaction
 * probe's close had not landed by the time axe ran, a correct college-town
 * form was blocked for "ARIA hidden element must not contain focusable
 * elements" — filed against Storybook's own root. Set aside and counted,
 * never dropped silently.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { testHostTooling } from './helpers/hostProject.js';
import { acquireBrowser, closeBrowserSession } from '../story-generator/verify/browserSession.js';
import { runA11yProbe } from '../story-generator/verify/probes/a11y.js';

const tooling = testHostTooling();
let browser: any;

beforeAll(async () => {
  if (!tooling) return;
  browser = await acquireBrowser(tooling).catch(() => undefined);
}, 60_000);

afterAll(async () => { await closeBrowserSession(); });

describe.runIf(tooling && tooling.axePath)('axe on a root an overlay left hidden', { retry: 2 }, () => {
  it('waits for Escape to restore the root, then finds nothing wrong with the story', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root" aria-hidden="true">' +
      '<button>Save draft</button>' +
      '</div>' +
      '<script>document.addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("storybook-root").removeAttribute("aria-hidden"); });</script>'
    );
    const r = await runA11yProbe(page, tooling!);
    await page.close();

    expect(r.ran).toBe(true);
    expect(r.violations.map(v => v.id)).not.toContain('aria-hidden-focus');
    expect(r.environmentViolations).toBeUndefined();
  });

  it('sets aside a root-targeted violation when the overlay will not close, and counts it', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root" aria-hidden="true">' +
      '<button>Save draft</button>' +
      '</div>'
    );
    const r = await runA11yProbe(page, tooling!);
    await page.close();

    expect(r.ran).toBe(true);
    expect(r.violations.map(v => v.id)).not.toContain('aria-hidden-focus');
    expect((r.environmentViolations || []).map(v => v.id)).toContain('aria-hidden-focus');
  });

  it('still reports a defect inside the story', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root">' +
      '<button><svg width="12" height="12"></svg></button>' +
      '</div>'
    );
    const r = await runA11yProbe(page, tooling!);
    await page.close();

    expect(r.ran).toBe(true);
    expect(r.violations.map(v => v.id)).toContain('button-name');
  });
});
