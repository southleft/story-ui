import { describe, it, expect } from 'vitest';
import { mergeExtractedProps, shapeInventory } from '../mcp-server/routes/components';

describe('inventory prop counts from the library declarations', () => {
  it('fills props discovery did not know, keeps the ones it did', () => {
    const components: any[] = [
      { name: 'Tile', propTypes: [] },
      { name: 'Button', props: [{ name: 'kind', type: 'string', required: false }] },
      { name: 'Unknown' },
    ];
    const filled = mergeExtractedProps(components, {
      Tile: { props: [{ name: 'light', type: 'boolean' }, { name: 'children' }], description: 'A tile groups related content on a surface.' },
      Button: { props: [{ name: 'size' }] },
    });
    expect(filled).toBe(1);
    const rows = shapeInventory(components, '@carbon/react');
    expect(rows.components.find(r => r.name === 'Tile')?.propCount).toBe(2);
    expect(rows.components.find(r => r.name === 'Tile')?.hasDescription).toBe(true);
    expect(rows.components.find(r => r.name === 'Button')?.propCount).toBe(1);
    expect(rows.components.find(r => r.name === 'Unknown')?.propCount).toBe(0);
  });
});
