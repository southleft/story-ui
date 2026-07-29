/**
 * What a design system needs around it, derived instead of hand-written.
 *
 * Ground truth for these assertions is the six `.storybook/preview.*` files
 * written by hand for this project's own test beds. The deriver reproduces all
 * six — and reports the one requirement the hand-written Astryx preview
 * originally MISSED, which is the point of having it.
 *
 * The two failures being pinned here both rendered every story blank or
 * untokenized with NO JavaScript error:
 *
 *   (a) `@astryxdesign/core/dist/astryx.css` — a real 127KB file that the
 *       package's exports map refuses. Vite fails the whole preview module.
 *   (b) the missing `data-astryx-theme` ancestor — the theme CSS is written
 *       `@scope ([data-astryx-theme="neutral"])`, so all 172 of its custom
 *       properties resolve to nothing without it.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { deriveHostContract } from '../story-generator/knowledge/hostContract.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

function fixture(packages: Record<string, { files: Record<string, string>; manifest?: Record<string, unknown> }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-contract-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  for (const [name, { files, manifest }] of Object.entries(packages)) {
    const dir = path.join(root, 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...manifest }));
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
  }
  return root;
}

describe('stylesheets a package declares', () => {
  it('finds a sheet at a non-conventional path named in the exports map', () => {
    // The Astryx shape: dist/brand.css, exported as ./brand.css.
    const root = fixture({
      '@ds/core': {
        files: { 'dist/brand.css': ':root{--color-accent:#f00;--spacing-1:4px}' },
        manifest: { exports: { '.': './index.js', './brand.css': './dist/brand.css' } },
      },
    });
    const c = deriveHostContract(root, '@ds/core');
    expect(c.css.status).toBe('satisfied');
    expect(c.css.requirements.map(r => r.specifier)).toContain('@ds/core/brand.css');
  });

  it('finds a token sheet in a SIBLING package at a conventional path', () => {
    /**
     * The Carbon shape, and a regression this test exists for: `@carbon/react`
     * declares `index.scss` in its exports, and treating a non-empty
     * declaration as complete stopped the search before reaching
     * `@carbon/styles/css/styles.css`, which holds every token.
     */
    const root = fixture({
      '@ds/react': { files: { 'index.scss': '@use "./x";' }, manifest: { exports: { './index.scss': './index.scss' } } },
      '@ds/styles': { files: { 'css/styles.css': ':root{--ds-layer:#fff;--ds-text:#000}' } },
    });
    const c = deriveHostContract(root, '@ds/react');
    expect(c.css.requirements.map(r => r.specifier)).toContain('@ds/styles/css/styles.css');
  });

  it('ignores a sibling package internal sheet that declares no tokens', () => {
    // The Fluent shape: @fluentui/react-icons ships icon-font CSS that belongs
    // in nobody's preview file.
    const root = fixture({
      '@ds/core': { files: {}, manifest: {} },
      '@ds/icons': { files: { 'styles.css': '.icon{font-family:x}' }, manifest: { exports: { './styles.css': './styles.css' } } },
    });
    const c = deriveHostContract(root, '@ds/core');
    expect(c.css.requirements).toEqual([]);
    expect(c.css.status).toBe('not_applicable');
  });

  it('keeps a tokenless plain-CSS reset from the configured package', () => {
    // Astryx's reset.css declares no custom properties and is still required.
    const root = fixture({
      '@ds/core': {
        files: { 'reset.css': '*{box-sizing:border-box}', 'tokens.css': ':root{--x:1px}' },
        manifest: { exports: { './reset.css': './reset.css', './tokens.css': './tokens.css' } },
      },
    });
    const c = deriveHostContract(root, '@ds/core');
    expect(c.css.requirements.map(r => r.specifier)).toContain('@ds/core/reset.css');
  });
});

describe('a specifier that the package forbids', () => {
  it('rejects a real file that is not exported, and says it is present', () => {
    const root = fixture({
      '@ds/core': {
        files: { 'dist/brand.css': ':root{--a:1px}' },
        manifest: { exports: { '.': './index.js', './brand.css': './dist/brand.css' } },
      },
    });
    const c = deriveHostContract(root, '@ds/core');
    // Only the exported spelling is ever offered.
    expect(c.css.requirements.every(r => !r.specifier.includes('/dist/'))).toBe(true);
  });

  it('never reports a requirement it could not resolve', () => {
    const root = fixture({
      '@ds/core': {
        files: {},   // exports map names a file that does not exist
        manifest: { exports: { './ghost.css': './dist/ghost.css' } },
      },
    });
    const c = deriveHostContract(root, '@ds/core');
    expect(c.css.requirements).toEqual([]);
    expect(c.css.rejected.map(r => r.specifier)).toContain('@ds/core/ghost.css');
  });
});

describe('scoped themes', () => {
  it('reports the attribute an ancestor must carry, and what it gates', () => {
    const root = fixture({
      '@ds/core': { files: {}, manifest: {} },
      '@ds/theme-warm': {
        files: {
          'theme.css': '@layer t {\n@scope ([data-ds-theme="warm"]) to ([data-ds-theme]) {\n:scope{--color-accent:#fa0;--color-bg:#fff;--spacing-1:4px}\n}}',
        },
        manifest: { exports: { './theme.css': './theme.css' } },
      },
    });
    const c = deriveHostContract(root, '@ds/core');
    expect(c.gates.status).toBe('satisfied');
    const gate = c.gates.required[0];
    expect(gate.attribute).toBe('data-ds-theme');
    expect(gate.value).toBe('warm');
    expect(gate.propertiesBehindGate).toBeGreaterThan(0);
  });

  it('reports no gate when the tokens are unscoped', () => {
    const root = fixture({ '@plain/core': { files: { 'styles.css': ':root{--a:1px;--b:2px}' }, manifest: { exports: { './styles.css': './styles.css' } } } });
    const c = deriveHostContract(root, '@plain/core');
    expect(c.gates.status).toBe('not_applicable');
    expect(c.gates.required).toEqual([]);
  });
});

describe('absent is not zero', () => {
  it('distinguishes "ships no stylesheet" from "could not look"', () => {
    // Fluent genuinely ships none; that is a derived positive result.
    const shipsNone = fixture({ '@none/core': { files: {}, manifest: {} } });
    expect(deriveHostContract(shipsNone, '@none/core').css.status).toBe('not_applicable');

    // Nothing installed at all is a different answer entirely.
    const nothing = fixture({});
    expect(deriveHostContract(nothing, '@missing/core').css.status).toBe('unknown');
  });

  it('offers token canaries only when tokens were actually found', () => {
    const withTokens = fixture({ '@t/core': { files: { 'styles.css': ':root{--a:1px}' }, manifest: { exports: { './styles.css': './styles.css' } } } });
    expect(deriveHostContract(withTokens, '@t/core').tokenCanaries.length).toBeGreaterThan(0);

    const without = fixture({ '@n/core': { files: {}, manifest: {} } });
    expect(deriveHostContract(without, '@n/core').tokenCanaries).toEqual([]);
  });
});
