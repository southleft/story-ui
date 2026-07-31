/**
 * List detection and the occurrence contract, as MEASURED on live fibers.
 *
 * FIXTURES MIRROR LIVE FIBERS AS MEASURED on 2026-07-30 against react-mantine
 * (Mantine 8, pricing-cards-52a2a33e) and college-town (Radix/Tailwind local
 * source, campus-events-fb39f0a6). The original rule here — `key != null`
 * within 6 fibers means "rendered from a list" — was wrong twice over on real
 * fibers:
 *
 *   1. Mantine's own `React.Children` processing stamps POSITIONAL keys on
 *      elements the story wrote as plain children: the measured "Claim
 *      discount" Button (not in any list) carries key '.1' from Group, and
 *      the CTA Button carries '.2' from Card. `key != null` called both
 *      "from a list".
 *   2. The authored key of a real list sat OUT OF REACH: Mantine's Card puts
 *      6 fibers between a CTA Button and its keyed row `<div key="Pro">`, so
 *      the fixed 6-hop walk found the library's '.2' instead — right answer,
 *      wrong evidence — and on college-town the keyed row was found but the
 *      occurrence was then WITHHELD, which the server turned into "edit the
 *      first <Button> in the file": the Alert's button, not the clicked one.
 *
 * The corrected rules, verified against both live environments:
 *   - only an AUTHORED key is list evidence (bare like 'Pro'/'evt-1', or
 *     Children-wrapped '.$k'); bare '.'-positional keys ('.0', '.1') are a
 *     library reshuffling children it was handed (isAuthoredListKey).
 *   - the walk runs to the OWNER's fiber, not a fixed hop count — the owner
 *     authored every key in that region, and stopping there keeps Storybook's
 *     keyed ErrorBoundary (key = the story id) out of reach.
 *   - the occurrence is SENT for list elements too: the census counts a whole
 *     list once, so the number maps any clicked row to the single JSX element
 *     that renders them all.
 */

import { describe, it, expect } from 'vitest';
import { isAuthoredListKey } from '../templates/StoryUIV2/elementTargeting.js';

describe('isAuthoredListKey — authored list keys vs library Children keys', () => {
  it('accepts the bare authored keys measured on both live environments', () => {
    expect(isAuthoredListKey('Pro')).toBe(true);      // <div key={tier.name}> (Mantine story)
    expect(isAuthoredListKey('evt-1')).toBe(true);    // <div key={event.id}> (college-town story)
    expect(isAuthoredListKey('row-2')).toBe(true);
    expect(isAuthoredListKey(0)).toBe(true);          // key={index} arrives as a number-ish key
  });

  it('rejects the positional Children keys measured on live Mantine 8', () => {
    expect(isAuthoredListKey('.1')).toBe(false);      // Button inside Group ("Claim discount")
    expect(isAuthoredListKey('.2')).toBe(false);      // Button inside Card (tier CTA)
    expect(isAuthoredListKey('.0')).toBe(false);
  });

  it('accepts a Children-WRAPPED authored key — the author still keyed a list', () => {
    // React.Children.toArray over children the author keyed produces '.$k'.
    expect(isAuthoredListKey('.$item-3')).toBe(true);
  });

  it('rejects the absent key', () => {
    expect(isAuthoredListKey(null)).toBe(false);
    expect(isAuthoredListKey(undefined)).toBe(false);
  });
});

/**
 * The owner-bounded key walk the extractor performs, mirrored over synthetic
 * fibers shaped like the measured chains. (The extractor's copy runs inside
 * the preview document and shares isAuthoredListKey by source injection.)
 */
function listWalk(
  fiber: { key?: string | null; name?: string | null; return?: any } | null,
  ownerName: string | null,
): boolean {
  let k: any = fiber;
  let up = 0;
  const limit = ownerName ? 30 : 6;
  while (k && up++ < limit) {
    if (ownerName && k.name === ownerName) break;
    if (isAuthoredListKey(k.key)) return true;
    if (k === k.return) break;
    k = k.return;
  }
  return false;
}

/** Build a fiber chain from innermost to outermost. */
function chain(...entries: Array<{ key?: string | null; name?: string | null }>) {
  let head: any = null;
  let prev: any = null;
  for (const e of entries) {
    const f = { key: e.key ?? null, name: e.name ?? null, return: null };
    if (prev) prev.return = f; else head = f;
    prev = f;
  }
  return head;
}

