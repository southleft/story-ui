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
  /**
   * 0-based position among instances of the AUTHORED component that share
   * this element's OWNER, in document order — not among siblings, not among
   * raw fiber names, and NOT a whole-file position.
   *
   * Scoping to the owner is what makes the number honest. A whole-page census
   * was measured wrong on both live environments: on a Radix/Tailwind story
   * the Alert's literal Button counted 8 list-rendered Buttons ahead of it and
   * reported occurrence 8 against a file containing 3 — DOM order simply is
   * not file order when one component (VolunteerBanner) is DEFINED first but
   * RENDERED last. Within a single owner's render, JSX order and DOM order do
   * correspond, and the server maps the scoped index to a file position using
   * `sourceOwner` (the file states where the owner's declaration begins and
   * ends).
   *
   * Elements produced from one `.map()` count ONCE — they are one JSX element
   * — so a literal sibling after a list keeps the right index (see
   * `fromList`).
   *
   * OMITTED when it cannot be computed confidently — a missing occurrence and
   * a zero occurrence must not look alike, and the server refuses an
   * ambiguous edit rather than defaulting to the first element.
   */
  occurrence?: number;
  /**
   * The component the STORY wrote, which is not always the one you clicked.
   *
   * Clicking a Carbon Dropdown resolves, by fiber, to `ListBox` — Carbon's
   * internal implementation. The story's source contains `<Dropdown>`, so an
   * edit aimed at `ListBox` targets something that does not exist in the file.
   *
   * `_debugOwner` names the component whose render authored an element, so the
   * outermost element still owned by the story's own component IS the JSX the
   * story wrote. React 19 removed `_debugSource` but kept this.
   */
  sourceComponent?: string;
  /**
   * Position of that element among instances sharing its owner — the same
   * number as `occurrence`, kept as a separate field for compatibility.
   */
  sourceOccurrence?: number;
  /**
   * The component whose render AUTHORED this element, from `_debugOwner` —
   * "PricingPage" for a Button the page wrote, "VolunteerBanner" for the one
   * inside the banner. The server locates this name's declaration in the
   * story file and resolves `occurrence` WITHIN it, which is what makes a
   * scoped index meaningful against the file.
   */
  sourceOwner?: string;
  /**
   * True when this element was produced from an array THE STORY wrote, so ONE
   * JSX element backs many rendered nodes.
   *
   * Detection is by fiber `key` — but not `key != null`, which was measured
   * wrong on live Mantine 8: `React.Children.map`/`toArray` inside a library
   * (Card wrapping its sections, Group filtering its children) stamps
   * POSITIONAL keys of the form `.0`/`.1` on elements the story authored as
   * plain children. React's own convention separates the two: keys minted by
   * Children processing always begin with `.`, wrapping an authored key as
   * `.$<key>`, while a key from `array.map(x => <X key={k}>)` is the bare
   * authored value. Only an authored key (bare, or `.$`-wrapped) is list
   * evidence. The walk runs from the element to its OWNER's fiber — the
   * region whose keys the owner authored — not a fixed number of hops, which
   * both missed real list keys (Mantine's Card puts 6 fibers between a CTA
   * and its keyed row) and would swallow Storybook's own keyed ErrorBoundary.
   *
   * The consequence the caller must honour: an attribute edit is still
   * correct but applies to every row, which has to be said out loud. The
   * occurrence stays MEANINGFUL — the whole list counts once in it.
   */
  fromList?: boolean;
  /**
   * Every component between the click and the story, OWNER-SORTED: an entry
   * owned by another entry in the chain is its implementation detail and
   * sorts after it (see `orderSourceCandidates`); everything else keeps
   * innermost-first order.
   *
   * The fiber chain contains names that are not JSX elements — Carbon wraps
   * its components in a `hookified` HOC, Mantine renders a Button through
   * UnstyledButton and Box — and no list of wrapper names could cover every
   * design system. Rather than guess which entry the source contains, the
   * candidates are sent and the SERVER picks the first that actually appears
   * in the file. The file is authoritative; the chain is a hypothesis — but an
   * innermost-first hypothesis put the library's internal Box ahead of the
   * Button whenever the story authored a Box anywhere, so the ordering itself
   * has to encode who implements whom.
   */
  sourceCandidates?: string[];
  /**
   * Per-candidate facts, aligned with `sourceCandidates`: each entry's OWNER
   * (the component whose render authored it), its owner-scoped occurrence,
   * and whether it came from a story-authored list.
   *
   * The owner is what lets the server tell an authored element from a
   * library internal WITHOUT any ordering heuristic. Measured live: clicking
   * the LABEL inside a Mantine Button yields a chain whose innermost entry is
   * an internal Box owned by Button at a different host depth — a shape the
   * owner-sort cannot reorder (Button legitimately owns two entries there,
   * which is also what a page composing content looks like). The fact that
   * separates them is not in the fiber at all: an authored element's owner
   * (PricingPage, PromoBanner) is DECLARED in the story file, an internal's
   * owner (Button, UnstyledButton) is imported. The server has the file, so
   * it prefers the first candidate whose owner the file declares — and then
   * needs that candidate's own occurrence and owner, which is why every
   * candidate carries them.
   */
  sourceCandidateDetails?: Array<{
    name: string;
    owner?: string;
    occurrence?: number;
    fromList?: boolean;
  }>;
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

