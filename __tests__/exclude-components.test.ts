/**
 * The config could add or override components but never remove one, so
 * RemoveScroll, MantineContext and friends could not be kept out of the
 * catalog by any setting; the only exclusion mechanism was a regex in code.
 */
import { describe, it, expect } from 'vitest';
import { EnhancedComponentDiscovery } from '../story-generator/enhancedComponentDiscovery.js';

function seeded(config: Record<string, unknown>) {
  const discovery = new EnhancedComponentDiscovery({ importPath: '@mantine/core', ...config } as any);
  const map: Map<string, any> = (discovery as any).discoveredComponents;
  const valid: Set<string> = (discovery as any).validateAvailableComponents;
  for (const name of ['Button', 'Card', 'RemoveScroll', 'MantineContext']) {
    map.set(name, { name, props: [] });
    valid.add(name);
  }
  (discovery as any).applyExclusions();
  return { names: [...map.keys()].sort(), valid: [...valid].sort() };
}

describe('excludeComponents', () => {
  it('removes listed names from the catalog and the validation set', () => {
    const { names, valid } = seeded({ excludeComponents: ['RemoveScroll'] });
    expect(names).toEqual(['Button', 'Card', 'MantineContext']);
    expect(valid).toEqual(['Button', 'Card', 'MantineContext']);
  });

  it('honours components[].exclude as well', () => {
    const { names } = seeded({ components: [{ name: 'MantineContext', exclude: true }] });
    expect(names).toEqual(['Button', 'Card', 'RemoveScroll']);
  });

  it('is a no-op for a name discovery never found', () => {
    const { names } = seeded({ excludeComponents: ['Nope'] });
    expect(names).toEqual(['Button', 'Card', 'MantineContext', 'RemoveScroll']);
  });
});
