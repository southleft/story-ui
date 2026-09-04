/**
 * The deterministic half of the stretch defect.
 *
 * Four rounds of prompt guidance did not stop a story putting two buttons at
 * opposite ends of a void, while the repair pass fixed it almost every time.
 * There is exactly one correct edit — one attribute on one element — so it is
 * made here instead of asked for.
 *
 * The tests that matter most are the ones asserting it does NOT fire. A row
 * inside the same container that holds a heading and a badge is a header meant
 * to span the full width, and hugging it would be a regression introduced by
 * a transform nobody asked for.
 */
import { describe, it, expect } from 'vitest';
import { fixStretchedControlRows } from '../story-generator/knowledge/stretchFix.js';
import type { LayoutBehaviour } from '../story-generator/knowledge/stylingFacts.js';

/** What readLayoutBehaviour derives from @carbon/styles for Stack. */
const carbon: LayoutBehaviour[] = [
  {
    component: 'Stack', className: 'cds--stack-vertical', display: 'grid', autoFlow: 'row',
    variant: { prop: 'orientation', value: 'vertical' }, stretchesChildren: true,
  },
  {
    component: 'Stack', className: 'cds--stack-horizontal', display: 'inline-grid', autoFlow: 'column',
    variant: { prop: 'orientation', value: 'horizontal' }, stretchesChildren: false,
  },
];

const wrap = (inner: string) => `export const Default = {\n  render: () => (\n    <Stack gap={5}>\n${inner}\n    </Stack>\n  ),\n};\n`;

describe('fixStretchedControlRows', () => {
  it('holds a pair of buttons to their content, naming what it did', () => {
    const code = wrap('      <Stack orientation="horizontal" gap={3}>\n        <Button>Save changes</Button>\n        <Button kind="secondary">Cancel</Button>\n      </Stack>');
    const out = fixStretchedControlRows(code, carbon);
    expect(out.ran).toBe(true);
    expect(out.edits).toHaveLength(1);
    expect(out.edits[0]).toMatchObject({ container: 'Stack', row: 'Stack', control: 'Button', count: 2, property: 'justifySelf' });
    expect(out.code).toContain(`<Stack orientation="horizontal" gap={3} style={{ justifySelf: 'start' }}>`);
    // Nothing else moved.
    expect(out.code).toContain('<Button kind="secondary">Cancel</Button>');
  });

  it('merges into a style the story already wrote', () => {
    const code = wrap("      <Stack orientation=\"horizontal\" style={{ marginTop: 8 }}>\n        <Button>A</Button>\n        <Button>B</Button>\n      </Stack>");
    const out = fixStretchedControlRows(code, carbon);
    expect(out.edits).toHaveLength(1);
    expect(out.code).toContain("style={{ justifySelf: 'start', marginTop: 8 }}");
  });

  it('leaves a header row of different components alone', () => {
    // A heading beside a badge is meant to span the width. This is the
    // regression the narrow rule exists to avoid, not an edge case.
    const code = wrap('      <Stack orientation="horizontal">\n        <Heading>Team plan</Heading>\n        <Tag type="blue">Popular</Tag>\n      </Stack>');
    const out = fixStretchedControlRows(code, carbon);
    expect(out.edits).toEqual([]);
    expect(out.code).toBe(code);
  });

  it('leaves a row that has already decided its width, and says why', () => {
    for (const [attr, why] of [
      ['style={{ justifySelf: \'stretch\' }}', 'justifySelf'],
      ['style={{ width: \'100%\' }}', 'width'],
      ['className="actions"', 'class'],
      ['style={styles.row}', 'not an object literal'],
    ] as Array<[string, string]>) {
      const code = wrap(`      <Stack orientation="horizontal" ${attr}>\n        <Button>A</Button>\n        <Button>B</Button>\n      </Stack>`);
      const out = fixStretchedControlRows(code, carbon);
      expect(out.edits).toEqual([]);
      expect(out.skipped).toHaveLength(1);
      expect(out.skipped[0].reason).toContain(why);
      expect(out.code).toBe(code);
    }
  });

  it('does not touch a lone control, or a row outside a stretching container', () => {
    const lone = wrap('      <Stack orientation="horizontal">\n        <Button>Only one</Button>\n      </Stack>');
    expect(fixStretchedControlRows(lone, carbon).edits).toEqual([]);

    // The same row, but its parent is the horizontal (non-stretching) form.
    const outside = `export const D = { render: () => (\n  <Stack orientation="horizontal">\n    <Stack orientation="horizontal">\n      <Button>A</Button>\n      <Button>B</Button>\n    </Stack>\n  </Stack>\n) };\n`;
    expect(fixStretchedControlRows(outside, carbon).edits).toEqual([]);
  });

  it('does not run at all when the stylesheet derived no stretching container', () => {
    // A design system with hashed class names (CSS modules) derives nothing.
    // That must be visible as "could not run", never as "nothing to fix".
    const code = wrap('      <Stack orientation="horizontal">\n        <Button>A</Button>\n        <Button>B</Button>\n      </Stack>');
    const none = fixStretchedControlRows(code, []);
    expect(none.ran).toBe(false);
    expect(none.source).toContain('the pass did not run');
    expect(none.code).toBe(code);

    // Derived a stretching container but no row variant: also cannot place one.
    const noRow = fixStretchedControlRows(code, [carbon[0]]);
    expect(noRow.ran).toBe(false);
    expect(noRow.source).toContain('no row variant');
  });

  it('leaves the file parseable and fixes every occurrence', () => {
    const code = `export const D = {\n  render: () => (\n    <Stack gap={5}>\n      <Stack orientation="horizontal"><Button>A</Button><Button>B</Button></Stack>\n      <TextInput id="a" labelText="Email" />\n      <Stack orientation="horizontal"><Link href="#">One</Link><Link href="#">Two</Link></Stack>\n    </Stack>\n  ),\n};\n`;
    const out = fixStretchedControlRows(code, carbon);
    expect(out.edits.map(e => e.control)).toEqual(['Button', 'Link']);
    expect(out.code.match(/justifySelf: 'start'/g)).toHaveLength(2);
    expect(out.code).toContain('<TextInput id="a" labelText="Email" />');
  });
});
