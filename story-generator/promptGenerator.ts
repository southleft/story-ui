import { StoryUIConfig } from '../story-ui.config.js';
import { DiscoveredComponent } from './componentDiscovery.js';
import { EnhancedComponentDiscovery } from './enhancedComponentDiscovery.js';
import { loadConsiderations, considerationsToPrompt } from './considerationsLoader.js';
import { DocumentationLoader } from './documentationLoader.js';
import {
  getAdapterRegistry,
  FrameworkPrompt,
  StoryGenerationOptions,
  FrameworkType,
  FrameworkAdapter,
} from './framework-adapters/index.js';

/**
 * Extended prompt interface that includes framework information
 * Uses string[] for layoutInstructions instead of string
 */
export interface FrameworkAwarePrompt extends Omit<FrameworkPrompt, 'layoutInstructions'> {
  layoutInstructions: string[];
}

export interface GeneratedPrompt {
  systemPrompt: string;
  componentReference: string;
  layoutInstructions: string[];
  examples: string[];
  sampleStory: string;
}

/**
 * Generates a comprehensive AI prompt based on the configuration and discovered components
 */
export function generatePrompt(config: StoryUIConfig, components: DiscoveredComponent[]): GeneratedPrompt {
  const componentReference = generateComponentReference(components, config);
  const layoutInstructions = generateLayoutInstructions(config);
  const examples = generateExamples(config);
  const systemPrompt = generateSystemPrompt(config);
  const sampleStory = config.sampleStory || generateDefaultSampleStory(config, components);

  return {
    systemPrompt,
    componentReference,
    layoutInstructions,
    examples,
    sampleStory
  };
}

/**
 * Generates the system prompt based on configuration
 */
