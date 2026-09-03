/**
 * How this design system expresses spacing, colour and shape — and how the
 * team actually writes it.
 *
 * Measured across 48 generated stories in a Tailwind project that declares 119
 * design tokens: 607 raw pixel values, 103 raw hex colours, ZERO token uses.
 * Not one. That is the most visible tell there is to a design system owner —
 * not "wrong component", which we largely fixed, but `padding: 24px` sitting in
 * a system that has a spacing scale.
 *
 * Well-built components carry their own styling, so this is not about the
 * components. It leaks in the CONNECTIVE TISSUE between them: page padding,
 * grid gaps, section backgrounds, max-widths. That is where a generation
 * invents a number, and where a reviewer sees immediately that it was not
 * written by someone on the team.
 *
 * Two things are read, both from the repo, so both work for a design system
 * invented last week:
 *
 *   TOKENS  CSS custom properties, which every modern system exposes —
 *           Tailwind v4 `@theme`, shadcn, Carbon, MUI v6+, Mantine,
 *           vanilla-extract contracts.
 *
 *   IDIOM   Which styling attribute the team actually uses, counted from their
 *           own stories. Measured: college-town writes `className` 1767 times,
 *           Mantine writes style props (`mb`, `gap`, `radius`), MUI writes
 *           `sx`. Telling a Tailwind team to use `sx` would be as wrong as
 *           inventing a pixel value, and no hardcoded per-library rule could
 *           know which is which.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';

export interface TokenGroup {
  /** Category label, e.g. `color`, `radius`, `spacing`. */
  category: string;
  /** Token names as authored, without the leading `--`. */
  names: string[];
  /**
   * The declared value per name, when one was read. `--cbds-font-size-1` is
   * 72px: shown only as a name it read as "the smallest size", and a data
   * table came back with 72px cell text. A value beside the name makes the
   * scale legible; a name alone invites the model to guess its direction.
   */
  values?: Record<string, string>;
}

export interface StylingIdiom {
  /** Styling attributes the team uses, most-used first. */
  attributes: Array<{ name: string; uses: number }>;
  /** Files sampled, so a caller can judge how much to trust it. */
  sampled: number;
  /**
   * Spacing utility classes the team writes in `className`/`class`
   * (`gap-4`, `space-y-2`, `p-6`, Vuetify's `pa-4`), most-used first. For a
   * utility-styled project this IS the spacing scale: the team's own stories
   * state which steps they use, and no token list would say it better.
   */
  spacingClasses?: Array<{ name: string; uses: number }>;
}

/**
 * How the token read went — so a caller can tell ABSENT from ZERO.
 *
 * Fluent and MUI genuinely ship no stylesheet; that is a derived positive
 * result ("we looked at 0 files because this package declares none"), and it
 * must not read the same as "we probed six guessed filenames and none matched",
 * which is what silently cost Astryx its 288 tokens. Every count here is
 * paired with what was actually examined.
 */
export interface TokenSources {
  /** Project-owned CSS files read. */
  projectFiles: number;
  /** Design-system files read, and where each came from. */
  packageFiles: number;
  /** Package stylesheets found via an `exports`/`style` declaration. */
  declaredFiles: number;
  /** Tokens found across all of it. */
  tokens: number;
  /** True when nothing was examined at all — the case that must never be silent. */
  lookedAtNothing: boolean;
}

export interface StylingFacts {
  tokens: TokenGroup[];
  idiom: StylingIdiom;
  /** Provenance of the token read. Present so zero and absent are separable. */
  sources: TokenSources;
  /** The stylesheets read (project, then package), so a caller can look for what a design system states only as class names. */
  stylesheetFiles?: string[];
}

/** Tailwind (`gap-4`, `space-y-2`, `p-6`) and Vuetify (`ga-4`, `pa-4`) spacing utilities. */
const SPACING_UTILITY_CLASS = /^(?:gap|gap-[xy]|space-[xy]|p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|ga|gr|gc|pa|ma)-(?:\d+(?:\.\d+)?|px)$/;

