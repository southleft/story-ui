/**
 * Svelte Framework Adapter
 *
 * Generates Storybook stories for Svelte components.
 * Supports both Svelte 4 and Svelte 5 (runes).
 */

import {
  FrameworkType,
  StoryFramework,
  StoryGenerationOptions,
} from './types.js';
import { BaseFrameworkAdapter } from './base-adapter.js';
import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';

export class SvelteAdapter extends BaseFrameworkAdapter {
  readonly type: FrameworkType = 'svelte';
  readonly name = 'Svelte';
  readonly supportedStoryFrameworks: StoryFramework[] = [
    'storybook-svelte',
    'chromatic',
  ];
  readonly defaultExtension = '.stories.ts';

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

    return `You are an expert Svelte developer creating Storybook stories using CSF 3.0 format.
Use ONLY the Svelte components from the ${componentSystemName} listed below.

MANDATORY IMPORTS - First lines of every story file:
1. import type { Meta, StoryObj } from '@storybook/svelte';
2. import { ComponentName } from '${config.importPath || 'flowbite-svelte'}';

SVELTE STORY FORMAT (CSF 3.0):
- Use named imports from flowbite-svelte (NOT default imports from .svelte files)
- Props are passed via args object
- Use render function ONLY for multiple components or complex layouts

STORY STRUCTURE:
- Meta object with component, title, and parameters
- Stories use args for prop passing
- Keep stories simple - avoid complex render functions when possible

CRITICAL RULES:
- Import using named exports: import { Button, Card } from 'flowbite-svelte';
- DO NOT use 'slot' property in render functions - it does NOT work
- DO NOT use 'children' in args
- For components that need text content, use the component's text/label prop if available
- For button text, most Flowbite components accept text as a prop or the component handles it

SIMPLE EXAMPLE (PREFERRED):
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import { Button } from 'flowbite-svelte';

const meta: Meta<Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    color: {
      control: 'select',
      options: ['primary', 'blue', 'alternative', 'dark', 'light', 'green', 'red'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    color: 'primary',
  },
};

export const AllColors: Story = {
  render: () => ({
    Component: Button,
    props: { color: 'blue' },
  }),
};
\`\`\`

FOR MULTIPLE COMPONENTS (use render with template):
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import { ButtonGroup, Button } from 'flowbite-svelte';

const meta: Meta<ButtonGroup> = {
  title: 'Components/ButtonGroup',
  component: ButtonGroup,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof meta>;

// For simple button groups, just show the component
export const Default: Story = {
  args: {},
};
\`\`\`

SVELTE TEMPLATE SYNTAX:
- Props: property={value}
- Events: onclick={handler} (Svelte 5 syntax, NOT on:click)
- Two-way binding: bind:value
- Conditionals: {#if condition}...{/if}
- Loops: {#each items as item}...{/each}

${this.getCommonRules()}`;
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'flowbite-svelte';

