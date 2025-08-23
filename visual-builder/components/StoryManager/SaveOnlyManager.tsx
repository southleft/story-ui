import React from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';

interface SaveOnlyManagerProps {
  /** Story file path to save to */
  storyFilePath?: string;
  /** Size of the save button */
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export const SaveOnlyManager: React.FC<SaveOnlyManagerProps> = ({ 
  storyFilePath,
  size = 'xs' 
}) => {
  const { 
    components,
    isDirty,
    markClean
  } = useVisualBuilderStore();

  const handleSave = async () => {
    if (!storyFilePath) {
      // If no file path, save to sessionStorage for now
      const storyData = {
        components,
        timestamp: Date.now()
      };
      sessionStorage.setItem('visualBuilderComponents', JSON.stringify(storyData));
      markClean();
      console.log('✅ Saved to session storage');
      return;
    }

    try {
      // In production, this would save to the actual story file
      // For now, we save to sessionStorage with the story path as key
      const storyData = {
        components,
        filePath: storyFilePath,
        timestamp: Date.now()
      };
      
      const key = `visualBuilder-story-${storyFilePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
      localStorage.setItem(key, JSON.stringify(storyData));
      
      // Also save to sessionStorage for immediate access
      sessionStorage.setItem('visualBuilderComponents', JSON.stringify(storyData));
      
      markClean();
      console.log(`✅ Saved to story: ${storyFilePath}`);
    } catch (error) {
      console.error('Failed to save story:', error);
    }
  };

  return (
    <Tooltip label={isDirty ? "Save changes" : "No changes to save"}>
      <ActionIcon
        size={size}
        variant={isDirty ? 'filled' : 'subtle'}
        color={isDirty ? 'blue' : 'gray'}
        onClick={handleSave}
        disabled={!isDirty}
      >
        <IconDeviceFloppy size={14} />
      </ActionIcon>
    </Tooltip>
  );
};