/**
 * "Looks broken" — measured, not judged.
 *
 * A profile card whose stat value "34,600 nm" painted past the edge of its
 * tile went out as "Verified". The design reviewer called it broken on
 * sight; nothing in verification had compared the glyphs' box with the
 * tile's. Every check here is that comparison, in one of five shapes:
 *
 *   content_escapes  a descendant's box (a text run, a child element) extends
 *                    beyond the padding box of the nearest ancestor that draws
 *                    a visible boundary and does not clip
 *   text_clipped     text cut off by an ancestor that clips without an
 *                    ellipsis or a scrollbar
 *   sibling_overlap  two in-flow siblings whose boxes intersect
 *   page_overflow    the document is wider than the viewport
 *   empty_box        a bordered box of real size with nothing painted inside
 *
 * Thresholds are pixels, justified beside each. Intentional escape — an
 * absolutely positioned badge on a card, a negative margin the source wrote,
 * a transform — is not reported. Attribution is the fiber-owner rule the
 * other probes use: a story-authored defect blocks and is repairable; one the
 * library rendered is a warning; an unknown owner blocks, as everywhere.
 */

export type OverflowProblemKind =
  | 'content_escapes'
  | 'text_clipped'
  | 'sibling_overlap'
  | 'page_overflow'
  | 'empty_box';

export interface OverflowProblem {
  kind: OverflowProblemKind;
  message: string;
  evidence: string;
  selector?: string;
  owner?: string;
  ownedByLibrary?: boolean;
}

export interface OverflowResult {
  metrics: {
    /** Elements examined inside the story root. */
    elements: number;
    /** Containers that draw a boundary (the ones content can escape from). */
    boundaries: number;
  };
  problems: OverflowProblem[];
}

export interface OverflowOptions {
  /** Design system component names, so a defect can be attributed. */
  libraryComponents?: string[];
}

