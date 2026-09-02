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
    // An explicitly declared import specifier is authoritative — the project
    // wrote down where this component lives, and no path arithmetic can beat
    // being told. Covers components that have no filePath at all, such as ones
    // declared in config but never found on disk.
    const declaredPath = (component as any).__componentPath;
    if (declaredPath) {
      componentMap.set(component.name, declaredPath);
      continue;
    }

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
    // Components discovery cannot place. They stay on the original import.
    const unmapped: string[] = [];

    for (const component of components) {
      let componentImportPath: string;

      if (componentToImport && componentToImport.has(component)) {
        // Use discovery-based mapping
        componentImportPath = componentToImport.get(component)!;
        logger.log(`[DISCOVERY] ${component} -> ${componentImportPath}`);
      } else {
        /**
         * Do not invent a path. Leave the import exactly as written.
         *
         * This branch used to kebab-case the component name onto the import
         * path — `Box` became `@atlaskit/box` — which is the same guess the
         * engine has had to stop making in discovery, in the catalog and in
         * import validation, here wearing a helper labelled "design-system
         * agnostic". For a scope like `@atlaskit` there is no such package:
         * Box, Flex, MetricText, Text and Anchor all live in
         * `@atlaskit/primitives`.
         *
         * Measured consequence: the model imported correctly from the path the
         * catalog gave it, validation PASSED, and one second later this step
         * rewrote five correct imports into five packages that do not exist.
         * The story then rendered nothing, and every downstream signal blamed
         * the generation.
         *
         * Unconverted is not a failure mode — the original import came from
         * the catalog and is the best information available.
         */
        unmapped.push(component);
        logger.log(`[KEPT] ${component} — not in discovery, leaving its import untouched`);
        continue;
      }

      if (!groupedByImportPath.has(componentImportPath)) {
        groupedByImportPath.set(componentImportPath, []);
      }
      groupedByImportPath.get(componentImportPath)!.push(component);
    }

    // Build individual imports, re-emitting anything we could not place on
    // its ORIGINAL specifier rather than dropping or inventing it.
    const rewritten = Array.from(groupedByImportPath.entries())
      .map(([path, comps]) => `import { ${comps.join(', ')} } from '${path}';`);
    if (unmapped.length > 0) {
      rewritten.unshift(`import { ${unmapped.join(', ')} } from '${importPath}';`);
    }
    const individualImports = rewritten.join('\n');

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

/**
 * Split an import from an npm SCOPE into the real packages its components live in.
 *
 * Measured against Atlassian: the model gets most imports exactly right —
 * `Avatar from '@atlaskit/avatar'`, `Lozenge from '@atlaskit/lozenge'` — and
 * then collapses the layout primitives onto the scope root:
 *
 *   import { Box, Stack, Flex } from '@atlaskit';
 *
 * It does this with a correct, complete, 4KB catalog in front of it that
 * states `**Box** (import from '@atlaskit/primitives')`, and it repeats the
 * mistake through every self-healing attempt until the loop gives up. Three
 * prompt revisions did not move it.
 *
 * So stop asking. The right package for each component is a fact discovery
 * already holds, so the repair is deterministic and costs no LLM call. This is
 * the exact inverse of the fallback that used to live in fixBarrelImports:
 * that one INVENTED a path from a component's name; this one only ever applies
 * a path the project stated.
 *
 * Bindings we cannot place are left on the original specifier, where import
 * validation will report them honestly rather than have a guess smuggled in.
 */