/** Attributes that carry styling. Deliberately broad; frequency decides. */
const STYLE_ATTRS = new Set([
  'className', 'class', 'sx', 'style', 'css',
  // Mantine / Chakra style props
  'c', 'bg', 'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr',
  'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr',
  'gap', 'spacing', 'radius', 'shadow', 'fw', 'fz', 'w', 'h', 'maw', 'mih',
  'align', 'justify', 'direction', 'wrap', 'grow',
]);

/**
 * Group a token by what its name says it controls.
 *
 * Matched against any SEGMENT rather than the start of the name. Every design
 * system that namespaces its tokens — Carbon's `--cds-text-primary`, Adobe's
 * `--spectrum-…`, Shopify's `--p-…` — put a vendor prefix in front, so an
 * anchored test filed all 446 of Carbon's tokens under "other" and the prompt
 * showed none of them. Deriving the prefix would be guesswork; not depending
 * on its absence is free.
 */
/** CSS named colours — a value in this set is a colour whatever its token is called. */
const NAMED_COLOURS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor').split(' '));

const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vw|vh|vmin|vmax|dvw|dvh|svw|svh|lvw|lvh|ch|ex|cap|ic|lh|rlh|pt|pc|cm|mm|in|q|fr)$/i;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;
const COLOUR_FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const GENERIC_FAMILY = /\b(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong)\b/i;

export type ValueKind = 'color' | 'length' | 'number' | 'shadow' | 'font' | 'other';

/** What a CSS value IS, judged from the value alone. */
export function valueKind(value: string): ValueKind {
  const v = value.trim();
  if (!v) return 'other';
  const lower = v.toLowerCase();
  if (HEX.test(v) || COLOUR_FN.test(v) || NAMED_COLOURS.has(lower)) return 'color';
  const parts = v.split(/\s+(?![^(]*\))/);
  if (parts.length === 1) {
    if (LENGTH.test(v)) return 'length';
    if (NUMBER.test(v)) return 'number';
  } else {
    const hasColour = parts.some(p => HEX.test(p) || COLOUR_FN.test(p) || NAMED_COLOURS.has(p.toLowerCase()));
    const lengths = parts.filter(p => LENGTH.test(p) || NUMBER.test(p)).length;
    if (hasColour && lengths >= 2) return 'shadow';
    if (parts.includes('inset') && lengths >= 2) return 'shadow';
    if (lengths === parts.length) return 'length';
  }
  // A font stack: quoted names, or a comma list naming a generic family.
  if (/^["']/.test(v) || (v.includes(',') && GENERIC_FAMILY.test(v)) || GENERIC_FAMILY.test(v)) {
    if (!/\d/.test(v) || /^["']/.test(v)) return 'font';
  }
  return 'other';
}

/**
 * The literal a token's value resolves to, following `var(--x)` references
 * through the sheet's own declarations. A reference that goes nowhere yields
 * its fallback, else nothing.
 */
export function resolveTokenValue(value: string | undefined, lookup?: (name: string) => string | undefined, depth = 0): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const ref = v.match(/^var\(\s*--([a-zA-Z][\w-]*)\s*(?:,\s*([^)]*))?\)$/);
  if (!ref) return v;
  if (depth > 4) return undefined;
  const target = lookup?.(ref[1]);
  const resolved = resolveTokenValue(target, lookup, depth + 1);
  if (resolved !== undefined) return resolved;
  return ref[2] ? resolveTokenValue(ref[2], lookup, depth + 1) : undefined;
}

/**
 * Group a token by what it controls — its VALUE first, its name second.
 *
 * Name alone filed `--ss-icon-md: 16px`, `--ss-layer-modal: 400` and
 * `--ss-border-width-thin: 1px` under `color`, because `icon`, `layer` and
 * `border` are colour vocabulary in every system that also uses them for
 * sizes. The value settles it: a length or a bare number is not a colour, so
 * the colour rules are withdrawn and the name is asked only which measure it
 * is (radius, typography, layout, else spacing/size). A colour literal is a
 * colour whatever its name says, and a font stack is typography. When the
 * value is absent, or says nothing (`inherit`, a keyword), the name decides
 * exactly as before.
 */
export function categorise(name: string, value?: string, lookup?: (name: string) => string | undefined): string {
  const literal = resolveTokenValue(value, lookup);
  const kind = literal ? valueKind(literal) : 'other';
  if (kind === 'color') return 'color';
  if (kind === 'font') return 'typography';
  if (kind === 'shadow') return 'shadow';
  if (kind === 'length' || kind === 'number') {
    const role = categoriseByName(name, { colour: false });
    if (role !== 'other') return role;
    const segments = segmentsOf(name);
    if (kind === 'number') {
      if (segments.some(s => /^(layer|z|zindex|index|stack|order)$/.test(s))) return 'layout';
      if (segments.some(s => /^(opacity|alpha|scale|ratio|columns|cols)$/.test(s))) return 'other';
    }
    return 'spacing';
  }
  return categoriseByName(name, { colour: true });
}

function segmentsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[-_.]/);
}

