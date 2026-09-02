/**
 * Where this project keeps its stories, according to the project.
 *
 * `.storybook/main.ts` states it in `stories`, and that file is on disk whether
 * or not a dev server is running. Discovery previously learned component
 * directories two ways, and both had a hole:
 *
 *   - a hardcoded list of eight conventional folder names, which misses any
 *     design system in `src/design-system`, `src/kit`, `packages/ui`…
 *   - the live Storybook index, which is authoritative but requires a running
 *     server. On a CLI run, in CI, or at cold start there is none, so the
 *     hardcoded list was the only source.
 *
 * Reading the config closes that hole without a server. It is parsed textually
 * rather than imported: main.ts is TypeScript that may import plugins, and
 * evaluating a project's build config to answer a question about paths would
 * execute arbitrary code for no benefit.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';

const CONFIG_FILES = ['main.ts', 'main.js', 'main.mts', 'main.mjs', 'main.cjs'];

/** Locate `.storybook/main.*`, honouring a non-default config directory. */
export function findStorybookConfig(projectRoot: string): string | null {
  const dirs = ['.storybook', 'storybook', '.config/storybook'];
  for (const dir of dirs) {
    for (const file of CONFIG_FILES) {
      const full = path.join(projectRoot, dir, file);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

/**
 * The `stories` globs, as written.
 *
 * Handles both array literals and the object form
 * (`{ directory, files }`), which large monorepos use.
 */
export function readStoryGlobs(configFile: string): string[] {
  let source: string;
  try {
    source = fs.readFileSync(configFile, 'utf8');
  } catch {
    return [];
  }

  // Line comments only. Stripping BLOCK comments here corrupts the data being
  // read: `/**/` is a valid empty block comment, so `../src/**/*.stories.tsx`
  // became `../src*.stories.tsx`. That still happened to yield the right
  // directory, which is precisely how it would have survived unnoticed.
  //
  // A line comment is the way a glob actually gets disabled in practice, and
  // removing those is safe because a glob never contains `//`.
  const cleaned = source.replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  // The key may be quoted: a JSON-shaped main.ts writes `"stories": [...]`,
  // which an unquoted-only pattern silently misses — and silently returning no
  // globs looks identical to a project that declares none.
  const match = cleaned.match(/['"]?\bstories['"]?\s*:\s*\[([\s\S]*?)\]/);
  if (!match) return [];

  const globs: string[] = [];
  for (const m of match[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
    globs.push(m[1]);
  }

  // Object form: { directory: '../src', files: '**/*.stories.*' }
  for (const m of match[1].matchAll(/directory\s*:\s*['"`]([^'"`]+)['"`]/g)) {
    if (!globs.includes(m[1])) globs.push(m[1]);
  }

  return globs;
}

/**
 * Turn globs into concrete directories that exist.
 *
 * Everything from the first wildcard onward is dropped: `../src/**\/*.stories.tsx`
 * yields `src`. That is deliberately coarse — the aim is to tell discovery
 * which trees to walk, and walking one directory too wide costs a little time,
 * while missing one costs the user their entire design system.
 */
export function storyDirectoriesFrom(projectRoot: string, globs: string[]): string[] {
  const dirs = new Set<string>();

  for (const glob of globs) {
    const firstWildcard = glob.search(/[*?[{]/);
    const literal = firstWildcard === -1 ? path.dirname(glob) : glob.slice(0, firstWildcard);
    // Globs in main.ts are written relative to the .storybook directory.
    const resolved = path.resolve(projectRoot, '.storybook', literal);
    if (!resolved.startsWith(path.resolve(projectRoot))) continue; // never escape the project
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      dirs.add(resolved);
    }
  }

  return [...dirs];
}

/**
 * Component directories declared by this project's Storybook config.
 *
 * Returns [] when there is no config or it declares nothing usable — discovery
 * still has its other sources, and this only ever widens the search.
 */
export function componentDirsFromStorybookConfig(projectRoot: string): string[] {
  const config = findStorybookConfig(projectRoot);
  if (!config) return [];

  const globs = readStoryGlobs(config);
  if (globs.length === 0) return [];

  const dirs = storyDirectoriesFrom(projectRoot, globs);
  if (dirs.length) {
    logger.log(`📖 ${path.relative(projectRoot, config)} declares stories under: ${dirs.map(d => path.relative(projectRoot, d)).join(', ')}`);
  }
  return dirs;
}
