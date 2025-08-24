import type { ComponentDefinition } from '../types/index';

/**
 * Parses JSX/React story content into Visual Builder ComponentDefinition format
 */

interface ParseResult {
  components: ComponentDefinition[];
  errors: string[];
  warnings: string[];
}

// Component type mappings from JSX to Visual Builder format
const COMPONENT_TYPE_MAP: Record<string, string> = {
  'Container': 'Container',
  'Stack': 'Stack',
  'SimpleGrid': 'SimpleGrid',
  'Card': 'Card',
  'Card.Section': 'CardSection',
  'Image': 'Image',
  'Text': 'Text',
  'Title': 'Title',
  'Badge': 'Badge',
  'Button': 'Button',
  'Group': 'Group',
  'Avatar': 'Avatar',
  'div': 'Box',
  'span': 'Text',
  // Add more mappings as needed
};

// Category mappings for Visual Builder
const COMPONENT_CATEGORIES: Record<string, string> = {
  'Container': 'Layout',
  'Stack': 'Layout',
  'SimpleGrid': 'Layout',
  'Group': 'Layout',
  'Box': 'Layout',
  'Card': 'Data Display',
  'CardSection': 'Data Display',
  'Image': 'Data Display',
  'Avatar': 'Data Display',
  'Text': 'Typography',
  'Title': 'Typography',
  'Badge': 'Feedback',
  'Button': 'Inputs',
};

/**
 * Extracts JSX from a React story component render function
 */
export function extractJSXFromStory(storyCode: string): string {
  try {
    console.log('🔍 Extracting JSX from story code:', {
      length: storyCode.length,
      hasTransformed: storyCode.includes('__vite__') || storyCode.includes('_jsxDEV'),
      preview: storyCode.substring(0, 300) + '...'
    });
    
    // Check for Vite-transformed code and reject it
    if (storyCode.includes('__vite__cjsImport') || storyCode.includes('_jsxDEV') || storyCode.includes('import.meta.hot')) {
      console.error('❌ Detected Vite-transformed code - cannot parse');
      throw new Error('Received Vite-transformed code instead of source code. Cannot parse transformed JSX.');
    }
    
    // Check if this is the placeholder template
    if (storyCode.includes('Component ready for editing in Visual Builder')) {
      console.error('❌ Detected placeholder template - source code fetch failed');
      throw new Error('Received placeholder template instead of actual story source. Please check if the Story UI server is running correctly.');
    }
    
    // Match the render function and extract its return JSX
    const renderMatch = storyCode.match(/render:\s*\(\)\s*=>\s*\(([\s\S]*?)\)\s*[,}]/);
    if (renderMatch) {
      console.log('✅ Found JSX in render function');
      return renderMatch[1].trim();
    }

    // Fallback: try to find JSX in return statement
    const returnMatch = storyCode.match(/return\s*\(([\s\S]*?)\);?\s*}/);
    if (returnMatch) {
      console.log('✅ Found JSX in return statement');
      return returnMatch[1].trim();
    }

    // Fallback: try to find JSX after => without parentheses
    const arrowMatch = storyCode.match(/=>\s*([<][\s\S]*?)(?=;|\n|$)/);
    if (arrowMatch) {
      console.log('✅ Found JSX after arrow function');
      return arrowMatch[1].trim();
    }

    // Fallback: try to find JSX in parentheses after =>
    const arrowParenMatch = storyCode.match(/=>\s*\(([\s\S]*?)\)/);
    if (arrowParenMatch) {
      console.log('✅ Found JSX in parentheses after arrow');
      return arrowParenMatch[1].trim();
    }

    console.warn('⚠️ No JSX pattern matched, returning original code');
    return storyCode;
  } catch (error) {
    console.error('❌ Error extracting JSX from story:', error);
    throw error;
  }
}

/**
 * Parses JSX attributes into props object
 */