    return `
## Example Stories for Svelte (CSF 3.0 Format)

### Simple Component Story (PREFERRED)
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import { Button } from '${lib}';

const meta: Meta<Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    color: {
      control: 'select',
      options: ['primary', 'blue', 'alternative', 'dark', 'light', 'green', 'red'],
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    color: 'primary',
    size: 'md',
  },
};

export const Disabled: Story = {
  args: {
    color: 'primary',
    disabled: true,
  },
};

export const AllSizes: Story = {
  render: () => ({
    Component: Button,
    props: { color: 'blue', size: 'lg' },
  }),
};
\`\`\`

### Card Component Story
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import { Card } from '${lib}';

const meta: Meta<Card> = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    class: 'max-w-sm',
  },
};

export const WithImage: Story = {
  args: {
    img: 'https://picsum.photos/300/200',
    class: 'max-w-sm',
  },
};

export const Horizontal: Story = {
  args: {
    horizontal: true,
    class: 'max-w-xl',
  },
};
\`\`\`

### Alert Component Story
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import { Alert } from '${lib}';

const meta: Meta<Alert> = {
  title: 'Components/Alert',
  component: Alert,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    color: {
      control: 'select',
      options: ['primary', 'blue', 'red', 'green', 'yellow', 'dark'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {
  args: {
    color: 'blue',
  },
};

export const Success: Story = {
  args: {
    color: 'green',
  },
};

export const Warning: Story = {
  args: {
    color: 'yellow',
  },
};

export const Error: Story = {
  args: {
    color: 'red',
  },
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
import type { Meta, StoryObj } from '@storybook/svelte';

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
import type { Meta, StoryObj } from '@storybook/svelte';
import ${firstComponent.name} from '${lib}/${firstComponent.name}.svelte';

const meta: Meta<${firstComponent.name}> = {
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
import type { Meta, StoryObj } from '@storybook/svelte';
import {{componentName}} from '{{importPath}}/{{componentName}}.svelte';

const meta: Meta<{{componentName}}> = {
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
   * Post-process Svelte stories
   */
  postProcess(storyContent: string): string {
    let processed = super.postProcess(storyContent);

    // Remove React imports if present
    processed = processed.replace(/import React from ['"]react['"];?\n?/g, '');

    // Fix flowbite-svelte imports - convert deep path imports to named exports
    // e.g., import Card from 'flowbite-svelte/dist/card/Card.svelte' → import { Card } from 'flowbite-svelte'
    const flowbiteDeepImportPattern = /import\s+(\w+)\s+from\s+['"]flowbite-svelte\/[^'"]+['"];?/g;
    const flowbiteImports: string[] = [];

    processed = processed.replace(flowbiteDeepImportPattern, (match, componentName) => {
      flowbiteImports.push(componentName);
      return ''; // Remove the line, we'll add a consolidated import later
    });

    // If we found flowbite-svelte deep imports, add a consolidated named export import
    if (flowbiteImports.length > 0) {
      const uniqueImports = [...new Set(flowbiteImports)];
      const consolidatedImport = `import { ${uniqueImports.join(', ')} } from 'flowbite-svelte';`;

      // Find where to insert - after the @storybook/svelte import
      const storybookImportMatch = processed.match(/import.*from\s+['"]@storybook\/svelte['"];?\n/);
      if (storybookImportMatch) {
        processed = processed.replace(
          storybookImportMatch[0],
          storybookImportMatch[0] + consolidatedImport + '\n'
        );
      } else {
        // Insert at the beginning if no storybook import found
        processed = consolidatedImport + '\n' + processed;
      }
    }

    // Fix JSX to Svelte syntax
    processed = processed
      // Fix className to class
      .replace(/className=/g, 'class=')
      // Fix onClick to on:click
      .replace(/onClick=/g, 'on:click=')
      .replace(/onChange=/g, 'on:change=')
      .replace(/onInput=/g, 'on:input=');

    // Clean up multiple empty lines that might result from import removal
    processed = processed.replace(/\n{3,}/g, '\n\n');

    return processed;
  }

  /**
   * Validate Svelte story
   */
  validate(storyContent: string): { valid: boolean; errors: string[] } {
    const baseValidation = super.validate(storyContent);
    const errors = [...baseValidation.errors];

    // Svelte-specific validations
    if (!storyContent.includes('@storybook/svelte')) {
      errors.push("Missing '@storybook/svelte' import");
    }

    if (storyContent.includes("import React from 'react'")) {
      errors.push('React import found in Svelte story');
    }

    // Check for JSX-style event handlers in .ts files
    if (storyContent.includes('.ts') && /onClick=\{/.test(storyContent)) {
      errors.push('Using JSX-style event handlers instead of Svelte on: syntax');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate imports for Svelte components
   */
  generateImports(
    components: DiscoveredComponent[],
    config: StoryUIConfig
  ): string {
    const lib = config.importPath || 'your-library';
    const imports: string[] = [];

    // Svelte components are default imports from .svelte files
    for (const component of components) {
      imports.push(`import ${component.name} from '${lib}/${component.name}.svelte';`);
    }

    return imports.join('\n');
  }
}

/**
 * Factory function
 */
export function createSvelteAdapter(): SvelteAdapter {
  return new SvelteAdapter();
}
