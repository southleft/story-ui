/**
 * The preview file `init` writes, generated from what the design system states.
 *
 * What this replaces returned early for every design system except two —
 * chakra and mantine — writing no file and printing nothing. Measured on this
 * repo's own test beds, Carbon, Fluent, Astryx and Atlassian all fell through
 * it. Atlassian still has no preview file; the other four were written by hand,
 * and Astryx was wrong twice, silently.
 *
 * The invariant with teeth: nothing is written that was not resolved first.
 * That is what makes the failure which took a whole Storybook preview down —
 * a real file the package's exports map refuses — structurally impossible
 * rather than merely unlikely.
 */

import { describe, it, expect } from 'vitest';
import { renderPreviewFromContract, PREVIEW_MARKER } from '../cli/setup.js';
import type { HostContract } from '../story-generator/knowledge/hostContract.js';

const base = (over: Partial<HostContract> = {}): HostContract => ({
  schemaVersion: 1,
  packages: [],
  css: { status: 'not_applicable', requirements: [], rejected: [] },
  gates: { status: 'not_applicable', required: [] },
  tokenCanaries: [],
  ...over,
} as HostContract);

const sheet = (specifier: string, declaredProperties = 10) => ({
  specifier, resolvedTo: `/abs/${specifier}`, declaredProperties, layers: [], gates: [],
});

describe('stylesheet imports', () => {
  it('writes each resolved specifier', () => {
    const out = renderPreviewFromContract(base({
      css: { status: 'satisfied', requirements: [sheet('@carbon/styles/css/styles.css', 763)], rejected: [] },
    }), null);
    expect(out).toContain(`import '@carbon/styles/css/styles.css';`);
  });

  it('never writes a specifier that was rejected', () => {
    // The Astryx trap: dist/astryx.css is a real file the package forbids.
    const out = renderPreviewFromContract(base({
      css: {
        status: 'satisfied',
        requirements: [sheet('@astryxdesign/core/astryx.css', 203)],
        rejected: [{ specifier: '@astryxdesign/core/dist/astryx.css', reason: 'FORBIDDEN_BUT_PRESENT' }],
      },
    }), null);
    expect(out).toContain(`import '@astryxdesign/core/astryx.css';`);
    expect(out).not.toContain('dist/astryx.css');
  });

  it('emits no stylesheet import when the system ships none', () => {
    // Fluent's real shape — provider only, zero stylesheets.
    const out = renderPreviewFromContract(base(), {
      imports: [`import { FluentProvider, webLightTheme } from '@fluentui/react-components';`],
      open: '<FluentProvider theme={webLightTheme}>', close: '</FluentProvider>',
    });
    expect(out).not.toMatch(/import '.*\.css'/);
    expect(out).toContain('FluentProvider');
  });
});

describe('a scoped theme gate', () => {
  const gated = base({
    css: { status: 'satisfied', requirements: [sheet('@ds/theme/theme.css', 172)], rejected: [] },
    gates: {
      status: 'satisfied',
      required: [{ attribute: 'data-astryx-theme', value: 'neutral', source: '@scope', propertiesBehindGate: 172 }],
    },
  });

  it('wraps the story in the required attribute', () => {
    const out = renderPreviewFromContract(gated, null);
    expect(out).toContain('<div data-astryx-theme="neutral">');
    expect(out).toContain('</div>');
  });

  it('says what the gate is worth, so removing it is not a silent mistake', () => {
    const out = renderPreviewFromContract(gated, null);
    expect(out).toContain('172');
  });

  it('nests the gate outside the provider', () => {
    const out = renderPreviewFromContract(gated, {
      imports: [`import { P } from 'x';`], open: '<P>', close: '</P>',
    });
    // The attribute must be an ANCESTOR of everything the provider renders,
    // or the scope does not cover the tree.
    expect(out.indexOf('data-astryx-theme')).toBeLessThan(out.indexOf('<P>'));
  });

  it('omits the wrapper entirely when no gate is required', () => {
    const out = renderPreviewFromContract(base({
      css: { status: 'satisfied', requirements: [sheet('@mantine/core/styles.css', 942)], rejected: [] },
    }), null);
    expect(out).not.toContain('<div data-');
  });
});

describe('the generated file identifies itself', () => {
  it('carries the marker, so a hand-edited preview is never clobbered', () => {
    expect(renderPreviewFromContract(base(), null)).toContain(PREVIEW_MARKER);
  });
});
