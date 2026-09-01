/**
 * The catalog spends its budget on what the request is about.
 *
 * Every component used to get a full entry: 244 entries and 65k chars on
 * Mantine, two thirds of the prompt, whether the request was a pricing page
 * or a single button. The ranking that already served the exemplar section
 * now serves the catalog.
 */
import { describe, it, expect } from 'vitest';
import { ReactAdapter } from '../story-generator/framework-adapters/react-adapter.js';

const adapter = new ReactAdapter();
const config: any = { importPath: '@acme/ui', generatedStoriesPath: './src/stories/generated/' };

function fakeCatalog(n: number) {
  const names = ['Button', 'Card', 'Badge', 'Table', 'Modal', 'Tabs', 'Avatar', 'Tooltip', 'Grid', 'Stack'];
  const comps: any[] = [];
  for (let i = 0; i < n; i++) {
    const name = i < names.length ? names[i] : `Widget${i}`;
    comps.push({
      name,
      description: name === 'Card' ? 'A surface for grouping related content' : `${name} component`,
      // Realistic entry sizes: Mantine averages 268 chars per entry, college-town 392.
      props: [
        'variant? (string) [filled|light|outline|subtle|default|transparent|white|gradient]',
        'size? (MantineSize | (string & {})) [xs|sm|md|lg|xl]', 'onClick? (MouseEventHandler<HTMLButtonElement>)',
        'radius? (MantineRadius)', 'color? (MantineColor)', 'disabled? (boolean)', 'loading? (boolean)',
        'fullWidth? (boolean)', 'leftSection? (ReactNode)', 'rightSection? (ReactNode)', 'justify? (CSSProperties["justifyContent"])',
        'gradient? (MantineGradient)',
      ],
      __propDocs: { variant: `Visual style of the ${name.toLowerCase()}`, size: 'Control height and padding' },
    });
  }
  return comps;
}

describe('catalog tiers', () => {
  it('gives every component a full entry when there is no focus', () => {
    const out = adapter.generateComponentReference(fakeCatalog(200), config);
    expect(out).not.toContain('Also available');
    expect((out.match(/^- \*\*/gm) ?? []).length).toBe(200);
  });

  it('keeps the components the request names in the full tier and lists the rest by name', () => {
    const out = adapter.generateComponentReference(fakeCatalog(200), config, {
      catalogFocus: { prompt: 'A pricing page with three plan cards and a call-to-action button', budgetChars: 4000 },
    });
    expect(out).toMatch(/^- \*\*Card\*\*/m);
    expect(out).toMatch(/^- \*\*Button\*\*/m);
    expect(out).toContain('Also available');
    // The tail is present by name and import, never silently dropped.
    expect(out).toContain('Widget199');
    const fullCount = (out.match(/^- \*\*/gm) ?? []).length;
    expect(fullCount).toBeLessThan(200);
    expect(fullCount).toBeGreaterThanOrEqual(40);
  });

  it('never drops a component the previous code imports', () => {
    const out = adapter.generateComponentReference(fakeCatalog(200), config, {
      catalogFocus: { prompt: 'make the heading larger', mustInclude: ['Widget150'], budgetChars: 4000 },
    });
    expect(out).toMatch(/^- \*\*Widget150\*\*/m);
  });

  it('renders prop descriptions for the top of the ranking only', () => {
    const out = adapter.generateComponentReference(fakeCatalog(200), config, {
      catalogFocus: { prompt: 'a card with a button', budgetChars: 4000 },
    });
    expect(out).toContain('Visual style of the card');
    expect(out).toContain('Visual style of the button');
    // A deep-tail component in the full tier gets props but no prose.
    expect(out).not.toContain('Visual style of the widget199');
  });

  it('is much smaller with a focus on a large catalog', () => {
    const comps = fakeCatalog(250);
    const all = adapter.generateComponentReference(comps, config).length;
    const focused = adapter.generateComponentReference(comps, config, {
      catalogFocus: { prompt: 'a login form' },
    }).length;
    expect(focused).toBeLessThan(all * 0.6);
  });
});
