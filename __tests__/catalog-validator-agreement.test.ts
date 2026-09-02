/**
 * The catalog and the validator must never disagree.
 *
 * They were two independently maintained sets. When they diverged the model
 * was told to use `Box`, rejected for using it, told again by the healing
 * loop, rejected again — an unwinnable loop that burned every attempt and
 * returned NO CODE for three consecutive cases.
 *
 * The divergence came from `validateAvailableComponents = new Set(...)` inside
 * a function that runs once per npm package: with 36 packages under a scope,
 * the last one processed decided what the validator would accept, while the
 * catalog went on offering all 168 components.
 *
 * The invariant is one-directional and cheap to hold: anything the CATALOG
 * offers is valid, because the catalog is what the model is shown.
 */

import { describe, it, expect } from 'vitest';
import { EnhancedComponentDiscovery } from '../story-generator/enhancedComponentDiscovery.js';

/** A discovery instance with a known catalog, bypassing filesystem scanning. */
function withCatalog(names: string[], validationSet: string[] = []): EnhancedComponentDiscovery {
  const d = new EnhancedComponentDiscovery({ importPath: '@fixture/ds' } as any);
  const discovered = (d as any).discoveredComponents as Map<string, any>;
  for (const name of names) {
    discovered.set(name, { name, filePath: '', props: [], slots: [], examples: [] });
  }
  (d as any).validateAvailableComponents = new Set(validationSet);
  return d;
}

describe('catalog / validator agreement', () => {
  it('accepts every component the catalog offers', async () => {
    // The validation set here knows about ONE of them, exactly as it did when
    // a per-package assignment overwrote it 36 times.
    const d = withCatalog(['Box', 'Stack', 'Flex', 'Text'], ['Text']);
    const result = await d.validateComponentNames(['Box', 'Stack', 'Flex', 'Text']);
    expect(result.invalid).toEqual([]);
  });

  it('still rejects a component that is in neither', async () => {
    // The invariant only ever ADDS. It must not turn the validator into a
    // rubber stamp, or an invented component would reach the browser.
    const d = withCatalog(['Box', 'Stack'], ['Text']);
    const result = await d.validateComponentNames(['Box', 'NotARealThing']);
    expect(result.invalid).toEqual(['NotARealThing']);
  });

  it('reports available names as the union, never the smaller set', async () => {
    const d = withCatalog(['Box', 'Stack'], ['Text']);
    expect(d.getAvailableComponentNames()).toEqual(['Box', 'Stack', 'Text']);
  });

  it('suggests a near miss from everything available', async () => {
    // The suggestion list was drawn from the validation set alone, so a typo
    // of a catalog-only component got no suggestion at all.
    const d = withCatalog(['Lozenge', 'Skeleton'], []);
    const result = await d.validateComponentNames(['Lozenges']);
    expect(result.suggestions.get('Lozenges')).toBe('Lozenge');
  });
});
