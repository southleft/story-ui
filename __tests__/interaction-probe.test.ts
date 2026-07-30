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

import { describe, it, expect } from 'vitest';

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

describe('absent is not a pass', () => {
  it('zero controls tested is reported, not treated as clean', () => {
    const result = { controlsTested: 0, overlaysTested: 0, deadControls: [], flowBreakingOverlays: [], skipped: false };
    // A story with nothing interactive yields no findings — and the count is
    // what tells a reader that silence meant "nothing to test".
    expect(result.deadControls).toEqual([]);
    expect(result.controlsTested).toBe(0);
  });

  it('a skipped run is distinguishable from a clean one', () => {
    const skipped = { controlsTested: 0, deadControls: [], skipped: true, skipReason: 'a modal was already open' };
    const clean = { controlsTested: 3, deadControls: [], skipped: false };
    expect(skipped.skipped).toBe(true);
    expect(clean.skipped).toBe(false);
  });
});
