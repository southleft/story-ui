import { logger } from './logger.js';

/**
 * Interface for discovered component data
 * This matches the DiscoveredComponent interface from componentDiscovery.ts
 */
export interface ComponentInfo {
  name: string;
  filePath: string;
}

/**
 * Convert PascalCase to kebab-case
 * Used as fallback when component is not in discovery
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Normalize a file path for comparison
 * Removes leading ./ and trailing extensions
 */
function normalizePath(filePath: string): string {
  return filePath
    .replace(/^\.\//, '')           // Remove leading ./
    .replace(/\.(tsx?|jsx?|vue|svelte)$/, '');  // Remove extension
}

/**
 * Build a map of component names to their import paths
 * Uses actual discovery data rather than hardcoded patterns
 */
function buildComponentToImportMap(
  discoveredComponents: ComponentInfo[],
  componentsPath: string,
  importPath: string
): Map<string, string> {
  const componentMap = new Map<string, string>();

  // Normalize the componentsPath for comparison
  const normalizedComponentsPath = normalizePath(componentsPath);

  for (const component of discoveredComponents) {
    const normalizedFilePath = normalizePath(component.filePath);

    // Check if this component is from our configured components path
    if (normalizedFilePath.startsWith(normalizedComponentsPath)) {
      // Extract the relative path after componentsPath
      const relativePath = normalizedFilePath.slice(normalizedComponentsPath.length);
      // Remove leading slash if present
      const cleanRelativePath = relativePath.replace(/^\//, '');

      // Build the import path
      const componentImportPath = cleanRelativePath
        ? `${importPath}/${cleanRelativePath}`
        : importPath;

      componentMap.set(component.name, componentImportPath);
      logger.log(`[DISCOVERY] ${component.name} -> ${componentImportPath}`);
    }
  }

  return componentMap;
}

/**
 * Fix barrel imports to individual file imports
 * DESIGN-SYSTEM AGNOSTIC: Uses actual component discovery data
 *
 * Converts: import { Button, Card, CardHeader } from '@/components/ui';
 * To: import { Button } from '@/components/ui/button';
 *     import { Card, CardHeader } from '@/components/ui/card';
 *
 * @param code - The generated story code
 * @param importPath - The import path alias (e.g., '@/components/ui')
 * @param importStyle - Import style ('individual' or 'barrel')
 * @param componentsPath - Optional: Actual filesystem path (e.g., './src/components/ui')
 * @param discoveredComponents - Optional: Array of discovered components with file paths
 */
export function fixBarrelImports(
  code: string,
  importPath: string,
  importStyle?: string,
  componentsPath?: string,
  discoveredComponents?: ComponentInfo[]
): string {
  // Early return if not using individual imports
  if (importStyle !== 'individual') {
    return code;
  }

  logger.log('🔧 Fixing barrel imports to individual file imports (design-system agnostic)');
  logger.log(`[DEBUG] importPath: ${importPath}`);
  logger.log(`[DEBUG] componentsPath: ${componentsPath || 'not provided'}`);
  logger.log(`[DEBUG] discoveredComponents count: ${discoveredComponents?.length || 0}`);

  // Build component to import path mapping from discovery data
  let componentToImport: Map<string, string> | null = null;
  if (componentsPath && discoveredComponents && discoveredComponents.length > 0) {
    componentToImport = buildComponentToImportMap(discoveredComponents, componentsPath, importPath);
    logger.log(`[DEBUG] Built component map with ${componentToImport.size} entries`);
  }

  // Match imports from the barrel path (without a subpath)
  // e.g., import { Button, Card } from '@/components/ui';
  const barrelImportRegex = new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${escapeRegExp(importPath)}['"];?`,
    'g'
  );

  logger.log(`[DEBUG] regex pattern: ${barrelImportRegex.source}`);

  let processedCode = code;
  let match;
  let foundMatches = false;

  while ((match = barrelImportRegex.exec(code)) !== null) {
    foundMatches = true;
    const fullMatch = match[0];
    const componentList = match[1];

    logger.log(`[DEBUG] Found match: "${fullMatch}"`);
    logger.log(`[DEBUG] Component list: "${componentList}"`);

    // Parse component names
    const components = componentList
      .split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    logger.log(`[DEBUG] Parsed components: ${components.join(', ')}`);

    // Group components by their import path
    const groupedByImportPath = new Map<string, string[]>();

    for (const component of components) {
      let componentImportPath: string;

      if (componentToImport && componentToImport.has(component)) {
        // Use discovery-based mapping
        componentImportPath = componentToImport.get(component)!;
        logger.log(`[DISCOVERY] ${component} -> ${componentImportPath}`);
      } else {
        // Fallback: Use simple PascalCase to kebab-case conversion
        // This handles components not found in discovery
        const fileName = toKebabCase(component);
        componentImportPath = `${importPath}/${fileName}`;
        logger.log(`[FALLBACK] ${component} -> ${componentImportPath} (not in discovery)`);
      }

      if (!groupedByImportPath.has(componentImportPath)) {
        groupedByImportPath.set(componentImportPath, []);
      }
      groupedByImportPath.get(componentImportPath)!.push(component);
    }

    // Build individual imports
    const individualImports = Array.from(groupedByImportPath.entries())
      .map(([path, comps]) => {
        return `import { ${comps.join(', ')} } from '${path}';`;
      })
      .join('\n');

    logger.log(`[DEBUG] Replacement: "${individualImports}"`);

    // Replace the barrel import with individual imports
    processedCode = processedCode.replace(fullMatch, individualImports);
    logger.log(`✅ Converted barrel import to ${groupedByImportPath.size} individual import(s)`);
  }

  if (!foundMatches) {
    logger.log('[DEBUG] No barrel imports found to fix');
  }

  logger.log(`[DEBUG] First 500 chars of processed code: ${processedCode.substring(0, 500)}`);
  return processedCode;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Post-process generated stories to fix common issues
 * This module is completely design-system agnostic
 */

export function postProcessStory(code: string, libraryPath: string): string {
  logger.log(`🔧 Post-processing story for library: ${libraryPath}`);

  let processedCode = code;

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