/** One named component fiber on the path from a click to the root. */
export interface ChainEntry {
  /** The component's own name, as React reports it. */
  name: string;
  /** The nearest NAMED component whose render authored it, via `_debugOwner`. */
  owner: string | null;
  /**
   * How many HOST (DOM-producing) fibers sit between the clicked node and this
   * entry. Two entries with the same depth render the same DOM element — the
   * outer delegated its render to the inner, which is what an implementation
   * detail looks like. Optional: when absent the ownership relation is trusted
   * on its own.
   */
  hostDepth?: number;
}

/**
 * Order source candidates so the file resolves the element the user meant.
 *
 * The fiber chain under a click is innermost-first: for a Mantine Button it is
 * `Box → UnstyledButton → Button`, and the server picks the FIRST candidate
 * that appears in the story file. Innermost-first therefore breaks the moment
 * the story ALSO authors a `<Box>` somewhere else — the internal Box outranks
 * the Button and the edit lands on the wrong element. Blacklisting `Box` by
 * name is the anti-pattern this repo bans: it would break the story where the
 * user genuinely clicked an authored Box.
 *
 * The fiber already states the fact that matters: `_debugOwner`. Box's owner
 * is UnstyledButton and UnstyledButton's owner is Button — each is the next
 * one's implementation detail, so each must sort AFTER its owner. That sinks
 * the internals (`Button, UnstyledButton, Box`) without naming any of them.
 *
 * The sink grows outward from the CLICKED entry only, and stops where the
 * ownership stops meaning "implements":
 *
 *   - the owner is absent from the chain — authored by something outside this
 *     path, nothing to reorder;
 *   - the owner owns MORE than one entry along this path — it composed them
 *     (a page nesting a Button inside a Card inside a Grid), and authored
 *     content keeps its innermost-first order;
 *   - a HOST fiber sits between the entry and its owner (`hostDepth` differs)
 *     — the owner rendered its own DOM element and placed this entry inside
 *     it, which is composition. A delegate renders the SAME DOM node as its
 *     owner: Button → UnstyledButton → Box all produce the one <button>.
 *
 * Without these stops, ownership would cascade through the story's own page
 * component into Storybook's wrappers and invert the whole list. The host
 * stop carries the common case: any page that renders its own markup — a
 * layout div, a Container — puts a DOM element between its content and
 * itself. A page whose render is a bare fragment with library components as
 * direct children can still cascade one level into the page name; the server
 * still resolves against the file, so the cost is a weaker candidate order,
 * not an invented element.
 *
 * Pure and exported so the rule is testable without a browser; its SOURCE is
 * passed into the extractor below, which runs in the preview document.
 */
