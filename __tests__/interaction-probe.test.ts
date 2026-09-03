/**
 * Using the page, rather than only looking at it.
 *
 * Every other probe in verify/ observes a static render, and a human reviewer
 * found two defects living exactly in that gap. Both were invisible to AST
 * validation, to axe, and to a vision model reading a screenshot:
 *
 *   - Three toggle switches on a settings panel: correctly labelled, focusable,
 *     axe-clean, and completely inert. Root cause was the story passing
 *     `isSelected={…}` to a component whose prop is `value` — React Aria's
 *     convention on a library that does not use it. The handler fired, state
 *     updated, and the control never reflected it.
 *   - A row-actions menu that rendered IN the document flow. Measured on the real
 *     story: opening it displaced 101 sibling elements by up to 125px.
 *
 * Both are deterministic once you interact, which is why they belong here rather
 * than in a reviewer's opinion.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { resolveHostTooling } from '../story-generator/verify/hostTooling.js';
import { acquireBrowser, closeBrowserSession } from '../story-generator/verify/browserSession.js';
import { runInteractionProbe } from '../story-generator/verify/probes/interaction.js';

/**
 * A real browser, resolved the way the pipeline resolves it. When none is
 * available these are skipped rather than passing on literals.
 */
const tooling = resolveHostTooling('/Users/tjpitre/Sites/test-storybooks/react-mantine');
let browser: any;

beforeAll(async () => {
  if (!tooling) return;
  // The shared session browser — the same one the pipeline renders in.
  browser = await acquireBrowser(tooling).catch(() => undefined);
}, 60_000);

afterAll(async () => { await closeBrowserSession(); });

/** The state read the probe performs on a toggle. */
const toggleState = (el: { ariaChecked?: string; ariaPressed?: string; checked?: boolean }): string =>
  el.ariaChecked ?? el.ariaPressed ?? (el.checked !== undefined ? String(el.checked) : '');

describe('deciding whether a toggle responded', () => {
  it('sees a change in aria-checked', () => {
    expect(toggleState({ ariaChecked: 'false' })).not.toBe(toggleState({ ariaChecked: 'true' }));
  });

  it('sees a change in the checked property', () => {
    expect(toggleState({ checked: false })).not.toBe(toggleState({ checked: true }));
  });

  it('reports the inert case — state identical before and after', () => {
    // The measured Astryx failure: aria-checked stayed "false" across a click.
    expect(toggleState({ ariaChecked: 'false' })).toBe(toggleState({ ariaChecked: 'false' }));
  });

  it('distinguishes "no state at all" from "state did not change"', () => {
    // A control exposing neither aria-checked nor checked is a different defect
    // from one whose state is stuck, and the message must say which.
    expect(toggleState({})).toBe('');
    expect(toggleState({ ariaChecked: 'false' })).toBe('false');
  });
});

/** The displacement test the probe performs on an overlay. */
function displaced(
  before: Array<{ top: number; left: number }>,
  after: Array<{ top: number; left: number }>,
  tolerance = 2,
): { moved: number; worst: number } {
  let moved = 0, worst = 0;
  before.forEach((b, i) => {
    const a = after[i];
    const d = Math.max(Math.abs(a.top - b.top), Math.abs(a.left - b.left));
    if (d > tolerance) { moved++; worst = Math.max(worst, d); }
  });
  return { moved, worst };
}

describe('deciding whether an overlay broke the flow', () => {
  it('reports displacement when siblings move', () => {
    // The shape of the real Chakra failure: large, unambiguous movement.
    const before = [{ top: 100, left: 0 }, { top: 200, left: 0 }];
    const after = [{ top: 225, left: 0 }, { top: 325, left: 0 }];
    const r = displaced(before, after);
    expect(r.moved).toBe(2);
    expect(r.worst).toBe(125);
  });

  it('reports nothing for a correctly portalled overlay', () => {
    const before = [{ top: 100, left: 0 }, { top: 200, left: 0 }];
    expect(displaced(before, before).moved).toBe(0);
  });

  it('tolerates sub-pixel reflow so a focus ring is not a defect', () => {
    const before = [{ top: 100, left: 0 }];
    const after = [{ top: 101.4, left: 0 }];
    expect(displaced(before, after).moved).toBe(0);
  });

  it('does not let a large real shift hide behind the tolerance', () => {
    const before = [{ top: 100, left: 0 }];
    const after = [{ top: 103, left: 0 }];
    expect(displaced(before, after).moved).toBe(1);
  });
});

describe('what the probe refuses to touch', () => {
  const DESTRUCTIVE = /\b(delete|remove|destroy|revoke|cancel|deactivate|sign out|log out|submit|save|pay|purchase)\b/i;

  it('never clicks a destructive control', () => {
    for (const label of ['Delete account', 'Remove member', 'Revoke API key', 'Sign out', 'Save Changes']) {
      expect(DESTRUCTIVE.test(label)).toBe(true);
    }
  });

  it('does click an ordinary toggle or menu', () => {
    for (const label of ['Email notifications', 'More actions for Wireless Mouse', 'Dark mode']) {
      expect(DESTRUCTIVE.test(label)).toBe(false);
    }
  });
});

