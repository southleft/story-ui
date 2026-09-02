/**
 * A fresh init on a Carbon project wrote its own package name as the import
 * path, because "@carbon/react" contains "react" and was skipped as runtime.
 */
import { describe, it, expect } from 'vitest';
import { findMostLikelyImportPath } from '../story-generator/configLoader.js';

describe('findMostLikelyImportPath', () => {
  it('keeps design systems whose names contain react and skips only the runtime', () => {
    const paths = ['react', 'react', '@carbon/react', '@carbon/react', '@carbon/react', '@storybook/react-vite', 'react-dom'];
    expect(findMostLikelyImportPath(paths, 'carbon-testbed')).toBe('@carbon/react');
  });
  it('never answers with the project\'s own package name', () => {
    // Nothing installable is imported: null, so the caller uses the
    // component directory. The old fallback returned 'my-lib' — a name
    // no consumer can install and `check` asked for forever.
    expect(findMostLikelyImportPath(['react', '@storybook/react'], 'my-lib')).toBeNull();
    // Stories that import the library by its own name (a workspace alias)
    // are not evidence of an npm design system either.
    expect(findMostLikelyImportPath(['react', '@sail-shelf/ui', '@sail-shelf/ui', '@sail-shelf/ui/Button'], '@sail-shelf/ui')).toBeNull();
    // ...but another package still wins on its own merits.
    expect(findMostLikelyImportPath(['@sail-shelf/ui', '@mantine/core', '@mantine/core'], '@sail-shelf/ui')).toBe('@mantine/core');
  });
});
