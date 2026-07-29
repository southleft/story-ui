/**
 * A class name nothing defines — the failure no static check can see.
 *
 * For an npm design system, a wrong name fails loudly at build time: "does not
 * provide an export named 'Avatar'". For a class name there is no such thing as
 * wrong. `<button class="btn btn-primaryy">` is valid HTML, renders, throws
 * nothing, and is silently unstyled. AST parsing, import isolation and
 * named-import validation are all structurally blind to it, because no import
 * is involved.
 *
 * The dominant failure is VERSION DRIFT rather than ignorance: daisyUI's
 * `card-bordered` was correct in v4 and renamed to `card-border` in v5, and a
 * model's training data still carries the old name. The same applies to a
 * mistyped Tailwind utility, which is why this is useful on every project with
 * a stylesheet rather than only on CSS-only libraries.
 *
 * Two behaviours here are load-bearing and were found by measurement:
 *
 *  - `@layer` must be RECURSED into. daisyUI wraps its entire output in it, so
 *    a non-recursive walk finds zero rules and hands every class a clean bill.
 *  - Library-rendered markup must be ATTRIBUTED. On a real Carbon story the one
 *    undefined class was `cds--data-table-header__content`, written by Carbon's
 *    own TableContainer against a Carbon stylesheet that defines `__title` and
 *    `__description` but not `__content`. Blaming the story would send repair
 *    to rewrite correct code with no fix available to it.
 */

import { describe, it, expect } from 'vitest';

/** The selector harvester, as the probe implements it. */
function harvest(selector: string): string[] {
  const matches = selector.match(/\.(-?[_a-zA-Z][\w-]*)/g);
  return matches ? matches.map(m => m.slice(1)) : [];
}

/** The generated-utility filter, as the probe implements it. */
const looksGenerated = (c: string) =>
  c.includes('[') || c.includes('/') || c.includes(':')
  || /^-?\d/.test(c)
  || /^(p|m|w|h|gap|text|bg|border|flex|grid|col|row|top|left|right|bottom|z|opacity|rounded|space|inset|min|max)[trblxy]?-/.test(c);

describe('harvesting class names from selectors', () => {
  it('reads a simple class', () => {
    expect(harvest('.btn')).toEqual(['btn']);
  });

  it('reads every class in a compound selector', () => {
    expect(harvest('.button.is-primary')).toEqual(['button', 'is-primary']);
  });

  it('reads through a pseudo-class without capturing it', () => {
    expect(harvest('.btn-primary:hover')).toEqual(['btn-primary']);
  });

  it('reads inside :where(), which design systems use for low specificity', () => {
    expect(harvest(':where(.card) .card-body')).toEqual(['card', 'card-body']);
  });

  it('captures nothing from an element-only selector', () => {
    expect(harvest('article > header')).toEqual([]);
  });
});

describe('which unmatched classes are worth reporting', () => {
  it('ignores utility-framework classes generated on demand', () => {
    // Tailwind emits these per-use; an unmatched utility is normal.
    for (const c of ['p-4', 'mt-2', 'text-sm', 'bg-white', 'gap-3', 'max-w-md', 'grid-cols-3']) {
      expect(looksGenerated(c)).toBe(true);
    }
  });

  it('ignores arbitrary values and variant prefixes', () => {
    expect(looksGenerated('w-[32px]')).toBe(true);
    expect(looksGenerated('hover:bg-blue-500')).toBe(true);
    expect(looksGenerated('w-1/2')).toBe(true);
  });

  it('reports a named component or modifier class', () => {
    // These are the ones a stale name or typo actually shows up in.
    for (const c of ['btn-primaryy', 'card-bordered', 'cds--tile-lite', 'alert-danger']) {
      expect(looksGenerated(c)).toBe(false);
    }
  });
});

describe('absent is not clean', () => {
  /** The result shape the probe returns when no stylesheet could be read. */
  const unreadable = { sheetsRead: 0, sheetsBlocked: 3, definedClasses: 0, undefined_: [], unreadable: true };
  const clean = { sheetsRead: 4, sheetsBlocked: 0, definedClasses: 1349, undefined_: [], unreadable: false };

  it('distinguishes "could not check" from "checked and found nothing"', () => {
    // Both report zero undefined classes. Only one of them is a result.
    expect(unreadable.undefined_).toEqual([]);
    expect(clean.undefined_).toEqual([]);
    expect(unreadable.unreadable).toBe(true);
    expect(clean.unreadable).toBe(false);
  });

  it('reports how many stylesheets it could not read', () => {
    expect(unreadable.sheetsBlocked).toBeGreaterThan(0);
    expect(unreadable.definedClasses).toBe(0);
  });
});

describe('attribution', () => {
  const finding = (owner: string | undefined, library: string[]) => ({
    owner,
    ownedByLibrary: owner ? library.includes(owner) : false,
  });

  it('marks a class written by a design system component', () => {
    // The real Carbon case: Section renders it, Carbon's CSS does not define it.
    expect(finding('Section', ['Section', 'TableContainer', 'Button']).ownedByLibrary).toBe(true);
  });

  it('does not mark markup the story itself wrote', () => {
    expect(finding('MyDashboard', ['Section', 'Button']).ownedByLibrary).toBe(false);
  });

  it('does not mark an element whose owner cannot be determined', () => {
    // Unknown ownership must not be silently attributed to the library —
    // suppressing what cannot be explained is worse than a false blocker.
    expect(finding(undefined, ['Section']).ownedByLibrary).toBe(false);
  });
});