function generateSystemPrompt(config: StoryUIConfig): string {
  if (config.systemPrompt) {
    return config.systemPrompt;
  }

  const componentSystemName = config.componentPrefix ?
    `${config.componentPrefix.replace(/^[A-Z]+/, '')} design system` :
    'component library';

  // Get the library name for prominent constraint
  const libraryName = config.designSystemGuidelines?.name || config.importPath || 'configured library';
  const importPath = config.importPath || 'your-library';

  return `
╔════════════════════════════════════════════════════════════════════╗
║                    🚨 MANDATORY LIBRARY CONSTRAINT 🚨                ║
╠════════════════════════════════════════════════════════════════════╣
║  REQUIRED LIBRARY: ${libraryName.padEnd(46)}║
║  IMPORT PATH:      ${importPath.padEnd(46)}║
╠════════════════════════════════════════════════════════════════════╣
║  ALL component imports MUST use:                                   ║
║  import { ComponentName } from '${importPath}';${' '.repeat(Math.max(0, 32 - importPath.length))}║
╠════════════════════════════════════════════════════════════════════╣
║  🚫 FORBIDDEN LIBRARIES - DO NOT USE:                              ║
║  - tamagui, @tamagui/core (NEVER USE)                              ║
║  - @chakra-ui/react (unless configured)                            ║
║  - @mui/material (unless configured)                               ║
║  - antd (unless configured)                                        ║
║  - Any library NOT matching: ${importPath.padEnd(36)}║
╚════════════════════════════════════════════════════════════════════╝

🚨 CRITICAL: EVERY STORY MUST START WITH "import React from 'react';" AS THE FIRST LINE 🚨

🔴 CRITICAL RULE: NEVER use children in args for ANY component or layout. Always use render functions. 🔴

You are an expert UI developer creating Storybook stories. Use ONLY the React components from the ${componentSystemName} listed below.

🔴 MANDATORY FIRST LINE - NO EXCEPTIONS:
The VERY FIRST LINE of every story file MUST be:
import React from 'react';

CRITICAL IMPORT RULES - MUST FOLLOW EXACTLY:
1. **LINE 1: import React from 'react';** (MANDATORY - NEVER SKIP THIS)
2. **LINE 2: import type { StoryObj } from '@storybook/[framework]';**
3. **LINE 3: import { ComponentName } from '[your-import-path]';**

⚠️  WITHOUT "import React from 'react';" THE STORY WILL FAIL WITH "React is not defined" ERROR ⚠️

🚨 COMPONENT IMPORT VALIDATION - CRITICAL 🚨
You can ONLY import components that are explicitly listed in the "Available components" section below.
ANY component not in that list DOES NOT EXIST and will cause import errors.
Before importing any component, verify it exists in the Available components list.
If a component is not listed, DO NOT use it - choose an alternative from the available list.

🔴 IMPORT PATH RULE - MANDATORY 🔴
ALWAYS use the EXACT import path shown in parentheses after each component name.
For example: If the Available components list shows "Button (import from 'antd')", 
you MUST use: import { Button } from 'antd';
NEVER use the main package import if a specific path is shown.
This is critical for proper component resolution.

Example correct order:
import React from 'react';
import type { StoryObj } from '@storybook/[framework]';
import { ComponentName } from '[your-import-path]';

2. Use the correct Storybook framework import for your environment
3. ONLY import components that are explicitly listed in the "Available components" section below
4. Do NOT create or import any components that are not in the list
5. Do NOT import story exports from other story files
6. When in doubt, use the basic components listed below

REQUIRED STORY STRUCTURE:
Every story MUST start with these three imports in this order:
1. import React from 'react';
2. import type { StoryObj } from '@storybook/[framework]';
3. import { ComponentName } from '[library-path]';

GENERAL COMPONENT RULES:
- StoryUIPanel is the Story UI interface, not a design system component - never import it
- Do not import components that end with Story, Example, Demo, or that appear to be story exports
- Only use components explicitly listed in the available components section

CRITICAL STORY FORMAT RULES:
- Use ES modules syntax for exports: "export default meta;" NOT "module.exports = meta;"
- Every story file MUST have a default export with the meta object
- Follow the Component Story Format (CSF) 3.0 standard

IMPORTANT IMAGE RULES:
- When using image components or <img> tags, ALWAYS include a src attribute
- Use Lorem Picsum for all placeholder images: https://picsum.photos/[width]/[height] (e.g., https://picsum.photos/300/200)
- You can add random variation with: https://picsum.photos/300/200?random=1
- Never create <img> tags without a src attribute

STORY STRUCTURE RULES:
- NEVER pass children through args for ANY component - this breaks story rendering
- Always use render functions: render: () => (<YourLayout />)
- For layouts with multiple components, DO NOT set component in meta
- Only set component in meta when showcasing a SINGLE component's variations
- Examples of what NOT to do:
  ❌ args: { children: <div>content</div> }
  ❌ args: { children: (<><Component1 /><Component2 /></>) }
  ✅ render: () => (<div><Component1 /><Component2 /></div>)

SPACING AND LAYOUT RULES:
- Use the layout components provided in the component library when available
- If no layout components are available, use appropriate HTML elements with inline styles
- Follow the design system's spacing and styling conventions
- Use the component library's design tokens and spacing system when available`;
}

/**
 * Generates component reference documentation
 */
function generateComponentReference(components: DiscoveredComponent[], config: StoryUIConfig): string {
  let reference = '';

  // Group components by category
  const componentsByCategory = components.reduce((acc, component) => {
    if (!acc[component.category]) {
      acc[component.category] = [];
    }
    acc[component.category].push(component);
    return acc;
  }, {} as Record<string, DiscoveredComponent[]>);

  // Layout components first (most important for multi-column layouts)
  if (componentsByCategory.layout) {
    reference += 'LAYOUT COMPONENTS (for multi-column layouts, grids, etc.):\n';
    for (const component of componentsByCategory.layout) {
      reference += formatComponentReference(component, config);
    }
    reference += '\n';
  }

  // Other categories
  const categoryOrder = ['content', 'form', 'navigation', 'feedback', 'other'];
  for (const category of categoryOrder) {
    if (componentsByCategory[category] && componentsByCategory[category].length > 0) {
      reference += `${category.toUpperCase()} COMPONENTS:\n`;
      for (const component of componentsByCategory[category]) {
        reference += formatComponentReference(component, config);
      }
      reference += '\n';
    }
  }

  return reference;
}

/**
 * Formats a single component reference
 */
