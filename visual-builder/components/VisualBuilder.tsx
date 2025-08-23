import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { Box, Group, Button, Badge, Text } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { Canvas } from './Canvas/Canvas';
import { ComponentPalette } from './ComponentPalette/ComponentPalette';
import { PropertyEditor } from './PropertyEditor/PropertyEditor';
import { CodeExporter } from './CodeExporter/CodeExporter';
import { StoryManager } from './StoryManager';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useVisualBuilderStore } from '../store/visualBuilderStore';
import { getStoryIdFromURL } from '../utils/storyPersistence';

interface VisualBuilderProps {
  /** Optional custom styling */
  style?: React.CSSProperties;
  /** Height of the builder interface */
  height?: string | number;
  /** Initial code to load */
  initialCode?: string;
  /** Initial content (alias for initialCode for Story UI integration) */
  initialContent?: string;
  /** Callback when code is exported */
  onCodeExport?: (code: string) => void;
}

export const VisualBuilder: React.FC<VisualBuilderProps> = ({
  style,
  height = '100vh',
  initialCode,
  initialContent,
  onCodeExport
}) => {
  const {
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel
  } = useDragAndDrop();

  const { 
    clearCanvas, 
    openCodeModal, 
    loadFromCode, 
    importFromStoryUI,
    saveCurrentStory,
    loadStoryById,
    currentStoryName,
    isDirty
  } = useVisualBuilderStore();

  // Load story from URL or initial code
  React.useEffect(() => {
    // Check for story ID in URL first
    const storyIdFromURL = getStoryIdFromURL();
    if (storyIdFromURL) {
      const success = loadStoryById(storyIdFromURL);
      if (success) {
        return; // Successfully loaded story from URL
      }
    }
    
    // Fallback to loading initial code if provided
    const codeToLoad = initialContent || initialCode;
    if (codeToLoad) {
      // Try Story UI import first if content looks like a story
      if (codeToLoad.includes('render:') || codeToLoad.includes('.stories.')) {
        importFromStoryUI(codeToLoad).catch((error) => {
          console.error('Story UI import failed, falling back to regular load:', error);
          loadFromCode(codeToLoad).catch(console.error);
        });
      } else {
        loadFromCode(codeToLoad).catch(console.error);
      }
    }
  }, [initialCode, initialContent, loadFromCode, importFromStoryUI, loadStoryById]);

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
            
            <Box mt="md">
              <StoryManager size="sm" />
            </Box>
          </Box>
          <Box style={{ flex: 1, overflow: 'auto' }}>
            <ComponentPalette />
          </Box>
        </Box>

        {/* Main Canvas Area */}
        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Box p="md" style={{ borderBottom: '1px solid #e9ecef', backgroundColor: 'white' }}>
            <Group justify="space-between" align="center">
              <Group align="center" gap="sm">
                <Text fw={500} size="lg">Canvas</Text>
                {currentStoryName && currentStoryName !== 'Untitled Story' && (
                  <Group gap="xs" align="center">
                    <Text size="sm" c="dimmed">•</Text>
                    <Text size="sm" c="dimmed">{currentStoryName}</Text>
                    {isDirty && (
                      <Badge size="xs" color="orange" variant="filled">
                        Unsaved
                      </Badge>
                    )}
                  </Group>
                )}
              </Group>
              
              <Button
                size="sm"
                variant={isDirty ? 'filled' : 'outline'}
                color={isDirty ? 'blue' : 'gray'}
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={() => {
                  if (currentStoryName === 'Untitled Story') {
                    // Trigger save modal for unnamed stories
                    const name = prompt('Enter story name:');
                    if (name && name.trim()) {
                      saveCurrentStory(name.trim());
                    }
                  } else {
                    saveCurrentStory();
                  }
                }}
              >
                Save Story
              </Button>
            </Group>
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