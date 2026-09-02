/**
 * A specifier that resolves is not a binding that exists.
 *
 * Found by the selection bench on a local design system. The model wrote one
 * bundled import for four components living in four files — having correctly
 * imported three of them on the lines below — and every check passed it: the
 * components are real, the package is in scope, the path resolves. The browser
 * then threw
 *
 *   The requested module '/src/housekit/Datagrid.tsx' does not provide an
 *   export named 'Pillbox'
 *
 * leaving a blank canvas with no build error, which is the failure mode this
 * branch keeps having to close in a new shape.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateLocalNamedImports } from '../mcp-server/routes/generationCore.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

/** A design system of single-component files, plus the generated-stories dir. */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-named-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.mkdirSync(path.join(root, 'src/stories/generated'), { recursive: true });
  return path.join(root, 'src/stories/generated');
}

const ds = {
  'src/ds/Datagrid.tsx': 'export const Datagrid = () => null;',
  'src/ds/Pillbox.tsx': 'export const Pillbox = () => null;',
  'src/ds/Slab.tsx': 'export function Slab() { return null; }',
  'src/ds/index.ts': "export * from './Datagrid';\nexport * from './Pillbox';\nexport * from './Slab';",
};

const components = [
  { name: 'Pillbox', __componentPath: '../../ds/Pillbox' },
  { name: 'Slab', __componentPath: '../../ds/Slab' },
];

describe('validateLocalNamedImports', () => {
  it('rejects a binding the module does not export, and names its real home', () => {
    const dir = fixture(ds);
    const code = "import { Datagrid, Pillbox } from '../../ds/Datagrid';";
    const errors = validateLocalNamedImports(code, dir, components);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('does not export "Pillbox"');
    expect(errors[0]).toContain('../../ds/Pillbox');
  });

  it('does not attribute a previous import\'s bindings to this specifier', () => {
    // The clause pattern spanned statements, so the Storybook types on the
    // line above were read as bindings of the housekit import below:
    // "'../../ds/Datagrid' does not export 'Meta'". Nothing was wrong, so the
    // healing loop could not satisfy it and burned every attempt.
    const dir = fixture(ds);
    const code = [
      "import type { Meta, StoryObj } from '@storybook/react-vite';",
      "import { Datagrid } from '../../ds/Datagrid';",
    ].join('\n');
    expect(validateLocalNamedImports(code, dir, components)).toEqual([]);
  });

  it('offers the corrected path for a component known only by filePath', () => {
    // Local components carry an absolute filePath and no __componentPath.
    // Relying on the latter meant the fix was never offered for precisely the
    // private design systems this check protects.
    const dir = fixture(ds);
    const abs = path.resolve(dir, '../../ds/Pillbox.tsx');
    const code = "import { Datagrid, Pillbox } from '../../ds/Datagrid';";
    const errors = validateLocalNamedImports(code, dir, [{ name: 'Pillbox', filePath: abs }]);
    expect(errors[0]).toContain("import { Pillbox } from '../../ds/Pillbox';");
  });

  it('tells the model to fix the path rather than drop the component', () => {
    // The first version stated only the fault. Healing satisfied it by
    // deleting the four house components and rebuilding from the npm library
    // — a working story that used none of the design system, which is a worse
    // outcome than the bug.
    const dir = fixture(ds);
    const errors = validateLocalNamedImports(
      "import { Datagrid, Pillbox } from '../../ds/Datagrid';", dir, components,
    );
    expect(errors[0]).toMatch(/Do NOT remove Pillbox/);
  });

  it('accepts each component imported from its own file', () => {
    const dir = fixture(ds);
    const code = [
      "import { Datagrid } from '../../ds/Datagrid';",
      "import { Pillbox } from '../../ds/Pillbox';",
      "import { Slab } from '../../ds/Slab';",
    ].join('\n');
    expect(validateLocalNamedImports(code, dir, components)).toEqual([]);
  });

  it('accepts a barrel that re-exports them all', () => {
    // `export * from './Pillbox'` has to be followed, or the correct and
    // idiomatic import for this project would be reported as an error.
    const dir = fixture(ds);
    const code = "import { Datagrid, Pillbox, Slab } from '../../ds';";
    expect(validateLocalNamedImports(code, dir, components)).toEqual([]);
  });

  it('ignores npm packages, whose files it cannot read', () => {
    const dir = fixture(ds);
    const code = "import { Button, Card } from '@mantine/core';";
    expect(validateLocalNamedImports(code, dir, components)).toEqual([]);
  });

  it('refuses a path that does not resolve, and names the file to import from', () => {
    // This used to expect silence, on the belief that import validation had
    // already reported it. It had not: three stories shipped unservable.
    const dir = fixture(ds);
    const code = "import { Whatever } from '../../ds/DoesNotExist';";
    const errors = validateLocalNamedImports(code, dir, components);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('does not resolve');
    expect(errors[0]).toContain('Vite cannot serve');
  });

  it('does not flag a default import, which binds any name it likes', () => {
    const dir = fixture({
      ...ds,
      'src/ds/Solo.tsx': 'const Solo = () => null;\nexport default Solo;',
    });
    const code = "import AnyNameAtAll from '../../ds/Solo';";
    expect(validateLocalNamedImports(code, dir, components)).toEqual([]);
  });

  it('stays quiet on a module it can read nothing from', () => {
    // A file whose exports we failed to parse tells us nothing. Inventing an
    // error for every binding in it would be worse than silence.
    const dir = fixture({ 'src/ds/Opaque.tsx': 'const x = 1;' });
    const code = "import { Something } from '../../ds/Opaque';";
    expect(validateLocalNamedImports(code, dir, components)).toEqual([]);
  });

  it('reads type and interface exports too', () => {
    const dir = fixture({
      'src/ds/types.ts': 'export interface RowShape { id: string }\nexport type Status = "on" | "off";',
    });
    const code = "import type { RowShape, Status } from '../../ds/types';";
    expect(validateLocalNamedImports(code, dir, components)).toEqual([]);
  });
});
