/**
 * React Framework Adapter
 *
 * Generates Storybook stories for React components.
 * Supports CSF 3.0 format with TypeScript.
 */

import {
  FrameworkType,
  StoryFramework,
  StoryGenerationOptions,
} from './types.js';
import { BaseFrameworkAdapter } from './base-adapter.js';
import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';

export class ReactAdapter extends BaseFrameworkAdapter {
  readonly type: FrameworkType = 'react';
  readonly name = 'React';
  readonly supportedStoryFrameworks: StoryFramework[] = [
    'storybook-react',
    'ladle',
    'chromatic',
  ];
  readonly defaultExtension = '.stories.tsx';

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

    const typescript = options?.typescript !== false;

    return `You are an expert React developer creating Storybook stories using CSF 3.0 format.
Use ONLY the React components from the ${componentSystemName} listed below.

MANDATORY IMPORTS - First lines of every story file:
1. import React from 'react';
2. import type { Meta, StoryObj } from '@storybook/react';
3. import { ComponentName } from '${config.importPath || 'your-library'}';

${typescript ? 'Use TypeScript with proper type annotations.' : 'Use JavaScript.'}

COMPONENT IMPORT RULES:
- ONLY import components listed in the "Available Components" section
- Use the EXACT import path shown after each component name
- Components not in the list DO NOT EXIST

STORY STRUCTURE (CSF 3.0):
- Use ES modules: export default meta; NOT module.exports
- Define Meta object with component, title, and parameters
- Export named stories as StoryObj<typeof ComponentName>

CRITICAL RULES:
- NEVER pass children through args - use render functions instead
- For layouts with multiple components, omit component from meta
- Use render: (args) => <Component {...args} /> for custom rendering

Example structure:
\`\`\`tsx
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '${config.importPath || 'your-library'}';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: 'primary', children: 'Click me' },
};

export const WithIcon: Story = {
  render: () => (
    <Button variant="primary">
      <Icon /> Click me
    </Button>
  ),
};
\`\`\`

${this.getCommonRules()}`;
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'your-library';

    return `
## Example Stories

### Single Component Story
\`\`\`tsx
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '${lib}';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'Button' },
};

export const Primary: Story = {
  args: { variant: 'primary', children: 'Primary Button' },
};
\`\`\`

### Layout Story (Multiple Components)
\`\`\`tsx
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Card, Button, Text } from '${lib}';

const meta: Meta = {
  title: 'Examples/Card Layout',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const ProductCard: Story = {
  render: () => (
    <Card style={{ width: 300 }}>
      <img src="https://picsum.photos/300/200" alt="Product" />
      <Text variant="heading">Product Name</Text>
      <Text>$99.00</Text>
      <Button variant="primary">Add to Cart</Button>
    </Card>
  ),
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
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'Examples/Sample',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <div>Sample story content</div>,
};
`;
    }

    return `
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ${firstComponent.name} } from '${lib}';

const meta: Meta<typeof ${firstComponent.name}> = {
  title: 'Components/${firstComponent.name}',
  component: ${firstComponent.name},
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
`;
  }

  getStoryTemplate(options?: StoryGenerationOptions): string {
    const typescript = options?.typescript !== false;
    const ext = typescript ? 'tsx' : 'jsx';

    return `
// {{componentName}}.stories.${ext}
import React from 'react';
${typescript ? "import type { Meta, StoryObj } from '@storybook/react';" : ''}
import { {{componentName}} } from '{{importPath}}';

const meta${typescript ? ': Meta<typeof {{componentName}}>' : ''} = {
  title: '{{category}}/{{componentName}}',
  component: {{componentName}},
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
${typescript ? 'type Story = StoryObj<typeof meta>;' : ''}

export const Default${typescript ? ': Story' : ''} = {
  args: {},
};
`;
  }

  /**
   * Post-process React stories
   */
  postProcess(storyContent: string): string {
    let processed = super.postProcess(storyContent);

    // Ensure React import is first
    if (!processed.startsWith("import React from 'react'")) {
      const lines = processed.split('\n');
      const reactImportIndex = lines.findIndex(line =>
        line.includes("import React from 'react'")
      );

      if (reactImportIndex > 0) {
        const reactImport = lines.splice(reactImportIndex, 1)[0];
        lines.unshift(reactImport);
        processed = lines.join('\n');
      }
    }

    // Fix common issues
    processed = processed
      // Remove empty children in args
      .replace(/children:\s*['"]?['"]?,?\s*/g, '')
      // Fix double quotes in JSX
      .replace(/class=/g, 'className=');

    return processed;
  }

  /**
   * Validate React story
   */
  validate(storyContent: string): { valid: boolean; errors: string[] } {
    const baseValidation = super.validate(storyContent);
    const errors = [...baseValidation.errors];

    // React-specific validations
    if (!storyContent.includes("import React from 'react'")) {
      errors.push("Missing 'import React from 'react'' statement");
    }

    if (!storyContent.includes('export default')) {
      errors.push('Missing default export');
    }

    if (storyContent.includes('module.exports')) {
      errors.push('Using CommonJS exports instead of ES modules');
    }

    // Check for children in args (common mistake)
    if (/args:\s*{[^}]*children:\s*</.test(storyContent)) {
      errors.push('JSX children should not be in args - use render function instead');
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
export function createReactAdapter(): ReactAdapter {
  return new ReactAdapter();
}
