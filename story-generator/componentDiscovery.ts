import fs from 'fs';
import path from 'path';
import { ComponentConfig, StoryUIConfig } from '../story-ui.config.js';

export interface DiscoveredComponent {
  name: string;
  filePath: string;
  props: string[];
  description: string;
  category: 'layout' | 'content' | 'form' | 'navigation' | 'feedback' | 'other';
  slots?: string[];
  examples?: string[];
}

/**
 * Discovers components from a directory structure
 */
export function discoverComponentsFromDirectory(
  componentsPath: string,
  componentPrefix: string = ''
): DiscoveredComponent[] {
  if (!fs.existsSync(componentsPath)) {
    console.warn(`Components path does not exist: ${componentsPath}`);
    return [];
  }

  const components: DiscoveredComponent[] = [];
  const dirs = fs.readdirSync(componentsPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'generated' && !d.name.startsWith('.'));

  for (const dir of dirs) {
    const componentName = componentPrefix + dir.name;
    const componentPath = path.join(componentsPath, dir.name);

    // Look for story files to extract component information
    const storyFile = path.join(componentPath, `${dir.name}.stories.tsx`);
    const componentFile = path.join(componentPath, `${dir.name}.tsx`);

    let props: string[] = [];
    let description = '';
    let category: DiscoveredComponent['category'] = 'other';
    let slots: string[] = [];

    // Extract information from story file
    if (fs.existsSync(storyFile)) {
      const storyContent = fs.readFileSync(storyFile, 'utf-8');
      props = extractPropsFromStory(storyContent);
      description = extractDescriptionFromStory(storyContent);
    }

    // Extract information from component file
    if (fs.existsSync(componentFile)) {
      const componentContent = fs.readFileSync(componentFile, 'utf-8');
      if (!description) {
        description = extractDescriptionFromComponent(componentContent);
      }
      slots = extractSlotsFromComponent(componentContent);
    }

    // Categorize component based on name and content
    category = categorizeComponent(componentName, description);

    components.push({
      name: componentName,
      filePath: componentPath,
      props,
      description: description || `${componentName} component`,
      category,
      slots,
      examples: []
    });
  }

  return components;
}

/**
 * Discovers components from custom-elements.json (Web Components)
 */
export function discoverComponentsFromCustomElements(
  customElementsPath: string,
  componentPrefix: string = ''
): DiscoveredComponent[] {
  if (!fs.existsSync(customElementsPath)) {
    console.warn(`Custom elements file does not exist: ${customElementsPath}`);
    return [];
  }

  try {
    const customElements = JSON.parse(fs.readFileSync(customElementsPath, 'utf-8'));
    const components: DiscoveredComponent[] = [];

    if (customElements.modules) {
      for (const module of customElements.modules) {
        if (module.declarations) {
          for (const declaration of module.declarations) {
            if (declaration.kind === 'class' && declaration.customElement) {
              const componentName = componentPrefix + declaration.name;
              const props = declaration.members
                ?.filter((m: any) => m.kind === 'field' && m.privacy !== 'private')
                ?.map((m: any) => m.name) || [];

              components.push({
                name: componentName,
                filePath: module.path || '',
                props,
                description: declaration.description || `${componentName} component`,
                category: categorizeComponent(componentName, declaration.description || ''),
                slots: declaration.slots?.map((s: any) => s.name) || [],
                examples: []
              });
            }
          }
        }
      }
    }

    return components;
  } catch (error) {
    console.error('Error parsing custom-elements.json:', error);
    return [];
  }
}

/**
 * Discovers components from package.json exports or index files
 */
