export interface ValidationError {
  message: string;
  line: number;
}

export function validateStory(storyContent: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = storyContent.split('\n');

  const forbiddenPatterns = [
    { pattern: /style\s*=\s*\{/i, message: 'Inline style prop (`style=`) is forbidden. Use component props for styling.' },
    { pattern: /UNSAFE_style\s*=\s*\{/i, message: 'The `UNSAFE_style` prop is strictly forbidden. Do not use it for any reason.' },
    { pattern: /className\s*=\s*['"]/i, message: 'The `className` prop is forbidden. Use layout components and props for styling.' },
    { pattern: /UNSAFE_className\s*=\s*['"]/i, message: 'The `UNSAFE_className` prop is forbidden.' },
    { pattern: /<div/i, message: 'The `<div>` tag is forbidden. Use `<View>` or `<Flex>` instead.'},
    { pattern: /<span/i, message: 'The `<span>` tag is forbidden. Use `<Text>` instead.'},
    { pattern: /<img/i, message: 'The `<img>` tag is forbidden. Use the `<Image>` component instead.'},
    { pattern: /grid-template-columns/i, message: 'CSS Grid property `grid-template-columns` is forbidden. Use the Flex component with `wrap` and `gap` props for grid-like layouts.' },
    { pattern: /display\s*:\s*['"]grid['"]/i, message: '`display: "grid"` is forbidden. Use the Flex component for layouts.' },
    { pattern: /<h[1-6][^>]*>/i, message: 'Raw <h1>-<h6> tags are forbidden. Use <Heading level={n}> from @react-spectrum/text.' },
    { pattern: /gap:\s*\d+(px|rem|em)/i, message: 'Use Spectrum size tokens for gap, not hard-coded pixel/rem/em values.' }
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

  return errors;
}
