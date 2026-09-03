/**
 * A package the design system's own source imports is part of the design
 * system. college-town's Form is built on react-hook-form and its own story
 * imports zod; the isolation check forbade both, so the model was shown a form
 * built one way and rejected for building it that way.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { librarySourceDependencies, validateImportIsolation } from '../mcp-server/routes/generationCore.js';

let root: string;
let prevCwd: string;
let formFile: string;

const write = (rel: string, content: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-lib-deps-'));
  write('package.json', JSON.stringify({
    name: 'consumer',
    dependencies: { react: '19', 'react-hook-form': '7', zod: '4', '@hookform/resolvers': '5', lodash: '4' },
  }));
  formFile = write('src/components/form/form.tsx',
    `import * as React from "react"\nimport { FormProvider, useFormContext } from "react-hook-form"\nimport { cn } from "@/lib/utils"\nexport const Form = FormProvider\n`);
  write('src/components/form/form.stories.tsx',
    `import { useForm } from 'react-hook-form'\nimport { zodResolver } from '@hookform/resolvers/zod'\nimport * as z from 'zod'\nexport default {}\n`);
  prevCwd = process.cwd();
  process.chdir(root);
});

afterAll(() => {
  process.chdir(prevCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

const config = { importPath: '@/components', componentsPath: './src/components', importStyle: 'individual', componentFramework: 'react' };

describe('librarySourceDependencies', () => {
  it('reads what the component source and its co-located stories import, installed packages only', () => {
    const installed = new Set(['react', 'react-hook-form', 'zod', '@hookform/resolvers', 'lodash']);
    const deps = librarySourceDependencies([{ name: 'Form', filePath: formFile }], installed);
    expect([...deps].sort()).toEqual(['@hookform/resolvers', 'react', 'react-hook-form', 'zod']);
  });

  it('ignores npm components and unknown files', () => {
    const installed = new Set(['react-hook-form']);
    expect(librarySourceDependencies([
      { name: 'Button', filePath: '/x/node_modules/@mantine/core/Button.js' },
      { name: 'Ghost', filePath: path.join(root, 'nope.tsx') },
      { name: 'NoPath' },
    ], installed).size).toBe(0);
  });
});

describe('validateImportIsolation with a local design system', () => {
  // Read inside each test: formFile is assigned in beforeAll, after collection.
  const components = () => [{ name: 'Form', filePath: formFile }];

  it('permits packages the design system itself is built on', () => {
    const code = `import { useForm } from 'react-hook-form';\nimport * as z from 'zod';\nimport { zodResolver } from '@hookform/resolvers/zod';\nimport { Form } from '@/components/form/form';\n`;
    const errors = validateImportIsolation(code, config, 'react', '', components());
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('still forbids a package nothing in the design system imports', () => {
    const code = `import debounce from 'lodash';\nimport { Form } from '@/components/form/form';\n`;
    const errors = validateImportIsolation(code, config, 'react', '', components());
    expect(errors.some(e => e.includes('Forbidden import "lodash"'))).toBe(true);
  });
});
