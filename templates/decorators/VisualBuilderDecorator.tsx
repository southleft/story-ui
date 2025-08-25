import React, { useState, useEffect } from 'react';
import type { Decorator } from '@storybook/react';

const VisualBuilderButton: React.FC<{ fileName: string; title?: string; storyVariant?: string }> = ({ fileName, title, storyVariant }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  const handleOpenVisualBuilder = async () => {
    // Check if this is an edited story
    const isEditedStory = title?.startsWith('Edited/');
    
    // Get the story source code
    let sourceCode = '';
    
    console.log('🚀 Starting Visual Builder source fetch:', {
      fileName,
      title,
      isEditedStory,
      storyVariant
    });
    
    try {
      // Method 1: Try to get raw source from our Vite plugin endpoint
      const cleanFileName = fileName.replace(/\.stories\.tsx$/, '').replace(/\.stories$/, '');
      
      try {
        console.log(`🔍 Trying Vite plugin endpoint: /api/raw-source?file=${encodeURIComponent(cleanFileName)}&isEdited=${isEditedStory}`);
        const response = await fetch(`/api/raw-source?file=${encodeURIComponent(cleanFileName)}&isEdited=${isEditedStory}`);
        console.log(`📡 Vite plugin response: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          const data = await response.json();
          console.log(`📄 Vite plugin data:`, { success: data.success, hasSource: !!data.source, sourceLength: data.source?.length });
          
          if (data.success && data.source) {
            sourceCode = data.source;
            console.log('✅ Got raw source code from Vite plugin endpoint');
          }
        } else {
          console.log('❌ Vite plugin endpoint failed:', response.status, response.statusText);
        }
      } catch (pluginError) {
        console.log('❌ Vite plugin endpoint not available:', pluginError);
      }
      
      // Method 2: Fallback - try to get from MCP server if available
      if (!sourceCode) {
        const apiPort = (window as any).STORY_UI_MCP_PORT || 
                       (window as any).__STORY_UI_PORT__ || 
                       (import.meta as any).env?.VITE_STORY_UI_PORT || 
                       '4001';
        
        try {
          // Build possible file names, considering edited stories
          let possibleNames = [];
          
          if (isEditedStory) {
            // For edited stories, just use the base filename (edited files don't have prefixes)
            // The files are in edited/ directory but have the same base name as generated
            possibleNames = [
              fileName,  // Base filename from parameters
              cleanFileName,  // Cleaned filename
              `${cleanFileName}.stories.tsx`,  // With extension
              `${fileName}.stories.tsx`,  // Alternative with extension
              `${cleanFileName}.stories.stories.tsx`,  // Handle existing double extension files
              `${fileName}.stories.stories.tsx`  // Alternative double extension
            ];
          } else {
            // For generated stories - try the base filename without path or extension
            // The MCP server expects just the base filename like "basic-card-with-image-ac857807"
            possibleNames = [
              fileName,  // Already cleaned filename without path or extension
              cleanFileName,  // Fallback cleaned name
              `${fileName}.stories.tsx`,  // Try with extension just in case
              `${cleanFileName}.stories.tsx`
            ];
          }
          
          console.log(`🔍 Trying MCP server with port ${apiPort} and possible names:`, possibleNames);
          
          for (const name of possibleNames) {
            try {
              console.log(`🔍 Trying MCP endpoint: http://localhost:${apiPort}/story-ui/visual-builder/load?fileName=${encodeURIComponent(name)}&isEdited=${isEditedStory}`);
              const mpcResponse = await fetch(`http://localhost:${apiPort}/story-ui/visual-builder/load?fileName=${encodeURIComponent(name)}&isEdited=${isEditedStory}`);
              console.log(`📡 MCP response for "${name}": ${mpcResponse.status} ${mpcResponse.statusText}`);
              
              if (mpcResponse.ok) {
                const data = await mpcResponse.json();
                console.log(`📄 MCP response data:`, { success: data.success, hasContent: !!data.content, contentLength: data.content?.length });
                
                if (data.success && data.content && data.content.trim().length > 0) {
                  sourceCode = data.content;
                  console.log('✅ Got source code from Visual Builder endpoint:', name);
                  break;
                }
              }
            } catch (nameError) {
              console.log(`❌ Failed to fetch "${name}":`, nameError.message);
            }
          }
        } catch (mpcError) {
          console.log('❌ MCP server not available:', mpcError);
        }
      }
      
      // Method 3: Direct file system read as fallback
      if (!sourceCode) {
        console.log('⚠️ Trying direct file system read as fallback');
        try {
          // Try reading the actual file directly using fetch
          const possibleDirectPaths = [
            `src/stories/generated/${fileName}.stories.tsx`,
            `src/stories/generated/${fileName}`,
            `stories/generated/${fileName}.stories.tsx`,
            `stories/generated/${fileName}`
          ];
          
          for (const path of possibleDirectPaths) {
            try {
              console.log(`🔍 Trying direct path: /${path}`);
              const directResponse = await fetch(`/${path}`);
              if (directResponse.ok) {
                const directContent = await directResponse.text();
                if (directContent && directContent.includes('render:') && !directContent.includes('<!DOCTYPE html>')) {
                  sourceCode = directContent;
                  console.log(`✅ Got source from direct path: ${path}`);
                  break;
                }
              }
            } catch (e) {
              console.log(`❌ Direct path failed: ${path}`, e.message);
            }
          }
        } catch (directError) {
          console.log('❌ Direct file read failed:', directError);
        }
      }
      
      // Method 4: Last resort - create a template
      if (!sourceCode) {
        console.error('❌ All source fetching methods failed! This should not happen if the MCP server is running.');
        console.log('⚠️ Creating fallback template - no source available');
        sourceCode = `// Source code not available - creating template
import type { Meta, StoryObj } from '@storybook/react';
import { Card, Image, Text, Badge, Group, Stack, Button, Avatar } from '@mantine/core';

const meta = {
  title: '${title || 'Generated/Component'}',
  parameters: {
    layout: 'centered',
    visualBuilder: true,
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div>
      {/* Component will be built in Visual Builder */}
      <Text>Component ready for editing in Visual Builder</Text>
    </div>
  ),
};`;
      }
      
    } catch (error) {
      console.error('❌ Error fetching story source:', error);
      
      // Create a minimal template that Visual Builder can use
      sourceCode = `// Failed to load source - creating template
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: '${title || 'Generated/Component'}',
  parameters: {
    layout: 'centered',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div>Loading component...</div>
  )
};`;
    }
    
    // Final validation before storing
    if (!sourceCode || sourceCode.trim() === '') {
      throw new Error('No source code could be fetched from any method. Please ensure the Story UI server is running.');
    }
    
    // Store the source code in sessionStorage for Visual Builder to pick up
    sessionStorage.setItem('visualBuilderInitialCode', sourceCode);
    
    // Store the filename without modification - let the backend handle directory routing
    // The isEdited flag tells the backend whether to look in edited/ or generated/ directory
    sessionStorage.setItem('visualBuilderSourceFile', fileName);
    sessionStorage.setItem('visualBuilderStoryVariant', storyVariant || 'Default');
    sessionStorage.setItem('visualBuilderIsEdited', isEditedStory ? 'true' : 'false');
    
    // Clear any previous Visual Builder draft to ensure clean start
    sessionStorage.removeItem('visualBuilderDraft');
    
    console.log('📝 Stored source code for Visual Builder:', {
      fileName,
      sourceLength: sourceCode.length,
      hasTransformedCode: sourceCode.includes('__vite__') || sourceCode.includes('_jsxDEV'),
      isTemplate: sourceCode.includes('Component ready for editing'),
      preview: sourceCode.substring(0, 200) + '...'
    });
    
    // Log additional debugging info
    console.log('🔧 Debug info:', {
      sessionStorageKeys: Object.keys(sessionStorage),
      visualBuilderInitialCode: sessionStorage.getItem('visualBuilderInitialCode')?.length,
      visualBuilderSourceFile: sessionStorage.getItem('visualBuilderSourceFile')
    });
    
    // Open Visual Builder in a new tab to avoid breaking Storybook navigation
    const visualBuilderUrl = `${window.location.origin}${window.location.pathname}?path=/story/visualbuilder--default&full=1`;
    window.open(visualBuilderUrl, '_blank');
  };
  
  return (
    <button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleOpenVisualBuilder}
      style={{
        position: 'fixed',
        top: '12px',
        right: '12px',
        padding: '4px 8px',
        fontSize: '11px',
        fontWeight: 500,
        color: isHovered ? '#8b5cf6' : '#94a3b8',
        backgroundColor: isHovered ? 'rgba(139, 92, 246, 0.1)' : 'rgba(255, 255, 255, 0.9)',
        border: `1px solid ${isHovered ? '#8b5cf6' : 'rgba(148, 163, 184, 0.3)'}`,
        borderRadius: '4px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        zIndex: 9999,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
        boxShadow: isHovered ? '0 2px 8px rgba(139, 92, 246, 0.3)' : '0 1px 3px rgba(0, 0, 0, 0.1)',
        backdropFilter: 'blur(8px)',
      }}
      title="Open in Visual Builder in a new tab for advanced editing"
    >
      🎨 Edit in Visual Builder ↗
    </button>
  );
};