function formatComponentReference(component: DiscoveredComponent, config: StoryUIConfig): string {
  let reference = `- ${component.name}`;

  // Add import path information if available
  if (component.__componentPath) {
    reference += ` (import from '${component.__componentPath}')`;
  }

  if (component.props && component.props.length > 0) {
    reference += `: Props: ${component.props.join(', ')}`;
  }

  if (component.slots && component.slots.length > 0) {
    reference += `. Slots: ${component.slots.join(', ')}`;
  }

  if (component.description && component.description !== `${component.name} component`) {
    reference += ` - ${component.description}`;
  }

  // Add specific usage notes for layout components
  if (component.category === 'layout' && component.name && typeof component.name === 'string') {
    if (component.name.toLowerCase().includes('layout') && !component.name.toLowerCase().includes('section')) {
      reference += ' - Use as main wrapper for multi-column layouts';
    } else if (component.name.toLowerCase().includes('section')) {
      reference += ' - Use inside layout wrapper for individual columns';
    }
  }


  reference += '\n';
  return reference;
}

/**
 * Generates layout-specific instructions
 */
function generateLayoutInstructions(config: StoryUIConfig): string[] {
  const instructions: string[] = [];
  const layoutRules = config.layoutRules;

  if (layoutRules.multiColumnWrapper && layoutRules.columnComponent) {
    instructions.push('CRITICAL LAYOUT RULES:');
    instructions.push(`- For ANY multi-column layout (2, 3, or more columns), use ${layoutRules.multiColumnWrapper} components`);
    instructions.push(`- Each column must be wrapped in its own ${layoutRules.columnComponent} element`);
    instructions.push(`- Structure: <${layoutRules.multiColumnWrapper}><${layoutRules.columnComponent}>column 1</${layoutRules.columnComponent}><${layoutRules.columnComponent}>column 2</${layoutRules.columnComponent}></${layoutRules.multiColumnWrapper}>`);
    instructions.push(`- Use component library styling approach (className, style props, or design tokens as appropriate)`);
    instructions.push(`- NEVER use CSS properties as props (like display="grid" or gridTemplateColumns) - these are not valid props`);
    instructions.push(`- For grid-like layouts, use Flex with wrap prop and appropriate gap, NOT CSS Grid`);
    instructions.push(`- The ${layoutRules.multiColumnWrapper} should be the main component in your story for multi-column layouts`);
  }

  if (layoutRules.prohibitedElements && layoutRules.prohibitedElements.length > 0) {
    instructions.push(`- NEVER use plain HTML ${layoutRules.prohibitedElements.join(', ')} elements - ALWAYS use the provided design system components`);
  }

  // Generic layout instructions for all design systems
  instructions.push(`- Use semantic heading components from your design system instead of raw <h1>-<h6> tags`);
  instructions.push(`- Use the design system's layout components and spacing tokens instead of inline styles`);
  instructions.push(`- Prefer design system components over plain HTML elements for consistent styling`);

  return instructions;
}

/**
 * Generates layout examples
 */
function generateExamples(config: StoryUIConfig): string[] {
  const examples: string[] = [];
  const layoutExamples = config.layoutRules.layoutExamples;

  if (layoutExamples) {
    examples.push('EXAMPLES:');
    examples.push('');

    if (layoutExamples.twoColumn) {
      examples.push('Two-column layout:');
      examples.push(layoutExamples.twoColumn);
      examples.push('');
    }

    if (layoutExamples.threeColumn) {
      examples.push('Three-column layout:');
      examples.push(layoutExamples.threeColumn);
      examples.push('');
    }

    if (layoutExamples.grid) {
      examples.push('Grid layout:');
      examples.push(layoutExamples.grid);
      examples.push('');
    }

    // Add image-specific examples
    examples.push('Image usage examples:');
    examples.push('// Always include src attribute with placeholder images:');
    examples.push('<img src="https://picsum.photos/300/200" alt="Placeholder image" />');
    examples.push('// For different random images:');
    examples.push('<img src="https://picsum.photos/400/300?random=1" alt="Random image" style={{width: "100%", height: "auto"}} />');
    examples.push('');
    
    // Add proper story structure examples
    examples.push('Proper story structure examples:');
    examples.push('');
    examples.push('// CORRECT - Layout with multiple components:');
    examples.push('const meta = {');
    examples.push('  title: "Generated/Homepage Hero",');
    examples.push('  parameters: { layout: "fullscreen" },');
    examples.push('  // NO component field for layouts!');
    examples.push('} satisfies Meta;');
    examples.push('');
    examples.push('export const Default: Story = {');
    examples.push('  render: () => (');
    examples.push('    <div>');
    examples.push('      <Banner title="Sale!" variant="success" />');
    examples.push('      <div className="hero-section">');
    examples.push('        <h1>Welcome</h1>');
    examples.push('      </div>');
    examples.push('    </div>');
    examples.push('  )');
    examples.push('};');
    examples.push('');
    examples.push('// WRONG - Never use children in args:');
    examples.push('export const Wrong: Story = {');
    examples.push('  args: {');
    examples.push('    children: ( // ❌ NEVER DO THIS');
    examples.push('      <div>content</div>');
    examples.push('    )');
    examples.push('  }');
    examples.push('};');
    examples.push('');
    examples.push('// CORRECT - Single component showcase:');
    examples.push('const meta = {');
    examples.push('  title: "Generated/Banner Variations",');
    examples.push('  component: Banner, // ✓ OK for single component');
    examples.push('} satisfies Meta<typeof Banner>;');
    examples.push('');
    examples.push('export const InfoBanner: Story = {');
    examples.push('  args: {');
    examples.push('    title: "Information",');
    examples.push('    variant: "info"');
    examples.push('  }');
    examples.push('};');
    examples.push('');
  }

  return examples;
}

