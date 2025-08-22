/**
 * @jest-environment node
 */

import { parseAIGeneratedCode } from '../utils/aiParser.js';
import { getComponentConfig } from '../config/componentRegistry.js';

describe('Visual Builder Integration Tests', () => {
  describe('Real-world Component Parsing', () => {
    test('should parse complex dashboard layout', () => {
      const code = `
import React from 'react';
import { Container, Group, Text, Button, Card, Stack, Title } from '@mantine/core';

export const Dashboard = () => {
  return (
    <Container size="lg" fluid={false}>
      <Stack gap="xl">
        <Group justify="space-between" align="center">
          <Title order={1}>Dashboard</Title>
          <Button variant="filled" size="md">Add New</Button>
        </Group>
        <Card shadow="sm" padding="lg" radius="md" withBorder>
          <Card.Section inheritPadding withBorder>
            <Text size="lg" weight="bold">Welcome</Text>
          </Card.Section>
          <Text size="md">Welcome to your dashboard!</Text>
        </Card>
      </Stack>
    </Container>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors).toEqual([]);
      expect(result.components).toHaveLength(1);
      
      const container = result.components[0];
      expect(container.type).toBe('Container');
      expect(container.props.size).toBe('lg');
      expect(container.props.fluid).toBe(false);
      
      // Verify nested structure
      expect(container.children).toHaveLength(1);
      const stack = container.children[0];
      expect(stack.type).toBe('Stack');
      expect(stack.props.gap).toBe('xl');
      
      // Check if Card.Section is properly parsed
      const card = stack.children.find(child => child.type === 'Card');
      expect(card).toBeDefined();
      
      const cardSection = card.children.find(child => child.type === 'Card.Section');
      expect(cardSection).toBeDefined();
      expect(cardSection.props.inheritPadding).toBe(true);
      expect(cardSection.props.withBorder).toBe(true);
    });

    test('should parse login form with validation', () => {
      const code = `
import React from 'react';
import { Card, Stack, Title, TextInput, Button } from '@mantine/core';

export const LoginForm = () => {
  return (
    <Card shadow="md" padding="xl" radius="lg" withBorder>
      <Stack gap="lg">
        <Title order={2} color="blue">Sign In</Title>
        <TextInput
          label="Email Address"
          placeholder="Enter your email"
          size="md"
          required
        />
        <TextInput
          label="Password"
          placeholder="Enter your password"
          type="password"
          size="md"
          required
        />
        <Button variant="filled" size="lg" color="blue">
          Sign In
        </Button>
      </Stack>
    </Card>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors).toEqual([]);
      expect(result.components).toHaveLength(1);
      
      const card = result.components[0];
      expect(card.type).toBe('Card');
      
      const stack = card.children[0];
      expect(stack.type).toBe('Stack');
      expect(stack.children).toHaveLength(4); // Title + 2 inputs + Button
      
      // Verify form elements
      const title = stack.children.find(child => child.type === 'Title');
      expect(title.props.order).toBe(2);
      expect(title.props.color).toBe('blue');
      
      const inputs = stack.children.filter(child => child.type === 'TextInput');
      expect(inputs).toHaveLength(2);
      
      const emailInput = inputs[0];
      expect(emailInput.props.label).toBe('Email Address');
      expect(emailInput.props.required).toBe(true);
      
      const passwordInput = inputs[1];
      expect(passwordInput.props.label).toBe('Password');
      expect(passwordInput.props.type).toBe('password');
      
      const button = stack.children.find(child => child.type === 'Button');
      expect(button.props.variant).toBe('filled');
      expect(button.props.size).toBe('lg');
    });

    test('should handle mixed layout components', () => {
      const code = `
import React from 'react';
import { Container, Group, Stack, Card, Text, Button } from '@mantine/core';

export const MixedLayout = () => {
  return (
    <Container size="md">
      <Stack gap="md">
        <Group justify="center">
          <Text size="xl">Header Text</Text>
        </Group>
        <Group justify="space-between">
          <Card shadow="xs" padding="sm">
            <Text>Left Card</Text>
          </Card>
          <Card shadow="xs" padding="sm">
            <Text>Right Card</Text>
          </Card>
        </Group>
        <Group justify="center">
          <Button>Action Button</Button>
        </Group>
      </Stack>
    </Container>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors).toEqual([]);
      expect(result.components).toHaveLength(1);
      
      const container = result.components[0];
      const stack = container.children[0];
      expect(stack.children).toHaveLength(3); // 3 Groups
      
      // Verify each group has correct content
      const groups = stack.children.filter(child => child.type === 'Group');
      expect(groups).toHaveLength(3);
      
      // First group with text
      expect(groups[0].children[0].type).toBe('Text');
      
      // Second group with two cards
      expect(groups[1].children).toHaveLength(2);
      expect(groups[1].children.every(child => child.type === 'Card')).toBe(true);
      
      // Third group with button
      expect(groups[2].children[0].type).toBe('Button');
    });
  });

  describe('Component Registry Integration', () => {
    test('should validate all parsed components against registry', () => {
      const code = `
import React from 'react';
import { Button, Text, UnknownComponent } from '@mantine/core';

export const TestComponent = () => {
  return (
    <div>
      <Button>Valid Button</Button>
      <Text>Valid Text</Text>
      <UnknownComponent>Invalid Component</UnknownComponent>
    </div>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      // Should have warnings for unknown components
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('UnknownComponent'))).toBe(true);
      
      // Valid components should have proper config
      const components = result.components[0]?.children || [];
      const button = components.find(c => c.type === 'Button');
      const text = components.find(c => c.type === 'Text');
      
      if (button) {
        const buttonConfig = getComponentConfig('Button');
        expect(buttonConfig).toBeDefined();
        expect(button.displayName).toBe(buttonConfig.displayName);
        expect(button.category).toBe(buttonConfig.category);
      }
      
      if (text) {
        const textConfig = getComponentConfig('Text');
        expect(textConfig).toBeDefined();
        expect(text.displayName).toBe(textConfig.displayName);
        expect(text.category).toBe(textConfig.category);
      }
    });

    test('should validate component props against registry', () => {
      const code = `
import React from 'react';
import { Button } from '@mantine/core';

export const TestComponent = () => {
  return (
    <Button 
      variant="filled" 
      size="md" 
      color="blue" 
      disabled
      invalidProp="should warn"
    >
      Test Button
    </Button>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      // Should warn about invalid props
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('invalidProp'))).toBe(true);
      
      // Valid props should be preserved
      const button = result.components[0];
      expect(button.props.variant).toBe('filled');
      expect(button.props.size).toBe('md');
      expect(button.props.color).toBe('blue');
      expect(button.props.disabled).toBe(true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle malformed JSX gracefully', () => {
      const malformedCodes = [
        '<Button>Unclosed button',
        '<Button variant=>Empty value</Button>',
        '<Button {}>Invalid props</Button>',
        '<<Button>Double angle</Button>',
      ];

      malformedCodes.forEach(code => {
        const result = parseAIGeneratedCode(code);
        // Should not throw errors, but may have errors/warnings
        expect(Array.isArray(result.components)).toBe(true);
        expect(Array.isArray(result.errors)).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);
      });
    });

    test('should handle deeply nested components', () => {
      const code = `
import React from 'react';
import { Container, Stack, Group, Card, Text } from '@mantine/core';

export const DeepNesting = () => {
  return (
    <Container>
      <Stack>
        <Group>
          <Card>
            <Card.Section>
              <Stack>
                <Text>Deeply nested text</Text>
              </Stack>
            </Card.Section>
          </Card>
        </Group>
      </Stack>
    </Container>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors).toEqual([]);
      
      // Navigate through the nesting
      const container = result.components[0];
      expect(container.type).toBe('Container');
      
      const stack1 = container.children[0];
      expect(stack1.type).toBe('Stack');
      
      const group = stack1.children[0];
      expect(group.type).toBe('Group');
      
      const card = group.children[0];
      expect(card.type).toBe('Card');
      
      const cardSection = card.children[0];
      expect(cardSection.type).toBe('Card.Section');
      
      const stack2 = cardSection.children[0];
      expect(stack2.type).toBe('Stack');
      
      const text = stack2.children[0];
      expect(text.type).toBe('Text');
      expect(text.props.children).toBe('Deeply nested text');
    });

    test('should preserve component hierarchy for visual builder', () => {
      const code = `
import React from 'react';
import { Card, Stack, Title, Text, Button } from '@mantine/core';

export const HierarchyTest = () => {
  return (
    <Card>
      <Stack>
        <Title>Card Title</Title>
        <Text>Card description</Text>
        <Button>Card Action</Button>
      </Stack>
    </Card>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      const card = result.components[0];
      const stack = card.children[0];
      
      // Verify parent-child relationships are maintained
      expect(card.type).toBe('Card');
      expect(stack.type).toBe('Stack');
      expect(stack.children).toHaveLength(3);
      
      // Each child should have unique ID for visual builder
      const childIds = stack.children.map(child => child.id);
      expect(new Set(childIds).size).toBe(childIds.length);
      
      // Each child should maintain its properties
      const [title, text, button] = stack.children;
      expect(title.type).toBe('Title');
      expect(text.type).toBe('Text');
      expect(button.type).toBe('Button');
    });
  });
});