/** The name-only rules, with the colour vocabulary optionally withdrawn. */
function categoriseByName(name: string, opts: { colour: boolean }): string {
  /**
   * camelCase is a segment boundary too.
   *
   * Splitting only on `[-_.]` made every camelCase token a single segment, so
   * Fluent's `colorNeutralForeground1`, `borderRadiusMedium` and
   * `spacingHorizontalM` all landed in `other` — and `other` is skipped when
   * the guidance is formatted, so the model would have been shown NONE of that
   * system's 467 tokens even once they were collected. Same failure as the
   * anchored test below it, one naming convention later.
   */
  const segments = segmentsOf(name);
  const has = (re: RegExp) => segments.some(s => re.test(s));
  // Order matters: `text` reads as typography on its own but as a colour role
  // in `text-primary`, which is how every token system in this list uses it.
  /**
   * Radius before colour, because `border` belongs to both vocabularies.
   *
   * `--border-subtle` is a colour; `borderRadiusMedium` is a radius. With the
   * colour test first, `border` matched and every camelCase radius token was
   * filed as a colour — invisible until camelCase splitting made these names
   * reachable at all.
   */
  if (has(/^(radius|rounded|corner)$/)) return 'radius';
  if (opts.colour && has(/^(color|colour|bg|fg|background|fill|stroke|border|ring|accent|primary|secondary|muted|destructive|success|warning|info|danger|error|foreground|layer|support|interactive)$/)) return 'color';
  if (has(/^(space|spacing|gap|inset|margin|padding)$/)) return 'spacing';
  if (has(/^(shadow|elevation)$/)) return 'shadow';
  if (has(/^(font|leading|tracking|weight|type|typography|heading|body|label)$/)) return 'typography';
  if (has(/^(breakpoint|screen|container|grid)$/)) return 'layout';
  if (opts.colour && has(/^(text|icon|link)$/)) return 'color';
  if (has(/^(size|width|height|thickness|stroke)$/)) return 'spacing';
  return 'other';
}

/**
 * Story UI's own vendored files, which are not the project's design system.
 *
 * The panel ships its own stylesheet, and reading it reported `--space-0`,
 * `--radius-2xl` and a shadcn colour ramp as a MANTINE project's design tokens.
 * Presenting our own styling to a team as their own is the same self-pollution
 * that already had to be excluded from the exemplar pool.
 */
function isOwnFile(filePath: string): boolean {
  const normalised = filePath.split(path.sep).join('/');
  return /\/(StoryUI|StoryUIV2|voice)\//.test(normalised)
    || /StoryUIPanel/.test(normalised)
    || /\.backup-/.test(normalised);
}

