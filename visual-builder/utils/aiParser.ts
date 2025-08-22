import { ComponentDefinition } from '../types';
import { MANTINE_COMPONENTS, getComponentConfig } from '../config/componentRegistry';

/**
 * Parse AI-generated JSX/React code and convert it to Visual Builder's component structure
 */
export interface ParseResult {
  components: ComponentDefinition[];
  errors: string[];
  warnings: string[];
}

/**
 * Parse AI-generated JSX code into Visual Builder component definitions
 */
export const parseAIGeneratedCode = (code: string): ParseResult => {
  const result: ParseResult = {
    components: [],
    errors: [],
    warnings: []
  };

  try {
    // Clean and extract the component JSX
    const jsxContent = extractJSXContent(code);
    if (!jsxContent) {
      result.errors.push('No JSX content found in the provided code');
      return result;
    }

    // Parse the JSX into component definitions
    const parsedComponents = parseJSXToComponents(jsxContent);
    result.components = parsedComponents;

    // Validate components against registry
    validateComponents(result.components, result);

  } catch (error) {
    result.errors.push(`Failed to parse code: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
};

/**
 * Extract JSX content from the AI-generated code
 */
const extractJSXContent = (code: string): string | null => {
  // Remove imports and exports to focus on JSX
  const lines = code.split('\n');
  const jsxLines: string[] = [];
  let inJSX = false;
  let bracketCount = 0;
  let parenthesesCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip import statements
    if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
      continue;
    }
    
    // Skip function declaration lines
    if (trimmed.includes('= () => {') || trimmed.includes('function ') || trimmed === '{' || trimmed === '}') {
      continue;
    }
    
    // Skip return statement
    if (trimmed.startsWith('return (') || trimmed.startsWith('return')) {
      inJSX = true;
      if (trimmed.includes('(')) {
        parenthesesCount += (trimmed.match(/\(/g) || []).length;
        parenthesesCount -= (trimmed.match(/\)/g) || []).length;
      }
      continue;
    }
    
    if (inJSX) {
      // Track brackets and parentheses
      bracketCount += (line.match(/</g) || []).length;
      bracketCount -= (line.match(/>/g) || []).length;
      parenthesesCount += (line.match(/\(/g) || []).length;
      parenthesesCount -= (line.match(/\)/g) || []).length;
      
      // Add line if it contains actual JSX content
      if (trimmed && !trimmed.startsWith('//') && trimmed !== ';') {
        jsxLines.push(line);
      }
      
      // Stop when we've closed all parentheses (end of return statement)
      if (parenthesesCount <= 0 && bracketCount <= 0) {
        break;
      }
    }
  }

  return jsxLines.length > 0 ? jsxLines.join('\n') : null;
};

/**
 * Parse JSX string into component definitions
 */
const parseJSXToComponents = (jsx: string): ComponentDefinition[] => {
  const components: ComponentDefinition[] = [];
  
  // Simple regex-based parsing for common patterns
  // This is a basic implementation - in production, you'd want a proper JSX parser
  
  // Remove extra whitespace and normalize
  const cleanJSX = jsx.replace(/\s+/g, ' ').trim();
  
  // Parse top-level components
  const topLevelComponents = extractTopLevelComponents(cleanJSX);
  
  topLevelComponents.forEach((componentString, index) => {
    const parsed = parseComponentString(componentString, index);
    if (parsed) {
      components.push(parsed);
    }
  });
  
  return components;
};

/**
 * Extract top-level components from JSX string
 */
const extractTopLevelComponents = (jsx: string): string[] => {
  const components: string[] = [];
  let currentComponent = '';
  let depth = 0;
  let i = 0;
  
  while (i < jsx.length) {
    const char = jsx[i];
    
    if (char === '<') {
      const nextChar = jsx[i + 1];
      if (nextChar === '/') {
        // Closing tag
        depth--;
        currentComponent += char;
      } else if (nextChar === '!') {
        // Comment or doctype, skip
        const endComment = jsx.indexOf('>', i);
        i = endComment;
        continue;
      } else {
        // Opening tag
        depth++;
        currentComponent += char;
      }
    } else {
      currentComponent += char;
    }
    
    // If we've closed all tags and have content, we have a complete component
    if (depth === 0 && currentComponent.trim()) {
      const trimmed = currentComponent.trim();
      if (trimmed.startsWith('<') && (trimmed.endsWith('>') || trimmed.endsWith('/>'))) {
        components.push(trimmed);
        currentComponent = '';
      }
    }
    
    i++;
  }
  
  // Add any remaining component
  if (currentComponent.trim()) {
    components.push(currentComponent.trim());
  }
  
  return components;
};

/**
 * Parse individual component string into ComponentDefinition
 */
const parseComponentString = (componentString: string, index: number): ComponentDefinition | null => {
  // Extract component type (including compound components like Card.Section)
  const typeMatch = componentString.match(/<([\w.]+)/);
  if (!typeMatch) return null;
  
  const type = typeMatch[1];
  const config = getComponentConfig(type);
  
  if (!config) {
    // Return a basic definition even for unknown components
    return {
      id: `${type.toLowerCase()}-${Date.now()}-${index}`,
      type,
      displayName: type,
      category: 'Unknown',
      props: {},
      children: []
    };
  }
  
  // Extract props
  const props = extractProps(componentString, config.defaultProps);
  
  // Extract children
  const children = extractChildren(componentString, index);
  
  return {
    id: `${type.toLowerCase()}-${Date.now()}-${index}`,
    type,
    displayName: config.displayName,
    category: config.category,
    props,
    children
  };
};

/**
 * Extract props from component string
 */
const extractProps = (componentString: string, defaultProps: Record<string, any>): Record<string, any> => {
  const props = { ...defaultProps };
  
  // Extract attributes using regex
  const attrRegex = /(\w+)=(?:"([^"]*)"|{([^}]*)}|(\w+))/g;
  let match;
  
  while ((match = attrRegex.exec(componentString)) !== null) {
    const [, propName, stringValue, jsValue, boolValue] = match;
    
    if (stringValue !== undefined) {
      props[propName] = stringValue;
    } else if (jsValue !== undefined) {
      // Try to parse JavaScript value
      try {
        props[propName] = JSON.parse(jsValue);
      } catch {
        // If parsing fails, treat as string
        props[propName] = jsValue;
      }
    } else if (boolValue !== undefined) {
      props[propName] = true;
    }
  }
  
  // Extract text content for components that support it
  const textContentMatch = componentString.match(/>([^<]+)</);
  if (textContentMatch && textContentMatch[1].trim()) {
    const textContent = textContentMatch[1].trim();
    if (!textContent.startsWith('<')) {
      props.children = textContent;
    }
  }
  
  return props;
};

/**
 * Extract children components
 */
const extractChildren = (componentString: string, parentIndex: number): ComponentDefinition[] => {
  // Check if component is self-closing
  if (componentString.endsWith('/>')) {
    return [];
  }
  
  // Extract content between opening and closing tags
  const contentMatch = componentString.match(/>(.+)</s);
  if (!contentMatch) return [];
  
  const content = contentMatch[1];
  
  // If content doesn't contain tags, it's just text
  if (!content.includes('<')) {
    return [];
  }
  
  // Recursively parse child components
  const childComponents = extractTopLevelComponents(content);
  const children: ComponentDefinition[] = [];
  
  childComponents.forEach((childString, index) => {
    const parsed = parseComponentString(childString, parentIndex * 100 + index);
    if (parsed) {
      children.push(parsed);
    }
  });
  
  return children;
};

/**
 * Validate components against the registry and collect warnings
 */
const validateComponents = (components: ComponentDefinition[], result: ParseResult): void => {
  const validateComponent = (component: ComponentDefinition) => {
    const config = getComponentConfig(component.type);
    
    if (!config) {
      result.warnings.push(`Component "${component.type}" is not in the Mantine component registry`);
      return;
    }
    
    // Validate props
    Object.keys(component.props).forEach(propName => {
      const propConfig = config.properties.find(p => p.name === propName);
      if (!propConfig) {
        result.warnings.push(`Property "${propName}" is not defined for ${component.type}`);
      }
    });
    
    // Recursively validate children
    if (component.children) {
      component.children.forEach(validateComponent);
    }
  };
  
  components.forEach(validateComponent);
};

/**
 * Create a simplified component structure for basic layouts
 */
export const createBasicLayout = (description: string): ComponentDefinition[] => {
  // This can be enhanced to create basic layouts based on keywords
  const lowerDesc = description.toLowerCase();
  
  if (lowerDesc.includes('button')) {
    return [{
      id: `button-${Date.now()}`,
      type: 'Button',
      displayName: 'Button',
      category: 'Inputs',
      props: {
        children: 'Click me',
        variant: 'filled',
        size: 'sm'
      }
    }];
  }
  
  if (lowerDesc.includes('form')) {
    return [
      {
        id: `stack-${Date.now()}`,
        type: 'Stack',
        displayName: 'Stack',
        category: 'Layout',
        props: { gap: 'md' },
        children: [
          {
            id: `textinput-${Date.now()}`,
            type: 'TextInput',
            displayName: 'Text Input',
            category: 'Inputs',
            props: {
              placeholder: 'Enter text...',
              label: 'Input Label'
            }
          },
          {
            id: `button-${Date.now()}`,
            type: 'Button',
            displayName: 'Button',
            category: 'Inputs',
            props: {
              children: 'Submit',
              variant: 'filled'
            }
          }
        ]
      }
    ];
  }
  
  // Default: simple container with text
  return [{
    id: `container-${Date.now()}`,
    type: 'Container',
    displayName: 'Container',
    category: 'Layout',
    props: { size: 'md' },
    children: [{
      id: `text-${Date.now()}`,
      type: 'Text',
      displayName: 'Text',
      category: 'Typography',
      props: {
        children: 'Generated component',
        size: 'md'
      }
    }]
  }];
};