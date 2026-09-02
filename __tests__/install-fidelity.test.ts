/**
 * An unattended install on a custom React library (Storybook 10 scaffold,
 * quoted keys in .storybook/main.ts, the project's own package name as the
 * only bare import) found five ways init could print ok:true over a broken
 * result. Each test here is one of them.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  insertConfigProperty,
  viteFinalConfigSnippet,
  storybookMainSyntaxError,
  ensureStoriesGlobCoversMdx,
  storiesArrayCovers,
  managerHeadPort,
  withManagerHeadPort,
  ensureManagerHeadPort,
  readConfiguredPort,
  storyUiIsLinked,
  registryImportSpecifier,
} from '../cli/setup.js';
import { autoDetectDesignSystem, relativeImportPath } from '../story-generator/configLoader.js';

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Storybook 10's own scaffold: quoted keys, no trailing comma, a comment before the last property. */
const SCAFFOLD_MAIN = `import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  "stories": [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@storybook/addon-docs"
  ],
  "framework": "@storybook/react-vite",
  // Serves the brand mark referenced by \`brandImage\` in manager.ts.
  "staticDirs": ["./assets"]
};
export default config;
`;

describe('insertConfigProperty (defect 1: the missing comma)', () => {
  it('adds the comma the scaffold omits, and the result parses', () => {
    const out = insertConfigProperty(SCAFFOLD_MAIN, viteFinalConfigSnippet());
    expect(out).not.toBeNull();
    expect(out).toContain('"staticDirs": ["./assets"],\n  viteFinal: async (config) => {');
    expect(storybookMainSyntaxError(out!, 'main.ts')).toBeNull();
  });

  it('does not double a comma that is already there', () => {
    const src = SCAFFOLD_MAIN.replace('"staticDirs": ["./assets"]', '"staticDirs": ["./assets"],');
    const out = insertConfigProperty(src, 'viteFinal: async (c) => c,')!;
    expect(out).toContain('"staticDirs": ["./assets"],\n  viteFinal');
    expect(out).not.toContain(',,');
    expect(storybookMainSyntaxError(out, 'main.ts')).toBeNull();
  });

  it('puts the comma before a trailing comment, not after it', () => {
    const src = SCAFFOLD_MAIN.replace('"staticDirs": ["./assets"]', '"staticDirs": ["./assets"] // brand mark\n  /* end of\n     the scaffold */');
    const out = insertConfigProperty(src, 'viteFinal: async (c) => c,')!;
    expect(out).toContain('"staticDirs": ["./assets"], // brand mark');
    expect(storybookMainSyntaxError(out, 'main.ts')).toBeNull();
  });

  it('handles an empty object without inserting a comma', () => {
    const out = insertConfigProperty('const config = {\n};\nexport default config;\n', 'viteFinal: async (c) => c,')!;
    expect(out).toBe('const config = {\n  viteFinal: async (c) => c,\n};\nexport default config;\n');
    expect(storybookMainSyntaxError(out, 'main.ts')).toBeNull();
  });

  it('returns null when there is no closing `};` before export default', () => {
    expect(insertConfigProperty('export default { stories: [] }\n', 'x: 1,')).toBeNull();
  });
});

describe('storybookMainSyntaxError (defect 1: check must parse main.*)', () => {
  it('reports the line of the syntax error the old splice produced', () => {
    // Exactly what the previous init wrote: viteFinal after a property with no comma.
    const broken = SCAFFOLD_MAIN.replace('"staticDirs": ["./assets"]\n};', '"staticDirs": ["./assets"]\n  viteFinal: async (config) => config,\n};');
    const problem = storybookMainSyntaxError(broken, 'main.ts');
    expect(problem).not.toBeNull();
    expect(problem!.line).toBe(14);
    expect(problem!.message).toMatch(/','|expected/i);
  });

  it('is silent on a valid file (and on a .js one)', () => {
    expect(storybookMainSyntaxError(SCAFFOLD_MAIN, 'main.ts')).toBeNull();
    expect(storybookMainSyntaxError('module.exports = { stories: ["../src/**/*.mdx"] };\n', 'main.js')).toBeNull();
  });
});

