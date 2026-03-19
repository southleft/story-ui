import { describe, it, expect } from 'vitest';
import { extractCanvasCode, ensureRenderCall } from '../mcp-server/routes/canvasGenerate.js';
import { parseVoiceCommand } from '../templates/StoryUI/voice/voiceCommands.js';
import { titleFromPrompt, jsxCodeToStory } from '../mcp-server/routes/canvasSave.js';

// ────────────────────────────────────────────────────────────────
// extractCanvasCode
// ────────────────────────────────────────────────────────────────

describe('extractCanvasCode', () => {
  it('extracts code from a ```jsx code fence', () => {
    const response = `Here is the component:

\`\`\`jsx
const Canvas = () => {
  return <Button>Click me</Button>;
};
render(<Canvas />);
\`\`\`

Hope that helps!`;

    const result = extractCanvasCode(response);
    expect(result).toContain('const Canvas');
    expect(result).toContain('render(<Canvas />)');
    expect(result).not.toContain('```');
    expect(result).not.toContain('Hope that helps');
  });

  it('extracts code from a ```tsx code fence', () => {
    const response = `\`\`\`tsx
const Canvas = () => {
  return <Card><Text>Hello</Text></Card>;
};
render(<Canvas />);
\`\`\``;

    const result = extractCanvasCode(response);
    expect(result).toContain('const Canvas');
    expect(result).toContain('render(<Canvas />)');
    expect(result).not.toContain('```');
  });

  it('handles raw Canvas component without code fence', () => {
    const response = `const Canvas = () => {
  return <Button>Click me</Button>;
};
render(<Canvas />);`;

    const result = extractCanvasCode(response);
    expect(result).toContain('const Canvas');
    expect(result).toContain('render(<Canvas />)');
  });

  it('preserves existing render() call and does not duplicate it', () => {
    const response = `\`\`\`jsx
const Canvas = () => <Text>Hi</Text>;
render(<Canvas />);
\`\`\``;

    const result = extractCanvasCode(response);
    // Should have exactly one render call
    const renderCount = (result.match(/render\s*\(/g) || []).length;
    expect(renderCount).toBe(1);
  });

  it('appends render() call when missing', () => {
    const response = `\`\`\`jsx
const Canvas = () => {
  return <Button>Click me</Button>;
};
\`\`\``;

    const result = extractCanvasCode(response);
    expect(result).toContain('render(<Canvas />);');
  });

  it('uses custom component name when Canvas is not defined', () => {
    const response = `\`\`\`jsx
const ProductCard = () => {
  return <Card><Text>Product</Text></Card>;
};
\`\`\``;

    const result = extractCanvasCode(response);
    expect(result).toContain('render(<ProductCard />);');
  });

  it('falls back to Canvas when no PascalCase component is found', () => {
    const response = `\`\`\`jsx
return <Button>Click</Button>;
\`\`\``;

    const result = extractCanvasCode(response);
    expect(result).toContain('render(<Canvas />);');
  });
});

// ────────────────────────────────────────────────────────────────
// ensureRenderCall
// ────────────────────────────────────────────────────────────────

describe('ensureRenderCall', () => {
  it('returns code unchanged when render() is already present', () => {
    const code = `const Canvas = () => <Text>Hi</Text>;
render(<Canvas />);`;

    expect(ensureRenderCall(code)).toBe(code);
  });

  it('appends render call with the last PascalCase component name', () => {
    const code = `const Header = () => <Text>Header</Text>;
const Footer = () => <Text>Footer</Text>;`;

    const result = ensureRenderCall(code);
    expect(result).toContain('render(<Footer />);');
  });

  it('defaults to Canvas when no PascalCase component is defined', () => {
    const code = `const items = [1, 2, 3];`;
    const result = ensureRenderCall(code);
    expect(result).toContain('render(<Canvas />);');
  });

  it('detects render with whitespace variations', () => {
    const code = `const Canvas = () => <Text>Hi</Text>;
render  (<Canvas />);`;

    // Should not duplicate — the regex allows whitespace between render and (
    expect(ensureRenderCall(code)).toBe(code);
  });
});

// ────────────────────────────────────────────────────────────────
// parseVoiceCommand
// ────────────────────────────────────────────────────────────────

describe('parseVoiceCommand', () => {
  describe('command type matching', () => {
    it('recognizes undo commands', () => {
      expect(parseVoiceCommand('undo')?.type).toBe('undo');
      expect(parseVoiceCommand('undo that')?.type).toBe('undo');
      expect(parseVoiceCommand('go back')?.type).toBe('undo');
      expect(parseVoiceCommand('revert')?.type).toBe('undo');
    });

    it('recognizes redo command', () => {
      expect(parseVoiceCommand('redo')?.type).toBe('redo');
    });

    it('recognizes clear commands', () => {
      expect(parseVoiceCommand('clear')?.type).toBe('clear');
      expect(parseVoiceCommand('clear everything')?.type).toBe('clear');
      expect(parseVoiceCommand('start over')?.type).toBe('clear');
      expect(parseVoiceCommand('reset')?.type).toBe('clear');
    });

    it('recognizes stop commands', () => {
      expect(parseVoiceCommand('stop')?.type).toBe('stop');
      expect(parseVoiceCommand('stop listening')?.type).toBe('stop');
      expect(parseVoiceCommand('turn off')?.type).toBe('stop');
      expect(parseVoiceCommand('mic off')?.type).toBe('stop');
      expect(parseVoiceCommand('microphone off')?.type).toBe('stop');
    });

    it('recognizes submit commands', () => {
      expect(parseVoiceCommand('submit')?.type).toBe('submit');
      expect(parseVoiceCommand('send')?.type).toBe('submit');
      expect(parseVoiceCommand('generate')?.type).toBe('submit');
      expect(parseVoiceCommand('done')?.type).toBe('submit');
      expect(parseVoiceCommand('go')?.type).toBe('submit');
      expect(parseVoiceCommand('send it')?.type).toBe('submit');
      expect(parseVoiceCommand('generate that')?.type).toBe('submit');
    });

    it('recognizes save commands', () => {
      expect(parseVoiceCommand('save')?.type).toBe('save');
      expect(parseVoiceCommand('save this')?.type).toBe('save');
      expect(parseVoiceCommand('save it')?.type).toBe('save');
      expect(parseVoiceCommand('save story')?.type).toBe('save');
      expect(parseVoiceCommand('looks good')?.type).toBe('save');
      expect(parseVoiceCommand('this is good')?.type).toBe('save');
      expect(parseVoiceCommand('all done')?.type).toBe('save');
    });

    it('recognizes new-chat commands', () => {
      expect(parseVoiceCommand('new chat')?.type).toBe('new-chat');
      expect(parseVoiceCommand('new conversation')?.type).toBe('new-chat');
    });
  });

  describe('case insensitivity', () => {
    it('matches commands regardless of case', () => {
      expect(parseVoiceCommand('UNDO')?.type).toBe('undo');
      expect(parseVoiceCommand('Save')?.type).toBe('save');
      expect(parseVoiceCommand('STOP LISTENING')?.type).toBe('stop');
      expect(parseVoiceCommand('New Chat')?.type).toBe('new-chat');
    });
  });

  describe('punctuation handling', () => {
    it('strips punctuation before matching', () => {
      expect(parseVoiceCommand('undo.')?.type).toBe('undo');
      expect(parseVoiceCommand('save!')?.type).toBe('save');
      expect(parseVoiceCommand('stop?')?.type).toBe('stop');
      expect(parseVoiceCommand('done,')?.type).toBe('submit');
    });
  });

  describe('long utterance handling', () => {
    it('does not match regular commands in utterances longer than 4 words', () => {
      const result = parseVoiceCommand('please undo the last three changes');
      expect(result).toBeNull();
    });

    it('does not match short commands embedded in long text', () => {
      const result = parseVoiceCommand('I think we should stop and reconsider');
      expect(result).toBeNull();
    });
  });

  describe('save-intent in longer utterances', () => {
    it('detects "save it" in a longer sentence', () => {
      const result = parseVoiceCommand('this is good, save it, stop listening');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('save');
    });

    it('detects "save this" in a longer sentence', () => {
      const result = parseVoiceCommand('okay I like it please save this now');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('save');
    });

    it('detects "go ahead and save" in a longer sentence', () => {
      const result = parseVoiceCommand('looks perfect go ahead and save please');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('save');
    });

    it('detects "save and stop" in a longer sentence', () => {
      const result = parseVoiceCommand('that is wonderful save and stop please');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('save');
    });
  });

  describe('non-matching transcripts', () => {
    it('returns null for unrecognized short phrases', () => {
      expect(parseVoiceCommand('hello world')).toBeNull();
    });

    it('returns null for general long utterances without save intent', () => {
      expect(parseVoiceCommand('create a product card with an image and description')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseVoiceCommand('')).toBeNull();
    });

    it('returns null for whitespace only', () => {
      expect(parseVoiceCommand('   ')).toBeNull();
    });
  });

  describe('raw transcript preservation', () => {
    it('preserves the original transcript in the raw field', () => {
      const original = '  Save It!  ';
      const result = parseVoiceCommand(original);
      expect(result!.raw).toBe(original);
    });
  });
});

// ────────────────────────────────────────────────────────────────
// titleFromPrompt
// ────────────────────────────────────────────────────────────────

describe('titleFromPrompt', () => {
  it('removes stop words and title-cases remaining words', () => {
    const result = titleFromPrompt('create a product card with image');
    expect(result).not.toContain(' A ');
    expect(result).not.toContain(' a ');
    // "a" and "with" are stop words
    expect(result).toContain('Create');
    expect(result).toContain('Product');
    expect(result).toContain('Card');
    expect(result).toContain('Image');
  });

  it('returns a date-based fallback for empty input', () => {
    const result = titleFromPrompt('');
    expect(result).toMatch(/^Canvas /);
  });

  it('returns a date-based fallback for whitespace-only input', () => {
    const result = titleFromPrompt('   ');
    expect(result).toMatch(/^Canvas /);
  });

  it('returns a date-based fallback when only stop words remain', () => {
    const result = titleFromPrompt('a the with and for');
    expect(result).toMatch(/^Canvas /);
  });

  it('truncates to at most 6 words', () => {
    const result = titleFromPrompt(
      'create large interactive product card component showing detailed information'
    );
    const wordCount = result.split(' ').length;
    expect(wordCount).toBeLessThanOrEqual(6);
  });

  it('strips non-alphanumeric characters', () => {
    const result = titleFromPrompt('hello! world? foo-bar');
    // Should not contain punctuation
    expect(result).not.toMatch(/[!?-]/);
  });
});

// ────────────────────────────────────────────────────────────────
// jsxCodeToStory
// ────────────────────────────────────────────────────────────────

describe('jsxCodeToStory', () => {
  it('converts basic canvas code to story format', () => {
    const jsxCode = `const Canvas = () => {
  return <Card><Text>Hello</Text></Card>;
};
render(<Canvas />);`;

    const result = jsxCodeToStory(jsxCode, 'Test Card', '@mantine/core');

    expect(result).toContain("import { Card, Text } from '@mantine/core';");
    expect(result).toContain("import type { Meta, StoryObj } from '@storybook/react';");
    expect(result).toContain("title: 'Generated/Test Card'");
    expect(result).toContain('export const Default: StoryObj');
    expect(result).toContain('return <Canvas />;');
    // render(<Canvas />) should be removed from the body
    expect(result).not.toMatch(/render\s*\(\s*<Canvas\s*\/>\s*\)/);
  });

  it('includes React hook imports when hooks are used', () => {
    const jsxCode = `const Canvas = () => {
  const [count, setCount] = useState(0);
  useEffect(() => { console.log(count); }, [count]);
  return <Button onClick={() => setCount(c => c + 1)}>{count}</Button>;
};
render(<Canvas />);`;

    const result = jsxCodeToStory(jsxCode, 'Counter', '@mantine/core');

    expect(result).toContain("import { useState, useEffect } from 'react';");
    expect(result).toContain("import { Button } from '@mantine/core';");
  });

  it('handles dot-notation components like Card.Section', () => {
    const jsxCode = `const Canvas = () => {
  return (
    <Card>
      <Card.Section>
        <Text>Section content</Text>
      </Card.Section>
    </Card>
  );
};
render(<Canvas />);`;

    const result = jsxCodeToStory(jsxCode, 'Card Example', '@mantine/core');

    // Should import Card (the base) not Card.Section
    expect(result).toContain('Card');
    expect(result).not.toMatch(/import.*Card\.Section/);
    expect(result).toContain('Text');
  });

  it('does not import Canvas as a design system component', () => {
    const jsxCode = `const Canvas = () => {
  return <Container><Title>Hello</Title></Container>;
};
render(<Canvas />);`;

    const result = jsxCodeToStory(jsxCode, 'Hello', '@mantine/core');

    // Canvas is the wrapper, not a design system component
    const importLine = result.split('\n').find(l => l.includes("from '@mantine/core'"));
    expect(importLine).not.toContain('Canvas');
    expect(importLine).toContain('Container');
    expect(importLine).toContain('Title');
  });

  it('wraps canvas code in render function and returns <Canvas />', () => {
    const jsxCode = `const Canvas = () => <Badge>New</Badge>;
render(<Canvas />);`;

    const result = jsxCodeToStory(jsxCode, 'Badge', '@mantine/core');

    expect(result).toContain('render: () => {');
    expect(result).toContain('return <Canvas />;');
  });

  it('omits design system import line when no design system components are used', () => {
    const jsxCode = `const Canvas = () => {
  const [val, setVal] = useState(0);
  return <Canvas />;
};
render(<Canvas />);`;

    const result = jsxCodeToStory(jsxCode, 'Empty', '@mantine/core');

    // No design system components used (Canvas is excluded)
    expect(result).not.toContain("from '@mantine/core'");
  });
});
