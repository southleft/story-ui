/**
 * The workspace has to be reachable after `init`, not merely installed.
 *
 * V2 renders through an MDX docs page — that is how the surface stays React in
 * a Vue, Angular or Svelte project. If Storybook's `stories` glob does not
 * match `.mdx`, the file installs correctly and the workspace simply never
 * appears in the sidebar. Nothing errors. Observed on a Carbon project, where
 * it was silently absent until the glob was widened by hand.
 *
 * The check that missed it asked whether the config mentioned `src/stories`,
 * which a `.stories.tsx`-only glob satisfies while matching no MDX at all.
 */

import { describe, it, expect } from 'vitest';

/** The predicate as it is written in cli/setup.ts. */
const coversMdx = (mainContent: string) =>
  mainContent.includes('.mdx') || mainContent.includes('mdx|');

const config = (glob: string) => `export default { stories: ['${glob}'], addons: [] };`;

describe('stories glob must reach the MDX workspace', () => {
  it('recognises an explicit .mdx glob', () => {
    expect(coversMdx(config('../src/**/*.mdx'))).toBe(true);
  });

  it('recognises the @(mdx|stories...) spelling Storybook scaffolds', () => {
    expect(coversMdx(config('../src/stories/**/*.@(mdx|stories.@(js|tsx))'))).toBe(true);
  });

  it('rejects a stories-only glob even though it names src/stories', () => {
    // The exact shape that passed the old substring check and matched no MDX.
    const content = config('../src/stories/**/*.stories.tsx');
    expect(content.includes('src/stories')).toBe(true);
    expect(coversMdx(content)).toBe(false);
  });

  it('rejects the default Storybook TS glob', () => {
    // Carbon's actual config before this was fixed.
    expect(coversMdx(config('../src/**/*.stories.@(ts|tsx)'))).toBe(false);
  });

  it('does not mistake an mdx-named story file for glob coverage', () => {
    // A project can contain the word "mdx" in an addon name without the glob
    // matching MDX. Being wrong in this direction hides the failure again.
    const content = `export default { stories: ['../src/**/*.stories.tsx'], addons: ['@storybook/addon-docs'] };`;
    expect(coversMdx(content)).toBe(false);
  });
});
