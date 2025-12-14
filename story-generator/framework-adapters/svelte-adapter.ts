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

    return `You are an expert Svelte developer creating Storybook stories using the @storybook/addon-svelte-csf v5+ format.
Use ONLY the Svelte components from the ${componentSystemName} listed below.

CRITICAL: Generate .stories.svelte files using the NEW defineMeta() syntax (required for addon-svelte-csf v5+)!

STORY FILE FORMAT (.stories.svelte):
The file must use this EXACT structure with defineMeta():

\`\`\`svelte
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { ComponentName } from '${config.importPath || 'flowbite-svelte'}';

  const { Story } = defineMeta({
    title: 'Generated/ComponentName',
    component: ComponentName,
    tags: ['autodocs'],
  });
</script>

<Story name="Default" asChild>
  <ComponentName>Default Story</ComponentName>
</Story>

<Story name="Variant" asChild>
  <ComponentName color="primary">Primary Variant</ComponentName>
</Story>
\`\`\`

MANDATORY STRUCTURE:
1. Single <script module> block (NOT <script context="module">)
2. Import defineMeta from '@storybook/addon-svelte-csf'
3. Destructure { Story } from defineMeta() call
4. Multiple <Story name="..."> blocks for each story variation

CRITICAL RULES FOR addon-svelte-csf v5+:
- Use <script module> NOT <script context="module">
- Use defineMeta() function to define meta - NOT export const meta
- Destructure Story from defineMeta() - do NOT import Story separately
- DO NOT use "export const meta" or "export default meta" - this will cause parser errors!
- 🚨 IMPORT RULE: Use named imports from ROOT ONLY: import { Button, Card } from '${config.importPath || 'flowbite-svelte'}';
- 🚫 NEVER use deep paths like '${config.importPath || 'flowbite-svelte'}/dist/...' or '${config.importPath || 'flowbite-svelte'}/components/...'
- Story title MUST start with "Generated/" (e.g., title: 'Generated/Button')
- Include tags: ['autodocs'] in defineMeta
- Each <Story> needs a unique name attribute
- ALWAYS add asChild prop to <Story> to prevent double-wrapping: <Story name="X" asChild>
- Put component content BETWEEN the component tags, not in props
- DO NOT use 'children' or 'slot' props
- For buttons and components that display text, put text between opening and closing tags

CORRECT EXAMPLES:
\`\`\`svelte
<!-- Button with text content - asChild prevents double-wrapping -->
<Story name="Primary" asChild>
  <Button color="primary">Click Me</Button>
</Story>

<!-- Multiple components in a story -->
<Story name="Colors" asChild>
  <div class="flex gap-2 flex-wrap">
    <Button color="primary">Primary</Button>
    <Button color="blue">Blue</Button>
    <Button color="green">Green</Button>
  </div>
</Story>

<!-- Card with content -->
<Story name="Card Example" asChild>
  <Card class="max-w-sm">
    <h5 class="text-2xl font-bold tracking-tight text-gray-900">Card Title</h5>
    <p class="font-normal text-gray-700">Card description here.</p>
  </Card>
</Story>

<!-- Using args with snippets (Svelte 5 style) - no asChild needed with snippets -->
<Story name="WithArgs" args={{ color: 'primary', size: 'lg' }}>
  {#snippet children(args)}
    <Button {...args}>Button with Args</Button>
  {/snippet}
</Story>
\`\`\`

WRONG - DO NOT DO THIS:
\`\`\`svelte
<!-- WRONG: Old export const meta syntax (causes parser errors in v5) -->
<script context="module">
  export const meta = { title: 'Generated/Button' };
</script>

<!-- WRONG: No children prop -->
<Story name="Wrong">
  <Button children="Click Me" />
</Story>

<!-- WRONG: No slot prop -->
<Story name="Also Wrong">
  <Button slot="Click Me" />
</Story>

<!-- WRONG: Importing Story separately -->
<script>
  import { Story } from '@storybook/addon-svelte-csf';
</script>

<!-- WRONG: Double-nesting the SAME component inside itself -->
<Story name="DoubleNested">
  <Component><Component>content</Component></Component>  <!-- WRONG! -->
</Story>
\`\`\`

🚨 CRITICAL: NEVER NEST A COMPONENT INSIDE ITSELF! 🚨
This is a VERY COMMON mistake. The component in defineMeta() tells Storybook what the story is ABOUT.
It does NOT mean you wrap content in another instance of that component.

❌ WRONG (nesting same component inside itself):
  <ComponentName><ComponentName>content</ComponentName></ComponentName>

✅ CORRECT (single component with content directly inside):
  <ComponentName>content</ComponentName>

Note: Layout components (divs, grids, containers) CAN be nested when building layouts.
This rule applies to UI components being duplicated unnecessarily.

SVELTE 5 TEMPLATE SYNTAX:
- Props: property={value} or property="value"
- Events: onclick={handler} (Svelte 5 style)
- Two-way binding: bind:value
- Conditionals: {#if condition}...{/if}
- Loops: {#each items as item}...{/each}
- Classes: class="flex gap-2" (use Tailwind classes)
- Snippets: {#snippet name(args)}...{/snippet}

${this.getCommonRules()}`;
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'flowbite-svelte';

    return `
## Example Stories for Svelte (.stories.svelte Format) - addon-svelte-csf v5+ Syntax

### Button Component Story
\`\`\`svelte
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Button } from '${lib}';

  const { Story } = defineMeta({
    title: 'Generated/Button',
    component: Button,
    tags: ['autodocs'],
  });
</script>

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
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Card, Button } from '${lib}';

  const { Story } = defineMeta({
    title: 'Generated/Card',
    component: Card,
    tags: ['autodocs'],
  });
</script>

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
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Alert } from '${lib}';

  const { Story } = defineMeta({
    title: 'Generated/Alert',
    component: Alert,
    tags: ['autodocs'],
  });
</script>

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
      return `<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';

  const { Story } = defineMeta({
    title: 'Generated/Sample',
    tags: ['autodocs'],
  });
