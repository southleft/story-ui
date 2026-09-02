/**
 * "Fix:" chips are a promise that the story can fix the finding.
 *
 * On a Vue project, the warning "Class v-card--density-default is not
 * defined by any loaded stylesheet" — Vuetify's own markup, which nothing
 * outside React can attribute — was offered as a chip. Sending it to the
 * model as the next prompt asks it to fix the library.
 */

import { describe, it, expect } from 'vitest';
import { repairableByStory, attributionSupported } from '../story-generator/verify/verifyStory.js';
import type { Finding } from '../story-generator/verify/findings.js';

const vCard: Finding = {
  id: 'class-no-effect-0', severity: 'warning', class: 'code',
  message: 'Class v-card--density-default is not defined by any loaded stylesheet',
  repairable: true,
};
const unnamedIcon: Finding = {
  id: 'unnamed-icon-0', severity: 'blocker', class: 'a11y',
  message: 'Icon-only button has no accessible name', repairable: true, selector: 'button:nth-of-type(2)',
};
const staticOnly: Finding = {
  id: 'static-only', severity: 'info', class: 'interaction', message: 'No interactive elements', repairable: false,
};
const libraryOwned: Finding = {
  id: 'clickable-non-button-1', severity: 'warning', class: 'a11y',
  message: 'Sortable header is not keyboard reachable', repairable: false,
};
const unreachable: Finding = {
  id: 'storybook-unreachable', severity: 'warning', class: 'infrastructure',
  message: 'Storybook at http://localhost:6103 is not reachable', repairable: false,
};

describe('attributionSupported', () => {
  it('is React-only, and React when unstated', () => {
    expect(attributionSupported('react')).toBe(true);
    expect(attributionSupported(undefined)).toBe(true);
    expect(attributionSupported('vue')).toBe(false);
    expect(attributionSupported('angular')).toBe(false);
    expect(attributionSupported('svelte')).toBe(false);
    expect(attributionSupported('web-components')).toBe(false);
  });
});

describe('repairableByStory', () => {
  it('offers nothing on a framework where findings cannot be attributed', () => {
    expect(repairableByStory([vCard, unnamedIcon], 'vue')).toEqual([]);
  });

  it('offers only repairable, non-infrastructure blockers and warnings on React', () => {
    const chips = repairableByStory([vCard, unnamedIcon, staticOnly, libraryOwned, unreachable], 'react');
    expect(chips.map(f => f.id)).toEqual(['class-no-effect-0', 'unnamed-icon-0']);
  });

  it('does not offer an unrepairable blocker — a chip cannot fix it either', () => {
    const blocker: Finding = { ...libraryOwned, severity: 'blocker' };
    expect(repairableByStory([blocker], 'react')).toEqual([]);
  });

  it('never offers an infrastructure finding, whatever it says about repair', () => {
    expect(repairableByStory([{ ...unreachable, repairable: true }], 'react')).toEqual([]);
  });
});
