/**
 * Vue Framework Adapter
 *
 * Generates Storybook stories for Vue 3 components.
 * Supports Composition API and Options API.
 */

import * as path from 'path';
import {
  FrameworkType,
  StoryFramework,
  StoryGenerationOptions,
} from './types.js';
import { BaseFrameworkAdapter } from './base-adapter.js';
import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';

export class VueAdapter extends BaseFrameworkAdapter {
  readonly type: FrameworkType = 'vue';
  readonly name = 'Vue';
  readonly supportedStoryFrameworks: StoryFramework[] = [
    'storybook-vue3',
    'histoire',
    'chromatic',
  ];
  readonly defaultExtension = '.stories.ts';

  /**
   * Get glob patterns for Vue component files
   */
  getComponentFilePatterns(): string[] {
    return ['**/*.vue', '**/*.ts', '**/*.js'];
  }

  /**
   * Extract component names from a Vue source file.
   * Handles .vue SFCs and barrel files.
   */
  extractComponentNamesFromFile(filePath: string, content: string): string[] {
    const names: Set<string> = new Set();

    // For .vue files, derive name from filename or defineComponent name
    if (filePath.endsWith('.vue')) {
      // Try to extract name from defineComponent({ name: 'ComponentName' })
      const defineComponentNameRegex = /defineComponent\s*\(\s*\{[^]*?name\s*:\s*['"`]([A-Z][a-zA-Z0-9]*)['"`]/;
      const nameMatch = content.match(defineComponentNameRegex);
      if (nameMatch) {
        names.add(nameMatch[1]);
      } else {
        // Try Options API name property
        const optionsNameRegex = /name\s*:\s*['"`]([A-Z][a-zA-Z0-9]*)['"`]/;
        const optionsMatch = content.match(optionsNameRegex);
        if (optionsMatch) {
          names.add(optionsMatch[1]);
        } else {
          // Fallback to filename
          const fileName = path.basename(filePath, '.vue');
          // If already PascalCase, use as-is; otherwise convert kebab-case/snake_case
          if (/^[A-Z][a-zA-Z0-9]*$/.test(fileName)) {
            names.add(fileName);
          } else {
            // Convert kebab-case or snake_case to PascalCase
            const pascalName = fileName
              .split(/[-_]/)
              .map(part => part.charAt(0).toUpperCase() + part.slice(1))
              .join('');
            if (/^[A-Z]/.test(pascalName)) {
              names.add(pascalName);
            }
          }
        }
      }
      return Array.from(names);
    }

    // For .ts/.js barrel files, look for re-exports
    // Pattern: export { default as ComponentName } from './Component.vue'
    const barrelExportRegex = /export\s*\{\s*default\s+as\s+([A-Z][a-zA-Z0-9]*)\s*\}\s*from\s*['"`]([^'"`]+\.vue)['"`]/g;
    let match;
    while ((match = barrelExportRegex.exec(content)) !== null) {
      names.add(match[1]);
    }

    // Pattern: export { ComponentName } from './path'
    const namedExportRegex = /export\s*\{\s*([^}]+)\s*\}\s*from\s*['"`]([^'"`]+)['"`]/g;
    while ((match = namedExportRegex.exec(content)) !== null) {
      const exports = match[1].split(',');
      for (const exp of exports) {
        const namePart = exp.trim().split(/\s+as\s+/).pop()?.trim() || '';
        if (/^[A-Z][A-Za-z0-9]*$/.test(namePart)) {
          names.add(namePart);
        }
      }
    }

    // Pattern: export const ComponentName = ...
    const constExportRegex = /export\s+const\s+([A-Z][A-Za-z0-9]*)\s*=/g;
    while ((match = constExportRegex.exec(content)) !== null) {
      names.add(match[1]);
    }

    return Array.from(names);
  }

  generateSystemPrompt(
    config: StoryUIConfig,
    options?: StoryGenerationOptions
  ): string {
    if (config.systemPrompt) {
      return config.systemPrompt;
    }

    const componentSystemName = config.componentPrefix
      ? `${config.componentPrefix.replace(/^[A-Z]+/, '')} design system`
      : 'component library';

    return `You are an expert Vue 3 developer creating Storybook stories using CSF 3.0 format.
Use ONLY the Vue components from the ${componentSystemName} listed below.

MANDATORY IMPORTS - First lines of every story file:
1. import type { Meta, StoryObj } from '@storybook/vue3';
2. import { ComponentName } from '${config.importPath || 'your-library'}';

VUE 3 STORY FORMAT:
- Use Vue 3 Composition API style
- Components can use render functions or template syntax
- Props are passed via args
- Events use v-on or @ shorthand

STORY STRUCTURE (CSF 3.0):
- Meta object with component, title, and parameters
- Use render function for complex templates
- Export named stories as StoryObj

CRITICAL RULES:
- Import components from the library, NOT .vue files
- Use render functions for dynamic content
- Slots use v-slot directive or # shorthand

Example structure:
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/vue3';
import { Button } from 'your-library';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
    onClick: { action: 'clicked' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    variant: 'primary',
    label: 'Click me',
  },
};

export const WithSlot: Story = {
  render: (args) => ({
    components: { Button },
    setup() {
      return { args };
    },
    template: \`
      <Button v-bind="args">
        <template #icon>
          <span>★</span>
        </template>
        Click me
      </Button>
    \`,
  }),
};
\`\`\`

TEMPLATE VS RENDER FUNCTION:
- Simple props: Use args directly
- Slots/complex content: Use render function with template
- Dynamic content: Use render function with setup()

SLOT SYNTAX:
- Default slot: Content between tags
- Named slots: <template #name> or <template v-slot:name>
- Scoped slots: <template #default="{ item }">

EVENT HANDLING:
- Use @event or v-on:event syntax
- Use action argTypes to log events in Storybook

${this.getCommonRules()}`;
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'your-library';

    return `
## Example Stories for Vue 3

### Single Component Story
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/vue3';
import { Button } from 'your-library';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['small', 'medium', 'large'],
    },
    onClick: { action: 'clicked' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    variant: 'primary',
    size: 'medium',
    label: 'Button',
  },
};

export const AllVariants: Story = {
  render: () => ({
    components: { Button },
    template: \`
      <div style="display: flex; gap: 8px;">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
      </div>
    \`,
  }),
};
\`\`\`

### With Slots
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/vue3';
import { Card, Button, Text } from '${lib}';

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSlots: Story = {
  render: () => ({
    components: { Card, Button, Text },
    template: \`
      <Card style="width: 300px">
        <template #header>
          <Text variant="heading">Card Title</Text>
        </template>

        <Text>This is the card content using the default slot.</Text>

        <template #footer>
          <Button variant="primary">Action</Button>
        </template>
      </Card>
    \`,
  }),
};
\`\`\`

### With Reactive State
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/vue3';
import { ref } from 'vue';
import { Input } from '${lib}';

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Controlled: Story = {
  render: () => ({
    components: { Input },
    setup() {
      const value = ref('');
      return { value };
    },
    template: \`
      <div>
        <Input v-model="value" placeholder="Type here..." />
        <p>Value: {{ value }}</p>
      </div>
    \`,
  }),
};
\`\`\`
`;
  }

  generateSampleStory(
    config: StoryUIConfig,
    components: DiscoveredComponent[]
  ): string {
    const lib = config.importPath || 'your-library';
    const firstComponent = components[0];

    if (!firstComponent) {
      return `
import type { Meta, StoryObj } from '@storybook/vue3';

const meta: Meta = {
  title: 'Examples/Sample',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: '<div>Sample story content</div>',
  }),
};
`;
    }

    return `
import type { Meta, StoryObj } from '@storybook/vue3';
import { ${firstComponent.name} } from '${lib}';

const meta: Meta<typeof ${firstComponent.name}> = {
  title: 'Components/${firstComponent.name}',
  component: ${firstComponent.name},
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
`;
  }

  getStoryTemplate(options?: StoryGenerationOptions): string {
    return `
// {{componentName}}.stories.ts
import type { Meta, StoryObj } from '@storybook/vue3';
import { {{componentName}} } from '{{importPath}}';

const meta: Meta<typeof {{componentName}}> = {
  title: '{{category}}/{{componentName}}',
  component: {{componentName}},
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
`;
  }

  /**
   * Post-process Vue stories
   */
  postProcess(storyContent: string): string {
    let processed = super.postProcess(storyContent);

    // Remove React imports if present (multiple patterns)
    processed = processed.replace(/import React from ['"]react['"];?\n?/g, '');
    processed = processed.replace(/import \* as React from ['"]react['"];?\n?/g, '');
    processed = processed.replace(/import { .* } from ['"]react['"];?\n?/g, '');

    // Fix JSX to Vue template syntax
    processed = processed
      // Fix className to class
      .replace(/className=/g, 'class=')
      // Fix onClick to @click
      .replace(/onClick=/g, '@click=')
      .replace(/onChange=/g, '@change=')
      .replace(/onInput=/g, '@input=');

    // Convert Vuetify PascalCase to kebab-case in templates
    // Match opening tags like <VBtn, <VCard, etc. and convert to <v-btn, <v-card
    processed = processed.replace(
      /<(V[A-Z][a-zA-Z]*)/g,
      (match, componentName) => {
        // Convert VBtn -> v-btn, VCard -> v-card, VTextField -> v-text-field
        const kebabCase = componentName
          .replace(/^V/, 'v-')
          .replace(/([a-z])([A-Z])/g, '$1-$2')
          .toLowerCase();
        return '<' + kebabCase;
      }
    );

    // Convert closing tags </VBtn> -> </v-btn>
    processed = processed.replace(
      /<\/(V[A-Z][a-zA-Z]*)/g,
      (match, componentName) => {
        const kebabCase = componentName
          .replace(/^V/, 'v-')
          .replace(/([a-z])([A-Z])/g, '$1-$2')
          .toLowerCase();
        return '</' + kebabCase;
      }
    );

    return processed;
  }

  /**
   * Validate Vue story
   */
  validate(storyContent: string): { valid: boolean; errors: string[] } {
    const baseValidation = super.validate(storyContent);
    const errors = [...baseValidation.errors];

    // Vue-specific validations
    if (!storyContent.includes('@storybook/vue3')) {
      errors.push("Missing '@storybook/vue3' import");
    }

    if (storyContent.includes("import React from 'react'")) {
      errors.push('React import found in Vue story');
    }

    // Check for JSX-style event handlers
    if (/onClick=\{/.test(storyContent)) {
      errors.push('Using JSX-style event handlers instead of Vue @event syntax');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Factory function
 */
export function createVueAdapter(): VueAdapter {
  return new VueAdapter();
}
