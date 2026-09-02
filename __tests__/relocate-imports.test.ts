import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { relocateUnresolvableImports, unresolvedRelativeImports, resolveLocalModule } from '../story-generator/editing/relocateImports';

let root: string; let generatedDir: string; let badge: string; let button: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'relocate-'));
  fs.mkdirSync(path.join(root, 'src/components/Badge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/components/Button'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/stories/generated'), { recursive: true });
  badge = path.join(root, 'src/components/Badge/Badge.tsx'); fs.writeFileSync(badge, 'export const Badge = () => null;');
  button = path.join(root, 'src/components/Button/Button.tsx'); fs.writeFileSync(button, 'export const Button = () => null;');
  fs.writeFileSync(path.join(root, 'src/index.ts'), "export * from './components/Badge/Badge';");
  generatedDir = path.join(root, 'src/stories/generated');
});

describe('relative imports that Vite cannot serve', () => {
  it('a directory without an index does not resolve; the barrel above it does', () => {
    expect(resolveLocalModule('../../components', generatedDir)).toBeNull();
    expect(resolveLocalModule('../../index', generatedDir)).toMatch(/src\/index\.ts$/);
  });

  it('rewrites known components to their own files and leaves the rest for validation', () => {
    const code = [
      "import React from 'react';",
      "import { Badge, Button } from '../../components';",
      "import { Mystery } from '../../components';",
      "import type { Meta } from '@storybook/react-vite';",
    ].join('\n');
    const r = relocateUnresolvableImports(code, generatedDir, [
      { name: 'Badge', filePath: badge }, { name: 'Button', filePath: button },
    ]);
    expect(r.code).toContain("import { Badge } from '../../components/Badge/Badge';");
    expect(r.code).toContain("import { Button } from '../../components/Button/Button';");
    expect(r.code).toContain("import { Mystery } from '../../components';");
    expect(r.relocated).toHaveLength(2);
    expect(r.unresolved).toEqual([{ specifier: '../../components', bindings: ['Mystery'] }]);
    expect(unresolvedRelativeImports(r.code, generatedDir)).toEqual(['../../components']);
  });

  it('leaves imports that resolve untouched', () => {
    const code = "import { Badge } from '../../index';\nimport { Button } from '../../components/Button/Button';";
    const r = relocateUnresolvableImports(code, generatedDir, [{ name: 'Badge', filePath: badge }]);
    expect(r.code).toBe(code);
    expect(r.relocated).toEqual([]);
  });
});
