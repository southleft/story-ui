import { describe, it, expect } from 'vitest';
import { applyTitleAndId } from '../mcp-server/routes/generationCore';

describe('title and id land inside the meta object', () => {
  it('ignores data that happens to have title and id fields before meta', () => {
    const code = `import React from 'react';
const columns = [
  { id: 'todo', title: 'To do' },
  { id: 'done', title: 'Done' },
];
const meta: Meta = {
  title: 'Kanban Board',
  parameters: { layout: 'fullscreen' },
};
export default meta;`;
    const out = applyTitleAndId(code, 'Kanban Board', 'kanban-board-1a2b3c4d', 'Generated/');
    expect(out).toContain("{ id: 'todo', title: 'To do' }");
    expect(out).toContain("title: 'Generated/Kanban Board',\n  id: 'kanban-board-1a2b3c4d',");
    expect(out.match(/id: 'kanban-board-1a2b3c4d'/g)).toHaveLength(1);
  });

  it('keeps an id the meta already declares, and leaves defineMeta without one', () => {
    const withId = `const meta = {\n  title: 'X',\n  id: 'x-existing',\n};\nexport default meta;`;
    expect(applyTitleAndId(withId, 'X', 'x-new', 'Generated/')).toContain("id: 'x-existing'");
    expect(applyTitleAndId(withId, 'X', 'x-new', 'Generated/')).not.toContain('x-new');
    const svelte = `const { Story } = defineMeta({\n  title: 'X',\n});`;
    expect(applyTitleAndId(svelte, 'X', 'x-new', 'Generated/')).toBe(`const { Story } = defineMeta({\n  title: 'Generated/X',\n});`);
  });

  it('handles export default meta objects and does nothing without a meta', () => {
    const def = `export default {\n  title: 'Card',\n  component: Card,\n};`;
    expect(applyTitleAndId(def, 'Card', 'card-1', 'Generated/')).toContain("title: 'Generated/Card',\n  id: 'card-1',");
    expect(applyTitleAndId('const x = 1;', 'Card', 'card-1', 'Generated/')).toBe('const x = 1;');
  });
}, 30_000);

describe('the artifact writer reports the bytes it wrote', () => {
  it('returns the code with the stylesheet import rewritten, so a later write can compare against disk', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path');
    const { writeStoryArtifacts } = await import('../story-generator/storyArtifacts');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-'));
    const code = `import styles from './styles.module.css';\nexport default { title: 'X' };\n`;
    const out = writeStoryArtifacts({ dir, fileName: 'x.stories.tsx', code, css: '.a { color: red; }' });
    expect(out.code).toBe(fs.readFileSync(out.storyPath, 'utf-8'));
    expect(out.code).not.toBe(code);
    const plain = writeStoryArtifacts({ dir, fileName: 'y.stories.tsx', code: 'export default {};\n' });
    expect(plain.code).toBe('export default {};\n');
  });
});

describe('titles keep their letters', () => {
  it('does not strip accented characters from a prompt-derived title', async () => {
    const { cleanPromptForTitle } = await import('../mcp-server/routes/generationCore');
    expect(cleanPromptForTitle('A Résumé card with name and skills')).toContain('Résumé');
    expect(cleanPromptForTitle('Ünïcode Straße panel')).toContain('Straße');
  });
});

describe('index lookup by title is confined to the story file', () => {
  it('ignores an older story with the same title in another file', async () => {
    const { waitForStoryIndexed } = await import('../story-generator/verify/renderHarness');
    const entries = {
      'old-card--default': { type: 'story', title: 'Generated/Card with Button', importPath: './src/stories/generated/card-with-button-1111.stories.tsx' },
      'card-with-button-v3-2222--default': { type: 'story', title: 'Generated/Card with Button', importPath: './src/stories/generated/card-with-button-2222.stories.tsx' },
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ entries }) })) as any;
    try {
      const r = await waitForStoryIndexed('http://x', 'no-such-prefix', 300, 50, 'Card with Button', 'card-with-button-2222.stories.tsx');
      expect(r).toMatchObject({ indexed: true, storyId: 'card-with-button-v3-2222--default' });
      const none = await waitForStoryIndexed('http://x', 'no-such-prefix', 300, 50, 'Card with Button', 'card-with-button-3333.stories.tsx');
      expect(none.indexed).toBe(false);
      const any = await waitForStoryIndexed('http://x', 'no-such-prefix', 300, 50, 'Card with Button');
      expect(any).toMatchObject({ indexed: true, storyId: 'old-card--default' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
