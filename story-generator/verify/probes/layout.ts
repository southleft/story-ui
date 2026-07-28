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
}

export interface LayoutResult {
  metrics: LayoutMetrics;
  problems: Array<{
    kind: 'grid_underfilled' | 'ragged_edges';
    message: string;
    evidence: string;
    selector?: string;
    owner?: string;
    ownedByLibrary?: boolean;
  }>;
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

    return {
      metrics: { grids, underfilledRows, raggedGroups },
      problems,
    } as LayoutResult;
  }, options);
}
