/**
 * Learn the design system from the Storybook it lives in.
 *
 * The catalog the model receives today is 237 names scraped from a package's
 * exports — the first of which is `RemoveScroll`, a Mantine internal nobody
 * should compose with. 88 carry a description no better than "X component",
 * 6 have props, and none has a usage example. A model asked to build a CRM
 * dashboard from that is guessing, and it guesses toward primitives: Card and
 * Grid and a hand-rolled table, when the library ships a DataTable.
 *
 * Meanwhile the answer is already in the room. A Storybook contains the team's
 * OWN stories for their OWN components: the exact import, the real prop values,
 * the compound usage (`Card.Section`), and the idiom they actually write. That
 * is a better specification of a design system than any list we could ship,
 * and it has the property that matters most here — it is not specific to any
 * library. Mantine, Chakra, Ant, or something homegrown last week: if it has a
 * Storybook, it has this.
 *
 * Two signals are extracted:
 *
 *   VOCABULARY  Which components does the team have stories for? That is a
 *               curated list of what they intend to be used, and it excludes
 *               the internals that package-export scraping drags in.
 *
 *   IDIOM       How does the team actually write them? Real code beats a prop
 *               table, because it carries composition, defaults and convention
 *               all at once.
 *
 * Generated stories are excluded on purpose. Learning from our own output would
 * compound our own mistakes — the model would imitate last week's error and
 * call it house style.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';

export interface StorybookComponent {
  /** Component name as the Storybook titles it, e.g. "Card". */
  name: string;
  /** Full story title path, e.g. "Mantine/Card". */
  title: string;
  /** Story file, relative to the project root. */
  importPath: string;
  /** Named exports in that file — the variants the team documents. */
  storyNames: string[];
}

export interface CatalogOptions {
  storybookUrl: string;
  projectRoot: string;
  /** Title prefixes to ignore. Generated work and our own panel are not the DS. */
  excludePrefixes?: string[];
  timeoutMs?: number;
}

const DEFAULT_EXCLUDES = ['Generated/', 'Story UI/', 'Story UI'];

/**
 * Enumerate the components the team has stories for.
 *
 * Returns [] rather than throwing when Storybook is unreachable: this is an
 * enhancement to prompt quality, and a generation must still work without it.
 */
export async function fetchStorybookCatalog(
  options: CatalogOptions,
): Promise<StorybookComponent[]> {
  const { storybookUrl, excludePrefixes = DEFAULT_EXCLUDES, timeoutMs = 5000 } = options;
  const base = storybookUrl.replace(/\/+$/, '');

  let entries: Record<string, any>;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${base}/index.json`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    entries = (await res.json())?.entries ?? {};
  } catch {
    return [];
  }

  const byTitle = new Map<string, StorybookComponent>();

  for (const entry of Object.values<any>(entries)) {
    const title: string = entry?.title ?? '';
    if (!title || excludePrefixes.some(p => title.startsWith(p))) continue;
    if (!entry.importPath) continue;

    const name = title.split('/').filter(Boolean).pop() || title;
    const existing = byTitle.get(title);
    if (existing) {
      // Docs entries carry no story name; only real stories are variants.
      if (entry.type === 'story' && entry.name) existing.storyNames.push(entry.name);
      continue;
    }
    byTitle.set(title, {
      name,
      title,
      importPath: entry.importPath,
      storyNames: entry.type === 'story' && entry.name ? [entry.name] : [],
    });
  }

  return [...byTitle.values()];
}

/** Strip a leading `./` and resolve inside the project, refusing escapes. */
function resolveInProject(projectRoot: string, importPath: string): string | null {
  const rel = importPath.replace(/^\.\//, '');
  const full = path.resolve(projectRoot, rel);
  if (!full.startsWith(path.resolve(projectRoot) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

/**
 * The team's own code for a component, trimmed to what teaches idiom.
 *
 * Imports are kept because they are the single most load-bearing line — they
 * tell the model the exact specifier and named exports, which is precisely what
 * it gets wrong when guessing from a bare component list. Everything else is
 * capped so one verbose story cannot crowd out the rest of the catalog.
 */
export function readComponentExample(
  projectRoot: string,
  importPath: string,
  maxChars = 1400,
): string | null {
  const full = resolveInProject(projectRoot, importPath);
  if (!full) return null;

  let source: string;
  try {
    source = fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }

  const lines = source.split('\n');
  const imports = lines.filter(l => /^\s*import\s/.test(l));

  // The first render/JSX-bearing export is the canonical example; later ones are
  // usually variations on it and buy less per token.
  const firstStory = source.search(/export const \w+\s*:\s*Story\s*=|export const \w+\s*=\s*{/);
  const body = firstStory >= 0 ? source.slice(firstStory) : source;

  const example = [...imports, '', body].join('\n');
  if (example.length <= maxChars) return example.trim();

  // Cut at a line boundary so the model never sees a severed JSX tag.
  const cut = example.slice(0, maxChars);
  const lastNewline = cut.lastIndexOf('\n');
  return `${cut.slice(0, lastNewline > 0 ? lastNewline : maxChars)}\n// … truncated`;
}