export async function runOverflowProbe(page: any, options: OverflowOptions = {}): Promise<OverflowResult> {
  return page.evaluate((opts: OverflowOptions) => {
    const LIBRARY = new Set(opts?.libraryComponents || []);
    const root: HTMLElement =
      (document.querySelector('#storybook-root') as HTMLElement) ||
      (document.querySelector('#root') as HTMLElement) ||
      document.body;

    // Sub-pixel layout, antialiasing and a focus ring account for a pixel or
    // two; an escape a person notices is at least a glyph's width.
    const ESCAPE_PX = 4;
    const OVERLAP_PX = 4;
    const MAX_CONTAINERS = 300;
    const MAX_PROBLEMS = 12;

    /** Who wrote the element — same rule as the layout probe, with the nearest attributable ancestor as fallback. */
    const authorOf = (node: any): { owner?: string; ownedByLibrary?: boolean } => {
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
        while (o && guard++ < 60) {
          const n = cleanName(o);
          if (n) return n;
          o = o._debugOwner;
        }
        return null;
      };
      const forElement = (el: any): { owner?: string; ownedByLibrary?: boolean } | null => {
        const key = Object.keys(el).find((k: string) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (!key) return null;
        let f: any = el[key];
        let last: any = f;
        let guard = 0;
        while (f?.return && guard++ < 60) {
          const p = f.return;
          if (typeof p.type === 'string' || !p.type) break;
          const n = cleanName(p);
          if (n && !LIBRARY.has(n)) {
            const o = firstNamedOwner(p);
            if (!o || !LIBRARY.has(o)) return { owner: n, ownedByLibrary: false };
          }
          last = p;
          f = p;
        }
        const o = firstNamedOwner(last);
        return o ? { owner: o, ownedByLibrary: LIBRARY.has(o) } : null;
      };
      let el: any = node && node.nodeType === 3 ? node.parentElement : node;
      let hops = 0;
      while (el && hops++ < 12) {
        const r = forElement(el);
        if (r) return r;
        el = el.parentElement;
      }
      return {};
    };

    const cs = (el: Element) => getComputedStyle(el);
    const visible = (el: Element): boolean => {
      const s = cs(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const textOf = (el: Element): string => ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const describe = (el: Element): string => {
      const t = textOf(el).slice(0, 40);
      const label = el.getAttribute('aria-label');
      return `<${el.tagName.toLowerCase()}>${label ? ` "${label}"` : t ? ` "${t}${textOf(el).length > 40 ? '…' : ''}"` : ''}`;
    };
    const selectorOf = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && cur !== root && depth++ < 4) {
        const cls = Array.from(cur.classList).slice(0, 2).map(c => `.${c}`).join('');
        parts.unshift(`${cur.tagName.toLowerCase()}${cls}`);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    };
    const px = (v: string) => parseFloat(v) || 0;
    const alpha = (color: string): number => {
      const m = color.match(/rgba?\(([^)]+)\)/);
      if (!m) return color === 'transparent' ? 0 : 1;
      const parts = m[1].split(',').map(s => parseFloat(s));
      return parts.length === 4 ? parts[3] : 1;
    };
    /** Does this element draw an edge a person can see content cross? */
    const drawsBoundary = (el: Element): boolean => {
      const s = cs(el);
      const border = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
        .some(k => px((s as any)[k]) > 0 && !/none|hidden/.test((s as any)[k.replace('Width', 'Style')]));
      if (border) return true;
      if (s.boxShadow && s.boxShadow !== 'none') return true;
      if (s.outlineStyle && s.outlineStyle !== 'none' && px(s.outlineWidth) > 0) return true;
      const bg = s.backgroundColor;
      const parentBg = el.parentElement ? cs(el.parentElement).backgroundColor : 'rgba(0, 0, 0, 0)';
      return alpha(bg) > 0 && bg !== parentBg;
    };
    const paddingBox = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = cs(el);
      return {
        left: r.left + px(s.borderLeftWidth), right: r.right - px(s.borderRightWidth),
        top: r.top + px(s.borderTopWidth), bottom: r.bottom - px(s.borderBottomWidth),
      };
    };
    /** Escape the source wrote on purpose, anywhere between `d` and `container`. */
    const intentionallyOutside = (d: Element, container: Element): boolean => {
      let cur: Element | null = d;
      while (cur && cur !== container) {
        const s = cs(cur);
        if (s.position === 'absolute' || s.position === 'fixed' || s.position === 'sticky') return true;
        if (s.transform && s.transform !== 'none') return true;
        if (px(s.marginLeft) < 0 || px(s.marginRight) < 0 || px(s.marginTop) < 0 || px(s.marginBottom) < 0) return true;
        if (s.float && s.float !== 'none') return true;
        cur = cur.parentElement;
      }
      return false;
    };
    const clips = (el: Element): boolean => {
      const s = cs(el);
      return /hidden|clip|auto|scroll/.test(s.overflowX) || /hidden|clip|auto|scroll/.test(s.overflowY);
    };
    /** The nearest ancestor (inclusive) that clips, so an escape past a clipping box is judged as a clip. */
    const textRanges = (el: Element): Array<{ node: Text; rect: DOMRect }> => {
      const out: Array<{ node: Text; rect: DOMRect }> = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = n as Text;
        if (!t.data.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(t);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) out.push({ node: t, rect });
        if (out.length > 400) break;
      }
      return out;
    };

    const problems: OverflowProblem[] = [];
    const all = Array.from(root.querySelectorAll('*')) as HTMLElement[];
    const seenContainers = new Set<Element>();
    let boundaries = 0;

    /* ── 1 & 2. content escaping a boundary; text clipped ─────────────── */
    const containers = all.filter(el => visible(el) && drawsBoundary(el)).slice(0, MAX_CONTAINERS);
    for (const container of containers) {
      boundaries++;
      const box = paddingBox(container);
      const clipping = clips(container);
      let worst: { d: Element | Text; by: number; side: string } | null = null;
      // Text runs are what actually paint past an edge; child boxes catch
      // images, buttons and nested tiles.
      for (const { node, rect } of textRanges(container)) {
        const holder = node.parentElement!;
        if (intentionallyOutside(holder, container)) continue;
        // A run inside a nearer clipping ancestor is that ancestor's business.
        let mid: Element | null = holder;
        let nearerClip = false;
        while (mid && mid !== container) { if (clips(mid)) { nearerClip = true; break; } mid = mid.parentElement; }
        if (nearerClip) continue;
        const by = Math.max(rect.right - box.right, box.left - rect.left, rect.bottom - box.bottom, box.top - rect.top);
        const side = rect.right - box.right === by ? 'right' : box.left - rect.left === by ? 'left' : rect.bottom - box.bottom === by ? 'bottom' : 'top';
        if (by > ESCAPE_PX && (!worst || by > worst.by)) worst = { d: node, by, side };
      }
      for (const child of Array.from(container.querySelectorAll('img, svg, button, input, select, textarea, video, canvas, [role="img"]'))) {
        if (!visible(child) || intentionallyOutside(child, container)) continue;
        const r = child.getBoundingClientRect();
        const by = Math.max(r.right - box.right, box.left - r.left, r.bottom - box.bottom, box.top - r.top);
        const side = r.right - box.right === by ? 'right' : box.left - r.left === by ? 'left' : r.bottom - box.bottom === by ? 'bottom' : 'top';
        if (by > ESCAPE_PX && (!worst || by > worst.by)) worst = { d: child, by, side };
      }
      if (!worst) continue;
      const holder = worst.d.nodeType === 3 ? (worst.d as Text).parentElement! : (worst.d as Element);
      const text = worst.d.nodeType === 3 ? (worst.d as Text).data.replace(/\s+/g, ' ').trim().slice(0, 40) : textOf(holder).slice(0, 40);
      const who = authorOf(holder);
      const containerWho = authorOf(container);
      const amount = Math.round(worst.by);
      if (clipping) {
        const s = cs(container);
        if (/ellipsis/.test(s.textOverflow) || /auto|scroll/.test(s.overflowX + s.overflowY)) continue;
        problems.push({
          kind: 'text_clipped',
          message: `"${text}" is cut off: it extends ${amount}px past the ${worst.side} edge of ${describe(container)}, which clips without an ellipsis or a scrollbar — let the text wrap, widen the container, or use the design system's truncation`,
          evidence: `${selectorOf(holder)} overflows ${selectorOf(container)} by ${amount}px (${worst.side}); overflow: ${s.overflowX}/${s.overflowY}, text-overflow: ${s.textOverflow}`,
          selector: selectorOf(holder),
          ...(who.owner ? who : containerWho),
        });
      } else {
        problems.push({
          kind: 'content_escapes',
          message: `"${text}" paints ${amount}px outside the ${worst.side} edge of its container ${describe(container)}${containerWho.owner ? ` (<${containerWho.owner}>)` : ''} — the content does not fit: use a smaller size from the type scale for the value, let the container grow with its content, allow wrapping, or give the flex child min-width: 0`,
          evidence: `${selectorOf(holder)} right/bottom edge exceeds the padding box of ${selectorOf(container)} by ${amount}px on the ${worst.side}; container overflow is visible`,
          selector: selectorOf(holder),
          ...(who.owner ? who : containerWho),
        });
      }
      seenContainers.add(container);
      if (problems.length >= MAX_PROBLEMS) break;
    }

    /* ── 3. siblings that overlap ────────────────────────────────────── */
    if (problems.length < MAX_PROBLEMS) {
      const inFlow = (el: Element): boolean => {
        const s = cs(el);
        if (!/^(static|relative)$/.test(s.position)) return false;
        if (s.transform && s.transform !== 'none') return false;
        if (px(s.marginLeft) < 0 || px(s.marginRight) < 0 || px(s.marginTop) < 0 || px(s.marginBottom) < 0) return false;
        if (s.float && s.float !== 'none') return false;
        return true;
      };
      const paints = (el: Element): boolean => textOf(el).length > 0 || drawsBoundary(el) || !!el.querySelector('img, svg, input, button');
      outer: for (const parent of all) {
        const kids = (Array.from(parent.children) as HTMLElement[]).filter(k => visible(k) && inFlow(k) && paints(k)).slice(0, 12);
        if (kids.length < 2) continue;
        const ps = cs(parent);
        // Explicitly placed grid items may overlap by design.
        const explicitGrid = ps.display.includes('grid') && kids.every(k => { const s = cs(k); return (s.gridRowStart !== 'auto' || s.gridColumnStart !== 'auto'); });
        if (explicitGrid) continue;
        for (let i = 0; i < kids.length; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i].getBoundingClientRect();
            const b = kids[j].getBoundingClientRect();
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (w <= OVERLAP_PX || h <= OVERLAP_PX) continue;
            const smaller = Math.min(a.width * a.height, b.width * b.height);
            if (w * h < smaller * 0.1) continue;
            const who = authorOf(kids[j]);
            problems.push({
              kind: 'sibling_overlap',
              message: `${describe(kids[i])} and ${describe(kids[j])} overlap by ${Math.round(w)}×${Math.round(h)}px inside ${describe(parent)} — two siblings occupy the same space: give the container a gap or a layout (flex/grid), or size the children so they fit`,
              evidence: `${selectorOf(kids[i])} ∩ ${selectorOf(kids[j])} = ${Math.round(w)}×${Math.round(h)}px; both in flow (position ${cs(kids[i]).position}/${cs(kids[j]).position})`,
              selector: selectorOf(kids[j]),
              ...who,
            });
            if (problems.length >= MAX_PROBLEMS) break outer;
            continue outer;
          }
        }
      }
    }

    /* ── 4. the page itself is wider than the viewport ───────────────── */
    const docEl = document.documentElement;
    if (docEl.scrollWidth > docEl.clientWidth + ESCAPE_PX) {
      let widest: HTMLElement | null = null;
      let widestRight = docEl.clientWidth;
      for (const el of all) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.right > widestRight + ESCAPE_PX && (!widest || r.right > widestRight)) { widest = el; widestRight = r.right; }
      }
      const who = widest ? authorOf(widest) : {};
      problems.push({
        kind: 'page_overflow',
        message: `The story is ${docEl.scrollWidth - docEl.clientWidth}px wider than the viewport (${docEl.clientWidth}px), so it scrolls sideways${widest ? ` — ${describe(widest)} reaches ${Math.round(widestRight)}px` : ''}; size the layout to its container (max-width: 100%, min-width: 0 on flex children, responsive columns)`,
        evidence: `document.scrollWidth ${docEl.scrollWidth} > clientWidth ${docEl.clientWidth}${widest ? `; widest ${selectorOf(widest)}` : ''}`,
        selector: widest ? selectorOf(widest) : undefined,
        ...who,
      });
    }

    /* ── 5. bordered boxes with nothing in them ─────────────────────── */
    if (problems.length < MAX_PROBLEMS) {
      for (const el of all) {
        if (!visible(el) || seenContainers.has(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 48 || r.height < 24) continue;
        const s = cs(el);
        const bordered = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(k => px((s as any)[k]) > 0);
        if (!bordered) continue; // a coloured block may be a swatch or an image placeholder; a bordered one promised content
        if (/^(hr|input|textarea|select|button|img|svg|video|canvas|iframe)$/i.test(el.tagName)) continue;
        if (el.getAttribute('aria-hidden') === 'true' || el.getAttribute('role') === 'presentation') continue;
        if (textOf(el)) continue;
        if (el.querySelector('img, svg, input, button, select, textarea, video, canvas, [role="img"], [role="progressbar"]')) continue;
        if (s.backgroundImage && s.backgroundImage !== 'none') continue;
        problems.push({
          kind: 'empty_box',
          message: `${describe(el)} is a bordered ${Math.round(r.width)}×${Math.round(r.height)}px box with nothing inside — an empty tile or panel where content was expected; fill it with the content the request asked for or remove it`,
          evidence: `${selectorOf(el)}: border ${s.borderTopWidth}, no text, no image, no control`,
          selector: selectorOf(el),
          ...authorOf(el),
        });
        if (problems.length >= MAX_PROBLEMS) break;
      }
    }

    return { metrics: { elements: all.length, boundaries }, problems } as OverflowResult;
  }, options);
}
