/**
 * Layout probe — the parts of "does this look right" that are arithmetic.
 *
 * Reported from manual testing: generated compositions had ragged left edges
 * and did not sit on the grid. That reads as an aesthetic complaint, and it is
 * not one. `lg={5}` beside `lg={6}` in a sixteen-column grid is a sum that
 * does not reach sixteen, and two headings a few pixels apart is a measurement.
 * Both are checkable exactly, for free, with no model and no judgement.
 *
 * WHY THIS IS DESIGN-SYSTEM AGNOSTIC. Nothing here knows that Carbon's grid is
 * 16 columns, or MUI's is 12. The RENDERED CSS states its own track count in
 * `grid-template-columns`, and each child states its own span in
 * `grid-column`. Reading the layout the browser actually computed works for
 * Carbon, MUI, Tailwind, plain CSS grid and a design system invented last
 * week — the same reason component identity is taken from React's fiber
 * rather than from class names.
 *
 * Everything here is deliberately conservative. A verification system that
 * fails correct work is worse than none, and this file has more opportunity to
 * produce confident nonsense than any other probe: real designs have
 * deliberate asymmetry, intentional indentation and optical alignment. Every
 * check below requires the evidence to be unambiguous before it will speak.
 */

export interface LayoutMetrics {
  /** Grid containers examined. */
  grids: number;
  /** Grid rows that leave declared columns unused. */
  underfilledRows: number;
  /** Sibling groups whose left edges disagree by a sub-pixel-to-small margin. */
  raggedGroups: number;
  /** Grid rows whose spans stop one or two tracks short of the right edge. */
  raggedRows: number;
  /** Content-hugging controls a flex/grid parent stretched wide. */
  stretchedControls: number;
  /** Sibling pairs separated by far more than their parent's declared gap. */
  gapOutliers: number;
  /** Hug-content candidates whose content could not be measured (absent ≠ zero). */
  unmeasurableControls: number;
}

export type LayoutProblemKind =
  | 'row_misaligned'
  | 'row_height_mismatch'
  | 'label_misaligned'
  | 'grid_underfilled'
  | 'ragged_edges'
  | 'grid_ragged'
  | 'stretched_control'
  | 'gap_outlier';

export interface LayoutProblem {
  kind: LayoutProblemKind;
  message: string;
  evidence: string;
  selector?: string;
  owner?: string;
  ownedByLibrary?: boolean;
}

export interface LayoutResult {
  metrics: LayoutMetrics;
  problems: LayoutProblem[];
}

export interface LayoutOptions {
  /** Design system component names, so a defect can be attributed. */
  libraryComponents?: string[];
}

