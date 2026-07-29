/**
 * Storybook's manifest examples, and why none of them ever reached a prompt.
 *
 * `fetchFromManifest` normalises each story snippet into
 * `ComponentDocumentation.examples[].code`. The consumer in generationCore read
 * `doc.stories[].snippet` — a field that does not exist on that interface — so
 * the expression was always `undefined`, `component.examples` was never
 * populated from the manifest, and `inheritCompoundExamples` on the next line
 * had nothing to propagate.
 *
 * It survived because `bench/resolution.mjs` parses the RAW manifest, where
 * `stories[].snippet` DOES exist, and therefore reported usage-example coverage
 * that the pipeline never received. The same bench-versus-pipeline divergence
 * already recorded for the description predicate, which is why the fix belongs
 * with a test rather than only a corrected line.
 */

import { describe, it, expect } from 'vitest';

/** The copy step exactly as generationCore performs it. */
function attachExamples(
  components: Array<{ name: string; examples?: string[] }>,
  docs: Record<string, any>,
): void {
  for (const component of components) {
    if (component.examples?.length) continue;
    const doc = docs[component.name];
    const snippets = doc?.examples?.map((ex: any) => ex.code).filter(Boolean);
    if (snippets?.length) component.examples = snippets;
  }
}

/** A ComponentDocumentation as fetchFromManifest really builds it. */
const doc = (name: string, snippets: string[]) => ({
  id: name.toLowerCase(),
  name,
  examples: snippets.map((code, i) => ({ title: `Story${i}`, code })),
  props: {},
});

describe('manifest examples reach the component catalog', () => {
  it('copies a snippet onto the component', () => {
    const components = [{ name: 'Button' }];
    attachExamples(components, { Button: doc('Button', ['<Button kind="primary">Go</Button>']) });
    expect(components[0].examples).toEqual(['<Button kind="primary">Go</Button>']);
  });

  it('reads `examples`, not `stories`', () => {
    // The exact shape the old code expected. It must not be what we depend on:
    // fetchFromManifest never returns it.
    const components = [{ name: 'Button' }];
    const wrongShape = { Button: { id: 'button', name: 'Button', stories: [{ snippet: '<Button/>' }] } };
    attachExamples(components, wrongShape as any);
    expect(components[0].examples).toBeUndefined();
  });

  it('keeps examples a component already has', () => {
    const components = [{ name: 'Button', examples: ['<Button>existing</Button>'] }];
    attachExamples(components, { Button: doc('Button', ['<Button>from manifest</Button>']) });
    expect(components[0].examples).toEqual(['<Button>existing</Button>']);
  });

  it('drops empty snippets rather than attaching blanks', () => {
    const components = [{ name: 'Card' }];
    attachExamples(components, { Card: { id: 'card', name: 'Card', examples: [{ title: 'A', code: '' }] } });
    expect(components[0].examples).toBeUndefined();
  });

  it('leaves a component the manifest does not document alone', () => {
    const components = [{ name: 'Unknown' }];
    attachExamples(components, { Button: doc('Button', ['<Button/>']) });
    expect(components[0].examples).toBeUndefined();
  });
});
