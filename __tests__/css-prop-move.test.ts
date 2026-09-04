/**
 * MUI removed `alignItems` and `justifyContent` from Stack's own props in v6;
 * they belong in `sx`. A twenty-prompt MUI run produced 28 of its 29
 * first-round validation errors as exactly those two attributes, in half the
 * prompts — ten stories paying a full self-heal round trip for one mechanical
 * edit the checker had already worked out.
 *
 * The tests that matter here are the refusals. Moving a prop into a style
 * object changes what the story means if the prop was never a style, so
 * anything this cannot place must stay exactly where it is and stay a
 * violation.
 */
import { describe, it, expect } from 'vitest';
import { moveCssPropsIntoCarrier } from '../story-generator/knowledge/cssPropMove.js';
import type { PropViolation } from '../story-generator/knowledge/propConformance.js';

const violation = (over: Partial<PropViolation>): PropViolation => ({
  kind: 'unknown_prop', component: 'Stack', prop: 'alignItems', line: 1,
  styleCarrier: 'sx', message: 'x', ...over,
});

describe('moveCssPropsIntoCarrier', () => {
  it('moves the prop into the carrier the component declares', () => {
    const code = `const A = () => <Stack direction="row" alignItems="center">x</Stack>;\n`;
    const out = moveCssPropsIntoCarrier(code, [violation({})]);
    expect(out.code).toContain(`<Stack direction="row" sx={{ alignItems: "center" }}>`);
    expect(out.code).not.toContain('alignItems="center"');
    expect(out.moved).toEqual([{ line: 1, component: 'Stack', prop: 'alignItems', carrier: 'sx' }]);
    expect(out.remaining).toEqual([]);
  });

  it('merges into an sx the story already wrote, and takes several props at once', () => {
    const code = `const A = () => <Stack alignItems="center" justifyContent="space-between" sx={{ mt: 2 }}>x</Stack>;\n`;
    const out = moveCssPropsIntoCarrier(code, [
      violation({}), violation({ prop: 'justifyContent' }),
    ]);
    expect(out.code).toContain('sx={{ alignItems: "center", justifyContent: "space-between", mt: 2 }}');
    expect(out.moved).toHaveLength(2);
  });

  it('keeps a non-literal value, which is still a value the carrier can hold', () => {
    const code = `const A = ({ align }) => <Stack alignItems={align}>x</Stack>;\n`;
    const out = moveCssPropsIntoCarrier(code, [violation({})]);
    expect(out.code).toContain('sx={{ alignItems: align }}');
  });

  it('refuses a prop that is not a style, and says it is still a violation', () => {
    // `variant` is a CSS property and also every design system's most common
    // semantic prop. Moving it would change what the story means.
    const code = `const A = () => <Chip variant="filled">x</Chip>;\n`;
    const v = violation({ component: 'Chip', prop: 'variant' });
    const out = moveCssPropsIntoCarrier(code, [v]);
    expect(out.code).toBe(code);
    expect(out.moved).toEqual([]);
    expect(out.remaining).toEqual([v]);
  });

  it('refuses when the component declares no style carrier at all', () => {
    const code = `const A = () => <Stack alignItems="center">x</Stack>;\n`;
    const v = violation({ styleCarrier: undefined });
    const out = moveCssPropsIntoCarrier(code, [v]);
    expect(out.code).toBe(code);
    expect(out.remaining).toEqual([v]);
  });

  it('refuses when the carrier is not an object literal, leaving the prop in place', () => {
    // The attribute must never be removed unless its value has somewhere to
    // go: an earlier draft deleted it and then declined to place it.
    const code = `const A = ({ styles }) => <Stack alignItems="center" sx={styles}>x</Stack>;\n`;
    const v = violation({});
    const out = moveCssPropsIntoCarrier(code, [v]);
    expect(out.code).toBe(code);
    expect(out.moved).toEqual([]);
    expect(out.remaining).toEqual([v]);
  });

  it('refuses a bare flag, which has no value to carry', () => {
    const code = `const A = () => <Stack alignItems>x</Stack>;\n`;
    const v = violation({});
    const out = moveCssPropsIntoCarrier(code, [v]);
    expect(out.code).toBe(code);
    expect(out.remaining).toEqual([v]);
  });

  it('leaves every other violation untouched and reports it', () => {
    const code = `const A = () => <Stack elevation={2}>x</Stack>;\n`;
    const v = violation({ prop: 'elevation' });
    const out = moveCssPropsIntoCarrier(code, [v]);
    expect(out.code).toBe(code);
    expect(out.remaining).toEqual([v]);
  });
});
