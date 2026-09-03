import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unknownCanvasComponents, voiceCanvasStorySource } from '../mcp-server/routes/canvasGenerate.js';
import { componentImportLines, jsxCodeToStory } from '../mcp-server/routes/canvasSave.js';
import { importSpecifierFor, importHomeResolver } from '../story-generator/knowledge/importSpecifier.js';
import { StoryTracker } from '../story-generator/storyTracker.js';
import { storybookWatcherHint } from '../story-generator/verify/verifyStory.js';

describe('canvas scope check', () => {
  const known = ['Button', 'Card', 'Text', 'Badge'];

  it('names the tags the design system does not have', () => {
    const code = `const Canvas = () => (
  <Card>
    <Card.Section><Text>Hi</Text></Card.Section>
    <BrandBadge tone="new" />
    <PriceTag>$4</PriceTag>
    <div className="x"><Button>Go</Button></div>
  </Card>
);
render(<Canvas />);`;
    expect(unknownCanvasComponents(code, known)).toEqual(['BrandBadge', 'PriceTag']);
  });

  it('accepts components the canvas defines itself, React builtins and HTML', () => {
    const code = `const Row = ({ children }) => <div>{children}</div>;
function Tile() { return <Badge>1</Badge>; }
const Canvas = () => <React.Fragment><Fragment><Row><Tile /></Row></Fragment></React.Fragment>;
render(<Canvas />);`;
    expect(unknownCanvasComponents(code, known)).toEqual([]);
  });

  it('reports nothing when discovery knows nothing — absent is not zero', () => {
    // The caller skips the check entirely for an empty catalog; the predicate
    // itself still answers honestly.
    expect(unknownCanvasComponents('<Whatever />', [])).toEqual(['Whatever']);
  });
});

describe('canvas save import lines', () => {
  it('groups components by the module discovery places them in', () => {
    const resolve = (name: string) => ({
      Button: { specifier: '../../components/Button/Button', defaultExport: false },
      Card: { specifier: '../../components/Card/Card', defaultExport: false },
      CardHeader: { specifier: '../../components/Card/Card', defaultExport: false },
      Avatar: { specifier: '@acme/avatar', defaultExport: true },
    } as Record<string, { specifier: string; defaultExport: boolean }>)[name];
    expect(componentImportLines(['Avatar', 'Button', 'Card', 'CardHeader', 'Mystery'], '@acme/ui', resolve)).toEqual([
      "import { Button } from '../../components/Button/Button';",
      "import { Card, CardHeader } from '../../components/Card/Card';",
      "import { Mystery } from '@acme/ui';",
      "import Avatar from '@acme/avatar';",
    ]);
  });

  it('falls back to the base path when no resolver is given', () => {
    const story = jsxCodeToStory(`const Canvas = () => <Card><Text>Hi</Text></Card>;\nrender(<Canvas />);`, 'Hi', '@mantine/core');
    expect(story).toContain("import { Card, Text } from '@mantine/core';");
  });
});

describe('import specifier precedence', () => {
  it('prefers the declared path, then discovery, then a local file, then the base path', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-')));
    const file = path.join(dir, 'src', 'components', 'Tile.tsx');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const Tile = () => null;');
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const config: any = {
        importPath: '@acme/ui',
        generatedStoriesPath: './src/stories/generated/',
        components: [{ name: 'Declared', importPath: '@acme/ui/declared' }],
      };
      expect(importSpecifierFor({ name: 'Declared', filePath: file } as any, config)).toBe('@acme/ui/declared');
      expect(importSpecifierFor({ name: 'Sub', filePath: '', __componentPath: '@acme/ui/sub' } as any, config)).toBe('@acme/ui/sub');
      expect(importSpecifierFor({ name: 'Tile', filePath: file } as any, config)).toBe('../../components/Tile');
      expect(importSpecifierFor({ name: 'Button', filePath: '' } as any, config)).toBe('@acme/ui');
      const resolve = importHomeResolver([{ name: 'Tile', filePath: file } as any], config);
      expect(resolve('Tile')).toEqual({ specifier: '../../components/Tile', defaultExport: false });
      expect(resolve('Nope')).toBeUndefined();
    } finally {
      process.chdir(cwd);
    }
  });
});

