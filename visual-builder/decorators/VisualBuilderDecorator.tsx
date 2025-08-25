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
      // Try to get raw source from Vite plugin endpoint
      const cleanFileName = fileName.replace(/\.stories\.tsx$/, '').replace(/\.stories$/, '');
      
      try {
        console.log(`🔍 Trying Vite plugin endpoint: /api/raw-source?file=${encodeURIComponent(cleanFileName)}&isEdited=${isEditedStory}`);
        const response = await fetch(`/api/raw-source?file=${encodeURIComponent(cleanFileName)}&isEdited=${isEditedStory}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.source) {
            sourceCode = data.source;
            console.log('✅ Got raw source code from Vite plugin endpoint');
          }
        }
      } catch (pluginError) {
        console.log('❌ Vite plugin endpoint not available:', pluginError);
      }
      
      // Fallback - try to get from MCP server if available
      if (!sourceCode) {
        const apiPort = (window as any).STORY_UI_MCP_PORT || 
                       (window as any).__STORY_UI_PORT__ || 
                       (import.meta as any).env?.VITE_STORY_UI_PORT || 
                       '4001';
        
        try {
          const possibleNames = [
            fileName,
            cleanFileName,
            `${cleanFileName}.stories.tsx`,
            `${fileName}.stories.tsx`
          ];
          
          for (const name of possibleNames) {
            try {
              const mpcResponse = await fetch(`http://localhost:${apiPort}/story-ui/visual-builder/load?fileName=${encodeURIComponent(name)}&isEdited=${isEditedStory}`);
              
              if (mpcResponse.ok) {
                const data = await mpcResponse.json();
                if (data.success && data.content && data.content.trim().length > 0) {
                  sourceCode = data.content;
                  console.log('✅ Got source code from Visual Builder endpoint:', name);
                  break;
                }
              }
            } catch (nameError) {
              console.log(`❌ Failed to fetch "${name}":`, nameError instanceof Error ? nameError.message : String(nameError));
            }
          }
        } catch (mpcError) {
          console.log('❌ MCP server not available:', mpcError);
        }
      }
      
      // If no source code available, create a template
      if (!sourceCode) {
        console.warn('⚠️ Creating fallback template - no source available');
        sourceCode = `// Source code not available - creating template
import type { Meta, StoryObj } from '@storybook/react';

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
    <div>Component ready for editing in Visual Builder</div>
  ),
};`;
      }
      
    } catch (error) {
      console.error('❌ Error fetching story source:', error);
    }
    
    // Store the source code in sessionStorage for Visual Builder to pick up
    sessionStorage.setItem('visualBuilderInitialCode', sourceCode);
    sessionStorage.setItem('visualBuilderSourceFile', fileName);
    sessionStorage.setItem('visualBuilderStoryVariant', storyVariant || 'Default');
    sessionStorage.setItem('visualBuilderIsEdited', isEditedStory ? 'true' : 'false');
    
    // Clear any previous Visual Builder draft to ensure clean start
    sessionStorage.removeItem('visualBuilderDraft');
    
    console.log('📝 Stored source code for Visual Builder:', {
      fileName,
      sourceLength: sourceCode.length,
      preview: sourceCode.substring(0, 200) + '...'
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
    // Show button for ALL generated AND edited stories
    const isEditableStory = 
      context.title?.startsWith('Generated/') || 
      context.title?.startsWith('Edited/') ||
      context.id?.toLowerCase().includes('generated') ||
      context.id?.toLowerCase().includes('edited') ||
      context.parameters?.visualBuilder === true ||
      context.parameters?.isEdited === true;
    
    setShowButton(isEditableStory);
  }, [context.title, context.id, context.parameters]);
  
  // Extract fileName from the story ID or parameters
  const storyId = context.id || '';
  const storyName = context.name || 'Default';
  const isEditedStory = context.title?.startsWith('Edited/') || context.parameters?.isEdited === true;
  let fileName = context.parameters?.fileName || 'unknown';
  
  // Clean the fileName if it contains a path
  if (fileName && fileName !== 'unknown') {
    fileName = fileName
      .replace(/^\.\//, '')
      .replace(/^.*\//, '')
      .replace(/\.stories\.(tsx?|jsx?)$/, '')
      .replace(/\.(tsx?|jsx?)$/, '');
  }
  
  // If no fileName parameter, try to extract from story ID
  if (!fileName || fileName === 'unknown' && storyId) {
    const baseId = storyId.split('--')[0];
    
    if (baseId.startsWith('generated-')) {
      fileName = baseId.substring(10);
    } else if (baseId.startsWith('edited-')) {
      fileName = baseId.substring(7);
    } else {
      fileName = baseId;
    }
  }
  
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