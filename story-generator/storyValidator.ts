export interface ValidationError {
  message: string;
  line: number;
}

/**
 * Emoji standing in for an icon — a defect, not a style preference.
 *
 * Observed on a radix-ui dashboard: the four stat cards used 📦 ⚠️ ⏳ ⛔ as
 * their icons, because that library ships no icon set and the model reached for
 * the nearest thing. No design system implementation ships emoji as
 * iconography; it renders at a different scale and weight to everything around
 * it, cannot be recoloured by a token, and reads instantly as unowned.
 *
 * The line drawn here is deterministic: a LONE emoji is being used as a UI
 * element, an emoji inside a sentence is content. `<span>📦</span>` is an icon;
 * `"Deployed release 🎉 successfully"` is prose, and the tool has no business
 * policing prose.
 *
 * Presentation selectors and variation selectors are stripped before measuring
 * length, so ⚠️ (U+26A0 U+FE0F) is recognised as the single character it looks
 * like rather than as two.
 */
/**
 * Ranges chosen from the real failure, not from memory. The radix dashboard used
 * 📦 U+1F4E6, ⚠️ U+26A0, ⏳ U+23F3 and ⛔ U+26D4 — and an earlier version of this
 * pattern caught three of the four, because U+23F3 sits in Miscellaneous
 * Technical (U+2300–U+23FF) which the obvious ranges miss. Verified against that
 * file: 4 of 4.
 */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/u;

/**
 * The other half of the same defect: a plain text glyph used as an icon.
 *
 * The prompt names these characters explicitly — "A text glyph (⋯ × ✓ ↑ ↓ → ←
 * ☰ • ★ ▸ ✕) is NEVER an icon" — and the detector could only see four of the
 * twelve. ✓ ☰ ★ ✕ fall inside the emoji ranges above; the arrows (U+2190–21FF),
 * × (U+00D7), ⋯ (U+22EF), • (U+2022) and ▸ (U+25B8, Geometric Shapes) do not.
 * So a rule stated to the model was unenforced for two thirds of the characters
 * it names, which is the worst of both: the model is told, nothing checks.
 *
 * These are the same test as an emoji, and the same fix, so they go through the
 * same code path: a LONE glyph is an icon, a glyph inside a sentence is prose
 * (3 × 4 stays 3 × 4).
 */
const TEXT_GLYPH = /[\u{00D7}\u{00F7}\u{2022}\u{2023}\u{2026}\u{2190}-\u{21FF}\u{22EF}\u{25A0}-\u{25FF}]/u;

/** Either kind of stand-in, in one class, for the shared "lone glyph" test. */
const GLYPH = new RegExp(`(?:${EMOJI.source}|${TEXT_GLYPH.source})`, 'u');

