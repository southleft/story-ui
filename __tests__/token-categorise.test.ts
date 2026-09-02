/**
 * A token is grouped by what its VALUE is before what its name says.
 *
 * Name alone filed `--ss-icon-md: 16px`, `--ss-layer-modal: 400` and
 * `--ss-border-width-thin: 1px` under `color`, because `icon`, `layer` and
 * `border` are colour vocabulary in every system that also uses them for
 * measures. A length is not a colour; the value settles it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { categorise, valueKind, resolveTokenValue, readDesignTokens } from '../story-generator/knowledge/stylingFacts.js';

describe('valueKind', () => {
  it('recognises colour literals in every spelling', () => {
    for (const v of ['#fff', '#0714261A', 'rgb(1 2 3)', 'rgba(0,0,0,.2)', 'hsl(200 50% 50%)', 'oklch(0.7 0.1 200)', 'color-mix(in srgb, red, blue)', 'white', 'transparent', 'currentColor']) {
      expect(valueKind(v), v).toBe('color');
    }
  });
  it('recognises lengths, bare numbers, shadows and font stacks', () => {
    expect(valueKind('16px')).toBe('length');
    expect(valueKind('1.25rem')).toBe('length');
    expect(valueKind('4px 8px')).toBe('length');
    expect(valueKind('400')).toBe('number');
    expect(valueKind('0.75')).toBe('number');
    expect(valueKind('0 1px 2px rgba(0,0,0,.2)')).toBe('shadow');
    expect(valueKind('"Playfair Display", serif')).toBe('font');
    expect(valueKind('Lato, sans-serif')).toBe('font');
    expect(valueKind('120ms')).toBe('other');
    expect(valueKind('inherit')).toBe('other');
  });
});

describe('categorise by value first', () => {
  it('files a length under the measure its name says, else spacing/size — never colour', () => {
    expect(categorise('ss-icon-md', '16px')).toBe('spacing');
    expect(categorise('ss-border-width-thin', '1px')).toBe('spacing');
    expect(categorise('ss-radius-md', '8px')).toBe('radius');
    expect(categorise('ss-font-size-100', '13px')).toBe('typography');
    expect(categorise('ss-space-8', '8px')).toBe('spacing');
  });
  it('files a bare number by role: weights are typography, layers are layout, opacity is other', () => {
    expect(categorise('ss-font-weight-bold', '700')).toBe('typography');
    expect(categorise('ss-layer-modal', '400')).toBe('layout');
    expect(categorise('ss-opacity-muted', '0.75')).toBe('other');
  });
  it('files a colour literal as colour whatever the name says', () => {
    expect(categorise('ss-border-subtle', '#e5e5e5')).toBe('color');
    expect(categorise('ss-shadow-umbra', '#0714261A')).toBe('color');
    expect(categorise('brand', 'oklch(0.6 0.2 30)')).toBe('color');
  });
  it('files a font stack as typography and a shadow as shadow', () => {
    expect(categorise('ss-font-family-display', '"Playfair Display", serif')).toBe('typography');
    expect(categorise('ss-elevation-2', '0 1px 2px rgba(0,0,0,.2)')).toBe('shadow');
  });
  it('follows var() references to the value they point at', () => {
    const sheet: Record<string, string> = {
      'ss-color-brand': '#0055ff',
      'ss-comp-button-bg': 'var(--ss-color-brand)',
      'ss-comp-button-bg-hover': 'var(--ss-comp-button-bg)',
      'ss-comp-icon': 'var(--ss-icon-md)',
      'ss-icon-md': '16px',
    };
    const lookup = (n: string) => sheet[n];
    expect(resolveTokenValue('var(--ss-comp-button-bg)', lookup)).toBe('#0055ff');
    expect(categorise('ss-comp-button-bg-hover', 'var(--ss-comp-button-bg)', lookup)).toBe('color');
    expect(categorise('ss-comp-icon', 'var(--ss-icon-md)', lookup)).toBe('spacing');
    // Unresolvable with a fallback: the fallback decides.
    expect(categorise('x-icon', 'var(--missing, 12px)', lookup)).toBe('spacing');
  });
  it('falls back to the name when the value says nothing, exactly as before', () => {
    expect(categorise('ss-icon-md')).toBe('color');
    expect(categorise('ss-icon-md', 'inherit')).toBe('color');
    expect(categorise('cds-text-primary')).toBe('color');
    expect(categorise('borderRadiusMedium')).toBe('radius');
    expect(categorise('spacingHorizontalM')).toBe('spacing');
    expect(categorise('ss-duration-fast', '120ms')).toBe('other');
  });
});

describe('readDesignTokens', () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'token-categorise-'));
    fs.mkdirSync(path.join(root, 'src/tokens'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/tokens/tokens.css'), `:root {
  --ss-icon-md: 16px;
  --ss-layer-modal: 400;
  --ss-border-width-thin: 1px;
  --ss-color-background-brand: #0055ff;
  --ss-comp-button-primary-background-default: var(--ss-color-background-brand);
  --ss-font-family-display: "Playfair Display";
  --ss-radius-md: 8px;
}`);
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('groups an alias token by the value it resolves to', () => {
    const groups = readDesignTokens(root);
    const category = (name: string) => groups.find(g => g.names.includes(name))?.category;
    expect(category('ss-icon-md')).toBe('spacing');
    expect(category('ss-layer-modal')).toBe('layout');
    expect(category('ss-border-width-thin')).toBe('spacing');
    expect(category('ss-color-background-brand')).toBe('color');
    expect(category('ss-comp-button-primary-background-default')).toBe('color');
    expect(category('ss-font-family-display')).toBe('typography');
    expect(category('ss-radius-md')).toBe('radius');
  });
});
