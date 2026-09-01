import { packageDirFor, packageNameOf, specifierForPackageFile } from './knowledge/packageLocator.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { looksLikeComponentValue, declaredComponentExports, logDeclarationVerdicts, typesEntryFor } from './knowledge/componentShape.js';
import { nearestNames } from './nameSimilarity.js';

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

      const packagePath = packageDirFor(this.projectRoot, normalizedPackageName) ?? path.join(this.projectRoot, 'node_modules', normalizedPackageName);

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
   * Is this export a component? Judged from the VALUE, which is in hand.
   *
   * The previous version rejected by name shape — `/Value$/`, `/Config$/`,
   * `/^get[A-Z]/`, `/String$/` — and then read `fn.toString()` looking for
   * the words "function get". A real `EmptyState`, `ThemeConfig` or
   * `SelectOptions` component was invisible, and nothing said so. The one
   * predicate in `knowledge/componentShape` reads React's `$$typeof`, class
   * heritage, Vue's `setup`/`render`, and namespace members (Base UI's `Menu`
   * is a plain object whose members are the components; dropping it lost 29
   * of that library's 40 exports). See that module for every branch.
   */
  private isLikelyComponent(name: string, value: any): boolean {
    return looksLikeComponentValue(value, name);
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
   * The nearest catalog name, by similarity to what was actually discovered.
   * There is no fixed vocabulary here: the old `'stack' → BlockStack` table was
   * Polaris's, and wrong for everyone else.
   */
  private findSimilarComponent(targetName: string, availableComponents: string[]): string | null {
    return nearestNames(targetName, availableComponents, 1)[0] ?? null;
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

      const packagePath = packageDirFor(this.projectRoot, normalizedPackageName) ?? path.join(this.projectRoot, 'node_modules', normalizedPackageName);
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

      // Angular and Svelte: what the package DECLARES, per exported subpath,
      // before any directory scan. The scans below inferred `MatChips` from a
      // directory named `chips` (no such class exists) and offered
      // `flowbite-svelte/dist/accordion` (a path the exports map does not
      // expose) — both invisible until the bench checked names and subpaths.
      if (this.framework === 'angular' || this.framework === 'svelte') {
        const declared = this.discoverFromDeclaredEntries(packagePath, packageJson);
        if (declared && Object.keys(declared).length > 0) {
          return declared;
        }
        logger.log(`📋 ${this.packageName}: no component declarations found under its exported entries; scanning the package layout instead`);
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
   * Components declared under each subpath the package's exports map names.
   *
   * The exports map is the package's own statement of what is importable and
   * from where; each entry's declarations file states what it exports and
   * whether that is a component. Nothing here is inferred from a directory
   * name, a prefix, or a file extension.
   */
  private discoverFromDeclaredEntries(packagePath: string, packageJson: any): any {
    const pkgName = packageNameOf(this.packageName);
    const subpaths: string[] = [''];
    if (packageJson?.exports && typeof packageJson.exports === 'object') {
      for (const key of Object.keys(packageJson.exports)) {
        if (!key.startsWith('./') || key.includes('*')) continue;
        if (/\.(css|scss|sass|less|json|svg|png|md)$/.test(key)) continue;
        if (key === './package.json') continue;
        subpaths.push(key.slice(2));
      }
    }

    const exportsFound: any = {};
    let entriesRead = 0;
    for (const sub of subpaths.slice(0, 400)) {
      const entry = typesEntryFor(packagePath, sub);
      if (!entry) continue;
      entriesRead++;
      const found = declaredComponentExports(entry, { projectRoot: this.projectRoot, followBare: false });
      logDeclarationVerdicts(`${pkgName}${sub ? '/' + sub : ''}`, found);
      const names = [...found.components, ...found.unknown];
      if (names.length === 0) continue;
      const specifier = sub ? `${pkgName}/${sub}` : this.packageName;
      for (const name of names) {
        if (exportsFound[name]) continue; // the root barrel, read first, wins
        exportsFound[name] = () => {};
        exportsFound[name].displayName = name;
        exportsFound[name].__componentPath = specifier;
      }
    }
    if (entriesRead > 0) {
      logger.log(`✅ ${pkgName}: ${Object.keys(exportsFound).length} components declared across ${entriesRead} exported entr${entriesRead === 1 ? 'y' : 'ies'}`);
    }
    return Object.keys(exportsFound).length > 0 ? exportsFound : null;
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
      const componentsDir = path.dirname(componentsIndexPath);

      while ((match = reExportRegex.exec(content)) !== null) {
        const componentDir = match[1];

        // Resolve actual named exports from each subdirectory's index.d.ts
        // This prevents directory names (e.g. "VGrid") from being treated as
        // components when the directory actually re-exports different names
        // (e.g. VContainer, VCol, VRow, VSpacer).
        const subdirTypings = path.join(componentsDir, componentDir, 'index.d.ts');
        if (fs.existsSync(subdirTypings)) {
          try {
            const realExports = this.componentsDeclaredIn(subdirTypings);
            if (realExports.length > 0) {
              const specifier = this.importSpecifierFor(packagePath, path.join(componentsDir, componentDir));
              for (const name of realExports) {
                exports[name] = () => {};
                exports[name].displayName = name;
                exports[name].__componentPath = specifier;
              }
              continue; // Skip the directory-name fallback below
            }
          } catch { /* fall through to directory-name fallback */ }
        }

        // Fallback: use directory name when we can't resolve actual exports
        if (this.canBeWrittenAsTag(componentDir)) {
          exports[componentDir] = () => {};
          exports[componentDir].displayName = componentDir;
          exports[componentDir].__componentPath = this.importSpecifierFor(packagePath, path.join(componentsDir, componentDir));
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
   * The specifier that imports a file of this package, from its exports map.
   *
   * Falls back to the configured importPath when the map exposes no route to
   * the file — an importable barrel is a weaker answer than a subpath, but a
   * path that does not exist is not an answer at all — and says so.
   */
  private importSpecifierFor(packagePath: string, absoluteOrRelativeFile: string): string {
    const pkgName = packageNameOf(this.packageName);
    const rel = path.isAbsolute(absoluteOrRelativeFile) ? path.relative(packagePath, absoluteOrRelativeFile) : absoluteOrRelativeFile;
    const specifier = specifierForPackageFile(pkgName, packagePath, rel);
    if (specifier) return specifier;
    logger.log(`📍 ${pkgName}: exports map gives no route to ${rel}; offering ${this.packageName} instead`);
    return this.packageName;
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
                // The specifier the package's exports map gives this module —
                // a manifest path is relative to the SOURCE tree, and Shoelace
                // publishes `components/alert/alert.js` under `dist/`.
                exports[componentName].__componentPath = module.path
                  ? this.importSpecifierFor(packagePath, module.path)
                  : this.packageName;
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
                  if (this.canBeWrittenAsTag(componentName)) {
                    exports[componentName] = () => {};
                    exports[componentName].displayName = componentName;
                    exports[componentName].__componentPath = this.importSpecifierFor(packagePath, subPath);
                  }
                }
              }
            } catch {
              continue;
            }
          } else if (entry.name.endsWith('.svelte')) {
            // Direct .svelte files in the directory
            const componentName = entry.name.replace('.svelte', '');
            if (this.canBeWrittenAsTag(componentName)) {
              exports[componentName] = () => {};
              exports[componentName].displayName = componentName;
              exports[componentName].__componentPath = this.importSpecifierFor(packagePath, searchDir);
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
          /**
           * Say so, and return NOTHING.
           *
           * This used to smuggle two sentinel keys — `__CSS_ONLY__` and
           * `__MESSAGE__` — through the component map. Nothing filters
           * `__`-prefixed keys, and the caller returns early on any non-empty
           * result, so a CSS-only dependency on a Svelte project produced two
           * components literally named `__CSS_ONLY__` and `__MESSAGE__`, fed
           * them to the catalog AND to validateAvailableComponents as legal
           * component names, and skipped every other discovery method for that
           * package.
           *
           * A component map is not a channel for diagnostics. The log carries
           * the message; the map stays honest.
           */
          logger.log(`⚠️ ${this.packageName} ships CSS utilities only — no importable components.`);
          logger.log(`💡 Use standard HTML elements with its CSS classes; there is nothing to import.`);
          return null;
        }
      }

      if (Object.keys(exports).length > 0) {
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
            // What the declarations say, not what the names look like.
            const componentExports = this.componentsDeclaredIn(indexTypingsPath);

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
   * Components a declarations file exports, decided by each declaration.
   *
   * `unknown` (a re-export whose target could not be reached) is admitted and
   * logged: absence of a declaration is not evidence of a non-component, and
   * the log makes the admission visible rather than silent.
   */
  private componentsDeclaredIn(file: string): string[] {
    const found = declaredComponentExports(file, { projectRoot: this.projectRoot });
    logDeclarationVerdicts(`${this.packageName} (${path.relative(this.projectRoot, file)})`, found);
    return [...new Set([...found.components, ...found.unknown])];
  }

  /**
   * The only name test left, and it is grammar, not convention: a JSX tag or
   * SFC template tag beginning lowercase is an intrinsic element, so a name
   * that begins lowercase can never be written as a component. Used where the
   * fact that something IS a component comes from elsewhere — a `.svelte`
   * file's extension, a Vue component directory the index re-exports.
   */
  private canBeWrittenAsTag(name: string): boolean {
    return /^[A-Z][\w$]*$/.test(name);
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
   * Components a package's declarations entry exports.
   *
   * Everything here is decided by the declaration each name resolves to
   * (`knowledge/componentShape`): `export { default as Box } from './box'` is
   * followed to `box.d.ts`; `export * from './Button'` is followed; a braced
   * `export { ButtonProps }` is followed to the `interface` it names and
   * excluded for being one. The previous version matched name suffixes —
   * `(Props|PropTypes|Type|Types|Handler|Options|Config|Context|State)$` —
   * which hid a real `SelectOptions` and admitted an unfollowed `ButtonProps`
   * with equal confidence.
   *
   * The exported name is the ALIAS (`export { X as Y }` → `import { Y }`).
   * `export default Name` also registers `Name`, as it always has, so a file
   * that only default-exports still yields a component to offer.
   */
  private extractExportsFromTypeDefinitions(typingsPath: string, result: any): void {
    try {
      const found = declaredComponentExports(typingsPath, { projectRoot: this.projectRoot });
      logDeclarationVerdicts(`${this.packageName} (${path.relative(this.projectRoot, typingsPath)})`, found);
      const names = [...found.components, ...found.unknown];
      if (found.defaultLocalName && found.defaultExport !== 'not-component') names.push(found.defaultLocalName);
      for (const name of names) {
        if (result[name]) continue;
        result[name] = `Component_${name}`;
        logger.log(`📍 Found component in declarations: ${name}`);
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
