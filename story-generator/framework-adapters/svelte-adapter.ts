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
  readonly defaultExtension = '.stories.svelte';

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

    return `You are an expert Svelte developer creating Storybook stories using the @storybook/addon-svelte-csf format.
Use ONLY the Svelte components from the ${componentSystemName} listed below.

CRITICAL: Generate .stories.svelte files, NOT .stories.ts files!

STORY FILE FORMAT (.stories.svelte):
The file must use this EXACT structure:

\`\`\`svelte
<script context="module">
  import { ComponentName } from '${config.importPath || 'flowbite-svelte'}';

  export const meta = {
    title: 'Generated/ComponentName',
    component: ComponentName,
    tags: ['autodocs'],
  };
</script>

<script>
  import { Story, Template } from '@storybook/addon-svelte-csf';
</script>

<Template let:args>
  <ComponentName {...args}>Default Content</ComponentName>
</Template>

<Story name="Default">
  <ComponentName>Default Story</ComponentName>
</Story>

<Story name="Variant">
  <ComponentName color="primary">Primary Variant</ComponentName>
</Story>
\`\`\`

MANDATORY STRUCTURE:
1. First <script context="module">: Component imports + export const meta
2. Second <script>: Import Story and Template from @storybook/addon-svelte-csf
3. <Template let:args>: Default template with args spread
4. Multiple <Story name="..."> blocks for each story variation

CRITICAL RULES:
- Use named imports: import { Button, Card } from 'flowbite-svelte';
- Story title MUST start with "Generated/" (e.g., title: 'Generated/Button')
- Include tags: ['autodocs'] in meta
- Each <Story> needs a unique name attribute
- Put component content BETWEEN the component tags, not in props
- DO NOT use 'children' or 'slot' props
- For buttons and components that display text, put text between opening and closing tags

CORRECT EXAMPLES:
\`\`\`svelte
<!-- Button with text content -->
<Story name="Primary">
  <Button color="primary">Click Me</Button>
</Story>

<!-- Multiple components in a story -->
<Story name="Colors">
  <div class="flex gap-2 flex-wrap">
    <Button color="primary">Primary</Button>
    <Button color="blue">Blue</Button>
    <Button color="green">Green</Button>
  </div>
</Story>

<!-- Card with content -->
<Story name="Card Example">
  <Card class="max-w-sm">
    <h5 class="text-2xl font-bold tracking-tight text-gray-900">Card Title</h5>
    <p class="font-normal text-gray-700">Card description here.</p>
  </Card>
</Story>
\`\`\`

WRONG - DO NOT DO THIS:
\`\`\`svelte
<!-- WRONG: No children prop -->
<Story name="Wrong">
  <Button children="Click Me" />
</Story>

<!-- WRONG: No slot prop -->
<Story name="Also Wrong">
  <Button slot="Click Me" />
</Story>
\`\`\`

SVELTE TEMPLATE SYNTAX:
- Props: property={value} or property="value"
- Events: onclick={handler} (Svelte 5) or on:click={handler} (Svelte 4)
- Two-way binding: bind:value
- Conditionals: {#if condition}...{/if}
- Loops: {#each items as item}...{/each}
- Classes: class="flex gap-2" (use Tailwind classes)

${this.getCommonRules()}`;
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'flowbite-svelte';

    return `
## Example Stories for Svelte (.stories.svelte Format)

### Button Component Story
\`\`\`svelte
<script context="module">
  import { Button } from '${lib}';

  export const meta = {
    title: 'Generated/Button',
    component: Button,
    tags: ['autodocs'],
  };
</script>

<script>
  import { Story, Template } from '@storybook/addon-svelte-csf';
</script>

<Template let:args>
  <Button {...args}>Button</Button>
</Template>

<Story name="Primary">
  <Button color="primary">Primary</Button>
</Story>

<Story name="Colors">
  <div class="flex gap-2 flex-wrap">
    <Button color="primary">Primary</Button>
    <Button color="blue">Blue</Button>
    <Button color="green">Green</Button>
    <Button color="red">Red</Button>
  </div>
</Story>

<Story name="Sizes">
  <div class="flex gap-2 items-center flex-wrap">
    <Button size="xs">Extra Small</Button>
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </div>
</Story>

<Story name="Disabled">
  <Button disabled>Disabled</Button>
</Story>
\`\`\`

### Card Component Story
\`\`\`svelte
<script context="module">
  import { Card, Button } from '${lib}';

  export const meta = {
    title: 'Generated/Card',
    component: Card,
    tags: ['autodocs'],
  };
</script>

<script>
  import { Story, Template } from '@storybook/addon-svelte-csf';
</script>

<Template let:args>
  <Card {...args} class="max-w-sm">
    <h5 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Card Title</h5>
    <p class="font-normal text-gray-700 dark:text-gray-400">Card content goes here.</p>
  </Card>
</Template>

<Story name="Default">
  <Card class="max-w-sm">
    <h5 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Card Title</h5>
    <p class="font-normal text-gray-700 dark:text-gray-400">This is a simple card with some content.</p>
  </Card>
</Story>

<Story name="With Image">
  <Card class="max-w-sm" img="https://picsum.photos/400/200">
    <h5 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Image Card</h5>
    <p class="font-normal text-gray-700 dark:text-gray-400">Card with an image header.</p>
    <Button>Read More</Button>
  </Card>
</Story>

<Story name="Horizontal">
  <Card class="max-w-xl" horizontal img="https://picsum.photos/200/200">
    <h5 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Horizontal</h5>
    <p class="font-normal text-gray-700 dark:text-gray-400">Horizontal card layout.</p>
  </Card>
</Story>
\`\`\`

### Alert Component Story
\`\`\`svelte
<script context="module">
  import { Alert } from '${lib}';

  export const meta = {
    title: 'Generated/Alert',
    component: Alert,
    tags: ['autodocs'],
  };
</script>

<script>
  import { Story, Template } from '@storybook/addon-svelte-csf';
</script>

<Template let:args>
  <Alert {...args}>Alert message here</Alert>
</Template>

<Story name="Info">
  <Alert color="blue">This is an informational alert.</Alert>
</Story>

<Story name="Success">
  <Alert color="green">Operation completed successfully!</Alert>
</Story>

<Story name="Warning">
  <Alert color="yellow">Please review before proceeding.</Alert>
</Story>

<Story name="Error">
  <Alert color="red">An error occurred. Please try again.</Alert>
</Story>

<Story name="All Types">
  <div class="space-y-4">
    <Alert color="blue">Info alert</Alert>
    <Alert color="green">Success alert</Alert>
    <Alert color="yellow">Warning alert</Alert>
    <Alert color="red">Error alert</Alert>
  </div>
</Story>
\`\`\`
`;
  }

  generateSampleStory(
    config: StoryUIConfig,
    components: DiscoveredComponent[]
  ): string {
    const lib = config.importPath || 'flowbite-svelte';
    const firstComponent = components[0];

    if (!firstComponent) {
      return `<script context="module">
  export const meta = {
    title: 'Generated/Sample',
    tags: ['autodocs'],
  };
</script>

<script>
  import { Story } from '@storybook/addon-svelte-csf';
</script>

<Story name="Default">
  <div>Sample story content</div>
</Story>
`;
    }

    return `<script context="module">
  import { ${firstComponent.name} } from '${lib}';

  export const meta = {
    title: 'Generated/${firstComponent.name}',
    component: ${firstComponent.name},
    tags: ['autodocs'],
  };
</script>

<script>
  import { Story, Template } from '@storybook/addon-svelte-csf';
</script>

<Template let:args>
  <${firstComponent.name} {...args}>${firstComponent.name}</${firstComponent.name}>
</Template>

<Story name="Default">
  <${firstComponent.name}>${firstComponent.name}</${firstComponent.name}>
</Story>
`;
  }

  getStoryTemplate(options?: StoryGenerationOptions): string {
    return `
<script context="module">
  import { {{componentName}} } from '{{importPath}}';

  export const meta = {
    title: '{{category}}/{{componentName}}',
    component: {{componentName}},
    tags: ['autodocs'],
  };
</script>

<script>
  import { Story, Template } from '@storybook/addon-svelte-csf';
</script>

<Template let:args>
  <{{componentName}} {...args}>{{componentName}}</{{componentName}}>
</Template>

<Story name="Default">
  <{{componentName}}>{{componentName}}</{{componentName}}>
</Story>
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
    // Handles both default and named imports with deep paths:
    // e.g., import Card from 'flowbite-svelte/dist/card/Card.svelte' → import { Card } from 'flowbite-svelte'
    // e.g., import { Card } from "flowbite-svelte/dist/card" → import { Card } from 'flowbite-svelte'
    const flowbiteImports: string[] = [];

    // Pattern 1: Default imports with deep paths
    // e.g., import Card from 'flowbite-svelte/dist/card/Card.svelte'
    const flowbiteDefaultImportPattern = /import\s+(\w+)\s+from\s+['"]flowbite-svelte\/[^'"]+['"];?\n?/g;
    processed = processed.replace(flowbiteDefaultImportPattern, (match, componentName) => {
      flowbiteImports.push(componentName);
      return ''; // Remove the line, we'll add a consolidated import later
    });

    // Pattern 2: Named imports with deep paths
    // e.g., import { Card } from "flowbite-svelte/dist/card"
    // e.g., import { Card, Badge } from "flowbite-svelte/dist/components"
    const flowbiteNamedImportPattern = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]flowbite-svelte\/[^'"]+['"];?\n?/g;
    processed = processed.replace(flowbiteNamedImportPattern, (match, namedImports) => {
      // Extract individual component names from the named imports
      const names = namedImports.split(',').map((name: string) => name.trim()).filter((name: string) => name);
      flowbiteImports.push(...names);
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
