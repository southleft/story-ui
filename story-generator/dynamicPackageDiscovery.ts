import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

export interface RealPackageComponent {
  name: string;
  isComponent: boolean;
  type: 'function' | 'class' | 'object' | 'unknown';
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
        console.warn(`Could not require package ${this.packageName}`);
        return null;
      }

      const allExports = Object.keys(packageExports);
      const components: RealPackageComponent[] = [];

      for (const exportName of allExports) {
        const exportValue = packageExports[exportName];
        const component: RealPackageComponent = {
          name: exportName,
          isComponent: this.isLikelyComponent(exportName, exportValue),
          type: this.getExportType(exportValue)
        };
        components.push(component);
      }

      console.log(`✅ Discovered ${components.filter(c => c.isComponent).length} components from ${this.packageName} v${packageVersion}`);

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
        // Fall back to require (for CommonJS)
        // Create require from the project root's package.json to ensure correct module resolution
        const projectPackageJson = path.join(this.projectRoot, 'package.json');
        const require = createRequire(projectPackageJson);
        return require(packageName);
      }
    } catch (error) {
      console.warn(`Could not import/require ${packageName}:`, error);
      return null;
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
    const type = typeof value;

    if (type === 'function') {
      // Try to distinguish between function and class
      const fnString = value.toString();
      if (fnString.startsWith('class ') || /^function [A-Z]/.test(fnString)) {
        return 'class';
      }
      return 'function';
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
