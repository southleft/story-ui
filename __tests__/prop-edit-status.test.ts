import { describe, it, expect } from 'vitest';
import { appliedLabel, undoValue, echoValue, draftDiffers } from '../templates/StoryUIV2/propEditStatus.js';

describe('propEditStatus', () => {
  it('labels an applied change, and a reset as default', () => {
    expect(appliedLabel('color', 'violet')).toBe('color = violet');
    expect(appliedLabel('size', 3)).toBe('size = 3');
    expect(appliedLabel('loading', true)).toBe('loading = true');
    expect(appliedLabel('color', null)).toBe('color = default');
  });

  it('undo sends null when the attribute was not set before', () => {
    expect(undoValue('enum', undefined)).toBeNull();
    expect(undoValue('string', '')).toBeNull();
  });

  it('undo restores the previous enum or string text', () => {
    expect(undoValue('enum', 'blue')).toBe('blue');
    expect(undoValue('string', 'Hello')).toBe('Hello');
  });

  it('undo restores numbers as numbers', () => {
    expect(undoValue('number', '12')).toBe(12);
    expect(undoValue('number', 'auto')).toBe('auto');
  });

  it('undo restores a boolean that was on, and removes one that was explicitly false', () => {
    expect(undoValue('boolean', 'true')).toBe(true);
    expect(undoValue('boolean', 'loading')).toBe(true); // bare `<X loading />`
    expect(undoValue('boolean', 'false')).toBeNull();
  });

  it('echoes what the control should now show', () => {
    expect(echoValue('violet')).toBe('violet');
    expect(echoValue(4)).toBe('4');
    expect(echoValue(null)).toBeUndefined();
  });

  it('only offers Apply when a draft would change the attribute', () => {
    expect(draftDiffers(undefined, 'a')).toBe(false);
    expect(draftDiffers('a', 'a')).toBe(false);
    expect(draftDiffers(' a ', 'a')).toBe(false);
    expect(draftDiffers('b', 'a')).toBe(true);
    expect(draftDiffers('', undefined)).toBe(false);
    expect(draftDiffers('x', undefined)).toBe(true);
  });
});
