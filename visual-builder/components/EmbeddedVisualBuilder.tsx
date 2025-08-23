import React, { useEffect, useState } from 'react';
import { DndContext } from '@dnd-kit/core';
import { Box, Group, Button, Alert, Text, Modal, Stack } from '@mantine/core';
import { Canvas } from './Canvas/Canvas';
import { ComponentPalette } from './ComponentPalette/ComponentPalette';
import { PropertyEditor } from './PropertyEditor/PropertyEditor';
import { CodeExporter } from './CodeExporter/CodeExporter';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useVisualBuilderStore } from '../store/visualBuilderStore';
import { parseAIGeneratedCode } from '../utils/aiParser';

interface EmbeddedVisualBuilderProps {
  /** Initial code to load */
  initialCode?: string;
  /** Height of the builder interface */
  height?: string | number;
  /** Whether to show the component palette */
  showPalette?: boolean;
  /** Whether to show the property editor */
  showProperties?: boolean;
  /** Callback when code is exported */
  onCodeExport?: (code: string) => void;
  /** Whether the builder is in a modal/compact mode */
  compact?: boolean;
}

export const EmbeddedVisualBuilder: React.FC<EmbeddedVisualBuilderProps> = ({
  initialCode,
  height = '600px',
  showPalette = true,
  showProperties = true,
  onCodeExport,
  compact = false
}) => {
  const {
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel
  } = useDragAndDrop();

  const { 
    components,
    clearCanvas, 
    openCodeModal,
    loadFromCode,
    loadFromAI,
    importFromStoryUI 
  } = useVisualBuilderStore();

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [showLoadDialog, setShowLoadDialog] = useState(false);

  // Load initial code if provided
  useEffect(() => {
    if (initialCode) {
      handleLoadCode(initialCode);
    }
  }, [initialCode]);

  const handleLoadCode = async (code: string) => {
    setLoadError(null);
    setLoadWarnings([]);

    try {
      // First try to parse as Story UI content
      if (code.includes('render:') || code.includes('.stories.')) {
        const storyResult = await importFromStoryUI(code);
        
        if (storyResult.success) {
          if (storyResult.warnings.length > 0) {
            setLoadWarnings(storyResult.warnings);
            setShowLoadDialog(true);
          }
          return;
        } else {
          // If Story UI parsing fails, fall back to AI parser
          console.warn('Story UI parsing failed, falling back to AI parser:', storyResult.errors);
        }
      }
      
      // Fall back to AI generated code parser
      const result = parseAIGeneratedCode(code);
      
      if (result.errors.length > 0) {
        setLoadError(result.errors.join(', '));
        return;
      }

      if (result.warnings.length > 0) {
        setLoadWarnings(result.warnings);
      }

      loadFromAI(result.components);
      
      if (result.warnings.length > 0) {
        setShowLoadDialog(true);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to parse code');
    }
  };

  const handleExport = async () => {
    if (onCodeExport && components.length > 0) {
      try {
        // Generate code and pass to callback
        const { generateJSXCode } = await import('./CodeExporter/codeGenerator');
        const code = generateJSXCode(components);
        onCodeExport(code);
      } catch (error) {
        console.error('Failed to generate code:', error);
        openCodeModal();
      }
    } else {
      openCodeModal();
    }
  };

  const paletteWidth = showPalette ? (compact ? 240 : 280) : 0;
  const propertiesWidth = showProperties ? (compact ? 280 : 320) : 0;

  return (
    <>
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
            border: '1px solid #e9ecef',
            borderRadius: compact ? '8px' : '12px',
            overflow: 'hidden'
          }}
        >
          {/* Component Palette - Left Sidebar */}
          {showPalette && (
            <Box
              style={{
                width: paletteWidth,
                backgroundColor: 'white',
                borderRight: '1px solid #e9ecef',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <Box p={compact ? 'sm' : 'md'} style={{ borderBottom: '1px solid #e9ecef' }}>
                <Group justify="space-between" mb="xs">
                  <Text size={compact ? 'sm' : 'md'} fw={600}>Components</Text>
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
                    onClick={handleExport}
                  >
                    Export
                  </Button>
                </Group>
              </Box>
              <Box style={{ flex: 1, overflow: 'auto' }}>
                <ComponentPalette />
              </Box>
            </Box>
          )}

          {/* Main Canvas Area */}
          <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Box p={compact ? 'sm' : 'md'} style={{ borderBottom: '1px solid #e9ecef', backgroundColor: 'white' }}>
              <Group justify="space-between">
                <Text size={compact ? 'sm' : 'md'} fw={600}>Canvas</Text>
                {!showPalette && (
                  <Group gap="xs">
                    <Button size="xs" variant="outline" onClick={clearCanvas}>
                      Clear
                    </Button>
                    <Button size="xs" variant="filled" onClick={handleExport}>
                      Export
                    </Button>
                  </Group>
                )}
              </Group>
            </Box>
            
            {/* Error/Warning Display */}
            {loadError && (
              <Box p="sm">
                <Alert color="red" title="Parse Error">
                  {loadError}
                </Alert>
              </Box>
            )}
            
            <Box style={{ flex: 1, overflow: 'auto' }}>
              <Canvas />
            </Box>
          </Box>

          {/* Property Editor - Right Sidebar */}
          {showProperties && (
            <Box
              style={{
                width: propertiesWidth,
                backgroundColor: 'white',
                borderLeft: '1px solid #e9ecef',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <Box p={compact ? 'sm' : 'md'} style={{ borderBottom: '1px solid #e9ecef' }}>
                <Text size={compact ? 'sm' : 'md'} fw={600}>Properties</Text>
              </Box>
              <Box style={{ flex: 1, overflow: 'auto' }}>
                <PropertyEditor />
              </Box>
            </Box>
          )}

          {/* Code Export Modal */}
          <CodeExporter />
        </Box>
      </DndContext>

      {/* Warnings Dialog */}
      <Modal
        opened={showLoadDialog}
        onClose={() => setShowLoadDialog(false)}
        title="Code Loaded with Warnings"
        size="md"
      >
        <Stack gap="md">
          <Text>
            The code was successfully loaded into the Visual Builder, but there were some warnings:
          </Text>
          
          <Box p="md" style={{ backgroundColor: '#fff3cd', borderRadius: '4px' }}>
            {loadWarnings.map((warning, index) => (
              <Text key={index} size="sm" c="orange.8">
                • {warning}
              </Text>
            ))}
          </Box>
          
          <Text size="sm" c="dimmed">
            These warnings don't prevent you from editing the component, but you may want to review them.
          </Text>
          
          <Group justify="flex-end">
            <Button onClick={() => setShowLoadDialog(false)}>
              Continue Editing
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};