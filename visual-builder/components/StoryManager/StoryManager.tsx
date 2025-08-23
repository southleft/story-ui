import React, { useState } from 'react';
import {
  Modal,
  Button,
  TextInput,
  Textarea,
  Group,
  Stack,
  ActionIcon,
  Tooltip
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconDeviceFloppy,
  IconPlus,
  IconCheck
} from '@tabler/icons-react';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';

interface StoryManagerProps {
  onClose?: () => void;
}

export const StoryManager: React.FC<StoryManagerProps> = ({ onClose }) => {
  const [isSaveAsModalOpen, setIsSaveAsModalOpen] = useState(false);
  const [newStoryName, setNewStoryName] = useState('');
  const [newStoryDescription, setNewStoryDescription] = useState('');

  const {
    currentStoryId,
    currentStoryName,
    isDirty,
    saveStory,
    saveAsNewStory,
    newStory
  } = useVisualBuilderStore();

  const handleSave = () => {
    // For existing stories, save directly
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
      // For new stories, prompt for name
      setNewStoryName(currentStoryName === 'Untitled Story' ? '' : currentStoryName);
      setNewStoryDescription('');
      setIsSaveAsModalOpen(true);
    }
  };

  const handleSaveAs = () => {
    if (!newStoryName.trim()) {
      notifications.show({
        title: 'Name Required',
        message: 'Please enter a name for your story',
        color: 'orange'
      });
      return;
    }

    const saved = saveAsNewStory(newStoryName.trim(), newStoryDescription.trim() || undefined);
    if (saved) {
      notifications.show({
        title: 'Story Saved',
        message: `"${saved.name}" has been saved successfully`,
        color: 'green',
        icon: <IconCheck />
      });
      setIsSaveAsModalOpen(false);
      setNewStoryName('');
      setNewStoryDescription('');
    } else {
      notifications.show({
        title: 'Save Failed',
        message: 'Failed to save the story. Please try again.',
        color: 'red'
      });
    }
  };

  const handleNewStory = () => {
    newStory();
    notifications.show({
      title: 'New Story Created',
      message: 'Started a new story',
      color: 'blue'
    });
  };

  return (
    <>
      <Group gap="xs">
        <Tooltip label={currentStoryId ? "Save Story" : "Save Story As..."}>
          <ActionIcon
            variant={isDirty ? "filled" : "outline"}
            color={isDirty ? "blue" : "gray"}
            onClick={handleSave}
            disabled={!isDirty}
          >
            <IconDeviceFloppy size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="New Story">
          <ActionIcon
            variant="outline"
            onClick={handleNewStory}
          >
            <IconPlus size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Save As Modal */}
      <Modal
        opened={isSaveAsModalOpen}
        onClose={() => setIsSaveAsModalOpen(false)}
        title="Save Story As"
        size="md"
      >
        <Stack>
          <TextInput
            label="Story Name"
            value={newStoryName}
            onChange={(e) => setNewStoryName(e.target.value)}
            placeholder="Enter story name"
            data-autofocus
          />
          <Textarea
            label="Description (optional)"
            value={newStoryDescription}
            onChange={(e) => setNewStoryDescription(e.target.value)}
            placeholder="Enter story description"
            rows={3}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setIsSaveAsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={handleSaveAs}
              disabled={!newStoryName.trim()}
            >
              Save Story
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};