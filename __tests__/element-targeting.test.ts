/**
 * Recovering a design system component name.
 *
 * NOTE ON SCOPE: these cover the class-name FALLBACK only. The primary
 * mechanism is React's fiber tree, which reports the exact component the source
 * used and cannot be design-system specific because it is React's own data —
 * it is verified against live Storybooks rather than unit-tested, since it
 * needs a real React runtime. See elementTargeting.ts.
 *
 * This is the load-bearing assumption behind click-to-select: the user clicks a
 * DOM node, and we have to name the component the SOURCE used, with no source
 * map between them. Validated against real generated stories before it was
 * built, and pinned here because the failure mode is silent — a wrong component
 * name sends the model to edit something the user did not point at.
 */

import { describe, it, expect } from 'vitest';
import {
  componentFromMarkup,
  describeTarget,
  orderSourceCandidates,
  targetLabel,
  type ChainEntry,
  type ElementTarget,
} from '../templates/StoryUIV2/elementTargeting.js';

const cls = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * Measured live on react-mantine (Button "Save changes"): the fiber type chain
 * innermost-out is Box → UnstyledButton → Button, and the owners the fiber
 * records are Box(owner UnstyledButton), UnstyledButton(owner Button),
 * Button(owner PricingPage — the story's own page component).
 */
const MANTINE_BUTTON: ChainEntry[] = [
  { name: 'Box', owner: 'UnstyledButton' },
  { name: 'UnstyledButton', owner: 'Button' },
  { name: 'Button', owner: 'PricingPage' },
];

describe('orderSourceCandidates', () => {
  it('sinks each library internal below the component that owns it', () => {
    // The server resolves the FIRST candidate that appears in the file.
    // Innermost-first sent [Box, UnstyledButton, Button], so any story that
    // also authored a <Box> — the measured one had a banner — got its edits
    // aimed at "Box #4". The owners the fiber already records fix the order
    // without blacklisting any name.
    expect(orderSourceCandidates(MANTINE_BUTTON))
      .toEqual(['Button', 'UnstyledButton', 'Box']);
  });

  it('keeps an AUTHORED Box first — the fix must not be a name blacklist', () => {
    // The user genuinely clicked a <Box> the story wrote. Its owner is the
    // page, not another candidate, so it is content and stays first.
    expect(orderSourceCandidates([
      { name: 'Box', owner: 'PricingPage' },
      { name: 'Card', owner: 'PricingPage' },
    ])).toEqual(['Box', 'Card']);
  });

  it('preserves innermost-first for a Button clicked inside a Card', () => {
    // Both authored by the page: neither owns the other, so the click means
    // the inner one. Sorting Card first would aim every edit at the container.
    expect(orderSourceCandidates([
      { name: 'Button', owner: 'PricingPage' },
      { name: 'Card', owner: 'PricingPage' },
    ])).toEqual(['Button', 'Card']);
  });

  it('sinks internals but leaves the authored composition order intact', () => {
    // The full measured shape: internals under the Button, containers above
    // it, the page at the end. Only the implementation cluster reorders.
    expect(orderSourceCandidates([
      ...MANTINE_BUTTON,
      { name: 'Card', owner: 'PricingPage' },
      { name: 'SimpleGrid', owner: 'PricingPage' },
      { name: 'PricingPage', owner: 'unboundStoryFn' },
    ])).toEqual(['Button', 'UnstyledButton', 'Box', 'Card', 'SimpleGrid', 'PricingPage']);
  });

  it('does not cascade ownership through a component that composes several entries', () => {
    // PricingPage owns Button AND Card along this path — it is nesting
    // authored elements, not delegating its render. Without this stop the
    // sink would run through the page into Storybook's wrappers and put the
    // page ahead of the element the user clicked.
    const ordered = orderSourceCandidates([
      ...MANTINE_BUTTON,
      { name: 'Card', owner: 'PricingPage' },
      { name: 'PricingPage', owner: 'unboundStoryFn' },
      { name: 'unboundStoryFn', owner: null },
    ]);
    expect(ordered[0]).toBe('Button');
    expect(ordered.indexOf('Button')).toBeLessThan(ordered.indexOf('PricingPage'));
  });

  it('sinks only within one DOM node — delegation shares the host, composition does not', () => {
    // Box, UnstyledButton and Button all render the SAME <button> (hostDepth
    // 1); the page sits beyond its own root markup (hostDepth 2). Ownership
    // cascades through the delegation run and stops at the DOM boundary, so
    // the page can never outrank the element the user clicked.
    expect(orderSourceCandidates([
      { name: 'Box', owner: 'UnstyledButton', hostDepth: 1 },
      { name: 'UnstyledButton', owner: 'Button', hostDepth: 1 },
      { name: 'Button', owner: 'PricingPage', hostDepth: 1 },
      { name: 'PricingPage', owner: 'unboundStoryFn', hostDepth: 2 },
    ])).toEqual(['Button', 'UnstyledButton', 'Box', 'PricingPage']);
  });

  it('does not sink an authored element below a page separated by rendered markup', () => {
    // The page authored this Box directly — its owner is the page, and the
    // page's own root element sits between them. That is composition, and the
    // Box the user clicked must stay first even though the page is the sole
    // owner on this path.
    expect(orderSourceCandidates([
      { name: 'Box', owner: 'PricingPage', hostDepth: 1 },
      { name: 'PricingPage', owner: null, hostDepth: 2 },
    ])).toEqual(['Box', 'PricingPage']);
  });

  it('dedupes a repeated name, keeping the innermost entry', () => {
    expect(orderSourceCandidates([
      { name: 'Box', owner: 'UnstyledButton' },
      { name: 'UnstyledButton', owner: 'Button' },
      { name: 'Box', owner: 'Stack' },
      { name: 'Button', owner: 'PricingPage' },
    ])).toEqual(['Button', 'UnstyledButton', 'Box']);
  });

  it('terminates on an ownership cycle', () => {
    expect(() => orderSourceCandidates([
      { name: 'A', owner: 'B' },
      { name: 'B', owner: 'A' },
    ])).not.toThrow();
  });

  it('handles empty and single-entry chains', () => {
    expect(orderSourceCandidates([])).toEqual([]);
    expect(orderSourceCandidates([{ name: 'Button', owner: 'PricingPage' }])).toEqual(['Button']);
  });
});

describe('occurrence population', () => {
  /**
   * Mirrors the extractor's population rule: an element belongs to the
   * clicked element's population iff its own owner-sorted TOP candidate is
   * the same authored name.
   *
   * The measured failure: the page had 13 UnstyledButton-derived controls
   * (Buttons, ActionIcons, Menu targets…) but only 2 literal <Button>s, and
   * counting raw fiber names sent occurrence 13 — which the server rightly
   * refused ("occurrence 13 vs 2 in file") and the edit failed end-to-end.
   */
  const topOf = (chain: ChainEntry[]) => orderSourceCandidates(chain)[0];

  it('a Button and an ActionIcon share UnstyledButton but are different populations', () => {
    const actionIcon: ChainEntry[] = [
      { name: 'UnstyledButton', owner: 'ActionIcon' },
      { name: 'ActionIcon', owner: 'PricingPage' },
    ];
    expect(topOf(MANTINE_BUTTON)).toBe('Button');
    expect(topOf(actionIcon)).toBe('ActionIcon');
    // So the 13 UnstyledButton-derived controls collapse to the Buttons only:
    expect(topOf(actionIcon)).not.toBe(topOf(MANTINE_BUTTON));
  });

  it('every literal Button resolves to the same population regardless of container', () => {
    const buttonInCard: ChainEntry[] = [
      ...MANTINE_BUTTON,
      { name: 'Card', owner: 'PricingPage' },
    ];
    expect(topOf(buttonInCard)).toBe('Button');
    expect(topOf(MANTINE_BUTTON)).toBe(topOf(buttonInCard));
  });
});

describe('componentFromMarkup', () => {
  it('recovers a Mantine component from its semantic class', () => {
    expect(componentFromMarkup('div', cls('m_7341320d mantine-ThemeIcon-root')))
      .toEqual({ name: 'ThemeIcon', via: 'mantine', slot: 'root' });
  });

  it('does not mistake a Mantine utility class for a component', () => {
    // `mantine-focus-auto` sits on nearly every interactive node. Without the
    // PascalCase requirement the extractor reported a component called "focus"
    // on half the elements in a dashboard.
    expect(componentFromMarkup('button', cls('m_77c9d27d mantine-focus-auto mantine-active'))).toBeNull();
  });

  it('prefers a real component class over utility classes in the same list', () => {
    expect(componentFromMarkup('button', cls('mantine-focus-auto mantine-ActionIcon-root m_8d3f4000')))
      .toEqual({ name: 'ActionIcon', via: 'mantine', slot: 'root' });
  });

  it('returns the name each system actually uses in SOURCE, not a stripped stem', () => {
    // Stripping the prefix yields the real component name for Mantine and MUI,
    // and that coincidence nearly generalised into a Mantine-shaped rule.
    expect(componentFromMarkup('button', cls('MuiButton-root MuiButton-contained'))?.name).toBe('Button');
    // Chakra's class is lowercase; its component is PascalCase.
    expect(componentFromMarkup('button', cls('chakra-button'))?.name).toBe('Button');
    // For Vuetify the class IS the template tag — `<v-btn>`. Stripping it to
    // "btn" would discard the exact string the Vue source contains. Verified
    // against real rendered Vuetify markup, which emits `v-alert`, `v-btn`.
    expect(componentFromMarkup('button', cls('v-btn v-btn--elevated'))?.name).toBe('v-btn');
    // Ant abbreviates, so neither form is the source name; keep the token and
    // let the system label bridge it.
    expect(componentFromMarkup('button', cls('ant-btn ant-btn-primary'))?.name).toBe('ant-btn');
  });

  it('rejects Vuetify modifier and slot classes', () => {
    // Real Vuetify markup is full of `v-alert--border`, `v-alert__underlay`
    // and `v-theme--light`; none of them is a component.
    expect(componentFromMarkup('div', cls('v-alert--border v-theme--light'))).toBeNull();
    expect(componentFromMarkup('div', cls('v-alert__underlay'))).toBeNull();
  });

  it('uses the tag name for web components, which is the strongest signal', () => {
    // Shoelace, Angular Material and any custom element name themselves.
    expect(componentFromMarkup('sl-button', [])).toEqual({ name: 'sl-button', via: 'custom-element' });
    expect(componentFromMarkup('mat-card', [])).toEqual({ name: 'mat-card', via: 'custom-element' });
  });

  it('returns null for utility-class systems rather than guessing', () => {
    // Tailwind/shadcn carry no component marker. Text anchoring has to carry
    // the target instead — and a confident wrong name is worse than none.
    expect(componentFromMarkup('div', cls('flex items-center gap-2 rounded-md bg-slate-900'))).toBeNull();
  });
});

describe('describeTarget', () => {
  const base: ElementTarget = {
    component: 'ThemeIcon', via: 'mantine', tag: 'div',
    anchor: 'Deployment completed', ancestors: ['Timeline', 'Card'],
  };

  it('names the component, its text and its container', () => {
    expect(describeTarget(base)).toBe(
      'a Mantine ThemeIcon containing the text "Deployment completed" inside Timeline > Card',
    );
  });

  it('disambiguates one of several identical siblings', () => {
    expect(describeTarget({ ...base, index: 2, siblings: 4 }))
      .toContain('(item 2 of 4)');
  });

  it('falls back to the tag when no component could be identified', () => {
    expect(describeTarget({ ...base, component: null, ancestors: [] }))
      .toBe('a <div> containing the text "Deployment completed"');
  });
});

describe('targetLabel', () => {
  it('reads as a chip the user can recognise', () => {
    expect(targetLabel({ component: 'ThemeIcon', via: 'mantine', tag: 'div', anchor: 'Deployment completed', ancestors: [] }))
      .toBe('ThemeIcon · Deployment completed');
  });

  it('collapses a multi-line anchor to one line', () => {
    // An anchor taken from an element's innerText arrives with newlines. One
    // reached the composer chip and rendered as three broken lines.
    expect(targetLabel({
      component: 'ThemeIcon', via: 'mantine', tag: 'div', ancestors: [],
      anchor: 'Deployment\n\nProduction v2.4.1',
    })).toBe('ThemeIcon · Deployment Production v2.4.1');
  });

  it('truncates long text rather than blowing out the composer row', () => {
    const label = targetLabel({
      component: 'Card', via: 'mantine', tag: 'div', ancestors: [],
      anchor: 'Latest updates, mentions, and comments across your workspace',
    });
    expect(label.length).toBeLessThanOrEqual('Card · '.length + 28);
    expect(label.endsWith('…')).toBe(true);
  });
});
