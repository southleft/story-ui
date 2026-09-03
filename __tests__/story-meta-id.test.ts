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
