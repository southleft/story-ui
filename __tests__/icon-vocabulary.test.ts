/**
 * Icons and placeholder images come from what the project installs and
 * catalogues — judged from each package's own manifest and the catalog, not
 * from a list of package names — and a text glyph is never an icon.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  manifestSaysIcons, readExportNames, derivedIconPackages, deriveIconVocabulary,
  formatIconRules, formatImageRules, checkIconImports,
} from '../story-generator/knowledge/iconFacts.js';

function fixtureProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  write('package.json', JSON.stringify({ name: 'app', dependencies: { '@acme/ui': '1.0.0', 'glyphset-react': '2.0.0', 'left-pad': '1.0.0' } }));
  // The design system depends on its own icon set; the project does not list it.
  write('node_modules/@acme/ui/package.json', JSON.stringify({ name: '@acme/ui', dependencies: { '@acme/pictograms': '1.0.0' } }));
  write('node_modules/@acme/pictograms/package.json', JSON.stringify({ name: '@acme/pictograms', description: 'SVG icons for Acme UI', types: 'lib/index.d.ts' }));
  write('node_modules/@acme/pictograms/lib/index.d.ts', "export { default as Icon } from './Icon';\nexport * from './generated/bucket-0';\n");
  write('node_modules/@acme/pictograms/lib/generated/bucket-0.d.ts', "declare const _Add: T;\ndeclare const _ChevronDown: T;\ndeclare const _WatsonHealth3D: T;\nexport { _Add as Add, _ChevronDown as ChevronDown, _WatsonHealth3D as WatsonHealth3D };\n");
  // A project dependency whose name says nothing but whose keywords do (lucide's shape).
  write('node_modules/glyphset-react/package.json', JSON.stringify({ name: 'glyphset-react', keywords: ['react', 'icons', 'svg'], types: 'dist/index.d.ts' }));
  write('node_modules/glyphset-react/dist/index.d.ts', "declare const Home: X;\ndeclare const Search: X;\nexport { Home, Home as HomeIcon, Search };\n");
  write('node_modules/left-pad/package.json', JSON.stringify({ name: 'left-pad', description: 'String left pad' }));
  return root;
}

describe('icon packages are judged by their own manifests', () => {
  it('recognises an icon set from name, keywords or description', () => {
    expect(manifestSaysIcons({ name: '@carbon/icons-react' })).toBe(true);
    expect(manifestSaysIcons({ name: 'lucide-react', keywords: ['icons'] })).toBe(true);
    expect(manifestSaysIcons({ name: 'pictos', description: 'A glyph set' })).toBe(true);
    expect(manifestSaysIcons({ name: 'left-pad', description: 'String left pad' })).toBe(false);
    expect(manifestSaysIcons(null)).toBe(false);
  });

  it('finds the design system\'s own icon dependency and the project\'s, with real export names', () => {
    const root = fixtureProject();
    const pkgs = derivedIconPackages(root, '@acme/ui');
    expect(pkgs.map(p => `${p.name}:${p.via}`).sort()).toEqual(['@acme/pictograms:design-system', 'glyphset-react:project']);
    const pict = pkgs.find(p => p.name === '@acme/pictograms')!;
    expect(pict.exports).toEqual(['Add', 'ChevronDown', 'WatsonHealth3D']);   // `Icon` is the wrapper, not an icon
    expect(pict.examples).toEqual(['Add', 'ChevronDown']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads export names through export * one hop', () => {
    const root = fixtureProject();
    expect(readExportNames(path.join(root, 'node_modules/glyphset-react/dist/index.d.ts'))).toEqual(['Home', 'HomeIcon', 'Search']);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('deriveIconVocabulary', () => {
  it('collects catalog icon components, the icon primitive and placeholder components', () => {
    const v = deriveIconVocabulary({
      projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'empty-')),
      components: [
        { name: 'HeartIcon', filePath: '/p/src/icons/index.tsx', __componentPath: '@sail/ui' },
        { name: 'Wind', filePath: '/p/src/icons/index.tsx' },
        { name: 'SvgIcon', filePath: '/p/node_modules/@mui/material/SvgIcon/index.d.ts' },
        { name: 'ListItemIcon', filePath: '', props: ['children', 'className'] },
        { name: 'CheckIcon', filePath: '/p/node_modules/x/Check.d.ts', props: ['size', 'color'] },
        { name: 'MysteryIcon', filePath: '' },
        { name: 'Skeleton' }, { name: 'DataTableSkeleton' }, { name: 'AspectRatio' }, { name: 'SkeletonText' }, { name: 'Button' },
      ],
    });
    expect(v.packages).toEqual([]);
    expect(v.iconComponents.map(c => c.name)).toEqual(['HeartIcon', 'Wind', 'CheckIcon']);
    expect(v.iconPrimitive).toBe('SvgIcon');
    expect(v.placeholders).toEqual(['Skeleton', 'AspectRatio', 'DataTableSkeleton']);
  });
});

describe('prompt text', () => {
  it('names the installed package and its real exports, and forbids glyphs', () => {
    const lines = formatIconRules({ packages: [{ name: '@acme/pictograms', via: 'design-system', exports: ['Add', 'ChevronDown'], examples: ['Add', 'ChevronDown'] }], iconComponents: [], placeholders: [], source: '' }).join('\n');
    expect(lines).toContain("import { Add } from '@acme/pictograms'");
    expect(lines).toContain("the design system's own icon set");
    expect(lines).toContain('NEVER an icon');
    expect(lines).not.toContain('Unicode symbols');
  });

  it('with nothing installed, asks for an inline SVG — never a glyph', () => {
    const lines = formatIconRules({ packages: [], iconComponents: [], placeholders: [], source: '' }).join('\n');
    expect(lines).toContain('inline <svg');
    expect(lines).toContain('never a text character');
  });

  it('points at the library\'s icon primitive when it has one', () => {
    const lines = formatIconRules({ packages: [], iconComponents: [], iconPrimitive: 'SvgIcon', placeholders: [], source: '' }).join('\n');
    expect(lines).toContain('<SvgIcon> primitive with an inline SVG path');
  });

  it('image rules: placeholder from the catalog or a data URI; picsum only for a real photo', () => {
    const withPh = formatImageRules({ packages: [], iconComponents: [], placeholders: ['Skeleton', 'AspectRatio'], source: '' });
    expect(withPh).toContain('<Skeleton>, <AspectRatio>');
    expect(withPh).toContain('data:image/svg+xml');
    expect(withPh.indexOf('REAL PHOTO')).toBeGreaterThan(withPh.indexOf('PLACEHOLDER'));
    const without = formatImageRules(null, 'html');
    expect(without).toContain('no skeleton/placeholder component');
    expect(without).toContain('picsum.photos');
  });
});

describe('checkIconImports', () => {
  const vocab = { packages: [{ name: '@carbon/icons-react', via: 'design-system' as const, exports: ['Add', 'Close', 'ChevronDown', 'OverflowMenuVertical'], examples: ['Add', 'Close'] }], iconComponents: [], placeholders: [], source: '' };
  it('rejects a name the package does not export and suggests the nearest real one', () => {
    const code = "import React from 'react';\nimport { Add, Chevrondown, MoreVertical } from '@carbon/icons-react';";
    const out = checkIconImports(code, vocab);
    expect(out.map(v => v.name)).toEqual(['Chevrondown', 'MoreVertical']);
    expect(out[0].message).toContain('did you mean "ChevronDown"');
    expect(out[0].line).toBe(2);
  });
  it('is silent for real exports and for packages whose exports are unknown', () => {
    expect(checkIconImports("import { Add, Close } from '@carbon/icons-react';", vocab)).toEqual([]);
    expect(checkIconImports("import { Whatever } from 'unknown-icons';", { ...vocab, packages: [{ name: 'unknown-icons', via: 'project', exports: [], examples: [] }] })).toEqual([]);
  });
});
