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
 *
 * PRIMARY MECHANISM: React's own fiber tree.
 *
 * React records, on every DOM node, the component that produced it. Reading
 * that gives the EXACT name the source used — and it cannot be specific to any
 * design system, because it is React's data, not a per-library heuristic. A
 * homegrown component library reports its own names for free; so does MUI, so
 * does anything.
 *
 * Measured before it was built: on a Mantine dashboard it recovers `Title`,
 * `ActionIcon` and `Menu` — correctly skipping Mantine's internal `Box` and
 * `UnstyledButton` — and on a Radix Themes UI it recovers `Badge`, `Heading`
 * and `Select.Root`, with no code that knows what Mantine or Radix are. It even
 * names the story's own local components.
 *
 * FALLBACK: class-name conventions. Only used when there is no fiber (a
 * non-React preview, or a production build with names minified away). This is
 * the part that has to know about specific design systems, which is exactly why
 * it is the fallback and not the mechanism.
 *
 * Either way the target is then anchored by:
 *   - the nearest distinctive TEXT, which appears verbatim in the source
 *   - the position among identical siblings
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
    // Chakra's class is lowercase; the source component is PascalCase.
    if ((m = c.match(/^chakra-([a-z][a-z0-9]*)$/)))
      return { name: m[1][0].toUpperCase() + m[1].slice(1), via: 'chakra' };

    // Vuetify and Shoelace keep the FULL token, because for them the class IS
    // the template tag: `<v-alert>`, `<sl-button>`. Stripping the prefix to
    // "alert" — which is what a Mantine-shaped rule does, since stripping
    // happens to yield Mantine's real component name — throws away the exact
    // string the source contains and leaves the model guessing.
    if ((m = c.match(/^v-([a-z][a-z0-9]*)$/)))
      return { name: c, via: 'vuetify' };

    // Ant abbreviates (`ant-btn` is `<Button>`), so neither form is the source
    // name. Keep the token and let the design system name carry the bridge
    // rather than inventing a btn -> Button mapping table.
    if ((m = c.match(/^ant-([a-z][a-z0-9]*)$/)))
      return { name: c, via: 'ant' };

    if ((m = c.match(/^sl-([a-z][a-z0-9-]*)$/)))
      return { name: c, via: 'shoelace' };
  }
  return null;
}

/** Render a target as the sentence the model actually receives. */
/**
 * Only used by the class-name FALLBACK, where the token is not self-describing.
 * A name from React's fiber is the source name already and needs no label.
 */
const SYSTEM_LABEL: Record<string, string> = {
  vuetify: 'Vuetify', ant: 'Ant Design', chakra: 'Chakra',
  mui: 'MUI', mantine: 'Mantine', shoelace: 'Shoelace',
};

export function describeTarget(t: ElementTarget): string {
  // Naming the system lets the model bridge an abbreviated class to the real
  // component — "an Ant Design ant-btn" is findable, "a ant-btn" is not.
  const system = SYSTEM_LABEL[t.via];
  const what = t.component
    ? `a ${system ? `${system} ` : ''}${t.component}`
    : `a <${t.tag}>`;
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

  /**
   * The component that React says produced this node.
   *
   * Everything between a host fiber and the NEXT host fiber ancestor is the
   * stack of components that produced that one DOM node; the OUTERMOST of that
   * run is what the source wrote. That rule is what turns
   * `Box > UnstyledButton > ActionIcon` into `ActionIcon`, and
   * `Box > UnstyledButton > PopoverTarget > MenuTarget > Popover > Menu` into
   * `Menu` — both verified against a real generated story.
   */
  const fiberInfo = (node: any): { name: string | null; ancestors: string[] } | null => {
    const key = Object.keys(node).find((k: string) =>
      k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!key) return null;

    // Wrapper objects (forwardRef, memo) carry the real component inside.
    const nameOf = (t: any): string | null => {
      if (!t) return null;
      if (typeof t === 'string') return null;
      if (typeof t === 'function') return t.displayName || t.name || null;
      if (typeof t === 'object') return t.displayName || nameOf(t.render) || nameOf(t.type) || null;
      return null;
    };
    // `@mantine/core/Title` -> `Title`. Keep the last segment: that is what a
    // JSX tag looks like.
    const clean = (n: string | null) => (n ? n.replace(/^.*\//, '') : n);
    // Structural plumbing, not something a user points at or a source names.
    const NOISE = /^(Box|Provider|Fragment|ForwardRef|Memo|Unknown|Anonymous|Slot|_c\d*)$/;

    let f: any = node[key];
    if (f && typeof f.type === 'string') f = f.return;

    const run: string[] = [];
    while (f && typeof f.type !== 'string') {
      const n = clean(nameOf(f.type));
      if (n) run.push(n);
      f = f.return;
    }
    let meaningful = run.filter(n => !NOISE.test(n));

    // A component can render a host element nested inside another host element
    // it owns, which leaves the tight run empty — observed on a Radix TextArea.
    // Keep walking outward rather than reporting nothing.
    let g: any = f;
    let guard = 0;
    while (!meaningful.length && g && guard++ < 12) {
      if (typeof g.type !== 'string') {
        const n = clean(nameOf(g.type));
        if (n && !NOISE.test(n)) meaningful = [n];
      }
      g = g.return;
    }

    const ancestors: string[] = [];
    let h: any = g || f;
    let guard2 = 0;
    while (h && ancestors.length < 3 && guard2++ < 40) {
      if (typeof h.type !== 'string') {
        const n = clean(nameOf(h.type));
        if (n && !NOISE.test(n) && n !== meaningful[meaningful.length - 1] && ancestors.indexOf(n) === -1) {
          ancestors.push(n);
        }
      }
      h = h.return;
    }

    return {
      name: meaningful.length ? meaningful[meaningful.length - 1] : null,
      ancestors,
    };
  };
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

  // React first. The class-name path below only runs when there is no fiber.
  const fiber = fiberInfo(el);
  const found = fiber && fiber.name
    ? { c: { name: fiber.name, via: 'react', slot: undefined }, node: el, depth: 0 }
    : nearest(el);

  // Enclosing components, so the model knows the target sits in, say, a
  // Timeline inside a Card rather than somewhere else that looks the same.
  const ancestors: string[] = (fiber && fiber.name) ? fiber.ancestors.slice() : [];
  let cur = (fiber && fiber.name) ? null : (found ? found.node.parentElement : el.parentElement);
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