export function discoverComponentsFromPackage(
  packagePath: string,
  componentPrefix: string = ''
): DiscoveredComponent[] {
  const components: DiscoveredComponent[] = [];

  // Try to find index file
  const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  let indexPath: string | null = null;

  for (const indexFile of indexFiles) {
    const fullPath = path.join(packagePath, indexFile);
    if (fs.existsSync(fullPath)) {
      indexPath = fullPath;
      break;
    }
  }

  if (indexPath) {
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    const exportMatches = indexContent.match(/export\s+{\s*([^}]+)\s*}/g);

    if (exportMatches) {
      for (const match of exportMatches) {
        const exports = match.match(/export\s+{\s*([^}]+)\s*}/)?.[1];
        if (exports) {
          const exportItems = exports
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);

          for (const item of exportItems) {
            // Handle export aliases like "Input as TextInput"
            if (item.includes(' as ')) {
              const [, alias] = item.split(' as ').map(part => part.trim());
              if (alias && (!componentPrefix || alias.startsWith(componentPrefix))) {
                components.push({
                  name: alias,
                  filePath: indexPath,
                  props: [],
                  description: `${alias} component`,
                  category: categorizeComponent(alias, ''),
                  examples: []
                });
              }
            } else {
              // Regular export
              if (!componentPrefix || item.startsWith(componentPrefix)) {
                components.push({
                  name: item,
                  filePath: indexPath,
                  props: [],
                  description: `${item} component`,
                  category: categorizeComponent(item, ''),
                  examples: []
                });
              }
            }
          }
        }
      }
    }
  }

  return components;
}

/**
 * Main discovery function that tries multiple methods
 */
export function discoverComponents(config: StoryUIConfig): DiscoveredComponent[] {
  let components: DiscoveredComponent[] = [];

  // Try directory-based discovery first
  if (config.componentsPath) {
    components = discoverComponentsFromDirectory(config.componentsPath, config.componentPrefix);
  }

  // Fallback to custom elements if no components found
  if (components.length === 0 && config.componentsMetadataPath) {
    components = discoverComponentsFromCustomElements(config.componentsMetadataPath, config.componentPrefix);
  }

  // Fallback to package-based discovery
  if (components.length === 0 && config.componentsPath) {
    components = discoverComponentsFromPackage(config.componentsPath, config.componentPrefix);
  }

  return components;
}

// Helper functions
function extractPropsFromStory(content: string): string[] {
  const argTypesMatch = content.match(/argTypes:\s*{([\s\S]*?)}[,\n]/);
  if (argTypesMatch) {
    const argTypesBlock = argTypesMatch[1];
    return Array.from(argTypesBlock.matchAll(/([a-zA-Z0-9_]+):/g)).map(m => m[1]);
  }
  return [];
}

function extractDescriptionFromStory(content: string): string {
  const descMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (descMatch) {
    return descMatch[1].replace(/\*/g, '').trim();
  }
  return '';
}

function extractDescriptionFromComponent(content: string): string {
  const descMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (descMatch) {
    return descMatch[1].replace(/\*/g, '').trim();
  }
  return '';
}

function extractSlotsFromComponent(content: string): string[] {
  const slotMatches = content.match(/slot=['"]([^'"]+)['"]/g);
  if (slotMatches) {
    return slotMatches.map(match => match.match(/slot=['"]([^'"]+)['"]/)?.[1]).filter(Boolean) as string[];
  }
  return [];
}

function categorizeComponent(name: string, description: string): DiscoveredComponent['category'] {
  const lowerName = name.toLowerCase();
  const lowerDesc = description.toLowerCase();

  if (lowerName.includes('layout') || lowerName.includes('grid') || lowerName.includes('container') || lowerName.includes('section')) {
    return 'layout';
  }
  if (lowerName.includes('input') || lowerName.includes('form') || lowerName.includes('field') || lowerName.includes('select')) {
    return 'form';
  }
  if (lowerName.includes('nav') || lowerName.includes('menu') || lowerName.includes('breadcrumb') || lowerName.includes('tab')) {
    return 'navigation';
  }
  if (lowerName.includes('toast') || lowerName.includes('alert') || lowerName.includes('notification') || lowerName.includes('modal')) {
    return 'feedback';
  }
  if (lowerName.includes('button') || lowerName.includes('card') || lowerName.includes('heading') || lowerName.includes('text')) {
    return 'content';
  }

  return 'other';
}