/**
 * Generates import statements, using individual import paths if available
 */
function generateImportStatements(config: StoryUIConfig, components: DiscoveredComponent[], componentNames: string[]): string {
  const importMap = new Map<string, string[]>();
  
  for (const componentName of componentNames) {
    // Find the component in our discovered components to get its specific import path
    const component = components.find(c => c.name === componentName);
    
    if (component && typeof component === 'object' && '__componentPath' in component) {
      // Use the discovered component's specific import path
      const importPath = component.__componentPath as string;
      if (!importMap.has(importPath)) {
        importMap.set(importPath, []);
      }
      importMap.get(importPath)!.push(componentName);
    } else {
      // Fallback to the main package import path
      if (!importMap.has(config.importPath)) {
        importMap.set(config.importPath, []);
      }
      importMap.get(config.importPath)!.push(componentName);
    }
  }
  
  // Generate import statements
  const importLines: string[] = [];
  for (const [importPath, components] of importMap) {
    importLines.push(`import { ${components.join(', ')} } from '${importPath}';`);
  }
  
  return importLines.join('\n');
}

/**
 * Generates a default sample story if none provided
 */
function generateDefaultSampleStory(config: StoryUIConfig, components: DiscoveredComponent[]): string {
  const layoutComponent = components.find(c => c.category === 'layout' && c.name && typeof c.name === 'string' && !c.name.toLowerCase().includes('section'));
  const sectionComponent = components.find(c => c.category === 'layout' && c.name && typeof c.name === 'string' && c.name.toLowerCase().includes('section'));
  const contentComponent = components.find(c => c.category === 'content');

  const mainComponent = layoutComponent?.name || contentComponent?.name || components[0]?.name || 'div';
  const imports = [mainComponent];

  if (sectionComponent) imports.push(sectionComponent.name);
  if (contentComponent && contentComponent.name !== mainComponent) imports.push(contentComponent.name);

  const importStatement = generateImportStatements(config, components, imports);

  let renderContent = '';
  if (layoutComponent && sectionComponent) {
    renderContent = `
    <${layoutComponent.name}>
      <${sectionComponent.name}>
        ${contentComponent ? `<${contentComponent.name}>Sample content</${contentComponent.name}>` : 'Sample content'}
      </${sectionComponent.name}>
    </${layoutComponent.name}>`;
  } else if (contentComponent) {
    renderContent = `<${contentComponent.name}>Sample content</${contentComponent.name}>`;
  } else {
    renderContent = '<div>Sample content</div>';
  }

  const storybookFramework = config.storybookFramework || '@storybook/react';
  
  // For layouts, don't set a component in meta
  const isLayout = layoutComponent || renderContent.includes('<div');
  
  if (isLayout) {
    return `import React from 'react';
import type { Meta, StoryObj } from '${storybookFramework}';
${importStatement}

const meta = {
  title: 'Generated/Sample Layout',
  parameters: {
    layout: 'centered',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (${renderContent}
  )
};`
  } else {
    return `import React from 'react';
import type { Meta, StoryObj } from '${storybookFramework}';
${importStatement}

const meta = {
  title: 'Generated/Sample Component',
  component: ${mainComponent},
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof ${mainComponent}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    // Add component props here
  }
};`
  }
}