describe('story titles after deletion', () => {
  it('frees a title whose file is gone instead of versioning past it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-'));
    const stories = path.join(dir, 'generated');
    fs.mkdirSync(stories);
    const tracker = new StoryTracker({ generatedStoriesPath: stories } as any);
    const mapping = (title: string, fileName: string) => ({
      title, fileName, storyId: fileName, hash: 'h', prompt: title, createdAt: '', updatedAt: '',
    });
    fs.writeFileSync(path.join(stories, 'profile-card.stories.tsx'), '');
    tracker.registerStory(mapping('Profile Card', 'profile-card.stories.tsx'));
    expect(tracker.getNextVersionTitle('Profile Card')).toBe('Profile Card v2');

    fs.unlinkSync(path.join(stories, 'profile-card.stories.tsx'));
    expect(tracker.getNextVersionTitle('Profile Card')).toBe('Profile Card');
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.story-mappings.json'), 'utf8'))).toEqual([]);
  });
});

describe('voice canvas scope', () => {
  it('imports the catalog from where each component lives and never a path it does not know', () => {
    const config: any = { importPath: '@acme/ui', generatedStoriesPath: './src/stories/generated/', importStyle: 'individual' };
    const source = voiceCanvasStorySource(config, [
      { name: 'Button', filePath: '', __componentPath: '@acme/ui/button' },
      { name: 'Card', filePath: '', __componentPath: '@acme/ui/card' },
      { name: 'CardHeader', filePath: '', __componentPath: '@acme/ui/card' },
      { name: 'Avatar', filePath: '', __componentPath: '@acme/avatar', __defaultExport: true },
      { name: 'Ghost', filePath: '' },
      { name: 'not-a-component', filePath: '' },
    ] as any);
    expect(source).toContain("import * as __sui0 from '@acme/ui/button';");
    expect(source).toContain("import * as __sui1 from '@acme/ui/card';");
    expect(source).toContain('...pick(__sui1, ["Card","CardHeader"], []),');
    expect(source).toContain('...pick(__sui2, [], ["Avatar"]),');
    expect(source).not.toContain('Ghost');
    expect(source).not.toContain('__STORY_UI_CATALOG_IMPORTS__');
    expect(source).toContain('...catalog,\n  ...designSystem,');
  });

  it('is stable for the same catalog, so the story file is only rewritten on change', () => {
    const config: any = { importPath: '@mantine/core', generatedStoriesPath: './src/stories/generated/' };
    const comps: any = [{ name: 'Button', filePath: '' }, { name: 'Text', filePath: '' }];
    expect(voiceCanvasStorySource(config, comps)).toBe(voiceCanvasStorySource(config, comps));
    expect(voiceCanvasStorySource(config, comps)).toContain('...pick(__sui0, ["Button","Text"], []),');
  });
});

describe('canvas story stays out of the sidebar', () => {
  it('tags the render surface !dev so it is loadable by id but not listed', () => {
    const source = voiceCanvasStorySource({ importPath: '@mantine/core', generatedStoriesPath: './src/stories/generated/' } as any, [{ name: 'Button', filePath: '' }] as any);
    expect(source).toContain("tags: ['voice-canvas-internal', '!dev']");
  });
});

describe('storybook watcher hint', () => {
  const withVersion = (version: string | null) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbv-'));
    if (version) {
      fs.mkdirSync(path.join(dir, 'node_modules', 'storybook'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', 'storybook', 'package.json'), JSON.stringify({ version }));
    }
    return dir;
  };
  // The hint is about the platform's watcher, not a version range: every
  // 10.x tested indexed a new file in ~1s on the same project that lost
  // every event for ten minutes on 10.5.6. The fix it names is polling.
  it('names the mechanism and the polling fix on macOS without polling, and stays silent otherwise', () => {
    for (const v of ['10.5.6', '10.5.10', '10.6.1', '10.4.2']) {
      const hint = storybookWatcherHint(withVersion(v), {}, 'darwin');
      expect(hint).toContain(`Storybook ${v} on macOS`);
      expect(hint).toContain('WATCHPACK_POLLING=1000');
      expect(hint).not.toContain('10.5.10 or newer');
    }
    expect(storybookWatcherHint(withVersion('10.5.6'), { WATCHPACK_POLLING: '1000' }, 'darwin')).toBe('');
    expect(storybookWatcherHint(withVersion('10.5.6'), {}, 'linux')).toBe('');
    expect(storybookWatcherHint(withVersion(null), {}, 'darwin')).toBe('');
  });
});
