import React from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { saveStoryFile, getCleanFileName, filePathToStoryName } from '../../utils/storyFileManager';

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
      // Use the new simplified save system
      const cleanFileName = getCleanFileName(storyFilePath.split('/').pop() || storyFilePath);
      const storyName = filePathToStoryName(cleanFileName);
      
      const result = await saveStoryFile(storyFilePath, components, {
        storyName,
        createBackup: false // Visual Builder never creates backups
      });
      
      if (result.success) {
        markClean();
        console.log(`✅ Saved story: ${result.fileName}`);
      } else {
        console.error(`❌ Failed to save: ${result.error}`);
      }
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