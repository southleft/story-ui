import React, { useState } from 'react';
import { Group, ActionIcon, Tooltip, Modal, TextInput, Button, Text, Stack, List } from '@mantine/core';
import { IconDeviceFloppy, IconFolderOpen, IconPlus, IconTrash } from '@tabler/icons-react';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { getSavedStories, deleteStory, type SavedStory } from '../../utils/storyPersistence';

interface StoryManagerProps {
  /** Size of the action icons */
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export const StoryManager: React.FC<StoryManagerProps> = ({ size = 'xs' }) => {
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [savedStories, setSavedStories] = useState<SavedStory[]>([]);
  const [saveStoryName, setSaveStoryName] = useState('');

  const { 
    saveCurrentStory, 
    loadStoryById, 
    newStory, 
    currentStoryName, 
    currentStoryId,
    isDirty
  } = useVisualBuilderStore();

  const refreshSavedStories = () => {
    setSavedStories(getSavedStories());
  };

  const handleOpenLoadModal = () => {
    refreshSavedStories();
    setIsLoadModalOpen(true);
  };

  const handleOpenSaveModal = () => {
    setSaveStoryName(currentStoryName);
    setIsSaveModalOpen(true);
  };

  const handleQuickSave = () => {
    if (currentStoryId || currentStoryName !== 'Untitled Story') {
      saveCurrentStory();
    } else {
      handleOpenSaveModal();
    }
  };

  const handleSaveStory = () => {
    if (saveStoryName.trim()) {
      saveCurrentStory(saveStoryName.trim());
      setIsSaveModalOpen(false);
      setSaveStoryName('');
    }
  };

  const handleLoadStory = (storyId: string) => {
    const success = loadStoryById(storyId);
    if (success) {
      setIsLoadModalOpen(false);
    }
  };

  const handleDeleteStory = (storyId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this story?')) {
      deleteStory(storyId);
      refreshSavedStories();
      
      // If we deleted the current story, create a new one
      if (currentStoryId === storyId) {
        newStory();
      }
    }
  };

  const handleNewStory = () => {
    if (isDirty && !confirm('You have unsaved changes. Are you sure you want to create a new story?')) {
      return;
    }
    newStory();
  };

  return (
    <>
      <Group gap="xs">
        <Tooltip label="New Story">
          <ActionIcon
            size={size}
            variant="subtle"
            onClick={handleNewStory}
          >
            <IconPlus size={14} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Save Story">
          <ActionIcon
            size={size}
            variant={isDirty ? 'filled' : 'subtle'}
            color={isDirty ? 'blue' : 'gray'}
            onClick={handleQuickSave}
          >
            <IconDeviceFloppy size={14} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Load Story">
          <ActionIcon
            size={size}
            variant="subtle"
            onClick={handleOpenLoadModal}
          >
            <IconFolderOpen size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Save Modal */}
      <Modal
        opened={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        title="Save Story"
        size="sm"
      >
        <Stack gap="md">
          <TextInput
            label="Story Name"
            placeholder="Enter story name..."
            value={saveStoryName}
            onChange={(event) => setSaveStoryName(event.currentTarget.value)}
            data-autofocus
          />
          
          <Group justify="flex-end" gap="xs">
            <Button
              variant="outline"
              onClick={() => setIsSaveModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveStory}
              disabled={!saveStoryName.trim()}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Load Modal */}
      <Modal
        opened={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
        title="Load Story"
        size="md"
      >
        <Stack gap="md">
          {savedStories.length === 0 ? (
            <Text c="dimmed" ta="center" py="lg">
              No saved stories found
            </Text>
          ) : (
            <List spacing="xs" size="sm">
              {savedStories.map((story) => (
                <List.Item key={story.id} style={{ listStyle: 'none', padding: 0 }}>
                  <Group
                    justify="space-between"
                    p="sm"
                    style={{
                      border: '1px solid #e9ecef',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      backgroundColor: story.id === currentStoryId ? '#f1f3f4' : 'white'
                    }}
                    onClick={() => handleLoadStory(story.id)}
                  >
                    <Stack gap="xs" style={{ flex: 1 }}>
                      <Text fw={500}>{story.name}</Text>
                      <Text size="xs" c="dimmed">
                        {story.components.length} components • Updated {new Date(story.updatedAt).toLocaleDateString()}
                      </Text>
                    </Stack>
                    
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      onClick={(e) => handleDeleteStory(story.id, e)}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </List.Item>
              ))}
            </List>
          )}
          
          <Group justify="flex-end">
            <Button
              variant="outline"
              onClick={() => setIsLoadModalOpen(false)}
            >
              Close
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};