/**
 * Providers are components, not plumbing.
 *
 * Two places judged an export by the shape of its NAME and deleted the one
 * component without which nothing renders:
 *
 *   - dynamicPackageDiscovery rejected every export matching /Provider$/ or
 *     /Context$/. Shopify Polaris's `AppProvider` is the mandatory application
 *     root; drop it and no generated story can mount.
 *   - runtimeReflect stripped `Provider` and `Consumer` from every compound
 *     component's children. In Radix-derived systems — Radix, shadcn/ui, Ark,
 *     Chakra v3, Base UI — `Tooltip.Provider` is a required composition member,
 *     and the prompt told the model to use dot notation while hiding it.
 *
 * The runtime value is in hand in both places, so the question "is this a
 * component" is answerable rather than guessable.
 */

import { describe, it, expect } from 'vitest';
import { isRenderableForTest } from '../story-generator/knowledge/runtimeReflect.js';

describe('isRenderable', () => {
  it('accepts a plain function component', () => {
    expect(isRenderableForTest(function Button() { return null; })).toBe(true);
  });

  it('accepts a forwardRef object, which is how most libraries ship', () => {
    // React represents forwardRef as an object with $$typeof and render.
    const forwardRefLike = { $$typeof: Symbol.for('react.forward_ref'), render: () => null };
    expect(isRenderableForTest(forwardRefLike)).toBe(true);
  });

  it('accepts a memo wrapper', () => {
    const memoLike = { $$typeof: Symbol.for('react.memo'), type: () => null };
    expect(isRenderableForTest(memoLike)).toBe(true);
  });

  it('accepts a Provider, which is a component in Radix-derived systems', () => {
    const provider = { $$typeof: Symbol.for('react.provider'), displayName: 'Tooltip.Provider' };
    expect(isRenderableForTest(provider)).toBe(true);
  });

  it('rejects plain data that happens to be capitalised', () => {
    // A static like `Button.classes` or a token map is not renderable, and
    // offering it as a sub-component would send the model to write <X.classes>.
    expect(isRenderableForTest({ small: 'a', large: 'b' })).toBe(false);
    expect(isRenderableForTest('some string')).toBe(false);
    expect(isRenderableForTest(42)).toBe(false);
    expect(isRenderableForTest(null)).toBe(false);
    expect(isRenderableForTest(undefined)).toBe(false);
  });
});
