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
import * as fs from 'fs';
import * as nodePath from 'path';
import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';
import { logger } from '../logger.js';

/**
 * Abstract Base Framework Adapter
 */
/** How many props to show per component in the prompt catalog. */
const MAX_PROPS_IN_CATALOG = 12;

/**
 * Order props so the ones that determine BEHAVIOR come first.
 *
 * The catalog is the model's only description of a component, and it is
 * truncated. Alphabetical or declaration order buries the props that decide
 * whether something is interactive — which is precisely the judgement we need
 * it to make. Handlers, state, and content-slot props rank above styling.
 */
function rankPropsByRelevance(props: string[]): string[] {
  const tier = (raw: string): number => {
    // Entries can be "name" or "name: type"; rank on the name.
    const p = String(raw).split(':')[0].trim();
    if (/^on[A-Z]/.test(p)) return 0;                                   // onClick, onChange
    if (/^(value|defaultValue|checked|active|selected|open|opened|disabled|loading|error)$/i.test(p)) return 1;
    if (/(section|icon|adornment|prefix|suffix|slot)/i.test(p)) return 2; // leftSection, rightSection
    if (/^(label|placeholder|title|description|children|href|name|type|id)$/i.test(p)) return 3;
    if (/^(variant|size|color|radius|shadow|position|orientation)$/i.test(p)) return 4;
    return 5;
  };
  return [...props].sort((a, b) => {
    const d = tier(a) - tier(b);
    return d !== 0 ? d : String(a).localeCompare(String(b));
  });
}

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
   * Relative import path for components discovered from local project files
   * (custom, non-npm component libraries). Null for npm package components.
   */
  protected getLocalImportPath(
    component: DiscoveredComponent,
    config: StoryUIConfig
  ): string | null {
    const filePath = component.filePath;
    if (!filePath || filePath.includes('node_modules')) return null;
    if (!nodePath.isAbsolute(filePath) || !fs.existsSync(filePath)) return null;

    const generatedDir = nodePath.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated/');
    let relative = nodePath.relative(generatedDir, filePath).split(nodePath.sep).join('/');
    relative = relative.replace(/\.(tsx|jsx|ts|js|vue|svelte)$/, '');
    if (!relative.startsWith('.')) relative = './' + relative;
    return relative;
  }

  /**
   * Format a single component entry
   */
  protected formatComponentEntry(
    component: DiscoveredComponent,
    config: StoryUIConfig
  ): string {
    const importPath = this.getImportPath(component, config);
    const isLocal = !!this.getLocalImportPath(component, config);
    let entry = `- **${component.name}** (import from '${importPath}')${isLocal ? ' — CUSTOM PROJECT COMPONENT, fully allowed; use this exact relative import' : ''}`;

    if (component.props && component.props.length > 0) {
      // Props are the only signal the model has for what a component can
      // actually do, so surface the ones that decide behavior first. Truncating
      // at an arbitrary 5 routinely cut exactly the props that distinguish an
      // interactive component from a presentational one (active, onChange,
      // leftSection, value), which is the choice we most need it to get right.
      const ranked = rankPropsByRelevance(component.props);
      const shown = ranked.slice(0, MAX_PROPS_IN_CATALOG);
      entry += `\n  Props: ${shown.join(', ')}${ranked.length > shown.length ? `, …${ranked.length - shown.length} more` : ''}`;
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

    // Custom in-project components (discovered from local source files, not an
    // npm package) must be imported via their real relative path from the
    // generated-stories directory — never via the library import path.
    const localPath = this.getLocalImportPath(component, config);
    if (localPath) {
      return localPath;
    }

    const basePath = config.importPath || 'unknown';

    // If using individual imports, convert component name to kebab-case file path
    if (config.importStyle === 'individual') {
      // Find the base component name (for sub-components like CardHeader, use Card)
      const baseComponentName = this.getBaseComponentName(component.name);
      const kebabName = this.toKebabCase(baseComponentName);
      const result = `${basePath}/${kebabName}`;
      console.log(`[DEBUG] getImportPath: ${component.name} -> ${result} (importStyle=${config.importStyle})`);
      return result;
    }

    console.log(`[DEBUG] getImportPath: ${component.name} -> ${basePath} (importStyle=${config.importStyle})`);
    // Fall back to import path from config (barrel import)
    return basePath;
  }

  /**
   * Convert PascalCase to kebab-case
   */
  protected toKebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /**
   * Get the base component name (for sub-components like CardHeader, returns 'Card')
   */
  protected getBaseComponentName(componentName: string): string {
    // Common sub-component patterns in shadcn/ui and other design systems
    const subComponentPatterns = [
      // Card sub-components
      /^(Card)(Header|Footer|Title|Action|Description|Content)$/,
      // Dialog sub-components
      /^(Dialog)(Close|Content|Description|Footer|Header|Overlay|Portal|Title|Trigger)$/,
      // Alert Dialog sub-components
      /^(AlertDialog)(Portal|Overlay|Trigger|Content|Header|Footer|Title|Description|Action|Cancel)$/,
      // Dropdown Menu sub-components
      /^(DropdownMenu)(Portal|Trigger|Content|Group|Label|Item|CheckboxItem|RadioGroup|RadioItem|Separator|Shortcut|Sub|SubTrigger|SubContent)$/,
      // Context Menu sub-components
      /^(ContextMenu)(Trigger|Content|Item|CheckboxItem|RadioItem|Label|Separator|Shortcut|Group|Portal|Sub|SubContent|SubTrigger|RadioGroup)$/,
      // Navigation Menu sub-components
      /^(NavigationMenu)(List|Item|Content|Trigger|Link|Indicator|Viewport)$/,
      // Select sub-components
      /^(Select)(Content|Group|Item|Label|ScrollDownButton|ScrollUpButton|Separator|Trigger|Value)$/,
      // Menubar sub-components
      /^(Menubar)(Portal|Menu|Trigger|Content|Group|Separator|Label|Item|Shortcut|CheckboxItem|RadioGroup|RadioItem|Sub|SubTrigger|SubContent)$/,
      // Accordion sub-components
      /^(Accordion)(Item|Trigger|Content)$/,
      // Tabs sub-components
      /^(Tabs)(List|Trigger|Content)$/,
      // Sheet sub-components
      /^(Sheet)(Trigger|Close|Content|Header|Footer|Title|Description)$/,
      // Avatar sub-components
      /^(Avatar)(Image|Fallback)$/,
      // Breadcrumb sub-components
      /^(Breadcrumb)(List|Item|Link|Page|Separator|Ellipsis)$/,
      // Command sub-components
      /^(Command)(Dialog|Input|List|Empty|Group|Item|Shortcut|Separator)$/,
      // Hover Card sub-components
      /^(HoverCard)(Trigger|Content)$/,
      // Popover sub-components
      /^(Popover)(Trigger|Content|Anchor)$/,
      // Collapsible sub-components
      /^(Collapsible)(Trigger|Content)$/,
      // Drawer sub-components
      /^(Drawer)(Portal|Overlay|Trigger|Close|Content|Header|Footer|Title|Description)$/,
      // Radio Group sub-components
      /^(RadioGroup)(Item)$/,
      // Toggle Group sub-components
      /^(ToggleGroup)(Item)$/,
      // Tooltip sub-components
      /^(Tooltip)(Trigger|Content|Provider)$/,
      // Table sub-components
      /^(Table)(Header|Body|Footer|Head|Row|Cell|Caption)$/,
      // Input OTP sub-components
      /^(InputOTP)(Group|Slot|Separator)$/,
      // Resizable sub-components
      /^(Resizable)(PanelGroup|Panel|Handle)$/,
      // Scroll Area sub-components
      /^(ScrollArea|ScrollBar)$/,
      // Pagination sub-components
      /^(Pagination)(Content|Link|Item|Previous|Next|Ellipsis)$/,
      // Alert sub-components
      /^(Alert)(Title|Description)$/,
    ];

    for (const pattern of subComponentPatterns) {
      const match = componentName.match(pattern);
      if (match) {
        return match[1]; // Return the base component name
      }
    }

    // No match found, return original name
    return componentName;
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

INTERACTION FIDELITY (NON-NEGOTIABLE):
These stories are lifted directly into product code by engineers. A mockup that merely
looks right is a defect. Rules are written in terms of AFFORDANCES — map each one to the
component in THIS design system that owns that behavior (see the available components list
and any design-system considerations provided below).

1. NEVER fake an affordance. If a user would click it, type in it, toggle it, or select it,
   it MUST be the real interactive component, with a handler and an accessible name:
   - a search or text entry field -> the library's text input component, NEVER text or a
     box styled to look like an input
   - an icon-only control -> the library's icon-button component wrapping the icon, NEVER a
     bare icon element
   - a dropdown, chevron, overflow or "more" affordance -> the library's menu component with
     its trigger and content sub-components, NEVER a chevron glyph beside a label
   - a navigation item that can be current -> the library's nav/link component with its
     active or selected state, NEVER static text with a color applied
   - a tabbed region -> the library's tabs component, NEVER a row of labels with a border
   - any other clickable surface -> a real button element or the library's unstyled-button
     primitive, NEVER a div or box with an onClick

2. Decorative icons are fine. An icon is EITHER decorative, OR the leading/trailing slot of a
   real control, OR the child of an icon-button. It is never interactive on its own.

3. Icons must be aligned by the owning component. Use the component's built-in icon/section
   slot when one exists; otherwise use the library's inline flex primitive. Never place an
   icon as a bare child of a block-level element — it will sit on the text baseline and
   drift out of alignment.

4. State must be real and driven. When a composition renders several items and one is
   current/selected/open, drive it from a variable (component state), not a hardcoded
   literal, and wire the handler that changes it. Single-component variant stories that
   demonstrate one state in isolation should use story args instead.

5. Before emitting, self-check every element: is anything that looks interactive actually
   inert? is any icon unaligned or standing in for a button? is any hover/active appearance
   being faked with a static style? Fix all three before you output.

IMAGE RULES:
- Use Lorem Picsum for placeholder images: https://picsum.photos/[width]/[height]
- Always include alt text for images
- Example: https://picsum.photos/400/300?random=1

MANDATORY SPACING & LAYOUT RULES (NON-NEGOTIABLE):
** CRITICAL: Every generated component MUST have professional-quality spacing. Components without proper spacing look broken and unprofessional. **

** SCOPE LIMIT — READ BEFORE COPYING THE EXAMPLES BELOW **
The inline style objects shown in this section are for STATIC LAYOUT SPACING ONLY.
An inline style object cannot express :hover, :focus-visible, :active, [data-active],
[aria-current] or any other state — it is structurally incapable of it.
Therefore: any element whose appearance CHANGES on hover, focus, selection, or because it
is the current item MUST get that appearance from the design system itself:
  1. a component prop that owns the state (active, selected, variant, color, disabled), or
  2. the component's documented state mechanism (data attributes, styles API, CSS variables).
If you cannot express a state with a prop, you have chosen the wrong component — pick the
component that owns that behavior. NEVER hand-roll a hover or active state inline, and never
substitute a styled static element for a component that already has the state built in.

** WHEN A COMPONENT PROP GENUINELY CANNOT EXPRESS THE STATE **
You may emit ONE additional fenced \`css\` code block after the story. Write it as a CSS
module and import it in the story with exactly this specifier:

    import classes from './styles.module.css';

(the import is rewritten to the real filename when the story is saved — always write
'./styles.module.css' verbatim). Use it for :hover, :focus-visible, :active,
[data-active] and media queries, and apply it through the design system's own
className/classNames prop.

Only do this when a prop truly cannot express the state. A component prop is always the
better answer, and a stylesheet that merely restates what a prop already does is worse
than not writing one. Reference design-system tokens/CSS variables inside it rather than
hardcoded colors, so the result still inherits theming and dark mode.

1. STORY WRAPPER (REQUIRED for every story):
   - The rendered story MUST have a wrapper element with padding
   - Pattern: ${this.getSpacingExample('wrapper')}
   - This ensures content has breathing room within the Storybook canvas

2. FORM FIELD SPACING (CRITICAL):
   - ALWAYS wrap form fields in a container with vertical spacing
   - Use flexbox column with gap: ${this.getSpacingExample('formGap')}
   - Or use design system spacing tokens if available
   - MINIMUM 16px gap between form fields

3. BUTTON SPACING:
   - Submit/action buttons: 24px margin-top from form fields above
   - Pattern: ${this.getSpacingExample('buttonMargin')}
   - Button groups should be wrapped with margin-top from content

4. SECTION SPACING:
   - Between major sections: 32-48px
   - Between related content groups: 24px
   - Use dividers or significant whitespace between unrelated content

5. HEADING SPACING:
   - More space ABOVE headings (24-32px) than below (8-16px)

6. CARD/CONTAINER PADDING:
   - Internal padding: minimum 16px, preferred 24px

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

  /**
   * Framework-appropriate syntax for the spacing examples embedded in the
   * common rules. JSX style objects only make sense for React; the other
   * frameworks get examples in their own template syntax.
   */
  protected getSpacingExample(kind: 'wrapper' | 'formGap' | 'buttonMargin'): string {
    switch (this.type) {
      case 'vue':
        return {
          wrapper: `template: '<div style="padding: 24px">...content...</div>'`,
          formGap: `<div style="display: flex; flex-direction: column; gap: 16px">`,
          buttonMargin: `<div style="margin-top: 24px"><v-btn>Submit</v-btn></div>`,
        }[kind];
      case 'angular':
        return {
          wrapper: `template: \`<div style="padding: 24px">...content...</div>\``,
          formGap: `<div style="display: flex; flex-direction: column; gap: 16px">`,
          buttonMargin: `<div style="margin-top: 24px"><button mat-raised-button>Submit</button></div>`,
        }[kind];
      case 'svelte':
        return {
          wrapper: `<Story name="..."><div style="padding: 24px">...content...</div></Story>`,
          formGap: `<div style="display: flex; flex-direction: column; gap: 16px">`,
          buttonMargin: `<div style="margin-top: 24px"><Button>Submit</Button></div>`,
        }[kind];
      case 'web-components':
        return {
          wrapper: 'render: () => html`<div style="padding: 24px">...content...</div>`',
          formGap: `<div style="display: flex; flex-direction: column; gap: 16px">`,
          buttonMargin: `<div style="margin-top: 24px"><sl-button>Submit</sl-button></div>`,
        }[kind];
      default: // react
        return {
          wrapper: `render: () => <div style={{ padding: "24px" }}>...content...</div>`,
          formGap: `<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>`,
          buttonMargin: `<div style={{ marginTop: "24px" }}><Button>Submit</Button></div>`,
        }[kind];
    }
  }
}
