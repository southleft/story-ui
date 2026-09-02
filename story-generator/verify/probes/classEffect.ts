/**
 * Does every class the story uses actually exist in the loaded stylesheets?
 *
 * For an npm design system a wrong name fails loudly at build time — "does not
 * provide an export named 'Avatar'". For a class-name library there is no such
 * thing as a wrong class. `<button class="btn btn-primaryy">` is valid HTML,
 * renders, throws nothing, and is silently unstyled. Every static guard this
 * tool owns — AST parsing, import isolation, named-import validation — is
 * structurally blind to it, because no import is involved.
 *
 * The dominant failure here is NOT ignorance, it is VERSION DRIFT. daisyUI's
 * `card-bordered` was correct in v4 and renamed to `card-border` in v5; a model
 * carries the old name in its training data, and nothing static can tell. The
 * same applies to a mistyped Tailwind utility and to a design-system class
 * renamed between releases — which makes this probe useful on every project
 * with a stylesheet, not only on CSS-only libraries. That breadth is the reason
 * it is worth shipping.
 *
 * Two details that decide whether it works at all:
 *
 *  - `@layer` blocks must be RECURSED into. daisyUI wraps everything in
 *    `@layer`, so a non-recursive walk over `sheet.cssRules` finds zero rules
 *    and would hand every class a clean bill of health.
 *  - A cross-origin stylesheet throws on `.cssRules`. If nothing was readable
 *    the answer is `not_verified`, never "clean" — a probe that cannot run must
 *    not report what a probe that found nothing reports.
 */

export interface ClassEffectResult {
  /** Stylesheets whose rules could be read. */
  sheetsRead: number;
  /** Stylesheets that threw — cross-origin, typically. */
  sheetsBlocked: number;
  /** Distinct class names defined by the readable stylesheets. */
  definedClasses: number;
  /** Classes used in the DOM that no readable stylesheet defines. */
  undefined_: Array<{
    className: string;
    onElements: number;
    sample: string;
    /** The component React says rendered the element carrying it. */
    owner?: string;
    /** True when that component belongs to the design system, not the story. */
    ownedByLibrary?: boolean;
  }>;
  /** True when no stylesheet could be read, so no conclusion is available. */
  unreadable: boolean;
}

export interface ClassEffectOptions {
  /** Design system component names, so a library's own markup can be attributed. */
  libraryComponents?: string[];
}

