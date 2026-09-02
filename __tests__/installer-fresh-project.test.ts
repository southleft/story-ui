/**
 * What a fresh `storybook init` project taught the installer.
 *
 * Every case here is a defect a first-time user hit following the README:
 * the scaffold detected as the component library and then deleted, a typed
 * API key discarded because .env existed, the port written to three places
 * that disagreed, absolute machine paths in the config, "version: unknown"
 * from a regex that never matched what init wrote, and an import path that
 * pointed at a directory with no index.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cleanupDefaultStorybookComponents,
  detectLocalComponentLibrary,
  scriptPort,
  withScriptPort,
  readScriptPort,
  ensureScriptPort,
  readConfiguredPort,
  toProjectRelative,
} from '../cli/setup.js';
import { mergeEnv, parseEnv, isUsableApiKey } from '../cli/envFile.js';
import { readConfigField } from '../cli/update.js';
import {
  analyzeExistingStories,
  isStorybookScaffoldStory,
  findMostLikelyComponentDirectory,
  findLocalComponentDirectory,
  localImportForComponents,
  relativeImportResolves,
  autoDetectDesignSystem,
} from '../story-generator/configLoader.js';

const tmp = (name: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `sui-${name}-`)));
const write = (root: string, rel: string, content = '') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

const SCAFFOLD_STORY = `import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Button } from './Button';
// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = { title: 'Example/Button', component: Button } satisfies Meta<typeof Button>;
export default meta;`;
const SCAFFOLD_COMPONENT = `import './button.css';
export const Button = ({ primary = false, label }) => <button className={['storybook-button', primary ? 'storybook-button--primary' : ''].join(' ')}>{label}</button>;`;
const CONFIGURE_MDX = `import { Meta } from "@storybook/addon-docs/blocks";
import Github from "./assets/github.svg";
import Styling from "./assets/styling.png";
<Meta title="Configure your project" />
# Configure your project — https://storybook.js.org/docs/configure
`;
const USER_STORY = `import type { Meta } from '@storybook/react-vite';
import { Badge } from '../components/Badge';
export default { title: 'Components/Badge', component: Badge } satisfies Meta<typeof Badge>;`;

/** A project the way `npm create vite` + `storybook init` leaves it, plus the user's own src/components. */
function freshProject(opts: { componentsIndex?: boolean; srcIndex?: string } = { componentsIndex: true }) {
  const root = tmp('fresh');
  write(root, 'package.json', JSON.stringify({ name: 'fresh', devDependencies: { '@storybook/react-vite': '^10.5.0', storybook: '^10.5.0' } }));
  write(root, 'src/stories/Button.stories.ts', SCAFFOLD_STORY);
  write(root, 'src/stories/Button.tsx', SCAFFOLD_COMPONENT);
  write(root, 'src/stories/Header.stories.ts', SCAFFOLD_STORY.replace(/Button/g, 'Header'));
  write(root, 'src/stories/Header.tsx', SCAFFOLD_COMPONENT.replace(/Button/g, 'Header').replace(/button/g, 'header'));
  write(root, 'src/stories/Page.stories.ts', SCAFFOLD_STORY.replace(/Button/g, 'Page'));
  write(root, 'src/stories/Page.tsx', SCAFFOLD_COMPONENT.replace(/Button/g, 'Page').replace(/button/g, 'page'));
  write(root, 'src/stories/button.css', '.storybook-button {}');
  write(root, 'src/stories/Configure.mdx', CONFIGURE_MDX);
  write(root, 'src/stories/assets/github.svg', '<svg/>');
  write(root, 'src/stories/assets/styling.png', 'png');
  write(root, 'src/stories/assets/avif-test-image.avif', 'avif');
  write(root, 'src/components/Button.tsx', 'export const Button = () => <button />;');
  write(root, 'src/components/Badge.tsx', 'export const Badge = () => <span />;');
  write(root, 'src/components/Card.tsx', 'export const Card = () => <div />;');
  if (opts.componentsIndex) write(root, 'src/components/index.ts', "export * from './Button';\nexport * from './Badge';\nexport * from './Card';\n");
  if (opts.srcIndex) write(root, 'src/index.ts', opts.srcIndex);
  return root;
}

function inDir<T>(dir: string, fn: () => T): T {
  const cwd = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(cwd); }
}

