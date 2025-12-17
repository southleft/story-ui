export interface ValidationError {
  message: string;
  line: number;
}

export function validateStory(storyContent: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = storyContent.split('\n');

  // These are warnings/suggestions rather than strict forbidden patterns
  // Only flag truly problematic patterns that would break the story
  const forbiddenPatterns = [
    { pattern: /UNSAFE_style\s*=\s*\{/i, message: 'The `UNSAFE_style` prop is strictly forbidden. Do not use it for any reason.' },
    { pattern: /UNSAFE_className\s*=\s*['"]/i, message: 'The `UNSAFE_className` prop is forbidden.' },
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
