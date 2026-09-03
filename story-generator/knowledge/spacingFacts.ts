/**
 * How THIS design system spaces, pads, aligns and sizes text — derived from
 * what the project already states, never from a pixel doctrine.
 *
 * A design review of 22 Carbon stories scored spacing 1.6/3 while component
 * choice, props and colour were largely right: inline `marginTop: '1rem'` on
 * one field of a pair, `padding: '24px'` wrappers, `Heading style={{fontSize}}`.
 * The reviewer traced it to the prompt, which taught `style={{ padding:
 * "24px" }}` and "MINIMUM 16px gap" to every design system — including one
 * whose catalog already carried `Stack.gap` with a documented scale. The model
 * had the primitive and was told to reach past it.
 *
 * Three sources, all already read by the pipeline:
 *
 *   CATALOG   components that own a gap/spacing prop, a padding prop, or a
 *             heading/text size prop — with the values their types declare
 *   TOKENS    the project's spacing scale as CSS custom properties, with values
 *   IDIOM     the spacing utility classes the team's own stories use
 *
 * Whichever exist become the rules. Only a system with none of them gets the
 * inline pixel examples, and the prompt says so.
 */

import fs from 'fs';
import type { DiscoveredComponent, PropInfo } from '../componentDiscovery.js';
import type { ExtractedProps, PropFact } from './propExtractor.js';
import type { StylingFacts } from './stylingFacts.js';
import { resolveTokenValue, valueKind } from './stylingFacts.js';

export interface GapPrimitive {
  name: string;
  /** The prop that sets the gap: `gap`, `spacing`, `space`, `gutter`. */
  prop: string;
  /** Values the prop's type declares, when it declares any. */
  values: string[];
  /** True when the type also admits arbitrary strings/numbers. */
  open: boolean;
  /** One-line doc for the gap prop, when the library wrote one. */
  doc?: string;
  /** The prop (and values) that picks direction, when the primitive has one. */
  orientation?: { prop: string; values: string[] };
  /** True when the catalog files it under layout. */
  layoutCategory: boolean;
}

export interface PaddingOwner {
  name: string;
  props: string[];
  values: string[];
  open: boolean;
}

export interface TypographyPrimitive {
  name: string;
  /** Size/level/weight props with the values they accept. */
  props: Array<{ name: string; values: string[] }>;
}

export interface SpacingToken {
  /** Without the leading `--`. */
  name: string;
  /** The resolved literal, e.g. `16px`. */
  value: string;
}

export interface UtilityScale {
  /** The attribute the team writes them in: `className` or `class`. */
  attribute: string;
  /** Spacing utilities counted from the team's own stories, most-used first. */
  classes: Array<{ name: string; uses: number }>;
}

export interface SpacingVocabulary {
  gapPrimitives: GapPrimitive[];
  paddingOwners: PaddingOwner[];
  typography: TypographyPrimitive[];
  /** `config.layoutRules` names that actually exist in the catalog. */
  columns?: { wrapper: string; column?: string; container?: string };
  /** Config layout examples that carry no raw pixel/rem literal. */
  layoutExamples: string[];
  spacingTokens: SpacingToken[];
  utilities: UtilityScale | null;
  /** The team's dominant styling attribute, from their own stories. */
  idiom: string | null;
  /**
   * Colour token tiers, from the alias chains the stylesheet declares.
   * `aliasesOf` maps a PRIMITIVE (literal value) to the semantic tokens that
   * point at it. A primitive with an alias is single-mode by construction:
   * only the alias is redeclared under a dark theme.
   */
  aliasesOf: Record<string, string[]>;
  /** A gap primitive, a spacing token scale, or a utility scale exists. */
  hasScale: boolean;
  /** One line saying where the scale came from, for the log. */
  source: string;
}

const GAP_PROP = /^(gap|spacing|space|gutter)$/;
const PADDING_PROP = /^(p|px|py|padding|paddingX|paddingY|paddingInline|paddingBlock|pad)$/;
const ORIENTATION_PROP = /^(orientation|direction)$/;
const TYPO_SIZE_PROP = /^(order|level|size|variant|fz|fw|weight|as|tone)$/;
const TYPO_NAME = /(^|[a-z])(Heading|Title|Text|Typography|Display|Paragraph|Label|Caption|Kicker)$/;
const SPACING_TOKEN_SEGMENT = /^(space|spacing|gap|inset)$/;
const RAW_LITERAL = /-?\d*\.?\d+(px|rem|em)\b/;
/** Tailwind (`gap-4`, `space-y-2`, `p-6`) and Vuetify (`ga-4`, `pa-4`) spacing utilities. */
export const SPACING_UTILITY = /^(?:gap|gap-[xy]|space-[xy]|p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|ga|gr|gc|pa|ma)-(?:\d+(?:\.\d+)?|px)$/;

type AnyProp = { name: string; type?: string; options?: string[]; optionsOpen?: boolean; doc?: string; deprecated?: string };

function propsOf(component: DiscoveredComponent, facts: ExtractedProps | null | undefined): AnyProp[] {
  const fromFacts: PropFact[] | undefined = facts?.components?.[component.name]?.props;
  if (fromFacts?.length) return fromFacts.filter(p => !p.deprecated);
  const fromTypes: PropInfo[] | undefined = component.propTypes;
  if (fromTypes?.length) {
    return fromTypes.map(p => ({ name: p.name, type: p.type === 'select' ? undefined : p.type, options: p.options, doc: p.description }));
  }
  return (component.props || []).map(p => ({ name: String(p).match(/^([A-Za-z_$][\w$]*)/)?.[1] || String(p) }));
}

