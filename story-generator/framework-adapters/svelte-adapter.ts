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
2. import ComponentName from '${config.importPath || 'your-library'}/ComponentName.svelte';

SVELTE STORY FORMAT:
- Import .svelte files directly
- Props are passed via args object
- Use render function for complex templates

STORY STRUCTURE (CSF 3.0):
- Meta object with component, title, and parameters
- Stories use args for simple prop passing
- Use render for component composition

CRITICAL RULES:
- Import Svelte components (default export from .svelte files)
- For slots, use render with a wrapper component
- Events use on: directive in Svelte templates

CRITICAL - SVELTE SLOT CONTENT:
- Svelte components use SLOTS for content, NOT children props
- Always use render function with 'slot' property for text/content
- Never use 'children' in args - it will cause runtime errors

Example structure:
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import { Button } from 'your-library';

const meta: Meta<Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
    onclick: { action: 'clicked' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    variant: 'primary',
  },
  render: (args) => ({
    Component: Button,
    props: args,
    slot: 'Click me',
  }),
};
\`\`\`

For stories with slots (using wrapper component):
\`\`\`svelte
<!-- ButtonWithIcon.stories.svelte -->
<script context="module" lang="ts">
  import type { Meta } from '@storybook/svelte';
  import Button from 'your-library/Button.svelte';
  import Icon from 'your-library/Icon.svelte';

  export const meta: Meta<Button> = {
    title: 'Components/Button/WithIcon',
    component: Button,
  };
</script>

<script lang="ts">
  import { Story } from '@storybook/svelte';
</script>

<Story name="With Icon">
  <Button variant="primary">
    <Icon slot="icon" name="star" />
    Starred
  </Button>
</Story>
\`\`\`

SVELTE TEMPLATE SYNTAX:
- Props: property={value}
- Events: on:event={handler}
- Two-way binding: bind:value
- Conditionals: {#if condition}...{/if}
- Loops: {#each items as item}...{/each}

SLOTS:
- Default slot: Content between tags
- Named slots: <span slot="name">content</span>
- Slot props: let:prop

${this.getCommonRules()}`;
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'your-library';

    return `
## Example Stories for Svelte

### TypeScript Stories File
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import { Button } from 'your-library';

const meta: Meta<Button> = {
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
    onclick: { action: 'clicked' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// IMPORTANT: Use render with slot property for content
export const Default: Story = {
  args: {
    variant: 'primary',
    size: 'medium',
  },
  render: (args) => ({
    Component: Button,
    props: args,
    slot: 'Button',
  }),
};

export const Disabled: Story = {
  args: {
    variant: 'primary',
    disabled: true,
  },
  render: (args) => ({
    Component: Button,
    props: args,
    slot: 'Disabled',
  }),
};
\`\`\`

### Svelte Stories File (for complex templates)
\`\`\`svelte
<!-- Card.stories.svelte -->
<script context="module" lang="ts">
  import type { Meta } from '@storybook/svelte';
  import Card from '${lib}/Card.svelte';
  import Button from 'your-library/Button.svelte';
  import Text from '${lib}/Text.svelte';

  export const meta: Meta<Card> = {
    title: 'Components/Card',
    component: Card,
  };
</script>

<script lang="ts">
  import { Story, Template } from '@storybook/svelte';
</script>

<Story name="Product Card">
  <Card style="width: 300px">
    <img
      slot="media"
      src="https://picsum.photos/300/200"
      alt="Product"
    />
    <Text slot="title" variant="heading">Product Name</Text>
    <Text>$99.00</Text>
    <Button slot="actions" variant="primary">Add to Cart</Button>
  </Card>
</Story>

<Story name="Simple Card">
  <Card>
    <Text>Simple card content</Text>
  </Card>
</Story>
\`\`\`

### With Reactive State
\`\`\`svelte
<!-- Input.stories.svelte -->
<script context="module" lang="ts">
  import type { Meta } from '@storybook/svelte';
  import Input from '${lib}/Input.svelte';

  export const meta: Meta<Input> = {
    title: 'Components/Input',
    component: Input,
  };
</script>

<script lang="ts">
  import { Story } from '@storybook/svelte';
  let value = '';
</script>

<Story name="Controlled">
  <div>
    <Input bind:value placeholder="Type here..." />
    <p>Value: {value}</p>
  </div>
</Story>
\`\`\`

### With Event Handling
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import { action } from '@storybook/addon-actions';
import { Button } from 'your-library';

const meta: Meta<Button> = {
  title: 'Components/Button',
  component: Button,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithClickHandler: Story = {
  args: {
    variant: 'primary',
    onclick: action('button-clicked'),
  },
  render: (args) => ({
    Component: Button,
    props: args,
    slot: 'Click me',
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
