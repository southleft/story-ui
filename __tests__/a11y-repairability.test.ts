import { describe, it, expect } from 'vitest';
import {
  isGenerationDefect,
  isDesignSystemConcern,
  isDesignSystemInternal,
  isContrastDefect,
} from '../story-generator/verify/probes/a11y.js';

/**
 * axe reports on the rendered result, which mixes three different things:
 *  1. defects the generator caused        -> blocker, repairable
 *  2. the design system's visual choices  -> warning  (colour contrast etc.)
 *  3. the design system's internal markup -> warning, NOT repairable
 *
 * Case 3 is the subtle one. A story set aria-label on a Mantine Slider and axe
 * still failed aria-input-field-name on `.mantine-Slider-thumb[role="slider"]`
 * — markup the library emits and the story cannot reach. Repair burned an LLM
 * call and changed nothing.
 */
describe('axe rule classification', () => {
  it('treats missing names and broken ARIA as generation defects', () => {
    for (const rule of ['button-name', 'link-name', 'label', 'image-alt', 'nested-interactive']) {
      expect(isGenerationDefect(rule)).toBe(true);
    }
  });

  it('treats document structure as a design-system concern', () => {
    for (const rule of ['region', 'heading-order', 'html-has-lang']) {
      expect(isDesignSystemConcern(rule)).toBe(true);
      expect(isGenerationDefect(rule)).toBe(false);
    }
  });

  /**
   * `color-contrast` used to be in that list, and this test used to assert it.
   *
   * The reasoning was that contrast follows from the design system's palette and
   * a story cannot change it. Measured against real output, that is wrong in the
   * case that matters most: a generated pricing page rendered its highlighted
   * card with a light background while the text colour came from a token that
   * resolves LIGHT in dark mode. axe reported it exactly — 12 nodes, contrast
   * ratio 1.04, #fafafa on #ffffff. White on white, the most obvious defect a
   * reviewer can see, and the answer was computed and discarded.
   *
   * The STORY chose that pairing, so the story can fix it. Where the library's
   * own markup fails, isDesignSystemInternal still demotes it — which is the
   * right split: a system's grey-on-grey is its own business, a composition's
   * white-on-white is not.
   */
  it('treats unreadable text as a composition defect, not a palette opinion', () => {
    expect(isContrastDefect('color-contrast')).toBe(true);
    expect(isDesignSystemConcern('color-contrast')).toBe(false);
    // AAA stays advisory: AA is the line worth blocking on.
    expect(isContrastDefect('color-contrast-enhanced')).toBe(false);
    expect(isDesignSystemConcern('color-contrast-enhanced')).toBe(true);
  });
});

describe('isDesignSystemInternal', () => {
  it('detects Mantine component-part classes', () => {
    expect(isDesignSystemInternal('.m_c9a9a60a.mantine-Slider-thumb[role="slider"]')).toBe(true);
    expect(isDesignSystemInternal('.mantine-Select-input')).toBe(true);
  });

  it('detects MUI component-part classes', () => {
    expect(isDesignSystemInternal('.MuiSlider-thumb')).toBe(true);
    expect(isDesignSystemInternal('span.MuiSwitch-track')).toBe(true);
  });

  it('detects BEM-style library parts (Vuetify, Shoelace)', () => {
    expect(isDesignSystemInternal('.v-slider__thumb')).toBe(true);
    expect(isDesignSystemInternal('.sl-range__thumb')).toBe(true);
  });

  it('does not flag ordinary authored markup', () => {
    expect(isDesignSystemInternal('div > button')).toBe(false);
    expect(isDesignSystemInternal('.toolbar')).toBe(false);
    expect(isDesignSystemInternal('button[aria-label="Play"]')).toBe(false);
    expect(isDesignSystemInternal('#storybook-root > div')).toBe(false);
  });

  it('handles a missing selector', () => {
    expect(isDesignSystemInternal(undefined)).toBe(false);
    expect(isDesignSystemInternal('')).toBe(false);
  });
});

/**
 * Controls hidden from assistive technology need no accessible name.
 *
 * Mantine's NumberInput renders its spinners as `aria-hidden="true"
 * tabindex="-1"` buttons — correct practice, since the input carries the label
 * and the spinners are decorative. The census flagged five of them as blockers
 * on a loan calculator whose accessibility was fine, and the author could not
 * have fixed them: the markup belongs to the design system.
 *
 * Pinned as a pure predicate because the census body runs inside a page.
 */
describe('aria-hidden controls', () => {
  const needsAccessibleName = (el: { ariaHidden?: string; insideHidden?: boolean }) =>
    el.ariaHidden !== 'true' && !el.insideHidden;

  it('exempts a control marked aria-hidden', () => {
    expect(needsAccessibleName({ ariaHidden: 'true' })).toBe(false);
  });

  it('exempts a control inside an aria-hidden subtree', () => {
    expect(needsAccessibleName({ insideHidden: true })).toBe(false);
  });

  it('still requires a name for a visible, exposed control', () => {
    expect(needsAccessibleName({})).toBe(true);
  });
});