/** Every CSS file worth reading for tokens, excluding build output. */
function styleFiles(projectRoot: string, limit = 40): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth = 0) => {
    if (depth > 4 || out.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist' || e.name === 'build') continue;
        walk(full, depth + 1);
      } else if (/\.(css|scss)$/.test(e.name) && !isOwnFile(full)) {
        out.push(full);
      }
    }
  };
  walk(path.join(projectRoot, 'src'));
  for (const name of ['index.css', 'globals.css', 'app.css', 'tailwind.css']) {
    const full = path.join(projectRoot, name);
    if (fs.existsSync(full) && !out.includes(full)) out.push(full);
  }
  return out;
}

/**
 * Design tokens declared as CSS custom properties.
 *
 * Names only, not values. The model needs to know `--color-primary` exists so
 * it can reach for it; the resolved colour is the system's business, and
 * shipping 119 values would cost context for information nobody acts on.
 */
/**
 * Stylesheets the design system itself ships.
 *
 * A team using Carbon writes no CSS of their own — the 446 `--cds-*` tokens
 * they are expected to compose with live in `@carbon/styles/css/`, inside
 * node_modules, which the project walk deliberately skips. Reading only the
 * project's own files reported that library as having no design tokens, and
 * the prompt told the model nothing, which is how Carbon output kept 15 raw
 * pixel values per story.
 *
 * Bounded hard: a compiled design system stylesheet is often megabytes, and
 * only its custom-property declarations are wanted.
 */
/**
 * Stylesheets a package DECLARES, read from its own `exports` map.
 *
 * The map is the authoritative closed list: a specifier absent from it is not
 * importable even when the file exists on disk. That distinction is not
 * academic — `@astryxdesign/core/dist/astryx.css` is a real 127KB file and
 * importing it fails with ERR_PACKAGE_PATH_NOT_EXPORTED, taking the whole
 * Storybook preview down with no JavaScript error. The exported spelling is
 * `@astryxdesign/core/astryx.css`.
 *
 * Wildcard keys (`"./styles/*": "./styles/*"`, which Mantine uses for 174
 * per-component sheets) are expanded against disk.
 */
function declaredStyleFiles(pkgRoot: string): string[] {
  let pkg: any;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')); } catch { return []; }

  const out: string[] = [];
  const addTarget = (target: unknown) => {
    if (typeof target !== 'string' || !/\.(css|scss)$/.test(target)) return;
    const full = path.join(pkgRoot, target);
    if (fs.existsSync(full) && !out.includes(full)) out.push(full);
  };
  // Conditions nest arbitrarily ({ import: { default: './x.css' } }), so walk.
  const walk = (node: unknown, depth = 0) => {
    if (depth > 5 || node == null) return;
    if (typeof node === 'string') return addTarget(node);
    if (Array.isArray(node)) return node.forEach(n => walk(n, depth + 1));
    if (typeof node === 'object') for (const v of Object.values(node as any)) walk(v, depth + 1);
  };
  walk(pkg.exports);
  // `style` and `sass` are the pre-exports-map way of stating the same fact.
  addTarget(pkg.style);
  addTarget(pkg.sass);
  return out;
}

