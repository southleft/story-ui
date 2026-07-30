/**
 * A list-produced element has no meaningful source OCCURRENCE.
 *
 * `sourceOccurrence` counts matching elements in DOM document order, which only
 * corresponds to source order when every match is a literal JSX element.
 *
 * The failure, which was silent and confident:
 *
 *   {rows.map(r => <Card key={r.id}/>)}    → 3 Cards in the DOM
 *   <Card/>                                → 1 more, literal
 *
 * Source holds 2 `<Card>`; the DOM holds 4. Clicking the SECOND mapped card
 * yields DOM occurrence 1, and the server edits source element 1 — the literal
 * card. Not a 409, not an error: the wrong element, edited confidently, in a file
 * someone else reviews. One degree worse than the "silent no-op that looks like
 * success" this project keeps finding.
 *
 * React hands over the discriminator for nothing: `key` is non-null only for
 * children produced from an array, because React requires keys there. One
 * property read on a fiber the code already walks — no parse, no round trip, no
 * per-library knowledge.
 */

import { describe, it, expect } from 'vitest';

/** The `key`-walk the targeting code performs, over a synthetic fiber chain. */
function producedFromList(fiber: { key?: string | null; return?: any } | null, maxUp = 6): boolean {
  let k: any = fiber;
  let up = 0;
  while (k && up++ < maxUp) {
    if (k.key != null) return true;
    if (k === k.return) break;
    k = k.return;
  }
  return false;
}

describe('detecting a list-produced element', () => {
  it('recognises a keyed fiber', () => {
    expect(producedFromList({ key: 'row-2' })).toBe(true);
  });

  it('recognises a keyed ANCESTOR within reach', () => {
    // The clicked node is inside a keyed row: `<Card key=..><Text/></Card>`.
    expect(producedFromList({ key: null, return: { key: 'row-2', return: null } })).toBe(true);
  });

  it('does not flag a literal element', () => {
    expect(producedFromList({ key: null, return: { key: null, return: null } })).toBe(false);
  });

  it('does not walk indefinitely up a long chain', () => {
    // A keyed ancestor far above is somebody else's list, not this element's.
    let root: any = { key: 'outer-list', return: null };
    for (let i = 0; i < 10; i++) root = { key: null, return: root };
    expect(producedFromList(root)).toBe(false);
  });

  it('terminates on a self-referential chain', () => {
    const cyclic: any = { key: null };
    cyclic.return = cyclic;
    expect(() => producedFromList(cyclic)).not.toThrow();
    expect(producedFromList(cyclic)).toBe(false);
  });
});

describe('what the panel sends', () => {
  /** Mirrors the occurrence choice in PropertyPanel. */
  const occurrenceFor = (t: { fromList?: boolean; sourceOccurrence?: number; occurrence?: number }) =>
    t.fromList ? undefined : t.sourceOccurrence ?? t.occurrence ?? 0;

  it('omits the occurrence for a list element, so the single source element is edited', () => {
    expect(occurrenceFor({ fromList: true, sourceOccurrence: 1, occurrence: 1 })).toBeUndefined();
  });

  it('still sends the occurrence for a literal element', () => {
    expect(occurrenceFor({ fromList: false, sourceOccurrence: 3 })).toBe(3);
  });

  it('falls back to the DOM occurrence when no source occurrence resolved', () => {
    expect(occurrenceFor({ occurrence: 2 })).toBe(2);
  });

  it('defaults to the first element rather than sending nothing', () => {
    expect(occurrenceFor({})).toBe(0);
  });
});

describe('what the user is told', () => {
  /** Mirrors the notice choice in PropertyPanel. */
  const notice = (t: { fromList?: boolean }, occurrencesInSource?: number) =>
    t.fromList ? 'list' : (typeof occurrencesInSource === 'number' && occurrencesInSource > 1) ? 'multi' : 'none';

  it('warns on a list even though the source holds ONE element', () => {
    // This is the case the previous check missed entirely: occurrencesInSource
    // is 1, so a source-count test stays silent exactly when the user clicked
    // one row and every row changed.
    expect(notice({ fromList: true }, 1)).toBe('list');
  });

  it('still warns when the source genuinely repeats the element', () => {
    expect(notice({ fromList: false }, 3)).toBe('multi');
  });

  it('says nothing for an unambiguous single edit', () => {
    expect(notice({ fromList: false }, 1)).toBe('none');
  });
});
