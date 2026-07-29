/**
 * A barrel that declares nothing and re-exports everything.
 *
 * Fluent UI v9's `@fluentui/react-components` is 6,083 lines of
 * `import { ButtonProps } from '@fluentui/react-button'` followed by
 * `export { ButtonProps }` — 2,027 of each, and ZERO declarations. The props
 * are real, and this extractor reads them perfectly once pointed at a sibling.
 * The only missing fact was which packages to read, and the barrel states it.
 *
 * Measured before this change: props known for 0 of 233 Fluent components.
 * After: 198 of 233, with 419 defaults and 10 deprecations recovered.
 *
 * The regression risk is the reason for the relative-specifier rule tested
 * below: Astryx and Carbon are barrels too, but they re-export from
 * directories INSIDE the package, which the existing walk already covers.
 * Following those would be redundant at best; treating them as packages would
 * be wrong. Both measured byte-identical after this change.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractProps } from '../story-generator/knowledge/propExtractor.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

/** A fixture project with SEVERAL packages installed under one node_modules. */
function fixture(packages: Record<string, Record<string, string>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-fed-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  for (const [name, files] of Object.entries(packages)) {
    const dir = path.join(root, 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', main: 'index.js', types: 'index.d.ts' }),
    );
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }
  return root;
}

/** A sibling declaring a documented, defaulted, literal-union prop. */
const BUTTON_SIBLING = `
export declare type ButtonProps = {
  /**
   * Visual style of the button.
   * @default 'secondary'
   */
  appearance?: 'primary' | 'secondary' | 'outline';
};
export declare const Button: (props: ButtonProps) => JSX.Element;
`;

describe('a barrel whose API lives in sibling packages', () => {
  it('reads props through `import ... ; export { X }` — the Fluent form', async () => {
    const root = fixture({
      '@fx/ds': { 'index.d.ts': `import { Button, ButtonProps } from '@fx/ds-button';\nexport { Button, ButtonProps };\n` },
      '@fx/ds-button': { 'index.d.ts': BUTTON_SIBLING },
    });

    const out = await extractProps('@fx/ds', root, { force: true });
    const button = out?.components?.Button;
    expect(button).toBeDefined();
    const appearance = button!.props.find(p => p.name === 'appearance');
    expect(appearance).toBeDefined();
    expect(appearance!.options).toContain('primary');
    expect(appearance!.doc).toMatch(/visual style/i);
  });

  it('reads props through `export { X } from "pkg"`', async () => {
    const root = fixture({
      '@fx/ds': { 'index.d.ts': `export { Button, ButtonProps } from '@fx/ds-button';\n` },
      '@fx/ds-button': { 'index.d.ts': BUTTON_SIBLING },
    });
    const out = await extractProps('@fx/ds', root, { force: true });
    expect(out?.components?.Button?.props?.some(p => p.name === 'appearance')).toBe(true);
  });

  it('reads props through `export * from "pkg"`', async () => {
    const root = fixture({
      '@fx/ds': { 'index.d.ts': `export * from '@fx/ds-button';\n` },
      '@fx/ds-button': { 'index.d.ts': BUTTON_SIBLING },
    });
    const out = await extractProps('@fx/ds', root, { force: true });
    expect(out?.components?.Button?.props?.some(p => p.name === 'appearance')).toBe(true);
  });

  it('resolves an ALIASED export through its local name', async () => {
    /**
     * `export { Image_2 as Image }` backed by `import { Image as Image_2 }`.
     * Looking up the EXPORTED name finds nothing; the local name is what the
     * import bound. This is 4 of Fluent's real exports.
     */
    const root = fixture({
      '@fx/ds': { 'index.d.ts': `import { Button as Button_2 } from '@fx/ds-button';\nexport { Button_2 as Button };\n` },
      '@fx/ds-button': { 'index.d.ts': BUTTON_SIBLING },
    });
    const out = await extractProps('@fx/ds', root, { force: true });
    expect(out?.reexportedFrom).toContain('@fx/ds-button');
  });

  it('follows a type-only re-export', async () => {
    const root = fixture({
      '@fx/ds': { 'index.d.ts': `export type { ButtonProps } from '@fx/ds-button';\n` },
      '@fx/ds-button': { 'index.d.ts': BUTTON_SIBLING },
    });
    const out = await extractProps('@fx/ds', root, { force: true });
    expect(out?.reexportedFrom).toContain('@fx/ds-button');
  });
});

