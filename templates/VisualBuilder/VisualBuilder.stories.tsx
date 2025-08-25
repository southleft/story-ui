import { useState, useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { VisualBuilder, useVisualBuilderStore } from '@tpitre/story-ui/visual-builder';

const meta = {
  title: 'VisualBuilder',
  component: VisualBuilder,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof VisualBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    height: '100vh',
  },
  parameters: {
    docs: {
      description: {
        story: 'Visual Builder for editing Storybook components. Opens automatically when launched from a generated story.',
      },
    },
  },
  decorators: [
    (Story) => {
      const [isLoading, setIsLoading] = useState(true);
      const [loadError, setLoadError] = useState<string | null>(null);
      
      useEffect(() => {
        const loadStoryData = async () => {
          try {
            // Check if we have code passed from a generated story
            const initialCode = sessionStorage.getItem('visualBuilderInitialCode');
            const sourceFile = sessionStorage.getItem('visualBuilderSourceFile');
            
            if (initialCode) {
              console.log('📥 Loading story data from:', sourceFile || 'session storage');
              console.log('📋 Initial code preview:', {
                length: initialCode.length,
                hasTransformed: initialCode.includes('__vite__') || initialCode.includes('_jsxDEV'),
                preview: initialCode.substring(0, 300) + '...'
              });
              
              // Don't clear sessionStorage yet - let VisualBuilder component read it
              // We'll clear it after the component has initialized
              
              // Check for transformed code before attempting to parse
              if (initialCode.includes('__vite__cjsImport') || initialCode.includes('_jsxDEV')) {
                console.error('❌ Received Vite-transformed code!');
                setLoadError('Visual Builder received Vite-transformed code instead of source code. The raw source endpoint may not be working correctly.');
                return;
              }
              
              // Load the code into Visual Builder
              const store = useVisualBuilderStore.getState();
              const result = await store.importFromStoryUI(initialCode);
              
              if (!result.success) {
                console.error('❌ Failed to import story:', result.errors);
                setLoadError(`Failed to load story: ${result.errors.join(', ')}`);
              } else {
                if (result.warnings.length > 0) {
                  console.warn('⚠️ Import warnings:', result.warnings);
                }
                console.log('✅ Successfully loaded story from:', sourceFile || 'session storage');
              }
            } else {
              console.log('ℹ️ No initial story data found, starting with empty Visual Builder');
            }
          } catch (error) {
            console.error('Error loading story data:', error);
            setLoadError(`Error loading story: ${error instanceof Error ? error.message : 'Unknown error'}`);
          } finally {
            setIsLoading(false);
          }
        };
        
        loadStoryData();
      }, []);
      
      if (isLoading) {
        return (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh',
            fontSize: '16px',
            color: '#666'
          }}>
            Loading Visual Builder...
          </div>
        );
      }
      
      if (loadError) {
        return (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column',
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh',
            fontSize: '16px',
            color: '#d32f2f',
            padding: '20px'
          }}>
            <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>Failed to load story</div>
            <div style={{ fontSize: '14px', textAlign: 'center' }}>{loadError}</div>
            <button 
              onClick={() => window.location.reload()} 
              style={{ 
                marginTop: '20px', 
                padding: '8px 16px', 
                border: '1px solid #ccc', 
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Retry
            </button>
          </div>
        );
      }
      
      // Get the source file from session storage
      const sourceFile = sessionStorage.getItem('visualBuilderSourceFile');
      
      return <Story args={{ ...Story.args, storyFilePath: sourceFile }} />;
    },
  ],
};

export const WithPreloadedLayout: Story = {
  args: {
    height: '100vh',
  },
  decorators: [
    (Story) => {
      // Simulate loading an AI-generated layout on mount
      React.useEffect(() => {
        const store = useVisualBuilderStore.getState();
        
        // Load sample components using the correct ComponentDefinition structure
        const sampleComponents = [
          {
            id: 'title-1',
            type: 'Title',
            displayName: 'Title',
            category: 'Typography',
            props: { order: 2, children: 'Welcome to Visual Builder' },
            children: []
          },
          {
            id: 'group-1', 
            type: 'Group',
            displayName: 'Group',
            category: 'Layout',
            props: { grow: true },
            children: [
              {
                id: 'btn-1',
                type: 'Button',
                displayName: 'Button',
                category: 'Input',
                props: { variant: 'filled', children: 'Click Me' },
                children: []
              },
              {
                id: 'btn-2',
                type: 'Button', 
                displayName: 'Button',
                category: 'Input',
                props: { variant: 'outline', children: 'Learn More' },
                children: []
              }
            ]
          }
        ];
        
        store.loadFromAI(sampleComponents);
      }, []);
      
      return <Story />;
    },
  ],
};