function packageStyleFiles(projectRoot: string, importPath?: string, limit = 6): string[] {
  if (!importPath) return [];
  const pkgName = importPath.startsWith('@')
    ? importPath.split('/').slice(0, 2).join('/')
    : importPath.split('/')[0];

  const out: string[] = [];
  const scope = pkgName.startsWith('@') ? pkgName.split('/')[0] : null;
  const roots = [path.join(projectRoot, 'node_modules', ...pkgName.split('/'))];

  /**
   * Sibling packages come from what is INSTALLED under the scope, not guesses.
   *
   * The guessed list was `styles|themes|core|tokens`, which happens to find
   * Carbon's `@carbon/styles` and misses `@astryxdesign/theme-neutral` — the
   * package holding all 172 of that system's theme tokens.
   *
   * Reading the project's declared dependencies is NOT sufficient and was
   * measured wrong: `@carbon/styles` is a TRANSITIVE dependency of
   * `@carbon/react`, absent from the project's package.json, and that spelling
   * took Carbon from 370 tokens to 0. The directory listing is the fact both
   * guesses were approximating.
   */
  if (scope) {
    try {
      const scopeDir = path.join(projectRoot, 'node_modules', scope);
      for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const full = path.join(scopeDir, entry.name);
        if (full !== roots[0]) roots.push(full);
      }
    } catch { /* unscoped or not installed; the configured package alone still works */ }
  }

  for (const root of roots) {
    if (out.length >= limit || !fs.existsSync(root)) continue;
    // What the package declares, first — it is authoritative where it exists.
    for (const declared of declaredStyleFiles(root)) {
      if (!out.includes(declared)) out.push(declared);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
    // Legacy packages (Carbon, Atlassian) ship no exports map at all, so any
    // real path is legal and convention is the only remaining signal.
    for (const rel of ['css/styles.css', 'styles.css', 'dist/styles.css', 'index.css', 'dist/index.css', 'css/index.css']) {
      const full = path.join(root, rel);
      if (fs.existsSync(full) && !out.includes(full)) {
        out.push(full);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

export function readDesignTokens(projectRoot: string, importPath?: string): TokenGroup[] {
  const byCategory = new Map<string, Set<string>>();
  const values = new Map<string, string>();
  /** Every name seen, in first-seen order; categorised once all values are known. */
  const names = new Set<string>();

  for (const file of [...styleFiles(projectRoot), ...packageStyleFiles(projectRoot, importPath)]) {
    let css: string;
    try { css = fs.readFileSync(file, 'utf8'); } catch { continue; }
    /**
     * NOT line-anchored: a minified stylesheet has no lines.
     *
     * `@carbon/styles/css/styles.min.css` is 813KB on a SINGLE line. The
     * anchored form found 0 custom properties in it; unanchored finds 839. A
     * minified sheet therefore looked exactly like a sheet that declares no
     * tokens, which is the absent-vs-zero conflation in its purest form —
     * Carbon escapes it today only because the unminified file is found first.
     */
    for (const m of css.matchAll(/--([a-zA-Z][\w-]*)\s*:\s*([^;{}]*)/g)) {
      const name = m[1];
      names.add(name);
      // First declaration wins: the base sheet is found before theme overrides.
      const value = (m[2] || '').trim();
      if (value && !values.has(name)) values.set(name, value);
    }
  }

  // Categorised after the scan, so an alias token (`var(--ss-color-brand)`)
  // can be judged by the value it points at rather than by its name.
  for (const name of names) {
    const category = categorise(name, values.get(name), n => values.get(n));
    if (!byCategory.has(category)) byCategory.set(category, new Set());
    byCategory.get(category)!.add(name);
  }

  /**
   * Most foundational first, because the list gets truncated.
   *
   * Alphabetical order gave Carbon's model 24 `--cds-ai-popover-caret-bottom-
   * background-actions` variants and cut `--cds-text-primary` and
   * `--cds-layer` — the tokens anyone actually composes with. Across every
   * system here the core token is the SHORT one and specialisations extend it,
   * which is a property of how tokens are named rather than a fact about any
   * one library.
   */
  const depth = (n: string) => n.split('-').filter(Boolean).length;
  return [...byCategory.entries()]
    .map(([category, names]) => {
      const sorted = [...names].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
      const known: Record<string, string> = {};
      for (const n of sorted) { const v = values.get(n); if (v) known[n] = v; }
      return { category, names: sorted, ...(Object.keys(known).length ? { values: known } : {}) };
    })
    .sort((a, b) => b.names.length - a.names.length);
}

/**
 * How the team writes styling, counted from their own stories.
 *
 * Generated stories are excluded: they are exactly the output whose habits we
 * are trying to correct, and learning from them would ratify the raw pixel
 * values this exists to eliminate.
 */
export function readStylingIdiom(projectRoot: string, generatedFragment = 'generated'): StylingIdiom {
  const counts = new Map<string, number>();
  const utilityCounts = new Map<string, number>();
  let sampled = 0;

  const walk = (dir: string, depth = 0) => {
    if (depth > 6 || sampled >= 60) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (sampled >= 60) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === generatedFragment) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!/\.stories\.[jt]sx?$/.test(e.name) || isOwnFile(full)) continue;
      let src: string;
      try { src = fs.readFileSync(full, 'utf8'); } catch { continue; }
      sampled++;
      for (const m of src.matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)=[{"]/g)) {
        const attr = m[1];
        if (!STYLE_ATTRS.has(attr)) continue;
        counts.set(attr, (counts.get(attr) || 0) + 1);
      }
      // The spacing steps the team actually writes, read from their class
      // strings. Only the literal string parts are read; an expression is
      // opaque and is skipped rather than guessed at.
      for (const m of src.matchAll(/(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g)) {
        const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
        for (const cls of value.split(/\s+/)) {
          const bare = cls.replace(/^[a-z-]+:/, '');
          if (!SPACING_UTILITY_CLASS.test(bare)) continue;
          utilityCounts.set(bare, (utilityCounts.get(bare) || 0) + 1);
        }
      }
    }
  };
  walk(path.join(projectRoot, 'src'));

  const attributes = [...counts.entries()]
    .map(([name, uses]) => ({ name, uses }))
    .sort((a, b) => b.uses - a.uses);
  const spacingClasses = [...utilityCounts.entries()]
    .map(([name, uses]) => ({ name, uses }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));

  return { attributes, sampled, ...(spacingClasses.length ? { spacingClasses } : {}) };
}

export function readStylingFacts(
  projectRoot: string,
  generatedFragment?: string,
  /** The configured design system, so its own shipped tokens can be read. */
  importPath?: string,
): StylingFacts {
  const projectFiles = styleFiles(projectRoot);
  const packageFiles = packageStyleFiles(projectRoot, importPath);
  const pkgRoot = importPath
    ? path.join(projectRoot, 'node_modules', ...(importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2)
        : [importPath.split('/')[0]]))
    : null;
  const declaredFiles = pkgRoot ? declaredStyleFiles(pkgRoot).length : 0;

  const tokens = readDesignTokens(projectRoot, importPath);
  const tokenCount = tokens.reduce((n, g) => n + g.names.length, 0);

  return {
    tokens,
    idiom: readStylingIdiom(projectRoot, generatedFragment),
    stylesheetFiles: [...projectFiles, ...packageFiles],
    sources: {
      projectFiles: projectFiles.length,
      packageFiles: packageFiles.length,
      declaredFiles,
      tokens: tokenCount,
      lookedAtNothing: projectFiles.length === 0 && packageFiles.length === 0,
    },
  };
}

/**
 * The prompt section that stops a generation inventing pixel values.
 *
 * Capped hard. A system with hundreds of colour tokens would otherwise crowd
 * out the component catalog, and the model does not need every token name to
 * stop writing `#0052CC` — it needs to know a scale exists and what it is
 * called.
 */
export function formatStylingGuidance(facts: StylingFacts, maxPerGroup = 24): string {
  const { tokens, idiom } = facts;
  if (tokens.length === 0 && idiom.attributes.length === 0) return '';

  const lines: string[] = ['🎨 THIS PROJECT\'S STYLING'];

  if (idiom.attributes.length) {
    const top = idiom.attributes.slice(0, 6);
    // `style` and `css` carry raw values by definition. On a small sample they
    // can out-count the real idiom — react-mantine's 9 stories ranked `style`
    // first — and recommending them would instruct the model to do the exact
    // thing this section exists to prevent.
    const dominant = top.find(a => !/^(style|css)$/.test(a.name));
    lines.push(
      '',
      `This team styles with ${top.map(a => `\`${a.name}\``).join(', ')} — counted from ${idiom.sampled} of their own stories.`,
    );
    if (dominant) {
      lines.push(`\`${dominant.name}\` is the house method (${dominant.uses} uses). Match it. Do not introduce a different styling mechanism.`);
    } else {
      // Only `style`/`css` were seen, which happens on a thin sample. Naming
      // one as the house method would instruct the model to write raw values —
      // the exact habit this section exists to break. Carbon's single seed
      // story produced precisely this case.
      lines.push('No house styling prop is evident from the sample. Prefer the design system\'s own layout and spacing components over inline style.');
    }
  }

  if (tokens.length) {
    lines.push('', 'Design tokens available in this project:');
    let tiered = false;
    for (const group of tokens) {
      if (group.category === 'other') continue;
      /**
       * Semantic before primitive, for colours.
       *
       * A token whose value is `var(--other)` is an alias — the name says
       * what the colour is FOR, and only that tier is redeclared under a
       * dark theme. Twelve of 22 Sail Shelf stories painted surfaces with
       * `--ss-navy-50` while `--ss-color-background-brand-subtle` pointed at
       * it; listed alphabetically the primitives came first and filled the
       * cap. The tier is read from the value, not from any naming scheme.
       */
      const isAlias = (n: string) => /^var\(/.test((group.values?.[n] || '').trim());
      const ordered = group.category === 'color'
        ? [...group.names.filter(isAlias), ...group.names.filter(n => !isAlias(n))]
        : group.names;
      const semanticCount = group.category === 'color' ? group.names.filter(isAlias).length : 0;
      const shown = ordered.slice(0, maxPerGroup);
      const more = ordered.length - shown.length;
      // Scale tokens carry their value: `--font-size-1 (72px)` says which end
      // of the scale it is; a colour's hex says nothing the name does not.
      const withValue = (n: string) => {
        const v = group.category !== 'color' ? group.values?.[n] : undefined;
        return v && v.length <= 24 && !/^var\(/.test(v) ? `--${n} (${v})` : `--${n}`;
      };
      if (semanticCount > 0 && semanticCount < group.names.length) {
        tiered = true;
        const semantic = shown.filter(isAlias);
        const primitive = shown.filter(n => !isAlias(n));
        lines.push(`- ${group.category} (semantic — use these): ${semantic.map(withValue).join(', ')}${semanticCount > semantic.length ? `, …${semanticCount - semantic.length} more` : ''}`);
        if (primitive.length) lines.push(`- ${group.category} (primitive — only where no semantic token names the intent): ${primitive.map(withValue).join(', ')}${more > 0 ? `, …${more} more` : ''}`);
      } else {
        lines.push(`- ${group.category}: ${shown.map(withValue).join(', ')}${more > 0 ? `, …${more} more` : ''}`);
      }
    }
    if (tiered) {
      lines.push(
        'A semantic token is an alias (its value is var(--primitive)); it is the tier that follows',
        'the theme. A primitive is one mode only: where a semantic token points at it, use the',
        'semantic one. Validation reports a primitive used where its alias exists.',
      );
    }
  }

  if (tokens.length) {
    lines.push(
      '',
      'Only the tokens listed above exist. A var(--name) that is not in this list',
      'resolves to nothing in the browser and is rejected by validation — do not',
      'invent a token by analogy with another system\'s naming.',
    );
  }

  lines.push(
    '',
    'NEVER write a raw pixel value or hex colour for spacing, colour, radius or',
    'shadow. Components carry their own styling; the values you would invent go',
    'in the space BETWEEN them — page padding, grid gaps, section backgrounds,',
    'max-widths — and that is exactly where a hardcoded number marks a',
    'composition as foreign to this design system. Use the token or the scale',
    'above. If no token fits, prefer a component that already handles the',
    'spacing over inventing a number.',
  );

  return lines.join('\n');
}