function parseAttributes(attributeString: string): Record<string, any> {
  const props: Record<string, any> = {};
  
  if (!attributeString.trim()) {
    return props;
  }

  try {
    // Improved attribute parsing to handle nested braces in style objects
    const parseAttributeString = (str: string) => {
      const attrs = [];
      let current = '';
      let braceDepth = 0;
      let inQuotes = false;
      let quoteChar = '';
      
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        
        if (!inQuotes) {
          if (char === '"' || char === "'") {
            inQuotes = true;
            quoteChar = char;
          } else if (char === '{') {
            braceDepth++;
          } else if (char === '}') {
            braceDepth--;
          } else if (char === ' ' && braceDepth === 0 && current && current.includes('=')) {
            attrs.push(current);
            current = '';
            continue;
          }
        } else if (char === quoteChar && str[i - 1] !== '\\') {
          inQuotes = false;
          quoteChar = '';
        }
        
        current += char;
      }
      
      if (current) {
        attrs.push(current);
      }
      
      return attrs;
    };
    
    const attributes = parseAttributeString(attributeString);
    
    for (const attr of attributes) {
      if (!attr.trim()) continue;
      
      const eqIndex = attr.indexOf('=');
      if (eqIndex === -1) {
        // Boolean attribute
        props[attr.trim()] = true;
        continue;
      }
      
      const key = attr.substring(0, eqIndex).trim();
      let value = attr.substring(eqIndex + 1).trim();
      
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
        props[key] = value;
      } else if (value.startsWith('{') && value.endsWith('}')) {
        // Handle JSX expressions
        const expression = value.slice(1, -1);
        
        // Special handling for style prop - parse as object
        if (key === 'style' && expression.startsWith('{') && expression.endsWith('}')) {
          try {
            // Parse style object - convert JS object syntax to JSON
            const styleStr = expression.slice(1, -1); // Remove outer braces
            const jsonStr = styleStr
              .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Quote keys
              .replace(/'/g, '"'); // Single to double quotes
            
            console.log('🎨 Parsing style:', { original: expression, converted: jsonStr });
            
            // Try to parse as JSON
            const parsedStyle = JSON.parse(`{${jsonStr}}`);
            
            // Sanitize arrays in style properties
            const sanitizedStyle: Record<string, any> = {};
            for (const [styleProp, styleValue] of Object.entries(parsedStyle)) {
              if (Array.isArray(styleValue)) {
                // Convert array to string using first value
                sanitizedStyle[styleProp] = String(styleValue[0]);
              } else {
                sanitizedStyle[styleProp] = styleValue;
              }
            }
            
            props[key] = sanitizedStyle;
            console.log('✅ Successfully parsed style object:', props[key]);
          } catch (e) {
            // If JSON parsing fails, try to parse manually
            const styleObj: Record<string, any> = {};
            const stylePairs = expression.slice(1, -1).split(',');
            
            for (const pair of stylePairs) {
              const colonIndex = pair.indexOf(':');
              if (colonIndex > -1) {
                const styleProp = pair.substring(0, colonIndex).trim().replace(/['"]/g, '');
                let styleValue: any = pair.substring(colonIndex + 1).trim();
                
                // Check if value looks like an array (e.g., "[14, 16, 18]")
                if (styleValue.startsWith('[') && styleValue.endsWith(']')) {
                  // Extract first value from array
                  const arrayContent = styleValue.slice(1, -1).split(',')[0].trim();
                  styleValue = arrayContent;
                }
                
                // Remove quotes if present
                if ((styleValue.startsWith('"') && styleValue.endsWith('"')) ||
                    (styleValue.startsWith("'") && styleValue.endsWith("'"))) {
                  styleValue = styleValue.slice(1, -1);
                } else if (/^\d+$/.test(styleValue)) {
                  // Preserve numeric values as numbers
                  styleValue = parseInt(styleValue, 10);
                } else if (/^\d*\.\d+$/.test(styleValue)) {
                  // Preserve decimal values as numbers
                  styleValue = parseFloat(styleValue);
                } else {
                  // Remove any remaining quotes
                  styleValue = styleValue.replace(/['"]/g, '');
                }
                
                // Convert camelCase to kebab-case for CSS properties if needed
                // But keep camelCase for React style props
                styleObj[styleProp] = styleValue;
              }
            }
            
            props[key] = styleObj;
          }
        } else if (expression === 'true' || expression === 'false') {
          props[key] = expression === 'true';
        } else if (/^\d+$/.test(expression)) {
          props[key] = parseInt(expression, 10);
        } else if (/^\d*\.\d+$/.test(expression)) {
          props[key] = parseFloat(expression);
        } else if (expression.startsWith('"') && expression.endsWith('"')) {
          props[key] = expression.slice(1, -1);
        } else {
          // Keep as string for complex expressions
          props[key] = expression;
        }
      } else {
        props[key] = value;
      }
    }
  } catch (error) {
    console.error('Error parsing attributes:', error);
  }
  
  return props;
}

/**
 * Token for JSX parsing state machine
 */
interface JSXToken {
  type: 'tag_open' | 'tag_close' | 'tag_self_close' | 'text' | 'comment';
  content: string;
  tagName?: string;
  attributes?: string;
  position: { start: number; end: number };
}

/**
 * Advanced JSX tokenizer that properly handles nested structures
 */
function tokenizeJSX(jsx: string): JSXToken[] {
  const tokens: JSXToken[] = [];
  let i = 0;
  
  while (i < jsx.length) {
    // Skip whitespace at the beginning
    while (i < jsx.length && /\s/.test(jsx[i])) {
      i++;
    }
    
    if (i >= jsx.length) break;
    
    // Handle JSX elements
    if (jsx[i] === '<') {
      const tokenStart = i;
      i++; // skip '<'
      
      // Check for comment
      if (jsx.substring(i, i + 3) === '!--') {
        // Skip comment
        const commentEnd = jsx.indexOf('-->', i);
        if (commentEnd !== -1) {
          i = commentEnd + 3;
          continue;
        }
      }
      
      // Check for closing tag
      const isClosingTag = jsx[i] === '/';
      if (isClosingTag) {
        i++; // skip '/'
      }
      
      // Extract tag name
      let tagName = '';
      while (i < jsx.length && /[a-zA-Z0-9._]/.test(jsx[i])) {
        tagName += jsx[i];
        i++;
      }
      
      if (!tagName) {
        i++; // skip invalid character
        continue;
      }
      
      // Handle closing tag
      if (isClosingTag) {
        // Skip to closing >
        while (i < jsx.length && jsx[i] !== '>') {
          i++;
        }
        if (jsx[i] === '>') i++;
        
        tokens.push({
          type: 'tag_close',
          content: jsx.substring(tokenStart, i),
          tagName,
          position: { start: tokenStart, end: i }
        });
        continue;
      }
      
      // Extract attributes for opening tag
      let attributes = '';
      let inString = false;
      let stringChar = '';
      let braceDepth = 0;
      
      while (i < jsx.length) {
        const char = jsx[i];
        
        if (!inString) {
          if (char === '"' || char === "'") {
            inString = true;
            stringChar = char;
          } else if (char === '{') {
            braceDepth++;
          } else if (char === '}') {
            braceDepth--;
          } else if (char === '>' && braceDepth === 0) {
            break; // Found end of opening tag
          } else if (char === '/' && jsx[i + 1] === '>' && braceDepth === 0) {
            // Self-closing tag
            break;
          }
        } else if (char === stringChar && jsx[i - 1] !== '\\') {
          inString = false;
          stringChar = '';
        }
        
        attributes += char;
        i++;
      }
      
      // Check for self-closing tag
      const isSelfClosing = jsx[i] === '/' && jsx[i + 1] === '>';
      if (isSelfClosing) {
        i += 2; // skip '/>'
        tokens.push({
          type: 'tag_self_close',
          content: jsx.substring(tokenStart, i),
          tagName,
          attributes: attributes.trim(),
          position: { start: tokenStart, end: i }
        });
      } else if (jsx[i] === '>') {
        i++; // skip '>'
        tokens.push({
          type: 'tag_open',
          content: jsx.substring(tokenStart, i),
          tagName,
          attributes: attributes.trim(),
          position: { start: tokenStart, end: i }
        });
      }
      
    } else {
      // Handle text content
      const textStart = i;
      let textContent = '';
      
      while (i < jsx.length && jsx[i] !== '<') {
        textContent += jsx[i];
        i++;
      }
      
      const trimmedText = textContent.trim();
      if (trimmedText) {
        tokens.push({
          type: 'text',
          content: trimmedText,
          position: { start: textStart, end: i }
        });
      }
    }
  }
  
  return tokens;
}

/**
 * Recursively parses JSX tokens into ComponentDefinition tree using stack-based approach
 */
function parseJSXElement(jsx: string, idCounter: { value: number }): ComponentDefinition[] {
  const components: ComponentDefinition[] = [];
  
  try {
    jsx = jsx.trim();
    if (!jsx) return components;
    
    // Handle pure text content
    if (!jsx.startsWith('<')) {
      const textContent = jsx.replace(/^\{|\}$/g, '').trim();
      if (textContent && textContent !== '') {
        components.push({
          id: `text-${idCounter.value++}`,
          type: 'Text',
          displayName: 'Text',
          category: 'Typography',
          props: {
            children: textContent.replace(/^["']|["']$/g, '')
          }
        });
      }
      return components;
    }
    
    // Tokenize the JSX
    const tokens = tokenizeJSX(jsx);
    
    console.log('🔍 Tokenized JSX:', tokens.map(t => `${t.type}:${t.tagName || t.content?.substring(0, 20)}`));
    
    // Use corrected stack-based parsing to build component tree
    const parseStack: ComponentDefinition[] = [];
    const childrenStack: ComponentDefinition[][] = [];
    let currentChildren: ComponentDefinition[] = [];
    
    for (const token of tokens) {
      console.log(`🔧 Processing token: ${token.type} - ${token.tagName || token.content?.substring(0, 30)}`);
      
      switch (token.type) {
        case 'tag_open': {
          // Create new component
          const tagName = token.tagName!;
          const componentType = COMPONENT_TYPE_MAP[tagName] || tagName;
          const category = COMPONENT_CATEGORIES[componentType] || 'Other';
          const props = parseAttributes(token.attributes || '');
          
          const component: ComponentDefinition = {
            id: `${componentType.toLowerCase().replace('.', '-')}-${idCounter.value++}`,
            type: componentType,
            displayName: componentType,
            category,
            props
          };
          
          console.log(`📦 Created component: ${component.type} (${component.id})`);
          
          // Push current state onto stack before processing this component
          if (parseStack.length > 0 || currentChildren.length > 0) {
            parseStack.push(component);
            childrenStack.push(currentChildren);
            currentChildren = [];
            console.log(`📚 Pushed to stack. Stack depth: ${parseStack.length}`);
          } else {
            // This is a potential root component
            parseStack.push(component);
            childrenStack.push([]);
            currentChildren = [];
            console.log(`🌳 Started root component: ${component.type}`);
          }
          break;
        }
        
        case 'tag_self_close': {
          // Create self-closing component
          const tagName = token.tagName!;
          const componentType = COMPONENT_TYPE_MAP[tagName] || tagName;
          const category = COMPONENT_CATEGORIES[componentType] || 'Other';
          const props = parseAttributes(token.attributes || '');
          
          const component: ComponentDefinition = {
            id: `${componentType.toLowerCase().replace('.', '-')}-${idCounter.value++}`,
            type: componentType,
            displayName: componentType,
            category,
            props
          };
          
          console.log(`🏷️  Created self-closing: ${component.type} (${component.id})`);
          
          // Add to current children
          currentChildren.push(component);
          console.log(`👶 Added to current children. Children count: ${currentChildren.length}`);
          break;
        }
        
        case 'tag_close': {
          // Complete current component and pop from stack
          if (parseStack.length > 0) {
            const completedComponent = parseStack.pop()!;
            const parentChildren = childrenStack.pop()!;
            
            // Assign accumulated children to the completed component
            if (currentChildren.length > 0) {
              completedComponent.children = [...currentChildren];
              console.log(`✅ Assigned ${currentChildren.length} children to ${completedComponent.type}`);
            }
            
            console.log(`🔚 Completing component: ${completedComponent.type} with ${completedComponent.children?.length || 0} children`);
            
            // Add completed component to parent's children or root
            if (parseStack.length > 0) {
              // Add to parent's children (which becomes new currentChildren)
              currentChildren = parentChildren;
              currentChildren.push(completedComponent);
              console.log(`👨‍👩‍👧‍👦 Added ${completedComponent.type} to parent children. Parent children count: ${currentChildren.length}`);
            } else {
              // This is a root component
              components.push(completedComponent);
              currentChildren = parentChildren;
              console.log(`🌳 Added root component: ${completedComponent.type}`);
            }
          }
          break;
        }
        
        case 'text': {
          // Handle text content
          const textContent = token.content.replace(/^\{|\}$/g, '').trim();
          if (textContent && textContent.length > 0) {
            // Check if this text should be inline content for the current component
            if (parseStack.length > 0 && !parseStack[parseStack.length - 1].children) {
              // Add as inline text content to the current component
              parseStack[parseStack.length - 1].props.children = textContent.replace(/^["']|["']$/g, '');
              console.log(`📝 Added inline text to ${parseStack[parseStack.length - 1].type}: "${textContent.substring(0, 30)}..."`);
            } else {
              // Create a text component
              const textComponent: ComponentDefinition = {
                id: `text-${idCounter.value++}`,
                type: 'Text',
                displayName: 'Text', 
                category: 'Typography',
                props: {
                  children: textContent.replace(/^["']|["']$/g, '')
                }
              };
              
              currentChildren.push(textComponent);
              console.log(`📄 Created text component: "${textContent.substring(0, 30)}..."`);
            }
          }
          break;
        }
      }
    }
    
    // Handle any remaining components on stack (error recovery)
    while (parseStack.length > 0) {
      const orphanComponent = parseStack.pop()!;
      childrenStack.pop();
      
      if (currentChildren.length > 0) {
        orphanComponent.children = [...currentChildren];
        currentChildren = [];
      }
      
      components.push(orphanComponent);
      console.log(`🚨 Recovered orphan component: ${orphanComponent.type}`);
    }
    
    console.log(`✨ Parsing complete. Generated ${components.length} root components.`);
    
  } catch (error) {
    console.error('❌ Error parsing JSX elements:', error);
  }
  
  return components;
}

/**
 * Helper function to get original JSX tag name from component type
 */
function getOriginalTagName(componentType: string): string {
  // Handle the reverse mapping more reliably
  const reverseMap: Record<string, string> = {
    'Container': 'Container',
    'Stack': 'Stack',
    'SimpleGrid': 'SimpleGrid',
    'Card': 'Card',
    'CardSection': 'Card.Section',
    'Image': 'Image',
    'Text': 'Text',
    'Title': 'Title',
    'Badge': 'Badge',
    'Button': 'Button',
    'Group': 'Group',
    'Avatar': 'Avatar',
    'Box': 'div'
  };
  
  return reverseMap[componentType] || componentType;
}

/**
 * Parses a single JSX element into ComponentDefinition - now handles proper nesting
 */
function parseSingleJSXElement(jsx: string, idCounter: { value: number }): ComponentDefinition | null {
  try {
    jsx = jsx.trim();
    
    // Use the new tokenized approach for single elements too
    const tokens = tokenizeJSX(jsx);
    
    if (tokens.length === 0) {
      return null;
    }
    
    // For single elements, we should have at most one opening tag and one closing tag
    const firstToken = tokens[0];
    
    if (firstToken.type === 'tag_self_close') {
      // Self-closing tag
      const tagName = firstToken.tagName!;
      const componentType = COMPONENT_TYPE_MAP[tagName] || tagName;
      const category = COMPONENT_CATEGORIES[componentType] || 'Other';
      const props = parseAttributes(firstToken.attributes || '');
      
      return {
        id: `${componentType.toLowerCase()}-${idCounter.value++}`,
        type: componentType,
        displayName: componentType,
        category,
        props
      };
    } else if (firstToken.type === 'tag_open') {
      // Opening tag - parse the full structure
      const components = parseJSXElement(jsx, idCounter);
      return components.length > 0 ? components[0] : null;
    }
    
    return null;
    
  } catch (error) {
    console.error('Error parsing single JSX element:', error);
    return null;
  }
}

/**
 * Main function to parse Story UI content into Visual Builder format
 */
export function parseStoryUIToBuilder(storyCode: string): ParseResult {
  const result: ParseResult = {
    components: [],
    errors: [],
    warnings: []
  };
  
  try {
    console.log('🚀 Starting to parse story code for Visual Builder', {
      codeLength: storyCode.length,
      hasCard: storyCode.includes('<Card'),
      hasCardSection: storyCode.includes('Card.Section'),
      hasBadge: storyCode.includes('<Badge'),
      hasStack: storyCode.includes('<Stack'),
      hasImage: storyCode.includes('<Image'),
      firstLine: storyCode.split('\n')[0],
      preview: storyCode.substring(0, 300)
    });
    
    // Check for placeholder template
    if (storyCode.includes('Component ready for editing in Visual Builder')) {
      const error = '⚠️ Received placeholder template instead of actual story source. The source code was not properly fetched from the server.';
      console.error('❌ Placeholder template detected');
      result.errors.push(error);
      return result;
    }
    
    // Check for transformed code early and provide clear error
    if (storyCode.includes('__vite__cjsImport') || storyCode.includes('_jsxDEV') || storyCode.includes('import.meta.hot')) {
      const error = 'Visual Builder received Vite-transformed code instead of source code. Please ensure the raw source endpoint is working correctly.';
      console.error('❌', error);
      result.errors.push(error);
      return result;
    }
    
    // Extract JSX from the story
    const jsx = extractJSXFromStory(storyCode);
    console.log('📝 Extracted JSX:', {
      hasJSX: !!jsx,
      jsxLength: jsx?.length || 0,
      jsxPreview: jsx?.substring(0, 200)
    });
    
    if (!jsx) {
      result.errors.push('No JSX content found in story');
      return result;
    }
    
    console.log('📝 Extracted JSX:', jsx.substring(0, 200) + '...');
    
    // Parse JSX into component tree
    const idCounter = { value: 1 };
    const components = parseJSXElement(jsx, idCounter);
    
    if (components.length === 0) {
      result.warnings.push('No components were parsed from the JSX');
    } else {
      console.log(`✅ Successfully parsed ${components.length} components`);
    
    // Log component structure for debugging
    const logComponentStructure = (comps: ComponentDefinition[], depth = 0) => {
      comps.forEach(comp => {
        console.log(`${'  '.repeat(depth)}📦 ${comp.type} (${comp.id}) - children: ${comp.children?.length || 0}`);
        if (comp.children?.length) {
          logComponentStructure(comp.children, depth + 1);
        }
      });
    };
    
    console.log('🌳 Component tree structure:');
    logComponentStructure(components);
    }
    
    result.components = components;
    
    // Add some warnings for unsupported features
    if (jsx.includes('style={{')) {
      result.warnings.push('Inline styles detected - these may not be fully preserved in Visual Builder');
    }
    
    if (jsx.includes('onClick') || jsx.includes('onHover') || jsx.includes('on[A-Z]')) {
      result.warnings.push('Event handlers detected - these will need to be reconfigured in Visual Builder');
    }
    
    if (jsx.includes('import.meta') || jsx.includes('__vite__')) {
      result.errors.push('Transformed code detected in JSX - parsing may be unreliable');
    }
    
  } catch (error) {
    const errorMessage = `Failed to parse story: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error('❌ Parse error:', errorMessage);
    result.errors.push(errorMessage);
  }
  
  return result;
}

/**
 * Utility function to validate parsed components
 */
export function validateParsedComponents(components: ComponentDefinition[]): string[] {
  const issues: string[] = [];
  
  function validateComponent(component: ComponentDefinition, path: string): void {
    if (!component.id) {
      issues.push(`Component at ${path} is missing an ID`);
    }
    
    if (!component.type) {
      issues.push(`Component at ${path} is missing a type`);
    }
    
    if (!COMPONENT_CATEGORIES[component.type] && component.type !== 'Text') {
      issues.push(`Component type "${component.type}" at ${path} is not recognized`);
    }
    
    if (component.children) {
      component.children.forEach((child, index) => {
        validateComponent(child, `${path}.children[${index}]`);
      });
    }
  }
  
  components.forEach((component, index) => {
    validateComponent(component, `components[${index}]`);
  });
  
  console.log(`🔍 Validation complete: ${issues.length} issues found`, issues);
  return issues;
}

/**
 * Utility function to detect if code is Vite-transformed
 */
export function isViteTransformedCode(code: string): boolean {
  const transformedIndicators = [
    '__vite__cjsImport',
    '_jsxDEV',
    'import.meta.hot',
    '__vite__updateStyle',
    '__vite_ssr_',
    'createHotContext'
  ];
  
  return transformedIndicators.some(indicator => code.includes(indicator));
}

/**
 * Enhanced story name extraction that handles multiple story formats
 */
export function extractStoryName(storyCode: string): string {
  console.log('🔍 Extracting story name from code...');
  
  // Method 1: Extract from story title property (title: "My Story") - HIGHEST PRIORITY
  const titleMatch = storyCode.match(/title:\s*['"]([^'"]+)['"]/);
  if (titleMatch && titleMatch[1]) {
    console.log(`✅ Found title property: "${titleMatch[1]}"`);
    return titleMatch[1];
  }
  
  // Method 2: Extract from meta title (export default { title: "My Story" })
  const metaTitleMatch = storyCode.match(/export\s+default\s*{[^}]*title:\s*['"]([^'"]+)['"]/);
  if (metaTitleMatch && metaTitleMatch[1]) {
    console.log(`✅ Found meta title: "${metaTitleMatch[1]}"`);
    return metaTitleMatch[1];
  }
  
  // Method 3: Extract from comment annotation (// @title My Story)
  const commentMatch = storyCode.match(/\/\/\s*@title\s+(.+)/);
  if (commentMatch && commentMatch[1]) {
    const title = commentMatch[1].trim();
    console.log(`✅ Found comment title: "${title}"`);
    return title;
  }
  
  // Method 4: Extract from JSDoc comment (@title My Story)
  const jsDocMatch = storyCode.match(/\*\s*@title\s+(.+)/);
  if (jsDocMatch && jsDocMatch[1]) {
    const title = jsDocMatch[1].trim();
    console.log(`✅ Found JSDoc title: "${title}"`);
    return title;
  }
  
  // Method 5: Extract from export const statement (e.g., export const MyStory = {...})
  const exportMatch = storyCode.match(/export\s+const\s+(\w+)\s*=/);
  if (exportMatch && exportMatch[1]) {
    const rawName = exportMatch[1];
    // Convert PascalCase or camelCase to readable format, but keep it clean
    const readable = rawName
      .replace(/([A-Z])/g, ' $1')
      .replace(/^\s+/, '')
      .trim();
    console.log(`✅ Found export const name: "${rawName}" → "${readable}"`);
    return readable;
  }
  
  // Method 6: Extract from component name in JSX (return <MyComponent />)
  const componentMatch = storyCode.match(/return\s*\(?\s*<(\w+)/);
  if (componentMatch && componentMatch[1]) {
    const componentName = componentMatch[1];
    // Only use this if it's not a generic HTML element
    if (!['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(componentName.toLowerCase())) {
      const readable = componentName
        .replace(/([A-Z])/g, ' $1')
        .replace(/^\s+/, '')
        .trim();
      console.log(`✅ Found component name: "${componentName}" → "${readable}"`);
      return readable;
    }
  }
  
  // Method 7: Extract from function name (export function MyStory())
  const functionMatch = storyCode.match(/export\s+function\s+(\w+)/);
  if (functionMatch && functionMatch[1]) {
    const funcName = functionMatch[1];
    const readable = funcName
      .replace(/([A-Z])/g, ' $1')
      .replace(/^\s+/, '')
      .trim();
    console.log(`✅ Found function name: "${funcName}" → "${readable}"`);
    return readable;
  }
  
  console.log('❌ No story name found, using fallback');
  return 'Imported Story';
}

/**
 * Utility function to clean up code and provide helpful error messages
 */
export function preprocessStoryCode(code: string): { code: string; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  if (isViteTransformedCode(code)) {
    errors.push('Detected Vite-transformed code. Visual Builder requires original source code, not transformed modules.');
    return { code, warnings, errors };
  }
  
  // Check for common issues that might indicate problems
  if (code.length < 50) {
    warnings.push('Story code seems unusually short - this might indicate an incomplete source');
  }
  
  if (!code.includes('render:') && !code.includes('export')) {
    warnings.push('No render function or exports found - this might not be a valid story file');
  }
  
  return { code, warnings, errors };
}