/**
 * Component Registry Generator
 *
 * This module generates a component registry at build time.
 * The registry imports all discovered components from the user's component library
 * and makes them available for runtime JSX compilation in the production app.
 */

import fs from 'fs';
import path from 'path';
import { loadUserConfig } from './configLoader.js';
import { discoverComponents, DiscoveredComponent } from './componentDiscovery.js';
import { EnhancedComponentDiscovery, EnhancedComponent } from './enhancedComponentDiscovery.js';

export interface ComponentRegistryEntry {
  name: string;
  importPath: string;
  namedExport: boolean;
}

export interface ComponentRegistryConfig {
  importPath: string;
  components: ComponentRegistryEntry[];
  additionalImports?: Array<{
    path: string;
    components: string[];
  }>;
}

/**
 * Generate the component registry configuration from discovered components
 * Uses EnhancedComponentDiscovery for comprehensive component detection
 * including external NPM packages like @mantine/core, @chakra-ui/react, etc.
 */
export async function generateRegistryConfig(): Promise<ComponentRegistryConfig> {
  const config = loadUserConfig();

  // Use EnhancedComponentDiscovery for better external package support
  const discovery = new EnhancedComponentDiscovery(config);
  const enhancedComponents = await discovery.discoverAll();

  // Group components by their source/import path
  const componentsByPath = new Map<string, string[]>();

  for (const comp of enhancedComponents) {
    // Determine the import path for this component
    let importPath = config.importPath;

    // If component has a specific source path (for NPM packages), use that
    if (comp.source && comp.source.type === 'npm' && comp.source.path) {
      importPath = comp.source.path;
    }

    const existing = componentsByPath.get(importPath) || [];
    if (!existing.includes(comp.name)) {
      existing.push(comp.name);
    }
    componentsByPath.set(importPath, existing);
  }

  // Convert to registry entries
  const entries: ComponentRegistryEntry[] = [];
  for (const [importPath, components] of componentsByPath) {
    for (const compName of components) {
      entries.push({
        name: compName,
        importPath,
        namedExport: true,
      });
    }
  }

  // Add components from additionalImports (manual overrides)
  if (config.additionalImports) {
    for (const additionalImport of config.additionalImports) {
      for (const compName of additionalImport.components) {
        // Check if not already added
        if (!entries.find(e => e.name === compName && e.importPath === additionalImport.path)) {
          entries.push({
            name: compName,
            importPath: additionalImport.path,
            namedExport: true,
          });
        }
      }
    }
  }

  console.log(`📦 Registry config generated with ${entries.length} components from ${componentsByPath.size} source(s)`);

  return {
    importPath: config.importPath,
    components: entries,
    additionalImports: config.additionalImports,
  };
}

/**
 * Synchronous version for backward compatibility
 * Falls back to basic discovery if enhanced discovery fails
 */
export function generateRegistryConfigSync(): ComponentRegistryConfig {
  const config = loadUserConfig();
  const discoveredComponents = discoverComponents(config);

  const entries: ComponentRegistryEntry[] = discoveredComponents.map((comp: DiscoveredComponent) => ({
    name: comp.name,
    importPath: config.importPath,
    namedExport: true,
  }));

  // Add components from additionalImports
  if (config.additionalImports) {
    for (const additionalImport of config.additionalImports) {
      for (const compName of additionalImport.components) {
        entries.push({
          name: compName,
          importPath: additionalImport.path,
          namedExport: true,
        });
      }
    }
  }

  return {
    importPath: config.importPath,
    components: entries,
    additionalImports: config.additionalImports,
  };
}

/**
 * Generate the component registry TypeScript file content
 */
export function generateRegistryFileContent(registryConfig: ComponentRegistryConfig): string {
  // Group components by import path
  const componentsByPath = new Map<string, string[]>();

  for (const comp of registryConfig.components) {
    const existingComponents = componentsByPath.get(comp.importPath) || [];
    existingComponents.push(comp.name);
    componentsByPath.set(comp.importPath, existingComponents);
  }

  // Generate import statements
  const imports: string[] = [];
  const registryEntries: string[] = [];

  for (const [importPath, components] of componentsByPath) {
    const uniqueComponents = [...new Set(components)];
    imports.push(`import { ${uniqueComponents.join(', ')} } from '${importPath}';`);
    registryEntries.push(...uniqueComponents);
  }

  // Generate the registry file
  const content = `/**
 * Component Registry
 *
 * AUTO-GENERATED FILE - DO NOT EDIT
 * This file is generated at build time by story-ui
 *
 * It exports all components from your component library
 * for use in the live preview renderer.
 */

import React from 'react';
${imports.join('\n')}

// Component registry - maps component names to their implementations
export const componentRegistry: Record<string, React.ComponentType<any>> = {
  ${registryEntries.map(name => `${name}`).join(',\n  ')},
};

// List of available component names
export const availableComponents = ${JSON.stringify(registryEntries, null, 2)};

// Export React for use in compiled code
export { React };

// Helper to get a component by name
export function getComponent(name: string): React.ComponentType<any> | undefined {
  return componentRegistry[name];
}

// Check if a component exists
export function hasComponent(name: string): boolean {
  return name in componentRegistry;
}
`;

  return content;
}

/**
 * Generate the component registry file and write it to disk
 * Uses async EnhancedComponentDiscovery for comprehensive component detection
 */
export async function generateComponentRegistry(outputPath: string): Promise<void> {
  const registryConfig = await generateRegistryConfig();
  const content = generateRegistryFileContent(registryConfig);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`✅ Generated component registry with ${registryConfig.components.length} components`);
  console.log(`   Output: ${outputPath}`);
}

/**
 * Synchronous version for backward compatibility
 */
export function generateComponentRegistrySync(outputPath: string): void {
  const registryConfig = generateRegistryConfigSync();
  const content = generateRegistryFileContent(registryConfig);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`✅ Generated component registry with ${registryConfig.components.length} components`);
  console.log(`   Output: ${outputPath}`);
}

/**
 * Generate a minimal registry for development/testing
 */
export function generateMinimalRegistry(
  importPath: string,
  componentNames: string[],
  outputPath: string
): void {
  const registryConfig: ComponentRegistryConfig = {
    importPath,
    components: componentNames.map(name => ({
      name,
      importPath,
      namedExport: true,
    })),
  };

  const content = generateRegistryFileContent(registryConfig);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf-8');
}
