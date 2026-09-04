/**
 * Props resolved by the compiler, for the shape reading declarations cannot
 * follow: `interface ButtonProps extends HTMLChakraProps<"button", Base> {}`.
 *
 * The tests that matter are about the SUBTRACTION. Asking the compiler about a
 * styling-props library returns everything — 1,139 props for one Button, of
 * which 1,123 are the CSS surface every component in that library shares — so
 * a catalog entry built from the raw answer teaches nothing. What is kept is
 * what the component adds. That has to work without knowing which library is
 * being read, and it has to do NOTHING on a library whose components share no
 * base.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePropsWithChecker } from '../story-generator/knowledge/checkerProps.js';

/** A package whose components share a styling base, written to disk. */
function styledLibrary(dir: string): void {
  const pkg = path.join(dir, 'node_modules', 'styled-lib');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
    name: 'styled-lib', version: '1.0.0', types: 'index.d.ts', main: 'index.js',
    peerDependencies: { react: '*' },
  }));
  fs.writeFileSync(path.join(pkg, 'index.js'), 'module.exports = {};');
  // Every component takes the same 60-prop style surface; each adds its own.
  const style = Array.from({ length: 60 }, (_, i) => `  s${i}?: string;`).join('\n');
  fs.writeFileSync(path.join(pkg, 'index.d.ts'), `
import * as React from 'react';
interface StyleBase {
${style}
}
export interface ButtonProps extends StyleBase {
  /** Which visual treatment to use. */
  variant?: 'solid' | 'outline';
  loading?: boolean;
}
export interface BadgeProps extends StyleBase { tone?: 'info' | 'warn'; }
export interface CardProps extends StyleBase { elevated?: boolean; }
export interface StackProps extends StyleBase { gap?: number; }
export declare const Button: React.FC<ButtonProps>;
export declare const Badge: React.FC<BadgeProps>;
export declare const Card: React.FC<CardProps>;
export declare const Stack: React.FC<StackProps>;
`);
}

/** A package whose components share nothing — the base must come out empty. */
function plainLibrary(dir: string): void {
  const pkg = path.join(dir, 'node_modules', 'plain-lib');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
    name: 'plain-lib', version: '1.0.0', types: 'index.d.ts', main: 'index.js',
    peerDependencies: { react: '*' },
  }));
  fs.writeFileSync(path.join(pkg, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(pkg, 'index.d.ts'), `
import * as React from 'react';
export declare const Alpha: React.FC<{ alpha?: string; shared?: boolean }>;
export declare const Beta: React.FC<{ beta?: number; shared?: boolean }>;
export declare const Gamma: React.FC<{ gamma?: 'a' | 'b' }>;
`);
}

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkerprops-'));
  // React's own types have to be resolvable for a JSX probe to mean anything.
  fs.symlinkSync(
    path.resolve(process.cwd(), 'node_modules', '@types'),
    path.join(fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true }) ?? path.join(dir, 'node_modules'), '@types'),
    'dir',
  );
  styledLibrary(dir);
  plainLibrary(dir);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('resolvePropsWithChecker', () => {
  it('keeps what a component adds and drops the base its library shares', () => {
    const out = resolvePropsWithChecker({ projectRoot: dir, importPath: 'styled-lib' });
    expect(out.ran).toBe(true);
    // The 60 shared style props are recognised as the library's base.
    expect(out.baseProps.length).toBeGreaterThanOrEqual(60);
    const button = out.components.find(c => c.name === 'Button');
    expect(button).toBeDefined();
    expect(button!.total).toBeGreaterThan(60);
    expect(button!.own.map(p => p.name).sort()).toEqual(['loading', 'variant']);
    // The library's own words and its declared value set both survive.
    const variant = button!.own.find(p => p.name === 'variant')!;
    expect(variant.options).toEqual(['solid', 'outline']);
    expect(variant.doc).toBe('Which visual treatment to use.');
    expect(out.components.find(c => c.name === 'Badge')!.own.map(p => p.name)).toEqual(['tone']);
  });

  it('subtracts nothing from a library whose components share no base', () => {
    // Self-calibrating: with no shared surface, no prop reaches the threshold,
    // so a library like Carbon or Material keeps everything it declares.
    const out = resolvePropsWithChecker({ projectRoot: dir, importPath: 'plain-lib' });
    expect(out.ran).toBe(true);
    expect(out.baseProps).toEqual([]);
    const alpha = out.components.find(c => c.name === 'Alpha')!;
    expect(alpha.own.map(p => p.name).sort()).toEqual(['alpha', 'shared']);
  });

  it('says it could not run rather than reporting nothing found', () => {
    const out = resolvePropsWithChecker({ projectRoot: dir, importPath: 'no-such-package-anywhere' });
    expect(out.ran).toBe(false);
    expect(out.reason).toBeTruthy();
    expect(out.components).toEqual([]);
  });
});