</script>

<Story name="Default">
  <div>Sample story content</div>
</Story>
`;
    }

    return `<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { ${firstComponent.name} } from '${lib}';

  const { Story } = defineMeta({
    title: 'Generated/${firstComponent.name}',
    component: ${firstComponent.name},
    tags: ['autodocs'],
  });
</script>

<Story name="Default">
  <${firstComponent.name}>${firstComponent.name}</${firstComponent.name}>
</Story>
`;
  }

  getStoryTemplate(options?: StoryGenerationOptions): string {
    return `
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { {{componentName}} } from '{{importPath}}';

  const { Story } = defineMeta({
    title: '{{category}}/{{componentName}}',
    component: {{componentName}},
    tags: ['autodocs'],
  });
</script>

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

    // CRITICAL: Convert old CSF syntax to new defineMeta() syntax for addon-svelte-csf v5+
    // This handles cases where the LLM generates the old format

    // Convert <script context="module"> to <script module>
    processed = processed.replace(/<script\s+context="module">/g, '<script module>');

    // Detect and convert old export const meta pattern to defineMeta
    // Use a more robust approach that handles nested objects
    const exportMetaMatch = processed.match(/export\s+const\s+meta\s*=\s*\{/);

    if (exportMetaMatch) {
      const startIndex = exportMetaMatch.index! + exportMetaMatch[0].length - 1; // Position of opening {
      let braceCount = 1;
      let endIndex = startIndex + 1;

      // Find the matching closing brace
      while (braceCount > 0 && endIndex < processed.length) {
        const char = processed[endIndex];
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
        endIndex++;
      }

      if (braceCount === 0) {
        // Extract the meta object content (without the outer braces)
        const metaContent = processed.substring(startIndex + 1, endIndex - 1);

        // Find the full statement including optional semicolon and export default
        const afterMeta = processed.substring(endIndex);
        const trailingMatch = afterMeta.match(/^;\s*(?:\n\s*export\s+default\s+meta;)?/);
        const trailingLength = trailingMatch ? trailingMatch[0].length : 0;

        // Build the replacement
        const fullMatch = processed.substring(exportMetaMatch.index!, endIndex + trailingLength);
        const replacement = `const { Story } = defineMeta({${metaContent}});`;

        processed = processed.replace(fullMatch, replacement);

        // Add defineMeta import if not present
        if (!processed.includes("import { defineMeta }")) {
          // Find the script module tag and add import after it
          processed = processed.replace(
            /<script module>/,
            `<script module>\n  import { defineMeta } from '@storybook/addon-svelte-csf';`
          );
        }

        // Remove separate Story/Template imports as Story comes from defineMeta now
        processed = processed.replace(/import\s*\{\s*Story(?:\s*,\s*Template)?\s*\}\s*from\s*['"]@storybook\/addon-svelte-csf['"];?\n?/g, '');
        processed = processed.replace(/import\s*\{\s*Template(?:\s*,\s*Story)?\s*\}\s*from\s*['"]@storybook\/addon-svelte-csf['"];?\n?/g, '');

        // Remove any second <script> block that only had Story/Template imports
        processed = processed.replace(/<script>\s*\n\s*<\/script>\n?/g, '');

        // Remove Template components as they're not needed in v5+
        processed = processed.replace(/<Template[^>]*>[\s\S]*?<\/Template>\n?/g, '');
      }
    }

    // Remove any remaining "export default meta;" lines
    processed = processed.replace(/\n\s*export\s+default\s+meta;\s*\n?/g, '\n');

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

      // Find where to insert - after the defineMeta import
      const defineMetaImportMatch = processed.match(/import\s*\{\s*defineMeta\s*\}\s*from\s*['"]@storybook\/addon-svelte-csf['"];?\n/);
      if (defineMetaImportMatch) {
        processed = processed.replace(
          defineMetaImportMatch[0],
          defineMetaImportMatch[0] + '  ' + consolidatedImport + '\n'
        );
      } else {
        // Insert after script module tag if no defineMeta import found
        processed = processed.replace(/<script module>\n/, `<script module>\n  ${consolidatedImport}\n`);
      }
    }

    // Fix JSX to Svelte syntax
    processed = processed
      // Fix className to class
      .replace(/className=/g, 'class=')
      // Fix onClick to on:click (Svelte 4 style) or onclick (Svelte 5 style)
      .replace(/onClick=/g, 'onclick=')
      .replace(/onChange=/g, 'onchange=')
      .replace(/onInput=/g, 'oninput=');

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

    // Svelte-specific validations for addon-svelte-csf v5+

    // Check for defineMeta import (required for v5+)
    if (!storyContent.includes('defineMeta') && !storyContent.includes('@storybook/addon-svelte-csf')) {
      errors.push("Missing 'defineMeta' from '@storybook/addon-svelte-csf' - required for v5+");
    }

    // Check for old CSF syntax patterns that cause parser errors
    if (storyContent.includes('export const meta') || storyContent.includes('export default meta')) {
      errors.push("Using old CSF syntax 'export const/default meta' - use defineMeta() instead for addon-svelte-csf v5+");
    }

    // Check for old script context="module" syntax
    if (storyContent.includes('<script context="module">')) {
      errors.push("Using old '<script context=\"module\">' - use '<script module>' for Svelte 5");
    }

    // Check for separate Story/Template imports (should come from defineMeta in v5+)
    if (/import\s*\{[^}]*Story[^}]*\}\s*from\s*['"]@storybook\/addon-svelte-csf['"]/.test(storyContent) &&
        !storyContent.includes('defineMeta')) {
      errors.push("Importing Story separately - use 'const { Story } = defineMeta(...)' instead");
    }

    if (storyContent.includes("import React from 'react'")) {
      errors.push('React import found in Svelte story');
    }

    // Check for JSX-style event handlers (camelCase)
    // Svelte 5 uses lowercase: onclick, onchange
    if (/onClick=\{/.test(storyContent)) {
      errors.push('Using JSX-style onClick - use onclick (lowercase) for Svelte 5');
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
