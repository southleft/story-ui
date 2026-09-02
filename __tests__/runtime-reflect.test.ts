import { describe, it, expect } from 'vitest';
import { formatCompoundReference, type ReflectedKnowledge } from '../story-generator/knowledge/runtimeReflect.js';

const knowledge = (over: Partial<ReflectedKnowledge> = {}): ReflectedKnowledge => ({
  importPath: '@mantine/core',
  version: '8.3.9',
  exports: ['Menu', 'MenuTarget', 'MenuDropdown', 'Tabs', 'Button'],
  compound: [
    { name: 'Menu', children: ['Target', 'Dropdown', 'Item', 'Label', 'Divider'] },
    { name: 'Tabs', children: ['List', 'Tab', 'Panel'] },
  ],
  reflectedAt: '2026-07-26T00:00:00.000Z',
  ...over,
});

/**
 * The component catalog is a flat list, so compound components arrive as
 * unrelated siblings (Menu, MenuTarget, MenuDropdown). Nothing tells the model
 * they compose, leaving it to rely on whatever it remembers about the library —
 * exactly the knowledge that is wrong for a private or recently-updated system.
 */
describe('formatCompoundReference', () => {
  it('renders dot notation for every sub-component', () => {
    const out = formatCompoundReference(knowledge());
    expect(out).toContain('Menu.Target');
    expect(out).toContain('Menu.Dropdown');
    expect(out).toContain('Tabs.Panel');
  });

  it('states that only the parent should be imported', () => {
    const out = formatCompoundReference(knowledge());
    expect(out.toLowerCase()).toContain('import only the parent');
  });

  it('sorts parents so the block is stable across runs', () => {
    const out = formatCompoundReference(knowledge({
      compound: [
        { name: 'Tabs', children: ['Tab'] },
        { name: 'Accordion', children: ['Item'] },
        { name: 'Menu', children: ['Target'] },
      ],
    }));
    const order = ['Accordion', 'Menu', 'Tabs'].map(n => out.indexOf(`- ${n}:`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('returns nothing when the library has no compound components', () => {
    expect(formatCompoundReference(knowledge({ compound: [] }))).toBe('');
  });

  it('stays compact — it competes with the component catalog for prompt space', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `Comp${i}`, children: ['Item', 'Header', 'Footer'],
    }));
    const out = formatCompoundReference(knowledge({ compound: many }));
    // ~40 lines plus a short preamble; a blowout here would crowd out guidance.
    expect(out.length).toBeLessThan(4000);
  });
});
