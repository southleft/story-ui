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
  it('falls back to the package name only when nothing else is imported', () => {
    expect(findMostLikelyImportPath(['react', '@storybook/react'], 'my-lib')).toBe('my-lib');
  });
});