describe('scaffold-aware detection (defect 1)', () => {
  it('recognises the scaffold stories by their markers and not a project story of the same name', () => {
    expect(isStorybookScaffoldStory('Button.stories.ts', SCAFFOLD_STORY)).toBe(true);
    expect(isStorybookScaffoldStory('Configure.mdx', CONFIGURE_MDX)).toBe(true);
    // A project's own Button story imports storybook too — that is not the marker.
    expect(isStorybookScaffoldStory('Button.stories.tsx', USER_STORY.replace(/Badge/g, 'Button'))).toBe(false);
    expect(isStorybookScaffoldStory('Badge.stories.tsx', SCAFFOLD_STORY)).toBe(false);
  });

  it('leaves the scaffold out of the story analysis', () => {
    const root = freshProject();
    const analysis = analyzeExistingStories(root);
    expect(analysis.scaffoldFiles.length).toBe(3);
    expect(analysis.storyFiles).toEqual([]);
    expect(analysis.componentDirs).toEqual([]);
  });

  it('never chooses a directory whose only stories are the scaffold', () => {
    const root = freshProject();
    expect(findMostLikelyComponentDirectory([], root)).toBe(path.join(root, 'src/components'));
    expect(findLocalComponentDirectory(root)).toEqual({ dir: 'src/components', count: 3 });
  });

  it('prefers the directory that holds components when stories live apart from them', () => {
    const root = freshProject();
    write(root, 'src/stories/Badge.stories.tsx', USER_STORY);
    const analysis = analyzeExistingStories(root);
    expect(analysis.componentDirs).toEqual([path.join(root, 'src/stories')]);
    expect(findMostLikelyComponentDirectory(analysis.componentDirs, root)).toBe(path.join(root, 'src/components'));
  });

  it('autoDetectDesignSystem on the fresh project records src/components, imported as ../../components', () => {
    const root = freshProject();
    const detected = inDir(root, () => autoDetectDesignSystem());
    expect(detected?.componentsPath).toBe(path.join(root, 'src/components'));
    expect(detected?.importPath).toBe('../../components');
    expect(detected?.importStyle).toBeUndefined();
  });

  it('detectLocalComponentLibrary agrees, for the interactive and custom paths', () => {
    const root = freshProject();
    expect(detectLocalComponentLibrary(root, './src/stories/generated/')).toEqual({ componentsPath: './src/components', importPath: '../../components', count: 3 });
  });
});

describe('a relative importPath must resolve (Sail Shelf)', () => {
  it('uses the ancestor barrel when the component directory has no index', () => {
    const root = freshProject({ componentsIndex: false, srcIndex: "export * from './components/Button';\nexport * from './components/Badge';\nexport { Card } from './components/Card';\n" });
    const generated = path.join(root, 'src/stories/generated');
    const local = localImportForComponents(generated, path.join(root, 'src/components'), root);
    expect(local).toEqual({ importPath: '../..', barrel: path.join(root, 'src/index.ts') });
    expect(relativeImportResolves(generated, local.importPath)).toBe(true);
    // The naive form is exactly what failed: a directory with no index.
    expect(relativeImportResolves(generated, '../../components')).toBe(false);

    const detected = inDir(root, () => autoDetectDesignSystem());
    expect(detected?.importPath).toBe('../..');
    expect(detected?.componentsPath).toBe(path.join(root, 'src/components'));
    expect(detected?.importStyle).toBeUndefined();
    expect(detectLocalComponentLibrary(root, './src/stories/generated/')).toEqual({ componentsPath: './src/components', importPath: '../..', count: 3 });
  });

  it('ignores an ancestor index that does not re-export the components', () => {
    const root = freshProject({ componentsIndex: false, srcIndex: "export { App } from './App';\n" });
    const generated = path.join(root, 'src/stories/generated');
    expect(localImportForComponents(generated, path.join(root, 'src/components'), root)).toEqual({ importPath: '../../components', importStyle: 'individual' });
    const detected = inDir(root, () => autoDetectDesignSystem());
    expect(detected?.importStyle).toBe('individual');
    expect(detectLocalComponentLibrary(root, './src/stories/generated/')).toEqual({ componentsPath: './src/components', importPath: '../../components', count: 3, importStyle: 'individual' });
  });

  it('falls back to per-component paths when there is no barrel anywhere', () => {
    const root = freshProject({ componentsIndex: false });
    const generated = path.join(root, 'src/stories/generated');
    expect(localImportForComponents(generated, path.join(root, 'src/components'), root)).toEqual({ importPath: '../../components', importStyle: 'individual' });
  });

  it('resolves module files with or without their extension', () => {
    const root = freshProject();
    const generated = path.join(root, 'src/stories/generated');
    expect(relativeImportResolves(generated, '../../components/Badge')).toBe(true);
    expect(relativeImportResolves(generated, '../../components/Badge.tsx')).toBe(true);
    expect(relativeImportResolves(generated, '../../components/Nope')).toBe(false);
    expect(relativeImportResolves(generated, '@mantine/core')).toBe(false);
  });
});