/** The string values a prop admits, from its options or a plain literal union. */
function valuesOf(p: AnyProp): { values: string[]; open: boolean } {
  if (p.options?.length) return { values: p.options, open: p.optionsOpen === true };
  const t = p.type || '';
  const literals = [...t.matchAll(/'([^']*)'/g)].map(m => m[1]);
  if (literals.length) {
    // A union that is only literals is closed; anything else beside them is open.
    const rest = t.replace(/'[^']*'/g, '').replace(/[|\s()]/g, '');
    return { values: literals, open: rest.length > 0 };
  }
  // A numeric union (`1 | 2 | 3`, a heading level) is closed too.
  if (/^\s*\d+(\s*\|\s*\d+)+\s*$/.test(t)) return { values: t.split('|').map(x => x.trim()), open: false };
  return { values: [], open: true };
}

/** Is this prop's type something a length or scale step could go in? */
function takesValue(p: AnyProp): boolean {
  const t = (p.type || '').trim();
  if (!t) return true;
  if (/^boolean$/.test(t) || /=>/.test(t) || /^\(/.test(t) && /\)\s*=>/.test(t)) return false;
  return true;
}

function segmentsOf(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().split(/[-_.]/);
}

function lengthOrder(value: string): number {
  const m = value.match(/^(?:calc\(\s*)?(-?\d*\.?\d+)(px|rem|em)?/);
  if (!m) return Number.POSITIVE_INFINITY;
  const n = parseFloat(m[1]);
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n;
}

/**
 * The project's spacing scale, as tokens whose NAME says spacing and whose
 * VALUE is a length. Both are required: Carbon's stylesheet declares
 * `--cds-grid-margin: 0` and `--layout--size-lg: where(...)` under the same
 * name shapes, and a scale made of those would teach nothing. Aliases into the
 * scale (`--comp-button-gap-xs: var(--space-4)`) are component tokens and are
 * left to the component that owns them.
 */
export function spacingScaleFrom(styling: StylingFacts | null | undefined): SpacingToken[] {
  if (!styling) return [];
  const all = new Map<string, string>();
  for (const g of styling.tokens) for (const [n, v] of Object.entries(g.values || {})) all.set(n, v);
  const lookup = (n: string) => all.get(n);
  const out: SpacingToken[] = [];
  for (const g of styling.tokens) {
    for (const name of g.names) {
      if (!segmentsOf(name).some(s => SPACING_TOKEN_SEGMENT.test(s))) continue;
      const raw = g.values?.[name];
      if (!raw || /^var\(/.test(raw.trim())) continue;
      const literal = resolveTokenValue(raw, lookup);
      if (!literal) continue;
      // `calc(1rem * var(--mantine-scale))` is a length the browser computes;
      // its first term orders it. A plain literal is taken as is.
      const calc = literal.match(/^calc\(\s*(-?\d*\.?\d+(?:px|rem|em))\b/);
      const plain = /^-?\d*\.?\d+(px|rem|em)?$/.test(literal) && (valueKind(literal) === 'length' || valueKind(literal) === 'number');
      if (!calc && !plain) continue;
      out.push({ name, value: literal.length > 28 ? (calc ? calc[1] + ' ×scale' : literal.slice(0, 28)) : literal });
    }
  }
  const unique = out.filter((t, i, arr) => arr.findIndex(o => o.name === t.name) === i);
  /**
   * One FAMILY is the scale: the tokens that share a name minus its last
   * segment. Mantine declares `--mantine-spacing-{xs…xl}` beside a
   * component's `--pg-gap-{xs…xl}`; both say "spacing" and both are lengths,
   * and only the family a whole system shares is the scale a composition
   * should use. The largest family wins, `spacing`/`space` over `gap` on a
   * tie; a family under three members is a component's internals (Carbon's
   * `--cds-stack-gap`), not a series.
   */
  const families = new Map<string, SpacingToken[]>();
  for (const t of unique) {
    const segs = segmentsOf(t.name);
    const key = segs.length > 1 ? segs.slice(0, -1).join('-') : t.name;
    (families.get(key) || families.set(key, []).get(key)!).push(t);
  }
  // The system's own namespace breaks a tie: `--mantine-spacing-*` and
  // `--chip-spacing-*` are both five lengths, and `mantine-` prefixes nine
  // hundred other tokens where `chip-` prefixes a handful.
  const allNames = styling.tokens.flatMap(g => g.names);
  const prefixCount = (key: string) => { const first = key.split('-')[0]; return allNames.filter(n => n === first || n.startsWith(first + '-')).length; };
  let best: SpacingToken[] = [];
  let bestScore = -1;
  for (const [key, members] of families) {
    const score = members.length * 1000 + (/(^|-)(spacing|space)(-|$)/.test(key) ? 100_000 : 0) + Math.min(999, prefixCount(key));
    if (score > bestScore) { bestScore = score; best = members; }
  }
  const scale = best.sort((a, b) => lengthOrder(a.value) - lengthOrder(b.value) || a.name.localeCompare(b.name));
  return scale.length >= 3 ? scale : [];
}

/**
 * Colour tiers from the alias chains: `--x: var(--y)` makes `--x` semantic and
 * `--y` a primitive. Only colours are tiered — a spacing scale is used
 * directly, and its aliases are component tokens.
 */
export function aliasesFrom(styling: StylingFacts | null | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!styling) return out;
  const colourGroup = styling.tokens.find(g => g.category === 'color');
  if (!colourGroup?.values) return out;
  const colourNames = new Set(colourGroup.names);
  for (const [name, value] of Object.entries(colourGroup.values)) {
    const ref = value.trim().match(/^var\(\s*--([a-zA-Z][\w-]*)\s*(?:,[^)]*)?\)$/);
    if (!ref || !colourNames.has(ref[1])) continue;
    // Only a LITERAL is a primitive; an alias of an alias is still semantic.
    const targetValue = colourGroup.values[ref[1]];
    if (!targetValue || /^var\(/.test(targetValue.trim())) continue;
    (out[ref[1]] ||= []).push(name);
  }
  return out;
}


/** Values that read as steps of a scale: numbers, t-shirt sizes, density words. */
export function looksLikeScale(values: string[]): boolean {
  if (!values.length) return true;
  return values.every(v => /^\d/.test(v) || /^(xs|sm|md|lg|xl|\d?xl|xxs|xxl|small|medium|large|none|tight|loose|compact|comfortable|dense)$/i.test(v));
}

/**
 * The steps a design system states ONLY as class names.
 *
 * Carbon's `Stack.gap` is typed `(typeof SPACING_STEPS)[number]` with
 * `SPACING_STEPS: number[]` — no literal anywhere in the declarations — while
 * its stylesheet declares `.cds--stack-scale-1` … `-13`, one class per legal
 * step, and Stack.js builds exactly that class from the prop. The stylesheet
 * is the library's own enumeration; this reads it for the component's class
 * family, bounded to the files the token reader already opened.
 */
export function scaleStepsFromStylesheets(componentName: string, files: string[] | undefined): string[] {
  if (!files?.length) return [];
  const kebab = componentName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const re = new RegExp(`\\.[a-z0-9]+(?:--?)${kebab}(?:--?|-)(?:scale|gap|spacing|space)-([a-z0-9]+)(?![\\w-])`, 'g');
  const steps = new Set<string>();
  for (const file of files.slice(0, 8)) {
    let css: string;
    try { css = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of css.matchAll(re)) steps.add(m[1]);
    if (steps.size) break;
  }
  const out = [...steps];
  const numeric = out.every(v => /^\d+$/.test(v));
  return numeric ? out.map(Number).sort((a, b) => a - b).map(String) : out.sort();
}

export function deriveSpacingVocabulary(input: {
  components: DiscoveredComponent[];
  facts?: ExtractedProps | null;
  styling?: StylingFacts | null;
  layoutRules?: { multiColumnWrapper?: string; columnComponent?: string; containerComponent?: string; layoutExamples?: Record<string, string | undefined> };
}): SpacingVocabulary {
  const { components, facts, styling, layoutRules } = input;
  const byName = new Map(components.map(c => [c.name, c]));

  const gapPrimitives: GapPrimitive[] = [];
  const paddingOwners: PaddingOwner[] = [];
  const typography: TypographyPrimitive[] = [];

  for (const c of components) {
    const props = propsOf(c, facts);
    if (!props.length) continue;
    const gap = props.find(p => GAP_PROP.test(p.name) && takesValue(p));
    if (gap) {
      let { values, open } = valuesOf(gap);
      if (!values.length) {
        const fromCss = scaleStepsFromStylesheets(c.name, styling?.stylesheetFiles);
        if (fromCss.length) { values = fromCss; open = true; }
      }
      if (looksLikeScale(values)) {
        const orient = props.find(p => ORIENTATION_PROP.test(p.name));
        let orientation: GapPrimitive['orientation'];
        if (orient) {
          const ov = valuesOf(orient).values;
          // `direction` with no declared values is CSS flex-direction — the
          // values are CSS's, not a guess about the library.
          orientation = { prop: orient.name, values: ov.length ? ov : (orient.name === 'direction' ? ['row', 'column'] : []) };
        }
        gapPrimitives.push({
          name: c.name, prop: gap.name, values, open, doc: gap.doc?.split('\n')[0],
          orientation,
          layoutCategory: c.category === 'layout',
        });
      }
    }
    const pads = props.filter(p => PADDING_PROP.test(p.name) && takesValue(p));
    if (pads.length) {
      const { values, open } = valuesOf(pads[0]);
      // `padding: 'checkbox' | 'none' | 'normal'` (MUI's TableCell) is a
      // density switch, not a place to put a spacing step.
      if (looksLikeScale(values)) paddingOwners.push({ name: c.name, props: pads.map(p => p.name), values, open });
    }
    if ((TYPO_NAME.test(c.name) || /\b(heading|typograph)/i.test(c.description || '')) && !/Skeleton/.test(c.name)) {
      const sizeProps = props.filter(p => TYPO_SIZE_PROP.test(p.name) && takesValue(p));
      typography.push({ name: c.name, props: sizeProps.map(p => ({ name: p.name, values: valuesOf(p).values })) });
    }
  }
  // Layout-category primitives first, then the shortest name — `Stack` before
  // `TableToolbarContent`, both of which may declare a gap.
  gapPrimitives.sort((a, b) => Number(b.layoutCategory) - Number(a.layoutCategory) || a.name.length - b.name.length || a.name.localeCompare(b.name));
  paddingOwners.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  // The plain typography components first (`Heading`, `Text`, `Title`), then
  // compound titles, then labels — the order a reader would reach for them.
  const typoRank = (n: string) => /^(Heading|Title|Text|Typography|Display|Paragraph)$/.test(n) ? 0 : /(Heading|Title|Text)$/.test(n) ? 1 : 2;
  typography.sort((a, b) => typoRank(a.name) - typoRank(b.name) || b.props.length - a.props.length || a.name.length - b.name.length || a.name.localeCompare(b.name));

  // Config names are honoured only where the catalog confirms them: Sail
  // Shelf's config names `Grid` as its wrapper and no such export exists.
  let columns: SpacingVocabulary['columns'];
  const isReal = (n?: string) => !!n && /^[A-Z]/.test(n) && byName.has(n);
  if (isReal(layoutRules?.multiColumnWrapper)) {
    columns = {
      wrapper: layoutRules!.multiColumnWrapper!,
      column: isReal(layoutRules?.columnComponent) && layoutRules!.columnComponent !== layoutRules!.multiColumnWrapper ? layoutRules!.columnComponent : undefined,
      container: isReal(layoutRules?.containerComponent) ? layoutRules!.containerComponent : undefined,
    };
  }
  // An example that carries a raw literal teaches the very habit this
  // replaces; it is dropped whenever the project has anything better.
  const layoutExamples = Object.values(layoutRules?.layoutExamples || {}).filter((ex): ex is string => typeof ex === 'string' && ex.trim().length > 0);

  const spacingTokens = spacingScaleFrom(styling);
  const idiomAttrs = styling?.idiom.attributes || [];
  const idiom = idiomAttrs.find(a => !/^(style|css)$/.test(a.name))?.name ?? null;
  const spacingClasses = styling?.idiom.spacingClasses || [];
  const utilities: UtilityScale | null = spacingClasses.length && idiom && /^(className|class)$/.test(idiom)
    ? { attribute: idiom, classes: spacingClasses }
    : null;

  const hasScale = gapPrimitives.length > 0 || spacingTokens.length > 0 || utilities !== null;
  const cleanExamples = hasScale ? layoutExamples.filter(ex => !RAW_LITERAL.test(ex)) : layoutExamples;

  const parts: string[] = [];
  if (gapPrimitives.length) parts.push(`${gapPrimitives.length} gap primitive(s): ${gapPrimitives.slice(0, 4).map(p => `${p.name}.${p.prop}`).join(', ')}`);
  if (paddingOwners.length) parts.push(`${paddingOwners.length} padding owner(s)`);
  if (spacingTokens.length) parts.push(`${spacingTokens.length} spacing token(s)`);
  if (utilities) parts.push(`${utilities.classes.length} spacing utilit(ies) in ${utilities.attribute}`);
  if (typography.length) parts.push(`${typography.length} typography component(s)`);

  return {
    gapPrimitives, paddingOwners, typography, columns, layoutExamples: cleanExamples,
    spacingTokens, utilities, idiom, aliasesOf: aliasesFrom(styling), hasScale,
    source: parts.length ? parts.join('; ') : 'no gap primitive, no spacing tokens, no utility scale',
  };
}

/* ------------------------------------------------------------------------ */
/* Prompt                                                                    */
/* ------------------------------------------------------------------------ */

export type ExampleSyntax = 'jsx' | 'html';

/** `<Stack gap="md">` in JSX or template syntax; numbers are braced only in JSX. */
export function exampleElement(name: string, attrs: Record<string, string | number>, syntax: ExampleSyntax, children = '…'): string {
  const attr = Object.entries(attrs).map(([k, v]) => {
    if (typeof v === 'number') return syntax === 'jsx' ? `${k}={${v}}` : `${k}="${v}"`;
    // A JSX expression (`{/* a step of the scale */}`) is written raw.
    if (syntax === 'jsx' && /^\{/.test(v)) return `${k}=${v}`;
    return `${k}="${v}"`;
  }).join(' ');
  return `<${name}${attr ? ' ' + attr : ''}>${children}</${name}>`;
}

function pickValue(values: string[], position: 'small' | 'medium' | 'large'): string | number | undefined {
  if (!values.length) return undefined;
  const idx = position === 'small' ? Math.max(0, Math.floor(values.length * 0.3))
    : position === 'medium' ? Math.floor(values.length / 2)
    : Math.min(values.length - 1, Math.floor(values.length * 0.6));
  const v = values[idx];
  return /^\d+$/.test(v) ? Number(v) : v;
}

function listValues(values: string[], open: boolean, max = 13): string {
  if (!values.length) return open ? 'a step of the spacing scale as documented on the prop' : '';
  const shown = values.slice(0, max).join(' | ');
  return `${shown}${values.length > max ? ` | …${values.length - max} more` : ''}${open ? ' (other values also accepted)' : ''}`;
}

/**
 * The spacing section of the prompt, written from the vocabulary.
 *
 * `fallback` is the framework's inline examples, used ONLY when the design
 * system offers no scale at all — and the prompt says that is why.
 */
export function formatSpacingRules(
  vocab: SpacingVocabulary | null | undefined,
  syntax: ExampleSyntax,
  fallback: { wrapper: string; formGap: string; buttonMargin: string },
): string {
  if (!vocab || !vocab.hasScale) return fallbackSpacingRules(fallback, vocab?.typography ?? []);

  const lines: string[] = [];
  lines.push('MANDATORY SPACING & LAYOUT RULES — DERIVED FROM THIS DESIGN SYSTEM (NON-NEGOTIABLE):');
  lines.push('This design system states how things are spaced. Every rule below names the mechanism');
  lines.push('the project itself provides; there is no case where an inline pixel or rem margin,');
  lines.push('padding or gap is the right answer. Inline `style` is reserved for what nothing below');
  lines.push('can express (a max-width, a background from a colour token), and never for spacing.');
  lines.push('');

  // Which primitive carries the examples. A layout-category primitive with an
  // orientation is the ideal (Carbon Stack, MUI Stack, Mantine Flex); a
  // non-layout component that merely has a `spacing` prop (a ToggleGroup) is
  // listed but never used as the pattern, and a utility-styled project keeps
  // its utilities as the pattern.
  const layoutPrims = vocab.gapPrimitives.filter(p => p.layoutCategory);
  // Known values beat unknown ones (the example can then show a real step),
  // an orientation prop beats none (one primitive covers column and row),
  // and a stack/flex/inline-shaped name breaks the tie among catalog entries.
  // A prop literally named `gap` is CSS's own name for the concept and beats
  // `spacing` on a List whose doc says "between items".
  const rankPrim = (p: GapPrimitive) => (p.values.length ? 0 : 2) + (p.orientation?.values.length ? 0 : 1) + (/^(V|H)?Stack$|^Flex$|^Inline$/.test(p.name) ? 0 : 0.5) + (p.prop === 'gap' ? 0 : 0.3);
  const candidates = layoutPrims.length ? layoutPrims : (vocab.utilities ? [] : vocab.gapPrimitives);
  const stackLike = [...candidates].sort((a, b) => rankPrim(a) - rankPrim(b))[0];
  const listed = layoutPrims.length ? layoutPrims : (vocab.utilities ? [] : vocab.gapPrimitives);

  if (listed.length) {
    lines.push('SPACING PRIMITIVES (the catalog owns the gaps — children never carry their own margins):');
    for (const p of listed.slice(0, 6)) {
      const vals = listValues(p.values, p.open);
      const orient = p.orientation ? `; ${p.orientation.prop}: ${p.orientation.values.join(' | ') || 'see catalog'}` : '';
      lines.push(`  - <${p.name} ${p.prop}=…>${vals ? ` — ${p.prop} accepts ${vals}` : ''}${orient}${p.doc ? ` — ${p.doc}` : ''}`);
    }
    lines.push('');
  }
  if (vocab.paddingOwners.length) {
    lines.push('PADDING OWNERS (put padding on these props, not in a style object):');
    for (const o of vocab.paddingOwners.slice(0, 4)) {
      lines.push(`  - <${o.name}> — ${o.props.slice(0, 6).join(', ')}${o.values.length ? ` (${listValues(o.values, o.open, 8)})` : ''}`);
    }
    lines.push('');
  }
  if (vocab.spacingTokens.length) {
    const shown = vocab.spacingTokens.slice(0, 16);
    lines.push('SPACING SCALE (the only lengths this project uses between elements):');
    lines.push(`  ${shown.map(t => `--${t.name} (${t.value})`).join(', ')}${vocab.spacingTokens.length > shown.length ? `, …${vocab.spacingTokens.length - shown.length} more` : ''}`);
    lines.push('  Write them as var(--name). A length that is not one of these is not on the scale.');
    lines.push('');
  }
  if (vocab.utilities) {
    const top = vocab.utilities.classes.slice(0, 10);
    lines.push(`HOUSE SPACING UTILITIES (counted from this team's own stories, written in \`${vocab.utilities.attribute}\`):`);
    lines.push(`  ${top.map(c => `${c.name} (${c.uses})`).join(', ')}`);
    lines.push('  Spacing is a utility class on the parent (gap-*, space-y-*, p-*), never an inline style.');
    lines.push('');
  }

  const attrs = vocab.utilities?.attribute || 'className';
  const util = (kind: 'gap' | 'pad', size: 'small' | 'medium' | 'large') => {
    // All-sides padding for a wrapper; `gap-*` for a flex/grid parent (with
    // `space-y-*` only when the team writes no gap at all).
    const all = vocab.utilities!.classes;
    const pool = kind === 'pad'
      ? all.filter(c => /^p-\d/.test(c.name))
      : (all.some(c => /^gap-\d/.test(c.name)) ? all.filter(c => /^gap-\d/.test(c.name)) : all.filter(c => /^space-y-/.test(c.name)));
    // The team's most-used step for the medium case; one step either side for small/large when they use them.
    const names = pool.map(c => c.name);
    const byStep = (n: string) => parseFloat(n.split('-').pop() || '0');
    const sorted = [...new Set(names)].sort((a, b) => byStep(a) - byStep(b));
    if (!sorted.length) return kind === 'gap' ? 'gap-4' : 'p-6';
    const mid = names[0];
    const idx = sorted.indexOf(mid);
    return size === 'medium' ? mid : size === 'small' ? sorted[Math.max(0, idx - 1)] : sorted[Math.min(sorted.length - 1, idx + 1)];
  };
  const tok = (size: 'small' | 'medium' | 'large') => {
    const v = pickValue(vocab.spacingTokens.map(x => x.name), size);
    return v !== undefined ? `var(--${v})` : undefined;
  };
  const step = (p: GapPrimitive, size: 'small' | 'medium' | 'large'): string | number => {
    const v = pickValue(p.values, size);
    if (v !== undefined) return v;
    // No values known at all: the prop's own documentation is the model's
    // guide, and the example must not invent a scale word.
    return syntax === 'jsx' ? '{/* a step of the spacing scale */}' : '…';
  };

  let wrapperExample: string;
  let stackExample: string;
  let rowExample: string;
  let recipe: string | null = null;

  if (stackLike) {
    const vertical = stackLike.orientation?.values.find(v => /vert|column/i.test(v));
    const horizontal = stackLike.orientation?.values.find(v => /horiz|row/i.test(v));
    const stackAttrs: Record<string, string | number> = { [stackLike.prop]: step(stackLike, 'medium') };
    if (vertical && stackLike.orientation) stackAttrs[stackLike.orientation.prop] = vertical;
    stackExample = exampleElement(stackLike.name, stackAttrs, syntax, ' <Field /> <Field /> <Field /> ');
    if (horizontal && stackLike.orientation) {
      rowExample = exampleElement(stackLike.name, { [stackLike.prop]: step(stackLike, 'small'), [stackLike.orientation.prop]: horizontal }, syntax, ' <Button>Cancel</Button> <Button>Save</Button> ');
    } else {
      // A second layout primitive without an orientation is a row by
      // construction (Group, Inline); failing that the same primitive, and the
      // model reads its orientation prop from the catalog.
      // Any gap primitive without an orientation is a row by construction
      // (Group, Inline); known values first, layout category as a tiebreak.
      const row = vocab.gapPrimitives.filter(p => p !== stackLike && !p.orientation)
        .sort((a, b) => (rankPrim(a) + (a.layoutCategory ? 0 : 0.25)) - (rankPrim(b) + (b.layoutCategory ? 0 : 0.25)))[0] || stackLike;
      rowExample = exampleElement(row.name, { [row.prop]: step(row, 'small') }, syntax, ' <Button>Cancel</Button> <Button>Save</Button> ');
    }
    const pad = vocab.paddingOwners[0];
    if (pad) {
      wrapperExample = exampleElement(pad.name, { [pad.props[0]]: pickValue(pad.values, 'large') ?? (syntax === 'jsx' ? '{/* a step of the scale */}' : '…') }, syntax);
    } else if (tok('large')) {
      wrapperExample = syntax === 'jsx' ? `<div style={{ padding: "${tok('large')}" }}>…</div>` : `<div style="padding: ${tok('large')}">…</div>`;
    } else if (vocab.columns?.container) {
      wrapperExample = exampleElement(vocab.columns.container, {}, syntax);
    } else {
      // No padding prop, no token, no container: Storybook's own canvas
      // padding is the breathing room. Adding an inline padding here is the
      // exact defect this section exists to prevent.
      wrapperExample = `${exampleElement(stackLike.name, { [stackLike.prop]: step(stackLike, 'large') }, syntax)} with parameters: { layout: 'padded' } (Storybook's canvas padding) — no inline padding`;
    }
  } else if (vocab.utilities) {
    wrapperExample = `<div ${attrs}="${util('pad', 'large')}">…</div>`;
    stackExample = `<div ${attrs}="flex flex-col ${util('gap', 'medium')}"> <Field /> <Field /> </div>`;
    rowExample = `<div ${attrs}="flex items-center ${util('gap', 'small')}"> <Button>Cancel</Button> <Button>Save</Button> </div>`;
  } else {
    // Tokens only: one recipe, in the project's scale, border-box so padding
    // and borders cannot break the column arithmetic (measured: a three-column
    // grid rendered two because `calc((100% - 2*gap)/3)` met content-box).
    const g = tok('medium') || 'var(--spacing)';
    const s = tok('small') || g;
    const l = tok('large') || g;
    wrapperExample = syntax === 'jsx' ? `<div style={{ padding: "${l}", boxSizing: "border-box" }}>…</div>` : `<div style="padding: ${l}; box-sizing: border-box">…</div>`;
    stackExample = syntax === 'jsx' ? `<div style={{ display: "flex", flexDirection: "column", gap: "${g}" }}> <Field /> <Field /> </div>` : `<div style="display: flex; flex-direction: column; gap: ${g}"> <Field /> <Field /> </div>`;
    rowExample = syntax === 'jsx' ? `<div style={{ display: "flex", alignItems: "center", gap: "${s}" }}> <Button>Cancel</Button> <Button>Save</Button> </div>` : `<div style="display: flex; align-items: center; gap: ${s}"> <Button>Cancel</Button> <Button>Save</Button> </div>`;
    recipe = syntax === 'jsx'
      ? `<div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "${g}", boxSizing: "border-box" }}>…</div>`
      : `<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: ${g}; box-sizing: border-box">…</div>`;
  }

  lines.push('1. STORY WRAPPER (REQUIRED): one outer container gives the story its breathing room.');
  lines.push(`   Pattern: ${wrapperExample}`);
  lines.push('2. FORM FIELDS & VERTICAL GROUPS: siblings are spaced by their PARENT. Put the gap on the');
  lines.push('   container and give no child a margin — a one-sided margin on one field of a pair is');
  lines.push('   the most common misalignment in generated code.');
  lines.push(`   Pattern: ${stackExample}`);
  lines.push('3. BUTTONS & ACTION ROWS: a row primitive with a small gap; actions sit in the same parent');
  lines.push('   stack as the fields, so the space above them is that stack\'s gap, not a marginTop.');
  lines.push(`   Pattern: ${rowExample}`);
  if (recipe) {
    lines.push('4. MULTI-COLUMN LAYOUT: this catalog has no grid component, so use this recipe with the');
    lines.push('   spacing scale — minmax(0, 1fr) and border-box keep every column the same width:');
    lines.push(`   ${recipe}`);
  } else if (vocab.columns?.column) {
    lines.push(`4. MULTI-COLUMN LAYOUT: <${vocab.columns.wrapper}> with each column in <${vocab.columns.column}>. Column spans must`);
    lines.push('   add up to the grid\'s full width; a row that comes up short reads as broken.');
  } else if (vocab.columns) {
    lines.push(`4. MULTI-COLUMN LAYOUT: <${vocab.columns.wrapper}> with its own column and gap props (see the catalog); children carry no widths.`);
  } else if (vocab.utilities) {
    lines.push(`4. MULTI-COLUMN LAYOUT: a grid utility on the parent (grid grid-cols-N ${util('gap', 'medium')}); children carry no widths.`);
  } else if (stackLike) {
    lines.push('4. MULTI-COLUMN LAYOUT: the catalog\'s grid/row primitive with its own gap prop; never a hand-rolled CSS grid with a pixel gap.');
  }
  if (vocab.layoutExamples.length) {
    lines.push('   The project\'s own layout examples:');
    for (const ex of vocab.layoutExamples.slice(0, 3)) lines.push(`   ${ex.replace(/\n\s*/g, ' ')}`);
  }
  lines.push('5. SECTIONS: nest the same primitives — a larger step between sections than within one.');
  lines.push('   Never a margin on a heading or a divider to "push" content apart.');
  lines.push('6. SIZE-HUGGING ELEMENTS (tags, badges, buttons): a vertical stack stretches its children to');
  lines.push('   its width. Wrap such an element in a row primitive or a plain inline container so it');
  lines.push('   keeps its own width; never set width or maxWidth on the element to compensate.');
  lines.push(typographyRule(vocab.typography, true));
  lines.push('');
  lines.push('SPACING SELF-CHECK before emitting: search your output for `px`, `rem` and bare numbers in');
  lines.push('margin, padding and gap properties. Each one is a defect — replace it with the primitive,');
  lines.push('utility or token above. Validation rejects them.');
  return lines.join('\n');
}

function typographyRule(typography: TypographyPrimitive[], hasScale: boolean): string {
  if (typography.length) {
    const shown = typography.slice(0, 4).map(t => {
      // Only the props that pick a SIZE or LEVEL are worth showing here.
      const props = t.props.filter(p => /^(order|level|size|as|fz|fw|weight)$/.test(p.name)).slice(0, 2);
      return `<${t.name}${props.length ? ` ${props.map(p => `${p.name}=${p.values.length ? `[${p.values.slice(0, 8).join('|')}]` : '…'}`).join(' ')}` : ''}>`;
    });
    return `7. HEADINGS & TEXT: ${shown.join(', ')} own size, weight and line-height. Never set fontSize,\n   fontWeight or lineHeight inline, and never restyle a heading with a style object — pick the\n   component and prop that already produces that size.`;
  }
  return hasScale
    ? '7. HEADINGS & TEXT: this catalog has no typography component, so use semantic h1–h6 / p with the\n   house styling mechanism (utilities or typography tokens); never fontSize/fontWeight/lineHeight inline.'
    : '7. HEADINGS & TEXT: use semantic h1–h6 / p elements; avoid inline font overrides.';
}

/** The pre-derivation rules, kept verbatim for a system that declares no scale. */
function fallbackSpacingRules(ex: { wrapper: string; formGap: string; buttonMargin: string }, typography: TypographyPrimitive[]): string {
  return `MANDATORY SPACING & LAYOUT RULES (NON-NEGOTIABLE):
** This design system declares no layout primitive with a gap prop, no spacing tokens and no
spacing utility scale, so inline spacing values are acceptable here — and only here. **
** CRITICAL: Every generated component MUST have professional-quality spacing. Components without proper spacing look broken and unprofessional. **

1. STORY WRAPPER (REQUIRED for every story):
   - The rendered story MUST have a wrapper element with padding
   - Pattern: ${ex.wrapper}
   - This ensures content has breathing room within the Storybook canvas

2. FORM FIELD SPACING (CRITICAL):
   - ALWAYS wrap form fields in a container with vertical spacing
   - Use flexbox column with gap: ${ex.formGap}
   - MINIMUM 16px gap between form fields

3. BUTTON SPACING:
   - Submit/action buttons: 24px margin-top from form fields above
   - Pattern: ${ex.buttonMargin}
   - Button groups should be wrapped with margin-top from content

4. SECTION SPACING:
   - Between major sections: 32-48px
   - Between related content groups: 24px
   - Use dividers or significant whitespace between unrelated content

5. HEADING SPACING:
   - More space ABOVE headings (24-32px) than below (8-16px)

6. CARD/CONTAINER PADDING:
   - Internal padding: minimum 16px, preferred 24px

${typographyRule(typography, false)}

SPACING VALIDATION (Self-check before generating):
Ask yourself: "Does every element have adequate breathing room from its neighbors?"
If any elements appear cramped or touching, add appropriate spacing.`;
}

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

export interface SpacingViolation {
  line: number;
  property: string;
  value: string;
  message: string;
}

const SPACING_KEY = /^(margin|padding|gap|row-?gap|column-?gap|inset|margin-?(top|bottom|left|right|block|inline)(-?(start|end))?|padding-?(top|bottom|left|right|block|inline)(-?(start|end))?)$/i;
const TYPO_KEY = /^(font-?size|font-?weight|line-?height)$/i;

interface StyleBody { kind: 'object' | 'string'; body: string; line: number }

/** Every inline style attribute: a JSX object (`style={{…}}`) or a template string (`style="…"`). */
function styleBodies(code: string): StyleBody[] {
  const out: StyleBody[] = [];
  const re = /\bstyle\s*=\s*(\{\{|"|')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const start = m.index + m[0].length;
    const line = code.slice(0, m.index).split('\n').length;
    if (m[1] === '{{') {
      let depth = 2;
      let i = start;
      for (; i < code.length && depth > 0; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
      }
      out.push({ kind: 'object', body: code.slice(start, Math.max(start, i - 2)), line });
      re.lastIndex = i;
    } else {
      const end = code.indexOf(m[1], start);
      out.push({ kind: 'string', body: code.slice(start, end < 0 ? code.length : end), line });
      if (end > 0) re.lastIndex = end + 1;
    }
  }
  return out;
}

function declarationsOf(style: StyleBody): Array<{ key: string; value: string; offset: number }> {
  const out: Array<{ key: string; value: string; offset: number }> = [];
  if (style.kind === 'object') {
    for (const dm of style.body.matchAll(/(?:^|[,{\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*('[^']*'|"[^"]*"|`[^`]*`|-?\d*\.?\d+(?![\w.])|[^,}\n]+)/g)) {
      const key = dm[1] ?? dm[2] ?? dm[3];
      const value = dm[4].trim().replace(/^['"`]|['"`]$/g, '');
      out.push({ key, value, offset: dm.index ?? 0 });
    }
  } else {
    for (const dm of style.body.matchAll(/([A-Za-z-]+)\s*:\s*([^;]+)/g)) out.push({ key: dm[1].trim(), value: dm[2].trim(), offset: dm.index ?? 0 });
  }
  return out;
}

/**
 * A raw spacing literal: `24px`, `1.5rem`, or (JSX only) a bare number, which
 * React renders as pixels. `0`, `auto` and anything computed from a token,
 * a theme or a variable is not raw.
 */
function isRawSpacing(value: string, kind: 'object' | 'string'): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/var\(|calc\(|theme|\$\{|rem\(|spacing\(/i.test(v) && !/^\s*-?\d*\.?\d+(px|rem|em)?\s*$/.test(v)) {
    // A shorthand mixing a token with a literal (`0 var(--x)`) is fine; a
    // literal beside a token (`var(--x) 12px`) is still a literal.
    return /(?:^|\s)-?\d*\.?\d+(px|rem|em)\b/.test(v.replace(/var\([^)]*\)|calc\([^)]*\)/g, ''));
  }
  const parts = v.split(/\s+/);
  const raw = parts.some(p => /^-?\d*\.?\d+(px|rem|em)$/.test(p) && parseFloat(p) !== 0);
  if (raw) return true;
  if (kind === 'object' && /^-?\d*\.?\d+$/.test(v) && parseFloat(v) !== 0) return true;
  return false;
}

function fixFor(vocab: SpacingVocabulary, property: string): string {
  const gap = vocab.gapPrimitives[0];
  const pad = vocab.paddingOwners[0];
  const isPad = /padding/i.test(property);
  const isGap = /gap/i.test(property);
  const tokens = vocab.spacingTokens.slice(0, 4).map(t => `var(--${t.name})`).join(', ');
  if (vocab.utilities) {
    const pool = vocab.utilities.classes.filter(c => isPad ? /^p/.test(c.name) : /^(gap|space|m)/.test(c.name)).slice(0, 3).map(c => c.name);
    return `use a ${vocab.utilities.attribute} utility from this project's scale (${(pool.length ? pool : vocab.utilities.classes.slice(0, 3).map(c => c.name)).join(', ')}) and drop the style property`;
  }
  if (isPad && pad) return `put the padding on <${pad.name} ${pad.props[0]}=…>${pad.values.length ? ` (${pad.values.slice(0, 6).join(' | ')})` : ''}${tokens ? `, or use a spacing token (${tokens})` : ''}`;
  if (gap && (isGap || !isPad)) return `let the parent <${gap.name} ${gap.prop}=…>${gap.values.length ? ` (${gap.values.slice(0, 8).join(' | ')})` : ''} own the spacing between siblings and remove the ${property}`;
  if (tokens) return `use a token from this project's spacing scale (${tokens})`;
  if (gap) return `space siblings with <${gap.name} ${gap.prop}=…> instead`;
  return 'use the design system\'s spacing mechanism';
}

/**
 * Inline pixel/rem margins, paddings and gaps, and inline font overrides, in
 * a design system that has a scale for them. Framework-agnostic: JSX style
 * objects and template `style="…"` strings are both read.
 */
export function checkInlineSpacing(code: string, vocab: SpacingVocabulary | null | undefined): SpacingViolation[] {
  if (!vocab || !vocab.hasScale) return [];
  const out: SpacingViolation[] = [];
  for (const st of styleBodies(code)) {
    for (const d of declarationsOf(st)) {
      if (SPACING_KEY.test(d.key) && isRawSpacing(d.value, st.kind)) {
        out.push({
          line: st.line, property: d.key, value: d.value,
          message: `inline ${d.key}: "${d.value}" is a raw spacing value in a design system that has a spacing scale — ${fixFor(vocab, d.key)}.`,
        });
      } else if (TYPO_KEY.test(d.key) && vocab.typography.length) {
        const t = vocab.typography[0];
        out.push({
          line: st.line, property: d.key, value: d.value,
          message: `inline ${d.key}: "${d.value}" overrides the design system's typography — use <${t.name}>${t.props.length ? ` with ${t.props.slice(0, 2).map(p => p.name).join('/')}` : ''} (or the typography component that already produces this size) and remove the style property.`,
        });
      }
    }
  }
  // Arbitrary utility values (`p-[24px]`) are the utility idiom's spelling of
  // the same literal.
  if (vocab.utilities) {
    code.split('\n').forEach((text, i) => {
      for (const m of text.matchAll(/\b((?:gap|space-[xy]|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-\[(-?\d*\.?\d+(?:px|rem|em))\])/g)) {
        out.push({ line: i + 1, property: m[1].split('-[')[0], value: m[2], message: `${m[1]} is an arbitrary spacing value — use a step from this project's scale (${vocab.utilities!.classes.slice(0, 3).map(c => c.name).join(', ')}).` });
      }
    });
  }
  return out;
}

export interface TierViolation {
  line: number;
  primitive: string;
  aliases: string[];
  message: string;
}

/**
 * A primitive colour token used where the project declares a semantic alias
 * for it. The alias is what follows the theme; the primitive is one mode only.
 */
export function checkTokenTiers(code: string, vocab: SpacingVocabulary | null | undefined): TierViolation[] {
  if (!vocab || !Object.keys(vocab.aliasesOf).length) return [];
  const out: TierViolation[] = [];
  const seen = new Set<string>();
  code.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/var\(\s*--([a-zA-Z][\w-]*)/g)) {
      const name = m[1];
      const aliases = vocab.aliasesOf[name];
      if (!aliases?.length || seen.has(name)) continue;
      seen.add(name);
      const shown = aliases.slice(0, 3).map(a => `--${a}`).join(', ');
      out.push({
        line: i + 1, primitive: name, aliases,
        message: `var(--${name}) is a primitive colour; this project aliases it as ${shown}${aliases.length > 3 ? ` (+${aliases.length - 3} more)` : ''}. Use the alias that names your intent — the primitive ignores the dark theme.`,
      });
    }
  });
  return out;
}

/**
 * The one-paragraph spacing note a REPAIR prompt carries. A repair gets a
 * fresh, minimal prompt with none of the generation's rules, and the first
 * measured repair re-introduced `gap: '0.75rem'` into a Carbon story the
 * generation had kept clean.
 */
export function repairSpacingNote(vocab: SpacingVocabulary | null | undefined): string | null {
  if (!vocab || !vocab.hasScale) return null;
  const how: string[] = [];
  const gap = vocab.gapPrimitives.find(p => p.layoutCategory) || vocab.gapPrimitives[0];
  if (gap && !(vocab.utilities && !gap.layoutCategory)) how.push(`<${gap.name} ${gap.prop}=…>${gap.values.length ? ` (${gap.values.slice(0, 8).join(' | ')})` : ''}`);
  if (vocab.paddingOwners[0]) how.push(`<${vocab.paddingOwners[0].name} ${vocab.paddingOwners[0].props[0]}=…>`);
  if (vocab.spacingTokens.length) how.push(`the spacing tokens (${vocab.spacingTokens.slice(0, 4).map(t => `var(--${t.name})`).join(', ')})`);
  if (vocab.utilities) how.push(`${vocab.utilities.attribute} utilities (${vocab.utilities.classes.slice(0, 4).map(c => c.name).join(', ')})`);
  return [
    'SPACING: this design system spaces with ' + how.join(', ') + '.',
    'Do not introduce an inline pixel/rem margin, padding or gap, or an inline fontSize/fontWeight, in the fix —',
    'a repair that adds one is rejected.',
  ].join('\n');
}

export function formatSpacingErrors(v: SpacingViolation[]): string[] {
  return v.map(x => `Line ${x.line}: ${x.message}`);
}

export function formatTierErrors(v: TierViolation[]): string[] {
  return v.map(x => `Line ${x.line}: ${x.message}`);
}
