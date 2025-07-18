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
    // Remove overly strict rules - divs, imgs, and inline styles are fine in moderation
    // Only check for actual syntax errors or patterns that would break Storybook
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

  // Check for proper story structure
  if (!storyContent.includes('export default meta')) {
    errors.push({
      message: 'Story is missing required "export default meta" statement.',
      line: 1,
    });
  }

  return errors;
}