describe('scaffold cleanup covers Configure.mdx and its assets (defect 8)', () => {
  it('removes the scaffold, its MDX and the images it imports, and keeps the user’s files', () => {
    const root = freshProject();
    write(root, 'src/stories/assets/team-photo.png', 'mine');
    inDir(root, () => cleanupDefaultStorybookComponents());
    for (const gone of ['Button.stories.ts', 'Button.tsx', 'Header.tsx', 'Page.stories.ts', 'button.css', 'Configure.mdx', 'assets/github.svg', 'assets/styling.png', 'assets/avif-test-image.avif']) {
      expect(fs.existsSync(path.join(root, 'src/stories', gone)), gone).toBe(false);
    }
    expect(fs.existsSync(path.join(root, 'src/stories/assets/team-photo.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/components/Button.tsx'))).toBe(true);
  });

  it('removes the assets directory when nothing of the user’s is in it', () => {
    const root = freshProject();
    inDir(root, () => cleanupDefaultStorybookComponents());
    expect(fs.existsSync(path.join(root, 'src/stories/assets'))).toBe(false);
  });

  it('keeps a project Configure.mdx that is not the scaffold', () => {
    const root = freshProject();
    write(root, 'src/stories/Configure.mdx', '<Meta title="Our setup" />\n# How we configure things\n');
    inDir(root, () => cleanupDefaultStorybookComponents());
    expect(fs.existsSync(path.join(root, 'src/stories/Configure.mdx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/stories/assets/github.svg'))).toBe(true);
  });
});

describe('.env merge (defect 2)', () => {
  const entries = (key?: string) => [
    { key: 'DEFAULT_PROVIDER', value: 'claude', comment: 'provider' },
    { key: 'ANTHROPIC_API_KEY', value: key || 'your-api-key-here', comment: 'key', onlyIfPlaceholder: !key },
    { key: 'VITE_STORY_UI_PORT', value: '4120', comment: 'port' },
  ];
  const REAL = 'sk-ant-api03-' + 'x'.repeat(40);

  it('writes a fresh file when none exists', () => {
    const r = mergeEnv(null, entries(REAL));
    expect(parseEnv(r.content)).toEqual({ DEFAULT_PROVIDER: 'claude', ANTHROPIC_API_KEY: REAL, VITE_STORY_UI_PORT: '4120' });
    expect(r.appended).toEqual(['DEFAULT_PROVIDER', 'ANTHROPIC_API_KEY', 'VITE_STORY_UI_PORT']);
  });

  it('replaces the provider key line in an existing file and touches nothing else', () => {
    const existing = `# mine\nVITE_API_URL=http://x\nANTHROPIC_API_KEY=your-api-key-here\n# ANTHROPIC_API_KEY=commented-out-example\nVITE_STORY_UI_PORT=4001\n`;
    const r = mergeEnv(existing, entries(REAL));
    expect(r.replaced).toEqual(['ANTHROPIC_API_KEY', 'VITE_STORY_UI_PORT']);
    expect(r.appended).toEqual(['DEFAULT_PROVIDER']);
    expect(r.content).toContain('# mine\nVITE_API_URL=http://x\n');
    expect(r.content).toContain('# ANTHROPIC_API_KEY=commented-out-example');
    expect(r.content).toContain(`ANTHROPIC_API_KEY=${REAL}\n`);
    expect(r.content).toContain('VITE_STORY_UI_PORT=4120');
    expect(r.content).not.toContain('VITE_STORY_UI_PORT=4001');
  });

  it('keeps a real key already in the file when init has none to write, and replaces a placeholder', () => {
    const kept = mergeEnv(`ANTHROPIC_API_KEY=${REAL}\n`, entries());
    expect(kept.kept).toContain('ANTHROPIC_API_KEY');
    expect(kept.content).toContain(`ANTHROPIC_API_KEY=${REAL}`);
    const replaced = mergeEnv('ANTHROPIC_API_KEY=undefined\n', entries());
    expect(replaced.replaced).toContain('ANTHROPIC_API_KEY');
    expect(parseEnv(replaced.content).ANTHROPIC_API_KEY).toBe('your-api-key-here');
  });

  it('reports nothing changed when the file already says what init would write', () => {
    const r = mergeEnv(`DEFAULT_PROVIDER=claude\nANTHROPIC_API_KEY=${REAL}\nVITE_STORY_UI_PORT=4120\n`, entries(REAL));
    expect(r.replaced).toEqual([]);
    expect(r.appended).toEqual([]);
  });

  it('treats placeholders and short values as no key', () => {
    for (const bad of ['your-api-key-here', 'your-anthropic-key', 'undefined', 'null', '', 'sk-ant-short', '<paste here>', undefined]) {
      expect(isUsableApiKey(bad), String(bad)).toBe(false);
    }
    expect(isUsableApiKey(REAL)).toBe(true);
    expect(isUsableApiKey(`"${REAL}"`)).toBe(true);
  });
});

