/**
 * What a design system says about its own styling, versus what we guessed.
 *
 * Four separate silent failures lived in this module, all the same shape: a
 * question with a checkable answer was answered by convention instead, and
 * getting it wrong produced ZERO rather than an error.
 *
 *   - a line-anchored regex found 0 of 839 custom properties in a minified
 *     stylesheet, because a minified stylesheet has no lines
 *   - six guessed filenames missed `dist/astryx.css`, so a system shipping 288
 *     tokens was reported as having none
 *   - four guessed sibling names found `@carbon/styles` and missed
 *     `@astryxdesign/theme-neutral`
 *   - camelCase token names all fell into the `other` bucket, which the prompt
 *     formatter skips, so they would have been invisible even once collected
 *
 * Each test below pins one of those, plus the regression that the first attempt
 * at the sibling fix introduced.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readDesignTokens, readStylingFacts } from '../story-generator/knowledge/stylingFacts.js';

let root: string;

/** Write a package into the fixture's node_modules. */
function pkg(name: string, files: Record<string, string>, manifest: Record<string, unknown> = {}) {
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...manifest }),
  );
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'styling-facts-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  // The project declares ONLY the component package — the stylesheet package is
  // transitive, exactly as @carbon/styles is.
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: { '@ds/react': '1.0.0' } }),
  );
});

afterAll(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('custom properties in a minified stylesheet', () => {
  it('finds properties on a single-line file', () => {
    // One line, no newlines anywhere — the shape of @carbon/styles/css/styles.min.css.
    pkg('@min/react', {
      'css/styles.css': ':root{--color-primary:#000;--spacing-1:4px;--radius-sm:2px}',
    });
    const groups = readDesignTokens(root, '@min/react');
    const all = groups.flatMap(g => g.names);
    expect(all).toContain('color-primary');
    expect(all).toContain('spacing-1');
    expect(all).toContain('radius-sm');
  });
});

describe('categorising token names', () => {
  it('splits camelCase, so a camelCase system is not filed under other', () => {
    pkg('@camel/react', {
      'css/styles.css': ':root{--colorNeutralForeground1:#000;--borderRadiusMedium:4px;--spacingHorizontalM:12px;--fontWeightSemibold:600}',
    });
    const groups = readDesignTokens(root, '@camel/react');
    const categoryOf = (name: string) => groups.find(g => g.names.includes(name))?.category;

    expect(categoryOf('colorNeutralForeground1')).toBe('color');
    expect(categoryOf('borderRadiusMedium')).toBe('radius');
    expect(categoryOf('spacingHorizontalM')).toBe('spacing');
    expect(categoryOf('fontWeightSemibold')).toBe('typography');
  });

  it('still classifies kebab-case with a vendor prefix', () => {
    pkg('@kebab/react', {
      'css/styles.css': ':root{--cds-text-primary:#000;--cds-spacing-05:4px}',
    });
    const groups = readDesignTokens(root, '@kebab/react');
    const categoryOf = (name: string) => groups.find(g => g.names.includes(name))?.category;
    expect(categoryOf('cds-text-primary')).toBe('color');
    expect(categoryOf('cds-spacing-05')).toBe('spacing');
  });
});

describe('finding the stylesheets a package ships', () => {
  it('reads a non-conventional filename from the exports map', () => {
    // `dist/astryx.css` matches none of the six conventional names, and the
    // exports map is what states it.
    pkg('@exp/core', { 'dist/brand.css': ':root{--brand-accent:#f00}' }, {
      exports: { '.': './dist/index.js', './brand.css': { default: './dist/brand.css' } },
    });
    const all = readDesignTokens(root, '@exp/core').flatMap(g => g.names);
    expect(all).toContain('brand-accent');
  });

  it('reads a nested condition in the exports map', () => {
    pkg('@nest/core', { 'dist/theme.css': ':root{--nested-token:1px}' }, {
      exports: { './theme.css': { import: { default: './dist/theme.css' } } },
    });
    const all = readDesignTokens(root, '@nest/core').flatMap(g => g.names);
    expect(all).toContain('nested-token');
  });

  it('still finds a conventional path when the package declares no exports map', () => {
    // Carbon and Atlassian ship no exports map at all; any real path is legal.
    pkg('@legacy/react', { 'css/styles.css': ':root{--legacy-token:2px}' });
    const all = readDesignTokens(root, '@legacy/react').flatMap(g => g.names);
    expect(all).toContain('legacy-token');
  });
});

describe('sibling stylesheet packages', () => {
  it('finds a TRANSITIVE sibling the project does not declare', () => {
    /**
     * The regression this pins is one I introduced: deriving siblings from the
     * project's declared dependencies took Carbon from 370 tokens to 0, because
     * `@carbon/styles` is a transitive dependency of `@carbon/react` and appears
     * in no package.json the project owns. The directory listing is the fact
     * both the guessed list and the dependency list were approximating.
     */
    pkg('@ds/react', { 'dist/index.js': '' });
    pkg('@ds/styles', { 'css/styles.css': ':root{--transitive-token:8px}' });
    const all = readDesignTokens(root, '@ds/react').flatMap(g => g.names);
    expect(all).toContain('transitive-token');
  });

  it('finds a sibling whose name matches no convention', () => {
    // `@astryxdesign/theme-neutral` matches none of styles|themes|core|tokens.
    pkg('@named/core', { 'dist/index.js': '' });
    pkg('@named/palette-warm', { 'theme.css': ':root{--warm-accent:#fa0}' }, {
      exports: { './theme.css': './theme.css' },
    });
    const all = readDesignTokens(root, '@named/core').flatMap(g => g.names);
    expect(all).toContain('warm-accent');
  });
});

describe('absent is not zero', () => {
  it('reports having examined nothing when the package ships no stylesheet', () => {
    // Fluent's real shape: zero .css files anywhere in the package.
    pkg('@cssless/react', { 'dist/index.js': 'export const Button = () => null;' });
    const facts = readStylingFacts(root, 'generated', '@cssless/react');
    expect(facts.sources.tokens).toBe(0);
    expect(facts.sources.packageFiles).toBe(0);
  });

  it('distinguishes a stylesheet declaring no tokens from no stylesheet at all', () => {
    pkg('@empty/react', { 'css/styles.css': '.button{color:red}' });
    const withSheet = readStylingFacts(root, 'generated', '@empty/react');
    const withoutSheet = readStylingFacts(root, 'generated', '@cssless/react');

    // Both find zero tokens...
    expect(withSheet.sources.tokens).toBe(0);
    expect(withoutSheet.sources.tokens).toBe(0);
    // ...but only one of them actually read a file, and the caller can tell.
    expect(withSheet.sources.packageFiles).toBeGreaterThan(0);
    expect(withoutSheet.sources.packageFiles).toBe(0);
  });
});