describe('the barrel keeps its own answer', () => {
  it('prefers a locally declared prop over a sibling one', async () => {
    const root = fixture({
      '@fx/ds': {
        // The barrel declares the component ITSELF as well as re-exporting the
        // sibling's; a type alone would not create a component to conflict with.
        'index.d.ts': `export * from '@fx/ds-button';\n`
          + `export declare type ButtonProps = { appearance?: 'lg' | 'sm' };\n`
          + `export declare const Button: (props: ButtonProps) => JSX.Element;\n`,
      },
      '@fx/ds-button': { 'index.d.ts': BUTTON_SIBLING },
    });
    const out = await extractProps('@fx/ds', root, { force: true });
    const appearance = out?.components?.Button?.props.find(p => p.name === 'appearance');
    // The barrel declared 'lg' | 'sm'; the sibling declared primary/secondary/outline.
    expect(appearance?.options).toContain('lg');
    expect(appearance?.options).not.toContain('primary');
  });
});

describe('what must NOT change', () => {
  it('ignores relative re-exports — the Astryx and Carbon shape', async () => {
    /**
     * `export * from './Button'` targets a directory inside the package, which
     * findDeclarationFiles already walks. Treating it as a package would send
     * the extractor looking for a module named './Button' in node_modules.
     */
    const root = fixture({
      '@fx/local': {
        'index.d.ts': `export * from './Button';\n`,
        'Button.d.ts': BUTTON_SIBLING,
      },
    });
    const out = await extractProps('@fx/local', root, { force: true });
    expect(out?.reexportedFrom).toEqual([]);
    // ...and the props are still found, by the ordinary walk.
    expect(out?.components?.Button?.props?.some(p => p.name === 'appearance')).toBe(true);
  });

  it('does not throw when the root has no package.json', async () => {
    // Atlassian configures a bare SCOPE; node_modules/@atlaskit/package.json
    // does not exist. This must degrade, not crash.
    const root = fixture({ '@scoped/real': { 'index.d.ts': BUTTON_SIBLING } });
    fs.mkdirSync(path.join(root, 'node_modules', '@bare'), { recursive: true });
    await expect(extractProps('@bare', root, { force: true })).resolves.not.toThrow();
  });

  it('survives a re-export naming a package that is not installed', async () => {
    const root = fixture({
      '@fx/ds': { 'index.d.ts': `export { Missing } from '@fx/not-installed';\nexport * from '@fx/ds-button';\n` },
      '@fx/ds-button': { 'index.d.ts': BUTTON_SIBLING },
    });
    const out = await extractProps('@fx/ds', root, { force: true });
    // The uninstalled specifier is still NAMED — absent is recorded, not erased.
    expect(out?.reexportedFrom).toContain('@fx/not-installed');
    // ...and the installed sibling was still read.
    expect(out?.components?.Button?.props?.some(p => p.name === 'appearance')).toBe(true);
  });
});

describe('cache correctness', () => {
  it('a stale schema-2 record does not suppress federated props', async () => {
    /**
     * Pins the lesson that a cache keyed only on library version hid new
     * extractor fields for months. The schema bump must invalidate it.
     */
    const root = fixture({
      '@fx/ds': { 'index.d.ts': `export * from '@fx/ds-button';\n` },
      '@fx/ds-button': { 'index.d.ts': BUTTON_SIBLING },
    });
    const cacheDir = path.join(root, '.story-ui', 'knowledge');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, '-fx-ds@1.0.0.props.json'),
      JSON.stringify({ schema: 2, importPath: '@fx/ds', version: '1.0.0', components: {}, inheritedOnly: [], extractedAt: 'old' }),
    );

    // NOT forced — the stale record must be rejected on schema, not bypassed.
    const out = await extractProps('@fx/ds', root);
    expect(out?.components?.Button?.props?.some(p => p.name === 'appearance')).toBe(true);
  });
});
