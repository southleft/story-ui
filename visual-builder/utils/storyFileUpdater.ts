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
    .replace(/^\\s+/, '')
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
      // Check if text content should be on the same line
      if (textContent.length < 50 && !textContent.includes('\n')) {
        return `${indentStr}<${componentName}${propsString}>${textContent}</${componentName}>`;
      }
      return `${indentStr}<${componentName}${propsString}>
${indentStr}  ${textContent}
${indentStr}</${componentName}>`;
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
  
  // Filter out children prop for components that don't use it as text content
  const filteredProps = propEntries.filter(([key, value]) => {
    if (key === 'children') {
      // Keep children prop only for text-based components
      return ['Button', 'Text', 'Title', 'Badge', 'Code', 'Mark', 'Anchor'].includes(componentType) && 
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
        return `style={{ ${Object.entries(value).map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`).join(', ')} }}`;
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
 * Update story file endpoint (for API integration)
 */
export async function updateStoryFile(
  filePath: string,
  components: ComponentDefinition[],
  storyName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Extract fileName from filePath
    const fileName = filePath.split('/').pop() || filePath;
    
    // Generate the new story content
    const newContent = generateStoryFileContent(components, storyName, fileName);
    
    // In a real implementation, this would make an API call to update the file
    // For now, we'll save it to localStorage with a special key
    const updateKey = `story-update-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
    localStorage.setItem(updateKey, newContent);
    
    // Also save metadata about the update
    const updates = JSON.parse(localStorage.getItem('story-updates') || '[]');
    updates.push({
      filePath,
      storyName,
      timestamp: Date.now(),
      content: newContent
    });
    localStorage.setItem('story-updates', JSON.stringify(updates));
    
    console.log(`📝 Story file update prepared for: ${filePath}`);
    console.log('Generated content:', newContent);
    
    return { success: true };
  } catch (error) {
    console.error('Failed to update story file:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}