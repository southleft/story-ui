import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { Box, Group, Button } from '@mantine/core';
import { Canvas } from './Canvas/Canvas';
import { ComponentPalette } from './ComponentPalette/ComponentPalette';
import { PropertyEditor } from './PropertyEditor/PropertyEditor';
import { CodeExporter } from './CodeExporter/CodeExporter';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useVisualBuilderStore } from '../store/visualBuilderStore';

interface VisualBuilderProps {
  /** Optional custom styling */
  style?: React.CSSProperties;
  /** Height of the builder interface */
  height?: string | number;
  /** Initial code to load */
  initialCode?: string;
  /** Callback when code is exported */
  onCodeExport?: (code: string) => void;
}

export const VisualBuilder: React.FC<VisualBuilderProps> = ({
  style,
  height = '100vh',
  initialCode,
  onCodeExport
}) => {
  const {
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel
  } = useDragAndDrop();

  const { clearCanvas, openCodeModal, loadFromCode } = useVisualBuilderStore();

  // Load initial code if provided
  React.useEffect(() => {
    if (initialCode) {
      loadFromCode(initialCode).catch(console.error);
    }
  }, [initialCode, loadFromCode]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <Box
        style={{
          display: 'flex',
          height,
          backgroundColor: '#f8f9fa',
          ...style
        }}
      >
        {/* Component Palette - Left Sidebar */}
        <Box
          style={{
            width: 280,
            backgroundColor: 'white',
            borderRight: '1px solid #e9ecef',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Box p="md" style={{ borderBottom: '1px solid #e9ecef' }}>
            <Group justify="space-between" mb="sm">
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Components</h3>
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                variant="outline"
                onClick={clearCanvas}
              >
                Clear
              </Button>
              <Button
                size="xs"
                variant="filled"
                onClick={async () => {
                  if (onCodeExport) {
                    try {
                      const { generateJSXCode } = await import('./CodeExporter/codeGenerator');
                      const { components } = useVisualBuilderStore.getState();
                      const code = generateJSXCode(components);
                      onCodeExport(code);
                    } catch (error) {
                      console.error('Failed to generate code:', error);
                      openCodeModal();
                    }
                  } else {
                    openCodeModal();
                  }
                }}
              >
                Export
              </Button>
            </Group>
          </Box>
          <Box style={{ flex: 1, overflow: 'auto' }}>
            <ComponentPalette />
          </Box>
        </Box>

        {/* Main Canvas Area */}
        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Box p="md" style={{ borderBottom: '1px solid #e9ecef', backgroundColor: 'white' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Canvas</h3>
          </Box>
          <Box style={{ flex: 1, overflow: 'auto' }}>
            <Canvas />
          </Box>
        </Box>

        {/* Property Editor - Right Sidebar */}
        <Box
          style={{
            width: 320,
            backgroundColor: 'white',
            borderLeft: '1px solid #e9ecef',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Box p="md" style={{ borderBottom: '1px solid #e9ecef' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Properties</h3>
          </Box>
          <Box style={{ flex: 1, overflow: 'auto' }}>
            <PropertyEditor />
          </Box>
        </Box>

        {/* Code Export Modal */}
        <CodeExporter />
      </Box>
    </DndContext>
  );
};