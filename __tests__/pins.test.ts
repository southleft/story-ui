/**
 * A property-panel edit must survive the next chat rewrite.
 *
 * Observed live: variant="outline" set by hand became variant={plan.variant}
 * on a request that only asked for a new section. History kept the edit; the
 * file did not.
 */
import { describe, it, expect } from 'vitest';
import { reapplyPins, upsertPin, pinsForPrompt, type PropPin } from '../story-generator/editing/pins.js';

const pin = (over: Partial<PropPin> = {}): PropPin => ({
  component: 'Button', occurrence: 0, prop: 'variant', value: 'outline', setAt: '2026-09-01T00:00:00Z', ...over,
});

describe('reapplyPins', () => {
  it('restores a pinned attribute the model rewrote as an expression', () => {
    const rewritten = `export const S = () => <Button variant={plan.variant} size="md">Go</Button>;`;
    const r = reapplyPins(rewritten, [pin()]);
    expect(r.code).toContain('variant="outline"');
    expect(r.code).toContain('size="md"');
    expect(r.applied).toHaveLength(1);
    expect(r.lost).toHaveLength(0);
  });

  it('adds a pinned attribute the model dropped', () => {
    const r = reapplyPins(`export const S = () => <Button>Go</Button>;`, [pin()]);
    expect(r.code).toMatch(/<Button variant="outline">/);
    expect(r.applied).toHaveLength(1);
  });

  it('leaves an attribute the model preserved, and says so', () => {
    const r = reapplyPins(`export const S = () => <Button variant="outline">Go</Button>;`, [pin()]);
    expect(r.applied).toHaveLength(0);
    expect(r.kept).toHaveLength(1);
  });

  it('reports a pin whose element is gone instead of inventing one', () => {
    const r = reapplyPins(`export const S = () => <Card>no button any more</Card>;`, [pin()]);
    expect(r.lost).toHaveLength(1);
    expect(r.code).not.toContain('Button');
  });

  it('handles boolean and numeric pins the way the panel wrote them', () => {
    const r = reapplyPins(`export const S = () => <Button fullWidth={false} count={1}>Go</Button>;`, [
      pin({ prop: 'fullWidth', value: true }),
      pin({ prop: 'count', value: 3 }),
    ]);
    expect(r.code).toMatch(/<Button fullWidth count=\{3\}>/);
    expect(r.applied).toHaveLength(2);
  });

  it('targets the pinned occurrence, not the first one', () => {
    const r = reapplyPins(`export const S = () => (<><Button>A</Button><Button>B</Button></>);`, [pin({ occurrence: 1 })]);
    expect(r.code).toMatch(/<Button>A<\/Button><Button variant="outline">B<\/Button>/);
  });
});

describe('upsertPin', () => {
  it('replaces a pin for the same element and prop', () => {
    const pins = upsertPin([pin()], { component: 'Button', occurrence: 0, prop: 'variant', value: 'filled' });
    expect(pins).toHaveLength(1);
    expect(pins[0].value).toBe('filled');
  });
  it('removes the pin when the prop is reset to its default', () => {
    expect(upsertPin([pin()], { component: 'Button', occurrence: 0, prop: 'variant', value: null })).toHaveLength(0);
  });
  it('keeps pins on other elements', () => {
    const pins = upsertPin([pin()], { component: 'Card', occurrence: 0, prop: 'padding', value: 'lg' });
    expect(pins.map(p => p.component).sort()).toEqual(['Button', 'Card']);
  });
});

describe('pinsForPrompt', () => {
  it('is empty with no pins and names each pin otherwise', () => {
    expect(pinsForPrompt([])).toBe('');
    expect(pinsForPrompt([pin()])).toContain('Button[0].variant = "outline"');
  });
});
