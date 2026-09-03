import { describe, it, expect } from 'vitest';
import { parseCritique } from '../story-generator/verify/probes/visualCritic';

const reply = (findings: any[]) => JSON.stringify({ findings });

describe('the critic judges shippability', () => {
  it('turns each shippability category into a blocker that names the element and its container', () => {
    const cats = ['overflow', 'overlap', 'clipped', 'empty', 'misaligned', 'illegible', 'unstyled', 'missing'];
    const out = parseCritique(reply(cats.map(c => ({
      category: c, severity: 'warning', element: `the value 34,600 nm (${c})`, container: 'the Sea Miles tile',
      issue: `Category ${c}: the number paints past the tile's right border`, fix: 'use the next smaller size from the type scale for the value',
    }))));
    expect(out).toHaveLength(6); // capped, still six
    expect(out.every(f => f.severity === 'blocker')).toBe(true);
    expect(out.every(f => f.element && f.container === 'the Sea Miles tile')).toBe(true);
    expect(out.map(f => f.category)).toEqual(cats.slice(0, 6));
  });

  it('drops taste, demotes unnamed or fix-less blockers to warnings; an empty list is the normal answer', () => {
    const out = parseCritique(reply([
      { category: 'overflow', severity: 'blocker', element: 'the value 34,600 nm', container: 'the Sea Miles tile', issue: 'The number paints past the tile', fix: 'shrink the value one step on the type scale' },
      { category: 'other', severity: 'warning', element: 'the card', issue: 'Consider a softer shadow for the card', fix: 'maybe reduce it' },
      { category: 'misaligned', severity: 'blocker', issue: 'Some fields are out of line with each other', fix: 'align them' },
      { category: 'empty', severity: 'blocker', element: 'the third column', issue: 'The third column is blank where a card was expected' },
      { severity: 'warning', element: 'the Save button', issue: 'Save and Publish carry the same weight so the primary action is ambiguous', fix: 'make Publish primary and Save secondary' },
    ]));
    // The unnamed misaligned finding and the fix-less empty one are kept as warnings, not blockers.
    expect(out.map(f => [f.category, f.severity])).toEqual([['overflow', 'blocker'], [undefined, 'warning'], [undefined, 'warning'], [undefined, 'warning']]);
    expect(parseCritique(reply([]))).toEqual([]);
    expect(parseCritique('Looks good to me.')).toEqual([]);
  });
});
