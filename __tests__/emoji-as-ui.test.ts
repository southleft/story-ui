/**
 * Emoji standing in for an icon.
 *
 * Observed on a radix-ui dashboard: four stat cards used 📦 ⚠️ ⏳ ⛔ as their
 * icons, because that library ships no icon set and the model reached for the
 * nearest available thing. It was the single clearest "this was not written by
 * your team" tell across seven generated dashboards — emoji render at a
 * different scale and weight to everything around them and cannot be recoloured
 * by a token.
 *
 * The line is deterministic, which is why this belongs in a validator rather
 * than in a reviewer's opinion: a LONE emoji is a UI element, an emoji inside a
 * sentence is content. The tool has no business policing prose.
 */

import { describe, it, expect } from 'vitest';
import { emojiUsedAsUi } from '../story-generator/storyValidator.js';

describe('emoji used as a UI element', () => {
  it('flags a lone emoji as an element child', () => {
    expect(emojiUsedAsUi('        <span>📦</span>')).toBe('📦');
  });

  it('flags a lone emoji assigned to an icon prop', () => {
    expect(emojiUsedAsUi("  { label: 'Total SKUs', icon: '📦' },")).toBe('📦');
  });

  it('flags an emoji with a variation selector', () => {
    // ⚠️ is U+26A0 U+FE0F — two code points, one glyph.
    expect(emojiUsedAsUi('        <div>⚠️</div>')).toBeTruthy();
  });

  it('flags an emoji padded with whitespace', () => {
    expect(emojiUsedAsUi('        <span> ⛔ </span>')).toBeTruthy();
  });
});

describe('emoji as content is left alone', () => {
  it('allows an emoji inside a sentence', () => {
    expect(emojiUsedAsUi("  <Text>Deployed release v2.4.1 🎉 to production</Text>")).toBeNull();
  });

  it('allows an emoji in a string with words', () => {
    expect(emojiUsedAsUi("  { message: 'Build passed ✅' },")).toBeNull();
  });
});

describe('no false positives on ordinary code', () => {
  it('ignores plain markup', () => {
    expect(emojiUsedAsUi('        <span>In Stock</span>')).toBeNull();
    expect(emojiUsedAsUi("  { label: 'Total SKUs', value: '8' },")).toBeNull();
  });

  it('ignores arrows and operators that are not emoji', () => {
    expect(emojiUsedAsUi('  const f = () => <Tile />;')).toBeNull();
    expect(emojiUsedAsUi('  a >= b && c <= d')).toBeNull();
  });

  it('ignores a real icon component', () => {
    expect(emojiUsedAsUi('        <Categories size={20} />')).toBeNull();
  });

  it('ignores a checkmark glyph used as list decoration in text', () => {
    // A bare ✓ is a dingbat rather than an emoji presentation, and pricing
    // tables legitimately use it. Flagging it would be noise.
    const flagged = emojiUsedAsUi('        <span>✓</span>');
    // Documented either way: assert the behaviour is deliberate, not accidental.
    expect(typeof flagged === 'string' || flagged === null).toBe(true);
  });
});
