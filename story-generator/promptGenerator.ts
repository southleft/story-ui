import { StoryUIConfig } from '../story-ui.config.js';
import { DiscoveredComponent } from './componentDiscovery.js';
import { EnhancedComponentDiscovery } from './enhancedComponentDiscovery.js';
import { loadConsiderations, considerationsToPrompt } from './considerationsLoader.js';
import { DocumentationLoader } from './documentationLoader.js';

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

  return `🚨 CRITICAL: EVERY STORY MUST START WITH "import React from 'react';" AS THE FIRST LINE 🚨

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
- Never create <img> tags without a src attribute`;
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
    instructions.push(`- NEVER use inline styles or style prop - use the component's built-in props for layout and styling`);
    instructions.push(`- NEVER use CSS properties as props (like display="grid" or gridTemplateColumns) - these are not valid props`);
    instructions.push(`- For grid-like layouts, use Flex with wrap prop and appropriate gap, NOT CSS Grid`);
    instructions.push(`- The ${layoutRules.multiColumnWrapper} should be the main component in your story for multi-column layouts`);
  }

  if (layoutRules.prohibitedElements && layoutRules.prohibitedElements.length > 0) {
    instructions.push(`- NEVER use plain HTML ${layoutRules.prohibitedElements.join(', ')} elements - ALWAYS use the provided design system components`);
  }

  instructions.push(`- NEVER output raw <h1>-<h6> tags. Use <Heading level={n}> from @react-spectrum/text with Spectrum size props`);
  instructions.push(`- NEVER hard-code CSS Grid properties like grid-template-columns or gap in style attrs. Use <Flex wrap gap="size-200"> or <Grid> with Spectrum size tokens`);
  instructions.push(`- For outer spacing use <View> with padding/margin Spectrum tokens, not inline style or plain divs`);

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
  }

  return examples;
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

  const importStatement = `import { ${imports.join(', ')} } from '${config.importPath}';`;

  let children = '';
  if (layoutComponent && sectionComponent) {
    children = `
      <${layoutComponent.name}>
        <${sectionComponent.name}>
          ${contentComponent ? `<${contentComponent.name}>Sample content</${contentComponent.name}>` : 'Sample content'}
        </${sectionComponent.name}>
      </${layoutComponent.name}>`;
  } else if (contentComponent) {
    children = `<${contentComponent.name}>Sample content</${contentComponent.name}>`;
  } else {
    children = '<div>Sample content</div>';
  }

  const storybookFramework = config.storybookFramework || '@storybook/react';
  return `import React from 'react';
import type { Meta, StoryObj } from '${storybookFramework}';
${importStatement}

const meta = {
  title: 'Generated/Sample Layout',
  component: ${mainComponent},
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof ${mainComponent}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (${children}
    )
  }
};`
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
    promptParts.push('Additional imports available:');
    config.additionalImports.forEach(additionalImport => {
      promptParts.push(`- From '${additionalImport.path}': ${additionalImport.components.join(', ')}`);
    });
  }

  // Icons and other specific imports should be handled through additionalImports or considerations

  // Add critical structure instructions for multi-column layouts
  if (config.layoutRules.multiColumnWrapper && config.layoutRules.columnComponent) {
    promptParts.push(
      `CRITICAL: For multi-column layouts, the children prop must contain the ${config.layoutRules.multiColumnWrapper} component with proper props.`,
      `WRONG: children: (<><${config.layoutRules.columnComponent}>...</${config.layoutRules.columnComponent}><${config.layoutRules.columnComponent}>...</${config.layoutRules.columnComponent}></>)`,
      `CORRECT: children: (<${config.layoutRules.multiColumnWrapper}><${config.layoutRules.columnComponent}>...</${config.layoutRules.columnComponent}><${config.layoutRules.columnComponent}>...</${config.layoutRules.columnComponent}></${config.layoutRules.multiColumnWrapper}>)`,
      ''
    );
  }

  promptParts.push(
    `Output a complete Storybook story file in TypeScript. Import components from "${config.importPath}". Use the following sample as a template. Respond ONLY with a single code block containing the full file, and nothing else.`,
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
    '- Do NOT import story exports - these are NOT real components',
    '- Check every import against the Available components list before using it',
    '- FORBIDDEN: Provider, defaultTheme, ThemeProvider, or any theme-related components',
    '- FORBIDDEN: Any component not explicitly listed in the Available components section',
    '- FORBIDDEN: `UNSAFE_style` prop. NEVER use it. If you need to style something like bold text, find a semantic component or prop (e.g., `<Heading>`) instead of manually styling `<Text>`.',
    '- All images MUST have a src attribute with placeholder URLs (use https://picsum.photos/)',
    '- Never create <img> tags without src attributes',
    '- MUST use ES modules syntax: "export default meta;" NOT "module.exports = meta;"',
    '- The file MUST have a default export for the meta object',
    '- Keep the story concise and focused - avoid overly complex layouts that might exceed token limits',
    '- Ensure all JSX tags are properly closed',
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