/**
 * Rank components by how much they look like what the user asked for.
 *
 * Deliberately lexical rather than embedding-based: it needs no model call, no
 * index to maintain and no network, and the signal here is unusually strong
 * because design system names ARE the domain vocabulary — someone asking for a
 * "pricing table with tiers" is asking for Table, Card, Badge and Button by
 * name. An embedding pass can replace this later if measurement says it needs
 * to; the point now is to stop sending everything.
 */
export function rankByRelevance(
  components: StorybookComponent[],
  prompt: string,
  limit: number,
): StorybookComponent[] {
  const words = new Set(
    prompt.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2),
  );

  const scored = components.map(c => {
    const name = c.name.toLowerCase();
    let score = 0;

    // Direct mention is the strongest possible signal.
    if (words.has(name)) score += 10;
    // Singular/plural and compound mentions ("cards", "datatable").
    for (const w of words) {
      if (w === name) continue;
      if (w.startsWith(name) || name.startsWith(w)) score += 4;
      else if (w.includes(name) || name.includes(w)) score += 2;
    }
    // A documented variant that matches ("Loading", "WithImage", "Compact").
    for (const s of c.storyNames) {
      const sn = s.toLowerCase();
      if ([...words].some(w => sn.includes(w))) score += 1;
    }
    // More documented variants means better-understood usage, so break ties
    // toward the components the team has actually invested in explaining.
    score += Math.min(c.storyNames.length, 3) * 0.1;

    return { c, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.c);
}

/**
 * Build the prompt section that teaches the model this team's idiom.
 *
 * Budgeted in characters rather than by count, because one component with three
 * long stories should not silently displace six others.
 */
export function formatCatalogForPrompt(
  components: StorybookComponent[],
  projectRoot: string,
  options: { maxExamples?: number; maxChars?: number } = {},
): string {
  const { maxExamples = 6, maxChars = 9000 } = options;
  if (components.length === 0) return '';

  const lines: string[] = [
    '📚 HOW THIS TEAM USES THEIR DESIGN SYSTEM',
    '',
    'These are the components documented in THIS project\'s Storybook, with the',
    'team\'s own code. This is the house style: match these imports, prop names,',
    'and composition patterns exactly. Prefer a component that appears here over',
    'one you recall from the library\'s public documentation, and prefer it over',
    'assembling the same thing yourself out of primitives.',
    '',
    `Documented components: ${components.map(c => c.name).join(', ')}`,
    '',
  ];

  let used = lines.join('\n').length;
  let shown = 0;

  for (const c of components) {
    if (shown >= maxExamples || used >= maxChars) break;
    const example = readComponentExample(projectRoot, c.importPath);
    if (!example) continue;
    const block = `### ${c.name}${c.storyNames.length ? ` — documented variants: ${c.storyNames.join(', ')}` : ''}\n\`\`\`tsx\n${example}\n\`\`\`\n`;
    if (used + block.length > maxChars) break;
    lines.push(block);
    used += block.length;
    shown += 1;
  }

  if (shown === 0) return '';
  logger.log(`📚 Injecting ${shown} Storybook usage example(s) from this project`);
  return lines.join('\n');
}
