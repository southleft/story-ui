import type { ComponentDefinition } from '../types/index';
import { generateJSXCode } from '../components/CodeExporter/codeGenerator';

/**
 * Generate a complete story file content from components
 */
export function generateStoryFileContent(
  components: ComponentDefinition[],
  storyName: string,
  fileName: string
): string {
  // Generate the JSX code for the render function
  const jsxCode = generateComponentJSX(components);
  const imports = generateImports(components);
  
  // Extract the story title from the name
  const storyTitle = storyName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\s+/, '')
    .trim();
  
  return `import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
${imports}
import { withVisualBuilderButton } from '../decorators/VisualBuilderDecorator';

const meta = {
  title: 'Generated/${storyTitle}',
  parameters: {
    layout: 'centered',
    visualBuilder: true,
    fileName: '${fileName}',
  },
  decorators: [withVisualBuilderButton],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
${jsxCode.split('\n').map(line => '    ' + line).join('\n')}
  )
};`;
}

/**
 * Generate imports for the components
 */
function generateImports(components: ComponentDefinition[]): string {
  const usedComponents = new Set<string>();
  
  const collectComponents = (comps: ComponentDefinition[]) => {
    comps.forEach(comp => {
      // Map CardSection back to Card for imports
      if (comp.type === 'CardSection') {
        usedComponents.add('Card');
      } else {
        usedComponents.add(comp.type);
      }
      if (comp.children) {
        collectComponents(comp.children);
      }
    });
  };
  
  collectComponents(components);
  
  const sortedComponents = Array.from(usedComponents).sort();
  return `import { ${sortedComponents.join(', ')} } from '@mantine/core';`;
}

/**
 * Generate JSX code for components
 */
function generateComponentJSX(components: ComponentDefinition[], indent = 0): string {
  const indentStr = '  '.repeat(indent);
  
  return components.map(component => {
    const { type, props, children } = component;
    const hasChildren = children && children.length > 0;
    const hasTextContent = props.children && typeof props.children === 'string';
    
    // Map CardSection to Card.Section
    const componentName = type === 'CardSection' ? 'Card.Section' : type;
    
    // Generate props string
    const propsString = generatePropsString(props, type);
    
    if (hasChildren) {
      // Component with children
      return `${indentStr}<${componentName}${propsString}>
${generateComponentJSX(children, indent + 1)}
${indentStr}</${componentName}>`;
    } else if (hasTextContent) {
      // Component with text content
      const textContent = props.children as string;
      // For multi-line text, preserve line breaks and handle indentation properly
      if (textContent.includes('\n')) {
        const lines = textContent.split('\n');
        const indentedLines = lines.map((line, index) => {
          if (index === 0 && line.trim() === '') return '';
          return line.trim() === '' ? '' : `${indentStr}  ${line.trim()}`;
        }).filter((line, index, arr) => {
          // Remove empty lines at the start and end
          if (index === 0 || index === arr.length - 1) {
            return line.trim() !== '';
          }
          return true;
        });
        return `${indentStr}<${componentName}${propsString}>\n${indentedLines.join('\n')}\n${indentStr}</${componentName}>`;
      }
      // Single line text - check if it should be on the same line
      else if (textContent.length < 50) {
        return `${indentStr}<${componentName}${propsString}>${textContent}</${componentName}>`;
      }
      return `${indentStr}<${componentName}${propsString}>\n${indentStr}  ${textContent}\n${indentStr}</${componentName}>`;
    } else {
      // Self-closing component
      return `${indentStr}<${componentName}${propsString} />`;
    }
  }).join('\n');
}

/**
 * Generate props string for a component
 */
function generatePropsString(props: Record<string, any>, componentType: string): string {
  const propEntries = Object.entries(props);
  
  // Filter out children prop for components that handle text content between tags
  const filteredProps = propEntries.filter(([key, value]) => {
    if (key === 'children') {
      // Never include children as a prop for Text components - they use content between tags
      if (componentType === 'Text' || componentType === 'Title') {
        return false;
      }
      // Keep children prop only for other text-based components that use it as a prop
      return ['Button', 'Badge', 'Code', 'Mark', 'Anchor'].includes(componentType) && 
             typeof value === 'string';
    }
    // Filter out undefined, null, empty string
    if (value === undefined || value === null || value === '') return false;
    // Filter out default values for specific props
    if (key === 'size' && value === 'sm') return false;
    if (key === 'variant' && value === 'filled') return false;
    return true;
  });

  if (filteredProps.length === 0) return '';

  const propsString = filteredProps
    .map(([key, value]) => {
      // Handle special cases
      if (key === 'style' && typeof value === 'object') {
        const styleEntries = Object.entries(value)
          .map(([k, v]) => {
            // Convert camelCase to proper CSS property names if needed
            const cssKey = k;
            const cssValue = typeof v === 'string' ? `'${v}'` : v;
            return `${cssKey}: ${cssValue}`;
          })
          .join(', ');
        return `style={{ ${styleEntries} }}`;
      }
      
      if (typeof value === 'boolean') {
        return value ? key : `${key}={false}`;
      } else if (typeof value === 'string') {
        return `${key}="${value}"`;
      } else if (typeof value === 'number') {
        return `${key}={${value}}`;
      } else if (Array.isArray(value)) {
        return `${key}={${JSON.stringify(value)}}`;
      } else {
        return `${key}={${JSON.stringify(value)}}`;
      }
    })
    .join(' ');

  return propsString ? ` ${propsString}` : '';
}

/**
 * Update story file via Story UI MCP server
 */
export async function updateStoryFile(
  filePath: string,
  components: ComponentDefinition[],
  storyName: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    // Extract fileName from filePath
    const fileName = filePath.split('/').pop() || filePath;
    
    // Determine the API port from environment or default
    const apiPort = (window as any).STORY_UI_MCP_PORT || 
                   (window as any).__STORY_UI_PORT__ || 
                   '4001';
    
    // Call the Story UI server to update the file
    const response = await fetch(`http://localhost:${apiPort}/story-ui/visual-builder/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName,
        filePath,
        components,
        storyName
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Story file updated via MCP server: ${result.fileName}`);
      return { 
        success: true,
        message: result.message || 'Story updated successfully'
      };
    } else {
      console.error('Failed to update story file:', result.error);
      return { 
        success: false, 
        error: result.error || 'Unknown error' 
      };
    }
  } catch (error) {
    console.error('Failed to connect to Story UI server:', error);
    
    // Fallback to localStorage if server is not available
    const fileName = filePath.split('/').pop() || filePath;
    const newContent = generateStoryFileContent(components, storyName, fileName);
    
    const updateKey = `story-update-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
    localStorage.setItem(updateKey, newContent);
    
    console.warn('⚠️ Server unavailable, saved to localStorage as fallback');
    
    return { 
      success: false, 
      error: 'Story UI server not available. Changes saved locally.' 
    };
  }
}