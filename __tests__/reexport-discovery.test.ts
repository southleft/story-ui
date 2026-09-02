/**
 * Components a package re-exports from a default.
 *
 * `@atlaskit/primitives` writes both forms side by side:
 *
 *   export { default as Box } from './components/box';
 *   export { Grid } from './components/grid';
 *
 * A pattern requiring the braced list to BEGIN with a capital letter found
 * Grid and Bleed and missed Box, Inline, Stack, Flex, Text, Pressable and
 * MetricText — the design system's entire layout primitive set. Nothing
 * errored; the components simply were not there, and a catalog missing a third
 * of a library looks exactly like a catalog. Atlassian compositions then had
 * nothing to lay out with and fell back to raw pixel values.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDynamicDiscovery } from '../story-generator/dynamicPackageDiscovery.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

/** A package that ships type declarations and nothing importable at runtime. */
function fakePackage(name: string, declaration: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-reexport-'));
  roots.push(root);
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(path.join(dir, 'dist', 'types'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name, version: '1.0.0', types: 'dist/types/index.d.ts',
  }));
  fs.writeFileSync(path.join(dir, 'dist', 'types', 'index.d.ts'), declaration);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  return root;
}

const PRIMITIVES = `
export { default as Box } from './components/box';
export type { BoxProps } from './components/box';
export { default as Inline } from './components/inline';
export { default as Stack } from './components/stack';
export { Grid } from './components/grid';
export { Bleed } from './components/bleed';
export { xcss } from './xcss/xcss';
export { default } from './components/legacy';
`;

describe('braced re-export discovery', () => {
  it('finds components re-exported from a default', async () => {
    const root = fakePackage('@fixture/primitives', PRIMITIVES);
    const names = await createDynamicDiscovery('@fixture/primitives', root).getAvailableComponentNames();
    expect(names).toEqual(expect.arrayContaining(['Box', 'Inline', 'Stack']));
  });

  it('still finds plain named re-exports', async () => {
    // These were the only two that ever worked. They must keep working.
    const root = fakePackage('@fixture/primitives2', PRIMITIVES);
    const names = await createDynamicDiscovery('@fixture/primitives2', root).getAvailableComponentNames();
    expect(names).toEqual(expect.arrayContaining(['Grid', 'Bleed']));
  });

  it('takes the alias, which is the name a consumer imports', async () => {
    // `export { X as Y }` means `import { Y }`. The local name may not be
    // importable at all.
    const root = fakePackage('@fixture/aliased', "export { InternalButton as Button } from './internal';");
    const names = await createDynamicDiscovery('@fixture/aliased', root).getAvailableComponentNames();
    expect(names).toContain('Button');
    expect(names).not.toContain('InternalButton');
  });

  it('never registers a name containing whitespace', async () => {
    // The old pattern captured `Foo as Bar` as one string and registered a
    // component by that literal name — unimportable, and noise in the catalog.
    const root = fakePackage('@fixture/garbage', "export { Foo as Bar } from './x';");
    const names = await createDynamicDiscovery('@fixture/garbage', root).getAvailableComponentNames();
    expect(names.filter(n => /\s/.test(n))).toEqual([]);
  });

  it('ignores a bare default and lowercase utilities', async () => {
    // `export { default }` exposes no importable NAME, and `xcss` is a helper
    // function — neither is a component.
    const root = fakePackage('@fixture/mixed', PRIMITIVES);
    const names = await createDynamicDiscovery('@fixture/mixed', root).getAvailableComponentNames();
    expect(names).not.toContain('default');
    expect(names).not.toContain('xcss');
  });
});