describe('ensureStoriesGlobCoversMdx (defect 4: the quoted "stories" key)', () => {
  it('finds a quoted stories array and extends it', () => {
    const root = tmp('sui-globs-');
    fs.mkdirSync(path.join(root, '.storybook'));
    const main = SCAFFOLD_MAIN.replace('"../src/**/*.mdx",\n    ', '');
    fs.writeFileSync(path.join(root, '.storybook/main.ts'), main);
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src/stories'), root);
    expect(result).toEqual({ checked: true, covered: true, added: "'../src/stories/**/*.@(mdx|stories.@(js|jsx|ts|tsx))'" });
    const written = fs.readFileSync(path.join(root, '.storybook/main.ts'), 'utf-8');
    expect(storybookMainSyntaxError(written, 'main.ts')).toBeNull();
  });

  it('reports an already-covering quoted array as covered and leaves the file alone', () => {
    const root = tmp('sui-globs2-');
    fs.mkdirSync(path.join(root, '.storybook'));
    fs.writeFileSync(path.join(root, '.storybook/main.ts'), SCAFFOLD_MAIN);
    // The scaffold's "../src/**/*.mdx" reaches src/stories: nothing to add
    // (a second glob would index every Story UI file twice), and the quoted
    // key must not read as "no stories array".
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src/stories'), root);
    expect(result).toEqual({ checked: true, covered: true, added: null });
    expect(fs.readFileSync(path.join(root, '.storybook/main.ts'), 'utf-8')).toBe(SCAFFOLD_MAIN);
  });

  it('splices after the last element of a multi-line array, comma first', () => {
    const root = tmp('sui-globs3-');
    fs.mkdirSync(path.join(root, '.storybook'));
    fs.writeFileSync(path.join(root, '.storybook/main.ts'), SCAFFOLD_MAIN.replace('"../src/**/*.mdx",\n    ', ''));
    const result = ensureStoriesGlobCoversMdx(path.join(root, 'src/stories'), root);
    const written = fs.readFileSync(path.join(root, '.storybook/main.ts'), 'utf-8');
    expect(written).toContain(`"../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",\n    ${result.added}\n  ],`);
  });

  it('judges coverage by matching the globs, object specifiers included', () => {
    const mdx = '../src/stories/StoryUIV2/StoryUIV2.mdx';
    expect(storiesArrayCovers(`"../src/**/*.mdx"`, mdx)).toBe(true);
    expect(storiesArrayCovers(`'../src/**/*.@(mdx|stories.@(js|tsx))'`, mdx)).toBe(true);
    expect(storiesArrayCovers(`'../src/**/*.{mdx,tsx}'`, mdx)).toBe(true);
    expect(storiesArrayCovers(`'../src/**/*.stories.@(js|jsx|ts|tsx)'`, mdx)).toBe(false);
    expect(storiesArrayCovers(`'../src/stories/*.mdx'`, mdx)).toBe(false);
    expect(storiesArrayCovers(`'../docs/**/*.mdx', '../src/**/*.stories.tsx'`, mdx)).toBe(false);
    expect(storiesArrayCovers(`{ directory: '../src', files: '**/*.mdx' }`, mdx)).toBe(true);
    expect(storiesArrayCovers(`{ directory: '../src/stories' }`, mdx)).toBe(true);
    expect(storiesArrayCovers(`{ directory: '../other' }`, mdx)).toBe(false);
    expect(storiesArrayCovers(`...extra`, mdx)).toBe(false);
  });
});

