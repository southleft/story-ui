/**
 * Saying a prop list is COMPLETE, and only when it is.
 *
 * A list of props reads as a sample. A model weighing a sample against a
 * strong memory of a library's earlier major version picks the memory:
 * measured on Material, 30 first-round validation errors across 11 prompts,
 * 19 of them `alignItems` on Stack — a prop that library moved into `sx` and
 * that the catalog had correctly stopped listing. Three separate prompt rules
 * failed to move that number, and none of them said the list was exhaustive,
 * because until the compiler resolved the prop sets nothing knew that it was.
 *
 * The risk in stating it is stating it wrongly, so these tests are mostly
 * about when the claim must NOT appear: a truncated list is not a complete
 * one, and a component whose type admits any prop is not closed.
 */
import { describe, it, expect } from 'vitest';
import { ReactAdapter } from '../story-generator/framework-adapters/react-adapter.js';

const adapter = new ReactAdapter();
const entryFor = (component: Record<string, unknown>, withDocs = false): string =>
  (adapter as unknown as {
    formatComponentEntry(c: unknown, cfg: unknown, o: { withDocs: boolean }): string;
  }).formatComponentEntry(component, { importPath: '@acme/ui' }, { withDocs });

const props = (n: number) => Array.from({ length: n }, (_, i) => `p${i}?`);

describe('a complete prop list says so', () => {
  it('claims completeness when the compiler resolved a definite set and nothing was withheld', () => {
    const entry = entryFor({
      name: 'Stack',
      props: ['children?', 'direction?', 'spacing?', 'sx?', 'useFlexGap?'],
      __propsClosed: true,
    });
    expect(entry).toContain('COMPLETE list');
    expect(entry).toContain('any other prop is rejected');
    // The reason the model needs it, named.
    expect(entry).toContain('earlier version of this library');
  });

  it('never claims it for a truncated list', () => {
    // The catalog shows a bounded number of ranked props. Fourteen props means
    // two are withheld, and a list with something withheld is not complete —
    // claiming otherwise would be a lie the model cannot check.
    const entry = entryFor({ name: 'DataTable', props: props(14), __propsClosed: true });
    expect(entry).toContain('more');
    expect(entry).not.toContain('COMPLETE list');
  });

  it('never claims it when the compiler could not resolve a definite set', () => {
    // No `__propsClosed`: the type carried an index signature, resolved to
    // any, or was never resolved at all. Silence is correct there.
    const entry = entryFor({ name: 'Box', props: ['children?', 'as?'] });
    expect(entry).not.toContain('COMPLETE list');
  });

  it('claims it in the documented entry shape too', () => {
    // The request's own components render with prop docs on separate lines;
    // the clause has to survive that formatting, not just the compact one.
    const entry = entryFor({
      name: 'Button',
      props: ['children?', 'variant?'],
      __propDocs: { variant: 'Which visual treatment to use.' },
      __propsClosed: true,
    }, true);
    expect(entry).toContain('COMPLETE list');
    expect(entry).toContain('Which visual treatment to use.');
  });
});
