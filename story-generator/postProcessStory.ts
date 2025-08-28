import { logger } from './logger.js';

/**
 * Post-process generated stories to fix common issues
 * This module is completely design-system agnostic
 */

export function postProcessStory(code: string, libraryPath: string): string {
  logger.log(`🔧 Post-processing story for library: ${libraryPath}`);

  let processedCode = code;

  // Fix CardSection to Card.Section mapping - CRITICAL for compound components
  processedCode = fixCompoundComponentMappings(processedCode, libraryPath);

  // Fix ANY component with children prop - ALWAYS convert to render function
  if (processedCode.includes('children: (')) {
    logger.log('🚨 Detected children prop in args - converting to render function');
    processedCode = convertLayoutToRenderFunction(processedCode);
  }

  // Leave inline styles as-is - let the AI use the available components naturally
  // Post-processing should be design-system agnostic
  if (processedCode.includes('style={{')) {
    logger.log('ℹ️  Inline styles detected - keeping as-is for design system agnosticism');
  }

  return processedCode;
}

/**
 * Fix compound component mappings (e.g., CardSection -> Card.Section)
 * This ensures the AI-generated components map to the correct compound component syntax
 */
function fixCompoundComponentMappings(code: string, libraryPath: string): string {
  let processedCode = code;
  
  // Define compound component mappings based on the library
  const compoundMappings = getCompoundMappingsForLibrary(libraryPath);
  
  let hasChanges = false;
  
  for (const [incorrectComponent, correctComponent] of compoundMappings) {
    // Fix JSX elements (both opening and closing tags)
    const openingTagRegex = new RegExp(`<${incorrectComponent}(\\s|>)`, 'g');
    const closingTagRegex = new RegExp(`</${incorrectComponent}>`, 'g');
    
    if (openingTagRegex.test(processedCode) || closingTagRegex.test(processedCode)) {
      processedCode = processedCode.replace(openingTagRegex, `<${correctComponent}$1`);
      processedCode = processedCode.replace(closingTagRegex, `</${correctComponent}>`);
      hasChanges = true;
      logger.log(`🔄 Fixed compound component mapping: ${incorrectComponent} → ${correctComponent}`);
    }
  }
  
  if (hasChanges) {
    logger.log('✅ Compound component mappings applied successfully');
  }
  
  return processedCode;
}

/**
 * Get compound component mappings for a specific library
 */
function getCompoundMappingsForLibrary(libraryPath: string): Map<string, string> {
  const mappings = new Map<string, string>();
  
  // Mantine-specific mappings
  if (libraryPath.includes('@mantine/core')) {
    mappings.set('CardSection', 'Card.Section');
    mappings.set('MenuTarget', 'Menu.Target');
    mappings.set('MenuDropdown', 'Menu.Dropdown');
    mappings.set('MenuLabel', 'Menu.Label');
    mappings.set('MenuItem', 'Menu.Item');
    mappings.set('MenuDivider', 'Menu.Divider');
    mappings.set('TabsList', 'Tabs.List');
    mappings.set('TabsTab', 'Tabs.Tab');
    mappings.set('TabsPanel', 'Tabs.Panel');
    mappings.set('AccordionItem', 'Accordion.Item');
    mappings.set('AccordionControl', 'Accordion.Control');
    mappings.set('AccordionPanel', 'Accordion.Panel');
    mappings.set('NavLinkSection', 'NavLink.Section');
  }
  
  // Add mappings for other design systems as needed
  // Ant Design example:
  if (libraryPath.includes('antd')) {
    mappings.set('CardMeta', 'Card.Meta');
    mappings.set('TableColumn', 'Table.Column');
    mappings.set('FormItem', 'Form.Item');
  }
  
  // Chakra UI example:
  if (libraryPath.includes('@chakra-ui')) {
    mappings.set('AccordionItem', 'Accordion.Item');
    mappings.set('AccordionButton', 'Accordion.Button');
    mappings.set('AccordionPanel', 'Accordion.Panel');
  }
  
  return mappings;
}

/**
 * Convert any layout story with children prop to use render function
 */
function convertLayoutToRenderFunction(code: string): string {
  // First, remove the component from meta if it's a layout
  let processedCode = code;
  
  // Find the meta object
  const metaMatch = code.match(/const meta = {([^}]+)}/s);
  if (metaMatch) {
    const metaContent = metaMatch[1];
    
    // If it has a component field, remove it for layouts
    if (metaContent.includes('component:')) {
      const newMetaContent = metaContent
        .split('\n')
        .filter(line => !line.includes('component:'))
        .join('\n');
      
      // Also fix the satisfies Meta type
      const metaWithType = `const meta = {${newMetaContent}} satisfies Meta;`;
      processedCode = code.replace(/const meta = {[^}]+} satisfies Meta(?:<[^>]+>)?;/s, metaWithType);
      
      logger.log('✅ Removed component from meta object');
    }
  }
  
  // Extract all stories with children prop
  const storyRegex = /export const (\w+): Story = {\s*args:\s*{\s*children:\s*\(\s*([\s\S]*?)\s*\)\s*}\s*};/g;
  let match;
  
  while ((match = storyRegex.exec(processedCode)) !== null) {
    const storyName = match[1];
    const childrenContent = match[2];
    
    // Build new story with render function
    const newStory = `export const ${storyName}: Story = {\n  render: () => (\n${childrenContent}\n  )\n};`;
    
    // Replace the old story with the new one
    processedCode = processedCode.replace(match[0], newStory);
    
    logger.log(`✅ Converted ${storyName} from children prop to render function`);
  }
  
  return processedCode;
}

/**
 * Convert a story with Alert children to multiple story exports
 */
function convertAlertChildrenToExports(code: string): string {
  // For now, return the code as-is
  logger.log('Alert conversion not yet implemented');
  return code;
}

/**
 * Convert a story with Toast children to multiple story exports
 */
function convertToastChildrenToExports(code: string): string {
  // For now, return the code as-is
  logger.log('Toast conversion not yet implemented');
  return code;
}