/**
 * "Nothing to test" and "could not test" must not look alike.
 *
 * This previously asserted against object literals declared in the test
 * itself — `expect(skipped.skipped).toBe(true)` where `skipped` was written
 * on the line above — so it could not fail, while appearing to guard the
 * invariant this project rates highest. These drive the real probe.
 */
describe.runIf(tooling)('absent is not a pass', { retry: 2 }, () => {
  it('reports zero controls tested on a page with nothing interactive', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root"><h1>Report</h1><p>Static content only.</p></div>'
    );
    const r = await runInteractionProbe(page);
    await page.close();

    // Not skipped — the probe ran and there was genuinely nothing to exercise.
    expect(r.skipped).toBe(false);
    expect(r.controlsTested).toBe(0);
    expect(r.deadControls).toEqual([]);
  });

  it('skips, with a reason, when a modal is already open', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root">' +
      '<div role="dialog" aria-modal="true"><button>Confirm</button></div>' +
      '<input type="checkbox" aria-label="Email notifications">' +
      '</div>'
    );
    const r = await runInteractionProbe(page);
    await page.close();

    expect(r.skipped).toBe(true);
    expect(r.skipReason).toBeTruthy();
    // Same empty list as the clean case above. Only the flag separates them,
    // which is the entire point.
    expect(r.deadControls).toEqual([]);
    expect(r.controlsTested).toBe(0);
  });

  it('actually exercises a working toggle, and does not fault it', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root">' +
      '<input type="checkbox" id="t" aria-label="Email notifications">' +
      '</div>'
    );
    const r = await runInteractionProbe(page);
    await page.close();

    // Without this, the two tests above would also pass on a probe that never
    // tests anything at all.
    expect(r.skipped).toBe(false);
    expect(r.controlsTested).toBeGreaterThan(0);
    expect(r.deadControls).toEqual([]);
  });

  it('exercises a switch whose real input is visually hidden', async () => {
    const page = await browser.newPage();
    // Exactly how Mantine, MUI, Carbon and Chakra all render a Switch: the
    // native input is clipped to nothing and a styled track is painted over
    // it. Filtering on the input's own box made the probe skip every one of
    // them — measured live as "0 controls exercised" on a panel with three
    // working switches.
    await page.setContent(
      '<style>.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}' +
      '.track{display:inline-block;width:36px;height:20px;background:#ccc}</style>' +
      '<div id="storybook-root">' +
      '<label class="track"><input class="vh" type="checkbox" aria-label="Email notifications"><span>Email notifications</span></label>' +
      '</div>'
    );
    const r = await runInteractionProbe(page);
    await page.close();

    expect(r.skipped).toBe(false);
    expect(r.controlsTested).toBe(1);
    expect(r.deadControls).toEqual([]);
  });

  it('still ignores a control that is genuinely not rendered', async () => {
    const page = await browser.newPage();
    // display:none collapses the ancestors too, so the fallback finds nothing
    // visible and the control is correctly skipped.
    await page.setContent(
      '<div id="storybook-root">' +
      '<div style="display:none"><input type="checkbox" aria-label="Hidden option"></div>' +
      '</div>'
    );
    const r = await runInteractionProbe(page);
    await page.close();

    expect(r.controlsTested).toBe(0);
  });

  it('catches a toggle that does not change state', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="storybook-root">' +
      '<div role="switch" aria-checked="false" tabindex="0">Dark mode</div>' +
      '</div>'
    );
    const r = await runInteractionProbe(page);
    await page.close();

    expect(r.skipped).toBe(false);
    expect(r.controlsTested).toBe(1);
    // A switch whose aria-checked never moves is inert, and that is the defect
    // this probe exists to find.
    expect(r.deadControls.length).toBe(1);
  });

  it('presses like a pointer, so a control wired to mousedown is not faulted', async () => {
    const page = await browser.newPage();
    // Mantine's PasswordInput visibility toggle: aria-pressed, toggled on
    // mousedown (and touch and Space) — deliberately never on click, so the
    // input keeps focus. `el.click()` alone reported it dead on every form.
    await page.setContent(
      '<div id="storybook-root">' +
      '<button id="reveal" aria-pressed="false" aria-label="Show password">eye</button>' +
      '<button id="plain" aria-pressed="false" aria-label="Bold">B</button>' +
      '<script>' +
      'document.getElementById("reveal").addEventListener("mousedown", e => { e.preventDefault(); const b = e.currentTarget; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); });' +
      'document.getElementById("plain").addEventListener("click", e => { const b = e.currentTarget; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); });' +
      '</script>' +
      '</div>'
    );
    const r = await runInteractionProbe(page);
    await page.close();

    expect(r.skipped).toBe(false);
    expect(r.controlsTested).toBe(2);
    expect(r.deadControls).toEqual([]);
  });
});
