/**
 * DOM census — measures the rendered story for faked affordances.
 *
 * Every check here maps to a defect measured on real output: a "search field"
 * that was inert text, chevrons that were bare icons, nav items with no state,
 * and icons misaligned because they were bare children of a block element.
 *
 * Design constraints learned the hard way in this codebase:
 *  - Runs against the RENDERED DOM, not source. Source-level regexes cannot
 *    tell a real control from a styled div, and produce false positives that
 *    burn the shared repair budget.
 *  - Every finding carries evidence and a selector so a repair pass has
 *    something concrete to act on.
 *  - Checks that cannot be made precise are reported as warnings, never
 *    blockers, so they inform without ever costing an LLM call.
 */

export interface CensusMetrics {
  nodes: number;
  focusables: number;
  links: number;
  realInputs: number;
  buttons: number;
  inlineStyleNodes: number;
  orphanIcons: number;
  fakeFields: number;
  clickableNonButtons: number;
  iconsWithoutAccessibleName: number;
  /**
   * TOTAL invisible icons, not the number reported.
   *
   * Findings are capped at 5 to keep a repair prompt readable, which made the
   * reported list length useless for telling "fixed one of six" from "fixed
   * none" — a distinction that matters when checking whether a targeted edit
   * landed. The metric carries the true count.
   */
  invisibleIcons: number;
}

export interface CensusResult {
  metrics: CensusMetrics;
  /** Serializable descriptions of each problem, turned into Findings by the caller. */
  problems: Array<{
    kind: 'fake_field' | 'orphan_icon' | 'clickable_non_button' | 'unnamed_icon_control' | 'no_focusables' | 'static_only' | 'invisible_icon';
    message: string;
    evidence: string;
    selector?: string;
  }>;
}

/**
 * The census body runs INSIDE the page. It must be fully self-contained —
 * no imports, no closures over module scope.
 */
