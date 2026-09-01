/**
 * A component is what it IS, not what it is called.
 *
 * Discovery used to reject exports by the shape of their name — `/Value$/`,
 * `/Config$/`, `/^get[A-Z]/`, `Styled*`, `*Context`, `*Options`, `*State` —
 * so a real `EmptyState`, `ThemeConfig`, `SelectOptions` or `StyledLink`
 * component was invisible, while an unfollowed `export { ButtonProps }` was
 * admitted. The fixture below has exactly three components and three
 * non-components with names the old regexes would have judged the other way.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  looksLikeComponentValue,
  declaredComponentExports,
  packageComponentVerdict,
} from '../story-generator/knowledge/componentShape.js';
import { createDynamicDiscovery } from '../story-generator/dynamicPackageDiscovery.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-shape-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  return root;
}

function installPackage(root: string, name: string, manifest: Record<string, unknown>, files: Record<string, string>): string {
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

/* ------------------------------------------------------------------------- */

describe('looksLikeComponentValue (runtime value in hand)', () => {
  // The six exports named in the task, as runtime values.
  const EmptyState = () => null;                                           // component: PascalCase function
  const ThemeConfig = { a: 1 };                                            // not: plain object
  const SelectOptions = (_p: unknown) => null;                             // component: PascalCase function
  const StyledLink = { $$typeof: Symbol.for('react.forward_ref'), render: () => null }; // component: React wrapper
  const FooContext = { $$typeof: Symbol.for('react.context'), _currentValue: null };   // not: a context, by its symbol
  function getFoo() { return 1; }                                          // not: lowercase, cannot be a tag

  it('admits exactly the three components', () => {
    const fixture: Record<string, unknown> = { EmptyState, ThemeConfig, SelectOptions, StyledLink, FooContext, getFoo };
    const admitted = Object.entries(fixture).filter(([n, v]) => looksLikeComponentValue(v, n)).map(([n]) => n).sort();
    expect(admitted).toEqual(['EmptyState', 'SelectOptions', 'StyledLink']);
  });

  it('excludes a context by its $$typeof symbol, not by its name', () => {
    // Same object, a name that ends in nothing suspicious.
    expect(looksLikeComponentValue(FooContext, 'Theme')).toBe(false);
    // A PascalCase function whose name ends in Context IS admitted.
    expect(looksLikeComponentValue(() => null, 'AppContext')).toBe(true);
  });

  it('admits React.memo and React.lazy wrappers', () => {
    expect(looksLikeComponentValue({ $$typeof: Symbol.for('react.memo'), type: () => null }, 'Card')).toBe(true);
    expect(looksLikeComponentValue({ $$typeof: Symbol.for('react.lazy'), _payload: {} }, 'Chart')).toBe(true);
  });

  it('rejects an already-created element and a portal', () => {
    expect(looksLikeComponentValue({ $$typeof: Symbol.for('react.element'), type: 'div' }, 'Icon')).toBe(false);
    expect(looksLikeComponentValue({ $$typeof: Symbol.for('react.portal') }, 'Portal')).toBe(false);
  });

  it('admits a class component by its prototype, and rejects a utility class', () => {
    class Legacy { render() { return null; } }
    class WithMarker { }
    (WithMarker.prototype as any).isReactComponent = {};
    class Api { fetch() { return 1; } }
    expect(looksLikeComponentValue(Legacy, 'Legacy')).toBe(true);
    expect(looksLikeComponentValue(WithMarker, 'WithMarker')).toBe(true);
    expect(looksLikeComponentValue(Api, 'Api')).toBe(false);
  });

  it('admits a Vue component object by setup/render, not by name', () => {
    expect(looksLikeComponentValue({ name: 'VBtn', props: {}, setup() { return null; } }, 'VBtn')).toBe(true);
    expect(looksLikeComponentValue({ render() { return null; } }, 'Config')).toBe(true);
    expect(looksLikeComponentValue({ name: 'thing', props: {} }, 'Thing')).toBe(false);
  });

  it('admits a namespace whose members are components (Base UI Menu)', () => {
    const Menu = { Root: () => null, Item: () => null };
    expect(looksLikeComponentValue(Menu, 'Menu')).toBe(true);
    // An enum-shaped object with PascalCase string members is not a namespace of components.
    expect(looksLikeComponentValue({ Primary: 'primary', Secondary: 'secondary' }, 'Variant')).toBe(false);
  });

  it('rejects primitives, arrays and ALL_CAPS constants by what they are', () => {
    expect(looksLikeComponentValue('xs', 'Size')).toBe(false);
    expect(looksLikeComponentValue(['xs', 'sm'], 'SIZES')).toBe(false);
    expect(looksLikeComponentValue(42, 'Value')).toBe(false);
    // …and admits a PascalCase function however its name ends.
    expect(looksLikeComponentValue(() => null, 'DefaultValue')).toBe(true);
    expect(looksLikeComponentValue(() => null, 'ThemeConfig')).toBe(true);
  });

  it('rejects any lowercase-named value: the JSX grammar makes it an intrinsic element', () => {
    expect(looksLikeComponentValue(() => null, 'useTheme')).toBe(false);
    expect(looksLikeComponentValue(() => null, 'createTheme')).toBe(false);
    expect(looksLikeComponentValue({ setup() { return null; } }, 'button')).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */

describe('discovery through a runtime import', () => {
  it('finds exactly the three components in a CommonJS fixture', async () => {
    const root = scratch();
    installPackage(root, '@fixture/runtime', { main: 'index.js' }, {
      'index.js': `
        exports.EmptyState = function EmptyState() { return null; };
        exports.ThemeConfig = { a: 1 };
        exports.SelectOptions = (p) => null;
        exports.StyledLink = { $$typeof: Symbol.for('react.forward_ref'), render: () => null };
        exports.FooContext = { $$typeof: Symbol.for('react.context'), _currentValue: null };
        exports.getFoo = function getFoo() {};
      `,
    });
    const names = await createDynamicDiscovery('@fixture/runtime', root).getAvailableComponentNames();
    expect(names).toEqual(['EmptyState', 'SelectOptions', 'StyledLink']);
  });
});

/* ------------------------------------------------------------------------- */

describe('declaredComponentExports (only declarations in hand)', () => {
  const SOURCE = `
import React, { createContext } from 'react';
import styled from 'styled-components';
export const EmptyState = () => <div />;
export const ThemeConfig = { a: 1 };
export const SelectOptions = (p: { items: string[] }) => <select />;
export const StyledLink = styled('a')\`color: red;\`;
export const FooContext = createContext(null);
export function getFoo() {}
`;

  it('finds exactly the three components in a source entry', () => {
    const root = scratch();
    const dir = installPackage(root, '@fixture/source', { types: 'src/index.tsx' }, { 'src/index.tsx': SOURCE });
    const found = declaredComponentExports(path.join(dir, 'src', 'index.tsx'), { projectRoot: root });
    expect(found.components.sort()).toEqual(['EmptyState', 'SelectOptions', 'StyledLink']);
    expect(found.excluded.sort()).toEqual(['FooContext', 'ThemeConfig']);
    expect(found.unknown).toEqual([]);
  });

  it('finds exactly the three components through the structural discovery path', async () => {
    // No runtime entry at all: only the declarations can answer.
    const root = scratch();
    installPackage(root, '@fixture/decl', { types: 'dist/index.d.ts' }, {
      'dist/index.d.ts': `
import * as React from 'react';
export declare const EmptyState: React.FC<{ title: string }>;
export declare const ThemeConfig: { a: number };
export declare const SelectOptions: (props: { items: string[] }) => JSX.Element;
export declare const StyledLink: React.ForwardRefExoticComponent<React.RefAttributes<HTMLAnchorElement>>;
export declare const FooContext: React.Context<null>;
export declare function getFoo(): number;
export type Size = 'sm' | 'md';
export interface EmptyStateProps { title: string }
export { EmptyStateProps as EmptyStateOptions };
`,
    });
    const names = await createDynamicDiscovery('@fixture/decl', root).getAvailableComponentNames();
    expect(names).toEqual(['EmptyState', 'SelectOptions', 'StyledLink']);
  });

  it('follows a braced re-export to the declaration that decides it', () => {
    const root = scratch();
    const dir = installPackage(root, '@fixture/barrel', { types: 'index.d.ts' }, {
      'index.d.ts': `
export { default as Box } from './box';
export { BoxProps } from './box';
export { Stack } from './stack';
export * from './text';
`,
      'box.d.ts': `
import * as React from 'react';
export interface BoxProps { padding?: number }
declare const Box: React.FC<BoxProps>;
export default Box;
`,
      'stack.d.ts': `export declare const Stack: (props: { gap: number }) => JSX.Element;`,
      'text.d.ts': `
export declare const Text: React.FC<{}>;
export declare const TextConfig: { sizes: string[] };
export type TextSize = 'a' | 'b';
`,
    });
    const found = declaredComponentExports(path.join(dir, 'index.d.ts'), { projectRoot: root });
    expect(found.components.sort()).toEqual(['Box', 'Stack', 'Text']);
    // `BoxProps` is re-exported through a plain brace, as .d.ts files may; it
    // is an interface, and is excluded for being one — not for its suffix.
    expect(found.excluded.sort()).toEqual(['BoxProps', 'TextConfig', 'TextSize']);
  });

  it('admits, and reports, a re-export whose declaration cannot be reached', () => {
    // Absence of evidence is not evidence. The name is admitted and listed
    // under `unknown`, so the log can say so.
    const root = scratch();
    const dir = installPackage(root, '@fixture/blind', { types: 'index.d.ts' }, {
      'index.d.ts': `export { Grid } from './components/grid';`,
    });
    const found = declaredComponentExports(path.join(dir, 'index.d.ts'), { projectRoot: root });
    expect(found.components).toEqual([]);
    expect(found.unknown).toEqual(['Grid']);
  });

  it('follows an import from a sibling package to find that a re-exported name is a type', () => {
    // Fluent's barrel: `import { ButtonProps } from '@fx/button'` + `export { ButtonProps }`.
    const root = scratch();
    installPackage(root, '@fx/button', { types: 'index.d.ts' }, {
      'index.d.ts': `
export interface ButtonProps { appearance?: string }
export declare const Button: React.FC<ButtonProps>;
`,
    });
    const dir = installPackage(root, '@fx/components', { types: 'index.d.ts' }, {
      'index.d.ts': `
import { ButtonProps } from '@fx/button';
import { Button } from '@fx/button';
export { ButtonProps };
export { Button };
`,
    });
    const found = declaredComponentExports(path.join(dir, 'index.d.ts'), { projectRoot: root });
    expect(found.components).toEqual(['Button']);
    expect(found.excluded).toEqual(['ButtonProps']);
  });

  it('classifies classes by heritage and markers, functions by return type', () => {
    const root = scratch();
    const dir = installPackage(root, '@fixture/classes', { types: 'index.d.ts' }, {
      'index.d.ts': `
export declare class SlButton extends ShoelaceElement { }
export declare class MatButton { static ɵcmp: i0.ɵɵComponentDeclaration<MatButton, "button">; }
export declare class ThemeManager { apply(): void; }
export declare function Portal(props: PortalProps): React.ReactPortal;
export declare function Format(value: number): string;
export default class Button extends SvelteComponent<ButtonProps> { }
`,
    });
    const found = declaredComponentExports(path.join(dir, 'index.d.ts'), { projectRoot: root });
    expect(found.components.sort()).toEqual(['MatButton', 'Portal', 'SlButton']);
    expect(found.excluded.sort()).toEqual(['Format', 'ThemeManager']);
    expect(found.defaultExport).toBe('component');
    expect(found.defaultLocalName).toBe('Button');
  });
});

/* ------------------------------------------------------------------------- */

describe('packageComponentVerdict (a scope of packages)', () => {
  it('keeps a @scope/theme package that declares a component, and drops one that declares none', () => {
    // The old filter was `/^(analytics|tokens?|theme|css|…)/` on the package
    // NAME. A theme package exporting ThemeProvider was dropped for its name.
    const root = scratch();
    const theme = installPackage(root, '@ds/theme', { types: 'index.d.ts' }, {
      'index.d.ts': `export declare const ThemeProvider: React.FC<{ theme: object }>;\nexport declare const tokens: Record<string, string>;`,
    });
    const tokens = installPackage(root, '@ds/tokens', { types: 'index.d.ts' }, {
      'index.d.ts': `export declare const Tokens: { space: number[] };\nexport type TokenName = string;`,
    });
    const button = installPackage(root, '@ds/button', { types: 'index.d.ts' }, {
      'index.d.ts': `export { default } from './button';`,
      'button.d.ts': `declare const _default: React.ForwardRefExoticComponent<{}>;\nexport default _default;`,
    });
    expect(packageComponentVerdict(theme, root).verdict).toBe('component');
    expect(packageComponentVerdict(tokens, root).verdict).toBe('not-component');
    expect(packageComponentVerdict(button, root).verdict).toBe('component');
  });

  it('does not exclude a package with no declarations to read', () => {
    const root = scratch();
    const js = installPackage(root, '@ds/js-only', { main: 'index.js' }, { 'index.js': 'exports.Thing = () => null;' });
    // `unknown`, not `not-component`: runtime discovery can still judge it.
    expect(packageComponentVerdict(js, root).verdict).toBe('unknown');
  });
});
