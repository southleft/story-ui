import type { ComponentDefinition } from '../../types/index';

export const generateJSXCode = (components: ComponentDefinition[]): string => {
  if (components.length === 0) {
    return `import React from 'react';
import { Box } from '@mantine/core';

export const GeneratedComponent = () => {
  return (
    <Box>
      {/* Add your components here */}
    </Box>
  );
};`;
  }

  const imports = generateImports(components);
  const componentCode = generateComponentCode(components);

  return `import React from 'react';
${imports}

export const GeneratedComponent = () => {
  return (
    <>
${componentCode.split('\n').map(line => line ? `      ${line}` : '').join('\n')}
    </>
  );
};`;
};

const generateImports = (components: ComponentDefinition[]): string => {
  const usedComponents = new Set<string>();
  
  const collectComponents = (comps: ComponentDefinition[]) => {
    comps.forEach(comp => {
      usedComponents.add(comp.type);
      if (comp.children) {
        collectComponents(comp.children);
      }
    });
  };
  
  collectComponents(components);
  
  const sortedComponents = Array.from(usedComponents).sort();
  return `import { ${sortedComponents.join(', ')} } from '@mantine/core';`;
};

const generateComponentCode = (components: ComponentDefinition[], indent = 0): string => {
  const indentStr = '  '.repeat(indent);
  
  return components.map(component => {
    const { type, props, children } = component;
    const hasChildren = children && children.length > 0;
    const hasTextContent = props.children && typeof props.children === 'string';
    
    // Generate props string
    const propsString = generatePropsString(props, type);
    
    if (hasChildren) {
      // Component with children
      return `${indentStr}<${type}${propsString}>
${generateComponentCode(children, indent + 1)}
${indentStr}</${type}>`;
    } else if (hasTextContent) {
      // Component with text content
      return `${indentStr}<${type}${propsString}>
${indentStr}  ${props.children}
${indentStr}</${type}>`;
    } else {
      // Self-closing component
      return `${indentStr}<${type}${propsString} />`;
    }
  }).join('\n');
};

const generatePropsString = (props: Record<string, any>, componentType: string): string => {
  const propEntries = Object.entries(props);
  
  // Filter out children prop for components that don't use it as text content
  const filteredProps = propEntries.filter(([key, value]) => {
    if (key === 'children') {
      // Keep children prop only for text-based components
      return ['Button', 'Text', 'Title'].includes(componentType) && typeof value === 'string';
    }
    // Filter out undefined, null, empty string, and default values
    if (value === undefined || value === null || value === '') return false;
    return true;
  });

  if (filteredProps.length === 0) return '';

  const propsString = filteredProps
    .map(([key, value]) => {
      if (typeof value === 'boolean') {
        return value ? key : `${key}={false}`;
      } else if (typeof value === 'string') {
        return `${key}="${value}"`;
      } else if (typeof value === 'number') {
        return `${key}={${value}}`;
      } else {
        return `${key}={${JSON.stringify(value)}}`;
      }
    })
    .join(' ');

  return propsString ? ` ${propsString}` : '';
};