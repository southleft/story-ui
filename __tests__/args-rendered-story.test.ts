/**
 * Resolving a click on a story that renders `meta.component` with `args`.
 *
 * MEASURED 2026-09-03 on react-mantine (Mantine 8, Storybook 10, generated
 * story email-address-input-a7831315): clicking the text input sent
 *
 *   candidates=Box,Input,InputWrapper,Input.Wrapper,InputBase,Input.Base,TextInput,hookified
 *   owners=Input,InputBase,InputBase,InputBase,TextInput,TextInput,hookified,unboundStoryFn
 *
 * and the server answered `Box` — the decorator's `<Box p="xl">` was the only
 * candidate that appears as a JSX element, because the story has no `render`
 * at all: Storybook renders `component: TextInput` with the args. The
 * inspector showed "Box #2" and offered hiddenFrom/visibleFrom for a text
 * input. The sibling story that writes `<TextInput>` in a render resolved
 * correctly with the identical chain, which is what isolates the cause to the
 * story shape, not the candidate order.
 */

import { describe, it, expect } from 'vitest';
import { resolveComponentInSource } from '../mcp-server/routes/editProp';
import { metaComponent, readStoryArgs } from '../story-generator/editing/propEditor.js';

/** The measured story, verbatim in the parts that matter. */
const ARGS_STORY = `import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, TextInput } from '@mantine/core';
import { IconMail } from '@tabler/icons-react';

const meta: Meta<typeof TextInput> = {
  title: 'Generated/Email Address Input',
  id: 'email-address-input-a7831315',
  component: TextInput,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <Box p="xl" style={{ width: 'var(--container-size-xs)', maxWidth: '100%' }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    label: 'Email address',
    placeholder: 'you@company.com',
    type: 'email',
    size: 'md',
    withAsterisk: true,
    leftSection: <IconMail size={16} stroke={1.5} aria-hidden="true" />,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ErrorState: Story = {
  args: {
    defaultValue: 'jordan.reyes@',
    error: 'Enter a valid email address, for example you@company.com',
  },
};
`;

const CANDIDATES = ['Box', 'Input', 'InputWrapper', 'Input.Wrapper', 'InputBase', 'Input.Base', 'TextInput', 'hookified'];
const OWNERS = {
  Box: 'Input', Input: 'InputBase', InputWrapper: 'InputBase', 'Input.Wrapper': 'InputBase',
  InputBase: 'TextInput', 'Input.Base': 'TextInput', TextInput: 'hookified', hookified: 'unboundStoryFn',
};

describe('metaComponent', () => {
  it('reads `component:` off the default export, through `export default meta`', () => {
    expect(metaComponent(ARGS_STORY)).toBe('TextInput');
  });

  it('reads an inline default export and a dotted component', () => {
    expect(metaComponent(`export default { title: 'X', component: Menu.Item } satisfies Meta;`)).toBe('Menu.Item');
  });

  it('is null — never a guess — when the default export names nothing', () => {
    expect(metaComponent(`const meta = { title: 'X' }; export default meta;`)).toBeNull();
    expect(metaComponent(`export const Default = () => <Button />;`)).toBeNull();
  });
});

describe('resolveComponentInSource on an args-rendered story', () => {
  it('resolves the measured Mantine request to TextInput, not the decorator Box', () => {
    expect(resolveComponentInSource(ARGS_STORY, CANDIDATES, OWNERS)).toBe('TextInput');
  });

  it('still resolves without owner facts (an older browser)', () => {
    expect(resolveComponentInSource(ARGS_STORY, CANDIDATES)).toBe('TextInput');
  });

  it('does not make meta.component outrank an element the story wrote and the user clicked', () => {
    // A story that names Card as its component but whose render also writes
    // a <Button>: a click on the Button still resolves to the Button.
    const src = `${ARGS_STORY}\nexport const WithButton: Story = { render: () => <Card><Button>Go</Button></Card> };`
      .replace('component: TextInput', 'component: Card');
    expect(resolveComponentInSource(src, ['Button', 'Card'], { Button: 'unboundStoryFn', Card: 'unboundStoryFn' })).toBe('Button');
  });
});

describe('readStoryArgs', () => {
  it('reports meta.args as source text, like readProps does for attributes', () => {
    const args = readStoryArgs(ARGS_STORY);
    expect(args.label).toBe('Email address');
    expect(args.size).toBe('md');
    expect(args.withAsterisk).toBe('true');
    expect(args.leftSection).toContain('<IconMail');
  });

  it('merges the named story export over meta, and adds nothing for an unknown one of several', () => {
    expect(readStoryArgs(ARGS_STORY, 'ErrorState').defaultValue).toBe('jordan.reyes@');
    expect(readStoryArgs(ARGS_STORY, 'ErrorState').label).toBe('Email address');
    expect(readStoryArgs(ARGS_STORY).defaultValue).toBeUndefined();
  });
});
