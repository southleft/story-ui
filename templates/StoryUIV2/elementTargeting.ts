/**
 * Point at a thing and say what is wrong with it.
 *
 * This is the interaction that separates a design tool from a chat box, and the
 * reason is not convenience — it is precision. "Adjust the icons in the recent
 * activity section" makes the model guess which elements are meant and then
 * rewrite the whole composition to be safe. "This ThemeIcon, the one labelled
 * 'Deployment completed'" does not.
 *
 * Story UI can do this far more cheaply than v0 or Lovable can. They render
 * generated code in a sandbox they must bridge with postMessage. Our canvas is
 * Storybook's own `/iframe.html`, served from the SAME ORIGIN as the workspace,
 * so the real DOM is directly reachable. No protocol, no build step.
 *
 * THE ACTUAL PROBLEM is translation. The user clicks
 * `<div class="m_7341320d mantine-ThemeIcon-root">`; the source says
 * `<ThemeIcon variant="light">`. There is no source map from one to the other.
 * So instead of locating a source range, we describe the target well enough that
 * the model can find it unambiguously:
 *
 *   1. the design system's own component name, recovered from the rendered markup
 *   2. the nearest distinctive TEXT, which appears verbatim in the source
 *   3. the position among identical siblings
 *
 * Measured on real generated stories before being built: timeline bullets that
 * were six identical `ThemeIcon`s resolve to "Deployment completed",
 * "Priya mentioned you", and so on — each uniquely locatable.
 */

export interface ElementTarget {
  /** Design system component name, when it could be identified honestly. */
  component: string | null;
  /** How the component name was recovered — for debugging a bad target. */
  via: string;
  /** The component's internal slot (root, label, icon…), when known. */
  slot?: string;
  tag: string;
  /** The smallest distinctive text near the click. The model's anchor. */
  anchor: string;
  /** 1-based position among identical siblings, when there is more than one. */
  index?: number;
  siblings?: number;
  /** Chain of enclosing components, outermost last. Gives the model context. */
  ancestors: string[];
}

/**
 * Recover a design system component name from a tag and its classes.
 *
 * Pure and exported so it can be tested without a browser, and so the ranked
 * strategy is visible rather than buried in an event handler.
 *
 * Coverage is deliberately honest: this works for design systems that emit
 * semantic markers — which is most of them — and returns null for utility-class
 * systems like Tailwind/shadcn, where text anchoring carries the target instead.
 * A confident wrong component name is worse than none.
 */
export function componentFromMarkup(
  tag: string,
  classList: string[],
): { name: string; via: string; slot?: string } | null {
  // Web components and Angular Material: the tag IS the component. Best case.
  if (tag.includes('-')) return { name: tag, via: 'custom-element' };

  for (const c of classList) {
    let m: RegExpMatchArray | null;

    // PascalCase is what separates a component class from a utility class:
    // `mantine-Card-root` is a component, `mantine-focus-auto` is not. Without
    // this the extractor happily reported a component called "focus".
    if ((m = c.match(/^mantine-([A-Z][A-Za-z0-9]*)-([a-zA-Z]+)$/)))
      return { name: m[1], via: 'mantine', slot: m[2] };
    if ((m = c.match(/^Mui([A-Z][A-Za-z0-9]*)-([a-zA-Z]+)$/)))
      return { name: m[1], via: 'mui', slot: m[2] };
    if ((m = c.match(/^chakra-([a-z][a-z0-9-]*)$/)))
      return { name: m[1], via: 'chakra' };
    if ((m = c.match(/^ant-([a-z][a-z0-9]*)$/)))
      return { name: m[1], via: 'ant' };
    if ((m = c.match(/^v-([a-z][a-z0-9]*)$/)))
      return { name: m[1], via: 'vuetify' };
    if ((m = c.match(/^sl-([a-z][a-z0-9-]*)$/)))
      return { name: m[1], via: 'shoelace' };
  }
  return null;
}

/** Render a target as the sentence the model actually receives. */
export function describeTarget(t: ElementTarget): string {
  const what = t.component ? `a ${t.component}` : `a <${t.tag}>`;
  const anchor = (t.anchor || '').replace(/\s+/g, ' ').trim();
  const where = anchor ? ` containing the text "${anchor}"` : '';
  const which = t.index && t.siblings ? ` (item ${t.index} of ${t.siblings})` : '';
  const inside = t.ancestors.length ? ` inside ${t.ancestors.join(' > ')}` : '';
  return `${what}${where}${which}${inside}`;
}

/** Short label for the chip shown in the composer. */
export function targetLabel(t: ElementTarget): string {
  const name = t.component || t.tag;
  // Collapse whitespace defensively: an anchor that reached the chip with
  // newlines in it broke the composer row and read as a bug.
  const anchor = (t.anchor || '').replace(/\s+/g, ' ').trim();
  if (!anchor) return t.index ? `${name} #${t.index}` : name;
  const text = anchor.length > 28 ? `${anchor.slice(0, 27)}…` : anchor;
  return `${name} · ${text}`;
}

/**
 * The function that runs INSIDE the preview document.
 *
 * Serialised to a string and evaluated in the iframe rather than imported,
 * because the preview is a separate document with its own module graph — the
 * workspace's bundle does not exist in there.
 */
