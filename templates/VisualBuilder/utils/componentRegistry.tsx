import React from 'react';
import { Button, Text, Group, Stack, Card } from '@mantine/core';
import type { ComponentNode, ComponentTypeName } from '../types';

export interface RegistryEntry {
  label: string;
  icon?: string;
  isContainer?: boolean;
  defaults?: Record<string, any>;
  render: (props: Record<string, any>, children: React.ReactNode) => React.ReactNode;
  propSchema: Array<{ key: string; type: 'string' | 'boolean' | 'enum' | 'number' | 'color'; options?: string[]; label?: string }>;
}

export const registry: Record<ComponentTypeName, RegistryEntry> = {
  Text: {
    label: 'Text',
    defaults: { content: 'Hello world' },
    render: (props) => <Text {...props}>{props.content ?? 'Text'}</Text>,
    propSchema: [
      { key: 'content', type: 'string', label: 'Text' },
      { key: 'size', type: 'enum', options: ['xs','sm','md','lg','xl'], label: 'Size' },
      { key: 'c', type: 'color', label: 'Color' },
    ],
  },
  Button: {
    label: 'Button',
    defaults: { children: 'Click me', variant: 'filled', color: 'blue' },
    render: (props) => <Button {...props}>{props.children ?? 'Button'}</Button>,
    propSchema: [
      { key: 'children', type: 'string', label: 'Label' },
      { key: 'variant', type: 'enum', options: ['filled','light','outline','subtle','transparent'], label: 'Variant' },
      { key: 'color', type: 'string', label: 'Color' },
    ],
  },
  Group: {
    label: 'Group',
    isContainer: true,
    defaults: { gap: 'sm', align: 'center' },
    render: (props, children) => <Group {...props}>{children}</Group>,
    propSchema: [
      { key: 'gap', type: 'enum', options: ['xs','sm','md','lg','xl'], label: 'Gap' },
      { key: 'justify', type: 'enum', options: ['flex-start','center','flex-end','space-between'], label: 'Justify' },
      { key: 'align', type: 'enum', options: ['flex-start','center','flex-end','stretch'], label: 'Align' },
    ],
  },
  Stack: {
    label: 'Stack',
    isContainer: true,
    defaults: { gap: 'sm' },
    render: (props, children) => <Stack {...props}>{children}</Stack>,
    propSchema: [
      { key: 'gap', type: 'enum', options: ['xs','sm','md','lg','xl'], label: 'Gap' },
    ],
  },
  Card: {
    label: 'Card',
    isContainer: true,
    defaults: { withBorder: true, shadow: 'sm', padding: 'md' },
    render: (props, children) => <Card {...props}>{children}</Card>,
    propSchema: [
      { key: 'withBorder', type: 'boolean', label: 'Border' },
      { key: 'shadow', type: 'enum', options: ['xs','sm','md','lg','xl'], label: 'Shadow' },
      { key: 'padding', type: 'enum', options: ['xs','sm','md','lg','xl'], label: 'Padding' },
    ],
  },
};

export function renderNode(node: ComponentNode, childElements: React.ReactNode): React.ReactNode {
  const entry = registry[node.type];
  if (!entry) return null;
  return entry.render(node.props, childElements);
}
