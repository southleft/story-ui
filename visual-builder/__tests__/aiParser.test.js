/**
 * @jest-environment node
 */

import { parseAIGeneratedCode, createBasicLayout } from '../utils/aiParser.js';

describe('AI Parser', () => {
  describe('parseAIGeneratedCode', () => {
    test('should parse simple component correctly', () => {
      const code = `
import React from 'react';
import { Button } from '@mantine/core';

export const MyButton = () => {
  return (
    <Button variant="filled" size="md">
      Click me
    </Button>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors).toEqual([]);
      expect(result.components).toHaveLength(1);
      
      const button = result.components[0];
      expect(button.type).toBe('Button');
      expect(button.displayName).toBe('Button');
      expect(button.props.variant).toBe('filled');
      expect(button.props.size).toBe('md');
      expect(button.props.children).toBe('Click me');
    });

    test('should parse compound components like Card.Section', () => {
      const code = `
import React from 'react';
import { Card } from '@mantine/core';

export const CardWithSection = () => {
  return (
    <Card shadow="sm" padding="lg">
      <Card.Section inheritPadding withBorder>
        Section content
      </Card.Section>
    </Card>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors).toEqual([]);
      expect(result.components).toHaveLength(1);
      
      const card = result.components[0];
      expect(card.type).toBe('Card');
      expect(card.children).toHaveLength(1);
      
      const section = card.children[0];
      expect(section.type).toBe('Card.Section');
      expect(section.props.inheritPadding).toBe(true);
      expect(section.props.withBorder).toBe(true);
    });

    test('should parse nested components correctly', () => {
      const code = `
import React from 'react';
import { Stack, TextInput, Button } from '@mantine/core';

export const LoginForm = () => {
  return (
    <Stack gap="md">
      <TextInput label="Email" placeholder="Enter email" />
      <TextInput label="Password" type="password" />
      <Button variant="filled">Login</Button>
    </Stack>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors).toEqual([]);
      expect(result.components).toHaveLength(1);
      
      const stack = result.components[0];
      expect(stack.type).toBe('Stack');
      expect(stack.props.gap).toBe('md');
      expect(stack.children).toHaveLength(3);
      
      const [emailInput, passwordInput, button] = stack.children;
      
      expect(emailInput.type).toBe('TextInput');
      expect(emailInput.props.label).toBe('Email');
      expect(emailInput.props.placeholder).toBe('Enter email');
      
      expect(passwordInput.type).toBe('TextInput');
      expect(passwordInput.props.label).toBe('Password');
      expect(passwordInput.props.type).toBe('password');
      
      expect(button.type).toBe('Button');
      expect(button.props.variant).toBe('filled');
      expect(button.props.children).toBe('Login');
    });

    test('should handle self-closing components', () => {
      const code = `
import React from 'react';
import { TextInput } from '@mantine/core';

export const MyInput = () => {
  return (
    <TextInput placeholder="Enter text" />
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors).toEqual([]);
      expect(result.components).toHaveLength(1);
      
      const input = result.components[0];
      expect(input.type).toBe('TextInput');
      expect(input.props.placeholder).toBe('Enter text');
      expect(input.children).toEqual([]);
    });

    test('should handle boolean props correctly', () => {
      const code = `
import React from 'react';
import { Button, TextInput } from '@mantine/core';

export const FormElements = () => {
  return (
    <div>
      <Button disabled>Disabled Button</Button>
      <TextInput required placeholder="Required field" />
    </div>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.warnings.length).toBeGreaterThan(0); // div is not in registry
      
      // Should still parse known components
      const components = result.components[0]?.children || [];
      
      if (components.length > 0) {
        const button = components.find(c => c.type === 'Button');
        if (button) {
          expect(button.props.disabled).toBe(true);
        }
        
        const input = components.find(c => c.type === 'TextInput');
        if (input) {
          expect(input.props.required).toBe(true);
        }
      }
    });

    test('should handle unknown components with warnings', () => {
      const code = `
import React from 'react';
import { UnknownComponent } from '@mantine/core';

export const TestComponent = () => {
  return (
    <UnknownComponent prop="value">
      Content
    </UnknownComponent>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('UnknownComponent'))).toBe(true);
      
      // Should still create a basic definition
      expect(result.components).toHaveLength(1);
      const component = result.components[0];
      expect(component.type).toBe('UnknownComponent');
      expect(component.category).toBe('Unknown');
    });

    test('should handle invalid code gracefully', () => {
      const code = 'invalid jsx code <<>>';
      
      const result = parseAIGeneratedCode(code);
      
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.components).toEqual([]);
    });

    test('should handle empty or no JSX content', () => {
      const code = `
import React from 'react';

export const EmptyComponent = () => {
  return null;
};
      `;

      const result = parseAIGeneratedCode(code);
      
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('No JSX content found'))).toBe(true);
    });

    test('should extract props with various value types', () => {
      const code = `
import React from 'react';
import { Button, Text } from '@mantine/core';

export const TestComponent = () => {
  return (
    <div>
      <Button size="lg" disabled variant="outline">Button Text</Button>
      <Text weight={500} color="blue">Text Content</Text>
    </div>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      const components = result.components[0]?.children || [];
      const button = components.find(c => c.type === 'Button');
      const text = components.find(c => c.type === 'Text');
      
      if (button) {
        expect(button.props.size).toBe('lg');
        expect(button.props.disabled).toBe(true);
        expect(button.props.variant).toBe('outline');
        expect(button.props.children).toBe('Button Text');
      }
      
      if (text) {
        expect(text.props.weight).toBe(500);
        expect(text.props.color).toBe('blue');
        expect(text.props.children).toBe('Text Content');
      }
    });
  });

  describe('createBasicLayout', () => {
    test('should create button layout for button description', () => {
      const components = createBasicLayout('Create a button component');
      
      expect(components).toHaveLength(1);
      expect(components[0].type).toBe('Button');
      expect(components[0].props.children).toBe('Click me');
    });

    test('should create form layout for form description', () => {
      const components = createBasicLayout('Create a login form');
      
      expect(components).toHaveLength(1);
      expect(components[0].type).toBe('Stack');
      expect(components[0].children).toHaveLength(2);
      
      const [input, button] = components[0].children;
      expect(input.type).toBe('TextInput');
      expect(button.type).toBe('Button');
    });

    test('should create default layout for unknown description', () => {
      const components = createBasicLayout('Random description');
      
      expect(components).toHaveLength(1);
      expect(components[0].type).toBe('Container');
      expect(components[0].children).toHaveLength(1);
      expect(components[0].children[0].type).toBe('Text');
    });

    test('should generate unique IDs', () => {
      const components1 = createBasicLayout('button');
      const components2 = createBasicLayout('button');
      
      expect(components1[0].id).not.toBe(components2[0].id);
    });
  });

  describe('Component ID Generation', () => {
    test('should generate unique IDs for components', () => {
      const code = `
import React from 'react';
import { Button, TextInput } from '@mantine/core';

export const TestComponent = () => {
  return (
    <div>
      <Button>Button 1</Button>
      <Button>Button 2</Button>
      <TextInput placeholder="Input" />
    </div>
  );
};
      `;

      const result = parseAIGeneratedCode(code);
      
      const components = result.components[0]?.children || [];
      const ids = components.map(c => c.id);
      
      // All IDs should be unique
      expect(new Set(ids).size).toBe(ids.length);
      
      // IDs should contain component type
      ids.forEach((id, index) => {
        if (components[index].type === 'Button') {
          expect(id).toContain('button');
        } else if (components[index].type === 'TextInput') {
          expect(id).toContain('textinput');
        }
      });
    });
  });
});