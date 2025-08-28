import { postProcessStory } from '../postProcessStory';

describe('postProcessStory', () => {
  describe('compound component mapping', () => {
    it('should map CardSection to Card.Section in Mantine stories', () => {
      const code = `
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Card, Image, Text } from '@mantine/core';

const meta = {
  title: 'Generated/Test Card',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card shadow="sm" padding="lg">
      <CardSection>
        <Image src="test.jpg" alt="Test" />
      </CardSection>
      <Text>Content here</Text>
    </Card>
  )
};`;

      const result = postProcessStory(code, '@mantine/core');

      expect(result).toContain('<Card.Section>');
      expect(result).toContain('</Card.Section>');
      expect(result).not.toContain('<CardSection>');
      expect(result).not.toContain('</CardSection>');
    });

    it('should map multiple compound components in Mantine', () => {
      const code = `
import React from 'react';
import { Menu, Button, Tabs } from '@mantine/core';

export const Default: Story = {
  render: () => (
    <div>
      <Menu>
        <MenuTarget>
          <Button>Open menu</Button>
        </MenuTarget>
        <MenuDropdown>
          <MenuItem>Item 1</MenuItem>
        </MenuDropdown>
      </Menu>
      <Tabs>
        <TabsList>
          <TabsTab value="tab1">Tab 1</TabsTab>
        </TabsList>
      </Tabs>
    </div>
  )
};`;

      const result = postProcessStory(code, '@mantine/core');

      // Check Menu compound components
      expect(result).toContain('<Menu.Target>');
      expect(result).toContain('</Menu.Target>');
      expect(result).toContain('<Menu.Dropdown>');
      expect(result).toContain('</Menu.Dropdown>');
      expect(result).toContain('<Menu.Item>');
      expect(result).toContain('</Menu.Item>');

      // Check Tabs compound components
      expect(result).toContain('<Tabs.List>');
      expect(result).toContain('</Tabs.List>');
      expect(result).toContain('<Tabs.Tab');
      expect(result).toContain('</Tabs.Tab>');

      // Should not contain incorrect mappings
      expect(result).not.toContain('<MenuTarget>');
      expect(result).not.toContain('<TabsList>');
    });

    it('should not affect non-Mantine libraries', () => {
      const code = `
import React from 'react';
import { Card } from 'some-other-library';

export const Default: Story = {
  render: () => (
    <Card>
      <CardSection>
        Content here
      </CardSection>
    </Card>
  )
};`;

      const result = postProcessStory(code, 'some-other-library');

      // Should remain unchanged for non-Mantine libraries
      expect(result).toContain('<CardSection>');
      expect(result).toContain('</CardSection>');
      expect(result).not.toContain('<Card.Section>');
    });

    it('should handle Ant Design compound components', () => {
      const code = `
import React from 'react';
import { Card, Form, Table } from 'antd';

export const Default: Story = {
  render: () => (
    <div>
      <Card>
        <CardMeta title="Title" description="Description" />
      </Card>
      <Form>
        <FormItem label="Name">
          <input />
        </FormItem>
      </Form>
    </div>
  )
};`;

      const result = postProcessStory(code, 'antd');

      expect(result).toContain('<Card.Meta');
      expect(result).toContain('<Form.Item');
      expect(result).not.toContain('<CardMeta');
      expect(result).not.toContain('<FormItem');
    });

    it('should preserve existing correct compound component syntax', () => {
      const code = `
import React from 'react';
import { Card } from '@mantine/core';

export const Default: Story = {
  render: () => (
    <Card>
      <Card.Section>
        Already correct syntax
      </Card.Section>
    </Card>
  )
};`;

      const result = postProcessStory(code, '@mantine/core');

      // Should remain unchanged when already correct
      expect(result).toContain('<Card.Section>');
      expect(result).toContain('</Card.Section>');
    });
  });
});