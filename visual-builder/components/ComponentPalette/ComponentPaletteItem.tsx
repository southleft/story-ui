import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Box, Text } from '@mantine/core';
import type { VisualBuilderComponentConfig } from '../../types/index';

interface ComponentPaletteItemProps {
  config: VisualBuilderComponentConfig;
}

export const ComponentPaletteItem: React.FC<ComponentPaletteItemProps> = ({ config }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `palette-${config.type}`,
    data: {
      isFromPalette: true,
      componentType: config.type,
      config
    }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 1,
  } : undefined;

  return (
    <Box
      ref={setNodeRef}
      style={{
        ...style,
        padding: '.75rem',
        backgroundColor: '#f8f9fa',
        borderRadius: '6px',
        border: '1px solid #e9ecef',
        cursor: 'grab',
        userSelect: 'none',
        transition: 'all 0.2s ease',
        ':hover': {
          backgroundColor: '#e9ecef',
          borderColor: '#dee2e6'
        }
      }}
      {...attributes}
      {...listeners}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#e9ecef';
        e.currentTarget.style.borderColor = '#dee2e6';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#f8f9fa';
        e.currentTarget.style.borderColor = '#e9ecef';
      }}
    >
      <Text size="sm" fw={500}>
        {config.displayName}
      </Text>
      <Text size="xs" c="dimmed" mt={2}>
        {getComponentDescription(config.type)}
      </Text>
    </Box>
  );
};

const getComponentDescription = (type: string): string => {
  const descriptions: Record<string, string> = {
    Button: 'Interactive button element',
    TextInput: 'Text input field',
    Text: 'Text display element',
    Title: 'Heading element',
    Container: 'Layout container',
    Group: 'Horizontal layout',
    Stack: 'Vertical layout',
    Card: 'Card container'
  };

  return descriptions[type] || 'Component';
};
