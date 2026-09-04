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

  it('catches every glyph the prompt forbids, not just the four in the emoji ranges', () => {
    // The prompt names these twelve characters as never being an icon. Before
    // this, the detector could see four of them: the arrows, ×, ⋯, • and ▸ sit
    // in blocks the emoji ranges do not cover, so the rule was stated to the
    // model and enforced for a third of what it names.
    for (const glyph of ['⋯', '×', '✓', '↑', '↓', '→', '←', '☰', '•', '★', '▸', '✕']) {
      expect(emojiUsedAsUi(`        <span>${glyph}</span>`)).toBe(glyph);
    }
  });

  it('leaves the same characters alone inside prose', () => {
    // The rule is "a LONE glyph is an icon" — a multiplication sign between two
    // numbers, or a bullet in a sentence, is content and none of our business.
    expect(emojiUsedAsUi('        <span>3 × 4 grid</span>')).toBeNull();
    expect(emojiUsedAsUi("        { label: 'Sort ascending' },")).toBeNull();
    expect(emojiUsedAsUi('        <Text>Step 1 → Step 2</Text>')).toBeNull();
  });
});
