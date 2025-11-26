/**
 * Web Components Framework Adapter
 *
 * Generates Storybook stories for Web Components (Lit, vanilla, etc.).
 * Supports standard Web Components and Lit framework.
 */

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

    // Fix common issues
    processed = processed
      // Remove React-style className
      .replace(/className=/g, 'class=')
      // Fix JSX-style event handlers
      .replace(/onClick=/g, '@click=')
      .replace(/onChange=/g, '@change=')
      .replace(/onInput=/g, '@input=');

    return processed;
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
