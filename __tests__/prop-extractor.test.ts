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

describe('rankProps and the prop a library says carries CSS', () => {
  const p = (name: string, doc?: string, required = false) => ({ name, doc, required } as any);

  it('lifts the prop whose own doc says it takes CSS, so its sentence survives the catalog', () => {
    // MUI's Stack has no required props, no handlers and no state props, so
    // every prop tied at the bottom tier and sorted alphabetically. `sx` came
    // eighth and the catalog attaches docs to the first six, so the one
    // sentence that says where CSS goes was dropped. Measured: 28 of 29
    // first-round validation errors in a twenty-prompt MUI run were
    // `alignItems` and `justifyContent` written as top-level props.
    const stack = [
      p('children', 'The content of the component.'),
      p('direction', 'Defines the `flex-direction` style property.'),
      p('divider', 'Add an element between each child.'),
      p('spacing', 'Defines the space between immediate children.'),
      p('sx', 'The system prop, which allows defining system overrides as well as additional CSS styles.'),
      p('useFlexGap', 'If `true`, the CSS flexbox `gap` is used instead of applying `margin` to children.'),
    ];
    const order = rankProps(stack).map(x => x.name);
    expect(order.indexOf('sx')).toBeLessThan(order.indexOf('children'));
    // A prop that merely mentions CSS in passing is not an escape hatch.
    expect(order.indexOf('useFlexGap')).toBeGreaterThan(order.indexOf('sx'));
  });

  it('does not mistake a class-name prop for a CSS carrier', () => {
    // Carbon's className says "Additional CSS class names." A composition's
    // CSS does not go there, and the exclusion reads the same sentence rather
    // than the prop's name — no design system owes us the name `sx`.
    // `appearance` sorts before `className` alphabetically and sits in the
    // bottom tier, so className staying behind it proves className was not
    // lifted; a lift would put it first.
    const carbon = [p('className', 'Additional CSS class names.'), p('appearance', 'How it looks.')];
    expect(rankProps(carbon).map(x => x.name)).toEqual(['appearance', 'className']);
    // Where a library really does declare one, it is lifted past the same prop.
    const withCarrier = [p('sx', 'Allows additional CSS styles.'), p('appearance', 'How it looks.')];
    expect(rankProps(withCarrier).map(x => x.name)).toEqual(['sx', 'appearance']);
  });

  it('keeps required props, handlers and state above it', () => {
    const mixed = [
      p('sx', 'Allows additional CSS styles.'),
      p('onChange', 'Called when it changes.'),
      p('value', 'The current value.'),
      p('label', 'The label.', true),
    ];
    expect(rankProps(mixed).map(x => x.name)).toEqual(['label', 'onChange', 'value', 'sx']);
  });
});
