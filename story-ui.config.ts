import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Component configuration interface
export interface ComponentConfig {
  name: string;
  displayName?: string;
  importPath?: string;
  props?: string[];
  examples?: string[];
  description?: string;
  category?: 'layout' | 'content' | 'form' | 'navigation' | 'feedback' | 'other';
  slots?: string[];
}

// Layout rules configuration
export interface LayoutRules {
  multiColumnWrapper: string;
  columnComponent: string;
  containerComponent?: string;
  layoutExamples?: {
    twoColumn?: string;
    threeColumn?: string;
    [key: string]: string | undefined;
  };
  prohibitedElements?: string[];
}

// Additional imports configuration
export interface AdditionalImport {
  path: string;
  components: string[];
}



// Main Story UI configuration interface
export interface StoryUIConfig {
  generatedStoriesPath: string;
  componentsPath?: string;
  componentsMetadataPath?: string;
  storyPrefix: string;
  defaultAuthor: string;
  importPath: string;
  componentPrefix: string;
  components: ComponentConfig[];
  layoutRules: LayoutRules;
  sampleStory: string;
  systemPrompt?: string;
  layoutInstructions?: string[];
  examples?: string[];
  additionalImports?: AdditionalImport[];
  considerationsPath?: string;
  storybookFramework?: string; // e.g., '@storybook/react-vite', '@storybook/react-webpack5', '@storybook/nextjs'
  context7?: {
    enabled?: boolean;
    apiUrl?: string;
    timeout?: number;
    cacheEnabled?: boolean;
  };
}

// Default generic configuration
export const DEFAULT_CONFIG: StoryUIConfig = {
  generatedStoriesPath: path.resolve(process.cwd(), './src/stories/generated/'),
  componentsPath: undefined, // No default path - should be set only for local component libraries
  componentsMetadataPath: undefined,
  storyPrefix: 'Generated/',
  defaultAuthor: 'Story UI AI',
  importPath: 'your-component-library',
  componentPrefix: '',
  components: [], // Will be populated dynamically
  layoutRules: {
    multiColumnWrapper: 'div',
    columnComponent: 'div',
    containerComponent: 'div',
    layoutExamples: {
      twoColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
  <div>
    <Card>
      <h3>Left Card</h3>
      <p>Left content</p>
    </Card>
  </div>
  <div>
    <Card>
      <h3>Right Card</h3>
      <p>Right content</p>
    </Card>
  </div>
</div>`,
      threeColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem'}}>
  <div>
    <Card>
      <h3>Column 1</h3>
      <p>First column content</p>
    </Card>
  </div>
  <div>
    <Card>
      <h3>Column 2</h3>
      <p>Second column content</p>
    </Card>
  </div>
  <div>
    <Card>
      <h3>Column 3</h3>
      <p>Third column content</p>
    </Card>
  </div>
</div>`
    },
    prohibitedElements: []
  },
  sampleStory: `import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Card } from 'your-component-library';

const meta = {
  title: 'Generated/Sample Layout',
  component: Card,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <Card>
        <h3>Sample Card</h3>
        <p>Sample content</p>
      </Card>
    )
  }
};`
};

// Generic configuration template for other design systems
export const GENERIC_CONFIG_TEMPLATE: Partial<StoryUIConfig> = {
  storyPrefix: 'Generated/',
  defaultAuthor: 'Story UI AI',
  componentPrefix: '',
  layoutRules: {
    multiColumnWrapper: 'div',
    columnComponent: 'div',
    layoutExamples: {
      twoColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
</div>`,
      threeColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
  <div>Column 3 content</div>
</div>`
    },
    prohibitedElements: []
  }
};

// Default configuration - should be overridden by user's story-ui.config.js
export const STORY_UI_CONFIG: StoryUIConfig = DEFAULT_CONFIG;

// Function to merge user config with defaults
export function createStoryUIConfig(userConfig: Partial<StoryUIConfig>): StoryUIConfig {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    layoutRules: {
      ...DEFAULT_CONFIG.layoutRules,
      ...userConfig.layoutRules,
      layoutExamples: {
        ...DEFAULT_CONFIG.layoutRules.layoutExamples,
        ...userConfig.layoutRules?.layoutExamples
      }
    }
  };
}
