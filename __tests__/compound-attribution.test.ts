/**
 * Telling a compound part where it belongs.
 *
 * A design system documents `Alert`, not `AlertTitle`. Measured on
 * college-town: 51 of 247 components have a usage example of their own, and
 * 187 of the remaining 196 are compound parts of a documented parent whose
 * example shows them in use.
 *
 * The risk in attributing that downward is a FALSE relationship — telling the
 * model that `TableOfContents` belongs inside `Table` would be worse than
 * saying nothing, because it reads as authoritative. Both guards are pinned
 * here.
 */

import { describe, it, expect } from 'vitest';
import { inheritCompoundExamples } from '../story-generator/knowledge/storybookCatalog.js';

const alertExample = '<Alert><AlertTitle>Heads up</AlertTitle><AlertDescription>Body</AlertDescription></Alert>';

describe('inheritCompoundExamples', () => {
  it('attributes a part to the parent whose code demonstrates it', () => {
    const components: any[] = [
      { name: 'Alert', examples: [alertExample] },
      { name: 'AlertTitle', examples: [] },
      { name: 'AlertDescription', examples: [] },
    ];
    expect(inheritCompoundExamples(components)).toBe(2);
    expect(components[1].usedInside).toBe('Alert');
    expect(components[2].usedInside).toBe('Alert');
  });

  it('does not copy the parent snippet onto the child', () => {
    // 247 components each carrying a ~500-character example is 120KB of
    // catalog — the wall of context that made the flat catalog useless.
    const components: any[] = [
      { name: 'Alert', examples: [alertExample] },
      { name: 'AlertTitle', examples: [] },
    ];
    inheritCompoundExamples(components);
    expect(components[1].examples).toEqual([]);
  });

  it('refuses a name that merely shares a prefix', () => {
    // TableOfContents is a different component; Table's example teaches
    // nothing about it, and claiming otherwise would send the model to nest it.
    const components: any[] = [
      { name: 'Table', examples: ['<Table><TableRow /></Table>'] },
      { name: 'TableOfContents', examples: [] },
    ];
    expect(inheritCompoundExamples(components)).toBe(0);
    expect(components[1].usedInside).toBeUndefined();
  });

  it('refuses a part the parent never actually renders', () => {
    // AlertDialog starts with "Alert" and is a separate component. The prefix
    // match alone would claim it; requiring the tag in the parent's code does not.
    const components: any[] = [
      { name: 'Alert', examples: [alertExample] },
      { name: 'AlertDialog', examples: [] },
    ];
    expect(inheritCompoundExamples(components)).toBe(0);
    expect(components[1].usedInside).toBeUndefined();
  });

  it('prefers the longest matching parent', () => {
    // With both Card and CardHeader documented, CardHeaderTitle belongs to
    // CardHeader — the nearer, more specific container.
    const components: any[] = [
      { name: 'Card', examples: ['<Card><CardHeader><CardHeaderTitle/></CardHeader></Card>'] },
      { name: 'CardHeader', examples: ['<CardHeader><CardHeaderTitle /></CardHeader>'] },
      { name: 'CardHeaderTitle', examples: [] },
    ];
    inheritCompoundExamples(components);
    expect(components[2].usedInside).toBe('CardHeader');
  });

  it('leaves a component that has its own example alone', () => {
    const components: any[] = [
      { name: 'Alert', examples: [alertExample] },
      { name: 'AlertTitle', examples: ['<AlertTitle>Standalone</AlertTitle>'] },
    ];
    expect(inheritCompoundExamples(components)).toBe(0);
    expect(components[1].usedInside).toBeUndefined();
  });
});
