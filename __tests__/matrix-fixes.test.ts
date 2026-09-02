import { describe, it, expect } from 'vitest';
import { resolveComponentInSource } from '../mcp-server/routes/editProp';

describe('resolving the clicked component in the story source', () => {
  const source = `import { Box, Button } from '@mantine/core';
export const Default = { render: () => (<Box p="xl"><Button variant="filled">View report</Button></Box>) };`;

  it('prefers a real component over a generic wrapper when both appear in the file', () => {
    // Innermost-first as the browser sends it: Button's internal Box came first.
    expect(resolveComponentInSource(source, ['Box', 'Button'])).toBe('Button');
  });

  it('falls back to the wrapper when nothing else is in the file', () => {
    expect(resolveComponentInSource(source, ['Box', 'Tooltip'])).toBe('Box');
  });

  it('still honours a declared owner when owners are known', () => {
    const owned = `${source}\nfunction Card() { return <Button>Save</Button>; }`;
    expect(resolveComponentInSource(owned, ['Box', 'Button'], { Button: 'Card', Box: 'Card' })).toBe('Button');
  });
});
