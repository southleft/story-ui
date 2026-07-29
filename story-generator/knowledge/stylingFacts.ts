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
}

export interface StylingIdiom {
  /** Styling attributes the team uses, most-used first. */
  attributes: Array<{ name: string; uses: number }>;
  /** Files sampled, so a caller can judge how much to trust it. */
  sampled: number;
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
}

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
function categorise(name: string): string {
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
  const segments = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[-_.]/);
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
  if (has(/^(color|colour|bg|background|fill|stroke|border|ring|accent|primary|secondary|muted|destructive|success|warning|info|danger|error|foreground|layer|support|interactive)$/)) return 'color';
  if (has(/^(space|spacing|gap|inset|margin|padding)$/)) return 'spacing';
  if (has(/^(shadow|elevation)$/)) return 'shadow';
  if (has(/^(font|leading|tracking|weight|type|typography|heading|body|label)$/)) return 'typography';
  if (has(/^(breakpoint|screen|container|grid)$/)) return 'layout';
  if (has(/^(text|icon|link)$/)) return 'color';
  if (has(/^(size|width|height)$/)) return 'spacing';
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
    for (const m of css.matchAll(/--([a-zA-Z][\w-]*)\s*:/g)) {
      const name = m[1];
      const category = categorise(name);
      if (!byCategory.has(category)) byCategory.set(category, new Set());
      byCategory.get(category)!.add(name);
    }
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
    .map(([category, names]) => ({
      category,
      names: [...names].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)),
    }))
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
    }
  };
  walk(path.join(projectRoot, 'src'));

  const attributes = [...counts.entries()]
    .map(([name, uses]) => ({ name, uses }))
    .sort((a, b) => b.uses - a.uses);

  return { attributes, sampled };
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
    for (const group of tokens) {
      if (group.category === 'other') continue;
      const shown = group.names.slice(0, maxPerGroup);
      const more = group.names.length - shown.length;
      lines.push(`- ${group.category}: ${shown.map(n => `--${n}`).join(', ')}${more > 0 ? `, …${more} more` : ''}`);
    }
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
