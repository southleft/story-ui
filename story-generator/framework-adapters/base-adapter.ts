/**
 * Base Framework Adapter
 *
 * Abstract base class that provides common functionality for all
 * framework-specific adapters. Subclasses implement framework-specific
 * prompt generation and story templates.
 */

import {
  FrameworkType,
  StoryFramework,
  FrameworkAdapter,
  StoryGenerationOptions,
} from './types.js';
import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';
import { logger } from '../logger.js';

/**
 * Abstract Base Framework Adapter
 */
export abstract class BaseFrameworkAdapter implements FrameworkAdapter {
  abstract readonly type: FrameworkType;
  abstract readonly name: string;
  abstract readonly supportedStoryFrameworks: StoryFramework[];
  abstract readonly defaultExtension: string;

  /**
   * Get glob patterns for component files in this framework.
   * Used by component discovery to find relevant files.
   */
  abstract getComponentFilePatterns(): string[];

  /**
   * Extract component names from a source file.
   * Framework-specific implementation to detect component exports.
   */
  abstract extractComponentNamesFromFile(filePath: string, content: string): string[];

  /**
   * Generate the system prompt for this framework
   */
  abstract generateSystemPrompt(
    config: StoryUIConfig,
    options?: StoryGenerationOptions
  ): string;

  /**
   * Generate component reference documentation
   */
  generateComponentReference(
    components: DiscoveredComponent[],
    config: StoryUIConfig
  ): string {
    if (components.length === 0) {
      return 'No components discovered.';
    }

    const groupedComponents = this.groupComponentsByPackage(components);
    const sections: string[] = [];

    for (const [packageName, pkgComponents] of Object.entries(groupedComponents)) {
      const componentList = pkgComponents
        .map(comp => this.formatComponentEntry(comp, config))
        .join('\n');

      sections.push(`## ${packageName}\n${componentList}`);
    }

    return `# Available Components\n\n${sections.join('\n\n')}`;
  }

  /**
   * Format a single component entry
   */
  protected formatComponentEntry(
    component: DiscoveredComponent,
    config: StoryUIConfig
  ): string {
    const importPath = this.getImportPath(component, config);
    let entry = `- **${component.name}** (import from '${importPath}')`;

    if (component.props && component.props.length > 0) {
      const propsList = component.props
        .slice(0, 5) // Limit to first 5 props
        .join(', ');
      entry += `\n  Props: ${propsList}${component.props.length > 5 ? '...' : ''}`;
    }

    if (component.description) {
      entry += `\n  ${component.description}`;
    }

    return entry;
  }

  /**
   * Get the import path for a component
   */
  protected getImportPath(
    component: DiscoveredComponent,
    config: StoryUIConfig
  ): string {
    // Use component's __componentPath if available
    if (component.__componentPath) {
      return component.__componentPath;
    }

    // Fall back to import path from config
    return config.importPath || 'unknown';
  }

  /**
   * Group components by their category
   */
  protected groupComponentsByPackage(
    components: DiscoveredComponent[]
  ): Record<string, DiscoveredComponent[]> {
    const grouped: Record<string, DiscoveredComponent[]> = {};

    for (const component of components) {
      const category = component.category || 'other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(component);
    }

    return grouped;
  }

  /**
   * Generate example stories - framework specific
   */
  abstract generateExamples(config: StoryUIConfig): string;

  /**
   * Generate a sample story template - framework specific
   */
  abstract generateSampleStory(
    config: StoryUIConfig,
    components: DiscoveredComponent[]
  ): string;

  /**
   * Generate import statements for components
   */
  generateImports(
    components: DiscoveredComponent[],
    config: StoryUIConfig
  ): string {
    const importsByPath: Map<string, Set<string>> = new Map();

    for (const component of components) {
      const importPath = this.getImportPath(component, config);
      if (!importsByPath.has(importPath)) {
        importsByPath.set(importPath, new Set());
      }
      importsByPath.get(importPath)!.add(component.name);
    }

    const imports: string[] = [];
    for (const [path, names] of importsByPath) {
      const namedImports = Array.from(names).sort().join(', ');
      imports.push(`import { ${namedImports} } from '${path}';`);
    }

    return imports.join('\n');
  }

