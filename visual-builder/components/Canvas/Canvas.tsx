import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Box, Text, Center } from '@mantine/core';
import { ComponentRenderer } from './ComponentRenderer';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { useSelection } from '../../hooks/useSelection';

export const Canvas: React.FC = () => {
  const { components } = useVisualBuilderStore();
  const { handleCanvasClick } = useSelection();

  const { setNodeRef, isOver } = useDroppable({
    id: 'canvas',
    data: {
      isCanvas: true
    }
  });

  const isEmpty = components.length === 0;

  return (
    <Box
      ref={setNodeRef}
      onClick={handleCanvasClick}
      style={{
        minHeight: '100%',
        padding: '2rem',
        backgroundColor: isOver ? '#f0f9ff' : 'white',
        border: isOver ? '2px dashed #3b82f6' : '2px dashed transparent',
        transition: 'all 0.2s ease',
        position: 'relative'
      }}
    >
      {isEmpty ? (
        <Center style={{ height: '50vh' }}>
          <Box ta="center">
            <Text size="lg" c="dimmed" mb="sm">
              Drop components here to start building
            </Text>
            <Text size="sm" c="dimmed">
              Drag components from the left panel to create your UI
            </Text>
          </Box>
        </Center>
      ) : (
        <Box style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {components.map((component, index) => (
            <ComponentRenderer
              key={component.id}
              component={component}
              index={index}
            />
          ))}
        </Box>
      )}

      {/* Drop overlay for visual feedback */}
      {isOver && (
        <Box
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            pointerEvents: 'none',
            borderRadius: '8px'
          }}
        />
      )}
    </Box>
  );
};