export async function runDomCensus(page: any): Promise<CensusResult> {
  return page.evaluate(() => {
    const root: HTMLElement =
      (document.querySelector('#storybook-root') as HTMLElement) ||
      (document.querySelector('#root') as HTMLElement) ||
      document.body;

    /**
     * Portalled content is part of the story and was invisible to every probe.
     *
     * Mantine Menu/Modal/Popover, Vuetify overlays and Shoelace dialogs render
     * into `document.body`, OUTSIDE `#storybook-root`. Measured: opening one
     * menu in a generated dashboard put a dropdown and four menu items entirely
     * beyond the census scope — so an unnamed icon button or an unreadable icon
     * inside any overlay passed verification by never being looked at. Since
     * menus and modals are where interaction defects concentrate, this was the
     * worst possible place to be blind.
     *
     * Storybook's own chrome lives in the same body, so it is excluded by name
     * rather than by guessing: anything sb-* or #storybook-* belongs to the
     * harness, not to the user's composition.
     */
    const isHarnessChrome = (el: Element): boolean => {
      const id = el.id || '';
      const cls = typeof el.className === 'string' ? el.className : '';
      return id.startsWith('storybook-') || /(^|\s)sb-/.test(cls);
    };

    const roots: HTMLElement[] = [root];
    if (root !== document.body) {
      for (const child of Array.from(document.body.children) as HTMLElement[]) {
        if (child === root) continue;
        if (isHarnessChrome(child)) continue;
        if (/^(script|style|link|template|noscript)$/i.test(child.tagName)) continue;
        if (child.children.length === 0 && !(child.textContent || '').trim()) continue;
        roots.push(child);
      }
    }

    const all = roots.flatMap(r => Array.from(r.querySelectorAll('*'))) as HTMLElement[];
    const problems: CensusResult['problems'] = [];

    const cssPath = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && depth < 4 && cur !== root) {
        let seg = cur.tagName.toLowerCase();
        const cls = (cur.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
        if (cls) seg += `.${cls}`;
        parts.unshift(seg);
        cur = cur.parentElement;
        depth++;
      }
      return parts.join(' > ');
    };

    const isVisible = (el: HTMLElement): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

    /**
     * Ancestor test for "is this already inside something interactive".
     *
     * Deliberately WIDER than FOCUSABLE. Design systems routinely render an
     * <a> without href (Mantine's NavLink does), and an anchor is still the
     * control even when it is not tab-reachable by that selector. Using the
     * strict list here flagged spans, svgs and even <path> nodes inside a
     * perfectly good link as "clickable but not keyboard reachable".
     */
    const INTERACTIVE_ANCESTOR =
      'a, button, input, select, textarea, label, summary, ' +
      '[role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], ' +
      '[role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], ' +
      '[tabindex], [contenteditable="true"]';

    /** SVG internals are never independently interactive; never evaluate them. */
    const isSvgInternal = (el: Element): boolean => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'svg') return false;
      return !!el.closest('svg');
    };

    const focusables = (roots.flatMap(r => Array.from(r.querySelectorAll(FOCUSABLE))) as HTMLElement[]).filter(isVisible);
    const links = roots.flatMap(r => Array.from(r.querySelectorAll('a[href]')));
    const realInputs = roots.flatMap(r => Array.from(r.querySelectorAll('input, textarea, select')));
    const buttons = roots.flatMap(r => Array.from(r.querySelectorAll('button, [role="button"]')));
    const inlineStyleNodes = all.filter(el => el.getAttribute('style'));

    const accessibleName = (el: HTMLElement): string => {
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const t = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
        if (t) return t;
      }
      const title = el.getAttribute('title');
      if (title && title.trim()) return title.trim();
      return (el.textContent || '').trim();
    };

    // ── 1. Faked input fields ────────────────────────────────────────────────
    // The signature of a faked field is placeholder-style prose inside a
    // box-like container that cannot receive text.
    //
    // Text alone is far too brittle a signal: the real defect rendered as
    // "Type/to search" — split across three nodes by a keyboard-hint chip — so a
    // naive /^type / pattern missed the exact case it was written for.
    // So: normalize the text, then REQUIRE structural evidence that this is
    // meant to be a field (a border/background box, or a magnifier icon).
    // Both together keep a heading like "Search results" from being flagged.
    const PLACEHOLDER_TEXT = /\b(search|jump to|filter|find|type to|enter (a|your)?\s*\w+)\b/i;

    const looksLikeFieldBox = (el: HTMLElement): boolean => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 90 || r.height < 20 || r.height > 80) return false;
      const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(side => {
        const w = parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
        const style = s.getPropertyValue(`border-${side.toLowerCase()}-style`);
        return w > 0 && style !== 'none';
      });
      const bg = s.backgroundColor;
      const hasFill = !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const rounded = (parseFloat(s.borderRadius) || 0) > 0;
      return hasBorder || hasFill || rounded;
    };

    const seenFake = new Set<HTMLElement>();
    for (const el of all) {
      if (!isVisible(el)) continue;
      // A real field anywhere inside means this is not a fake.
      if (el.querySelector('input, textarea, select, [contenteditable="true"]')) continue;
      if (el.closest('input, textarea, select, [contenteditable="true"], label')) continue;
      // Inside a real control, placeholder-ish text is just a label.
      if (el.closest('button, a[href], [role="button"], [role="combobox"], [role="searchbox"], [role="textbox"]')) continue;

      // Normalize: collapse whitespace so text split across child nodes reads as prose.
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 60) continue;
      if (!PLACEHOLDER_TEXT.test(text)) continue;

      const structural = looksLikeFieldBox(el) || !!el.querySelector('svg');
      if (!structural) continue;

      // Report the OUTERMOST offending container once, not every ancestor.
      if (Array.from(seenFake).some(prev => prev.contains(el))) continue;
      seenFake.add(el);

      problems.push({
        kind: 'fake_field',
        message: 'A search/input affordance is rendered but cannot accept text — it has no real input element',
        evidence: `"${text}" sits in a field-like container with no input/textarea/contenteditable inside`,
        selector: cssPath(el),
      });
    }

    // ── 2. Orphan icons ──────────────────────────────────────────────────────
    // An SVG that is neither decorative-inside-a-control nor inside anything
    // focusable. Bare chevrons and utility glyphs land here.
    const svgs = (roots.flatMap(r => Array.from(r.querySelectorAll('svg'))) as unknown as HTMLElement[]).filter(isVisible);
    let orphanIcons = 0;
    for (const svg of svgs) {
      // Any interactive ancestor counts, including an <a> without href.
      if (svg.closest(INTERACTIVE_ANCESTOR)) continue;
      // Icons inside a labelled non-interactive region are usually decorative.
      const looksDecorative =
        svg.getAttribute('aria-hidden') === 'true' ||
        !!svg.closest('[aria-hidden="true"]');
      if (looksDecorative) continue;
      orphanIcons++;
      if (orphanIcons <= 5) {
        problems.push({
          kind: 'orphan_icon',
          message: 'Icon is not inside any focusable control and is not marked decorative',
          evidence: 'If it is interactive it needs a button wrapper; if decorative it needs aria-hidden="true"',
          selector: cssPath(svg),
        });
      }
    }

    // ── 2b. Icons that cannot be seen ────────────────────────────────────────
    //
    // A real defect that read as correct code: a Timeline whose `active` prop
    // painted every bullet solid blue, wrapping a "light"-variant icon holder.
    // The holder's 10%-alpha background never covered the blue, and its
    // foreground colour was picked for a plain surface — so teal and indigo
    // icons sat on blue and disappeared. Nothing in the source looked wrong;
    // only the rendered composition did.
    //
    // Both sides must be composited to an opaque base first: in a token-based
    // design system almost every colour is an alpha, and comparing two
    // translucent values reports nonsense.
    const parseRgba = (value: string): [number, number, number, number] => {
      const n = (value.match(/[\d.]+/g) || []).map(Number);
      return [n[0] || 0, n[1] || 0, n[2] || 0, n.length > 3 ? n[3] : 1];
    };
    const flatten = (el: Element): [number, number, number] => {
      const layers: Array<[number, number, number, number]> = [];
      let node: Element | null = el;
      while (node) {
        const c = parseRgba(getComputedStyle(node).backgroundColor);
        if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
        node = node.parentElement;
      }
      // Storybook's canvas is white unless a decorator says otherwise.
      let base: [number, number, number] =
        layers.length && layers[layers.length - 1][3] >= 0.999
          ? (layers.pop()!.slice(0, 3) as [number, number, number])
          : [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r, g, b, a] = layers[i];
        base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
      }
      return base;
    };
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const contrast = (fg: [number, number, number], bg: [number, number, number]): number => {
      const [hi, lo] = luminance(fg) > luminance(bg)
        ? [luminance(fg), luminance(bg)]
        : [luminance(bg), luminance(fg)];
      return (hi + 0.05) / (lo + 0.05);
    };

    let invisibleIcons = 0;
    for (const svg of roots.flatMap(r => Array.from(r.querySelectorAll('svg'))) as unknown as Element[]) {
      const rect = (svg as HTMLElement).getBoundingClientRect();
      if (rect.width < 6 || rect.height < 6) continue;

      const style = getComputedStyle(svg as Element);
      // Icon libraries draw with either stroke or fill; currentColor resolves
      // to the computed colour, so that is the reliable read.
      const paint = [style.stroke, style.fill, style.color]
        .find(v => v && v !== 'none' && !v.startsWith('url(')) || style.color;
      const fgRaw = parseRgba(paint);
      // An icon that is transparent or hidden is a different problem.
      if (fgRaw[3] === 0) continue;

      const bg = flatten((svg as Element).parentElement || (svg as Element));
      const fg = fgRaw[3] >= 0.999
        ? (fgRaw.slice(0, 3) as [number, number, number])
        : ([0, 1, 2].map(i => fgRaw[i] * fgRaw[3] + bg[i] * (1 - fgRaw[3])) as [number, number, number]);

      // 1.5:1 rather than a WCAG threshold on purpose. This reports icons that
      // are effectively INVISIBLE, not ones that are merely low contrast —
      // plenty of legitimate decorative icons sit below 3:1, and flagging those
      // would spend repair attempts on taste.
      const ratio = contrast(fg, bg);
      if (ratio >= 1.5) continue;

      invisibleIcons++;
      if (invisibleIcons <= 5) {
        problems.push({
          kind: 'invisible_icon',
          message: 'Icon is not visible against the background it sits on',
          evidence: `contrast ${ratio.toFixed(2)}:1 — icon rgb(${fg.map(Math.round).join(',')}) on rgb(${bg.map(Math.round).join(',')}). A filled parent (timeline bullet, selected tab, status chip) usually means the icon needs an explicit contrasting colour rather than a light/subtle variant.`,
          selector: cssPath(svg as Element),
        });
      }
    }

    // ── 3. Clickable non-buttons ─────────────────────────────────────────────
    // A div/span carrying a click affordance. Not keyboard reachable.
    let clickableNonButtons = 0;
    for (const el of all) {
      if (!isVisible(el)) continue;
      // <path>, <g>, <circle> etc. are painting instructions, not controls.
      if (isSvgInternal(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea') continue;
      if (el.getAttribute('role') === 'button' && el.hasAttribute('tabindex')) continue;
      const cursorPointer = getComputedStyle(el).cursor === 'pointer';
      const hasRole = el.getAttribute('role') === 'button';
      const focusable = el.matches(FOCUSABLE);
      if ((hasRole || cursorPointer) && !focusable) {
        // cursor:pointer is inherited, so a child of a real control looks
        // clickable without being a defect. Test the wider ancestor set.
        if (el.closest(INTERACTIVE_ANCESTOR)) continue;
        clickableNonButtons++;
        if (clickableNonButtons <= 5) {
          problems.push({
            kind: 'clickable_non_button',
            message: 'Element looks clickable but cannot be reached or activated by keyboard',
            evidence: hasRole ? 'has role="button" without a tabindex' : 'has cursor:pointer but is not focusable',
            selector: cssPath(el),
          });
        }
      }
    }

    // ── 4. Icon-only controls with no accessible name ────────────────────────
    let iconsWithoutAccessibleName = 0;
    for (const el of buttons as HTMLElement[]) {
      if (!isVisible(el)) continue;
      const hasOnlyIcon = !!el.querySelector('svg') && !(el.textContent || '').trim();
      if (!hasOnlyIcon) continue;
      if (!accessibleName(el)) {
        iconsWithoutAccessibleName++;
        if (iconsWithoutAccessibleName <= 5) {
          problems.push({
            kind: 'unnamed_icon_control',
            message: 'Icon-only control has no accessible name',
            evidence: 'no aria-label, aria-labelledby, title, or text content',
            selector: cssPath(el),
          });
        }
      }
    }

    // ── 5. Nothing interactive at all ────────────────────────────────────────
    // "Zero focusables" is only a defect if the story was TRYING to be
    // interactive. Plenty of legitimate components — a testimonial card, an
    // avatar, a stat tile, a team grid — are correctly static, and calibration
    // against real output showed this check flagging exactly those. Blocking
    // them would spend repair attempts damaging correct code.
    //
    // So require corroborating evidence of intended interactivity, and report
    // the ambiguous case as a warning instead.
    if (focusables.length === 0 && all.length > 12) {
      const ACTION_WORDS =
        /\b(search|submit|save|cancel|next|previous|continue|sign in|log in|sign up|menu|settings|filter|sort|edit|delete|add|create|upload|download|more|view all|see all)\b/i;

      const impliesInteractive =
        problems.some(p => p.kind === 'fake_field' || p.kind === 'clickable_non_button') ||
        // Action-word text sitting in a button-like box with nothing behind it.
        all.some(el => {
          if (!isVisible(el) || el.children.length > 1) return false;
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!t || t.length > 30 || !ACTION_WORDS.test(t)) return false;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const boxy =
            (parseFloat(s.borderRadius) || 0) > 0 ||
            (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)');
          return boxy && r.height >= 20 && r.height <= 64;
        });

      problems.push({
        kind: impliesInteractive ? 'no_focusables' : 'static_only',
        message: impliesInteractive
          ? 'The story presents interactive affordances but nothing can be focused or operated'
          : 'Nothing in this story is focusable — correct for a purely presentational component, worth confirming otherwise',
        evidence: `${all.length} elements rendered, 0 focusable`,
      });
    }

    return {
      metrics: {
        nodes: all.length,
        focusables: focusables.length,
        links: links.length,
        realInputs: realInputs.length,
        buttons: buttons.length,
        inlineStyleNodes: inlineStyleNodes.length,
        orphanIcons,
        invisibleIcons,
        fakeFields: problems.filter(p => p.kind === 'fake_field').length,
        clickableNonButtons,
        iconsWithoutAccessibleName,
      },
      problems,
    } as CensusResult;
  });
}
