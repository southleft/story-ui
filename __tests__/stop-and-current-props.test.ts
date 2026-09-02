/**
 * Stopping a generation, and reading what an element already has.
 *
 * Two defects found by using the workspace rather than reading it:
 *
 *  - Stop aborted the client fetch and nothing else. The pipeline ran on,
 *    wrote the story and persisted the reply, so a story appeared in Storybook
 *    half a minute after the user thought they had cancelled — and because the
 *    step list is gated on `busy`, pressing Stop erased the narration too, so
 *    there was no trace of what had happened.
 *
 *  - The property panel had no way to ask what an element's props currently
 *    are, so every control rendered uncontrolled: a picker showed "choose…"
 *    for a prop the source explicitly set. Applying a change and failing to
 *    apply one looked identical.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerActiveGeneration,
  unregisterActiveGeneration,
  cancelActiveGeneration,
  isGenerationCancelled,
  listActiveGenerations,
} from '../mcp-server/routes/activeGenerations.js';
import { readProps } from '../story-generator/editing/propEditor.js';

describe('stopping a generation', () => {
  beforeEach(() => {
    for (const g of listActiveGenerations()) unregisterActiveGeneration(g.id);
  });

  it('gives every run an id the client can name', () => {
    const a = registerActiveGeneration({ prompt: 'one', fileName: null, startedAt: Date.now() });
    const b = registerActiveGeneration({ prompt: 'two', fileName: null, startedAt: Date.now() });

    // A Symbol key could not survive the trip over HTTP, which is why the
    // client had nothing to address when it wanted to cancel.
    expect(typeof a).toBe('string');
    expect(a).not.toBe(b);
    expect(listActiveGenerations().map(g => g.id).sort()).toEqual([a, b].sort());
  });

  it('marks the named run cancelled, and only that one', () => {
    const target = registerActiveGeneration({ prompt: 'stop me', fileName: null, startedAt: Date.now() });
    const other = registerActiveGeneration({ prompt: 'leave me', fileName: null, startedAt: Date.now() });

    expect(cancelActiveGeneration(target)).toBe(true);
    expect(isGenerationCancelled(target)).toBe(true);
    expect(isGenerationCancelled(other)).toBe(false);
  });

  it('treats an unknown id as "already finished", not an error', () => {
    // The common race: the user hits Stop just as the run completes. That must
    // not surface as a failure.
    expect(cancelActiveGeneration('no-such-run')).toBe(false);
    expect(isGenerationCancelled('no-such-run')).toBe(false);
    expect(isGenerationCancelled(undefined)).toBe(false);
  });

  it('stops reporting a run as cancellable once it is unregistered', () => {
    const id = registerActiveGeneration({ prompt: 'x', fileName: null, startedAt: Date.now() });
    cancelActiveGeneration(id);
    unregisterActiveGeneration(id);
    expect(isGenerationCancelled(id)).toBe(false);
    expect(listActiveGenerations()).toHaveLength(0);
  });
});

describe('reading an element’s current props', () => {
  const story = `
import { Button, Card } from '@mantine/core';

export const Default = () => (
  <Card padding="lg">
    <Button variant="outline" size="xl" disabled fullWidth={false} count={3}>Save</Button>
    <Button>Cancel</Button>
  </Card>
);
`;

  it('reads string, shorthand, boolean-expression and numeric attributes', () => {
    const props = readProps(story, 'Button', 0);
    expect(props).toEqual({
      variant: 'outline',
      size: 'xl',
      // A bare flag is `true`, not an empty string — the panel renders it as on.
      disabled: 'true',
      fullWidth: 'false',
      count: '3',
    });
  });

  it('respects occurrence, so the panel describes the element the edit targets', () => {
    // The second Button carries nothing. Reporting the first one's props here
    // is exactly the mismatch that made the panel untrustworthy.
    expect(readProps(story, 'Button', 1)).toEqual({});
  });

  it('returns null when the component is not in the file', () => {
    // Distinct from `{}`, which means "found it, and it has no props".
    expect(readProps(story, 'Accordion', 0)).toBeNull();
  });

  it('returns null for an occurrence past the end', () => {
    expect(readProps(story, 'Button', 9)).toBeNull();
  });

  it('ignores a spread rather than inventing values for it', () => {
    const spread = `export const S = () => <Button {...rest} size="sm">x</Button>;`;
    expect(readProps(spread, 'Button', 0)).toEqual({ size: 'sm' });
  });

  it('reads a self-closing element', () => {
    const selfClosing = `export const S = () => <TextInput label="Email" required />;`;
    expect(readProps(selfClosing, 'TextInput', 0)).toEqual({ label: 'Email', required: 'true' });
  });
});
