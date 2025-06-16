import { StoryUIConfig } from '../story-ui.config.js';
import { DiscoveredComponent } from './componentDiscovery.js';

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

  return `You are an expert UI developer creating Storybook stories. Use ONLY the React components from the ${componentSystemName} listed below.`;
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

  if (component.props.length > 0) {
    reference += `: Props: ${component.props.join(', ')}`;
  }

  if (component.slots && component.slots.length > 0) {
    reference += `. Slots: ${component.slots.join(', ')}`;
  }

  if (component.description && component.description !== `${component.name} component`) {
    reference += ` - ${component.description}`;
  }

  // Add specific usage notes for layout components
  if (component.category === 'layout') {
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
    instructions.push(`- For ANY multi-column layout (2, 3, or more columns), use CSS Grid with ${layoutRules.multiColumnWrapper} elements`);
    instructions.push(`- Each column must be wrapped in its own ${layoutRules.columnComponent} element`);
    instructions.push(`- Structure: <${layoutRules.multiColumnWrapper} style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}><${layoutRules.columnComponent}>column 1</${layoutRules.columnComponent}><${layoutRules.columnComponent}>column 2</${layoutRules.columnComponent}></${layoutRules.multiColumnWrapper}>`);
    instructions.push(`- Use inline styles for CSS Grid layouts since the design system lacks proper multi-column layout components`);
    instructions.push(`- The grid container ${layoutRules.multiColumnWrapper} should be the main component in your story, not individual cards`);
  }

  if (layoutRules.prohibitedElements && layoutRules.prohibitedElements.length > 0) {
    instructions.push(`- Do NOT use plain HTML ${layoutRules.prohibitedElements.join(', ')} elements for layout - use the provided layout components`);
  }

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
  }

  return examples;
}

/**
 * Generates a default sample story if none provided
 */
function generateDefaultSampleStory(config: StoryUIConfig, components: DiscoveredComponent[]): string {
  const layoutComponent = components.find(c => c.category === 'layout' && !c.name.toLowerCase().includes('section'));
  const sectionComponent = components.find(c => c.category === 'layout' && c.name.toLowerCase().includes('section'));
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

  return `import type { StoryObj } from '@storybook/react-webpack5';
${importStatement}

export default {
  title: 'Layouts/Sample Layout',
  component: ${mainComponent},
  subcomponents: { ${imports.slice(1).join(', ')} },
};

export const Default: StoryObj<typeof ${mainComponent}> = {
  args: {
    children: (${children}
    )
  }
};`;
}

/**
 * Builds the complete Claude prompt
 */
export function buildClaudePrompt(
  userPrompt: string,
  config: StoryUIConfig,
  components: DiscoveredComponent[]
): string {
  const generated = generatePrompt(config, components);

  const promptParts = [
    generated.systemPrompt,
    '',
    ...generated.layoutInstructions,
    '',
    'Available components:',
    generated.componentReference,
    ...generated.examples,
  ];

  // Add critical structure instructions for multi-column layouts
  if (config.layoutRules.multiColumnWrapper && config.layoutRules.columnComponent) {
    promptParts.push(
      `CRITICAL: For multi-column layouts, the children prop must contain a SINGLE ${config.layoutRules.multiColumnWrapper} with CSS Grid styling wrapping all ${config.layoutRules.columnComponent} components.`,
      `WRONG: children: (<><${config.layoutRules.columnComponent}>...</${config.layoutRules.columnComponent}><${config.layoutRules.columnComponent}>...</${config.layoutRules.columnComponent}></>)`,
      `CORRECT: children: (<${config.layoutRules.multiColumnWrapper} style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}><${config.layoutRules.columnComponent}>...</${config.layoutRules.columnComponent}><${config.layoutRules.columnComponent}>...</${config.layoutRules.columnComponent}></${config.layoutRules.multiColumnWrapper}>)`,
      ''
    );
  }

  promptParts.push(
    `Output a complete Storybook story file in TypeScript. Import components from "${config.importPath}". Use the following sample as a template. Respond ONLY with a single code block containing the full file, and nothing else.`,
    '',
    'Sample story format:',
    generated.sampleStory,
    '',
    'User request:',
    userPrompt
  );

  return promptParts.join('\n');
}