export async function runClassEffectProbe(
  page: any,
  options: ClassEffectOptions = {},
): Promise<ClassEffectResult> {
  return page.evaluate((opts: ClassEffectOptions) => {
    const LIBRARY = new Set(opts?.libraryComponents || []);
    /* Everything below runs in the page: no imports, no closures over module
       scope — the same constraint every other probe here observes. */

    const defined = new Set<string>();
    let sheetsRead = 0;
    let sheetsBlocked = 0;

    /** Collect class names out of a selector, ignoring pseudo-classes. */
    const harvest = (selector: string) => {
      // `.btn`, `.btn-primary:hover`, `:where(.card) .card-body`
      const matches = selector.match(/\.(-?[_a-zA-Z][\w-]*)/g);
      if (!matches) return;
      for (const m of matches) defined.add(m.slice(1));
    };

    /** Walk rules, descending through grouping rules that contain more rules. */
    const walk = (rules: any, depth: number) => {
      if (!rules || depth > 12) return;
      for (const rule of Array.from<any>(rules)) {
        if (typeof rule?.selectorText === 'string') harvest(rule.selectorText);
        // @layer, @media, @supports, @container all nest rules. daisyUI puts
        // its entire output inside @layer, so missing this finds nothing.
        if (rule?.cssRules) walk(rule.cssRules, depth + 1);
      }
    };

    for (const sheet of Array.from<any>(document.styleSheets)) {
      try {
        const rules = sheet.cssRules;   // throws for cross-origin
        walk(rules, 0);
        sheetsRead++;
      } catch {
        sheetsBlocked++;
      }
    }

    if (sheetsRead === 0) {
      return {
        sheetsRead: 0, sheetsBlocked, definedClasses: 0,
        undefined_: [], unreadable: true,
      };
    }

    const root: HTMLElement =
      (document.querySelector('#storybook-root') as HTMLElement) ||
      (document.querySelector('#root') as HTMLElement) ||
      document.body;

    /**
     * Utility-first frameworks generate classes on demand, so an unmatched
     * utility is normal rather than a defect. Only flag a class that looks like
     * a NAMED component or modifier: no digits-with-units, no slashes, no
     * arbitrary-value brackets, and long enough to be a name.
     */
    const looksGenerated = (c: string) =>
      c.includes('[') || c.includes('/') || c.includes(':')
      || /^-?\d/.test(c)
      || /^(p|m|w|h|gap|text|bg|border|flex|grid|col|row|top|left|right|bottom|z|opacity|rounded|space|inset|min|max)[trblxy]?-/.test(c);

    /**
     * Who rendered this element? Same fiber rule the other probes use.
     *
     * Attribution is not optional here. Measured on a real Carbon story, the
     * only undefined class on the page was `cds--data-table-header__content` —
     * rendered by Carbon's OWN TableContainer.js, against a Carbon stylesheet
     * that defines `__title` and `__description` but not `__content`. That is a
     * defect in the library, and blaming the story for it would send the repair
     * loop to rewrite correct code with no fix available to it.
     */
    const ownerOf = (node: any): string | null => {
      const key = Object.keys(node).find((k: string) =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!key) return null;
      const nameOf = (t: any): string | null => {
        if (!t) return null;
        if (typeof t === 'string') return null;
        if (typeof t === 'function') return t.displayName || t.name || null;
        if (typeof t === 'object') return t.displayName || nameOf(t.render) || nameOf(t.type) || null;
        return null;
      };
      const NOISE = /^(Fragment|ForwardRef|Memo|Unknown|Anonymous|Slot|Provider|_c\d*)$/;
      let f: any = node[key];
      let guard = 0;
      while (f && guard++ < 40) {
        if (typeof f.type !== 'string' && f.type) {
          const n = (nameOf(f.type) || '').replace(/^.*\//, '');
          if (n && !NOISE.test(n)) return n;
        }
        f = f.return;
      }
      return null;
    };

    /**
     * A class FAMILY that no stylesheet touches is runtime-styled, not broken.
     *
     * Chakra v3 styles through CSS-in-JS: `chakra-stack`, `chakra-table__root`
     * and friends are semantic markers, and no stylesheet defines any of them.
     * Measured on one generated story, the probe emitted TEN warnings of pure
     * noise — every Chakra class on the page — which is exactly the kind of
     * false-positive stream that teaches someone to ignore the whole report.
     *
     * The discriminator is derived rather than configured: take the family
     * prefix, and if the loaded stylesheets define NOTHING in that family, the
     * family is not stylesheet-based and cannot be checked this way. A typo
     * inside a family the stylesheets DO define — `cds--btn-bordered` against
     * Carbon's 1,349 defined classes — is still caught, which is the case worth
     * catching.
     */
    const familyOf = (c: string) => c.split(/[-_]/)[0];
    const definedPerFamily = new Map<string, number>();
    for (const d of defined) {
      const f = familyOf(d);
      definedPerFamily.set(f, (definedPerFamily.get(f) ?? 0) + 1);
    }

    // First pass: collect every used-but-undefined class, grouped by family.
    const candidates = new Map<string, { count: number; sample: string; owner?: string }>();
    const undefinedPerFamily = new Map<string, number>();
    for (const el of Array.from(root.querySelectorAll('[class]')) as HTMLElement[]) {
      for (const c of Array.from(el.classList)) {
        if (defined.has(c) || looksGenerated(c) || c.length < 3) continue;
        const prior = candidates.get(c);
        if (prior) { prior.count++; continue; }
        candidates.set(c, { count: 1, sample: el.tagName.toLowerCase(), owner: ownerOf(el) || undefined });
        const f = familyOf(c);
        undefinedPerFamily.set(f, (undefinedPerFamily.get(f) ?? 0) + 1);
      }
    }

    /**
     * Second pass: drop families the stylesheets clearly do not drive.
     *
     * Presence alone was not enough — Chakra emits a handful of static
     * `chakra-*` rules, so the family looked "defined" and all ten runtime
     * markers were still reported. The RATIO separates them cleanly:
     *
     *   chakra : 10 used-undefined against 2 defined  -> runtime-styled, skip
     *   cds    :  1 used-undefined against 1,349      -> stylesheet-driven, keep
     *
     * A typo inside a suppressed family is lost, and that is correct rather than
     * regrettable: if no stylesheet drives the family, being absent from the
     * stylesheets carries no information about whether the name is right.
     */
    const seen = new Map<string, { count: number; sample: string; owner?: string }>();
    for (const [c, v] of candidates) {
      const f = familyOf(c);
      const definedCount = definedPerFamily.get(f) ?? 0;
      const undefinedCount = undefinedPerFamily.get(f) ?? 0;
      if (undefinedCount >= definedCount) continue;   // the family is not stylesheet-driven
      seen.set(c, v);
    }

    return {
      sheetsRead,
      sheetsBlocked,
      definedClasses: defined.size,
      undefined_: [...seen.entries()]
        .map(([className, v]) => ({
          className, onElements: v.count, sample: v.sample,
          owner: v.owner,
          ownedByLibrary: v.owner ? LIBRARY.has(v.owner) : false,
        }))
        .slice(0, 10),
      unreadable: false,
    } as ClassEffectResult;
  }, options);
}
