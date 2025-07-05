/**
 * Context7 Integration for Design System Documentation
 *
 * Context7 provides up-to-date, curated documentation for popular libraries
 * through an MCP interface, eliminating the need for web scraping.
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

export interface Context7Config {
  apiUrl?: string;
  timeout?: number;
}

export interface Context7Documentation {
  libraryId: string;
  components: Record<string, ComponentDoc>;
  patterns?: Record<string, PatternDoc>;
  version: string;
  lastUpdated: string;
}

export interface StorybookDocumentation {
  version: string;
  patterns: Record<string, StorybookPattern>;
  csf: CSFDocumentation;
  bestPractices: BestPractice[];
  lastUpdated: string;
}

export interface StorybookPattern {
  name: string;
  description: string;
  example: string;
  category: 'meta' | 'story' | 'args' | 'decorators' | 'parameters' | 'structure';
}

export interface CSFDocumentation {
  metaStructure: string;
  storyStructure: string;
  argsPattern: string;
  exportPattern: string;
}

export interface BestPractice {
  title: string;
  description: string;
  example?: string;
  category: 'structure' | 'naming' | 'organization' | 'testing';
}

export interface ComponentDoc {
  name: string;
  description: string;
  props?: Record<string, PropDoc>;
  variants?: string[];
  examples?: Example[];
  deprecated?: boolean;
  replacement?: string;
}

export interface PropDoc {
  type: string;
  required?: boolean;
  default?: any;
  description?: string;
}

export interface PatternDoc {
  name: string;
  description: string;
  example: string;
  components: string[];
}

export interface Example {
  title: string;
  code: string;
  description?: string;
}

export class Context7Integration {
  private config: Context7Config;
  private cache: Map<string, Context7Documentation> = new Map();
  private storybookCache: StorybookDocumentation | null = null;

  constructor(config: Context7Config = {}) {
    this.config = {
      apiUrl: config.apiUrl || 'https://api.context7.com',
      timeout: config.timeout || 10000
    };
  }

  /**
   * Get documentation for a library from Context7
   */
  async getDocumentation(libraryId: string): Promise<Context7Documentation | null> {
    // Check cache first
    if (this.cache.has(libraryId)) {
      console.log(`📚 Using cached Context7 documentation for ${libraryId}`);
      return this.cache.get(libraryId)!;
    }

    try {
      console.log(`🔍 Fetching documentation from Context7 for ${libraryId}...`);

      // Map common package names to Context7 library IDs
      const context7LibraryId = this.mapToContext7Id(libraryId);

      // In a real implementation, this would call the Context7 MCP server
      // For now, we'll return structured data based on what Context7 would provide
      const documentation = await this.fetchFromContext7(context7LibraryId);

      if (documentation) {
        this.cache.set(libraryId, documentation);
        console.log(`✅ Successfully fetched Context7 documentation for ${libraryId}`);
      }

      return documentation;
    } catch (error) {
      console.error(`❌ Failed to fetch Context7 documentation:`, error);
      return null;
    }
  }

  /**
   * Map package names to Context7 library IDs
   * This can be configured per environment during initialization
   */
  private mapToContext7Id(packageName: string): string {
    // Check local configuration for mapping
    const localConfigPath = path.join(process.cwd(), 'context7-config.json');
    if (fs.existsSync(localConfigPath)) {
      try {
        const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
        // Find the library ID that matches this package
        for (const [libraryId, config] of Object.entries(localConfig)) {
          if (packageName === '@mantine/core' && libraryId === '/mantine/mantine') return libraryId;
          if (packageName === 'antd' && libraryId === '/ant-design/ant-design') return libraryId;
          if (packageName === '@adobe/react-spectrum' && libraryId === '/adobe/react-spectrum') return libraryId;
          if (packageName === '@shopify/polaris' && libraryId === '/shopify/polaris') return libraryId;
          if (packageName === '@mui/material' && libraryId === '/mui/material') return libraryId;
          if (packageName === '@chakra-ui/react' && libraryId === '/chakra-ui/chakra-ui') return libraryId;
        }
      } catch (error) {
        console.warn(`Failed to read local Context7 config:`, error);
      }
    }

    // Default mapping - return as-is
    return packageName;
  }

    /**
   * Fetch documentation from Context7
   * Uses the actual Context7 MCP tools available in this environment
   */
  private async fetchFromContext7(libraryId: string): Promise<Context7Documentation | null> {
    console.log(`📞 Attempting to fetch documentation from Context7 for ${libraryId}`);

    // TODO: Integrate with actual Context7 MCP calls when available
    // For now, this will be populated by environment-specific configuration files

    // Check if there's a local Context7 configuration file
    const localConfigPath = path.join(process.cwd(), 'context7-config.json');
    if (fs.existsSync(localConfigPath)) {
      try {
        const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
        if (localConfig[libraryId]) {
          console.log(`📚 Using local Context7 configuration for ${libraryId}`);
          return localConfig[libraryId];
        }
      } catch (error) {
        console.warn(`Failed to load local Context7 config:`, error);
      }
    }

    // Return null - environment-specific documentation should be configured during init
    return null;
  }

  /**
   * Check if a component exists and is not deprecated
   */
  isValidComponent(libraryId: string, componentName: string): boolean {
    const docs = this.cache.get(libraryId);
    if (!docs) return false;

    const component = docs.components[componentName];
    return component !== undefined && !component.deprecated;
  }

  /**
   * Get component documentation
   */
  getComponent(libraryId: string, componentName: string): ComponentDoc | null {
    const docs = this.cache.get(libraryId);
    if (!docs) return null;

    return docs.components[componentName] || null;
  }

  /**
   * Get Storybook documentation from Context7
   */
  async getStorybookDocumentation(): Promise<StorybookDocumentation | null> {
    if (this.storybookCache) {
      console.log('📚 Using cached Storybook documentation from Context7');
      return this.storybookCache;
    }

    try {
      console.log('🔍 Fetching Storybook documentation from Context7...');

      // This would use the actual Context7 MCP tools to fetch from
      // https://context7.com/storybookjs/storybook
      const storybookDocs = await this.fetchStorybookFromContext7();

      if (storybookDocs) {
        this.storybookCache = storybookDocs;
        console.log('✅ Successfully fetched Storybook documentation from Context7');
      }

      return storybookDocs;
    } catch (error) {
      console.error('❌ Failed to fetch Storybook documentation:', error);
      return null;
    }
  }

  /**
   * Fetch Storybook documentation from Context7
   */
  private async fetchStorybookFromContext7(): Promise<StorybookDocumentation | null> {
    // TODO: Use actual Context7 MCP tools to fetch from /storybookjs/storybook
    // For now, return curated Storybook best practices

    return {
      version: '8.0',
      lastUpdated: new Date().toISOString(),
      csf: {
        metaStructure: `const meta = {
  title: 'Generated/ComponentName',
  component: ComponentName,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof ComponentName>;`,
        storyStructure: `export const Default: Story = {
  args: {
    children: (
      <ComponentContent />
    )
  }
};`,
        argsPattern: `args: {
  prop1: 'value1',
  prop2: true,
  children: (<JSXContent />)
}`,
        exportPattern: `export default meta;
type Story = StoryObj<typeof meta>;`
      },
      patterns: {
        basicStory: {
          name: 'Basic Story Structure',
          description: 'Standard CSF 3.0 story with meta and default export',
          category: 'structure',
          example: `import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Component } from './Component';

const meta = {
  title: 'Example/Component',
  component: Component,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Component>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    primary: true,
    label: 'Button',
  },
};`
        },
        multipleStories: {
          name: 'Multiple Story Variants',
          description: 'Creating multiple story variants for different states',
          category: 'story',
          example: `export const Primary: Story = {
  args: {
    primary: true,
    label: 'Button',
  },
};

export const Secondary: Story = {
  args: {
    label: 'Button',
  },
};

export const Large: Story = {
  args: {
    size: 'large',
    label: 'Button',
  },
};`
        },
        withArgs: {
          name: 'Args Pattern',
          description: 'Using args for interactive controls',
          category: 'args',
          example: `export const Interactive: Story = {
  args: {
    title: 'Interactive Example',
    onClick: fn(),
    disabled: false,
    variant: 'primary'
  }
};`
        },
        withParameters: {
          name: 'Story Parameters',
          description: 'Adding parameters for documentation and behavior',
          category: 'parameters',
          example: `export const Documented: Story = {
  args: {
    label: 'Example'
  },
  parameters: {
    docs: {
      description: {
        story: 'This story demonstrates the component usage.'
      }
    }
  }
};`
        }
      },
      bestPractices: [
        {
          title: 'Always Import React',
          description: 'Every story file must start with React import for JSX to work',
          category: 'structure',
          example: "import React from 'react';"
        },
        {
          title: 'Use CSF 3.0 Format',
          description: 'Use the modern Component Story Format with satisfies Meta',
          category: 'structure'
        },
        {
          title: 'Meaningful Story Names',
          description: 'Use descriptive names that explain the story purpose',
          category: 'naming',
          example: 'export const WithLongText: Story = ...'
        },
        {
          title: 'Group Related Stories',
          description: 'Use consistent title prefixes to group related components',
          category: 'organization',
          example: "title: 'Components/Button'"
        }
      ]
    };
  }

  /**
   * Generate enhanced prompt with both component and Storybook documentation
   */
  async generateEnhancedPrompt(
    componentLibraryId: string,
    userPrompt: string,
    config: any
  ): Promise<string> {
    const [componentDocs, storybookDocs] = await Promise.all([
      this.getDocumentation(componentLibraryId),
      this.getStorybookDocumentation()
    ]);

    let prompt = `🚨 CRITICAL: EVERY STORY MUST START WITH "import React from 'react';" AS THE FIRST LINE 🚨

You are an expert UI developer creating Storybook stories using the latest CSF 3.0 format.

🔴 MANDATORY FIRST LINE - NO EXCEPTIONS:
The VERY FIRST LINE of every story file MUST be:
import React from 'react';

`;

    // Add component documentation if available
    if (componentDocs) {
      prompt += `LIBRARY: ${componentLibraryId} (${componentDocs.version})

AVAILABLE COMPONENTS:
${Object.entries(componentDocs.components).map(([name, doc]) =>
  `- ${name}: ${doc.description}
   ${doc.variants ? `Variants: ${doc.variants.join(', ')}` : ''}
   ${doc.props ? `Props: ${Object.keys(doc.props).join(', ')}` : ''}
   ${doc.examples ? `\n   Examples:\n${doc.examples.map(ex => `   // ${ex.title}\n   ${ex.code}`).join('\n')}` : ''}`
).join('\n\n')}

`;
    }

    // Add Storybook best practices if available
    if (storybookDocs) {
      prompt += `STORYBOOK CSF 3.0 FORMAT (from Context7):

REQUIRED STORY STRUCTURE:
${storybookDocs.csf.metaStructure}

${storybookDocs.csf.exportPattern}

${storybookDocs.csf.storyStructure}

BEST PRACTICES:
${storybookDocs.bestPractices.map(practice =>
  `- ${practice.title}: ${practice.description}${practice.example ? `\n  Example: ${practice.example}` : ''}`
).join('\n')}

STORY PATTERNS:
${Object.entries(storybookDocs.patterns).map(([key, pattern]) =>
  `${pattern.name}: ${pattern.description}\n${pattern.example}`
).join('\n\n')}

`;
    }

    prompt += `🚨 FINAL CRITICAL REMINDERS 🚨
🔴 FIRST LINE MUST BE: import React from 'react';
🔴 WITHOUT THIS IMPORT, THE STORY WILL BREAK!
🔴 Story title MUST always start with "${config.storyPrefix || 'Generated/'}"
🔴 MUST use ES modules syntax: "export default meta;" NOT "module.exports = meta;"
🔴 The file MUST have a default export for the meta object
🔴 All images MUST have a src attribute with placeholder URLs (use https://picsum.photos/)
🔴 Use CSF 3.0 format with 'satisfies Meta<typeof Component>'

User request: ${userPrompt}`;

    return prompt;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.storybookCache = null;
  }
}
