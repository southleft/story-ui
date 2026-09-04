/**
 * Spacing guidance is DERIVED from the design system, never prescribed.
 *
 * A gap primitive in the catalog, a spacing scale in the stylesheet, or the
 * utility steps in the team's own stories become the rules; only a system
 * with none of them gets the inline pixel examples, and the prompt says so.
 * The same vocabulary judges the output: an inline `padding: 24px` is an
 * error where a scale exists and is nothing where none does.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  deriveSpacingVocabulary, formatSpacingRules, checkInlineSpacing, checkTokenTiers, checkRawColors,
  spacingScaleFrom, aliasesFrom, exampleElement,
} from '../story-generator/knowledge/spacingFacts.js';
import { readStylingIdiom, formatStylingGuidance } from '../story-generator/knowledge/stylingFacts.js';
import { generateLayoutInstructions } from '../story-generator/promptGenerator.js';
import type { StylingFacts } from '../story-generator/knowledge/stylingFacts.js';

const fallback = {
  wrapper: 'render: () => <div style={{ padding: "24px" }}>...content...</div>',
  formGap: '<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>',
  buttonMargin: '<div style={{ marginTop: "24px" }}><Button>Submit</Button></div>',
};

const component = (name: string, category: any, props: Array<{ name: string; type?: string; options?: string[]; optionsOpen?: boolean; doc?: string }>) => ({
  name, filePath: '', description: '', category, props: props.map(p => p.name), slots: [], examples: [],
});

const facts = (entries: Record<string, Array<{ name: string; type?: string; options?: string[]; optionsOpen?: boolean; doc?: string; deprecated?: string }>>) => ({
  importPath: 'x', inheritedOnly: [], extractedAt: '', components: Object.fromEntries(Object.entries(entries).map(([name, props]) => [name, { name, props: props.map(p => ({ required: false, ...p })) }])),
});

const styling = (tokens: StylingFacts['tokens'], idiom: StylingFacts['idiom'] = { attributes: [], sampled: 0 }): StylingFacts => ({
  tokens, idiom, sources: { projectFiles: 1, packageFiles: 0, declaredFiles: 0, tokens: tokens.reduce((n, g) => n + g.names.length, 0), lookedAtNothing: false },
});

describe('deriveSpacingVocabulary', () => {
  it('finds gap primitives with their declared values and orientation (Mantine shape)', () => {
    const v = deriveSpacingVocabulary({
      components: [component('Stack', 'layout', []), component('Group', 'layout', []), component('Button', 'form', [])],
      facts: facts({
        Stack: [{ name: 'gap', type: 'MantineSpacing', options: ['xs', 'sm', 'md', 'lg', 'xl'], optionsOpen: true }, { name: 'align', type: 'string' }],
        Group: [{ name: 'gap', type: 'MantineSpacing', options: ['xs', 'sm', 'md', 'lg', 'xl'], optionsOpen: true }],
        Button: [{ name: 'onClick', type: '() => void' }],
      }),
    });
    expect(v.hasScale).toBe(true);
    expect(v.gapPrimitives.map(p => p.name)).toEqual(['Group', 'Stack']);
    expect(v.gapPrimitives[1].values).toEqual(['xs', 'sm', 'md', 'lg', 'xl']);
    expect(v.gapPrimitives[1].open).toBe(true);
  });

  it('keeps a gap prop whose scale the type does not enumerate (Carbon: (typeof SPACING_STEPS)[number])', () => {
    const v = deriveSpacingVocabulary({
      components: [component('Stack', 'layout', [])],
      facts: facts({ Stack: [
        { name: 'gap', type: 'string | (typeof SPACING_STEPS)[number]', doc: 'Provide either a custom value or a step from the spacing scale' },
        { name: 'orientation', type: "'horizontal' | 'vertical'", options: ['horizontal', 'vertical'] },
      ] }),
    });
    expect(v.gapPrimitives).toHaveLength(1);
    expect(v.gapPrimitives[0].values).toEqual([]);
    expect(v.gapPrimitives[0].open).toBe(true);
    expect(v.gapPrimitives[0].orientation).toEqual({ prop: 'orientation', values: ['horizontal', 'vertical'] });
    const rules = formatSpacingRules(v, 'jsx', fallback);
    expect(rules).toContain('<Stack gap=');
    expect(rules).toContain('a step from the spacing scale');
    expect(rules).not.toContain('padding: "24px"');
    // The action row must be ruled out as well as ruled in: two of three
    // first-attempt failures measured on Carbon were a Cancel/Save pair in a
    // container that handed each button a share of the spare width.
    expect(rules).toContain('SIZE TO ITS CONTENT');
    expect(rules).toContain('space-between/space-around/space-evenly');
    expect(rules).toContain('Spare width belongs OUTSIDE the group');
  });

  it('reads the spacing scale from tokens whose name says spacing AND whose value is a length, sorted by size', () => {
    const scale = spacingScaleFrom(styling([
      { category: 'spacing', names: ['ss-space-16', 'ss-space-4', 'cds-grid-margin', 'layout--size-lg', 'ss-comp-button-gap-xs', 'ss-space-64'],
        values: { 'ss-space-16': '16px', 'ss-space-4': '4px', 'cds-grid-margin': '0', 'layout--size-lg': 'where(.x)', 'ss-comp-button-gap-xs': 'var(--ss-space-4)', 'ss-space-64': '4rem' } },
    ]));
    expect(scale.map(t => t.name)).toEqual(['ss-space-4', 'ss-space-16', 'ss-space-64']);
    expect(scale.find(t => t.name === 'ss-space-64')?.value).toBe('4rem');
    // One stray `gap` token is a component's internals, not a scale.
    expect(spacingScaleFrom(styling([{ category: 'spacing', names: ['cds-stack-gap'], values: { 'cds-stack-gap': '0.125rem' } }]))).toEqual([]);
  });

  it('with tokens and no layout component the prompt gives ONE recipe in the scale, border-box, and no pixel literal', () => {
    const v = deriveSpacingVocabulary({
      components: [component('Button', 'form', [{ name: 'variant', type: "'primary' | 'ghost'" }]), component('Heading', 'content', [{ name: 'level', type: '1 | 2 | 3' }])],
      facts: facts({ Heading: [{ name: 'level', type: '1 | 2 | 3' }] }),
      styling: styling([{ category: 'spacing', names: ['ss-space-8', 'ss-space-16', 'ss-space-24', 'ss-space-32'], values: { 'ss-space-8': '8px', 'ss-space-16': '16px', 'ss-space-24': '24px', 'ss-space-32': '32px' } }]),
      layoutRules: { multiColumnWrapper: 'Grid', columnComponent: 'Grid', containerComponent: 'div', layoutExamples: { twoColumn: "<div style={{display: 'grid', gap: '1rem'}}>…</div>" } },
    });
    expect(v.hasScale).toBe(true);
    expect(v.gapPrimitives).toEqual([]);
    expect(v.columns).toBeUndefined();          // `Grid` is not in the catalog
    expect(v.layoutExamples).toEqual([]);       // the config example teaches `gap: '1rem'`
    const rules = formatSpacingRules(v, 'jsx', fallback);
    expect(rules).toContain('repeat(3, minmax(0, 1fr))');
    expect(rules).toContain('boxSizing: "border-box"');
    expect(rules).toContain('var(--ss-space-');
    expect(rules).toMatch(/gap: "var\(--ss-space-\d+\)"/);
    // The scale lists its values (`--ss-space-8 (8px)`); no style property may carry a literal.
    expect(rules).not.toMatch(/(padding|gap|margin\w*):\s*"?\d+(px|rem)/);
    expect(rules).not.toContain('1rem');
    expect(rules).toContain('<Heading level=[1|2|3]>');
  });

  it('uses the team\'s own utility steps when the idiom is className', () => {
    const v = deriveSpacingVocabulary({
      components: [component('Card', 'layout', [{ name: 'className', type: 'string' }])],
      styling: styling([], { attributes: [{ name: 'className', uses: 1767 }, { name: 'style', uses: 3 }], sampled: 50, spacingClasses: [{ name: 'gap-4', uses: 31 }, { name: 'p-6', uses: 12 }, { name: 'space-y-2', uses: 8 }] }),
      layoutRules: { multiColumnWrapper: 'div', columnComponent: 'div', layoutExamples: { twoColumn: '<div className="grid grid-cols-2 gap-4">…</div>' } },
    });
    expect(v.hasScale).toBe(true);
    expect(v.utilities?.attribute).toBe('className');
    expect(v.layoutExamples).toHaveLength(1);
    const rules = formatSpacingRules(v, 'jsx', fallback);
    expect(rules).toContain('gap-4 (31)');
    expect(rules).toContain('className="p-6"');
    expect(rules).toContain('grid grid-cols-2 gap-4');
    expect(rules).not.toContain('24px');
  });

  it('honours config wrapper/column names only when the catalog has them', () => {
    const v = deriveSpacingVocabulary({
      components: [component('Grid', 'layout', [{ name: 'withRowGap', type: 'boolean' }]), component('Column', 'layout', [{ name: 'lg', type: 'ColumnSpan' }]), component('Stack', 'layout', [{ name: 'gap', type: 'string | number' }])],
      layoutRules: { multiColumnWrapper: 'Grid', columnComponent: 'Column', containerComponent: 'Grid' },
    });
    expect(v.columns).toEqual({ wrapper: 'Grid', column: 'Column', container: 'Grid' });
    const rules = formatSpacingRules(v, 'jsx', fallback);
    expect(rules).toContain('<Grid> with each column in <Column>');
  });

  it('falls back to the inline examples, and says why, when nothing is derivable', () => {
    const v = deriveSpacingVocabulary({ components: [component('Button', 'form', [{ name: 'label', type: 'string' }])] });
    expect(v.hasScale).toBe(false);
    const rules = formatSpacingRules(v, 'jsx', fallback);
    expect(rules).toContain('declares no layout primitive with a gap prop, no spacing tokens');
    expect(rules).toContain(fallback.wrapper);
    expect(formatSpacingRules(null, 'html', fallback)).toContain(fallback.formGap);
  });

  it('writes examples in template syntax for non-React frameworks', () => {
    expect(exampleElement('Stack', { gap: 4 }, 'jsx')).toBe('<Stack gap={4}>…</Stack>');
    expect(exampleElement('v-stack', { gap: 4 }, 'html')).toBe('<v-stack gap="4">…</v-stack>');
    const v = deriveSpacingVocabulary({
      components: [component('Button', 'form', [])],
      styling: styling([{ category: 'spacing', names: ['sl-spacing-small', 'sl-spacing-medium', 'sl-spacing-large'], values: { 'sl-spacing-small': '0.5rem', 'sl-spacing-medium': '1rem', 'sl-spacing-large': '1.5rem' } }]),
    });
    const rules = formatSpacingRules(v, 'html', fallback);
    expect(rules).toContain('style="display: flex; flex-direction: column; gap: var(--sl-spacing-medium)"');
    expect(rules).not.toContain('style={{');
  });
});

describe('token tiers', () => {
  const tiered = styling([{
    category: 'color',
    names: ['ss-navy-50', 'ss-navy-900', 'ss-color-surface', 'ss-color-background-brand', 'ss-comp-card-background'],
    values: { 'ss-navy-50': '#F2F5F9', 'ss-navy-900': '#0B1F3A', 'ss-color-surface': 'var(--ss-navy-50)', 'ss-color-background-brand': 'var(--ss-navy-900)', 'ss-comp-card-background': 'var(--ss-color-surface)' },
  }]);

  it('derives primitive → aliases from the value chains, not from names', () => {
    expect(aliasesFrom(tiered)).toEqual({ 'ss-navy-50': ['ss-color-surface'], 'ss-navy-900': ['ss-color-background-brand'] });
  });

  it('reports a primitive used where an alias exists, naming the alias', () => {
    const v = deriveSpacingVocabulary({ components: [], styling: tiered });
    const out = checkTokenTiers('const a = 1;\nconst s = { background: "var(--ss-navy-50)", color: "var(--ss-color-surface)" };', v);
    expect(out).toHaveLength(1);
    expect(out[0].line).toBe(2);
    expect(out[0].message).toContain('--ss-color-surface');
    expect(checkTokenTiers('var(--ss-color-surface)', v)).toEqual([]);
  });

  it('lists semantic colours before primitives in the styling guidance', () => {
    const text = formatStylingGuidance(tiered);
    expect(text.indexOf('--ss-color-surface')).toBeLessThan(text.indexOf('--ss-navy-50'));
    expect(text).toContain('semantic — use these');
    expect(text).toContain('primitive — only where no semantic token');
  });
});

describe('checkInlineSpacing', () => {
  const carbon = deriveSpacingVocabulary({
    components: [component('Stack', 'layout', []), component('Heading', 'content', [])],
    facts: facts({ Stack: [{ name: 'gap', type: 'string | (typeof SPACING_STEPS)[number]' }], Heading: [{ name: 'children' }] }),
  });

  it('flags px, rem and bare-number spacing in JSX style objects, with the primitive to use', () => {
    const code = [
      'const A = () => (',
      '  <div style={{ padding: "24px", maxWidth: 400 }}>',
      '    <div style={{ marginTop: "1rem" }} />',
      '    <div style={{ gap: 16, display: "flex" }} />',
      '    <div style={{ margin: 0, padding: "0 auto", gap: "var(--cds-spacing-05)" }} />',
      '  </div>',
      ');',
    ].join('\n');
    const out = checkInlineSpacing(code, carbon);
    expect(out.map(v => `${v.line}:${v.property}=${v.value}`)).toEqual(['2:padding=24px', '3:marginTop=1rem', '4:gap=16']);
    expect(out[1].message).toContain('<Stack gap=');
  });

  it('flags inline font overrides only when the catalog has a typography component', () => {
    const code = '<Heading style={{ fontSize: "1.5rem", fontWeight: 600 }}>Hi</Heading>';
    expect(checkInlineSpacing(code, carbon)).toHaveLength(2);
    expect(checkInlineSpacing(code, carbon)[0].message).toContain('<Heading>');
    const noTypo = deriveSpacingVocabulary({ components: [component('Stack', 'layout', [{ name: 'gap', type: 'number' }])] });
    expect(checkInlineSpacing(code, noTypo)).toEqual([]);
  });

  it('reads template style strings for the non-React frameworks', () => {
    const v = deriveSpacingVocabulary({ components: [], styling: styling([{ category: 'spacing', names: ['sl-spacing-small', 'sl-spacing-medium', 'sl-spacing-large'], values: { 'sl-spacing-small': '0.5rem', 'sl-spacing-medium': '1rem', 'sl-spacing-large': '1.5rem' } }]) });
    const out = checkInlineSpacing('<div style="padding: 24px; gap: var(--sl-spacing-medium)">', v);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('var(--sl-spacing-small)');
  });

  it('flags arbitrary utility values where the team uses a utility scale', () => {
    const v = deriveSpacingVocabulary({ components: [], styling: styling([], { attributes: [{ name: 'className', uses: 9 }], sampled: 3, spacingClasses: [{ name: 'gap-4', uses: 5 }] }) });
    const out = checkInlineSpacing('<div className="flex p-[24px] gap-4" />', v);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('gap-4');
  });

  it('is absent, not zero, without a scale', () => {
    const none = deriveSpacingVocabulary({ components: [] });
    expect(none.hasScale).toBe(false);
    expect(checkInlineSpacing('<div style={{ padding: "24px" }} />', none)).toEqual([]);
  });

  it('reads sx, which is the same declaration object under another name', () => {
    // The MUI review found raw pixel padding inside sx on stories this check
    // reported clean: the literal was there, the scanner looked for `style`.
    const out = checkInlineSpacing('<Box sx={{ padding: "24px", mt: 2 }} />', carbon);
    expect(out.map(v => `${v.property}=${v.value}`)).toEqual(['padding=24px']);
  });
});

describe('checkRawColors', () => {
  const tiered = deriveSpacingVocabulary({
    components: [],
    styling: styling([{
      category: 'color',
      names: ['ss-navy-50', 'ss-color-surface'],
      values: { 'ss-navy-50': '#F2F5F9', 'ss-color-surface': 'var(--ss-navy-50)' },
    }]),
  });

  it('flags a literal colour and names a token to use instead', () => {
    const out = checkRawColors('<div style={{ color: "#0B1F3A", padding: "8px" }} />', tiered);
    expect(out).toHaveLength(1);
    expect(out[0].property).toBe('color');
    expect(out[0].message).toContain('var(--ss-color-surface)');
    // rgb() and sx are the same defect.
    expect(checkRawColors('<Box sx={{ backgroundColor: "rgba(0,0,0,.5)" }} />', tiered)).toHaveLength(1);
  });

  it('leaves tokens and non-colour properties alone', () => {
    expect(checkRawColors('<div style={{ color: "var(--ss-color-surface)" }} />', tiered)).toEqual([]);
    expect(checkRawColors('<div style={{ padding: "24px" }} />', tiered)).toEqual([]);
  });

  it('is absent, not zero, on a project that declares no colour tokens', () => {
    // With no token system a literal is the only way to write a colour, so
    // flagging it would be noise — and silence here must mean "not checked".
    const none = deriveSpacingVocabulary({ components: [] });
    expect(Object.keys(none.aliasesOf)).toHaveLength(0);
    expect(checkRawColors('<div style={{ color: "#fff" }} />', none)).toEqual([]);
  });
});

describe('readStylingIdiom spacing utilities', () => {
  it('counts the spacing steps the team writes in className, skipping expressions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'idiom-'));
    fs.mkdirSync(path.join(root, 'src', 'components', 'card'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'components', 'card', 'card.stories.tsx'), [
      'export const A = () => <div className="flex flex-col gap-4 p-6 md:p-8"><span className={cn("gap-2", x)} /></div>;',
      'export const B = () => <div className="grid gap-4"><i className={"space-y-2"} /></div>;',
    ].join('\n'));
    const idiom = readStylingIdiom(root);
    expect(idiom.attributes[0].name).toBe('className');
    expect(idiom.spacingClasses).toEqual([{ name: 'gap-4', uses: 2 }, { name: 'p-6', uses: 1 }, { name: 'p-8', uses: 1 }, { name: 'space-y-2', uses: 1 }]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('generateLayoutInstructions', () => {
  const config: any = { layoutRules: { multiColumnWrapper: 'Grid', columnComponent: 'Column', containerComponent: 'Grid' } };
  it('withholds the pixel doctrine when the vocabulary has a scale', () => {
    const v = deriveSpacingVocabulary({ components: [component('Grid', 'layout', [{ name: 'withRowGap', type: 'boolean' }]), component('Column', 'layout', [{ name: 'lg', type: 'ColumnSpan' }]), component('Stack', 'layout', [{ name: 'gap', type: 'number' }])], layoutRules: config.layoutRules });
    const text = generateLayoutInstructions(config, { spacing: v }).join('\n');
    expect(text).not.toContain('16px');
    expect(text).not.toContain('marginTop');
    expect(text).toContain('DERIVED FROM THIS DESIGN SYSTEM');
    expect(text).toContain('<Grid><Column>');
  });
  it('keeps the doctrine when nothing was derived', () => {
    const text = generateLayoutInstructions(config).join('\n');
    expect(text).toContain('MINIMUM 16px gap');
  });
  it('does not name a config wrapper the catalog lacks', () => {
    const v = deriveSpacingVocabulary({ components: [component('Button', 'form', [])], styling: styling([{ category: 'spacing', names: ['space-4', 'space-8', 'space-16'], values: { 'space-4': '4px', 'space-8': '8px', 'space-16': '16px' } }]), layoutRules: config.layoutRules });
    const text = generateLayoutInstructions(config, { spacing: v }).join('\n');
    expect(text).not.toContain('<Grid>');
  });
});

describe('repairSpacingNote', () => {
  it('names the primitive, padding owner, tokens or utilities in one paragraph, and is absent without a scale', async () => {
    const { repairSpacingNote } = await import('../story-generator/knowledge/spacingFacts.js');
    const v = deriveSpacingVocabulary({
      components: [component('Stack', 'layout', [])],
      facts: facts({ Stack: [{ name: 'gap', type: 'MantineSpacing', options: ['xs', 'sm', 'md'], optionsOpen: true }] }),
      styling: styling([{ category: 'spacing', names: ['space-4', 'space-8', 'space-16'], values: { 'space-4': '4px', 'space-8': '8px', 'space-16': '16px' } }]),
    });
    const note = repairSpacingNote(v)!;
    expect(note).toContain('<Stack gap=…> (xs | sm | md)');
    expect(note).toContain('var(--space-4)');
    expect(note).toContain('a repair that adds one is rejected');
    expect(repairSpacingNote(deriveSpacingVocabulary({ components: [] }))).toBeNull();
  });
});