export async function runLayoutProbe(page: any, options: LayoutOptions = {}): Promise<LayoutResult> {
  return page.evaluate((opts: LayoutOptions) => {
    const LIBRARY = new Set(opts?.libraryComponents || []);

    const root: HTMLElement =
      (document.querySelector('#storybook-root') as HTMLElement) ||
      (document.querySelector('#root') as HTMLElement) ||
      document.body;

    /** The component React says rendered this node. Same rule as the census. */
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

    const attribute = (el: any) => {
      const owner = ownerOf(el);
      return owner ? { owner, ownedByLibrary: LIBRARY.has(owner) } : {};
    };

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

    const problems: LayoutResult['problems'] = [];
    let grids = 0;
    let underfilledRows = 0;
    let raggedGroups = 0;
    let raggedRows = 0;
    let stretchedControls = 0;
    let gapOutliers = 0;
    let unmeasurableControls = 0;

    const px = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };

    /**
     * Who WROTE the JSX that put this element here — distinct from `ownerOf`,
     * which names the component that rendered the node.
     *
     * The two disagree on exactly the defects below. A Tag stretched by the
     * Stack it sits in is markup the library rendered, so `ownerOf` says
     * "Tag, a design system component" and the finding would never block —
     * on Mantine, Chakra, MUI, every one of them, because every badge is the
     * library's markup. But the PLACEMENT is the story's: it wrote
     * `<Stack><Tag/></Stack>`. Fiber's `_debugOwner` (which React 19 kept)
     * names the component whose render created the element, so walking out
     * through the element's own implementation layers (Button → ButtonBase →
     * button) to the outermost composite that IS this element, then asking
     * who owns that, answers "story" for a Tag the story placed and "Tile"
     * for a Tag the library's Tile rendered internally.
     *
     * Unknown (no fiber, no owner) returns {} and blocks, as the census does:
     * suppressing what cannot be explained is worse than a false blocker.
     */
    const authorOf = (node: any): { owner?: string; ownedByLibrary?: boolean } => {
      const key = Object.keys(node).find((k: string) =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!key) return {};
      const nameOf = (t: any): string | null => {
        if (!t) return null;
        if (typeof t === 'string') return null;
        if (typeof t === 'function') return t.displayName || t.name || null;
        if (typeof t === 'object') return t.displayName || nameOf(t.render) || nameOf(t.type) || null;
        return null;
      };
      const NOISE = /^(Fragment|ForwardRef|Memo|Unknown|Anonymous|Slot|Provider|_c\d*)$/;
      const cleanName = (f: any): string | null => {
        if (!f || typeof f.type === 'string' || !f.type) return null;
        const n = (nameOf(f.type) || '').replace(/^.*\//, '');
        return n && !NOISE.test(n) ? n : null;
      };
      const firstNamedOwner = (f: any): string | null => {
        let o = f?._debugOwner;
        let guard = 0;
        while (o && guard++ < 40) {
          const n = cleanName(o);
          if (n) return n;
          o = o._debugOwner;
        }
        return null;
      };
      let f: any = node[key];
      let last: any = f;
      let guard = 0;
      while (f?.return && guard++ < 40) {
        const p = f.return;
        // Reached the parent DOM node: every composite passed is a layer of
        // THIS element, and the outermost one's owner wrote it.
        if (typeof p.type === 'string' || !p.type) break;
        const n = cleanName(p);
        if (n && !LIBRARY.has(n)) {
          // A component the story defined (or Storybook's wrapper) produced
          // this element directly — unless it is a library internal such as
          // ButtonBase, which the catalog does not list but a library
          // component owns. Keep walking through those.
          const o = firstNamedOwner(p);
          if (!o || !LIBRARY.has(o)) return { owner: n, ownedByLibrary: false };
        }
        last = p;
        f = p;
      }
      const o = firstNamedOwner(last);
      return o ? { owner: o, ownedByLibrary: LIBRARY.has(o) } : {};
    };

    /**
     * A container the LIBRARY composed lays out its own children by design:
     * a vertical tab list stretches its tabs, a notification nudges its icon
     * down to the first text line. Measured: four "stretched" tabs and one
     * "misaligned" icon on stories a designer passed. Nothing in the story
     * put those children there, so there is nothing to report — this is not
     * an unexplained finding demoted to a warning, it is an explained one.
     */
    const laidOutByLibrary = (container: HTMLElement): boolean => authorOf(container).ownedByLibrary === true;

    /** The React props on the element and each composite layer that is this element. */
    const propsOf = (node: any): any[] => {
      const key = Object.keys(node).find((k: string) => k.startsWith('__reactFiber$'));
      if (!key) return [];
      const out: any[] = [];
      let f: any = node[key];
      let guard = 0;
      while (f && guard++ < 12) {
        if (f.memoizedProps && typeof f.memoizedProps === 'object') out.push(f.memoizedProps);
        const p = f.return;
        if (!p || typeof p.type === 'string' || !p.type) break;
        f = p;
      }
      return out;
    };

    /**
     * Did the source size this element on purpose? Read from the props the
     * story (or a library layer) actually passed — not guessed from the
     * computed width, which is the same number whether stretch or `width:
     * 100%` produced it.
     */
    const explicitlySized = (el: HTMLElement): boolean => {
      if (el.style.width || el.style.inlineSize || el.style.minWidth || el.style.flex || el.style.flexGrow) return true;
      for (const p of propsOf(el)) {
        for (const k of ['fullWidth', 'isFullWidth', 'full', 'block', 'fluid', 'w', 'width', 'inlineSize', 'stretch', 'grow', 'flex', 'expand', 'shouldFitContainer']) {
          if (p[k] !== undefined && p[k] !== false && p[k] !== null && p[k] !== 'auto') return true;
        }
        const st = p.style;
        if (st && typeof st === 'object' && (st.width !== undefined || st.inlineSize !== undefined || st.minWidth !== undefined || st.flex !== undefined || st.flexGrow !== undefined)) return true;
        // A width utility class is a value the story wrote, read only to
        // SUPPRESS a finding — a missed defect costs less than a false one.
        const cls = typeof p.className === 'string' ? p.className : typeof p.class === 'string' ? p.class : '';
        if (/(^|\s)(w-full|w-100|full-width|fullwidth|w-screen|flex-1|grow)(\s|$)/.test(cls)) return true;
      }
      return false;
    };

    /**
     * The box the element's own content occupies, without touching the DOM.
     *
     * A Range over each text node gives the glyph box the browser already
     * laid out; icon-ish leaves (svg, img) add their border boxes. Nothing
     * is mutated, so no ResizeObserver in the library fires and the page the
     * later probes see is byte-identical.
     *
     * Returns null when there is nothing honest to measure: no text, or text
     * that wraps (a wrapped label is not a pill), or an image-only control.
     */
    const contentBox = (el: HTMLElement): { width: number; lines: number; text: string } | null => {
      let left = Infinity, right = -Infinity;
      const tops: number[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      let text = '';
      while ((n = walker.nextNode())) {
        if (!n.textContent || !n.textContent.trim()) continue;
        const parent = n.parentElement;
        if (!parent || parent.closest('svg')) continue;
        const ps = getComputedStyle(parent);
        if (ps.display === 'none' || ps.visibility === 'hidden') continue;
        // Visually-hidden text (sr-only) is clipped to a pixel; it says
        // nothing about the visible box.
        if (ps.position === 'absolute' && (ps.clip !== 'auto' || px(ps.width) <= 1)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of Array.from(range.getClientRects())) {
          if (b.width === 0) continue;
          left = Math.min(left, b.left);
          right = Math.max(right, b.right);
          if (!tops.some(t => Math.abs(t - b.top) <= 2)) tops.push(b.top);
        }
        text += n.textContent.trim() + ' ';
      }
      if (right <= left) return null;
      let icons = 0;
      for (const leaf of Array.from(el.querySelectorAll('svg, img')) as HTMLElement[]) {
        if (leaf.parentElement?.closest('svg')) continue;
        const r = leaf.getBoundingClientRect();
        if (r.width > 0 && isVisible(leaf)) icons += r.width;
      }
      return { width: right - left + icons, lines: tops.length, text: text.trim() };
    };

    /**
     * A "hug-content control": something whose width should follow its
     * label. Interactive (button, link, role=button) or a decorated pill (a
     * background or border makes the stretched box VISIBLE — undecorated
     * text stretched full-width is simply a paragraph). Short, single-line,
     * few descendants, no form control inside: a card with a background and
     * three lines of copy is not a pill however it is styled.
     */
    const isHugControl = (el: HTMLElement): boolean => {
      const tag = el.tagName;
      if (/^(INPUT|SELECT|TEXTAREA|IMG|SVG|VIDEO|CANVAS|TABLE|UL|OL|LI|P|H[1-6]|FORM|FIELDSET)$/.test(tag)) return false;
      if (el.querySelector('input, select, textarea, table, h1, h2, h3, h4, h5, h6, p, ul, ol')) return false;
      const role = el.getAttribute('role') || '';
      // A plain text link is interactive but has no box: stretched, its hit
      // area is wide and nothing shows. Measured on a login form's "Forgot
      // your password?" at 512px — the reviewer passed it, and rightly, since
      // the screenshot cannot tell. Buttons and decorated pills are the
      // visible case.
      const interactive = tag === 'BUTTON' || /^(button|tab|menuitem)$/.test(role);
      const s = getComputedStyle(el);
      const decorated =
        (s.backgroundColor && !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(s.backgroundColor)) ||
        px(s.borderLeftWidth) > 0 || px(s.borderRightWidth) > 0 || s.backgroundImage !== 'none';
      if (!interactive && !decorated) return false;
      const r = el.getBoundingClientRect();
      // Two text lines of a large type scale; a pill or button is one.
      if (r.height > 64) return false;
      const descendants = (Array.from(el.querySelectorAll('*')) as Element[]).filter(d => !d.parentElement?.closest('svg'));
      if (descendants.length > 4) return false;
      /**
       * An element containing a control is a CONTAINER, not a control.
       *
       * `decorated` above admits anything with a background colour, and a
       * sticky action bar has one by necessity — without it the page scrolls
       * under the bar. With two buttons inside, its text reads
       * "CancelSave changes", 18 characters, and its height is a bar's height,
       * so it passed every test here and was reported as a content-hugging tag
       * rendered 904px wide. It is full width BY DESIGN.
       *
       * That false positive was the single most expensive finding in the
       * suite: the only story shipping with an issue, the only one burning all
       * three gate attempts, and the whole p90 tail — on Carbon, Sail Shelf and
       * Material alike. Four prompt rules were written against it and none
       * could work, because the composition was correct every time. The last
       * one carried BOTH remedies the tool had asked for, `justifySelf: start`
       * and `alignItems: center`, and was still reported.
       *
       * A tag, pill or badge contains text and perhaps an icon. It never
       * contains a button.
       */
      if (el.querySelector('button, a[href], [role="button"], [role="tab"], [role="menuitem"], input, select, textarea')) {
        return false;
      }
      const t = (el.textContent || '').trim();
      return t.length > 0 && t.length <= 40;
    };

    /** The control, or a wrapper that holds exactly one control and nothing else. */
    const controlOf = (el: HTMLElement): HTMLElement | null => {
      if (isHugControl(el)) return el;
      const kids = (Array.from(el.children) as HTMLElement[]).filter(isVisible);
      if (kids.length === 1) {
        const inner = controlOf(kids[0]);
        if (inner) return inner;
      }
      return null;
    };

    const label = (el: HTMLElement): string => {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      return t ? `"${t.slice(0, 32)}${t.length > 32 ? '…' : ''}"` : `<${el.tagName.toLowerCase()}>`;
    };

    /** Track sizes as the browser resolved them; empty when not all in px. */
    const trackList = (s: CSSStyleDeclaration): number[] => {
      const raw = s.gridTemplateColumns.trim();
      if (!raw || raw === 'none') return [];
      const parts = raw.split(/\s+/).filter(Boolean);
      const nums = parts.map(px);
      return parts.every(p => /px$/.test(p)) ? nums : [];
    };

    /* ── 1. Grid rows that do not use the columns they declare ───────────── */

    for (const el of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
      const style = getComputedStyle(el);
      if (style.display !== 'grid' && style.display !== 'inline-grid') continue;
      if (!isVisible(el)) continue;

      // The computed value is a resolved track list — "160px 160px 160px" —
      // so the count of tracks is the column count, whatever the library.
      const tracks = style.gridTemplateColumns.trim();
      if (!tracks || tracks === 'none') continue;
      const columnCount = tracks.split(/\s+/).filter(Boolean).length;
      // Below three columns, "unused space" is normal layout, not a defect.
      if (columnCount < 3) continue;
      grids++;

      const children = (Array.from(el.children) as HTMLElement[]).filter(isVisible);
      if (children.length === 0) continue;

      /**
       * Group children into visual ROWS by their top edge before judging.
       *
       * Summing every child's span across a multi-row grid would call a full
       * 3x3 layout underfilled whenever the last row is partial — which is
       * both extremely common and entirely correct.
       */
      const rows = new Map<number, HTMLElement[]>();
      for (const child of children) {
        const top = Math.round(child.getBoundingClientRect().top);
        // Tolerate a pixel of rounding between items on the same visual row.
        const key = [...rows.keys()].find(k => Math.abs(k - top) <= 2);
        if (key === undefined) rows.set(top, [child]);
        else rows.get(key)!.push(child);
      }

      const rowList = [...rows.values()];
      for (let i = 0; i < rowList.length; i++) {
        const row = rowList[i];
        // The LAST row of a multi-row grid is legitimately partial — three
        // cards wrapping out of seven is correct, not a defect.
        if (rowList.length > 1 && i === rowList.length - 1) continue;

        let used = 0;
        let measurable = true;
        const spans: number[] = [];
        for (const child of row) {
          const cs = getComputedStyle(child);
          // `grid-column: span 5 / span 5` or resolved `2 / 7`.
          const raw = `${cs.gridColumnStart} / ${cs.gridColumnEnd}`;
          const spanMatch = raw.match(/span\s+(\d+)/);
          if (spanMatch) { const n = Number(spanMatch[1]); used += n; spans.push(n); continue; }
          const nums = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
          if (nums) { const n = Number(nums[2]) - Number(nums[1]); used += n; spans.push(n); continue; }
          // `auto` and named lines cannot be counted honestly. One unknown
          // child makes the whole row unmeasurable rather than under-counted.
          measurable = false;
          break;
        }
        if (!measurable || used === 0) continue;
        /**
         * One child on the row is a content column, not a shortfall. Carbon
         * sets a 12-of-16 reading column on purpose and the model's repair
         * "did not improve" it three times; a row of several children that
         * leaves a gap beside them is the defect this probe exists for.
         */
        if (spans.length === 1) continue;

        /**
         * Only a SUBSTANTIAL shortfall, and only when the row is trying to
         * span the grid. A row using 15 of 16 is a designed inset; a row using
         * 11 of 16 with nothing beside it is the defect that was reported.
         */
        const unused = columnCount - used;
        if (used < columnCount && unused >= Math.max(2, Math.ceil(columnCount * 0.2))) {
          underfilledRows++;
          if (problems.length < 6) {
            problems.push({
              kind: 'grid_underfilled',
              /**
               * State the CHANGE, not just the fault.
               *
               * Measured: with a message that only described the defect,
               * repair failed to reduce blockers on every attempt — the model
               * was told a row used 12 of 16 columns and left to work out
               * which prop that corresponds to. The same lesson as the import
               * error that made it delete components rather than fix paths.
               *
               * The spans ARE the props, so naming them turns the finding into
               * an instruction.
               */
              message:
                `A grid row uses ${used} of ${columnCount} columns, leaving ${unused} empty. ` +
                `Column spans in this row: ${spans.join(' + ')}. ` +
                `Increase them so they total ${columnCount} (for example ${spans.length === 1
                  ? `change the single span to ${columnCount}`
                  : `${spans.slice(0, -1).join(' + ')} + ${columnCount - spans.slice(0, -1).reduce((a, b) => a + b, 0)}`}), ` +
                `or add a sibling column to fill the remainder.`,
              evidence: `${row.length} item(s) spanning ${spans.join('+')} = ${used} of ${columnCount} tracks; ${unused} columns render as dead space`,
              selector: cssPath(el),
              /**
               * Deliberately NOT attributed to the library.
               *
               * Fiber names the grid container's owner — Carbon's Grid or
               * GridSettings — which would demote this to a warning the model
               * is told not to fix. But the container is not the defect: the
               * SPANS are, and they come from props the story wrote
               * (`<Column lg={5}>`). Attributing by who rendered the wrapper
               * would suppress precisely the defect that was reported.
               */
            });
          }
        }
      }
    }

    /* ── 2. Sibling blocks whose left edges nearly, but not quite, agree ─── */

    /**
     * Ragged means SMALL disagreement. A child deliberately indented sits tens
     * of pixels in and is a design decision; edges 1-6px apart are an accident
     * nobody chose, and that is what reads as sloppy.
     */
    for (const el of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
      const style = getComputedStyle(el);
      // Stacked flow only. A row of flex/grid items is not expected to align
      // on the left; that is the entire point of a row.
      if (style.display === 'grid' || style.display === 'inline-grid') continue;
      if (style.display === 'flex' && !/column/.test(style.flexDirection)) continue;

      const children = (Array.from(el.children) as HTMLElement[])
        .filter(isVisible)
        .filter(c => {
          const cs = getComputedStyle(c);
          // Only full-flow blocks. Inline and floated content aligns by text.
          if (cs.position === 'absolute' || cs.position === 'fixed') return false;
          return cs.display !== 'inline' && cs.float === 'none';
        });
      if (children.length < 3) continue;

      const lefts = children.map(c => c.getBoundingClientRect().left);
      const min = Math.min(...lefts);
      const max = Math.max(...lefts);
      const spread = max - min;

      // 0.5px filters sub-pixel rounding; 6px is the ceiling above which an
      // offset is more plausibly intentional than accidental.
      if (spread > 0.5 && spread <= 6) {
        raggedGroups++;
        if (problems.length < 10) {
          const offenders = children.filter(c => c.getBoundingClientRect().left - min > 0.5);
          problems.push({
            kind: 'ragged_edges',
            message: `${children.length} stacked elements do not share a left edge`,
            evidence: `left edges span ${spread.toFixed(1)}px (${offenders.length} of ${children.length} out of line) — too small to be intentional indentation`,
            selector: cssPath(el),
            ...attribute(el),
          });
        }
      }
    }

    /* ── 3. Rows whose spans stop one or two tracks short of the edge ──── */

    /**
     * Check 1 deliberately ignores a small shortfall: 15 of 16 is a designed
     * inset when it is one reading column. It is not when it is THREE equal
     * cards — `lg={5}` ×3 — whose row ends a column short of the header
     * above it. Measured on three of twenty-two Carbon stories: tiers and
     * product cards ending 95px and 25px before the row above, every one a
     * sum the story wrote that did not reach the track count.
     *
     * Ragged means: several children, spans all readable, laid contiguously
     * from the first track, no explicit line placement anywhere on the row
     * (an offset is a decision), and the total short by 1 or 2 tracks —
     * larger shortfalls are check 1's. The last row of a multi-row grid is
     * skipped for the reason check 1 skips it.
     */
    for (const el of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
      const style = getComputedStyle(el);
      if (style.display !== 'grid' && style.display !== 'inline-grid') continue;
      if (!isVisible(el)) continue;
      const tracks = trackList(style);
      const columnCount = tracks.length || style.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
      if (columnCount < 3 || style.gridTemplateColumns.trim() === 'none') continue;
      const children = (Array.from(el.children) as HTMLElement[]).filter(isVisible);
      if (children.length < 2) continue;

      const rows = new Map<number, HTMLElement[]>();
      for (const child of children) {
        const top = Math.round(child.getBoundingClientRect().top);
        const key = [...rows.keys()].find(k => Math.abs(k - top) <= 2);
        if (key === undefined) rows.set(top, [child]);
        else rows.get(key)!.push(child);
      }
      const rowList = [...rows.values()];
      const contentLeft = el.getBoundingClientRect().left + px(style.paddingLeft) + px(style.borderLeftWidth);

      for (let i = 0; i < rowList.length; i++) {
        const row = rowList[i].slice().sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        if (rowList.length > 1 && i === rowList.length - 1) continue;
        if (row.length < 2) continue;

        let used = 0;
        let measurable = true;
        let explicit = false;
        const spans: number[] = [];
        for (const child of row) {
          const cs = getComputedStyle(child);
          const raw = `${cs.gridColumnStart} / ${cs.gridColumnEnd}`;
          const spanMatch = raw.match(/span\s+(\d+)/);
          if (spanMatch) { const n = Number(spanMatch[1]); used += n; spans.push(n); continue; }
          const nums = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
          if (nums) {
            // Explicit lines. Placement someone chose; not this check's business.
            explicit = true;
            break;
          }
          measurable = false;
          break;
        }
        if (!measurable || explicit || used === 0) continue;

        // Contiguous from the first track: the first child sits on the grid's
        // left content edge (within the first track), or the gap is a choice.
        const firstLeft = row[0].getBoundingClientRect().left;
        const firstTrack = tracks[0] || 0;
        if (firstTrack && firstLeft - contentLeft > firstTrack) continue;

        const unused = columnCount - used;
        if (unused < 1 || unused > 2) continue;
        // Check 1 owns anything at or above its own threshold.
        if (unused >= Math.max(2, Math.ceil(columnCount * 0.2))) continue;

        raggedRows++;
        if (problems.length < 12) {
          const lastRect = row[row.length - 1].getBoundingClientRect();
          const gridRight = el.getBoundingClientRect().right - px(style.paddingRight) - px(style.borderRightWidth);
          const shortfallPx = Math.round(gridRight - lastRect.right);
          const proposal = `${spans.slice(0, -1).join(' + ')} + ${spans[spans.length - 1] + unused}`;
          problems.push({
            kind: 'grid_ragged',
            message:
              `A grid row uses ${used} of ${columnCount} columns (spans ${spans.join(' + ')}), so it ends ${unused} column${unused === 1 ? '' : 's'} short of the grid's right edge and reads as ragged against the rows above and below. ` +
              `Make the spans total ${columnCount} — for example ${proposal} — or give the last column an explicit offset if the inset is intended.`,
            evidence: `${row.length} items spanning ${spans.join('+')} = ${used} of ${columnCount} tracks; the row's right edge is ${shortfallPx}px inside the grid's`,
            selector: cssPath(el),
            ...authorOf(el),
          });
        }
      }
    }

    /* ── 4. Content-hugging controls stretched by their parent ──────────── */

    /**
     * A Tag reading "New" rendered 208px wide — its max-inline-size — because
     * the vertical Stack around it is a grid and a grid stretches its items.
     * Six stories out of twenty-two, always a pill or button dropped straight
     * into a stacking container, always the library's own default. Measured,
     * not judged: the glyph box is 25px, the border box is 208px.
     *
     * Thresholds. The border box must be at least 1.3× the content box AND
     * at least 48px wider: the factor keeps a generous but normal padding out
     * of it (a 12-char tag at 1.46× was called stretched by a designer and
     * is), the absolute floor keeps a 20px surplus on a short word out of it
     * — three spacing steps of dead pill is what a screenshot shows and
     * anything less is not visible. And the MECHANISM must be present: the
     * width must equal what stretching hands out — the element's own
     * max-width, or the parent's content width, or one of the parent's
     * tracks — under a parent that stretches (grid; or column flex with
     * align-items stretch/normal) with the element not opting out
     * (justify-self/align-self, flex-grow, explicit width props).
     */
    for (const el of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
      if (!isVisible(el) || !isHugControl(el)) continue;
      const parent = el.parentElement;
      if (!parent || parent === root) continue;
      const ps = getComputedStyle(parent);
      const cs = getComputedStyle(el);

      const isGrid = ps.display === 'grid' || ps.display === 'inline-grid';
      const isColumnFlex = (ps.display === 'flex' || ps.display === 'inline-flex') && /column/.test(ps.flexDirection);
      if (!isGrid && !isColumnFlex) continue;
      if (laidOutByLibrary(parent)) continue;
      const parentStretches = isGrid
        ? /^(normal|stretch)$/.test(ps.justifyItems)
        : /^(normal|stretch)$/.test(ps.alignItems);
      if (!parentStretches) continue;
      const selfOptsOut = isGrid
        ? !/^(auto|normal|stretch)$/.test(cs.justifySelf)
        : !/^(auto|normal|stretch)$/.test(cs.alignSelf);
      if (selfOptsOut) continue;
      if (cs.position === 'absolute' || cs.position === 'fixed') continue;

      const box = contentBox(el);
      if (!box) { unmeasurableControls++; continue; }
      if (box.lines !== 1) continue;
      const rect = el.getBoundingClientRect();
      const hug = box.width
        + px(cs.paddingLeft) + px(cs.paddingRight)
        + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
      if (!(rect.width >= hug * 1.3 && rect.width - hug >= 48)) continue;

      const parentRect = parent.getBoundingClientRect();
      const available = parentRect.width - px(ps.paddingLeft) - px(ps.paddingRight) - px(ps.borderLeftWidth) - px(ps.borderRightWidth);
      // max-width is a content-box measure under box-sizing: content-box;
      // the bounding rect is always the border box. Compare like with like.
      const edges = px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
      const maxW = /px$/.test(cs.maxWidth) ? px(cs.maxWidth) + (cs.boxSizing === 'content-box' ? edges : 0) : NaN;
      const tracks = isGrid ? trackList(ps) : [];
      const explainedBy =
        Math.abs(rect.width - maxW) <= 1 ? `its max-width (${Math.round(maxW)}px)` :
        Math.abs(rect.width - available) <= 1 ? `the parent's full content width (${Math.round(available)}px)` :
        tracks.some(t => Math.abs(rect.width - t) <= 1) ? `a ${Math.round(rect.width)}px grid track` :
        null;
      if (!explainedBy) continue;
      if (explicitlySized(el)) continue;

      stretchedControls++;
      if (problems.length < 12) {
        const containerDesc = isGrid ? `${ps.display} (justify-items: ${ps.justifyItems})` : `column flex (align-items: ${ps.alignItems})`;
        problems.push({
          kind: 'stretched_control',
          message:
            `${label(el)} is a content-hugging ${el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? 'button' : 'tag'} rendered ${Math.round(rect.width)}px wide for ${Math.round(hug)}px of content, because its parent (a ${containerDesc}) stretches its children to ${explainedBy}. ` +
            `Stop it stretching: wrap it in a plain <div> (or a <span> for inline placement) so it is no longer a direct grid/flex item, or set the parent's ${isGrid ? 'justify-items' : 'align-items'} to start, or set ${isGrid ? 'justify-self' : 'align-self'}: start on the element.`,
          evidence: `content box ${Math.round(box.width)}px + padding ${Math.round(hug - box.width)}px = ${Math.round(hug)}px natural; rendered ${Math.round(rect.width)}px (${(rect.width / hug).toFixed(1)}×, ${Math.round(rect.width - hug)}px of empty pill); parent ${containerDesc}`,
          selector: cssPath(el),
          ...authorOf(el),
        });
      }
    }

    /* ── 5. Siblings far further apart than the gap their parent declares ── */

    /**
     * Two mechanisms, both measured as bounding-box distance against the
     * parent's computed column-gap; anything else is the parent's own
     * arithmetic and is not a finding.
     *
     * (a) A horizontal grid whose auto tracks were stretched to fill the
     *     container, with each control at the START of its own track:
     *     "Invite teammate" sits 598px from "Create report" under a declared
     *     12px gap, at an x nobody chose. Five stories. The tell is that the
     *     void lies INSIDE a track (the control is ≥48px narrower than its
     *     track), which no one designs; a track someone sized is filled.
     *
     * (b) A flex row using space-around/space-evenly, or space-between with
     *     three or more items, where every item is a small control. Two
     *     controls pushed to opposite edges by space-between are an
     *     anchored pair (Back … Next) and deliberately NOT reported; the
     *     middle items of three, or all items under space-around, float at
     *     positions the container computed rather than the author.
     *
     * Threshold for both: the void between neighbours must exceed the
     * declared gap by at least 48px and be at least three times it — a 12px
     * gap rendered as 24px is a rounding argument, rendered as 60px+ is a
     * hole. Every child must be a hug-content control (or a wrapper of
     * one): a title beside a button, or two text columns, is a layout, not
     * a toolbar.
     *
     * (c) One sibling in a row carrying a one-sided margin the others lack,
     *     so its content starts lower than its neighbour's: "First name" at
     *     y=317 beside "Last name" at y=333, because one of the pair was
     *     wrapped in `marginTop: 1rem`. Reported when the tops disagree by
     *     ≥4px and every offset is exactly explained by a margin-top on the
     *     cell or on its first child — anything not explained by a margin is
     *     alignment the parent chose (center, baseline) and is left alone.
     */
    for (const el of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
      const style = getComputedStyle(el);
      if (!isVisible(el)) continue;
      const isGrid = style.display === 'grid' || style.display === 'inline-grid';
      const isRowFlex = (style.display === 'flex' || style.display === 'inline-flex') && !/column/.test(style.flexDirection);
      if (!isGrid && !isRowFlex) continue;

      const children = (Array.from(el.children) as HTMLElement[]).filter(isVisible).filter(c => {
        const cs = getComputedStyle(c);
        return cs.position !== 'absolute' && cs.position !== 'fixed';
      });
      if (children.length < 2 || children.length > 4) continue;
      const rects = children.map(c => c.getBoundingClientRect());
      // One visual row, left to right. Wrapped or stacked children are rows,
      // and rows are check 2's problem.
      const ordered = rects.every((r, i) => i === 0 || r.left >= rects[i - 1].right - 1);
      if (!ordered) continue;
      if (laidOutByLibrary(el)) continue;
      const tracks = isGrid ? trackList(style) : [];

      const gap = /px$/.test(style.columnGap) ? px(style.columnGap) : 0;
      const containerRect = el.getBoundingClientRect();
      const contentLeft = containerRect.left + px(style.paddingLeft) + px(style.borderLeftWidth);
      const contentWidth = containerRect.width - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderLeftWidth) - px(style.borderRightWidth);

      /* (a) and (b): controls spread by the container's arithmetic. */
      const controls = children.map(controlOf);
      if (controls.every(Boolean) && (!isGrid || tracks.length === children.length)) {
        let mechanism: string | null = null;
        if (isGrid) {
          // Track starts, from the resolved track list and gap.
          let x = contentLeft;
          const starts: number[] = [];
          for (let i = 0; i < tracks.length; i++) { starts.push(x); x += tracks[i] + gap; }
          const insideTrack = children.every((c, i) =>
            Math.abs(rects[i].left - starts[i]) <= 2 && tracks[i] - rects[i].width >= 48);
          const spreadsContainer = Math.abs(tracks.reduce((a, b) => a + b, 0) + gap * (tracks.length - 1) - contentWidth) <= 2;
          if (insideTrack && spreadsContainer) {
            mechanism = `${style.display} with ${tracks.length} auto-sized tracks stretched to fill the container (${tracks.map(t => Math.round(t)).join('/')}px), each control sitting at the start of its own track`;
          }
        } else {
          const jc = style.justifyContent;
          const small = rects.every(r => r.width <= contentWidth * 0.25);
          if (small && (/^space-(around|evenly)$/.test(jc) || (jc === 'space-between' && children.length >= 3))) {
            mechanism = `flex row with justify-content: ${jc}, which distributes the container's spare width between ${children.length} small controls`;
          }
        }
        if (mechanism) {
          const voids = rects.slice(1).map((r, i) => r.left - rects[i].right);
          const worst = Math.max(...voids);
          const worstIdx = voids.indexOf(worst);
          if (worst - gap >= 48 && worst >= 3 * Math.max(gap, 1)) {
            gapOutliers++;
            if (problems.length < 12) {
              const names = controls.map(c => label(c!));
              problems.push({
                kind: 'gap_outlier',
                message:
                  `${children.length} controls (${names.join(', ')}) are spread across the full width of their row instead of grouped: ${names[worstIdx + 1]} starts ${Math.round(worst)}px after ${names[worstIdx]} ends, although the declared gap is ${gap}px. ` +
                  `The parent is a ${mechanism}. ` +
                  `Group them: put the controls in a row that sizes to its content (display: flex with the gap, or ${isGrid ? 'inline-grid / grid-auto-columns: max-content' : 'justify-content: flex-start'}) or use the design system's button-group component${isGrid ? '' : ', and keep the spare width outside the group'}. ` +
                  // The remedy above was followed and the defect came back
                  // three times: the design system's own row primitive is a
                  // grid, so wrapping the controls in it produced another
                  // stretched grid that spread them again. The row has to
                  // refuse the stretch as well as group the controls.
                  `If that row is itself a child of a stretching flex or grid container — which the design system's own stack primitive usually is — it will be stretched to the full width and spread the controls again, so give the row justify-self: start (or align-self: start in a column flex parent) as well.`,
                evidence: `voids between neighbours: ${voids.map(v => Math.round(v)).join('px, ')}px against a ${gap}px gap; container ${Math.round(contentWidth)}px wide, controls ${rects.map(r => Math.round(r.width)).join('/')}px`,
                selector: cssPath(el),
                ...authorOf(el),
              });
            }
          }
        }
      }

      /* (c): one-sided margin misaligning a row's cells. */
      const aligned = isGrid
        ? /^(normal|stretch|start|flex-start|self-start)$/.test(style.alignItems)
        : /^(normal|stretch|flex-start|start)$/.test(style.alignItems);
      if (!aligned) continue;
      const misalignedBy = (items: HTMLElement[]): { offender: HTMLElement; margin: number; spread: number } | null => {
        const boxes = items.map(c => {
          const r = c.getBoundingClientRect();
          const cs = getComputedStyle(c);
          return { el: c, top: r.top, height: r.height, mt: px(cs.marginTop), mb: px(cs.marginBottom) };
        });
        const spread = Math.max(...boxes.map(b => b.top)) - Math.min(...boxes.map(b => b.top));
        // 8px: one spacing step. Below that a margin is an optical nudge —
        // a 1-4px shim that lines a glyph up with a cap height is a decision.
        if (spread < 8) return null;
        const base = Math.min(...boxes.map(b => b.top - b.mt));
        // Every offset must be exactly a margin, or it is not this defect.
        if (!boxes.every(b => Math.abs(b.top - b.mt - base) <= 2)) return null;
        // ONE-sided. A heading's symmetric block margins (the UA default, or
        // a type scale's rhythm) are not a shim somebody added to one cell.
        const withMargin = boxes.filter(b => b.mt >= 8 && b.mb <= b.mt / 2);
        const without = boxes.filter(b => b.mt < 8);
        if (withMargin.length === 0 || without.length === 0) return null;
        const offender = withMargin.sort((a, b) => b.mt - a.mt)[0];
        // Twins only. A margin that drops a 20px icon to the first line of
        // a 48px text block is optical alignment against a taller neighbour;
        // a margin that drops one of two equal-height fields is the defect.
        // Heights within a quarter of each other is "the same kind of thing".
        const twin = without.some(b => Math.abs(b.height - offender.height) <= Math.max(b.height, offender.height) * 0.25);
        if (!twin) return null;
        return { offender: offender.el, margin: offender.mt, spread };
      };
      let hit = misalignedBy(children);
      if (!hit) {
        const firsts = children.map(c => (Array.from(c.children) as HTMLElement[]).find(isVisible) || null);
        if (firsts.every(Boolean)) hit = misalignedBy(firsts as HTMLElement[]);
      }
      if (hit) {
        gapOutliers++;
        if (problems.length < 12) {
          const idx = children.findIndex(c => c === hit!.offender || c.contains(hit!.offender));
          const sibling = children[idx === 0 ? 1 : 0];
          problems.push({
            kind: 'gap_outlier',
            message:
              `${label(hit.offender)} carries margin-top: ${Math.round(hit.margin)}px that its sibling ${label(sibling)} in the same row does not, so the pair's content starts ${Math.round(hit.spread)}px apart vertically. ` +
              `Remove the one-sided margin (or apply the same spacing to every cell in the row) and let the parent's gap set the spacing.`,
            evidence: `row cells' content tops differ by ${Math.round(hit.spread)}px; the difference equals a ${Math.round(hit.margin)}px margin-top on one cell only`,
            selector: cssPath(hit.offender),
            ...authorOf(hit.offender),
          });
        }
      }
    }

    /* ── 6. Rhythm: controls sharing a row line up and match height ─────── */

    /**
     * A row of controls is read as one line, so it has to BE one line.
     *
     * A search field, a status select and a "New project" button sitting side
     * by side are a single utility row; when the fields carry a label above
     * them and the button does not, the button's centre lands below theirs and
     * the row visibly sags — the defect a designer spots instantly and no
     * check here could see. Three rules, all arithmetic on rendered boxes:
     *
     *   centres align   controls in one row share a vertical centre
     *   heights match   field-shaped controls in one row are the same height
     *   labels centre   a checkbox or radio and its label share a centre
     *
     * Scoped to CONTROLS on purpose. Text of different sizes on one line is
     * legitimately baseline-aligned, not centre-aligned, and flagging that
     * would report every well-set heading beside a caption.
     */
    const CONTROL_SELECTOR = 'button, [role="button"], input:not([type="hidden"]), select, textarea, [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"], [role="searchbox"], [role="spinbutton"]';
    const TICKY = /^(checkbox|radio)$/;

    const isTicky = (el: HTMLElement): boolean =>
      TICKY.test((el as HTMLInputElement).type || '') || /^(checkbox|radio|switch)$/.test(el.getAttribute('role') || '');
    /** A field: something that renders as a bar the eye lines up. Not a tick box, not a textarea. */
    const isField = (el: HTMLElement): boolean => {
      if (isTicky(el)) return false;
      if (el.tagName === 'TEXTAREA') return false;
      const r = el.getBoundingClientRect();
      // An icon-only square button is sized by its own rules, not the row's.
      const iconOnly = (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')
        && !(el.textContent || '').trim() && Math.abs(r.width - r.height) < 8;
      return !iconOnly && r.height > 0;
    };

    const controls = (Array.from(root.querySelectorAll(CONTROL_SELECTOR)) as HTMLElement[])
      .filter(el => isVisible(el) && el.getBoundingClientRect().height > 0)
      .slice(0, 120);

    /** Controls that share a horizontal band and do not overlap horizontally. */
    const rows: HTMLElement[][] = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const row = rows.find(group => group.every(other => {
        const o = other.getBoundingClientRect();
        const overlap = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
        const sameBand = overlap > Math.min(r.height, o.height) * 0.5;
        const sideBySide = r.left >= o.right - 1 || o.left >= r.right - 1;
        // A control nested inside another (a button in a combobox) is not a peer.
        return sameBand && sideBySide && !el.contains(other) && !other.contains(el);
      }));
      if (row) row.push(el); else rows.push([el]);
    }

    // Sub-pixel rounding and a focus ring live under 3px; the sag a person
    // sees on a control row starts around 4.
    const CENTRE_PX = 4;
    const HEIGHT_PX = 8;

    for (const row of rows) {
      if (row.length < 2 || problems.length >= 12) continue;
      const boxes = row.map(el => ({ el, r: el.getBoundingClientRect() }));
      const centre = (b: { r: DOMRect }) => b.r.top + b.r.height / 2;

      const lowest = boxes.reduce((a, b) => (centre(a) < centre(b) ? a : b));
      const highest = boxes.reduce((a, b) => (centre(a) > centre(b) ? a : b));
      const spread = centre(highest) - centre(lowest);
      const container = row[0].parentElement as HTMLElement | null;
      if (spread > CENTRE_PX && !(container && laidOutByLibrary(container))) {
        const cs = container ? getComputedStyle(container) : null;
        problems.push({
          kind: 'row_misaligned',
          message:
            `${label(highest.el)} and ${label(lowest.el)} sit on the same row but their centres are ${Math.round(spread)}px apart, so the row sags. ` +
            `Controls on one line share a vertical centre: put them in one row container with align-items: center, and if one of them has a label above it, give the others the same treatment (or align the row to the end) so every control's box starts at the same place.`,
          evidence: `${boxes.length} controls in the row; centres from ${Math.round(centre(lowest))}px to ${Math.round(centre(highest))}px${cs ? `; parent ${cs.display}, align-items: ${cs.alignItems}` : ''}`,
          selector: cssPath(highest.el),
          ...authorOf(highest.el),
        });
        continue;   // one finding per row; the height mismatch is the same story
      }

      const fields = boxes.filter(b => isField(b.el));
      if (fields.length >= 2) {
        const tallest = fields.reduce((a, b) => (a.r.height >= b.r.height ? a : b));
        const shortest = fields.reduce((a, b) => (a.r.height <= b.r.height ? a : b));
        const diff = tallest.r.height - shortest.r.height;
        if (diff > HEIGHT_PX && !(container && laidOutByLibrary(container))) {
          problems.push({
            kind: 'row_height_mismatch',
            message:
              `${label(tallest.el)} is ${Math.round(tallest.r.height)}px tall and ${label(shortest.el)} is ${Math.round(shortest.r.height)}px, on the same row — a filter or action row reads as one bar, so its fields and buttons should be the same height. ` +
              `Give them one size from the design system's own size scale rather than letting each take its default.`,
            evidence: `${fields.length} field-shaped controls: heights ${fields.map(f => Math.round(f.r.height)).join(', ')}px`,
            selector: cssPath(tallest.el),
            ...authorOf(tallest.el),
          });
        }
      }
    }

    /* ── 7. A tick box and its label share a centre ──────────────────────── */

    for (const el of controls) {
      if (problems.length >= 12) break;
      if (!isTicky(el)) continue;
      const r = el.getBoundingClientRect();
      const labelled = (el as HTMLInputElement).labels?.[0] as HTMLElement | undefined
        ?? (el.getAttribute('aria-labelledby') ? document.getElementById(el.getAttribute('aria-labelledby')!) as HTMLElement | null : null)
        ?? (el.closest('label') as HTMLElement | null);
      if (!labelled || labelled === el) continue;
      /**
       * The label's TEXT, not its box. A `<label>` usually wraps the control,
       * so its own rect contains the tick box and no comparison is possible;
       * what a person sees out of line is the words. A range over the label's
       * text nodes is exactly those glyphs.
       */
      const textRect = (host: HTMLElement): DOMRect | null => {
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        let box: DOMRect | null = null;
        while ((node = walker.nextNode())) {
          if (!(node.textContent || '').trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          box = box
            ? new DOMRect(Math.min(box.left, r.left), Math.min(box.top, r.top),
                Math.max(box.right, r.right) - Math.min(box.left, r.left),
                Math.max(box.bottom, r.bottom) - Math.min(box.top, r.top))
            : r;
        }
        return box;
      };
      const lr = (labelled.contains(el) ? textRect(labelled) : labelled.getBoundingClientRect()) as DOMRect | null;
      if (!lr || lr.height === 0 || lr.width === 0) continue;
      // Only a label placed BESIDE the control; one above it is a stacked field.
      const sideBySide = lr.left >= r.right - 2 || r.left >= lr.right - 2;
      if (!sideBySide) continue;
      // A label that wraps to several lines is centred as a block, not per line.
      if (lr.height > r.height * 2.2) continue;
      const gap = Math.abs((lr.top + lr.height / 2) - (r.top + r.height / 2));
      if (gap > CENTRE_PX && !laidOutByLibrary((el.parentElement || el) as HTMLElement)) {
        problems.push({
          kind: 'label_misaligned',
          message:
            `${label(labelled)} is ${Math.round(gap)}px off the centre of the ${isTicky(el) ? 'tick box' : 'control'} it labels, so the pair reads as crooked. ` +
            `Put the control and its label in one row with align-items: center — the design system's own checkbox/radio component does this when the label is passed to it rather than placed beside it.`,
          evidence: `control centre ${Math.round(r.top + r.height / 2)}px, label centre ${Math.round(lr.top + lr.height / 2)}px`,
          selector: cssPath(el),
          ...authorOf(el),
        });
      }
    }

    return {
      metrics: { grids, underfilledRows, raggedGroups, raggedRows, stretchedControls, gapOutliers, unmeasurableControls },
      problems,
    } as LayoutResult;
  }, options);
}
