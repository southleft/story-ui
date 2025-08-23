import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { Box, Group, Button, Badge, Text, Tooltip } from '@mantine/core';
import { IconDeviceFloppy, IconCheck } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { Canvas } from './Canvas/Canvas';
import { ComponentPalette } from './ComponentPalette/ComponentPalette';
import { PropertyEditor } from './PropertyEditor/PropertyEditor';
import { CodeExporter } from './CodeExporter/CodeExporter';
import { StoryManager } from './StoryManager/StoryManager';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useVisualBuilderStore } from '../store/visualBuilderStore';
import { parseStoryFromUrl, importStoryFromShareableFormat } from '../utils/storyPersistence';

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

  const { 
    clearCanvas, 
    openCodeModal, 
    loadFromCode,
    loadFromAI,
    initAutoSave,
    destroyAutoSave,
    currentStoryId,
    currentStoryName,
    isDirty,
    saveStory
  } = useVisualBuilderStore();

  // Initialize auto-save on mount
  React.useEffect(() => {
    initAutoSave();
    return () => {
      destroyAutoSave();
    };
  }, [initAutoSave, destroyAutoSave]);

  // Handle URL parameters for loading stories
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const storyInfo = parseStoryFromUrl(urlParams);
    
    if (storyInfo.type === 'data' && storyInfo.value) {
      // Load story from embedded data
      const importedStory = importStoryFromShareableFormat(storyInfo.value);
      if (importedStory && importedStory.components) {
        loadFromAI(importedStory.components);
        notifications.show({
          title: 'Story Imported',
          message: 'Story has been imported from the URL',
          color: 'green'
        });
      }
    } else if (initialCode) {
      // Load from initial code if provided
      loadFromCode(initialCode).catch(console.error);
    }
  }, [initialCode, loadFromCode, loadFromAI]);

  const handleSave = () => {
    // Use the StoryManager's save logic through the store
    if (currentStoryId) {
      const saved = saveStory();
      if (saved) {
        notifications.show({
          title: 'Story Saved',
          message: `"${saved.name}" has been saved successfully`,
          color: 'green',
          icon: <IconCheck />
        });
      } else {
        notifications.show({
          title: 'Save Failed',
          message: 'Failed to save the story. Please try again.',
          color: 'red'
        });
      }
    } else {
      // For new stories, the user needs to go through the StoryManager
      notifications.show({
        title: 'Use Save Button',
        message: 'Use the save button in the Components panel to name your story',
        color: 'blue'
      });
    }
  };

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
            <Box mt="sm">
              <StoryManager />
            </Box>
          </Box>
          <Box style={{ flex: 1, overflow: 'auto' }}>
            <ComponentPalette />
          </Box>
        </Box>

        {/* Main Canvas Area */}
        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Box p="md" style={{ borderBottom: '1px solid #e9ecef', backgroundColor: 'white' }}>
            <Group justify="space-between">
              <Group gap="xs">
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Canvas</h3>
                <Text size="sm" c="dimmed">
                  {currentStoryName}
                </Text>
                {isDirty && (
                  <Badge size="sm" color="orange" variant="light">
                    Unsaved
                  </Badge>
                )}
              </Group>
              <Tooltip label={isDirty ? 'Save your story' : 'No changes to save'}>
                <Button
                  leftSection={<IconDeviceFloppy size={16} />}
                  variant={isDirty ? 'filled' : 'light'}
                  color={isDirty ? 'blue' : 'gray'}
                  size="sm"
                  onClick={handleSave}
                  disabled={!isDirty}
                >
                  Save Story
                </Button>
              </Tooltip>
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