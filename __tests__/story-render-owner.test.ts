import { describe, it, expect } from 'vitest';
import { storyRenderSpans, occurrencesWithinOwner } from '../story-generator/editing/propEditor';

const one = `import { Heading } from '../..';
const meta = { title: 'Generated/Résumé' };
export default meta;
export const Default = {
  render: () => (
    <div>
      <Heading level="h3">Anna Marlow</Heading>
      <Heading level="h4">Experience</Heading>
      <Heading level="h4">Education</Heading>
    </div>
  ),
};`;

const two = one + `
export const Compact = { render: () => <Heading level="h5">Compact</Heading> };`;

describe('a story render function as the owner region', () => {
  it('finds each story render span by export name', () => {
    expect(storyRenderSpans(two).map(s => s.name)).toEqual(['Default', 'Compact']);
  });

  it('scopes to the only story when React reports Storybook\'s wrapper as the owner', () => {
    expect(occurrencesWithinOwner(one, 'Heading', 'unboundStoryFn')).toEqual([0, 1, 2]);
  });

  it('uses the story the preview named, and otherwise the only story holding the component', () => {
    expect(occurrencesWithinOwner(two, 'Heading', 'unboundStoryFn', 'Compact')).toEqual([3]);
    const onlyInCompact = two.replace(/<Heading level="h[34]">[^<]*<\/Heading>\n?\s*/g, '');
    expect(occurrencesWithinOwner(onlyInCompact, 'Heading', 'unboundStoryFn')).toEqual([0]);
  });

  it('still refuses when several stories hold the component and none was named', () => {
    expect(occurrencesWithinOwner(two, 'Heading', 'unboundStoryFn')).toEqual([]);
  });

  it('a declared component owner behaves as before', () => {
    const withOwner = `function Card() { return <Heading level="h2">Card</Heading>; }\n` + one;
    expect(occurrencesWithinOwner(withOwner, 'Heading', 'Card')).toEqual([0]);
  });
});

describe('render that delegates to a story-local component', () => {
  const delegated = `import { Heading } from '../..';
function ResumeCard() {
  return (<section>
    <Heading level={2} visual="h3">Anna Marlow</Heading>
    <Heading level={3} visual="h5">Experience</Heading>
    <Heading level={3} visual="h5">Education</Heading>
  </section>);
}
export const Default = { render: () => <ResumeCard /> };`;
  it('follows the render into the component it renders', () => {
    expect(occurrencesWithinOwner(delegated, 'Heading', 'unboundStoryFn')).toEqual([0, 1, 2]);
  });
});