/**
 * Builds the complete Claude prompt
 */
export async function buildClaudePrompt(
  userPrompt: string,
  config: StoryUIConfig,
  components: DiscoveredComponent[]
): Promise<string> {
  const generated = generatePrompt(config, components);

  const promptParts = [
    generated.systemPrompt,
    '',
  ];

  // Load documentation - try new directory-based approach first
  const projectRoot = config.considerationsPath ?
    config.considerationsPath.replace(/\/story-ui-considerations\.(md|json)$/, '') :
    process.cwd();

  const docLoader = new DocumentationLoader(projectRoot);
  let documentationAdded = false;

  if (docLoader.hasDocumentation()) {
    const docs = await docLoader.loadDocumentation();
    if (docs.sources.length > 0) {
      const docPrompt = docLoader.formatForPrompt(docs);
      if (docPrompt) {
        promptParts.push(docPrompt);
        promptParts.push('');
        documentationAdded = true;
      }
    }
  }

  // Fall back to legacy considerations file if no directory-based docs
  if (!documentationAdded) {
    const considerations = loadConsiderations(config.considerationsPath);
    if (considerations) {
      const considerationsPrompt = considerationsToPrompt(considerations);
      if (considerationsPrompt) {
        promptParts.push(considerationsPrompt);
        promptParts.push('');
      }
    }
  }

  promptParts.push(
    ...generated.layoutInstructions,
    '',
    'Available components:',
    generated.componentReference,
    ...generated.examples,
  );

  // Add additional imports information if configured
  if (config.additionalImports && config.additionalImports.length > 0) {
    promptParts.push('');
    promptParts.push('ADDITIONAL IMPORT EXAMPLES - COPY THESE EXACTLY:');
    config.additionalImports.forEach(additionalImport => {
      // For each import path, show the exact syntax
      const componentExamples = additionalImport.components.map(componentName => {
        // Check if this component has specific import type information
        // Look in both components and layoutComponents arrays
        let componentConfig = config.components?.find(c => c.name === componentName);
        if (!componentConfig) {
          componentConfig = config.layoutComponents?.find(c => c.name === componentName);
        }
        
        // Use runtime check for importType since it may not be in TypeScript interface
        if (componentConfig && (componentConfig as any).importType === 'default') {
          return `import ${componentName} from '${additionalImport.path}';`;
        } else {
          return `import { ${componentName} } from '${additionalImport.path}';`;
        }
      });
      
      componentExamples.forEach(example => {
        promptParts.push(`- ${example}`);
      });
    });
  }

  // Icons and other specific imports should be handled through additionalImports or considerations

  // Reinforce NO children in args rule
  promptParts.push(
    '',
    '🔴 CRITICAL REMINDER: NEVER use children in args 🔴',
    'Always use render functions for any layout or component composition.',
    ''
  );

  promptParts.push(
    `Output a complete Storybook story file in TypeScript. Import components as shown in the sample template below. Use the following sample as a template. Respond ONLY with a single code block containing the full file, and nothing else.`,
    '',
    '<rules>',
    '🚨 FINAL CRITICAL REMINDERS 🚨',
    "🔴 FIRST LINE MUST BE: import React from 'react';",
    '🔴 WITHOUT THIS IMPORT, THE STORY WILL BREAK!',
    '',
    'OTHER CRITICAL RULES:',
    '- Story title MUST always start with "Generated/" (e.g., title: "Generated/Recipe Card")',
    '- Do NOT use prefixes like "Content/", "Components/", or any other section name',
    '- ONLY import components that are listed in the "Available components" section',
    '- ALWAYS use the exact import path shown in parentheses after each component',
    '- NEVER use main package imports when specific subpath imports are shown',
    '- Do NOT import story exports - these are NOT real components',
    '- Check every import against the Available components list before using it',
    '- FORBIDDEN: Any component not explicitly listed in the Available components section',
    '- FORBIDDEN: Theme setup components (providers should be configured at the app level, not in individual stories)',
    '- All images MUST have a src attribute with placeholder URLs (use https://picsum.photos/)',
    '- Never create <img> tags without src attributes',
    '- MUST use ES modules syntax: "export default meta;" NOT "module.exports = meta;"',
    '- The file MUST have a default export for the meta object',
    '- Keep the story concise and focused - avoid overly complex layouts that might exceed token limits',
    '- Ensure all JSX tags are properly closed',
    '- Story must be complete and syntactically valid',
    '- CRITICAL: Never put ANY content in args.children - always use render function',
    '- Use render functions for ALL layouts and component compositions',
    '- For layouts: DO NOT set component in meta',
    '- Only set component in meta when showcasing a SINGLE component',
    '- Use appropriate styling for the component library (design tokens, className, or inline styles as needed)',
    '</rules>',
    '',
    'Sample story format:',
    generated.sampleStory,
    '',
    'User request:',
    userPrompt
  );

  return promptParts.join('\n');
}

