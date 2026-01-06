/**
 * Web Components Framework Adapter
 *
 * Generates Storybook stories for Web Components (Lit, vanilla, etc.).
 * Supports standard Web Components and Lit framework.
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

export class WebComponentsAdapter extends BaseFrameworkAdapter {
  readonly type: FrameworkType = 'web-components';
  readonly name = 'Web Components';
  readonly supportedStoryFrameworks: StoryFramework[] = [
    'storybook-web-components',
    'chromatic',
  ];
  readonly defaultExtension = '.stories.ts';

  /**
   * Get glob patterns for Web Component files
   */
  getComponentFilePatterns(): string[] {
    return ['**/*.ts', '**/*.js', '**/custom-elements.json'];
  }

  /**
   * Extract component names from a Web Component source file.
   * Handles vanilla customElements.define, Lit @customElement, and Stencil @Component.
   */
  extractComponentNamesFromFile(filePath: string, content: string): string[] {
    const names: Set<string> = new Set();

    // Check for Custom Elements Manifest (preferred)
    if (filePath.endsWith('custom-elements.json')) {
      try {
        const manifest = JSON.parse(content);
        if (manifest.modules) {
          for (const module of manifest.modules) {
            if (module.declarations) {
              for (const declaration of module.declarations) {
                if (declaration.customElement && declaration.tagName) {
                  // Convert tag-name to PascalCase
                  const pascalName = this.tagToPascalCase(declaration.tagName);
                  names.add(pascalName);
                }
              }
            }
          }
        }
        return Array.from(names);
      } catch {
        // Invalid JSON, continue with regex patterns
      }
    }

    // Pattern 1: Vanilla customElements.define('tag-name', ClassName) with named class
    const vanillaDefineNamedRegex = /customElements\.define\(\s*['"]([a-z][\w-]*)['"],\s*([A-Z][A-Za-z0-9]*)\s*[),]/g;
    let match;
    while ((match = vanillaDefineNamedRegex.exec(content)) !== null) {
      names.add(match[2]); // Use the class name
    }

    // Pattern 1b: Vanilla customElements.define('tag-name', class extends...) - inline class
    // For inline classes, convert tag name to PascalCase
    const vanillaDefineInlineRegex = /customElements\.define\(\s*['"]([a-z][\w-]*)['"],\s*class\s+extends/gi;
    while ((match = vanillaDefineInlineRegex.exec(content)) !== null) {
      const pascalName = this.tagToPascalCase(match[1]);
      names.add(pascalName);
    }

    // Pattern 2: Lit @customElement('tag-name') decorator (handles multiline)
    const litDecoratorRegex = /@customElement\(\s*['"]([a-z][\w-]*)['"][^)]*\)[\s\S]*?(?:export\s+)?class\s+([A-Z][A-Za-z0-9]*)/g;
    while ((match = litDecoratorRegex.exec(content)) !== null) {
      names.add(match[2]); // Use the class name
    }

    // Pattern 3: Stencil @Component({ tag: 'tag-name' }) decorator
    const stencilRegex = /@Component\(\s*\{[^}]*tag:\s*['"]([a-z][\w-]*)['"][^}]*\}\s*\)\s*(?:export\s+)?class\s+(\w+)/gi;
    while ((match = stencilRegex.exec(content)) !== null) {
      names.add(match[2]); // Use the class name
    }

    // Pattern 4: Named exports from barrel files
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

    return Array.from(names);
  }

  /**
   * Convert a kebab-case tag name to PascalCase
   */
  private tagToPascalCase(tagName: string): string {
    return tagName
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('');
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

    return `You are an expert Web Components developer creating Storybook stories using CSF 3.0 format.
Use ONLY the Web Components from the ${componentSystemName} listed below.

MANDATORY IMPORTS - First lines of every story file:
1. import { html } from 'lit';
2. import type { Meta, StoryObj } from '@storybook/web-components';
3. import '${config.importPath || 'your-library'}'; // Register custom elements

WEB COMPONENTS STORY FORMAT:
- Use the html template literal from Lit for rendering
- Custom elements use kebab-case tag names (e.g., <my-button>)
- Properties are set as attributes or with . prefix for property binding
- Events use @ prefix (e.g., @click)

COMPONENT REGISTRATION:
- Web Components must be registered before use
- Import the component file to auto-register: import 'my-library/my-button';
- Or import the class and define: customElements.define('my-button', MyButton);

STORY STRUCTURE (CSF 3.0):
- Meta object with title and optional component reference
- Use render function with html\`\` template literal
- Export named stories as StoryObj

CRITICAL RULES:
- Use html template literal, NOT JSX
- Use kebab-case for tag names
- Use .property for property binding, attribute for attributes
- Use @event for event handlers

Example structure:
\`\`\`typescript
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import 'your-library/button';

const meta: Meta = {
  title: 'Components/Button',
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
  },
};

export default meta;
type Story = StoryObj;

export const Primary: Story = {
  args: { variant: 'primary' },
  render: (args) => html\`
    <my-button variant=\${args.variant}>
      Click me
    </my-button>
  \`,
};

export const WithIcon: Story = {
  render: () => html\`
    <my-button variant="primary">
      <my-icon slot="icon" name="star"></my-icon>
      Starred
    </my-button>
  \`,
};
\`\`\`

ATTRIBUTE VS PROPERTY BINDING:
- Attributes (string values): variant="primary"
- Properties (any value): .disabled=\${true}
- Boolean attributes: ?disabled=\${true}
- Events: @click=\${handleClick}

SLOTS:
- Default slot: Content between tags
- Named slots: Use slot="name" attribute
- Example: <my-card><span slot="header">Title</span>Content</my-card>

${this.getCommonRules()}`;
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'your-library';

    return `
## Example Stories for Web Components

### Single Component Story
\`\`\`typescript
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import 'your-library/button';

const meta: Meta = {
  title: 'Components/Button',
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
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: { variant: 'primary', size: 'medium' },
  render: (args) => html\`
    <my-button
      variant=\${args.variant}
      size=\${args.size}
    >
      Button
    </my-button>
  \`,
};

export const Disabled: Story = {
  render: () => html\`
    <my-button variant="primary" ?disabled=\${true}>
      Disabled Button
    </my-button>
  \`,
};
\`\`\`

### Layout Story (Multiple Components)
\`\`\`typescript
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import '${lib}/card';
import 'your-library/button';
import '${lib}/text';

const meta: Meta = {
  title: 'Examples/Card Layout',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const ProductCard: Story = {
  render: () => html\`
    <my-card style="width: 300px">
      <img slot="media" src="https://picsum.photos/300/200" alt="Product">
      <span slot="header">Product Name</span>
      <my-text>$99.00</my-text>
      <my-button slot="footer" variant="primary">Add to Cart</my-button>
    </my-card>
  \`,
};
\`\`\`

### With Event Handling
\`\`\`typescript
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import 'your-library/button';

const meta: Meta = {
  title: 'Components/Button',
};

export default meta;
type Story = StoryObj;

export const WithClickHandler: Story = {
  render: () => html\`
    <my-button
      variant="primary"
      @click=\${(e: Event) => console.log('Clicked!', e)}
    >
      Click me
    </my-button>
  \`,
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
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';

const meta: Meta = {
  title: 'Examples/Sample',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => html\`<div>Sample story content</div>\`,
};
`;
    }

    // Convert PascalCase to kebab-case for tag name
    const tagName = this.toKebabCase(firstComponent.name);

    return `
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import '${lib}/${tagName}';

const meta: Meta = {
  title: 'Components/${firstComponent.name}',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => html\`<${tagName}></${tagName}>\`,
};
`;
  }

  getStoryTemplate(options?: StoryGenerationOptions): string {
    return `
// {{componentName}}.stories.ts
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import '{{importPath}}';

const meta: Meta = {
  title: '{{category}}/{{componentName}}',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => html\`<{{tagName}}></{{tagName}}>\`,
};
`;
  }

  /**
   * Convert PascalCase to kebab-case
   */
  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
      .toLowerCase();
  }

  /**
   * Post-process Web Components stories
   */
  postProcess(storyContent: string): string {
    let processed = super.postProcess(storyContent);

    // Ensure lit import is present
    if (!processed.includes("import { html } from 'lit'")) {
      processed = "import { html } from 'lit';\n" + processed;
    }

    // FIX #3: Remove React imports from Web Components stories
    // LLMs sometimes incorrectly include React imports in non-React frameworks
    processed = processed.replace(/import React from ['"]react['"];?\n?/g, '');
    processed = processed.replace(/import \* as React from ['"]react['"];?\n?/g, '');

    // Fix Shoelace imports - add /dist to the path
    // Wrong: @shoelace-style/shoelace/components/...
    // Right: @shoelace-style/shoelace/dist/components/...
    processed = processed.replace(
      /@shoelace-style\/shoelace\/components\//g,
      '@shoelace-style/shoelace/dist/components/'
    );

    // Fix common issues
    processed = processed
      // Remove React-style className
      .replace(/className=/g, 'class=')
      // Fix JSX-style event handlers
      .replace(/onClick=/g, '@click=')
      .replace(/onChange=/g, '@change=')
      .replace(/onInput=/g, '@input=');

    // FIX #1: Handle escaped backticks in nested template literals
    // When LLMs generate complex Lit templates with inline JavaScript that uses
    // template literals, they sometimes escape backticks incorrectly causing
    // Babel parsing errors like "Expecting Unicode escape sequence \uXXXX"
    processed = this.fixNestedTemplateLiterals(processed);

    return processed;
  }

  /**
   * Fix nested template literal escaping issues
   *
   * Problem: LLMs generate code like:
   *   innerHTML: \`<sl-icon></sl-icon>\`
   *
   * This causes Babel syntax errors. The fix converts problematic patterns
   * to use string concatenation instead of nested template literals.
   */
  private fixNestedTemplateLiterals(code: string): string {
    // Pattern 1: innerHTML with escaped template literals
    // Convert: innerHTML: \`...\` to innerHTML: '...'
    code = code.replace(
      /innerHTML:\s*\\`([^`]*?)\\`/g,
      (match, content) => {
        // Convert to single quotes, escaping any existing single quotes
        const escaped = content.replace(/'/g, "\\'");
        return `innerHTML: '${escaped}'`;
      }
    );

    // Pattern 2: Template literals with escaped backticks inside html``
    // These patterns indicate the LLM tried to nest template literals incorrectly
    // Look for patterns like \`...\` that appear inside render functions
    code = code.replace(/\\`/g, (match, offset, fullString) => {
      // Check if we're inside a JavaScript context (not in a comment or string)
      const before = fullString.slice(Math.max(0, offset - 50), offset);

      // If this looks like it's in an innerHTML or template context, convert to quote
      if (/innerHTML\s*[:=]\s*$/.test(before) ||
          /Object\.assign\([^)]*\{\s*$/.test(before) ||
          /:\s*$/.test(before)) {
        return "'";
      }

      // Otherwise keep the escaped backtick (might be intentional)
      return match;
    });

    return code;
  }

  /**
   * Validate Web Components story
   */
  validate(storyContent: string): { valid: boolean; errors: string[] } {
    const baseValidation = super.validate(storyContent);
    const errors = [...baseValidation.errors];

    // Web Components specific validations
    if (!storyContent.includes("import { html } from 'lit'")) {
      errors.push("Missing 'import { html } from 'lit'' statement");
    }

    if (storyContent.includes('import React')) {
      errors.push('React import found in Web Components story');
    }

    // Check for JSX syntax (should use lit html)
    if (/<[A-Z][a-zA-Z]*\s/.test(storyContent) && !storyContent.includes('html`')) {
      errors.push('Using JSX syntax instead of Lit html template');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate import statements for Web Components
   */
  generateImports(
    components: DiscoveredComponent[],
    config: StoryUIConfig
  ): string {
    const lib = config.importPath || 'your-library';
    const imports: string[] = ["import { html } from 'lit';"];

    // Import each component (side-effect import to register custom element)
    for (const component of components) {
      const tagName = this.toKebabCase(component.name);
      imports.push(`import '${lib}/${tagName}';`);
    }

    return imports.join('\n');
  }
}

/**
 * Factory function
 */
export function createWebComponentsAdapter(): WebComponentsAdapter {
  return new WebComponentsAdapter();
}
