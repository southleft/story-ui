import { describe, it, expect } from 'vitest';
import { validateStoryCode } from '../story-generator/validateStory.js';

const mantineConfig = {
  importPath: '@mantine/core',
  componentFramework: 'react',
} as any;

const validate = (code: string) =>
  validateStoryCode(code, 'story.stories.tsx', mantineConfig);

/**
 * Image-driven generation produces multi-region compositions, and the model
 * naturally factors those regions into local helper components. Treating those
 * as missing imports burned self-healing retries and sometimes failed the
 * generation outright, so it stays covered.
 */
describe('local component declarations in JSX validation', () => {
  it('accepts arrow-function components declared in the same file', () => {
    const code = `
import React from 'react';
import { Paper, Group, Text } from '@mantine/core';

const TopNav = () => (<Paper><Group><Text>Nav</Text></Group></Paper>);

export const Default = { render: () => (<TopNav />) };
`;
    expect(validate(code).errors).toEqual([]);
  });

  it('accepts function and class declarations', () => {
    const code = `
import React from 'react';
import { Paper, Text } from '@mantine/core';

function ProfileSidebar() { return (<Paper><Text>Sidebar</Text></Paper>); }
class LegacyPanel extends React.Component { render() { return (<Paper />); } }

export const Default = { render: () => (<div><ProfileSidebar /><LegacyPanel /></div>) };
`;
    expect(validate(code).errors).toEqual([]);
  });

  it('accepts a full multi-region composition', () => {
    const code = `
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Paper, Group, Stack, Text, Avatar } from '@mantine/core';

const TopNav = () => (<Paper><Group><Text>Brand</Text></Group></Paper>);
const ProfileSidebar = () => (<Paper><Avatar /><Text>Jordan Rivera</Text></Paper>);
const PostActions = () => (<Group><Text>Repost</Text></Group>);
const NewsRail = () => (<Paper><Text>News</Text></Paper>);

const meta: Meta = { title: 'Generated/Feed' };
export default meta;

export const Default: StoryObj = {
  render: () => (
    <Stack>
      <TopNav />
      <Group><ProfileSidebar /><PostActions /><NewsRail /></Group>
    </Stack>
  ),
};
`;
    expect(validate(code).errors).toEqual([]);
  });

  it('accepts destructured locals and render-prop parameters', () => {
    const code = `
import React from 'react';
import { Paper } from '@mantine/core';

const Layout = { Header: () => (<Paper />) };
const { Header } = Layout;
const WithRenderProp = ({ Slot }: any) => (<Paper><Slot /></Paper>);

export const Default = { render: () => (<div><Header /><WithRenderProp /></div>) };
`;
    expect(validate(code).errors).toEqual([]);
  });

  it('still reports components that are neither imported nor defined', () => {
    const code = `
import React from 'react';
import { Paper } from '@mantine/core';

export const Default = { render: () => (<Paper><TotallyUndefined /></Paper>) };
`;
    const errors = validate(code).errors;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('TotallyUndefined');
  });

  it('does not let a local declaration mask a different missing component', () => {
    const code = `
import React from 'react';
import { Paper } from '@mantine/core';

const DefinedOne = () => (<Paper />);

export const Default = { render: () => (<div><DefinedOne /><MissingOne /></div>) };
`;
    const errors = validate(code).errors;
    expect(errors.join(' ')).toContain('MissingOne');
    expect(errors.join(' ')).not.toContain('DefinedOne');
  });
});
