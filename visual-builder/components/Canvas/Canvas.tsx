import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Box, Text, Center } from '@mantine/core';
import { ComponentRenderer } from './ComponentRenderer';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { useSelection } from '../../hooks/useSelection';

// Drop zone component for canvas-level insertions
interface CanvasDropZoneProps {
  insertIndex: number;
  isVisible: boolean;
}

const CanvasDropZone: React.FC<CanvasDropZoneProps> = ({ insertIndex, isVisible }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `canvas-dropzone-${insertIndex}`,
    data: {
      isInsertionPoint: true,
      parentId: null, // Root level
      insertIndex,
      insertPosition: 'before'
    }
  });

  if (!isVisible) return null;

  return (
    <Box
      ref={setNodeRef}
      style={{
        height: isOver ? '12px' : '4px',
        backgroundColor: isOver ? '#3b82f6' : 'transparent',
        border: isOver ? '3px dashed #3b82f6' : '2px dashed #e5e7eb',
        borderRadius: '4px',
        margin: '8px 0',
        transition: 'all 0.2s ease-in-out',
        opacity: isOver ? 1 : 0.6
      }}
    >
      {isOver && (
        <Box
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Text size="xs" c="blue" fw={500}>Drop here</Text>
        </Box>
      )}
    </Box>
  );
};

export const Canvas: React.FC = () => {
  const { components, draggedComponent, isImportedFromStory } = useVisualBuilderStore();
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
        borderWidth: '2px',
        borderStyle: 'dashed',
        borderColor: isOver ? '#3b82f6' : 'transparent',
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
        <Box style={{ position: 'relative' }}>
          {/* Preserve original layout structure - don't force flex column */}
          {components.length === 1 ? (
            // Single root component - render naturally to preserve story structure
            <React.Fragment>
              <CanvasDropZone 
                insertIndex={0} 
                isVisible={Boolean(draggedComponent && draggedComponent.id !== components[0].id)}
              />
              <ComponentRenderer
                component={components[0]}
                index={0}
                parentId={null}
                preserveOriginalLayout={isImportedFromStory}
              />
              {Boolean(draggedComponent) && (
                <CanvasDropZone 
                  insertIndex={1} 
                  isVisible={true}
                />
              )}
            </React.Fragment>
          ) : (
            // Multiple root components - use minimal flex layout for builder mode
            <Box style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {components.map((component, index) => (
                <React.Fragment key={component.id}>
                  <CanvasDropZone 
                    insertIndex={index} 
                    isVisible={Boolean(draggedComponent && draggedComponent.id !== component.id)}
                  />
                  <ComponentRenderer
                    component={component}
                    index={index}
                    parentId={null}
                    preserveOriginalLayout={false}
                  />
                </React.Fragment>
              ))}
              {/* Final drop zone at the end */}
              {Boolean(draggedComponent) && (
                <CanvasDropZone 
                  insertIndex={components.length} 
                  isVisible={true}
                />
              )}
            </Box>
          )}
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