export const EXTRACTOR_SOURCE = `(${function extractTarget(el: any, componentFromMarkupSrc: string): any {
  const componentFrom = eval(`(${componentFromMarkupSrc})`);
  const classesOf = (n: any) => (n.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  const textOf = (n: any) => (n.innerText || '').replace(/\s+/g, ' ').trim();

  const nearest = (node: any) => {
    let cur = node, depth = 0;
    while (cur && depth < 10) {
      const c = componentFrom(cur.tagName.toLowerCase(), classesOf(cur));
      if (c) return { c, node: cur, depth };
      cur = cur.parentElement; depth++;
    }
    return null;
  };

  const found = nearest(el);

  // Enclosing components, so the model knows the target sits in, say, a
  // Timeline inside a Card rather than somewhere else that looks the same.
  const ancestors: string[] = [];
  let cur = found ? found.node.parentElement : el.parentElement;
  let guard = 0;
  while (cur && ancestors.length < 3 && guard < 24) {
    const c = componentFrom(cur.tagName.toLowerCase(), classesOf(cur));
    if (c && c.name !== (found && found.c.name)) ancestors.push(c.name);
    cur = cur.parentElement; guard++;
  }

  const own = textOf(el);
  const labelFrom = (n: any) => ['aria-label', 'title', 'alt', 'placeholder', 'name']
    .map(a => (n.getAttribute ? n.getAttribute(a) : null))
    .find((v: any) => v && String(v).trim());

  let anchor = '';
  if (own && own.length <= 60) {
    anchor = own;
  } else {
    // Descendants too: design systems wrap inputs, so the placeholder that
    // identifies a search field sits on a child of the clicked node.
    const label = labelFrom(el)
      || Array.from(el.querySelectorAll('input,textarea,select,[aria-label],[title]'))
           .map(labelFrom).find(Boolean);
    if (label) {
      anchor = String(label).trim();
    } else {
      // Take the FIRST LINE of the nearest ancestor that has text. A timeline
      // bullet's ancestor holds the whole item — heading, body and byline —
      // which is too long to anchor on and was previously discarded entirely,
      // leaving six identical targets with nothing to tell them apart. The
      // first line is the heading, which is exactly what the source contains.
      let node = el, depth = 0;
      while (node && depth < 6) {
        if (textOf(node)) {
          // Plain '\n'. This function body is interpolated as REAL CODE, not
          // as a string, so an escaped '\\n' here splits on a literal
          // backslash-n that never occurs — the first-line logic silently never
          // fired and the anchor became the element's whole multi-line text.
          const line = (node.innerText || '').split('\n').map((l: string) => l.trim()).find(Boolean);
          if (line && line.length >= 2) { anchor = line.slice(0, 60); break; }
        }
        node = node.parentElement; depth++;
      }
    }
  }

  const target = found ? found.node : el;
  const parent = target.parentElement;
  const sibs = parent
    ? Array.from(parent.children).filter((c: any) => c.tagName === target.tagName)
    : [];

  return {
    component: found ? found.c.name : null,
    via: found ? found.c.via : 'none',
    slot: found ? found.c.slot : undefined,
    tag: target.tagName.toLowerCase(),
    anchor,
    index: sibs.length > 1 ? sibs.indexOf(target) + 1 : undefined,
    siblings: sibs.length > 1 ? sibs.length : undefined,
    ancestors,
  };
}})`;

/**
 * Turn on click-to-select inside the preview document.
 *
 * Returns a teardown function. Everything it adds is tagged so teardown is
 * total: a stray highlight left in the user's story would look like a rendering
 * bug in their design system.
 */
export function attachElementPicker(
  doc: Document,
  onPick: (target: ElementTarget) => void,
): () => void {
  const HIGHLIGHT_ID = 'suiw-pick-highlight';

  const highlight = doc.createElement('div');
  highlight.id = HIGHLIGHT_ID;
  Object.assign(highlight.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    border: '2px solid #29A383',
    background: 'rgba(41, 163, 131, 0.10)',
    borderRadius: '3px',
    transition: 'all 60ms ease',
    display: 'none',
  } as CSSStyleDeclaration);
  doc.body.appendChild(highlight);

  const label = doc.createElement('div');
  Object.assign(label.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    font: '11px ui-sans-serif, system-ui, sans-serif',
    background: '#29A383',
    color: '#fff',
    padding: '2px 6px',
    borderRadius: '3px',
    display: 'none',
    whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);
  doc.body.appendChild(label);

  doc.body.style.cursor = 'crosshair';

  const describe = (el: Element): ElementTarget =>
    // eslint-disable-next-line no-eval
    (doc.defaultView as any).eval(`(${EXTRACTOR_SOURCE})`)(el, componentFromMarkup.toString());

  let current: Element | null = null;

  const onMove = (e: MouseEvent) => {
    const el = e.target as Element;
    if (!el || el === highlight || el === label) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: 'block',
      left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
    try {
      const t = describe(el);
      label.textContent = targetLabel(t);
      // Flip below the element when there is no room above it.
      const above = r.top > 20;
      Object.assign(label.style, {
        display: 'block',
        left: `${Math.max(2, r.left)}px`,
        top: above ? `${r.top - 18}px` : `${r.bottom + 4}px`,
      });
    } catch {
      label.style.display = 'none';
    }
  };

  const onClick = (e: MouseEvent) => {
    // The story is interactive — a click would open a menu or submit a form.
    // While picking, the click means "this one" and nothing else.
    e.preventDefault();
    e.stopPropagation();
    const el = (e.target as Element) || current;
    if (!el) return;
    try { onPick(describe(el)); } catch { /* unidentifiable node */ }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onPick(null as any); }
  };

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);

  return () => {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.body.style.cursor = '';
    highlight.remove();
    label.remove();
  };
}
