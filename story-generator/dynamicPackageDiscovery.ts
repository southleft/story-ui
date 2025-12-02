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
 * Dynamically discovers what components are actually available in an installed package.
 *
 * IMPORTANT: This class is FRAMEWORK-aware, not DESIGN-SYSTEM-aware.
 * It uses GENERIC patterns based on the framework type (React, Vue, Angular, Svelte, Web Components)
 * without any knowledge of specific design systems (Mantine, Vuetify, Material, Skeleton, Shoelace, etc.)
 */
export class DynamicPackageDiscovery {
  private packageName: string;
  private projectRoot: string;
  private framework: string;

  constructor(packageName: string, projectRoot: string = process.cwd(), framework: string = 'react') {
    this.packageName = packageName;
    this.projectRoot = projectRoot;
    this.framework = framework.toLowerCase();
  }

  /**
   * Get the real exports from the installed package
   */
  async getRealPackageExports(): Promise<PackageExports | null> {
    try {
      // GENERIC: Normalize package names with subpath exports to their base package
      // e.g., 'packagename/components' -> 'packagename', '@scope/pkg/sub' -> '@scope/pkg'
      let normalizedPackageName = this.packageName;
      if (!this.packageName.startsWith('@') && this.packageName.includes('/')) {
        // Non-scoped package with subpath: extract base name
        normalizedPackageName = this.packageName.split('/')[0];
        logger.log(`🔧 Normalizing package path: ${this.packageName} → ${normalizedPackageName}`);
      } else if (this.packageName.startsWith('@')) {
        // Scoped package: keep @scope/name, strip anything after
        const parts = this.packageName.split('/');
        if (parts.length > 2) {
          normalizedPackageName = `${parts[0]}/${parts[1]}`;
          logger.log(`🔧 Normalizing scoped package path: ${this.packageName} → ${normalizedPackageName}`);
        }
      }

      const packagePath = path.join(this.projectRoot, 'node_modules', normalizedPackageName);

      if (!fs.existsSync(packagePath)) {
        console.warn(`Package ${normalizedPackageName} not found in node_modules`);
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
   *
   * IMPORTANT: This uses GENERIC framework-based discovery patterns.
   * It has NO knowledge of specific design systems - only framework types.
   */
  private discoverFromPackageStructure(): any {
    try {
      // GENERIC: Normalize package name for subpath exports
      let normalizedPackageName = this.packageName;
      if (!this.packageName.startsWith('@') && this.packageName.includes('/')) {
        normalizedPackageName = this.packageName.split('/')[0];
      } else if (this.packageName.startsWith('@')) {
        const parts = this.packageName.split('/');
        if (parts.length > 2) {
          normalizedPackageName = `${parts[0]}/${parts[1]}`;
        }
      }

      const packagePath = path.join(this.projectRoot, 'node_modules', normalizedPackageName);
      const packageJsonPath = path.join(packagePath, 'package.json');

      if (!fs.existsSync(packageJsonPath)) {
        logger.log(`📦 No package.json found for ${normalizedPackageName}`);
        return null;
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const exports: any = {};

      // GENERIC Framework-based discovery methods (prioritized by framework type)
      logger.log(`🔧 Using GENERIC ${this.framework} framework discovery for ${this.packageName}...`);

      // Vue framework: Parse ES module re-exports from lib/components/index.js
      if (this.framework === 'vue') {
        const vueComponents = this.discoverVueFrameworkComponents(packagePath);
        if (vueComponents && Object.keys(vueComponents).length > 0) {
          return vueComponents;
        }
      }

      // Web Components framework: Parse custom-elements.json manifest
      if (this.framework === 'web-components') {
        const webComponents = this.discoverWebComponentsFromManifest(packagePath);
        if (webComponents && Object.keys(webComponents).length > 0) {
          return webComponents;
        }
      }

      // Angular framework: Scan NgModule directories
      if (this.framework === 'angular') {
        const angularComponents = this.discoverAngularFrameworkComponents(packagePath);
        if (angularComponents && Object.keys(angularComponents).length > 0) {
          return angularComponents;
        }
      }

      // Svelte framework: Check for CSS-only vs component packages
      if (this.framework === 'svelte') {
        const svelteComponents = this.discoverSvelteFrameworkComponents(packagePath, packageJson);
        if (svelteComponents && Object.keys(svelteComponents).length > 0) {
          return svelteComponents;
        }
      }

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
   * GENERIC Vue Framework Discovery: Parse ES module re-exports
   * Works with Vue component libraries that use: export * from "./ComponentName/index.js" pattern
   * Searches common locations: lib/components/, src/components/, components/
   */
  private discoverVueFrameworkComponents(packagePath: string): any {
    try {
      // GENERIC: Try multiple common component index locations
      const possibleIndexPaths = [
        path.join(packagePath, 'lib', 'components', 'index.js'),
        path.join(packagePath, 'lib', 'components', 'index.mjs'),
        path.join(packagePath, 'src', 'components', 'index.js'),
        path.join(packagePath, 'src', 'components', 'index.ts'),
        path.join(packagePath, 'components', 'index.js'),
        path.join(packagePath, 'dist', 'components', 'index.js'),
      ];

      let componentsIndexPath: string | null = null;
      for (const p of possibleIndexPaths) {
        if (fs.existsSync(p)) {
          componentsIndexPath = p;
          logger.log(`📁 Found Vue components index at: ${p}`);
          break;
        }
      }

      if (!componentsIndexPath) {
        logger.log(`📁 No Vue components index found in common locations`);
        return null;
      }

      const content = fs.readFileSync(componentsIndexPath, 'utf-8');
      const exports: any = {};

      // GENERIC: Match ES module re-export patterns
      // export * from "./ComponentName/index.js" or export * from "./ComponentName/index.mjs"
      const reExportRegex = /export\s+\*\s+from\s+["']\.\/([^/]+)\/index(?:\.m?js)?["']/g;
      let match;

      while ((match = reExportRegex.exec(content)) !== null) {
        const componentDir = match[1];
        // Component name is the directory name
        if (this.isComponentName(componentDir)) {
          exports[componentDir] = () => {};
          exports[componentDir].displayName = componentDir;
          // GENERIC: Use relative path from package, not hardcoded design system name
          const relativePath = path.relative(packagePath, componentsIndexPath);
          const componentsDir = path.dirname(relativePath);
          exports[componentDir].__componentPath = `${this.packageName}/${componentsDir}/${componentDir}`;
        }
      }

      logger.log(`✅ Vue Framework: Found ${Object.keys(exports).length} components from ${path.basename(componentsIndexPath)}`);
      return exports;

    } catch (error) {
      logger.log(`❌ Vue framework discovery failed: ${error}`);
      return null;
    }
  }

  /**
   * GENERIC Web Components Discovery: Parse custom-elements.json manifest
   * Custom Elements Manifest is a standard spec for documenting Web Components
   * Works with any Web Components library that provides a custom-elements.json manifest
   */
  private discoverWebComponentsFromManifest(packagePath: string): any {
    try {
      // GENERIC: Try multiple common locations for custom-elements.json manifest
      const possiblePaths = [
        path.join(packagePath, 'custom-elements.json'),
        path.join(packagePath, 'dist', 'custom-elements.json'),
        path.join(packagePath, 'cdn', 'custom-elements.json'),
        path.join(packagePath, 'lib', 'custom-elements.json'),
        path.join(packagePath, 'build', 'custom-elements.json'),
      ];

      let manifestPath: string | null = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          manifestPath = p;
          logger.log(`📁 Found custom-elements.json manifest at: ${p}`);
          break;
        }
      }

      if (!manifestPath) {
        logger.log(`📁 No custom-elements.json manifest found in common locations`);
        return null;
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const exports: any = {};

      // custom-elements.json structure (standard spec):
      // { modules: [{ declarations: [{ kind: "class", name: "SlAlert", tagName: "sl-alert" }] }] }
      if (manifest.modules && Array.isArray(manifest.modules)) {
        for (const module of manifest.modules) {
          if (module.declarations && Array.isArray(module.declarations)) {
            for (const declaration of module.declarations) {
              // Look for class declarations that are Custom Elements
              if (declaration.kind === 'class' && declaration.name && declaration.tagName) {
                const componentName = declaration.name;
                exports[componentName] = () => {};
                exports[componentName].displayName = componentName;
                // GENERIC: Use package name, not hardcoded design system name
                exports[componentName].__componentPath = `${this.packageName}/${module.path || ''}`;
                exports[componentName].__tagName = declaration.tagName;
              }
            }
          }
        }
      }

      logger.log(`✅ Web Components: Found ${Object.keys(exports).length} components from custom-elements.json`);
      return exports;

    } catch (error) {
      logger.log(`❌ Web Components manifest discovery failed: ${error}`);
      return null;
    }
  }

  /**
   * GENERIC Angular Framework Discovery: Scan module directories
   * Works with Angular component libraries that use NgModule patterns
   * Discovers modules based on directory structure and file patterns
   */
  private discoverAngularFrameworkComponents(packagePath: string): any {
    try {
      const entries = fs.readdirSync(packagePath, { withFileTypes: true });
      const exports: any = {};

      // GENERIC: Common Angular-specific directories to exclude
      const excludedDirs = new Set([
        'node_modules', 'schematics', 'prebuilt-themes', 'core',
        'esm2022', 'fesm2022', 'esm2020', 'fesm2020', 'esm2015', 'fesm2015',
        'testing', 'bundles', 'cdk', 'src', 'lib', 'dist'
      ]);

      // Filter to potential component module directories
      const componentModules = entries.filter(entry =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('_') &&
        !excludedDirs.has(entry.name)
      );

      for (const moduleDir of componentModules) {
        const moduleName = moduleDir.name;
        const modulePath = path.join(packagePath, moduleName);

        // GENERIC: Check if this directory contains Angular-relevant content
        let hasContent = false;
        try {
          const moduleContents = fs.readdirSync(modulePath);
          hasContent = moduleContents.some(f =>
            f.endsWith('.scss') ||
            f.endsWith('.css') ||
            f.includes('index') ||
            f.endsWith('.html') ||
            f.endsWith('.module.ts') ||
            f.endsWith('.component.ts')
          );
        } catch {
          continue;
        }

        if (hasContent) {
          // GENERIC: Convert directory name to Angular component name pattern
          // "button" -> "MatButton" or "MyButton" depending on package naming
          // Try to detect prefix from package name
          let prefix = 'Mat';
          const packageNameParts = this.packageName.split('/');
          const baseName = packageNameParts[packageNameParts.length - 1];
          if (baseName && baseName !== 'material') {
            // Use first 3 chars capitalized as prefix (e.g., @mylib/ui -> "Myl")
            prefix = baseName.charAt(0).toUpperCase() + baseName.slice(1, 3);
          }

          const componentName = prefix + moduleName
            .split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');

          exports[componentName] = () => {};
          exports[componentName].displayName = componentName;
          // GENERIC: Use actual package name, not hardcoded
          exports[componentName].__componentPath = `${this.packageName}/${moduleName}`;
          exports[componentName].__moduleName = moduleName;
        }
      }

      logger.log(`✅ Angular Framework: Found ${Object.keys(exports).length} component modules`);
      return exports;

    } catch (error) {
      logger.log(`❌ Angular framework discovery failed: ${error}`);
      return null;
    }
  }

  /**
   * GENERIC Svelte Framework Discovery: Scan for .svelte component files
   * Works with any Svelte component library that includes .svelte files
   * Searches common locations: dist/, src/, lib/, components/
   * Also detects CSS-only packages that provide no Svelte components
   */
  private discoverSvelteFrameworkComponents(packagePath: string, packageJson: any): any {
    try {
      const exports: any = {};

      // GENERIC: Try multiple common locations for Svelte components
      const possibleDirs = [
        path.join(packagePath, 'dist'),
        path.join(packagePath, 'src'),
        path.join(packagePath, 'lib'),
        path.join(packagePath, 'components'),
        path.join(packagePath, 'build'),
      ];

      for (const searchDir of possibleDirs) {
        if (!fs.existsSync(searchDir)) continue;

        const entries = fs.readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // Check for .svelte files in subdirectory
            const subPath = path.join(searchDir, entry.name);
            try {
              const files = fs.readdirSync(subPath);
              for (const file of files) {
                if (file.endsWith('.svelte')) {
                  const componentName = file.replace('.svelte', '');
                  if (this.isComponentName(componentName)) {
                    exports[componentName] = () => {};
                    exports[componentName].displayName = componentName;
                    // GENERIC: Use package name, not hardcoded design system name
                    const relativePath = path.relative(packagePath, subPath);
                    exports[componentName].__componentPath = `${this.packageName}/${relativePath}`;
                  }
                }
              }
            } catch {
              continue;
            }
          } else if (entry.name.endsWith('.svelte')) {
            // Direct .svelte files in the directory
            const componentName = entry.name.replace('.svelte', '');
            if (this.isComponentName(componentName)) {
              exports[componentName] = () => {};
              exports[componentName].displayName = componentName;
              const relativePath = path.relative(packagePath, searchDir);
              exports[componentName].__componentPath = `${this.packageName}/${relativePath}`;
            }
          }
        }

        if (Object.keys(exports).length > 0) {
          logger.log(`📁 Found Svelte components in: ${searchDir}`);
          break;
        }
      }

      // GENERIC: Check if package.json exports only CSS (no components)
      if (packageJson.exports && Object.keys(exports).length === 0) {
        const mainExport = packageJson.exports['.'];
        const isCSSOnly = (typeof mainExport === 'object')
          ? (mainExport.import?.endsWith('.css') || mainExport.style?.endsWith('.css'))
          : (typeof mainExport === 'string' && mainExport.endsWith('.css'));

        if (isCSSOnly) {
          logger.log(`⚠️ ${this.packageName} is CSS-only (Tailwind/CSS utilities). No Svelte components available.`);
          logger.log(`💡 This package provides CSS utilities only. Use standard HTML elements with its CSS classes.`);

          // Return a special marker indicating CSS-only
          exports['__CSS_ONLY__'] = true;
          exports['__MESSAGE__'] = `${this.packageName} provides CSS utilities only. Use standard HTML elements with CSS classes.`;
        }
      }

      if (Object.keys(exports).length > 0 && !exports['__CSS_ONLY__']) {
        logger.log(`✅ Svelte Framework: Found ${Object.keys(exports).length} components`);
      }

      return Object.keys(exports).length > 0 ? exports : null;

    } catch (error) {
      logger.log(`❌ Svelte framework discovery failed: ${error}`);
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