export function splitScopeImports(
  code: string,
  importPath: string,
  componentHomes: Map<string, string>,
): string {
  // Only meaningful for a scope root — `@scope` with no package after it.
  if (!importPath.startsWith('@') || importPath.includes('/')) return code;
  if (componentHomes.size === 0) return code;

  const scopeImport = new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${escapeRegExp(importPath)}['"];?`,
    'g',
  );

  return code.replace(scopeImport, (whole, bindingList: string) => {
    const byPackage = new Map<string, string[]>();
    const unplaced: string[] = [];

    for (const raw of String(bindingList).split(',')) {
      const binding = raw.trim();
      if (!binding) continue;
      // `Foo as Bar` — resolve on the ORIGINAL name, emit the whole clause.
      const source = binding.split(/\s+as\s+/)[0].trim();
      const home = componentHomes.get(source);
      if (!home) {
        unplaced.push(binding);
        continue;
      }
      if (!byPackage.has(home)) byPackage.set(home, []);
      byPackage.get(home)!.push(binding);
    }

    if (byPackage.size === 0) return whole;

    const lines = [...byPackage.entries()].map(
      ([pkg, names]) => `import { ${names.join(', ')} } from '${pkg}';`,
    );
    if (unplaced.length > 0) {
      lines.push(`import { ${unplaced.join(', ')} } from '${importPath}';`);
    }
    logger.log(`🔧 Split ${byPackage.size + (unplaced.length ? 1 : 0)} import(s) out of scope '${importPath}'`);
    return lines.join('\n');
  });
}

/**
 * Did a targeted edit quietly replace the whole composition?
 *
 * Reported from manual testing: with one button selected and the request "Red
 * background.", the tool returned an entirely different page — and the reply
 * asserted that "the Grid, Row, and Column layout structure remains
 * unchanged", because the model was describing the composition it had just
 * invented rather than the one it was asked to modify. Every existing gate
 * passed it: the code compiled, rendered, and verified.
 *
 * Structural similarity is the check that catches this. A request that names
 * one element and one property cannot legitimately change most of the file, so
 * a large divergence is evidence the model restarted instead of editing.
 *
 * Two signals, both multisets so reordering a section is never mistaken for a
 * rewrite:
 *
 *   - the JSX ELEMENT NAMES — is it still the same set of components?
 *   - the CONTENT — attribute name=value pairs and rendered text. Tags alone
 *     scored a rewrite that kept the same six Cards but replaced every word
 *     and prop on them as ~0, because the shape of the tree survived while the
 *     page did not.
 *
 * Overlap is measured relative to the PREVIOUS code: how much of what existed
 * is still there. A pure addition keeps everything and scores 0, however large
 * it is — the failure being guarded against is prior work destroyed, not new
 * work added — while a replacement loses the old material and scores high.
 */
const TAG_WEIGHT = 0.35;
const CONTENT_WEIGHT = 0.65;

export function editDivergence(previousCode: string, nextCode: string): {
  /** 0 = identical structure and content, 1 = nothing in common. */
  divergence: number;
  before: number;
  after: number;
} {
  const tags = (code: string): string[] =>
    [...code.matchAll(/<\/?([A-Za-z][A-Za-z0-9.]*)/g)].map(m => m[1]);

  // What the elements SAY. Attribute values with nested braces are skipped by
  // the regex — consistently on both sides, so they cancel — and text with no
  // letters or digits is punctuation the JSX syntax itself produced.
  const content = (code: string): string[] => [
    ...[...code.matchAll(/([A-Za-z_][\w-]*)=("[^"]*"|'[^']*'|\{[^{}]*\})/g)].map(m => `${m[1]}=${m[2]}`),
    ...[...code.matchAll(/>([^<>{}]+)</g)]
      .map(m => m[1].trim())
      .filter(t => /[A-Za-z0-9]/.test(t)),
  ];

  // How much of `before` survives into `after`. 1 when there was nothing to
  // preserve — an empty signal is not evidence of a rewrite.
  const survivingFraction = (before: string[], after: string[]): number => {
    if (before.length === 0) return 1;
    const counts = new Map<string, number>();
    for (const item of before) counts.set(item, (counts.get(item) || 0) + 1);
    let shared = 0;
    for (const item of after) {
      const left = counts.get(item) || 0;
      if (left > 0) { shared++; counts.set(item, left - 1); }
    }
    return shared / before.length;
  };

  const beforeTags = tags(previousCode);
  const afterTags = tags(nextCode);
  if (beforeTags.length === 0) return { divergence: 0, before: 0, after: afterTags.length };

  const tagOverlap = survivingFraction(beforeTags, afterTags);
  const contentOverlap = survivingFraction(content(previousCode), content(nextCode));

  const divergence = 1 - (TAG_WEIGHT * tagOverlap + CONTENT_WEIGHT * contentOverlap);
  return { divergence, before: beforeTags.length, after: afterTags.length };
}