export function orderSourceCandidates(chain: ChainEntry[]): string[] {
  // Dedupe by name, keeping the innermost entry — that is the fiber the click
  // actually landed in, and its owner is the relationship that matters.
  const entries: ChainEntry[] = [];
  const seen = new Set<string>();
  for (const e of chain) {
    if (!e || !e.name || seen.has(e.name)) continue;
    seen.add(e.name);
    entries.push(e);
  }

  /**
   * Compound names, as the SOURCE writes them.
   *
   * A Mantine `<Menu.Item>` is the fiber `MenuItem`, rendered under a `Menu`
   * further out on the same path; Tabs.Tab, Accordion.Item, Card.Section
   * have the same shape. The file never contains `MenuItem`, so a chain of
   * [MenuItem, UnstyledButton, Box, …, Menu] resolved to whatever appeared
   * first in the file — the story's own `<Box>`, which then offered
   * `hiddenFrom`/`visibleFrom` as the props of a menu item. When an entry's
   * name is an ancestor's name plus a capitalised suffix, the dotted form is
   * offered immediately AFTER the plain one — ahead of every internal the
   * sort put below it, so the file matches the element it actually wrote
   * before it can reach the Box; and behind the plain one, so a design
   * system whose `CardFooter` really is a separate export (shadcn) keeps
   * its own name at the head. Derived from the chain, not from a list of
   * namespaces: the ancestor is there or it is not. Inlined rather than
   * shared because this function is serialised into the preview document.
   */
  const withCompounds = (names: string[]): string[] => {
    const out: string[] = [];
    for (const n of names) {
      if (out.indexOf(n) === -1) out.push(n);
      if (n.indexOf('.') !== -1) continue;
      let base: string | null = null;
      for (const e of entries) {
        const a = e.name;
        if (a === n || a.indexOf('.') !== -1 || n.length <= a.length || n.indexOf(a) !== 0) continue;
        const rest = n.slice(a.length);
        if (!/^[A-Z]/.test(rest)) continue;
        if (!base || a.length > base.length) base = a;
      }
      if (base) {
        const dotted = `${base}.${n.slice(base.length)}`;
        if (out.indexOf(dotted) === -1) out.push(dotted);
      }
    }
    return out;
  };

  if (entries.length < 2) return withCompounds(entries.map(e => e.name));

  // How many entries along this path each candidate owns.
  const ownedCount = new Map<string, number>();
  for (const e of entries) {
    if (e.owner) ownedCount.set(e.owner, (ownedCount.get(e.owner) || 0) + 1);
  }
  const byName = new Map<string, ChainEntry>();
  for (const e of entries) byName.set(e.name, e);

  // Grow the implementation cluster from the clicked entry outward.
  const cluster: ChainEntry[] = [entries[0]];
  let head = entries[0];
  let guard = 0;
  while (guard++ < entries.length) {
    const o = head.owner;
    if (!o || o === head.name) break;
    const ownerEntry = byName.get(o);
    if (!ownerEntry) break;                    // owner is not on this path: authored content
    if ((ownedCount.get(o) || 0) > 1) break;   // owner composes several entries: authored content
    if (
      typeof head.hostDepth === 'number' && typeof ownerEntry.hostDepth === 'number'
      && head.hostDepth !== ownerEntry.hostDepth
    ) break;                                   // a DOM element intervenes: composition, not delegation
    if (cluster.indexOf(ownerEntry) !== -1) break; // ownership cycle
    cluster.push(ownerEntry);
    head = ownerEntry;
  }
  if (cluster.length < 2) return withCompounds(entries.map(e => e.name));

  // The cluster inverts — its outermost member is the element the source
  // wrote, its inner members are that element's implementation. Everything
  // outside the cluster keeps innermost-first order, unchanged.
  const clusterNames = cluster.map(e => e.name).reverse();
  const rest = entries.map(e => e.name).filter(n => clusterNames.indexOf(n) === -1);
  return withCompounds([...clusterNames, ...rest]);
}

/**
 * Does this fiber key say "the STORY rendered me from an array"?
 *
 * Measured on live Mantine 8: a plain `<Button>` child of `<Card>` carries key
 * `'.2'` and one inside `<Group>` carries `'.1'` — stamped by the library's
 * own `React.Children.map`/`toArray` processing, not by any list the story
 * wrote. Treating `key != null` as list evidence marked those buttons
 * "from a list", the browser withheld their occurrence, and the server's
 * default-to-first edited a different element entirely.
 *
 * React's own convention keeps the two origins distinguishable: keys minted by
 * Children processing always begin with `.` — positional `.0`, `.1`, or `.$k`
 * wrapping a key the author DID write — while a key from
 * `rows.map(r => <X key={r.id}>)` is the bare authored value (`'Pro'`,
 * `'evt-1'`, both measured live). So a bare key, or a `.$`-wrapped one, is
 * list evidence; a bare `.`-positional key is only a library reshuffling the
 * children it was handed.
 *
 * Pure and exported so the rule is testable without a browser; its SOURCE is
 * passed into the extractor below, exactly like `orderSourceCandidates`.
 */
