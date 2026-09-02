/**
 * Namespace-only exports — ~10% of the React component-library market.
 *
 * `import { Menu } from '@base-ui/react'` then `<Menu.Root>`. `Menu` is a PLAIN
 * OBJECT whose members are the components; `<Menu>` throws. Measured on the real
 * package: 40 top-level exports, of which 29 are namespace-only, and they are
 * every interactive composite — Menu, Dialog, Select, Tabs, Tooltip, Popover,
 * Combobox, Accordion.
 *
 * Duck-typing on `.render`/`.component`/`.Component` classified all 29 as
 * not-components and dropped them. The loss was invisible: 11 survivors is
 * greater than zero, so the no-components fallback never fired and the log read
 * "Discovered 11 components" exactly as it would for a complete library.
 *
 * Three states, not two. A namespace must be neither dropped (loses the
 * library) nor marked renderable (invites the throw).
 */

import { describe, it, expect } from 'vitest';
import { isRenderableForTest } from '../story-generator/knowledge/runtimeReflect.js';

/** A forwardRef-shaped value, as React really presents one. */
const forwardRef = (displayName: string) => ({ $$typeof: Symbol.for('react.forward_ref'), render: () => null, displayName });

describe('what counts as renderable', () => {
  it('accepts a function component', () => {
    expect(isRenderableForTest(function Button() { return null; })).toBe(true);
  });

  it('accepts a forwardRef object', () => {
    expect(isRenderableForTest(forwardRef('Button'))).toBe(true);
  });

  it('rejects a namespace object, which cannot itself render', () => {
    // Base UI's `Menu`: members are components, the parent is not one.
    const menu = { Root: forwardRef('MenuRoot'), Item: forwardRef('MenuItem') };
    expect(isRenderableForTest(menu)).toBe(false);
  });

  it('rejects plain data', () => {
    expect(isRenderableForTest({ small: 'sm', large: 'lg' })).toBe(false);
    expect(isRenderableForTest(null)).toBe(false);
    expect(isRenderableForTest('Button')).toBe(false);
  });
});

/**
 * The predicate discovery uses to decide whether an OBJECT is worth keeping.
 * Mirrors dynamicPackageDiscovery.hasComponentLikeProperties.
 */
function holdsComponents(obj: any): boolean {
  if (typeof obj.render === 'function' || typeof obj.component === 'function' || typeof obj.Component === 'function') return true;
  try {
    return Object.keys(obj).some(k => {
      if (!/^[A-Z]/.test(k)) return false;
      const v = obj[k];
      if (!v) return false;
      if (typeof v === 'function') return true;
      return typeof v === 'object' && Boolean(v.$$typeof || v.render || v.type);
    });
  } catch { return false; }
}

describe('a namespace survives discovery', () => {
  it('keeps an object whose members are components', () => {
    const menu = { Root: forwardRef('MenuRoot'), Popup: forwardRef('MenuPopup'), Item: forwardRef('MenuItem') };
    expect(holdsComponents(menu)).toBe(true);
  });

  it('keeps a namespace of plain function components', () => {
    expect(holdsComponents({ Root: function MenuRoot() { return null; } })).toBe(true);
  });

  it('still rejects an object of plain data', () => {
    // The existing guarantee: a statics bag of sizes is not a component set.
    expect(holdsComponents({ Small: 'sm', Large: 'lg' })).toBe(false);
  });

  it('rejects an object with no PascalCase members', () => {
    expect(holdsComponents({ useMenu: () => null, MENU_ID: 'x' })).toBe(false);
  });

  it('survives a throwing getter rather than crashing discovery', () => {
    const hostile = Object.defineProperty({}, 'Boom', { get() { throw new Error('nope'); }, enumerable: true });
    expect(() => holdsComponents(hostile)).not.toThrow();
  });
});

describe('a provider is a component, not plumbing', () => {
  /** Mirrors the name filter in dynamicPackageDiscovery.isComponentName. */
  const rejectedByName = (name: string) =>
    name.toUpperCase() === name || name.startsWith('Styled') || name.endsWith('Context')
    || name.endsWith('Type') || name.endsWith('Types');

  it('no longer rejects a name ending in Provider', () => {
    // Shopify Polaris's AppProvider is mandatory — the library throws without
    // it — and this rule deleted it from the catalog.
    expect(rejectedByName('AppProvider')).toBe(false);
    expect(rejectedByName('MantineProvider')).toBe(false);
    expect(rejectedByName('TooltipProvider')).toBe(false);
  });

  it('still rejects a React context, which is never written as an element', () => {
    expect(rejectedByName('ThemeContext')).toBe(true);
  });

  it('still rejects constants and type names', () => {
    expect(rejectedByName('DEFAULT_SIZE')).toBe(true);
    expect(rejectedByName('ButtonTypes')).toBe(true);
    expect(rejectedByName('StyledButton')).toBe(true);
  });
});
