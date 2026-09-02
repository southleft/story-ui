/**
 * The props cache is keyed on the PACKAGE, not the specifier that asked.
 *
 * Discovery reports one "home" per component. For Vuetify that is
 * `vuetify/components/VBtn`, 126 times over; for MUI, `@mui/material/Button`.
 * Every one of those resolves to the same package directory and reads the
 * same declaration tree, and keying the record on the specifier meant each
 * missed the cache: 126 reads of ~1s, 193 identical records on disk, and a
 * first generation that spent 105s "reading your design system".
 *
 * A package-per-component system (Atlassian: `@atlaskit/button`,
 * `@atlaskit/avatar`) is the shape that must NOT collapse — each specifier
 * there already names a package, and each package is its own record.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractProps, extractPropsForPackages, knowledgeRootOf } from '../story-generator/knowledge/propExtractor.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-props-root-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  return root;
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function bumpMtime(file: string): void {
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
}

function propsRecords(root: string): string[] {
  try {
    return fs.readdirSync(path.join(root, '.story-ui', 'knowledge')).filter(f => f.endsWith('.props.json'));
  } catch {
    return [];
  }
}

const BUTTON = `
import * as React from 'react';
export interface ButtonProps { /** Visual weight. */ variant?: 'solid' | 'ghost' }
export declare const Button: React.FC<ButtonProps>;
`;
const CARD = `
import * as React from 'react';
export interface CardProps { /** Lift it off the page. */ elevated?: boolean }
export declare const Card: React.FC<CardProps>;
`;

/** One installed package with two components, each reachable by a subpath. */
function subpathPackage(root: string, name = 'kit'): string {
  const pkg = path.join(root, 'node_modules', ...name.split('/'));
  write(path.join(pkg, 'package.json'), JSON.stringify({ name, version: '2.0.0', types: 'index.d.ts' }));
  write(path.join(pkg, 'index.d.ts'), `export * from './Button';\nexport * from './Card';\n`);
  write(path.join(pkg, 'Button.d.ts'), BUTTON);
  write(path.join(pkg, 'Card.d.ts'), CARD);
  return pkg;
}

describe('knowledgeRootOf', () => {
  it('files a subpath under its package', () => {
    expect(knowledgeRootOf('vuetify/components/VBtn')).toBe('vuetify');
    expect(knowledgeRootOf('vuetify/components')).toBe('vuetify');
    expect(knowledgeRootOf('vuetify')).toBe('vuetify');
    expect(knowledgeRootOf('@mui/material/Button')).toBe('@mui/material');
    expect(knowledgeRootOf('@mui/material')).toBe('@mui/material');
  });

  it('keeps a package-per-component system one root per package', () => {
    expect(knowledgeRootOf('@atlaskit/button')).toBe('@atlaskit/button');
    expect(knowledgeRootOf('@atlaskit/button/new')).toBe('@atlaskit/button');
    expect(knowledgeRootOf('@atlaskit/avatar')).toBe('@atlaskit/avatar');
    // A bare scope, as Atlassian configures, is its own (scope-wide) root.
    expect(knowledgeRootOf('@atlaskit')).toBe('@atlaskit');
  });

  it('leaves a path alone: a directory is its own root', () => {
    expect(knowledgeRootOf('./src/components')).toBe('./src/components');
    expect(knowledgeRootOf('./src/components/button')).toBe('./src/components/button');
    expect(knowledgeRootOf('../packages/ui')).toBe('../packages/ui');
    expect(knowledgeRootOf('/abs/src/ui')).toBe('/abs/src/ui');
  });
});

describe('the props cache is per package root', () => {
  it('reads a package once however many subpath homes name it', async () => {
    const root = scratch();
    subpathPackage(root);

    // What discovery hands generationCore: the configured path plus one home per component.
    const homes = ['kit/components', 'kit/components/Button', 'kit/components/Card'];
    const merged = await extractPropsForPackages(homes, root);
    expect(Object.keys(merged?.components ?? {}).sort()).toEqual(['Button', 'Card']);

    const records = propsRecords(root);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatch(/^kit@2\.0\.0\.[0-9a-f]{12}\.props\.json$/);
  });

  it('serves a subpath home from the package record', async () => {
    const root = scratch();
    subpathPackage(root);

    const viaPackage = await extractProps('kit', root);
    const viaSubpath = await extractProps('kit/components/Card', root);
    expect(viaSubpath?.components.Card.props.map(p => p.name)).toEqual(['elevated']);
    // The same record, not a second read: the timestamp is the package's.
    expect(viaSubpath?.extractedAt).toBe(viaPackage?.extractedAt);
    // And the record names the package, not whichever specifier wrote it.
    expect(viaSubpath?.importPath).toBe('kit');
    expect(propsRecords(root)).toHaveLength(1);
  });

  it('does the same for a scoped package', async () => {
    const root = scratch();
    subpathPackage(root, '@ui/material');

    await extractPropsForPackages(['@ui/material', '@ui/material/Button', '@ui/material/Card'], root);
    const records = propsRecords(root);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatch(/^-ui-material@2\.0\.0\./);
  });

  it('keeps one record per package when every component is its own package', async () => {
    const root = scratch();
    for (const [name, body] of [['@fx/button', BUTTON], ['@fx/card', CARD]] as const) {
      const pkg = path.join(root, 'node_modules', ...name.split('/'));
      write(path.join(pkg, 'package.json'), JSON.stringify({ name, version: '1.0.0', types: 'index.d.ts' }));
      write(path.join(pkg, 'index.d.ts'), body);
    }

    const merged = await extractPropsForPackages(['@fx/button', '@fx/card'], root);
    expect(merged?.components.Button.props.map(p => p.name)).toEqual(['variant']);
    expect(merged?.components.Card.props.map(p => p.name)).toEqual(['elevated']);

    const records = propsRecords(root);
    expect(records.filter(f => f.startsWith('-fx-button@'))).toHaveLength(1);
    expect(records.filter(f => f.startsWith('-fx-card@'))).toHaveLength(1);
    expect(records).toHaveLength(2);
  });

  it('still notices a changed package when asked through a subpath', async () => {
    const root = scratch();
    const pkg = subpathPackage(root);

    const before = await extractProps('kit/components/Button', root);
    expect(before?.components.Button.props.map(p => p.name)).toEqual(['variant']);

    // Same version; the declarations entry changes, as an install rewrites it.
    write(path.join(pkg, 'Button.d.ts'), BUTTON.replace(`'ghost' }`, `'ghost'; /** Fill the row. */ fullWidth?: boolean }`));
    write(path.join(pkg, 'index.d.ts'), `export * from './Button';\nexport * from './Card';\n// v2\n`);
    bumpMtime(path.join(pkg, 'index.d.ts'));

    const after = await extractProps('kit/components/Button', root); // NOT forced
    expect(after?.components.Button.props.map(p => p.name)).toEqual(['variant', 'fullWidth']);
    // The stale record was pruned under the package's name, not the specifier's.
    expect(propsRecords(root)).toHaveLength(1);
  });
});