describe('manager-head.html port meta (defect 2: the manager page ignored the port)', () => {
  it('creates the meta from nothing', () => {
    const out = withManagerHeadPort(null, 4110);
    expect(out).toContain('<meta name="story-ui-port" content="4110">');
    expect(managerHeadPort(out)).toBe('4110');
  });

  it('replaces an existing story-ui-port meta and keeps everything else', () => {
    const existing = '<link rel="icon" href="/x.png">\n<meta content="4001" name="story-ui-port" />\n<script>window.a = 1</script>\n';
    const out = withManagerHeadPort(existing, 4110);
    expect(out).toContain('<link rel="icon" href="/x.png">');
    expect(out).toContain('<script>window.a = 1</script>');
    expect(out.match(/story-ui-port/g)).toHaveLength(1);
    expect(managerHeadPort(out)).toBe('4110');
  });

  it('appends to a manager-head.html that has other content', () => {
    const out = withManagerHeadPort('<link rel="icon" href="/x.png">', 4110);
    expect(out.startsWith('<link rel="icon" href="/x.png">\n')).toBe(true);
    expect(managerHeadPort(out)).toBe('4110');
  });

  it('ensureManagerHeadPort is idempotent on disk', () => {
    const root = tmp('sui-head-');
    fs.mkdirSync(path.join(root, '.storybook'));
    expect(ensureManagerHeadPort(root, 4110).action).toBe('created');
    expect(ensureManagerHeadPort(root, 4110).action).toBe('unchanged');
    expect(ensureManagerHeadPort(root, 4111).action).toBe('updated');
    const written = fs.readFileSync(path.join(root, '.storybook/manager-head.html'), 'utf-8');
    expect(managerHeadPort(written)).toBe('4111');
    expect(written.match(/<meta/g)).toHaveLength(1);
  });

  it('readConfiguredPort prefers .env, then the story-ui script', () => {
    const root = tmp('sui-port-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'story-ui': 'story-ui start --port 4222' } }));
    expect(readConfiguredPort(root)).toEqual({ port: 4222, source: 'package.json "story-ui" script' });
    fs.writeFileSync(path.join(root, '.env'), 'ANTHROPIC_API_KEY=x\nVITE_STORY_UI_PORT=4110\n');
    expect(readConfiguredPort(root)).toEqual({ port: 4110, source: '.env VITE_STORY_UI_PORT' });
    expect(readConfiguredPort(tmp('sui-noport-'))).toBeNull();
  });
});

describe('autoDetectDesignSystem (defect 3: the project\'s own name as importPath)', () => {
  it('emits a relative path to the component directory, never the package name', () => {
    const root = fs.realpathSync(tmp('sui-self-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@sail-shelf/ui', devDependencies: { '@storybook/react-vite': '^10' } }));
    fs.mkdirSync(path.join(root, 'src/components/Button'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/components/Button/Button.tsx'), 'export const Button = () => null;');
    fs.writeFileSync(path.join(root, 'src/components/Button/Button.stories.tsx'), "import { Button } from '@sail-shelf/ui';\nexport default { component: Button };\n");
    fs.mkdirSync(path.join(root, 'src/components/Badge'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/components/Badge/Badge.tsx'), 'export const Badge = () => null;');
    fs.writeFileSync(path.join(root, 'src/components/Badge/Badge.stories.tsx'), "import { Badge } from '@sail-shelf/ui';\nexport default { component: Badge };\n");
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const detected = autoDetectDesignSystem();
      expect(detected).not.toBeNull();
      expect(detected!.importPath).toBe('../../components');
      expect(detected!.componentsPath).toBe(path.join(root, 'src/components'));
    } finally {
      process.chdir(cwd);
    }
  });

  it('still trusts an installed package the stories import', () => {
    const root = fs.realpathSync(tmp('sui-npm-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'my-app', dependencies: { '@mantine/core': '^8' } }));
    fs.mkdirSync(path.join(root, 'src/stories'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/stories/Button.stories.tsx'), "import { Button } from '@mantine/core';\nexport default { component: Button };\n");
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const detected = autoDetectDesignSystem();
      expect(detected!.importPath).toBe('@mantine/core');
      expect(detected!.componentsPath).toBeUndefined();
    } finally {
      process.chdir(cwd);
    }
  });

  it('relativeImportPath always starts with a dot', () => {
    expect(relativeImportPath('/p/src/stories/generated', '/p/src/components')).toBe('../../components');
    expect(relativeImportPath('/p/src', '/p/src/components')).toBe('./components');
  });
});

describe('registryImportSpecifier (the Voice Canvas registry follows the relative path)', () => {
  it('re-roots a relative importPath and finds the parent barrel', () => {
    const root = tmp('sui-reg-');
    fs.mkdirSync(path.join(root, 'src/components/Button'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/index.ts'), "export * from './components/Button';");
    const registryDir = path.join(root, 'src/stories/StoryUI/voice/canvas');
    const config = { importPath: '../../components', componentsPath: path.join(root, 'src/components'), generatedStoriesPath: path.join(root, 'src/stories/generated') };
    expect(registryImportSpecifier(config, registryDir)).toBe('../../../../index');
    fs.writeFileSync(path.join(root, 'src/components/index.ts'), "export * from './Button';");
    expect(registryImportSpecifier(config, registryDir)).toBe('../../../../components/index');
    expect(registryImportSpecifier({ importPath: '@mantine/core' }, registryDir)).toBe('@mantine/core');
    expect(registryImportSpecifier({ importPath: '../../nowhere', generatedStoriesPath: path.join(root, 'src/stories/generated') }, registryDir)).toBeNull();
  });
});

describe('storyUiIsLinked (defect 5: npm install prunes a linked package)', () => {
  it('sees a symlinked @tpitre/story-ui and nothing else', () => {
    const root = tmp('sui-link-');
    const real = path.join(root, 'elsewhere');
    fs.mkdirSync(real);
    fs.mkdirSync(path.join(root, 'node_modules/@tpitre'), { recursive: true });
    expect(storyUiIsLinked(root)).toBe(false);
    fs.symlinkSync(real, path.join(root, 'node_modules/@tpitre/story-ui'));
    expect(storyUiIsLinked(root)).toBe(true);
    expect(storyUiIsLinked(tmp('sui-nolink-'))).toBe(false);
  });
});