export function isAuthoredListKey(key: unknown): boolean {
  if (key == null) return false;
  const s = String(key);
  return !s.startsWith('.') || s.startsWith('.$');
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
export const EXTRACTOR_SOURCE = `(${function extractTarget(el: any, componentFromMarkupSrc: string, orderCandidatesSrc: string, authoredKeySrc: string): any {
  const componentFrom = eval(`(${componentFromMarkupSrc})`);
  // The owner-sort rule, shared with the workspace bundle so the unit tests
  // and the preview document run the SAME code. See orderSourceCandidates.
  const orderCandidates = eval(`(${orderCandidatesSrc})`);
  // Authored-key vs Children-key rule, shared the same way. See
  // isAuthoredListKey.
  const authoredListKey = eval(`(${authoredKeySrc})`);

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

  /**
   * Structural noise that is never a JSX element in a story file. Kept ONLY as
   * a cheap prefilter for genuinely anonymous names — everything real is
   * judged by the owner relationship below, never by its name. Adding a real
   * component (Box) here would break the story that authors one.
   */
  const ANON = /^(Fragment|ForwardRef|Memo|Anonymous|Slot|Provider|_c\d*)$/;

  const fiberTypeName = (t: any): string | null => {
    if (!t || typeof t === 'string') return null;
    const n = t.displayName || t.name || null;
    return n ? String(n).replace(/^.*\//, '') : null;
  };

  /**
   * The nearest NAMED component that authored this fiber's element.
   *
   * `_debugOwner` survives React 19 (unlike `_debugSource`) but often lands on
   * an anonymous forwardRef or memo wrapper first. Walking through the unnamed
   * links keeps the relationship usable without inventing anything — every hop
   * is still React's own record of who wrote whom.
   */
  const ownerName = (f: any): string | null => {
    let o = f && f._debugOwner;
    let hops = 0;
    while (o && hops++ < 10) {
      const nm = fiberTypeName(o.type);
      if (nm && !ANON.test(nm)) return nm;
      o = o._debugOwner;
    }
    return null;
  };

  /**
   * Every named component fiber from a node outward, innermost first, each
   * carrying the number of HOST fibers crossed to reach it — the fact that
   * separates a component that DELEGATED its render (same DOM node, same
   * count) from one that COMPOSED content inside its own markup.
   */
  const chainOf = (node: any): Array<{ name: string; owner: string | null; hostDepth: number; fiber: any }> => {
    const nk = Object.keys(node).find((x: string) =>
      x.startsWith('__reactFiber$') || x.startsWith('__reactInternalInstance$'));
    if (!nk) return [];
    const out: Array<{ name: string; owner: string | null; hostDepth: number; fiber: any }> = [];
    let f: any = (node as any)[nk];
    let guard = 0;
    let hosts = 0;
    while (f && guard++ < 40) {
      if (typeof f.type === 'string') {
        hosts++;
      } else if (f.type) {
        const nm = fiberTypeName(f.type);
        if (nm && !ANON.test(nm)) out.push({ name: nm, owner: ownerName(f), hostDepth: hosts, fiber: f });
      }
      f = f.return;
    }
    return out;
  };

  let sourceComponent;
  let sourceOccurrence;
  let sourceOwner;
  let sourceCandidates;
  let sourceCandidateDetails;
  let fromList = false;
  let occurrence;

  /**
   * Walk from a component's fiber up to (exclusive) its OWNER's fiber looking
   * for an authored list key; report the keyed fiber's parent as the list's
   * GROUP identity — every row of one `.map()` shares it, so a census can
   * count the whole list once.
   *
   * The owner bound matters at both ends, measured live: Mantine's Card puts
   * 6 fibers between a CTA Button and its keyed row `<div key="Pro">`, so a
   * fixed 6-hop walk only just reached it, and Storybook's ErrorBoundary
   * carries an authored-looking story-id key that must never be reached. When
   * the owner is unknown the walk keeps the old conservative 6-hop bound.
   */
  const listInfo = (fromFiber: any, ownerNm: string | null): { fromList: boolean; groupFiber: any } => {
    let k: any = fromFiber;
    let up = 0;
    const limit = ownerNm ? 30 : 6;
    while (k && up++ < limit) {
      if (ownerNm && typeof k.type !== 'string' && fiberTypeName(k.type) === ownerNm) break;
      if (authoredListKey(k.key)) return { fromList: true, groupFiber: k.return || null };
      if (k === k.return) break;
      k = k.return;
    }
    return { fromList: false, groupFiber: null };
  };

  const chain = chainOf(target);
  if (chain.length) {
    /**
     * Owner-sorted, not innermost-first — see orderSourceCandidates. Measured
     * on a Mantine Button the raw chain is [Box, UnstyledButton, Button], and
     * the server resolves the first name that appears in the file; any story
     * that also authors a Box sent every edit to the wrong element. The
     * owners the fiber already records (Box→UnstyledButton→Button) sink each
     * implementation below the component that owns it.
     */
    const ordered: string[] = orderCandidates(chain.map((c) => ({ name: c.name, owner: c.owner, hostDepth: c.hostDepth })));
    sourceCandidates = ordered.slice(0, 8);
    const top = ordered[0];
    // A dotted candidate (`Menu.Item`) is the source spelling of the fiber
    // `MenuItem`; its facts are that fiber's facts.
    const plainName = (nm: string) => nm.replace(/\./g, '');
    const entryFor = (nm: string) => chain.find((c) => c.name === nm) || chain.find((c) => c.name === plainName(nm));
    const topEntry = entryFor(top);
    if (topEntry) {
      sourceComponent = top;

      /**
       * Per-candidate facts — owner, owner-scoped occurrence, list membership
       * — because the CLICKED entry is not always the element the file
       * contains. Measured live: a click on the label inside a Mantine Button
       * makes the innermost entry an internal Box owned by Button, which no
       * ordering rule can sink (Button legitimately owns two chain entries
       * there — the same shape as a page composing content). The server
       * settles it against the file by preferring a candidate whose OWNER the
       * file declares; it then needs that candidate's own occurrence, so
       * every candidate carries its facts.
       */
      const details: any[] = [];
      for (const nm of sourceCandidates as string[]) {
        const e = entryFor(nm);
        if (!e) { details.push({ name: nm }); continue; }
        const li = listInfo(e.fiber, e.owner || null);
        details.push({ name: nm, _fiberName: e.name, owner: e.owner || undefined, fromList: li.fromList, _fiber: e.fiber, _group: li.groupFiber });
      }

      /**
       * One DOM scan censuses every candidate at once. Position is counted
       * among elements of the same NAME with the same OWNER, in document
       * order, one count per `.map()` list. Three population rules, each a
       * measured correction:
       *
       *   - owner match, by NAME + OWNER rather than by top candidate: the
       *     owner separates an authored element from a library internal, and
       *     the earlier top-candidate rule undercounted the file — a
       *     component's ROOT element (PromoBanner's own <Box>) resolves to
       *     the component that delegated to it, so the census skipped a Box
       *     the file plainly contains and every later Box shifted a position.
       *   - owner SCOPE: a whole-page census reported the Alert's Button at
       *     occurrence 8 in a file holding 3 — the banner was DEFINED first
       *     but RENDERED last. DOM order only tracks JSX order inside a
       *     single component's render, so that is the only region counted.
       *   - one count per list group: rows of one `.map()` are one JSX
       *     element; counting each row shifted every later literal element.
       *
       * Deduping by fiber keeps one count per component instance rather than
       * one per DOM node it rendered.
       */
      const scope = document.querySelector('#storybook-root') || document.body;
      const sameFiber = (a: any, b: any) =>
        a && b && (a === b || a === b.alternate || a.alternate === b);
      const pops: Array<Array<{ f?: any; g?: any }>> = details.map(() => []);
      /** Global fallback population for a top entry with NO owner. */
      const topOwner: string | null = topEntry.owner || null;
      const globalPopulation: Array<{ f?: any; g?: any }> = [];
      for (const node of Array.from(scope.querySelectorAll('*'))) {
        const ch2 = chainOf(node);
        if (!ch2.length) continue;
        for (let i = 0; i < details.length; i++) {
          const d = details[i];
          if (!d.owner) continue;
          let inst: any = null;
          const fiberName = d._fiberName || d.name;
          for (const c of ch2) { if (c.name === fiberName && c.owner === d.owner) { inst = c; break; } }
          if (!inst) continue;
          const il = listInfo(inst.fiber, inst.owner || null);
          const pop = pops[i];
          if (il.fromList && il.groupFiber) {
            if (!pop.some(e2 => e2.g && sameFiber(e2.g, il.groupFiber))) pop.push({ g: il.groupFiber });
          } else {
            if (!pop.some(e2 => e2.f && sameFiber(e2.f, inst.fiber))) pop.push({ f: inst.fiber });
          }
        }
        if (!topOwner) {
          // The pre-owner population rule, kept for a click whose author is
          // unknown: membership by owner-sorted top candidate.
          let mentionsTop = false;
          for (const c of ch2) { if (c.name === top) { mentionsTop = true; break; } }
          if (mentionsTop) {
            const ord2: string[] = orderCandidates(ch2.map((c) => ({ name: c.name, owner: c.owner, hostDepth: c.hostDepth })));
            if (ord2[0] === top) {
              const inst = ch2.find((c) => c.name === top);
              if (inst && !globalPopulation.some(e2 => e2.f && sameFiber(e2.f, inst.fiber))) {
                globalPopulation.push({ f: inst.fiber });
              }
            }
          }
        }
      }
      for (let i = 0; i < details.length; i++) {
        const d = details[i];
        if (d.owner) {
          const at = d.fromList && d._group
            ? pops[i].findIndex(e2 => e2.g && sameFiber(e2.g, d._group))
            : pops[i].findIndex(e2 => e2.f && sameFiber(e2.f, d._fiber));
          if (at !== -1) d.occurrence = at;
        }
        delete d._fiber;
        delete d._group;
        delete d._fiberName;
      }
      sourceCandidateDetails = details;

      /**
       * The top candidate's facts double as the target-level fields, which
       * older servers and the composer chip read.
       */
      const d0 = details[0];
      fromList = !!(d0 && d0.fromList);
      if (d0 && d0.owner) {
        sourceOwner = d0.owner;
        if (typeof d0.occurrence === 'number') {
          sourceOccurrence = d0.occurrence;
          occurrence = d0.occurrence;
        }
      } else if (!fromList) {
        let at = globalPopulation.findIndex(e2 => e2.f && sameFiber(e2.f, topEntry.fiber));
        if (at !== -1) {
          sourceOccurrence = at;
          occurrence = at;
        }
      }
      // Otherwise OMITTED, never defaulted: a portalled target (a menu item
      // rendered under document.body) is not in the census, and a wrong
      // occurrence is a silent edit to the wrong element. Absent and zero
      // must not look alike.
    }
  } else if (found) {
    /**
     * No fiber at all (non-React preview, or names minified away): fall back
     * to counting elements whose MARKUP resolves to the same component name.
     * Same population rule, weaker evidence — which is exactly the standing of
     * the class-name fallback everywhere else in this file.
     */
    const scope = document.querySelector('#storybook-root') || document.body;
    let n = 0;
    for (const node of Array.from(scope.querySelectorAll('*'))) {
      if (node === target) { occurrence = n; break; }
      const c = componentFrom(node.tagName.toLowerCase(), classesOf(node));
      if (c && c.name === found.c.name) n++;
    }
  }

  return {
    component: found ? found.c.name : null,
    via: found ? found.c.via : 'none',
    slot: found ? found.c.slot : undefined,
    tag: target.tagName.toLowerCase(),
    anchor,
    index: sibs.length > 1 ? sibs.indexOf(target) + 1 : undefined,
    siblings: sibs.length > 1 ? sibs.length : undefined,
    ancestors,
    occurrence,
    sourceComponent,
    sourceOccurrence,
    sourceOwner,
    sourceCandidates,
    sourceCandidateDetails,
    fromList,
  };
}})`;

/**
 * Describe an element of the preview document exactly as a click on it would.
 *
 * Shared by the picker and by "Select" on a verification finding, which has a
 * selector rather than a click — both must produce the same target, or the
 * property panel would resolve one and not the other.
 */
export function describeElement(doc: Document, el: Element): ElementTarget {
  // eslint-disable-next-line no-eval
  return (doc.defaultView as any).eval(`(${EXTRACTOR_SOURCE})`)(
    el,
    componentFromMarkup.toString(),
    orderSourceCandidates.toString(),
    isAuthoredListKey.toString(),
  );
}

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

  const describe = (el: Element): ElementTarget => describeElement(doc, el);

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
