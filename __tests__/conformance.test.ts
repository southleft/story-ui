/**
 * Does the output conform to the facts we supplied?
 *
 * This replaces a habit rather than adding a check. Every defect found by review
 * was the model applying knowledge true SOMEWHERE ELSE — `isSelected` is React
 * Aria's prop, `DataTable render` is Carbon's own docs a version ago, a menu
 * without a positioner is Radix's composition on Chakra. And in nearly every
 * case the knowledge layer already held the right answer. We knew, and the
 * knowledge lost.
 *
 * So the question is not "what other defect classes exist" — unbounded, and it
 * generates one hand-written check per answer. It is "for every fact we extract,
 * is the output conformant?" — bounded by the knowledge layer, and it grows
 * whenever extraction improves.
 *
 * THE CONSTRAINT these tests exist to protect: a rule may only fire where the
 * fact is CLOSED. Measured, the naive version was unusable — unknown-prop
 * validation flagged 6,097 of 6,541 Mantine elements, because Mantine's
 * `checked`/`onChange` arrive through `ElementProps<'input'>` and extraction
 * cannot see them. Rejecting correct code is worse than missing a defect: it
 * teaches the reader to ignore the report.
 */

import { describe, it, expect } from 'vitest';
import { checkConformance, formatConformanceErrors } from '../story-generator/knowledge/conformance.js';

const known = (components: Record<string, any>) => ({ components });

const CARBON = known({
  Button: { name: 'Button', props: [
    { name: 'kind', options: ['primary', 'secondary', 'tertiary', 'ghost', 'danger'] },
    { name: 'size', options: ['sm', 'md', 'lg'] },
    { name: 'disabled' },
  ] },
  DataTable: { name: 'DataTable', props: [
    { name: 'rows' },
    { name: 'render', deprecated: 'Use `children` instead.' },
  ] },
  Lozenge: { name: 'Lozenge', props: [{ name: 'isBold', deprecated: 'deprecated' }] },
});

describe('enum values', () => {
  it('flags a value outside the resolved option set', () => {
    const v = checkConformance(`const a = <Button kind="destructive">Go</Button>;`, CARBON);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('enum_value');
    // The message must name the legal values, not merely reject.
    expect(v[0].message).toContain('primary');
    expect(v[0].message).toContain('danger');
  });

  it('accepts a legal value', () => {
    expect(checkConformance(`const a = <Button kind="danger">Go</Button>;`, CARBON)).toEqual([]);
  });

  it('reads a value written as an expression container', () => {
    expect(checkConformance(`const a = <Button kind={"nope"} />;`, CARBON)).toHaveLength(1);
  });

  it('never judges a non-literal value', () => {
    // `kind={x}` could be anything; guessing is how a check starts rejecting
    // correct code.
    expect(checkConformance(`const a = <Button kind={variant} />;`, CARBON)).toEqual([]);
    expect(checkConformance(`const a = <Button kind={cond ? 'a' : 'b'} />;`, CARBON)).toEqual([]);
  });

  it('says nothing about a prop with no resolved options', () => {
    expect(checkConformance(`const a = <Button disabled="yes" />;`, CARBON)).toEqual([]);
  });
});

describe('deprecated props', () => {
  it('flags a deprecated prop and names the replacement', () => {
    const v = checkConformance(`const a = <DataTable render={fn} rows={r} />;`, CARBON);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('deprecated_prop');
    expect(v[0].message).toContain('children');
  });

  it('handles a bare @deprecated with no replacement text', () => {
    const v = checkConformance(`const a = <Lozenge isBold />;`, CARBON);
    expect(v).toHaveLength(1);
    // Must not read as "deprecates. deprecated".
    expect(v[0].message).not.toMatch(/deprecates\.\s*deprecated/);
  });

  it('says nothing about a current prop', () => {
    expect(checkConformance(`const a = <DataTable rows={r} />;`, CARBON)).toEqual([]);
  });
});

describe('what it refuses to judge', () => {
  it('ignores components it has no facts for', () => {
    // Silence here is correct: unknown component, no basis for a claim.
    expect(checkConformance(`const a = <Mystery kind="whatever" />;`, CARBON)).toEqual([]);
  });

  it('ignores unknown props — that needs a completeness signal first', () => {
    // `isSelected` on a component whose props we hold PARTIALLY would be a false
    // positive on every library whose props arrive through inheritance.
    expect(checkConformance(`const a = <Button isSelected />;`, CARBON)).toEqual([]);
  });

  it('ignores universal React props', () => {
    expect(checkConformance(`const a = <Button className="x" key="k" style={{}} />;`, CARBON)).toEqual([]);
  });

  it('ignores aria- and data- attributes', () => {
    expect(checkConformance(`const a = <Button aria-label="x" data-testid="y" />;`, CARBON)).toEqual([]);
  });

  it('returns nothing when there is no knowledge at all', () => {
    expect(checkConformance(`const a = <Button kind="nope" />;`, null)).toEqual([]);
    expect(checkConformance(`const a = <Button kind="nope" />;`, { components: {} })).toEqual([]);
  });

  it('does not throw on unparseable code', () => {
    expect(() => checkConformance('const a = <Button kind=', CARBON)).not.toThrow();
  });
});

describe('reporting', () => {
  it('carries a line number a human can act on', () => {
    const code = ['const x = 1;', '', 'const a = <Button kind="destructive" />;'].join('\n');
    expect(checkConformance(code, CARBON)[0].line).toBe(3);
  });

  it('formats for the self-healing loop', () => {
    const out = formatConformanceErrors(checkConformance(`const a = <Button kind="nope" />;`, CARBON));
    expect(out[0]).toMatch(/^Line \d+: /);
  });
});