  /**
   * Post-process generated story content
   * Removes React imports for non-React frameworks as a safety net
   */
  postProcess(storyContent: string): string {
    let processed = storyContent
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');

    // For non-React frameworks, remove any React imports that may have been generated
    // This is a safety net in case the LLM generates React imports for non-React frameworks
    if (this.type !== 'react') {
      processed = processed.replace(/import React from ['"]react['"];?\n?/g, '');
      processed = processed.replace(/import \* as React from ['"]react['"];?\n?/g, '');
      processed = processed.replace(/import { React } from ['"]react['"];?\n?/g, '');
      // Clean up any resulting empty lines at the start of the file
      processed = processed.replace(/^\n+/, '');
    }

    return processed;
  }

  /**
   * Validate generated story syntax
   */
  validate(storyContent: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!storyContent || storyContent.trim().length === 0) {
      errors.push('Story content is empty');
    }

    // Check for common issues
    if (!storyContent.includes('export')) {
      errors.push('Story missing exports');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get the story file template - framework specific
   */
  abstract getStoryTemplate(options?: StoryGenerationOptions): string;

  /**
   * Log adapter activity
   */
  protected log(message: string, data?: Record<string, unknown>): void {
    logger.debug(`[${this.name}Adapter] ${message}`, data);
  }

  /**
   * Get common story structure rules including MANDATORY spacing
   */
  protected getCommonRules(): string {
    return `
GENERAL RULES:
- Follow the component library's design patterns
- Use meaningful story names that describe the variant
- Include multiple stories showing different states/variants
- Ensure accessibility by using proper ARIA attributes
- Use realistic placeholder content

IMAGE RULES:
- Use Lorem Picsum for placeholder images: https://picsum.photos/[width]/[height]
- Always include alt text for images
- Example: https://picsum.photos/400/300?random=1

MANDATORY SPACING & LAYOUT RULES (NON-NEGOTIABLE):
** CRITICAL: Every generated component MUST have professional-quality spacing. Components without proper spacing look broken and unprofessional. **

1. STORY WRAPPER (REQUIRED for every story):
   - The render function MUST return a wrapper div with padding
   - Pattern: render: () => <div style={{ padding: "24px" }}>...content...</div>
   - This ensures content has breathing room within the Storybook canvas

2. FORM FIELD SPACING (CRITICAL):
   - ALWAYS wrap form fields in a container with vertical spacing
   - Use flexbox column with gap: <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
   - Or use design system spacing tokens if available
   - MINIMUM 16px gap between form fields

3. BUTTON SPACING:
   - Submit/action buttons: 24px margin-top from form fields above
   - Pattern: <div style={{ marginTop: "24px" }}><Button>Submit</Button></div>
   - Button groups should be wrapped with margin-top from content

4. SECTION SPACING:
   - Between major sections: 32-48px
   - Between related content groups: 24px
   - Use dividers or significant whitespace between unrelated content

5. HEADING SPACING:
   - More space ABOVE headings (24-32px) than below (8-16px)
   - Pattern: <Heading style={{ marginTop: "32px", marginBottom: "12px" }}>

6. CARD/CONTAINER PADDING:
   - Internal padding: minimum 16px, preferred 24px
   - Pattern: <Card style={{ padding: "24px" }}>

7. SPECIFIC VALUES TO USE:
   - Tight spacing (icons, inline): 4-8px
   - Related items: 8-12px
   - Form fields: 16px gap
   - Buttons from content: 24px margin-top
   - Sections: 32-48px
   - Major divisions: 48-64px

SPACING VALIDATION (Self-check before generating):
Ask yourself: "Does every element have adequate breathing room from its neighbors?"
If any elements appear cramped or touching, add appropriate spacing.
`;
  }
}