export const withVisualBuilderButton: Decorator = (Story, context) => {
  const [showButton, setShowButton] = useState(false);
  
  useEffect(() => {
    // Show button for ALL generated AND edited stories, including variants
    const isEditableStory = 
      // Check if title starts with "Generated/" or "Edited/"
      context.title?.startsWith('Generated/') || 
      context.title?.startsWith('Edited/') ||
      // Check if story ID contains "generated" or "edited"
      context.id?.toLowerCase().includes('generated') ||
      context.id?.toLowerCase().includes('edited') ||
      // Check if explicitly marked as Visual Builder story
      context.parameters?.visualBuilder === true ||
      // Check if marked as edited
      context.parameters?.isEdited === true ||
      // Check if the story file path indicates it's generated
      context.parameters?.fileName?.includes('generated/') ||
      // Check component file path
      context.componentId?.includes('generated') ||
      context.componentId?.includes('edited') ||
      // Check parameters storySource for generated path
      context.parameters?.storySource?.source?.includes('/generated/');
    
    setShowButton(isEditableStory);
  }, [context.title, context.id, context.parameters, context.componentId]);
  
  // Extract fileName from the story ID or parameters
  const storyId = context.id || '';
  const storyName = context.name || 'Default'; // Get the specific story variant name
  const isEditedStory = context.title?.startsWith('Edited/') || context.parameters?.isEdited === true;
  let fileName = context.parameters?.fileName || 'unknown';
  
  // Clean the fileName if it contains a path
  if (fileName && fileName !== 'unknown') {
    // Strip directory path and extension
    // Example: "./src/stories/generated/basic-card-with-image-ac857807.stories.tsx" -> "basic-card-with-image-ac857807"
    fileName = fileName
      .replace(/^\.\//, '') // Remove leading ./
      .replace(/^.*\//, '') // Remove all directory paths
      .replace(/\.stories\.(tsx?|jsx?)$/, '') // Remove .stories.tsx/.stories.ts extension
      .replace(/\.(tsx?|jsx?)$/, ''); // Remove any remaining .tsx/.ts extension
  }
  
  // If no fileName parameter or it's still unknown, try to extract from story ID
  if (!fileName || fileName === 'unknown' && storyId) {
    // Handle different story ID patterns
    // Pattern 1: "generated-outdoor-magazine-featured-article-card-c2d4fda1--default"
    // Pattern 2: "generated-recipe-card--withrating"
    // Pattern 3: "edited-some-story-name--default"
    
    // Remove the story variant suffix (e.g., "--default", "--withrating")
    const baseId = storyId.split('--')[0];
    
    // Extract the file name from the base ID
    if (baseId.startsWith('generated-')) {
      // Remove "generated-" prefix
      fileName = baseId.substring(10); // Length of "generated-"
    } else if (baseId.startsWith('edited-')) {
      // Remove "edited-" prefix
      fileName = baseId.substring(7); // Length of "edited-"
    } else {
      fileName = baseId;
    }
  }
  
  console.log('Visual Builder: Extracted fileName:', fileName, 'for story:', storyName, 'from ID:', storyId);
  
  return (
    <>
      <Story {...context} />
      {showButton && (
        <VisualBuilderButton 
          fileName={fileName}
          title={context.title}
          storyVariant={storyName}
        />
      )}
    </>
  );
};

// Helper function to apply decorator to generated stories
export const applyToGeneratedStories = (storyExports: any) => {
  if (storyExports.default) {
    storyExports.default.decorators = [
      ...(storyExports.default.decorators || []),
      withVisualBuilderButton
    ];
    
    // Add visual builder parameter to mark this as editable
    storyExports.default.parameters = {
      ...storyExports.default.parameters,
      visualBuilder: true,
    };
  }
  return storyExports;
};