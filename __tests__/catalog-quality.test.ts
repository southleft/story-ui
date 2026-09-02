import { describe, it, expect } from 'vitest';
import { EnhancedComponentDiscovery } from '../story-generator/enhancedComponentDiscovery.js';

/**
 * Story UI's panel is vendored into the consuming project (src/stories/StoryUI/),
 * which sits inside a directory also scanned for co-located components. Its
 * internals were being advertised to the model as part of the user's design
 * system — and because they are local files with real extracted props, they
 * became the richest entries in an otherwise propless catalog.
 */
describe('component catalog excludes Story UI internals', () => {
  const discovery = new EnhancedComponentDiscovery({ importPath: '@mantine/core' } as any);
  // Exercised through the private guards; they are the actual filter.
  const isNonComponentFile = (p: string) => (discovery as any).isNonComponentFile(p);
  const shouldSkipComponent = (n: string, c = '') => (discovery as any).shouldSkipComponent(n, c);

  it('excludes any file under a vendored StoryUI directory', () => {
    expect(isNonComponentFile('/proj/src/stories/StoryUI/DesignContextPanel.tsx')).toBe(true);
    expect(isNonComponentFile('/proj/src/stories/StoryUI/voice/VoiceCanvas.tsx')).toBe(true);
    expect(isNonComponentFile('/proj/src/stories/StoryUI/voice/VoiceControls.tsx')).toBe(true);
  });

  it('excludes the lowercase story-ui directory spelling too', () => {
    expect(isNonComponentFile('/proj/src/story-ui/Panel.tsx')).toBe(true);
  });

  it('still admits the user\'s own components', () => {
    expect(isNonComponentFile('/proj/src/components/BrandBadge.tsx')).toBe(false);
    expect(isNonComponentFile('/proj/src/stories/PriceTag.tsx')).toBe(false);
  });

  it('keeps excluding stories, tests and type declarations', () => {
    expect(isNonComponentFile('/proj/src/components/Card.stories.tsx')).toBe(true);
    expect(isNonComponentFile('/proj/src/components/Card.test.tsx')).toBe(true);
    expect(isNonComponentFile('/proj/src/components/Card.d.ts')).toBe(true);
  });

  it('skips panel components by name if a file is moved out of the directory', () => {
    for (const name of ['StoryUIPanel', 'DesignContextPanel', 'VoiceCanvas', 'VoiceControls']) {
      expect(shouldSkipComponent(name)).toBe(true);
    }
  });

  it('does not skip user components with similar-looking names', () => {
    expect(shouldSkipComponent('VoiceMemoCard')).toBe(false);
    expect(shouldSkipComponent('ContextMenu')).toBe(false);
    expect(shouldSkipComponent('BrandBadge')).toBe(false);
  });
});
