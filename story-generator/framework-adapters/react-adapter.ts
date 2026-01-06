/**
 * React Framework Adapter
 *
 * Generates Storybook stories for React components.
 * Supports CSF 3.0 format with TypeScript.
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

export class ReactAdapter extends BaseFrameworkAdapter {
  readonly type: FrameworkType = 'react';
  readonly name = 'React';
  readonly supportedStoryFrameworks: StoryFramework[] = [
    'storybook-react',
    'ladle',
    'chromatic',
  ];
  readonly defaultExtension = '.stories.tsx';

  /**
   * Get glob patterns for React component files
   */
  getComponentFilePatterns(): string[] {
    return ['**/*.tsx', '**/*.jsx', '**/*.ts', '**/*.js'];
  }

  /**
   * Extract component names from a React source file.
   * Handles both inline exports and grouped exports.
   */
  extractComponentNamesFromFile(filePath: string, content: string): string[] {
    const names: Set<string> = new Set();

    // 1. Check for inline exports: export function/const/class Name
    const inlineExportRegex = /export\s+(default\s+)?(function|const|class)\s+([A-Z][A-Za-z0-9]*)/g;
    let match;
    while ((match = inlineExportRegex.exec(content)) !== null) {
      names.add(match[3]);
    }

    // 2. Check for grouped exports: export { Name1, Name2 }
    const groupedExportRegex = /export\s*\{\s*([^}]+)\s*\}/g;
    while ((match = groupedExportRegex.exec(content)) !== null) {
      const exports = match[1].split(',');
      for (const exp of exports) {
        // Handle "Name" or "Name as Alias" - we want the original name
        const namePart = exp.trim().split(/\s+as\s+/)[0].trim();
        // Only include PascalCase names (components start with uppercase)
        if (/^[A-Z][A-Za-z0-9]*$/.test(namePart)) {
          names.add(namePart);
        }
      }
    }

    // 3. Check for React.forwardRef patterns
    const forwardRefRegex = /export\s+const\s+([A-Z][A-Za-z0-9]*)\s*=\s*(?:React\.)?forwardRef/g;
    while ((match = forwardRefRegex.exec(content)) !== null) {
      names.add(match[1]);
    }

    // 4. Fallback to filename if no exports found
    if (names.size === 0) {
      const fileName = path.basename(filePath, path.extname(filePath));
      if (fileName !== 'index' && /^[A-Z]/.test(fileName)) {
        names.add(fileName);
      }
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

    const typescript = options?.typescript !== false;

    // FIX #2: Auto-detect Chakra UI v3 for provider requirements
    const isChakraUI = this.isChakraUIProject(config);

    let chakraInstructions = '';
    if (isChakraUI) {
      chakraInstructions = `

CHAKRA UI v3 CONFIGURATION (CRITICAL):
Chakra UI v3 requires ChakraProvider for proper theming and styling.

OPTION 1 (Recommended): Configure in .storybook/preview.tsx (project-wide):
\`\`\`tsx
// .storybook/preview.tsx
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';

export const decorators = [
  (Story) => (
    <ChakraProvider value={defaultSystem}>
      <Story />
    </ChakraProvider>
  ),
];
\`\`\`

OPTION 2: Wrap individual stories (if preview.tsx not configured):
\`\`\`tsx
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';

export const MyStory: Story = {
  decorators: [
    (Story) => (
      <ChakraProvider value={defaultSystem}>
        <Story />
      </ChakraProvider>
    ),
  ],
};
\`\`\`

IMPORTANT: Without ChakraProvider, you will see "useContext returned undefined" errors.
`;
    }

    // Build import instructions based on importStyle
    const importPath = config.importPath || 'your-library';
    const useIndividualImports = config.importStyle === 'individual';

    let importInstructions: string;
    let additionalImportRules: string;

    if (useIndividualImports) {
      importInstructions = `MANDATORY IMPORTS - First lines of every story file:
1. import React from 'react';
2. import type { Meta, StoryObj } from '@storybook/react';
3. import { ComponentName } from '${importPath}/component-name';  // INDIVIDUAL FILE IMPORTS REQUIRED

🚫 INDIVIDUAL FILE IMPORTS REQUIRED 🚫
This library does NOT have a barrel export. Each component MUST be imported from its own file:
- import { Button } from '${importPath}/button';
- import { Card, CardHeader, CardContent } from '${importPath}/card';
- import { Dialog, DialogTrigger, DialogContent } from '${importPath}/dialog';

WRONG - DO NOT USE (will cause "Failed to fetch dynamically imported module" error):
- import { Button, Card, Dialog } from '${importPath}';  // ❌ NO BARREL EXPORT EXISTS

File naming convention:
- Components are PascalCase: Button, AlertDialog, NavigationMenu
- Files are kebab-case: button, alert-dialog, navigation-menu
- Sub-components share files: CardHeader → card, DialogTrigger → dialog`;
      additionalImportRules = `- 🚫 INDIVIDUAL IMPORTS REQUIRED: Each component from its own file
- Sub-components share the same file (CardHeader, CardContent → '${importPath}/card')
- File names use kebab-case (AlertDialog → alert-dialog)`;
    } else {
      importInstructions = `MANDATORY IMPORTS - First lines of every story file:
1. import React from 'react';
2. import type { Meta, StoryObj } from '@storybook/react';
3. import { ComponentName } from '${importPath}';`;
      additionalImportRules = '';
    }

    // Build the example import based on importStyle
    const exampleImport = useIndividualImports
      ? `import { Button } from '${importPath}/button';`
      : `import { Button } from '${importPath}';`;

    return `You are an expert React developer creating Storybook stories using CSF 3.0 format.
Use ONLY the React components from the ${componentSystemName} listed below.

${importInstructions}

${typescript ? 'Use TypeScript with proper type annotations.' : 'Use JavaScript.'}
${chakraInstructions}
COMPONENT IMPORT RULES:
${additionalImportRules}
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
${exampleImport}

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

  /**
   * FIX #2: Detect if the project uses Chakra UI v3
   */
  private isChakraUIProject(config: StoryUIConfig): boolean {
    const importPath = config.importPath || '';
    return (
      importPath.includes('@chakra-ui') ||
      importPath === 'chakra-ui' ||
      config.componentPrefix === 'Chakra'
    );
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'your-library';
    const useIndividualImports = config.importStyle === 'individual';

    // Generate import statements based on importStyle
    let singleComponentImport: string;
    let multiComponentImport: string;

    if (useIndividualImports) {
      singleComponentImport = `import { Button } from '${lib}/button';`;
      multiComponentImport = `import { Card } from '${lib}/card';
import { Button } from '${lib}/button';`;
    } else {
      singleComponentImport = `import { Button } from '${lib}';`;
      multiComponentImport = `import { Card, Button, Text } from '${lib}';`;
    }

    return `
## Example Stories

### Single Component Story
\`\`\`tsx
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
${singleComponentImport}

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
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
${multiComponentImport}

const meta: Meta = {
  title: 'Examples/Card Layout',
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const ProductCard: Story = {
  render: () => (
    <Card style={{ width: 300 }}>
      <img src="https://picsum.photos/300/200" alt="Product" />
      <div>Product Name</div>
      <div>$99.00</div>
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
    const useIndividualImports = config.importStyle === 'individual';
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

    // Convert PascalCase to kebab-case for individual imports
    const kebabName = firstComponent.name
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();

    const importStatement = useIndividualImports
      ? `import { ${firstComponent.name} } from '${lib}/${kebabName}';`
      : `import { ${firstComponent.name} } from '${lib}';`;

    return `
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
${importStatement}

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
      // Remove only EMPTY children in args (children: '' or children: "")
      // The regex must require matching quotes to avoid removing valid children like children: 'Button'
      .replace(/children:\s*['"]['"],?\s*/g, '')
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
