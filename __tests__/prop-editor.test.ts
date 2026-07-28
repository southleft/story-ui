/**
 * Changing a prop without asking a model.
 *
 * "Make this button red" has exactly one correct edit to exactly one attribute
 * of one element. Routing it through an LLM is how a request to change a
 * background colour returned an entirely different page — and it is slow and
 * costs money on top.
 *
 * These pin the property that makes the feature trustworthy: the edit touches
 * what it was pointed at and NOTHING else. A visual editor that occasionally
 * disturbs a neighbour is worse than no visual editor, because the whole point
 * is to be the safe path.
 */

import { describe, it, expect } from 'vitest';
import { editProp, occurrencesInSource } from '../story-generator/editing/propEditor.js';

const story = `import { Button, Tile, Column } from '@carbon/react';

export const Default = () => (
  <Tile>
    <Button kind="secondary" size="md">Save</Button>
    <Button>Publish</Button>
    <Column lg={5}><span>side</span></Column>
  </Tile>
);
`;

describe('occurrencesInSource', () => {
  it('counts JSX elements by name', () => {
    expect(occurrencesInSource(story, 'Button')).toBe(2);
    expect(occurrencesInSource(story, 'Column')).toBe(1);
    expect(occurrencesInSource(story, 'Nonexistent')).toBe(0);
  });

  it('counts self-closing and paired elements alike', () => {
    expect(occurrencesInSource('<A /><A></A><A/>', 'A')).toBe(3);
  });
});

describe('editProp', () => {
  it('adds a prop to the element that was pointed at, and only that one', () => {
    const r = editProp(story, { component: 'Button', occurrence: 1, prop: 'kind', value: 'danger' });
    expect(r.changed).toBe(true);
    expect(r.code).toContain('<Button kind="danger">Publish</Button>');
    // The neighbour must be untouched. This is the whole promise of the feature.
    expect(r.code).toContain('kind="secondary"');
  });

  it('replaces an existing value and reports what it was', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'kind', value: 'ghost' });
    expect(r.previous).toBe('"secondary"');
    expect(r.code).toContain('kind="ghost"');
    expect(r.code).not.toContain('kind="secondary"');
  });

  it('keeps other attributes on the edited element', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'kind', value: 'ghost' });
    expect(r.code).toContain('size="md"');
  });

  it('writes a number as an expression, not a string', () => {
    // `lg="8"` is not the same prop value as `lg={8}` and Carbon will not
    // accept it as a column span.
    const r = editProp(story, { component: 'Column', occurrence: 0, prop: 'lg', value: 8 });
    expect(r.code).toContain('lg={8}');
    expect(r.code).not.toContain('lg="8"');
  });

  it('writes a true boolean as a bare attribute', () => {
    const r = editProp(story, { component: 'Tile', occurrence: 0, prop: 'hasRoundedCorners', value: true });
    expect(r.code).toMatch(/<Tile hasRoundedCorners>/);
  });

  it('writes false explicitly, since a bare attribute would mean true', () => {
    const r = editProp(story, { component: 'Tile', occurrence: 0, prop: 'light', value: false });
    expect(r.code).toContain('light={false}');
  });

  it('removes a prop when the value is null, resetting it to its default', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'kind', value: null });
    expect(r.changed).toBe(true);
    expect(r.code).not.toContain('kind="secondary"');
    // Removing one attribute must not remove its neighbour.
    expect(r.code).toContain('size="md"');
  });

  it('refuses an occurrence that does not exist, and says how many there are', () => {
    const r = editProp(story, { component: 'Button', occurrence: 7, prop: 'kind', value: 'danger' });
    expect(r.changed).toBe(false);
    expect(r.code).toBe(story);
    expect(r.reason).toContain('has 2');
  });

  it('leaves the file byte-identical when it refuses', () => {
    // A failed edit that reformats is a change nobody asked for.
    const r = editProp(story, { component: 'Missing', occurrence: 0, prop: 'x', value: '1' });
    expect(r.code).toBe(story);
  });

  it('survives an attribute value containing braces and elements', () => {
    // The reason this is an AST transform and not a regex. Every regex-based
    // edit in this codebase has eventually met a case like this.
    const tricky = `<Modal footer={<><Button onClick={() => save({ a: 1 })}>Go</Button></>}><p>x</p></Modal>`;
    const r = editProp(tricky, { component: 'Modal', occurrence: 0, prop: 'size', value: 'lg' });
    expect(r.changed).toBe(true);
    expect(r.code).toContain('size="lg"');
    expect(r.code).toContain('save({ a: 1 })');
  });
});

describe('candidate resolution', () => {
  /**
   * The browser can only offer a hypothesis about which component the source
   * contains. A fiber chain includes names that are not JSX elements at all —
   * Carbon wraps its components in a `hookified` HOC, and clicking a Dropdown
   * resolves to the `ListBox` inside it. No list of wrapper names could cover
   * every design system, so the FILE decides.
   */
  const file = `<Tile><Button kind="ghost">Remove</Button></Tile>`;

  it('finds the candidate the source actually contains', () => {
    const candidates = ['hookified', 'ListBox', 'Button'];
    const resolved = candidates.find(c => occurrencesInSource(file, c) > 0);
    expect(resolved).toBe('Button');
  });

  it('prefers the innermost real element over its container', () => {
    // Both Tile and Button are in the file; innermost-first order means the
    // element clicked wins rather than the largest container on the page.
    const candidates = ['Button', 'Tile'];
    expect(candidates.find(c => occurrencesInSource(file, c) > 0)).toBe('Button');
  });

  it('resolves nothing when no candidate is real', () => {
    const candidates = ['hookified', 'ListBox'];
    expect(candidates.find(c => occurrencesInSource(file, c) > 0)).toBeUndefined();
  });
});