/**
 * Generates a framework-aware prompt using the adapter system
 * This is the new multi-framework entry point
 */
export async function generateFrameworkAwarePrompt(
  config: StoryUIConfig,
  components: DiscoveredComponent[],
  options?: StoryGenerationOptions
): Promise<FrameworkAwarePrompt> {
  const registry = getAdapterRegistry();

  // Get the appropriate adapter (auto-detect or use specified framework)
  let adapter: FrameworkAdapter;
  if (options?.framework) {
    adapter = registry.getAdapter(options.framework);
  } else {
    adapter = await registry.autoDetect(process.cwd());
  }

  // Generate framework-specific prompt components
  const frameworkPrompt = await registry.generatePrompt(config, components, options);

  // Generate layout instructions (framework-agnostic)
  const layoutInstructions = generateLayoutInstructions(config);

  return {
    ...frameworkPrompt,
    layoutInstructions,
  };
}

/**
 * Builds a complete LLM prompt with framework awareness
 * This is the new multi-framework entry point for building complete prompts
 */
export async function buildFrameworkAwarePrompt(
  userPrompt: string,
  config: StoryUIConfig,
  components: DiscoveredComponent[],
  options?: StoryGenerationOptions
): Promise<string> {
  const generated = await generateFrameworkAwarePrompt(config, components, options);

  const promptParts = [
    generated.systemPrompt,
    '',
  ];

  // Load documentation - try new directory-based approach first
  const projectRoot = config.considerationsPath ?
    config.considerationsPath.replace(/\/story-ui-considerations\.(md|json)$/, '') :
    process.cwd();

  const docLoader = new DocumentationLoader(projectRoot);
  let documentationAdded = false;

  if (docLoader.hasDocumentation()) {
    const docs = await docLoader.loadDocumentation();
    if (docs.sources.length > 0) {
      const docPrompt = docLoader.formatForPrompt(docs);
      if (docPrompt) {
        promptParts.push(docPrompt);
        promptParts.push('');
        documentationAdded = true;
      }
    }
  }

  // Fall back to legacy considerations file if no directory-based docs
  if (!documentationAdded) {
    const considerations = loadConsiderations(config.considerationsPath);
    if (considerations) {
      const considerationsPrompt = considerationsToPrompt(considerations);
      if (considerationsPrompt) {
        promptParts.push(considerationsPrompt);
        promptParts.push('');
      }
    }
  }

  promptParts.push(
    ...generated.layoutInstructions,
    '',
    'Available components:',
    generated.componentReference,
    '',
    generated.examples,
  );

  // Add additional imports information if configured
  if (config.additionalImports && config.additionalImports.length > 0) {
    promptParts.push('');
    promptParts.push('ADDITIONAL IMPORT EXAMPLES - COPY THESE EXACTLY:');
    config.additionalImports.forEach(additionalImport => {
      const componentExamples = additionalImport.components.map(componentName => {
        let componentConfig = config.components?.find(c => c.name === componentName);
        if (!componentConfig) {
          componentConfig = config.layoutComponents?.find(c => c.name === componentName);
        }

        if (componentConfig && (componentConfig as any).importType === 'default') {
          return `import ${componentName} from '${additionalImport.path}';`;
        } else {
          return `import { ${componentName} } from '${additionalImport.path}';`;
        }
      });

      componentExamples.forEach(example => {
        promptParts.push(`- ${example}`);
      });
    });
  }

  // Add framework-specific rules
  const frameworkType = generated.framework.componentFramework;
  const frameworkRules = getFrameworkSpecificRules(frameworkType);
  if (frameworkRules.length > 0) {
    promptParts.push('');
    promptParts.push(`${frameworkType.toUpperCase()} SPECIFIC RULES:`);
    promptParts.push(...frameworkRules);
  }

  promptParts.push(
    '',
    `Output a complete Storybook story file in TypeScript. Import components as shown in the sample template below. Use the following sample as a template. Respond ONLY with a single code block containing the full file, and nothing else.`,
    '',
    '<rules>',
    'CRITICAL REMINDERS:',
    '- Story title MUST always start with "Generated/" (e.g., title: "Generated/Recipe Card")',
    '- ONLY import components that are listed in the "Available components" section',
    '- ALWAYS use the exact import path shown in parentheses after each component',
    '- NEVER use main package imports when specific subpath imports are shown',
    '- Do NOT import story exports - these are NOT real components',
    '- All images MUST have a src attribute with placeholder URLs (use https://picsum.photos/)',
    '- MUST use ES modules syntax: "export default meta;" NOT "module.exports = meta;"',
    '- The file MUST have a default export for the meta object',
    '- Keep the story concise and focused - avoid overly complex layouts',
    '- Ensure all tags are properly closed and syntax is valid',
    '- Story must be complete and syntactically valid',
    '</rules>',
    '',
    'Sample story format:',
    generated.sampleStory,
    '',
    'User request:',
    userPrompt
  );

  return promptParts.join('\n');
}

