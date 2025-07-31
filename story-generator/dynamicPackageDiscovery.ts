import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

export interface RealPackageComponent {
  name: string;
  isComponent: boolean;
  type: 'function' | 'class' | 'object' | 'unknown';
  __componentPath?: string;
}

export interface PackageExports {
  components: RealPackageComponent[];
  allExports: string[];
  packageVersion: string;
}

/**
 * Dynamically discovers what components are actually available in an installed package
 */
export class DynamicPackageDiscovery {
  private packageName: string;
  private projectRoot: string;

  constructor(packageName: string, projectRoot: string = process.cwd()) {
    this.packageName = packageName;
    this.projectRoot = projectRoot;
  }

  /**
   * Get the real exports from the installed package
   */
  async getRealPackageExports(): Promise<PackageExports | null> {
    try {
      const packagePath = path.join(this.projectRoot, 'node_modules', this.packageName);

      if (!fs.existsSync(packagePath)) {
        console.warn(`Package ${this.packageName} not found in node_modules`);
        return null;
      }

      // Get package version
      const packageJsonPath = path.join(packagePath, 'package.json');
      let packageVersion = 'unknown';
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        packageVersion = packageJson.version || 'unknown';
      }

      // Try to require the package and inspect its exports
      const packageExports = await this.requirePackage(this.packageName);

      if (!packageExports) {
        logger.log(`🔄 Could not directly import ${this.packageName}, falling back to structure analysis`);
        // Don't return null here - fall back to structure discovery
      }

      const components: RealPackageComponent[] = [];
      let allExports: string[] = [];

      if (packageExports) {
        // Successfully imported package - analyze exports
        allExports = Object.keys(packageExports);

        for (const exportName of allExports) {
          const exportValue = packageExports[exportName];
          const component: RealPackageComponent = {
            name: exportName,
            isComponent: this.isLikelyComponent(exportName, exportValue),
            type: this.getExportType(exportValue),
            __componentPath: exportValue?.__componentPath
          };
          components.push(component);
        }

        // Check if we found any actual components
        const componentCount = components.filter(c => c.isComponent).length;
        logger.log(`📋 Found ${componentCount} components in main ${this.packageName} export`);

        // If no components found in main export, fall back to structure analysis
        if (componentCount === 0) {
          logger.log(`🔄 No components in main export, falling back to structure analysis for ${this.packageName}...`);
          const structureExports = this.discoverFromPackageStructure();

          if (structureExports) {
            const structureComponentNames = Object.keys(structureExports);
            logger.log(`📁 Structure analysis found ${structureComponentNames.length} components`);

            // Replace with structure-discovered components
            allExports = structureComponentNames;
            components.length = 0; // Clear the array

            for (const exportName of structureComponentNames) {
              const structureExport = structureExports[exportName];
              const component: RealPackageComponent = {
                name: exportName,
                isComponent: true, // Assume true since we filtered in structure discovery
                type: 'function',
                __componentPath: structureExport?.__componentPath
              };
              components.push(component);
            }
          }
        }
      } else {
        // Failed to import - fall back to structure analysis
        logger.log(`📁 Import failed, analyzing package structure for ${this.packageName}...`);
        const structureExports = this.discoverFromPackageStructure();

        if (structureExports) {
          allExports = Object.keys(structureExports);

          for (const exportName of allExports) {
            const structureExport = structureExports[exportName];
            const component: RealPackageComponent = {
              name: exportName,
              isComponent: true, // Assume true since we filtered in structure discovery
              type: 'function',
              __componentPath: structureExport?.__componentPath
            };
            components.push(component);
          }
        }
      }

      logger.log(`✅ Discovered ${components.filter(c => c.isComponent).length} components from ${this.packageName} v${packageVersion}`);

      return {
        components,
        allExports,
        packageVersion
      };
    } catch (error) {
      console.error(`Failed to discover exports from ${this.packageName}:`, error);
      return null;
    }
  }

  /**
   * Require the package safely
   */
  private async requirePackage(packageName: string): Promise<any> {
    try {
      // First try dynamic import (for ES modules)
      try {
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        const module = await dynamicImport(packageName);
        return module;
      } catch (importError) {
        // Check if this is a CSS import error (common with compiled design systems)
        const errorMessage = (importError as any)?.message || String(importError);
        if (errorMessage.includes('.css:') || errorMessage.includes('Unexpected token')) {
          logger.log(`🔄 ${packageName}: CSS detected, using static analysis (normal for design systems)`);
          return this.discoverFromPackageStructure();
        }
        
        if (errorMessage.includes('Invalid hook call') || errorMessage.includes('Hooks can only be called')) {
          logger.log(`🔄 ${packageName}: React hooks detected outside component context, using static analysis`);
          return this.discoverFromPackageStructure();
        }

        // Fall back to require (for CommonJS)
        // Create require from the project root's package.json to ensure correct module resolution
        const projectPackageJson = path.join(this.projectRoot, 'package.json');
        const require = createRequire(projectPackageJson);
        return require(packageName);
      }
    } catch (error) {
      // Check if this is a CSS import error
      const errorMessage = (error as any)?.message || String(error);
      if (errorMessage.includes('.css:') || errorMessage.includes('Unexpected token')) {
        logger.log(`🔄 ${packageName}: CSS detected, using static analysis (normal for design systems)`);
        return this.discoverFromPackageStructure();
      }

      if (errorMessage.includes('window is not defined')) {
        logger.log(`🔄 ${packageName}: Browser-only component, using static analysis`);
        return this.discoverFromPackageStructure();
      }
      
      if (errorMessage.includes('Invalid hook call') || errorMessage.includes('Hooks can only be called')) {
        logger.log(`🔄 ${packageName}: React hooks detected outside component context, using static analysis`);
        return this.discoverFromPackageStructure();
      }

      logger.log(`📋 ${packageName}: Dynamic import failed, using static analysis`);
      return this.discoverFromPackageStructure();
    }
  }

  /**
   * Determine if an export is likely a React component
   */
  private isLikelyComponent(name: string, value: any): boolean {
    // Skip obvious non-components
    if (this.isUtilityExport(name)) {
      return false;
    }

    // React components typically start with uppercase
    if (!/^[A-Z]/.test(name)) {
      return false;
    }

    // Check if it's a function or class (likely React component)
    const type = typeof value;
    if (type === 'function') {
      // Additional checks for React components
      return this.looksLikeReactComponent(name, value);
    }

    // Some components might be wrapped in objects
    if (type === 'object' && value !== null) {
      // Check if object has component-like properties
      return this.hasComponentLikeProperties(value);
    }

    return false;
  }

  /**
   * Check if a name indicates a utility export (not a component)
   */
  private isUtilityExport(name: string): boolean {
    const utilityPatterns = [
      /^use[A-Z]/, // hooks
      /^create[A-Z]/, // factory functions
      /^get[A-Z]/, // getter functions
      /^set[A-Z]/, // setter functions
      /^handle[A-Z]/, // handlers
      /^on[A-Z]/, // event handlers
      /Config$/,
      /Provider$/,
      /Context$/,
      /^default$/,
      /^DEFAULT_/,
      /^SUPPORTED_/,
      /^Key$/,
      /^DATA_/,
      /String$/,
      /ToHex$/,
      /ToRgb$/,
      /ToHsl$/,
      /ToHsb$/,
      /_SECRET_/,
      /Value$/
    ];

    return utilityPatterns.some(pattern => pattern.test(name));
  }

  /**
   * Check if a function looks like a React component
   */
  private looksLikeReactComponent(name: string, fn: Function): boolean {
    // Must start with uppercase
    if (!/^[A-Z]/.test(name)) {
      return false;
    }

    // Skip known utility functions
    if (this.isUtilityExport(name)) {
      return false;
    }

    // Check function signature - React components typically take props
    const fnString = fn.toString();

    // Skip if it looks like a utility function
    if (fnString.includes('function create') ||
        fnString.includes('function get') ||
        fnString.includes('function set') ||
        fnString.includes('function use')) {
      return false;
    }

    return true;
  }

  /**
   * Check if an object has component-like properties
   */
  private hasComponentLikeProperties(obj: any): boolean {
    // Some components are wrapped in objects with render methods or similar
    return (
      typeof obj.render === 'function' ||
      typeof obj.component === 'function' ||
      typeof obj.Component === 'function'
    );
  }

  /**
   * Get the type of an export
   */
  private getExportType(value: any): 'function' | 'class' | 'object' | 'unknown' {
    // Handle undefined/null values
    if (value === undefined || value === null) {
      return 'unknown';
    }

    const type = typeof value;

    if (type === 'function') {
      try {
        // Try to distinguish between function and class
        const fnString = value.toString();
        if (fnString.startsWith('class ') || /^function [A-Z]/.test(fnString)) {
          return 'class';
        }
        return 'function';
      } catch (error) {
        // Some functions might not have toString() available
        return 'function';
      }
    }

    if (type === 'object' && value !== null) {
      return 'object';
    }

    return 'unknown';
  }

  /**
   * Get only the component names that should be used for story generation
   */
  async getAvailableComponentNames(): Promise<string[]> {
    const exports = await this.getRealPackageExports();
    if (!exports) {
      return [];
    }

    return exports.components
      .filter(comp => comp.isComponent)
      .map(comp => comp.name)
      .sort();
  }

  /**
   * Validate that a list of component names are actually available
   */
  async validateComponentNames(componentNames: string[]): Promise<{
    valid: string[];
    invalid: string[];
    suggestions: Map<string, string>;
  }> {
    const availableComponents = await this.getAvailableComponentNames();
    const availableSet = new Set(availableComponents);

    const valid: string[] = [];
    const invalid: string[] = [];
    const suggestions = new Map<string, string>();

    for (const componentName of componentNames) {
      if (availableSet.has(componentName)) {
        valid.push(componentName);
      } else {
        invalid.push(componentName);

        // Try to find a similar component
        const suggestion = this.findSimilarComponent(componentName, availableComponents);
        if (suggestion) {
          suggestions.set(componentName, suggestion);
        }
      }
    }

    return { valid, invalid, suggestions };
  }

  /**
   * Find a similar component name
   */
  private findSimilarComponent(targetName: string, availableComponents: string[]): string | null {
    const targetLower = targetName.toLowerCase();

    // Direct substring matches
    for (const available of availableComponents) {
      const availableLower = available.toLowerCase();
      if (availableLower.includes(targetLower) || targetLower.includes(availableLower)) {
        return available;
      }
    }

    // Special case mappings for common mistakes
    const commonMappings: Record<string, string[]> = {
      'stack': ['BlockStack', 'InlineStack', 'LegacyStack'],
      'layout': ['Layout', 'Box'],
      'container': ['Box', 'Layout'],
      'grid': ['Grid', 'InlineGrid'],
      'text': ['Text'],
      'button': ['Button'],
      'card': ['Card', 'LegacyCard']
    };

    const mapping = commonMappings[targetLower];
    if (mapping) {
      for (const suggestion of mapping) {
        if (availableComponents.includes(suggestion)) {
          return suggestion;
        }
      }
    }

    return null;
  }

  /**
   * Alternative discovery method when package imports fail due to CSS
   * Analyzes package.json exports and TypeScript definitions
   */
  private discoverFromPackageStructure(): any {
    try {
      const packagePath = path.join(this.projectRoot, 'node_modules', this.packageName);
      const packageJsonPath = path.join(packagePath, 'package.json');

      if (!fs.existsSync(packageJsonPath)) {
        logger.log(`📦 No package.json found for ${this.packageName}`);
        return null;
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const exports: any = {};

      // Method 1: Analyze package.json exports field
      if (packageJson.exports) {
        logger.log(`📋 Analyzing exports field in ${this.packageName}/package.json`);
        this.extractExportsFromPackageJson(packageJson.exports, exports);
      }

      // Method 2: Look for index.d.ts or main TypeScript declarations
      const typingsPath = packageJson.types || packageJson.typings || './dist/types/index.d.ts';
      const fullTypingsPath = path.join(packagePath, typingsPath);

      if (fs.existsSync(fullTypingsPath)) {
        logger.log(`📋 Analyzing TypeScript declarations for ${this.packageName}`);
        this.extractExportsFromTypeDefinitions(fullTypingsPath, exports);
      }

      // Method 3: Scan for component subdirectories (for packages like Base Web)
      if (Object.keys(exports).length === 0) {
        logger.log(`📁 Scanning subdirectories for ${this.packageName} components...`);
        this.scanComponentSubdirectories(packagePath, exports);
      }


      return Object.keys(exports).length > 0 ? exports : null;

    } catch (error) {
      console.warn(`Alternative discovery failed for ${this.packageName}:`, error);
      return null;
    }
  }

  /**
   * Scan package subdirectories for components (e.g., antd/button, chakra-ui/input)
   */
  private scanComponentSubdirectories(packagePath: string, result: any): void {
    try {
      logger.log(`🔍 Scanning ${packagePath} for component subdirectories...`);
      const entries = fs.readdirSync(packagePath, { withFileTypes: true });
      logger.log(`📁 Found ${entries.length} entries in ${packagePath}`);

      let componentDirsFound = 0;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        componentDirsFound++;

        const subdirPath = path.join(packagePath, entry.name);
        const indexTypingsPath = path.join(subdirPath, 'index.d.ts');

        // Check if this subdirectory has an index.d.ts (likely a component)
        if (fs.existsSync(indexTypingsPath)) {
          try {
            const typingsContent = fs.readFileSync(indexTypingsPath, 'utf-8');

            // Look for component exports (functions/classes starting with uppercase)
            const componentExports = this.extractComponentsFromTypings(typingsContent);

            if (componentExports.length > 0) {
              logger.log(`📦 Found ${componentExports.length} components in ${entry.name}/`);

              // Add each component to the result
              for (const componentName of componentExports) {
                // Create a mock export function for this component
                result[componentName] = () => {};
                result[componentName].displayName = componentName;
                result[componentName].__componentPath = `${this.packageName}/${entry.name}`;
              }
            }
          } catch (error) {
            // Skip this subdirectory if we can't read its typings
            continue;
          }
        }
      }

      logger.log(`✅ Scanned ${componentDirsFound} component directories for ${this.packageName}`);
      logger.log(`📦 Total components found in subdirectories: ${Object.keys(result).length}`);
    } catch (error) {
      console.warn(`Failed to scan subdirectories for ${this.packageName}:`, error);
    }
  }

  /**
   * Extract component names from TypeScript declaration content
   */
  private extractComponentsFromTypings(content: string): string[] {
    const components: string[] = [];

    // Look for export statements with component-like names
    const exportRegex = /export\s+{\s*([^}]+)\s*}/g;
    const defaultExportRegex = /export\s+{\s*default\s+as\s+(\w+)\s*}/g;
    const namedExportRegex = /export\s+.*?\s+(\w+)\s*(?:,|$)/g;

    let match;

    // Extract from export { ... } statements
    while ((match = exportRegex.exec(content)) !== null) {
      const exportsList = match[1];
      const exports = exportsList.split(',').map(e => e.trim());

      for (const exp of exports) {
        // Handle "default as ComponentName" pattern
        const defaultAsMatch = exp.match(/default\s+as\s+(\w+)/);
        if (defaultAsMatch) {
          const componentName = defaultAsMatch[1];
          if (this.isComponentName(componentName)) {
            components.push(componentName);
          }
        } else {
          // Handle regular export names
          const cleanName = exp.replace(/\s+as\s+\w+/, '').trim();
          if (this.isComponentName(cleanName)) {
            components.push(cleanName);
          }
        }
      }
    }

    return [...new Set(components)]; // Remove duplicates
  }

  /**
   * Check if a name looks like a React component
   */
  private isComponentName(name: string): boolean {
    // Must start with uppercase letter
    if (!/^[A-Z]/.test(name)) return false;

    // Skip constants and utilities
    if (name.toUpperCase() === name) return false; // ALL_CAPS constants
    if (name.startsWith('Styled')) return false; // Styled components (usually internal)
    if (name.endsWith('Provider')) return false; // Context providers
    if (name.endsWith('Context')) return false; // React contexts
    if (name.endsWith('Type') || name.endsWith('Types')) return false; // Type definitions

    return true;
  }

  /**
   * Extract component exports from package.json exports field
   */
  private extractExportsFromPackageJson(exportsField: any, result: any): void {
    if (typeof exportsField === 'string') {
      // Simple export like "./dist/index.js"
      return;
    }

    if (typeof exportsField === 'object') {
      for (const [key, value] of Object.entries(exportsField)) {
        if (key === '.' || key === './index') {
          // Main export - we'll analyze this elsewhere
          continue;
        }

        if (key.startsWith('./') && !key.includes('*')) {
          // Named export like "./Button" or "./components/Button"
          const componentName = key.replace('./', '').split('/').pop();
          if (componentName && /^[A-Z]/.test(componentName)) {
            result[componentName] = `Component_${componentName}`;
            logger.log(`📍 Found component export: ${componentName}`);
          }
        }
      }
    }
  }

  /**
   * Extract component declarations from TypeScript definition files
   */
  private extractExportsFromTypeDefinitions(typingsPath: string, result: any): void {
    try {
      const content = fs.readFileSync(typingsPath, 'utf-8');

      // Look for export declarations like:
      // export declare const Button: ...
      // export default Button
      // export { Button }

      const exportPatterns = [
        /export\s+declare\s+const\s+([A-Z][a-zA-Z0-9]+)/g,
        /export\s+declare\s+function\s+([A-Z][a-zA-Z0-9]+)/g,
        /export\s+\{\s*([A-Z][a-zA-Z0-9, ]+)\s*\}/g,
        /export\s+default\s+([A-Z][a-zA-Z0-9]+)/g,
      ];

      for (const pattern of exportPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const componentName = match[1];
          if (componentName && /^[A-Z]/.test(componentName)) {
            result[componentName] = `Component_${componentName}`;
            logger.log(`📍 Found component in .d.ts: ${componentName}`);
          }
        }
      }
    } catch (error) {
      console.warn(`Could not read TypeScript definitions: ${error}`);
    }
  }

}

/**
 * Create a dynamic discovery instance for a package
 */
export function createDynamicDiscovery(packageName: string, projectRoot?: string): DynamicPackageDiscovery {
  return new DynamicPackageDiscovery(packageName, projectRoot);
}

/**
 * Quick function to get available components for a package
 */
export async function getPackageComponents(packageName: string, projectRoot?: string): Promise<string[]> {
  const discovery = createDynamicDiscovery(packageName, projectRoot);
  return await discovery.getAvailableComponentNames();
}