describe('the port in the story-ui script (defect 3)', () => {
  it('reads and writes the --port of the script', () => {
    expect(scriptPort(undefined)).toBeNull();
    expect(scriptPort('story-ui start')).toBeNull();
    expect(scriptPort('story-ui start --port 4120')).toBe(4120);
    expect(withScriptPort(undefined, 4120)).toBe('story-ui start --port 4120');
    expect(withScriptPort('story-ui start', 4120)).toBe('story-ui start --port 4120');
    expect(withScriptPort('story-ui start --port 4001', 4120)).toBe('story-ui start --port 4120');
    expect(withScriptPort('story-ui start --port=4001 --mcp', '4120')).toBe('story-ui start --port 4120 --mcp');
  });

  it('ensureScriptPort rewrites package.json and readConfiguredPort agrees with .env first', () => {
    const root = tmp('script');
    write(root, 'package.json', JSON.stringify({ name: 'x', scripts: { storybook: 'storybook dev -p 6006', 'story-ui': 'story-ui start --port 4001' } }, null, 2) + '\n');
    expect(readScriptPort(root)).toBe(4001);
    expect(ensureScriptPort(root, 4120)).toEqual({ action: 'updated' });
    expect(ensureScriptPort(root, 4120)).toEqual({ action: 'unchanged' });
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.scripts['story-ui']).toBe('story-ui start --port 4120');
    expect(pkg.scripts.storybook).toBe('storybook dev -p 6006');
    expect(readScriptPort(root)).toBe(4120);
    write(root, '.env', 'VITE_STORY_UI_PORT=4130\n');
    expect(readConfiguredPort(root)).toEqual({ port: 4130, source: '.env VITE_STORY_UI_PORT' });
  });
});

describe('project-relative config paths (defect 4)', () => {
  it('writes paths relative to the project, trailing slash kept, and leaves outside paths absolute', () => {
    const root = tmp('rel');
    expect(toProjectRelative('./src/stories/generated/', root)).toBe('./src/stories/generated/');
    expect(toProjectRelative(path.join(root, 'src/stories/generated'), root)).toBe('./src/stories/generated');
    expect(toProjectRelative(path.join(root, 'src/components'), root)).toBe('./src/components');
    expect(toProjectRelative('src/components', root)).toBe('./src/components');
    expect(toProjectRelative(root, root)).toBe('.');
    expect(toProjectRelative('/somewhere/else/components', root)).toBe('/somewhere/else/components');
  });
});

describe('reading the version from the config (defect 5)', () => {
  it('accepts the JSON-quoted key init writes, and a bare key', () => {
    const initWritten = `module.exports = ${JSON.stringify({ importPath: '../../components', generatedStoriesPath: './src/stories/generated/', componentFramework: 'react', _storyUIVersion: '4.17.0' }, null, 2)};`;
    expect(readConfigField(initWritten, '_storyUIVersion')).toBe('4.17.0');
    expect(readConfigField(initWritten, 'generatedStoriesPath')).toBe('./src/stories/generated/');
    expect(readConfigField(initWritten, 'componentFramework')).toBe('react');
    const hand = `module.exports = {\n  importPath: '@mantine/core',\n  generatedStoriesPath: "./stories/generated",\n  _storyUIVersion: '4.16.2',\n};`;
    expect(readConfigField(hand, '_storyUIVersion')).toBe('4.16.2');
    expect(readConfigField(hand, 'generatedStoriesPath')).toBe('./stories/generated');
    expect(readConfigField(hand, 'nope')).toBeUndefined();
  });
});
