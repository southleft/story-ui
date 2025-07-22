/**
 * Alternative documentation sources that don't require user scraping
 */

export interface DocumentationSource {
  type: 'bundled' | 'types' | 'api' | 'static';
  data?: any;
  url?: string;
  lastUpdated?: string;
}

/**
 * Pre-bundled documentation for popular design systems
 * This avoids the need for users to run scraping commands
 */
export const BUNDLED_DOCUMENTATION: Record<string, any> = {
  '@shopify/polaris': {
    version: 'v13',
    lastUpdated: '2024-07-05',
    components: {
      // Core components with their modern usage
      'Text': {
        description: 'Typography component for all text rendering',
        variants: ['heading3xl', 'heading2xl', 'headingXl', 'headingLg', 'headingMd', 'headingSm', 'headingXs', 'bodyLg', 'bodyMd', 'bodySm', 'bodyXs'],
        requiredProps: ['as'],
        commonProps: ['variant', 'as', 'tone', 'fontWeight', 'color'],
        examples: [
          { label: 'Heading', code: '<Text variant="headingLg" as="h2">Title</Text>' },
          { label: 'Body text', code: '<Text variant="bodyMd" as="p">Content</Text>' }
        ]
      },
      'Button': {
        description: 'Interactive button component',
        variants: ['primary', 'secondary', 'tertiary'],
        commonProps: ['variant', 'tone', 'size', 'fullWidth', 'disabled'],
        examples: [
          { label: 'Primary button', code: '<Button variant="primary">Save</Button>' },
          { label: 'Destructive', code: '<Button tone="critical">Delete</Button>' }
        ]
      },
      'Card': {
        description: 'Container for grouping related content',
        commonProps: ['padding', 'background'],
        notes: 'No longer uses Card.Section - apply padding directly'
      },
      'BlockStack': {
        description: 'Vertical stack layout component',
        commonProps: ['gap', 'align', 'inlineAlign'],
        examples: [
          { label: 'With spacing', code: '<BlockStack gap="400">...</BlockStack>' }
        ]
      },
      'InlineStack': {
        description: 'Horizontal stack layout component',
        commonProps: ['gap', 'align', 'blockAlign', 'wrap'],
        examples: [
          { label: 'Space between', code: '<InlineStack align="space-between">...</InlineStack>' }
        ]
      },
      'Grid': {
        description: 'Responsive grid layout',
        subComponents: ['Grid.Cell'],
        examples: [
          { label: 'Responsive columns', code: '<Grid><Grid.Cell columnSpan={{xs: 6, lg: 3}}>...</Grid.Cell></Grid>' }
        ]
      },
      'Badge': {
        description: 'Status indicator component',
        commonProps: ['tone', 'progress'],
        notes: 'Uses "tone" prop instead of deprecated "status"'
      },
      'TextField': {
        description: 'Single-line text input',
        commonProps: ['label', 'value', 'onChange', 'type', 'error', 'helpText']
      },
      'Select': {
        description: 'Dropdown selection input',
        commonProps: ['label', 'options', 'value', 'onChange']
      }
    },
    deprecatedComponents: {
      'Heading': { replacement: 'Text', migration: 'Use Text with variant="heading*" and as="h*"' },
      'Subheading': { replacement: 'Text', migration: 'Use Text with variant="headingSm" and as="h3"' },
      'Caption': { replacement: 'Text', migration: 'Use Text with variant="bodySm"' },
      'TextStyle': { replacement: 'Text', migration: 'Use Text with appropriate tone/fontWeight props' },
      'DisplayText': { replacement: 'Text', migration: 'Use Text with variant="headingXl" or larger' },
      'VisuallyHidden': { replacement: 'Text', migration: 'Use Text with visuallyHidden prop' },
      'Stack': { replacement: 'BlockStack/InlineStack', migration: 'Use BlockStack for vertical, InlineStack for horizontal' },
      'FormLayout': { replacement: 'Form with BlockStack', migration: 'Use Form component with BlockStack for layout' },
      'Card.Section': { replacement: 'Card', migration: 'Use Card with padding prop instead of sections' },
      'LegacyCard': { replacement: 'Card', migration: 'Use new Card component' },
      'LegacyGrid': { replacement: 'Grid', migration: 'Use Grid component' }
    },
    patterns: {
      forms: {
        description: 'Form patterns using modern components',
        example: `
<Form onSubmit={handleSubmit}>
  <BlockStack gap="400">
    <TextField label="Email" type="email" value={email} onChange={setEmail} />
    <TextField label="Password" type="password" value={password} onChange={setPassword} />
    <Button submit variant="primary">Submit</Button>
  </BlockStack>
</Form>`
      }
    }
  },

  '@chakra-ui/react': {
    version: 'v2',
    lastUpdated: '2024-07-05',
    components: {
      'Box': { description: 'Generic container component' },
      'Flex': { description: 'Flexbox container' },
      'Stack': { description: 'Vertical stack layout' },
      'HStack': { description: 'Horizontal stack layout' },
      'VStack': { description: 'Vertical stack layout' },
      'Button': {
        variants: ['solid', 'outline', 'ghost', 'link'],
        colorSchemes: ['blue', 'green', 'red', 'orange', 'purple', 'pink']
      },
      'Text': { description: 'Typography component' },
      'Heading': {
        sizes: ['2xl', 'xl', 'lg', 'md', 'sm', 'xs'],
        description: 'Heading typography component'
      }
    }
  },

  '@base_ui/react': {
    version: 'latest',
    lastUpdated: '2024-07-05',
    components: {
      'Button': {
        description: 'Unstyled button component with focus management',
        props: ['disabled', 'onClick', 'children']
      },
      'Input': {
        description: 'Unstyled input component',
        props: ['value', 'onChange', 'placeholder', 'disabled']
      },
      'Select': {
        description: 'Unstyled select component',
        props: ['value', 'onChange', 'multiple', 'disabled']
      },
      'Checkbox': {
        description: 'Unstyled checkbox component',
        props: ['checked', 'onChange', 'disabled']
      },
      'Switch': {
        description: 'Unstyled switch component',
        props: ['checked', 'onChange', 'disabled']
      },
      'Slider': {
        description: 'Unstyled slider component',
        props: ['value', 'onChange', 'min', 'max', 'step']
      }
    }
  }
};

/**
 * Get documentation for a design system
 * Falls back to bundled docs if no scraped docs exist
 */
export function getDocumentation(importPath: string): any {
  // First check for scraped documentation
  const cacheFile = `.story-ui-cache/${importPath.replace(/[@\/]/g, '-')}-docs.json`;

  if (typeof window === 'undefined') {
    // Node.js environment
    try {
      const fs = require('fs');
      if (fs.existsSync(cacheFile)) {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      }
    } catch (e) {
      // Fall through to bundled
    }
  }

  // Fall back to bundled documentation
  return BUNDLED_DOCUMENTATION[importPath] || null;
}

/**
 * Check if a component is deprecated
 */
export function isDeprecatedComponent(importPath: string, componentName: string): boolean {
  const docs = getDocumentation(importPath);
  return docs?.deprecatedComponents?.[componentName] !== undefined;
}

/**
 * Get replacement for deprecated component
 */
export function getComponentReplacement(importPath: string, componentName: string): string | null {
  const docs = getDocumentation(importPath);
  const deprecation = docs?.deprecatedComponents?.[componentName];
  return deprecation?.replacement || null;
}
