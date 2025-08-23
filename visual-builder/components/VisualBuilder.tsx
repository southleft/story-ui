import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { Box, Group, Button, Badge, Text } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { Canvas } from './Canvas/Canvas';
import { ComponentPalette } from './ComponentPalette/ComponentPalette';
import { PropertyEditor } from './PropertyEditor/PropertyEditor';
import { CodeExporter } from './CodeExporter/CodeExporter';
import { SaveOnlyManager } from './StoryManager/SaveOnlyManager';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useVisualBuilderStore } from '../store/visualBuilderStore';
import { getStoryIdFromURL, saveDraft, restoreDraft, getVisualBuilderEditURL } from '../utils/storyPersistence';
import { updateStoryFile } from '../utils/storyFileUpdater';

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
  /** Story file path for saving back to source */
  storyFilePath?: string;
}

export const VisualBuilder: React.FC<VisualBuilderProps> = ({
  style,
  height = '100vh',
  initialCode,
  initialContent,
  onCodeExport,
  storyFilePath
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
    importFromStoryUI,
    saveCurrentStory,
    loadStoryById,
    currentStoryName,
    currentStoryId,
    isDirty
  } = useVisualBuilderStore();

  // Create a stable story ID for drafts
  const [storyId, setStoryId] = React.useState(() => {
    const urlStoryId = getStoryIdFromURL();
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    return editId || urlStoryId || `story-${Date.now()}`;
  });

  // Update URL when story ID changes
  React.useEffect(() => {
    if (storyId) {
      const url = new URL(window.location.href);
      url.searchParams.set('story', storyId);
      window.history.replaceState({}, '', url.toString());
    }
  }, [storyId]);

  // Track if initial load is complete
  const [isInitialLoadComplete, setIsInitialLoadComplete] = React.useState(false);

  // Load story from URL or initial code
  React.useEffect(() => {
    // Check for story ID in URL first
    const storyIdFromURL = getStoryIdFromURL();
    if (storyIdFromURL) {
      const success = loadStoryById(storyIdFromURL);
      if (success) {
        console.log('✅ Loaded story from URL:', storyIdFromURL);
        setIsInitialLoadComplete(true);
        return; // Successfully loaded story from URL
      }
    }
    
    // Try to restore draft if available
    const draftComponents = restoreDraft(storyId);
    if (draftComponents && draftComponents.length > 0) {
      console.log('📝 Restored draft from localStorage');
      loadFromAI(draftComponents);
      setIsInitialLoadComplete(true);
      return;
    }
    
    // Fallback to loading initial code if provided
    const codeToLoad = initialContent || initialCode;
    if (codeToLoad) {
      // Try Story UI import first if content looks like a story
      if (codeToLoad.includes('render:') || codeToLoad.includes('.stories.')) {
        importFromStoryUI(codeToLoad).then(() => {
          setIsInitialLoadComplete(true);
        }).catch((error) => {
          console.error('Story UI import failed, falling back to regular load:', error);
          loadFromCode(codeToLoad).then(() => {
            setIsInitialLoadComplete(true);
          }).catch(console.error);
        });
      } else {
        loadFromCode(codeToLoad).then(() => {
          setIsInitialLoadComplete(true);
        }).catch(console.error);
      }
    } else {
      setIsInitialLoadComplete(true);
    }
  }, []); // Run only once on mount

  // Save components to draft when they change after initial load
  React.useEffect(() => {
    if (isInitialLoadComplete && components.length > 0) {
      // Save immediately when components are loaded from initial content
      saveDraft(storyId, components);
      console.log('💾 Saved story to draft with ID:', storyId);
    }
  }, [components, isInitialLoadComplete, storyId]);

  // Auto-save drafts when dirty
  React.useEffect(() => {
    if (components.length > 0 && isDirty && isInitialLoadComplete) {
      const timer = setTimeout(() => {
        saveDraft(storyId, components);
        console.log('💾 Auto-saved draft');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [components, isDirty, storyId]);

  // Update URL when editing
  React.useEffect(() => {
    if (window.location.pathname.includes('visual-builder')) {
      const editURL = getVisualBuilderEditURL(storyId);
      window.history.replaceState({}, '', editURL);
    }
  }, [storyId]);

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
          <Box p="sm" style={{ borderBottom: '1px solid #e9ecef' }}>
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
          <Box p="sm" style={{ borderBottom: '1px solid #e9ecef', backgroundColor: 'white' }}>
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
                onClick={async () => {
                  // Check if we have a meaningful story name
                  const hasValidName = currentStoryName && 
                    currentStoryName !== 'Untitled Story' && 
                    currentStoryName !== 'Imported Story';
                  
                  let finalName = currentStoryName;
                  if (!hasValidName) {
                    // Only prompt if we don't have a valid name
                    const name = prompt('Enter story name:', currentStoryName);
                    if (name && name.trim()) {
                      finalName = name.trim();
                    } else {
                      return; // User cancelled
                    }
                  }
                  
                  // Save to store
                  saveCurrentStory(finalName);
                  
                  // Always try to update the story file if we have components
                  if (components.length > 0) {
                    // Use the story file path or generate one from the story name
                    const fileToUpdate = storyFilePath || `${finalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.stories.tsx`;
                    const result = await updateStoryFile(fileToUpdate, components, finalName);
                    
                    if (result.success) {
                      console.log(`✅ Updated story file: ${fileToUpdate}`);
                      // Show success message
                      const message = result.message || 'Story saved successfully!';
                      alert(`${message}\n\nRefresh Storybook to see your changes.`);
                    } else {
                      console.error('Failed to update story file:', result.error);
                      // Show error but reassure user that changes are saved locally
                      if (result.error?.includes('server not available')) {
                        alert('Story UI server is not running.\n\nYour changes have been saved locally.\nMake sure the Story UI server is running to save to files.');
                      } else {
                        alert(`Failed to save story: ${result.error}\n\nPlease try again.`);
                      }
                    }
                  } else {
                    console.log(`✅ Saved story: ${finalName}`);
                  }
                }}
                disabled={!isDirty && !components.length}
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
          <Box p="sm" style={{ borderBottom: '1px solid #e9ecef' }}>
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