/**
 * An import the catalog does not contain is an UNKNOWN component, and the
 * only honest help is the nearest names the catalog does contain.
 *
 * The blacklist used to pattern-match names — anything ending in Card,
 * Header, Container, Layout or Wrapper; anything starting with Custom or
 * Styled — and then suggested `Box`, `Pagehead` and `PageLayout`, which are
 * Polaris and Primer components, to every design system on earth.
 */

import { describe, it, expect } from 'vitest';
import {
  isBlacklistedComponent,
  validateImports,
  getBlacklistErrorMessage,
} from '../story-generator/componentBlacklist.js';
import { nearestNames } from '../story-generator/nameSimilarity.js';

const catalog = new Set(['Button', 'ProductCard', 'PageHeader', 'StyledLink', 'CustomSelect', 'Stack', 'Lozenge']);

describe('isBlacklistedComponent', () => {
  it('accepts every catalog member, whatever its name looks like', () => {
    for (const name of catalog) expect(isBlacklistedComponent(name, catalog)).toBe(false);
  });

  it('rejects anything not in the catalog', () => {
    expect(isBlacklistedComponent('GitHubStyleRepoCard', catalog)).toBe(true);
    expect(isBlacklistedComponent('Card', catalog)).toBe(true);
    expect(isBlacklistedComponent('Header', catalog)).toBe(true);
  });

  it('judges nothing when the catalog is empty', () => {
    expect(isBlacklistedComponent('Anything', new Set())).toBe(false);
  });
});

describe('suggestions come from the catalog, not a vocabulary', () => {
  it('names the nearest catalog entries for a typo', () => {
    const { invalid, suggestions } = validateImports(['Lozenges', 'Buton'], catalog);
    expect(invalid).toEqual(['Lozenges', 'Buton']);
    expect(suggestions.get('Lozenges')?.[0]).toBe('Lozenge');
    expect(suggestions.get('Buton')?.[0]).toBe('Button');
  });

  it('offers nothing for a name with no real neighbour', () => {
    const { suggestions } = validateImports(['Zyzzyva'], catalog);
    expect(suggestions.has('Zyzzyva')).toBe(false);
  });

  it('never suggests a component the catalog does not have', () => {
    const near = nearestNames('LayoutWrapper', catalog, 3);
    for (const n of near) expect(catalog.has(n)).toBe(true);
    expect(near).not.toContain('Box');
    expect(near).not.toContain('PageLayout');
  });

  it('says "unknown component" and lists the nearest names', () => {
    const msg = getBlacklistErrorMessage('ProductCards', undefined, catalog);
    expect(msg).toContain('unknown component');
    expect(msg).toContain('not in the catalog');
    expect(msg).toContain('ProductCard');
  });
});