/**
 * Get framework-specific rules to include in the prompt
 */
function getFrameworkSpecificRules(framework: FrameworkType): string[] {
  const rules: string[] = [];

  switch (framework) {
    case 'react':
      rules.push("- FIRST LINE MUST BE: import React from 'react';");
      rules.push('- Use JSX syntax for templates');
      rules.push('- NEVER pass children through args - use render functions');
      rules.push('- For layouts with multiple components, DO NOT set component in meta');
      break;

    case 'vue':
      rules.push("- Import from '@storybook/vue3'");
      rules.push('- Use Vue 3 Composition API style');
      rules.push('- Use render functions with template for complex content');
      rules.push('- Event bindings use @event or v-on:event syntax');
      rules.push('- Slots use v-slot directive or # shorthand');
      break;

    case 'angular':
      rules.push("- Import from '@storybook/angular'");
      rules.push('- Use moduleMetadata or applicationConfig decorators');
      rules.push('- Property binding: [property]="value"');
      rules.push('- Event binding: (event)="handler($event)"');
      rules.push('- Use Angular template syntax in render functions');
      break;

    case 'svelte':
      rules.push("- Import from '@storybook/svelte'");
      rules.push('- Import .svelte files directly as default exports');
      rules.push('- Events use on: directive (e.g., on:click)');
      rules.push('- Use bind: for two-way binding');
      break;

    case 'web-components':
      rules.push("- Import { html } from 'lit'");
      rules.push("- Import from '@storybook/web-components'");
      rules.push('- Use html`` template literal, NOT JSX');
      rules.push('- Use kebab-case for tag names (e.g., <my-button>)');
      rules.push('- Property binding: .property=${value}');
      rules.push('- Event binding: @event=${handler}');
      rules.push('- Boolean attributes: ?disabled=${true}');
      break;

    default:
      break;
  }

  return rules;
}

/**
 * Detect the framework for a given project
 */
export async function detectProjectFramework(projectRoot?: string): Promise<FrameworkType> {
  const registry = getAdapterRegistry();
  const adapter = await registry.autoDetect(projectRoot || process.cwd());
  return adapter.type;
}

/**
 * Get the adapter for a specific framework
 */
export function getFrameworkAdapter(framework: FrameworkType): FrameworkAdapter {
  const registry = getAdapterRegistry();
  return registry.getAdapter(framework);
}

/**
 * Get all available framework adapters
 */
export function getAvailableFrameworks(): FrameworkType[] {
  const registry = getAdapterRegistry();
  return registry.getAvailableFrameworks();
}