export function emojiUsedAsUi(line: string): string | null {
  // A JSX text node or a string literal holding ONLY emoji and whitespace.
  const candidates = [
    ...line.matchAll(/>([^<>{}]{1,12})</g),          // <span>📦</span>
    ...line.matchAll(/['"`]([^'"`]{1,12})['"`]/g),   // icon: '📦'
  ];
  for (const m of candidates) {
    const raw = m[1];
    if (!GLYPH.test(raw)) continue;
    // Strip emoji, variation selectors and whitespace; anything left is prose.
    const remainder = raw
      .replace(new RegExp(GLYPH.source, 'gu'), '')
      .replace(/[\s‍]/g, '');
    if (remainder.length === 0) {
      const found = raw.match(new RegExp(GLYPH.source, 'u'));
      return found ? found[0] : null;
    }
  }
  return null;
}

export function validateStory(storyContent: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = storyContent.split('\n');

  // These are warnings/suggestions rather than strict forbidden patterns
  // Only flag truly problematic patterns that would break the story
  const forbiddenPatterns = [
    { pattern: /UNSAFE_style\s*=\s*\{/i, message: 'The `UNSAFE_style` prop is strictly forbidden. Do not use it for any reason.' },
    { pattern: /UNSAFE_className\s*=\s*['"]/i, message: 'The `UNSAFE_className` prop is forbidden.' },
    // A repair once "fixed" a tint that a component ignored by injecting a
    // <style> block with !important next to it. It rendered, verification
    // passed, and the story was now styled by a stylesheet no design system
    // owns. Both are escape hatches around the component's own props.
    { pattern: /<style[\s>]/, message: 'Do not inject a <style> element. Style through the component\'s own props, the design system\'s tokens, or a layout component.' },
    { pattern: /!important/, message: 'Do not use !important. Style through the component\'s own props or the design system\'s tokens.' },
    { pattern: /<Text\s+as\s*=\s*["']h[1-6]["']/i, message: 'Text component does not support heading elements (h1-h6) in the "as" prop. Use Heading component instead.' },
    // Catch imports that don't exist in production environments
    { pattern: /from\s+['"]@storybook\/addon-actions['"]/i, message: 'Do not import from @storybook/addon-actions. Use argTypes with action property instead: argTypes: { onClick: { action: "clicked" } }' },
    // Catch Svelte slot property which doesn't work in modern Storybook
    { pattern: /slot:\s*['"][^'"]+['"]/i, message: 'The slot property in render functions does not work in Svelte Storybook. Use simple args-based stories instead.' },
    // Catch Angular TS4111 patterns - "this.property" state management in render functions
    { pattern: /this\.\w+\s*=\s*\$?event\./i, message: 'Do not use "this.property = event.value" in Angular stories. This causes TS4111 errors. Use argTypes with action property for events and create separate stories for different states.' },
    { pattern: /this\.\w+\+\+/i, message: 'Do not use "this.property++" in Angular stories. This causes TS4111 errors. Use argTypes with action property for events instead of managing state.' },
    { pattern: /this\.\w+--/i, message: 'Do not use "this.property--" in Angular stories. This causes TS4111 errors. Use argTypes with action property for events instead of managing state.' },
  ];

  lines.forEach((line, index) => {
    for (const { pattern, message } of forbiddenPatterns) {
      if (pattern.test(line)) {
        errors.push({
          message,
          line: index + 1,
        });
      }
    }
    const emoji = emojiUsedAsUi(line);
    if (emoji) {
      errors.push({
        message:
          `"${emoji}" is being used as a UI element. Never use an emoji or a text glyph as iconography, status ` +
          `indicators, bullets or decoration — use the design system's own icon set, or omit the icon ` +
          `entirely if it has none. A glyph inside a sentence of body copy is fine; a lone one standing ` +
          `in for an icon is not.`,
        line: index + 1,
      });
    }
  });

  // Check for truncated story (multiple closing tags on a single line followed by };)
  const lastFewLines = lines.slice(-5).join('\n');
  if (lastFewLines.match(/<\/\w+><\/\w+><\/\w+><\/\w+>.*\n\s*\};/)) {
    errors.push({
      message: 'Story appears to be truncated. Multiple closing tags found on a single line followed by abrupt ending.',
      line: lines.length - 1,
    });
  }

  // Check for proper story structure (framework-aware)
  // Svelte uses defineMeta() instead of export default meta
  const isSvelteNativeFormat = storyContent.includes('defineMeta(') ||
                               storyContent.includes('<script module>') ||
                               storyContent.includes('<script context="module">');

  // Vue SFC might use <script setup>
  const isVueSfcFormat = storyContent.includes('<script setup') ||
                         storyContent.includes('<template>');

  if (!isSvelteNativeFormat && !isVueSfcFormat) {
    // Standard CSF format check - only for React/Angular/Web Components
    if (!storyContent.includes('export default meta') && !storyContent.includes('export default {')) {
      errors.push({
        message: 'Story is missing required "export default meta" statement.',
        line: 1,
      });
    }
  }

  return errors;
}