describe('owner-bounded list walk', () => {
  it('finds the authored row key through Mantine Card depth (measured: 6 fibers away)', () => {
    // Button('.2') → div → Box → Paper → ctx → Provider → Card → div('Pro') → … → PricingPage
    const f = chain(
      { key: '.2', name: 'Button' }, { name: null }, { name: 'Box' }, { name: 'Paper' },
      { name: null }, { name: 'Provider' }, { name: 'Card' }, { key: 'Pro', name: null },
      { name: null }, { name: 'SimpleGrid' }, { name: null }, { name: 'PricingPage' },
    );
    expect(listWalk(f, 'PricingPage')).toBe(true);
  });

  it('does not flag the measured "Claim discount" shape — Children keys are not lists', () => {
    // Button('.1') → div → Box → Group → div → Box → div → Box → PromoBanner
    const f = chain(
      { key: '.1', name: 'Button' }, { name: null }, { name: 'Box' }, { name: 'Group' },
      { name: null }, { name: 'Box' }, { name: null }, { name: 'Box' }, { name: 'PromoBanner' },
    );
    expect(listWalk(f, 'PromoBanner')).toBe(false);
  });

  it('finds the authored key on the college-town Register shape', () => {
    // Button → div → CardFooter → div → Card → div('evt-1') → … → CampusEventsPage
    const f = chain(
      { name: 'Button' }, { name: null }, { name: 'CardFooter' }, { name: null },
      { name: 'Card' }, { key: 'evt-1', name: null }, { name: null }, { name: null },
      { name: 'CampusEventsPage' },
    );
    expect(listWalk(f, 'CampusEventsPage')).toBe(true);
  });

  it('never reaches Storybook\'s keyed ErrorBoundary — the owner bound stops first', () => {
    // The ErrorBoundary key IS the story id — authored-looking, and beyond
    // the story's own component. Walking past the owner would flag every
    // click on the page as a list.
    const f = chain(
      { name: 'Button' }, { name: null }, { name: 'VolunteerBanner' },
      { name: 'CampusEventsPage' }, { name: 'hookified' }, { name: 'unboundStoryFn' },
      { key: 'campus-events-fb39f0a6--default', name: 'ErrorBoundary' },
    );
    expect(listWalk(f, 'VolunteerBanner')).toBe(false);
  });

  it('keeps the conservative 6-hop bound when the owner is unknown', () => {
    let root: any = { key: 'outer-list', name: null, return: null };
    for (let i = 0; i < 10; i++) root = { key: null, name: null, return: root };
    expect(listWalk(root, null)).toBe(false);
  });

  it('terminates on a self-referential chain', () => {
    const cyclic: any = { key: null, name: null };
    cyclic.return = cyclic;
    expect(() => listWalk(cyclic, 'Page')).not.toThrow();
    expect(listWalk(cyclic, 'Page')).toBe(false);
  });
});

describe('what the panel sends', () => {
  /** Mirrors the occurrence choice in PropertyPanel. */
  const occurrenceFor = (t: { fromList?: boolean; sourceOccurrence?: number; occurrence?: number }) =>
    t.sourceOccurrence ?? t.occurrence;

  it('SENDS the occurrence for a list element — the census counts the whole list once', () => {
    // Withholding it let the server default to the FIRST element of that name
    // in the file: measured, clicking a Register button inside a list edited
    // the Alert's button. The owner-scoped census counts one entry per list,
    // so the number maps the click to the JSX element that renders every row.
    expect(occurrenceFor({ fromList: true, sourceOccurrence: 0 })).toBe(0);
  });

  it('still sends the occurrence for a literal element', () => {
    expect(occurrenceFor({ fromList: false, sourceOccurrence: 3 })).toBe(3);
  });

  it('omits — never defaults — when nothing resolved, so the server can refuse honestly', () => {
    // Sending 0 here is the silent-wrong-element edit. Absent and zero must
    // not look alike; the server answers absence with a 409 and a count.
    expect(occurrenceFor({})).toBeUndefined();
  });
});

describe('what the user is told', () => {
  /** Mirrors the notice choice in PropertyPanel. */
  const notice = (t: { fromList?: boolean }, occurrencesInSource?: number) =>
    t.fromList ? 'list' : (typeof occurrencesInSource === 'number' && occurrencesInSource > 1) ? 'multi' : 'none';

  it('warns on a list even though the source holds ONE element', () => {
    // occurrencesInSource is 1 for a .map(), so a source-count test stays
    // silent exactly when the user clicked one row and every row changed.
    expect(notice({ fromList: true }, 1)).toBe('list');
  });

  it('still warns when the source genuinely repeats the element', () => {
    expect(notice({ fromList: false }, 3)).toBe('multi');
  });

  it('says nothing for an unambiguous single edit', () => {
    expect(notice({ fromList: false }, 1)).toBe('none');
  });
});
