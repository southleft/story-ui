/**
 * Reading where a project keeps its stories, from its own Storybook config.
 *
 * Discovery previously learned component directories from a hardcoded list of
 * eight conventional folder names, or from a live Storybook index. The first
 * misses any design system in an unguessed directory; the second needs a
 * running server, which a CLI run, a CI job, and a first-time adopter all lack.
 * `.storybook/main.ts` states the answer and sits on disk either way.
 *
 * Pinned here because the failure is silent: returning no globs is
 * indistinguishable from a project that declares none, and the result is an
 * empty catalog rather than an error.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readStoryGlobs, storyDirectoriesFrom, findStorybookConfig } from '../story-generator/knowledge/storybookConfig.js';

let root: string;

const write = (rel: string, contents: string) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readStoryGlobs', () => {
  it('reads an unquoted key', () => {
    const f = write('.storybook/main.ts',
      `const config = { stories: ['../src/**/*.stories.tsx'], addons: [] };\nexport default config;`);
    expect(readStoryGlobs(f)).toEqual(['../src/**/*.stories.tsx']);
  });

  it('reads a QUOTED key', () => {
    // A JSON-shaped main.ts writes `"stories":`. An unquoted-only pattern
    // matched nothing here and reported the project as declaring no stories —
    // which is how a design system in src/housekit stayed invisible on a cold
    // run even after the rest of this work was in place.
    const f = write('quoted/.storybook/main.ts',
      `const config = {\n  "stories": [\n    "../src/**/*.mdx",\n    "../src/**/*.stories.@(js|jsx|ts|tsx)"\n  ]\n};\nexport default config;`);
    expect(readStoryGlobs(f)).toEqual([
      '../src/**/*.mdx',
      '../src/**/*.stories.@(js|jsx|ts|tsx)',
    ]);
  });

  it('reads the object form used by monorepos', () => {
    const f = write('objform/.storybook/main.ts',
      `export default { stories: [{ directory: '../packages/ui/src', files: '**/*.stories.tsx' }] };`);
    expect(readStoryGlobs(f)).toContain('../packages/ui/src');
  });

  it('ignores a commented-out glob', () => {
    // Otherwise a directory someone deliberately stopped indexing comes back.
    const f = write('commented/.storybook/main.ts',
      `export default { stories: [\n  // '../legacy/**/*.stories.tsx',\n  '../src/**/*.stories.tsx',\n] };`);
    expect(readStoryGlobs(f)).toEqual(['../src/**/*.stories.tsx']);
  });

  it('returns nothing rather than throwing on an unreadable config', () => {
    expect(readStoryGlobs(path.join(root, 'does-not-exist/main.ts'))).toEqual([]);
  });
});

describe('storyDirectoriesFrom', () => {
  it('truncates a glob at its first wildcard and resolves against .storybook', () => {
    fs.mkdirSync(path.join(root, 'src', 'housekit'), { recursive: true });
    const dirs = storyDirectoriesFrom(root, ['../src/**/*.stories.tsx']);
    expect(dirs).toEqual([path.join(root, 'src')]);
  });

  it('skips directories that do not exist', () => {
    expect(storyDirectoriesFrom(root, ['../nowhere/**/*.stories.tsx'])).toEqual([]);
  });

  it('refuses to escape the project', () => {
    // A glob reaching outside the repo would put someone else's source into
    // the catalog, and from there into a generated story.
    expect(storyDirectoriesFrom(root, ['../../../../etc/**/*.stories.tsx'])).toEqual([]);
  });
});

describe('findStorybookConfig', () => {
  it('finds main.ts in .storybook', () => {
    expect(findStorybookConfig(root)).toBe(path.join(root, '.storybook', 'main.ts'));
  });

  it('returns null when a project has no Storybook config', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-sb-'));
    expect(findStorybookConfig(empty)).toBeNull();
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
