/**
 * The workspace has to be reachable after `init`, not merely installed.
 *
 * V2 renders through an MDX docs page — that is how the surface stays React in
 * a Vue, Angular or Svelte project. If Storybook's `stories` glob does not
 * match `.mdx`, the file installs correctly and the workspace simply never
 * appears in the sidebar. Nothing errors. Observed on a Carbon project, where
 * it was silently absent until the glob was widened by hand.
 *
 * The check that missed it asked whether the config mentioned `src/stories`,
 * which a `.stories.tsx`-only glob satisfies while matching no MDX at all.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { storiesGlobCoversMdx, ensureStoriesGlobCoversMdx, missingReactStorybookDep, hostStorybookMajor } from '../cli/setup.js';

const config = (glob: string) => `export default { stories: ['${glob}'], addons: [] };`;

describe('stories glob must reach the MDX workspace', () => {
  it('recognises an explicit .mdx glob', () => {
    expect(storiesGlobCoversMdx(config('../src/**/*.mdx'))).toBe(true);
  });

  it('recognises the @(mdx|stories...) spelling Storybook scaffolds', () => {
    expect(storiesGlobCoversMdx(config('../src/stories/**/*.@(mdx|stories.@(js|tsx))'))).toBe(true);
  });

  it('rejects a stories-only glob even though it names src/stories', () => {
    // The exact shape that passed the old substring check and matched no MDX.
    const content = config('../src/stories/**/*.stories.tsx');
    expect(content.includes('src/stories')).toBe(true);
    expect(storiesGlobCoversMdx(content)).toBe(false);
  });

  it('rejects the default Storybook TS glob', () => {
    // Carbon's actual config before this was fixed.
    expect(storiesGlobCoversMdx(config('../src/**/*.stories.@(ts|tsx)'))).toBe(false);
  });

  it('does not mistake an mdx-named story file for glob coverage', () => {
    // A project can contain the word "mdx" in an addon name without the glob
    // matching MDX. Being wrong in this direction hides the failure again.
    const content = `export default { stories: ['../src/**/*.stories.tsx'], addons: ['@storybook/addon-docs'] };`;
    expect(storiesGlobCoversMdx(content)).toBe(false);
  });
});

/** A throwaway project with a .storybook/main.ts declaring the given glob. */
function scaffold(glob?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-glob-'));
  if (glob !== undefined) {
    fs.mkdirSync(path.join(root, '.storybook'), { recursive: true });
    fs.writeFileSync(path.join(root, '.storybook', 'main.ts'), config(glob));
  }
  return root;
}

describe('ensureStoriesGlobCoversMdx derives the glob from the real stories dir', () => {
  it('appends a glob rooted at a CUSTOM stories dir, not a hardcoded src/stories', () => {
    const root = scaffold('../src/**/*.stories.tsx');
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'custom', 'stories'), root);

    expect(result.checked).toBe(true);
    expect(result.covered).toBe(true);
    expect(result.added).toBe(`'../custom/stories/**/*.@(mdx|stories.@(js|jsx|ts|tsx))'`);
    const written = fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8');
    expect(written).toContain('../custom/stories/**/*.@(mdx');
  });

  it('appends the conventional glob for the default stories dir', () => {
    const root = scaffold('../src/**/*.stories.@(ts|tsx)');
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result.added).toBe(`'../src/stories/**/*.@(mdx|stories.@(js|jsx|ts|tsx))'`);
  });

  it('leaves a config alone when the stories dir is already covered', () => {
    const root = scaffold('../src/stories/**/*.@(mdx|stories.@(js|tsx))');
    const before = fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8');

    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result).toEqual({ checked: true, covered: true, added: null });
    expect(fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8')).toBe(before);
  });

  it('reports UNCHECKED — distinct from covered — when no .storybook/main exists', () => {
    // A check that cannot run must not look like a check that passed.
    const root = scaffold();
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result.checked).toBe(false);
    expect(result.covered).toBe(false);
  });

  it('reports checked-but-uncovered when no stories array can be found', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-glob-'));
    fs.mkdirSync(path.join(root, '.storybook'), { recursive: true });
    fs.writeFileSync(path.join(root, '.storybook', 'main.ts'), 'export default { addons: [] };');

    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result).toEqual({ checked: true, covered: false, added: null });
  });
});

/** A throwaway project whose .storybook/main.ts is exactly `content`. */
function scaffoldRaw(content: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-glob-'));
  fs.mkdirSync(path.join(root, '.storybook'), { recursive: true });
  fs.writeFileSync(path.join(root, '.storybook', 'main.ts'), content);
  return root;
}

