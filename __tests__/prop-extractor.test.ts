import { describe, it, expect } from 'vitest';
import { rankProps, type PropFact } from '../story-generator/knowledge/propExtractor.js';

const p = (name: string, over: Partial<PropFact> = {}): PropFact => ({
  name, required: false, ...over,
});

/**
 * The catalog is truncated, so ordering decides what the model actually sees.
 * Alphabetical order buried exactly the props that separate an interactive
 * component from a presentational one — which is the judgement the generator
 * most needs to get right.
 */
describe('rankProps', () => {
  const names = (props: PropFact[]) => rankProps(props).map(x => x.name);

  it('puts required props first', () => {
    const out = names([p('color'), p('value', { required: true }), p('size')]);
    expect(out[0]).toBe('value');
  });

  it('ranks handlers above styling', () => {
    const out = names([p('radius'), p('onChange'), p('shadow')]);
    expect(out.indexOf('onChange')).toBeLessThan(out.indexOf('radius'));
  });

  it('ranks state props above styling', () => {
    const out = names([p('color'), p('active'), p('size')]);
    expect(out.indexOf('active')).toBeLessThan(out.indexOf('color'));
  });

  it('ranks content slots above styling', () => {
    const out = names([p('variant'), p('leftSection'), p('radius')]);
    expect(out.indexOf('leftSection')).toBeLessThan(out.indexOf('variant'));
  });

  it('keeps the behavioural props when the list is truncated', () => {
    // A realistic Mantine-shaped prop set, deliberately alphabetical going in.
    const props = [
      p('autoContrast'), p('color'), p('description'), p('disabled'), p('label'),
      p('leftSection'), p('active'), p('onClick'), p('radius'), p('rightSection'),
      p('size'), p('variant'),
    ];
    const top = names(props).slice(0, 6);
    expect(top).toContain('onClick');
    expect(top).toContain('active');
    expect(top).toContain('leftSection');
    // Pure styling should not crowd out behaviour in the visible window.
    expect(top).not.toContain('autoContrast');
  });

  it('is stable for equally ranked props', () => {
    const out = names([p('zeta'), p('alpha'), p('mid')]);
    expect(out).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('does not mutate its input', () => {
    const props = [p('color'), p('onChange')];
    const before = props.map(x => x.name);
    rankProps(props);
    expect(props.map(x => x.name)).toEqual(before);
  });
});
