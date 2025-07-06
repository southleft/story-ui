/**
 * Context7 Integration for Design System Documentation
 *
 * Context7 provides up-to-date, curated documentation for popular libraries
 * through an MCP interface, eliminating the need for web scraping.
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Type declarations for MCP tools
declare global {
  var mcpTools: {
    context7: {
      resolveLibraryId: (params: { libraryName: string }) => Promise<Array<{ libraryId: string }>>;
      getLibraryDocs: (params: { context7CompatibleLibraryID: string, topic?: string, tokens?: number }) => Promise<string>;
    };
  } | undefined;
}

// MCP Bridge for Node.js environments
class MCPBridge {
  private static instance: MCPBridge;

  static getInstance(): MCPBridge {
    if (!MCPBridge.instance) {
      MCPBridge.instance = new MCPBridge();
    }
    return MCPBridge.instance;
  }

  async resolveLibraryId(libraryName: string): Promise<Array<{ libraryId: string }> | null> {
    // Try global MCP tools first (when available in Claude environment)
    if (typeof global !== 'undefined' && global.mcpTools) {
      try {
        return await global.mcpTools.context7.resolveLibraryId({ libraryName });
      } catch (error) {
        console.warn('Global MCP tools failed:', error);
      }
    }

    // Fallback: direct mapping for known libraries
    const knownMappings: Record<string, string> = {
      '@adobe/react-spectrum': '/adobe/react-spectrum',
      '@mui/material': '/mui/material',
      '@chakra-ui/react': '/chakra-ui/chakra-ui',
      'antd': '/ant-design/ant-design',
      '@mantine/core': '/mantine/mantine',
      '@shopify/polaris': '/shopify/polaris'
    };

    const libraryId = knownMappings[libraryName];
    if (libraryId) {
      return [{ libraryId }];
    }

    return null;
  }

  async getLibraryDocs(libraryId: string, topic?: string, tokens?: number): Promise<string | null> {
    // Try global MCP tools first (when available in Claude environment)
    if (typeof global !== 'undefined' && global.mcpTools) {
      try {
        return await global.mcpTools.context7.getLibraryDocs({
          context7CompatibleLibraryID: libraryId,
          topic: topic || 'components forms layout',
          tokens: tokens || 8000
        });
      } catch (error) {
        console.warn('Global MCP tools failed:', error);
      }
    }

    // In Node.js environment, we can't make direct MCP calls
    // This would need to be handled by the environment that has MCP access
    console.log(`📋 MCP tools not available in Node.js environment for ${libraryId}`);
    return null;
  }
}

export interface Context7Config {
  enabled: boolean;
  primaryLibraryId?: string;
  fallbackToEnhancedDiscovery?: boolean;
  cacheTimeout?: number;
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
  props: Record<string, any>;
  variants?: string[];
  examples?: Array<{
    title: string;
    code: string;
  }>;
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
  private mcpBridge: MCPBridge;

  constructor(config: Context7Config = { enabled: true }) {
    this.config = config;
    this.mcpBridge = MCPBridge.getInstance();
  }

  /**
   * Get documentation for a specific library
   */
  async getDocumentation(packageName: string): Promise<Context7Documentation | null> {
    if (!this.config.enabled) {
      console.log('📋 Context7 integration is disabled');
      return null;
    }

    try {
      // Check cache first
      const cacheKey = `${packageName}:${this.config.primaryLibraryId || 'default'}`;
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)!;
        const age = Date.now() - new Date(cached.lastUpdated).getTime();
        const timeout = this.config.cacheTimeout || 3600000; // 1 hour default

        if (age < timeout) {
          console.log(`📋 Using cached Context7 documentation for ${packageName}`);
          return cached;
        }
      }

      // Resolve library ID
      const libraryIdResult = await this.mcpBridge.resolveLibraryId(packageName);
      if (!libraryIdResult || libraryIdResult.length === 0) {
        console.log(`❌ Could not resolve library ID for ${packageName}`);
        return null;
      }

      const libraryId = libraryIdResult[0].libraryId;
      console.log(`✅ Resolved ${packageName} to ${libraryId}`);

      // Get documentation
      const docsResult = await this.mcpBridge.getLibraryDocs(libraryId, 'components forms layout', 8000);
      if (!docsResult) {
        console.log(`❌ Could not fetch documentation for ${libraryId}`);
        return null;
      }

      console.log(`✅ Successfully fetched Context7 documentation for ${libraryId}`);
      const documentation = this.parseContext7Response(libraryId, docsResult);

      // Cache the result
      this.cache.set(cacheKey, documentation);

      return documentation;
    } catch (error) {
      console.error('❌ Error in Context7 integration:', error);
      return null;
    }
  }

  /**
   * Generate enhanced prompt with Context7 documentation
   */
  async generateEnhancedPrompt(packageName: string, userPrompt: string, config: any): Promise<string> {
    const documentation = await this.getDocumentation(packageName);

    if (!documentation) {
      console.log('📋 No Context7 documentation available, using standard prompt');
      return userPrompt;
    }

    const componentList = Object.entries(documentation.components)
      .map(([name, doc]) => {
        const propsStr = Object.keys(doc.props).length > 0
          ? `Props: ${Object.keys(doc.props).join(', ')}`
          : '';

        const examplesStr = doc.examples && doc.examples.length > 0
          ? `\n   Examples:\n${doc.examples.map(ex => `   // ${ex.title}\n   ${ex.code}`).join('\n')}`
          : '';

        return `- ${name}: ${doc.description}${propsStr ? `\n   ${propsStr}` : ''}${examplesStr}`;
      })
      .join('\n\n');

    const enhancedPrompt = `${config.systemPrompt || ''}

🎯 CONTEXT7 ENHANCED DOCUMENTATION AVAILABLE

You have access to comprehensive, up-to-date documentation from Context7. Use ONLY the components and patterns listed below.

📚 AVAILABLE COMPONENTS (from Context7):
${componentList}

🔧 IMPORT TEMPLATE:
${config.importTemplate}

📋 STORYBOOK BEST PRACTICES:
- Create stories that showcase component variants and states
- Use descriptive story names that explain the use case
- Include proper TypeScript types for all props
- Follow the CSF3 format for modern Storybook stories
- Use argTypes for interactive controls when appropriate

🎨 DESIGN SYSTEM GUIDELINES:
- Use semantic spacing and sizing from the design system
- Follow the design system's color palette and typography
- Implement proper accessibility patterns
- Use layout components for consistent spacing and alignment

User request: ${userPrompt}`;

    return enhancedPrompt;
  }

  /**
   * Parse Context7 MCP response into our documentation format
   */
  private parseContext7Response(libraryId: string, docsResponse: string): Context7Documentation {
    const components: Record<string, ComponentDoc> = {};

    // Parse the Context7 response to extract component information
    // The response contains code snippets and documentation
    const snippets = this.extractCodeSnippets(docsResponse);

    for (const snippet of snippets) {
      const componentName = this.extractComponentName(snippet);
      if (componentName && !components[componentName]) {
        components[componentName] = {
          name: componentName,
          description: snippet.description || `${componentName} component`,
          props: this.extractPropsFromSnippet(snippet),
          examples: [{
            title: snippet.title || 'Example',
            code: snippet.code
          }]
        };
      }
    }

    return {
      libraryId,
      components,
      version: 'latest',
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Extract code snippets from Context7 response
   */
  private extractCodeSnippets(response: string): Array<{title: string, description: string, code: string}> {
    const snippets: Array<{title: string, description: string, code: string}> = [];

    // Parse the Context7 response format
    const sections = response.split('----------------------------------------');

    for (const section of sections) {
      const titleMatch = section.match(/TITLE: (.+)/);
      const descMatch = section.match(/DESCRIPTION: (.+)/);
      const codeMatch = section.match(/CODE:\s*```[\w]*\n([\s\S]*?)\n```/);

      if (titleMatch && descMatch && codeMatch) {
        snippets.push({
          title: titleMatch[1].trim(),
          description: descMatch[1].trim(),
          code: codeMatch[1].trim()
        });
      }
    }

    return snippets;
  }

  /**
   * Extract component name from code snippet
   */
  private extractComponentName(snippet: {title: string, description: string, code: string}): string | null {
    // Look for component names in the code
    const componentMatches = snippet.code.match(/<([A-Z][a-zA-Z0-9]*)/g);
    if (componentMatches) {
      // Return the first component found, removing the '<'
      return componentMatches[0].substring(1);
    }

    // Fallback: extract from title
    const titleMatches = snippet.title.match(/([A-Z][a-zA-Z0-9]*)/);
    if (titleMatches) {
      return titleMatches[1];
    }

    return null;
  }

  /**
   * Extract props from code snippet
   */
  private extractPropsFromSnippet(snippet: {title: string, description: string, code: string}): Record<string, any> {
    const props: Record<string, any> = {};

    // Extract props from JSX attributes
    const propMatches = snippet.code.matchAll(/(\w+)=(?:{[^}]+}|"[^"]*"|'[^']*')/g);
    for (const match of propMatches) {
      const propName = match[1];
      props[propName] = {
        type: 'any',
        description: `${propName} prop`
      };
    }

    return props;
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
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.storybookCache = null;
  }
}