describe('ensureStoriesGlobCoversMdx splices the array without corrupting it', () => {
  // The previous implementation spliced with a regex that terminated at the
  // FIRST `]` — severing any glob with a character class mid-string and
  // turning an empty `stories: []` into a sparse array. These pin the scanner
  // that walks to the MATCHING bracket, skipping string literals.

  it('leaves a character-class glob intact and appends after it', () => {
    const root = scaffoldRaw(`export default { stories: ['../src/**/*.stories.[tj]sx'], addons: [] };`);
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result.covered).toBe(true);
    expect(fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8')).toBe(
      `export default { stories: ['../src/**/*.stories.[tj]sx',\n    ${result.added}\n  ], addons: [] };`
    );
  });

  it('fills an empty stories array without a sparse leading comma', () => {
    const root = scaffoldRaw(`export default { stories: [], addons: [] };`);
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result.covered).toBe(true);
    expect(fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8')).toBe(
      `export default { stories: [\n    ${result.added}\n  ], addons: [] };`
    );
  });

  it('leaves nested objects and arrays inside the stories array untouched', () => {
    const entry = `{ directory: '../src', files: '**/*.stories.@(ts|tsx)', titlePrefix: ['Nested'] }`;
    const root = scaffoldRaw(`export default { stories: [${entry}], addons: [] };`);
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result.covered).toBe(true);
    expect(fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8')).toBe(
      `export default { stories: [${entry},\n    ${result.added}\n  ], addons: [] };`
    );
  });

  it('skips a string containing a bare ] rather than closing the array on it', () => {
    const root = scaffoldRaw(`export default { stories: ['../weird]dir/**/*.stories.tsx'], addons: [] };`);
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result.covered).toBe(true);
    expect(fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8')).toBe(
      `export default { stories: ['../weird]dir/**/*.stories.tsx',\n    ${result.added}\n  ], addons: [] };`
    );
  });

  it('does not double the comma when the last entry already has a trailing one', () => {
    const root = scaffoldRaw(`export default { stories: ['../src/**/*.stories.tsx',], addons: [] };`);
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src', 'stories'), root);

    expect(result.covered).toBe(true);
    const written = fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8');
    expect(written).not.toContain(',,');
    expect(written).toBe(
      `export default { stories: ['../src/**/*.stories.tsx',\n    ${result.added}\n  ], addons: [] };`
    );
  });
});

describe('missingReactStorybookDep pins @storybook/react for React + pnpm hosts', () => {
  // '@storybook/react' is an OPTIONAL peer (non-React hosts must not pull in
  // React's renderer), and pnpm's auto-install-peers skips optional peers —
  // so a React host can end up unable to resolve the type import every
  // generated story begins with.

  function project(pkg: Record<string, unknown>, installed?: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-deps-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'host', ...pkg }));
    for (const [name, version] of Object.entries(installed ?? {})) {
      const dir = path.join(root, 'node_modules', ...name.split('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'index.js'), '');
    }
    return root;
  }

  it('is null for non-React hosts — they must not pull in the React renderer', () => {
    const root = project({ devDependencies: { storybook: '^9.0.0' } });
    expect(missingReactStorybookDep(root, {}, 'vue')).toBeNull();
  });

  it('is null when @storybook/react is already declared', () => {
    const root = project({});
    expect(missingReactStorybookDep(root, { '@storybook/react': '^9.0.0' }, 'react')).toBeNull();
  });

  it('is null when @storybook/react resolves even though undeclared (npm hoisting)', () => {
    const root = project({}, { '@storybook/react': '9.1.0' });
    expect(missingReactStorybookDep(root, {}, 'react')).toBeNull();
  });

  it('pins to the INSTALLED storybook major when the package is missing', () => {
    const root = project(
      { devDependencies: { storybook: '^9.0.0' } },
      { storybook: '10.2.1' } // installed version wins over the declared range
    );
    expect(missingReactStorybookDep(root, {}, 'react')).toEqual({ name: '@storybook/react', range: '^10.0.0' });
    expect(hostStorybookMajor(root)).toBe(10);
  });

  it('falls back to the declared storybook range when nothing is installed', () => {
    const root = project({ devDependencies: { storybook: '^9.0.0' } });
    expect(missingReactStorybookDep(root, {}, 'react')).toEqual({ name: '@storybook/react', range: '^9.0.0' });
  });

  it('defaults to major 9 when no Storybook dependency is discoverable at all', () => {
    const root = project({});
    expect(missingReactStorybookDep(root, {}, 'react')).toEqual({ name: '@storybook/react', range: '^9.0.0' });
    expect(hostStorybookMajor(root)).toBeNull();
  });
});
