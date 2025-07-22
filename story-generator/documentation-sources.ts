/**
 * Documentation sources for design systems
 * Provides fallback documentation when custom docs aren't available
 */

export interface DocumentationSource {
  version?: string;
  url?: string;
  lastUpdated?: string;
}

/**
 * Pre-bundled documentation for popular design systems
 * Users should provide their own documentation in story-ui-docs/ directory for best results
 */
export const BUNDLED_DOCUMENTATION: Record<string, any> = {
  // Currently empty - users should provide their own documentation
  // in story-ui-docs/ directory for best AI story generation
};

/**
 * Get documentation for a design system
 * Falls back to bundled docs if no scraped docs exist
 */
export function getDocumentation(importPath: string): any {
  // First check for scraped documentation
  const cacheFile = `.story-ui-cache/${importPath.replace(/[@\/]/g, '-')}-docs.json`;
  
  // For now, just return bundled docs if available
  return BUNDLED_DOCUMENTATION[importPath] || null;
}

/**
 * Check if a component is deprecated for a given design system
 */
export function isDeprecatedComponent(importPath: string, componentName: string): boolean {
  const docs = getDocumentation(importPath);
  return docs?.deprecations && docs.deprecations[componentName];
}

/**
 * Get replacement suggestion for a deprecated component
 */
export function getComponentReplacement(importPath: string, componentName: string): string | null {
  const docs = getDocumentation(importPath);
  return docs?.deprecations?.[componentName] || null;
}