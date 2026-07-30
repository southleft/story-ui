/**
 * Accessibility probe — runs axe-core against the rendered story.
 *
 * axe is resolved from the HOST project (Storybook's a11y addon already
 * installs it), so this costs the user no new dependency and matches the rules
 * their own Storybook a11y panel enforces.
 *
 * Severity mapping is the entire difficulty here. axe reports on the rendered
 * result, which mixes two very different things:
 *
 *   1. Defects the GENERATOR caused — an icon button with no accessible name,
 *      an input with no label, a broken ARIA relationship. These are real,
 *      unambiguous, and fixable by regenerating.
 *   2. Properties of the DESIGN SYSTEM or theme — most commonly colour
 *      contrast, which is usually the library's own default palette on the
 *      library's own default surface. Blocking on those would have the model
 *      "fix" its output by overriding the design system with hardcoded colours,
 *      which is the opposite of what this tool is for.
 *
 * So only the first class is ever a blocker. Everything else informs.
 */

import path from 'path';
import type { HostTooling } from '../hostTooling.js';

export interface A11yViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  help: string;
  nodeCount: number;
  /** First offending element, as a selector. */
  selector?: string;
  /** axe's own failure summary for the first node. */
  detail?: string;
}

export interface A11yResult {
  ran: boolean;
  reason?: string;
  violations: A11yViolation[];
  passCount: number;
}

/**
 * Rules whose failure indicates the generated markup is wrong, not that the
 * design system's palette is imperfect. Kept deliberately tight — a rule only
 * belongs here if a regeneration could plausibly fix it without fighting the
 * design system.
 */
const GENERATION_DEFECT_RULES = new Set([
  'button-name',
  'link-name',
  'input-button-name',
  'label',
  'form-field-multiple-labels',
  'select-name',
  'aria-input-field-name',
  'aria-toggle-field-name',
  'aria-command-name',
  'aria-required-attr',
  'aria-required-children',
  'aria-required-parent',
  'aria-valid-attr-value',
  'aria-hidden-focus',
  'image-alt',
  'input-image-alt',
  'nested-interactive',
  'duplicate-id-active',
]);

/**
 * Text nobody can read is a COMPOSITION defect, not a palette opinion.
 *
 * `color-contrast` sat in DESIGN_SYSTEM_RULES below — reported, never blocking —
 * on the reasoning that contrast follows from the design system's palette and a
 * story cannot change it. Measured, that reasoning is wrong in the case that
 * matters most.
 *
 * A generated pricing page rendered its highlighted card with a light
 * background while the text colour came from a token that resolves LIGHT in
 * dark mode. axe reported it exactly: 12 nodes, contrast ratio 1.04, #fafafa on
 * #ffffff. White on white. Completely unreadable, and the single most obvious
 * defect a reviewer sees — and we computed the answer and threw it away.
 *
 * The story chose that pairing, so the story can fix it. Where the LIBRARY'S own
 * markup fails, `isDesignSystemInternal` already demotes it, which is the right
 * split: a system's grey-on-grey is its own business, a composition's
 * white-on-white is not.
 *
 * `color-contrast-enhanced` (AAA) stays advisory — AA is the line worth blocking.
 */
const CONTRAST_RULES = new Set(['color-contrast']);

export function isContrastDefect(ruleId: string): boolean {
  return CONTRAST_RULES.has(ruleId);
}

/**
 * Rules that describe the design system's own visual choices rather than the
 * composition. Reported, never blocking.
 */
const DESIGN_SYSTEM_RULES = new Set([
  'color-contrast-enhanced',
  'landmark-one-main',
  'region',
  'page-has-heading-one',
  'html-has-lang',
  'landmark-unique',
  'heading-order',
]);

export function isGenerationDefect(ruleId: string): boolean {
  return GENERATION_DEFECT_RULES.has(ruleId);
}

/**
 * True when the offending element was rendered by the design system's own
 * internals rather than authored in the story.
 *
 * Motivating case: a story sets `aria-label` on a Mantine `Slider`, but axe
 * fails `aria-input-field-name` on `.mantine-Slider-thumb[role="slider"]` —
 * markup the library emits and the story cannot reach. Asking the model to fix
 * it produces either no change or a hack that fights the design system, so
 * these are reported but never repaired.
 *
 * Detected structurally, not per-library: component-part class names are
 * namespaced across every major design system —
 *   Mantine  .mantine-Slider-thumb
 *   MUI      .MuiSlider-thumb
 *   Vuetify  .v-slider__thumb
 *   Shoelace .sl-range__thumb
 */
export function isDesignSystemInternal(selector?: string): boolean {
  if (!selector) return false;
  const classes = selector.match(/\.[A-Za-z][\w-]*(?:__[\w-]+)?/g) || [];
  return classes.some(cls => {
    const name = cls.slice(1);
    // Namespace-Component-part  (mantine-Slider-thumb, MuiSlider-thumb)
    if (/^[A-Za-z][\w]*-[A-Z][\w]*-[\w-]+$/.test(name)) return true;
    if (/^Mui[A-Z][\w]*-[\w-]+$/.test(name)) return true;
    // BEM element on a namespaced block (v-slider__thumb, sl-range__thumb)
    if (/^[a-z][\w-]*__[\w-]+$/.test(name)) return true;
    return false;
  });
}

export function isDesignSystemConcern(ruleId: string): boolean {
  return DESIGN_SYSTEM_RULES.has(ruleId);
}

/**
 * Inject axe into the page and run it against the story root.
 *
 * Scoped to #storybook-root so Storybook's own chrome (the docs shell, the
 * preview wrapper) never shows up as a defect in the user's composition.
 */
export async function runA11yProbe(page: any, tooling: HostTooling): Promise<A11yResult> {
  if (!tooling.axePath) {
    return { ran: false, reason: 'axe-core is not installed in this project', violations: [], passCount: 0 };
  }

  try {
    await page.addScriptTag({ path: path.resolve(tooling.axePath) });
  } catch (error) {
    return {
      ran: false,
      reason: `axe-core could not be injected: ${error instanceof Error ? error.message : String(error)}`,
      violations: [], passCount: 0,
    };
  }

  try {
    const raw = await page.evaluate(async () => {
      const axe = (window as any).axe;
      if (!axe?.run) return null;
      const target = document.querySelector('#storybook-root') || document.querySelector('#root') || document.body;
      const results = await axe.run(target as Element, {
        // Storybook's own wrapper markup is not the user's composition, and
        // document-level rules would fire on the harness rather than the story.
        resultTypes: ['violations'],
        rules: {
          'landmark-one-main': { enabled: false },
          'page-has-heading-one': { enabled: false },
          'html-has-lang': { enabled: false },
          region: { enabled: false },
        },
      });
      return {
        violations: (results.violations || []).map((v: any) => ({
          id: v.id,
          impact: v.impact ?? null,
          help: v.help,
          nodeCount: (v.nodes || []).length,
          selector: v.nodes?.[0]?.target?.[0],
          detail: v.nodes?.[0]?.failureSummary,
        })),
        passCount: (results.passes || []).length,
      };
    });

    if (!raw) {
      return { ran: false, reason: 'axe did not initialise in the page', violations: [], passCount: 0 };
    }
    return { ran: true, violations: raw.violations, passCount: raw.passCount };
  } catch (error) {
    return {
      ran: false,
      reason: `axe run failed: ${error instanceof Error ? error.message : String(error)}`,
      violations: [], passCount: 0,
    };
  }
}