describe('records an earlier extractor filed per subpath', () => {
  it('are removed on the first read that files the package once', async () => {
    const root = scratch();
    subpathPackage(root);
    const dir = path.join(root, '.story-ui', 'knowledge');
    // What the old extractor left: one record per home, each naming its subpath.
    for (const sub of ['kit/components', 'kit/components/Button', 'kit/components/Card']) {
      const safe = sub.replace(/[^a-z0-9]+/gi, '-');
      write(path.join(dir, `${safe}@2.0.0.000000000000.props.json`), JSON.stringify({ schema: 1, importPath: sub, components: {} }));
    }
    // A different package's record, and a record of another kind, are not ours to remove.
    write(path.join(dir, 'kit-icons@1.0.0.000000000000.props.json'), JSON.stringify({ schema: 5, importPath: 'kit-icons', components: {} }));
    write(path.join(dir, 'kit@2.0.0.000000000000.json'), JSON.stringify({ importPath: 'kit' }));
    expect(propsRecords(root)).toHaveLength(4);

    await extractProps('kit/components/Button', root);

    const left = fs.readdirSync(dir).sort();
    expect(left.filter(f => f.startsWith('kit-components'))).toEqual([]);
    expect(left).toContain('kit-icons@1.0.0.000000000000.props.json');
    expect(left).toContain('kit@2.0.0.000000000000.json');
    expect(left.filter(f => /^kit@2\.0\.0\.[0-9a-f]{12}\.props\.json$/.test(f))).toHaveLength(1);
  });
});
