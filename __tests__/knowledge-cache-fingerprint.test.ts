/**
 * The knowledge caches must notice when the thing they cache has changed.
 *
 * They were keyed on package version alone. A source-only workspace package
 * never bumps its version, and a bare scope with no package.json was keyed
 * `@unknown` forever — a 757KB `-atlaskit@unknown.props.json` was served
 * across every upgrade of every package under it. The fingerprint is stat-only
 * (size + mtime), so it costs nothing worth measuring.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractProps } from '../story-generator/knowledge/propExtractor.js';
import { contentFingerprint, isInstalledCopy } from '../story-generator/knowledge/cacheKey.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-fingerprint-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  return root;
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** Force an mtime the filesystem cannot confuse with the previous write. */
function bumpMtime(file: string): void {
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
}

const BUTTON_V1 = `
import * as React from 'react';
export interface ButtonProps { /** Visual weight. */ variant?: 'solid' | 'ghost' }
export declare const Button: React.FC<ButtonProps>;
`;
const BUTTON_V2 = `
import * as React from 'react';
export interface ButtonProps { /** Visual weight. */ variant?: 'solid' | 'ghost'; /** Fill the row. */ fullWidth?: boolean }
export declare const Button: React.FC<ButtonProps>;
`;

describe('an installed, versioned package', () => {
  it('bypasses the cache when the declarations entry changes without a version bump', async () => {
    const root = scratch();
    const pkg = path.join(root, 'node_modules', '@fx', 'ui');
    write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@fx/ui', version: '1.0.0', types: 'index.d.ts' }));
    write(path.join(pkg, 'index.d.ts'), BUTTON_V1);

    const first = await extractProps('@fx/ui', root);
    expect(first?.components.Button.props.map(p => p.name)).toEqual(['variant']);

    // Same version. New content.
    write(path.join(pkg, 'index.d.ts'), BUTTON_V2);
    bumpMtime(path.join(pkg, 'index.d.ts'));

    const second = await extractProps('@fx/ui', root); // NOT forced
    expect(second?.components.Button.props.map(p => p.name)).toEqual(['variant', 'fullWidth']);
  });

  it('serves the cache when nothing changed', async () => {
    const root = scratch();
    const pkg = path.join(root, 'node_modules', '@fx', 'stable');
    write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@fx/stable', version: '1.0.0', types: 'index.d.ts' }));
    write(path.join(pkg, 'index.d.ts'), BUTTON_V1);

    const first = await extractProps('@fx/stable', root);
    const second = await extractProps('@fx/stable', root);
    expect(second?.extractedAt).toBe(first?.extractedAt);
  });

  it('keeps one record per package rather than one per edit', async () => {
    const root = scratch();
    const pkg = path.join(root, 'node_modules', '@fx', 'pruned');
    write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@fx/pruned', version: '1.0.0', types: 'index.d.ts' }));
    write(path.join(pkg, 'index.d.ts'), BUTTON_V1);
    await extractProps('@fx/pruned', root);
    write(path.join(pkg, 'index.d.ts'), BUTTON_V2);
    bumpMtime(path.join(pkg, 'index.d.ts'));
    await extractProps('@fx/pruned', root);

    const records = fs.readdirSync(path.join(root, '.story-ui', 'knowledge')).filter(f => f.startsWith('-fx-pruned@'));
    expect(records).toHaveLength(1);
  });
});

describe('a source-only workspace package (symlinked, version never moves)', () => {
  it('bypasses the cache when a source file the extractor reads is edited', async () => {
    const root = scratch();
    const source = path.join(root, 'packages', 'ui');
    write(path.join(source, 'package.json'), JSON.stringify({ name: '@acme/ui', version: '0.0.0', types: 'src/index.ts' }));
    write(path.join(source, 'src', 'index.ts'), `export * from './Button';`);
    write(path.join(source, 'src', 'Button.tsx'), `
import * as React from 'react';
export interface ButtonProps { /** Visual weight. */ variant?: 'solid' | 'ghost' }
export const Button = (props: ButtonProps) => <button />;
`);
    fs.mkdirSync(path.join(root, 'node_modules', '@acme'), { recursive: true });
    fs.symlinkSync(source, path.join(root, 'node_modules', '@acme', 'ui'));

    const first = await extractProps('@acme/ui', root);
    expect(first?.components.Button.props.map(p => p.name)).toEqual(['variant']);

    // The ENTRY is untouched; a file it re-exports gains a prop.
    write(path.join(source, 'src', 'Button.tsx'), `
import * as React from 'react';
export interface ButtonProps { /** Visual weight. */ variant?: 'solid' | 'ghost'; /** Fill the row. */ fullWidth?: boolean }
export const Button = (props: ButtonProps) => <button />;
`);
    bumpMtime(path.join(source, 'src', 'Button.tsx'));

    const second = await extractProps('@acme/ui', root);
    expect(second?.components.Button.props.map(p => p.name)).toEqual(['variant', 'fullWidth']);
  });
});

describe('contentFingerprint', () => {
  it('is stat-only: reads no file content', () => {
    const root = scratch();
    const pkg = path.join(root, 'node_modules', 'lib');
    write(path.join(pkg, 'package.json'), JSON.stringify({ name: 'lib', version: '1.0.0' }));
    write(path.join(pkg, 'index.d.ts'), 'export declare const A: 1;');
    let read = false;
    const files = () => { read = true; return [path.join(pkg, 'index.d.ts')]; };
    const a = contentFingerprint({ root: pkg, version: '1.0.0', entryFile: path.join(pkg, 'index.d.ts'), files });
    expect(read).toBe(false); // an installed copy never needs the file list
    // Same size, different mtime: the stamp moves.
    bumpMtime(path.join(pkg, 'index.d.ts'));
    const b = contentFingerprint({ root: pkg, version: '1.0.0', entryFile: path.join(pkg, 'index.d.ts'), files });
    expect(b).not.toBe(a);
  });

  it('tells an installed copy from a workspace source tree by its real path', () => {
    expect(isInstalledCopy('/repo/node_modules/@acme/ui')).toBe(true);
    expect(isInstalledCopy('/repo/packages/ui')).toBe(false);
  });

  it('for a scope with no package.json, changes when any read file changes', () => {
    const root = scratch();
    const scope = path.join(root, 'node_modules', '@scope');
    write(path.join(scope, 'a', 'package.json'), JSON.stringify({ name: '@scope/a', version: '1.0.0' }));
    write(path.join(scope, 'a', 'index.d.ts'), 'export declare const A: React.FC<{}>;');
    const files = () => [path.join(scope, 'a', 'index.d.ts')];
    const a = contentFingerprint({ root: scope, version: undefined, entryFile: null, files });
    write(path.join(scope, 'a', 'index.d.ts'), 'export declare const A: React.FC<{ x: 1 }>;');
    const b = contentFingerprint({ root: scope, version: undefined, entryFile: null, files });
    expect(b).not.toBe(a);
  });
});
