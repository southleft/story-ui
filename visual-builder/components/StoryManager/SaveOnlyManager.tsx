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
      // Debug: Check components before saving
      console.log('🔍 Components before save:', JSON.stringify(components, null, 2));
      
      // Fix style props if they're strings
      const fixedComponents = JSON.parse(JSON.stringify(components, (key, value) => {
        if (key === 'style' && typeof value === 'string') {
          console.warn('⚠️ Found string style prop, attempting to parse:', value);
          // Try to parse string style back to object
          try {
            // Remove outer quotes if present
            let styleStr = value;
            if (styleStr.startsWith('"') && styleStr.endsWith('"')) {
              styleStr = styleStr.slice(1, -1);
            }
            
            // Check if it looks like an object string
            if (styleStr.startsWith('{') && styleStr.endsWith('}')) {
              // Remove braces and parse
              const innerStr = styleStr.slice(1, -1).trim();
              const styleObj: Record<string, any> = {};
              
              // Split by comma (careful with values that might contain commas)
              const pairs = innerStr.split(/,(?![^(]*\))/);
              
              for (const pair of pairs) {
                const colonIndex = pair.indexOf(':');
                if (colonIndex > -1) {
                  const prop = pair.substring(0, colonIndex).trim();
                  let val = pair.substring(colonIndex + 1).trim();
                  
                  // Remove quotes from property name
                  const cleanProp = prop.replace(/['"]/g, '');
                  
                  // Parse value
                  if (val.startsWith("'") && val.endsWith("'")) {
                    val = val.slice(1, -1);
                  } else if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.slice(1, -1);
                  } else if (/^\d+$/.test(val)) {
                    val = parseInt(val, 10) as any;
                  } else if (/^\d*\.\d+$/.test(val)) {
                    val = parseFloat(val) as any;
                  }
                  
                  styleObj[cleanProp] = val;
                }
              }
              
              console.log('✅ Parsed style object:', styleObj);
              return styleObj;
            }
          } catch (e) {
            console.error('❌ Failed to parse style string:', e);
          }
        }
        return value;
      }));
      
      // Use the new simplified save system
      const cleanFileName = getCleanFileName(storyFilePath.split('/').pop() || storyFilePath);
      const storyName = filePathToStoryName(cleanFileName);
      
      const result = await saveStoryFile(storyFilePath, fixedComponents, {
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