/**
 * A per-file import the catalog prescribed must survive validation.
 *
 * On a local design system (`importPath: '@/components'`, one module per
 * component, an incomplete barrel) the validator flagged every
 * `@/components/<x>/<x>` import as a "deep/incorrect path" and collapsed it
 * onto `@/components`. Whether the deep path resolves is a fact on disk —
 * tsconfig `paths`, the declared componentsPath, node_modules — and only a
 * path that names nothing is wrong.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateStoryCode } from '../story-generator/validateStory.js';
import { resolveSpecifier, readTsconfigPaths } from '../story-generator/knowledge/moduleResolution.js';

let root: string;
let prevCwd: string;

const write = (rel: string, content: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-deep-import-'));
  write('tsconfig.json', JSON.stringify({
    files: [],
    references: [{ path: './tsconfig.app.json' }],
    compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
  }));
  write('tsconfig.app.json', '{ "compilerOptions": { "jsx": "react-jsx" } }');
  write('src/components/index.ts', "export * from './alert'\n");
  write('src/components/alert/index.ts', "export * from './alert'\n");
  write('src/components/alert/alert.tsx', 'export const Alert = () => null;\n');
  // Deliberately NOT in the barrel.
  write('src/components/data-table/data-table.tsx', 'export const DataTable = () => null;\n');
  write('src/stories/generated/.keep', '');
  // A package with an exports map that names only its root and one subpath.
  write('node_modules/vuetify/package.json', JSON.stringify({
    name: 'vuetify',
    exports: { '.': './dist/vuetify.js', './components': './lib/components/index.js', './styles': './lib/styles/main.css' },
  }));
  write('node_modules/vuetify/lib/components/index.js', '');
  // A package with no exports map: files decide.
  write('node_modules/@mantine/core/package.json', JSON.stringify({ name: '@mantine/core', main: 'index.js' }));
  write('node_modules/@mantine/core/index.js', '');
  write('node_modules/@mantine/core/styles.css', '');
  prevCwd = process.cwd();
  process.chdir(root);
});

afterAll(() => {
  process.chdir(prevCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

const localConfig = {
  importPath: '@/components',
  componentsPath: './src/components',
  importStyle: 'individual',
  componentFramework: 'react',
  generatedStoriesPath: './src/stories/generated',
};

describe('resolveSpecifier', () => {
  it('reads tsconfig paths, following references', () => {
    const paths = readTsconfigPaths(root);
    expect(paths?.paths['@/*']).toEqual(['./src/*']);
  });

  it('resolves an alias through tsconfig paths to the file', () => {
    const r = resolveSpecifier('@/components/alert/alert', { projectRoot: root, fromDir: path.join(root, 'src/stories/generated') });
    expect(r.how).toBe('tsconfig-paths');
    expect(r.file).toBe(path.join(root, 'src/components/alert/alert.tsx'));
  });

  it('resolves a directory alias to its index', () => {
    const r = resolveSpecifier('@/components', { projectRoot: root, fromDir: path.join(root, 'src/stories/generated') });
    expect(r.file).toBe(path.join(root, 'src/components/index.ts'));
  });

  it('falls back to the declared importPath → componentsPath pairing when tsconfig has no alias', () => {
    const r = resolveSpecifier('~ui/alert/alert', {
      projectRoot: root,
      fromDir: path.join(root, 'src/stories/generated'),
      importPath: '~ui',
      componentsPath: './src/components',
    });
    expect(r.how).toBe('components-path');
  });

  it('answers from a package exports map', () => {
    const opts = { projectRoot: root, fromDir: path.join(root, 'src/stories/generated') };
    expect(resolveSpecifier('vuetify/components', opts).how).toBe('package-exports');
    const deep = resolveSpecifier('vuetify/components/lib/components/VAlert', opts);
    expect(deep.file).toBeNull();
    expect(deep.detail).toContain('exports does not name');
  });

  it('answers from files when a package has no exports map', () => {
    const opts = { projectRoot: root, fromDir: path.join(root, 'src/stories/generated') };
    expect(resolveSpecifier('@mantine/core/styles.css', opts).how).toBe('package-file');
    expect(resolveSpecifier('@mantine/core/nope', opts).file).toBeNull();
  });

  it('names what it checked when nothing resolves', () => {
    const r = resolveSpecifier('@/components/missing/missing', { projectRoot: root, fromDir: path.join(root, 'src/stories/generated') });
    expect(r.file).toBeNull();
    expect(r.how).toBe('unresolved');
    expect(r.detail).toContain('tsconfig paths');
  });
});

describe('validateStoryCode on a local design system', () => {
  const story = (imports: string) => `import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
${imports}

const meta = { title: 'Generated/X' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { render: () => <div><Alert /><DataTable /></div> };
`;

  it('keeps a per-file import that resolves, exactly as written', () => {
    const code = story(`import { Alert } from '@/components/alert/alert';\nimport { DataTable } from '@/components/data-table/data-table';`);
    const result = validateStoryCode(code, 'story.tsx', localConfig);
    expect(result.errors.filter(e => e.includes('Import path error'))).toEqual([]);
    expect(result.fixedCode).toBeUndefined();
    expect(result.isValid).toBe(true);
  });

  it('still rejects and rewrites a deep path that names nothing', () => {
    const code = story(`import { Alert } from '@/components/alert/alert';\nimport { DataTable } from '@/components/lib/data-table';`);
    const result = validateStoryCode(code, 'story.tsx', localConfig);
    expect(result.errors.some(e => e.includes('Import path error') && e.includes('@/components/lib/data-table'))).toBe(true);
    expect(result.fixedCode).toContain("import { Alert } from '@/components/alert/alert'");
    expect(result.fixedCode).toContain("import { DataTable } from '@/components'");
  });

  it('collapses a non-existent Vuetify deep path onto the barrel, as before', () => {
    const vueConfig = { importPath: 'vuetify/components', componentFramework: 'vue', generatedStoriesPath: './src/stories/generated' };
    const code = `import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { VAlert } from 'vuetify/components/lib/components/VAlert';
import { VBtn } from 'vuetify/components/lib/components/VBtn';
const meta = { title: 'Generated/X' } satisfies Meta;
export default meta;
export const Default = { render: () => ({ components: { VAlert, VBtn }, template: '<VAlert />' }) };
`;
    const result = validateStoryCode(code, 'story.ts', vueConfig);
    expect(result.fixedCode).toContain("from 'vuetify/components'");
    expect(result.fixedCode).not.toContain('lib/components');
  });
});
