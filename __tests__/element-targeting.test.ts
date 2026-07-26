/**
 * Recovering a design system component name from rendered markup.
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
  targetLabel,
  type ElementTarget,
} from '../templates/StoryUIV2/elementTargeting.js';

const cls = (s: string) => s.split(/\s+/).filter(Boolean);

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
