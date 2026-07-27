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

export interface StylingFacts {
  tokens: TokenGroup[];
  idiom: StylingIdiom;
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
  const segments = name.toLowerCase().split(/[-_.]/);
  const has = (re: RegExp) => segments.some(s => re.test(s));
  // Order matters: `text` reads as typography on its own but as a colour role
  // in `text-primary`, which is how every token system in this list uses it.
  if (has(/^(color|colour|bg|background|fill|stroke|border|ring|accent|primary|secondary|muted|destructive|success|warning|info|danger|error|foreground|layer|support|interactive)$/)) return 'color';
  if (has(/^(radius|rounded|corner)$/)) return 'radius';
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
function packageStyleFiles(projectRoot: string, importPath?: string, limit = 6): string[] {
  if (!importPath) return [];
  const pkgName = importPath.startsWith('@')
    ? importPath.split('/').slice(0, 2).join('/')
    : importPath.split('/')[0];

  const out: string[] = [];
  // The component package and its styles sibling: Carbon splits them
  // (@carbon/react + @carbon/styles), Mantine and MUI do not.
  const scope = pkgName.startsWith('@') ? pkgName.split('/')[0] : null;
  const roots = [path.join(projectRoot, 'node_modules', ...pkgName.split('/'))];
  if (scope) {
    for (const sibling of ['styles', 'themes', 'core', 'tokens']) {
      roots.push(path.join(projectRoot, 'node_modules', scope, sibling));
    }
  }

  for (const root of roots) {
    if (out.length >= limit || !fs.existsSync(root)) continue;
    // Prefer conventional locations over a full walk of a published package.
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
    for (const m of css.matchAll(/^\s*--([a-zA-Z][\w-]*)\s*:/gm)) {
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
  return {
    tokens: readDesignTokens(projectRoot, importPath),
    idiom: readStylingIdiom(projectRoot, generatedFragment),
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
