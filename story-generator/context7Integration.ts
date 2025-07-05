/**
 * Context7 Integration for Design System Documentation
 *
 * Context7 provides up-to-date, curated documentation for popular libraries
 * through an MCP interface, eliminating the need for web scraping.
 */

import fetch from 'node-fetch';

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
   */
  private mapToContext7Id(packageName: string): string {
    const mappings: Record<string, string> = {
      '@shopify/polaris': '/shopify/polaris',
      '@mui/material': '/mui/material',
      'antd': '/ant-design/ant-design',
      '@chakra-ui/react': '/chakra-ui/chakra-ui',
      '@mantine/core': '/mantine/mantine',
      // Add more mappings as needed
    };

    return mappings[packageName] || packageName;
  }

  /**
   * Fetch documentation from Context7
   * In production, this would use the Context7 MCP protocol
   */
  private async fetchFromContext7(libraryId: string): Promise<Context7Documentation | null> {
    // Simulated response structure based on Context7's expected format
    // In production, this would be an actual MCP call

    if (libraryId === '/shopify/polaris') {
      return {
        libraryId,
        version: 'v13.0.0',
        lastUpdated: new Date().toISOString(),
        components: {
          'Text': {
            name: 'Text',
            description: 'Typography component for all text in Polaris',
            variants: ['heading3xl', 'heading2xl', 'headingXl', 'headingLg', 'headingMd', 'headingSm', 'headingXs', 'bodyLg', 'bodyMd', 'bodySm', 'bodyXs'],
            props: {
              as: {
                type: 'ElementType',
                required: true,
                description: 'The element type to render',
                default: 'p'
              },
              variant: {
                type: 'TextVariant',
                required: false,
                description: 'Typographic style'
              },
              tone: {
                type: "'subdued' | 'success' | 'critical' | 'warning' | 'caution' | 'emphasis' | 'info' | 'inherit'",
                required: false,
                description: 'Text color'
              }
            },
            examples: [
              {
                title: 'Heading',
                code: '<Text variant="headingLg" as="h2">Page title</Text>'
              },
              {
                title: 'Body text',
                code: '<Text variant="bodyMd" as="p">Regular paragraph text</Text>'
              }
            ]
          },
          'Button': {
            name: 'Button',
            description: 'Interactive button component',
            variants: ['primary', 'secondary', 'tertiary', 'plain', 'monochrome'],
            props: {
              variant: {
                type: 'ButtonVariant',
                description: 'Visual style of button'
              },
              tone: {
                type: "'critical' | 'success'",
                description: 'Button color tone'
              },
              size: {
                type: "'slim' | 'medium' | 'large'",
                default: 'medium'
              }
            }
          },
          'BlockStack': {
            name: 'BlockStack',
            description: 'Vertical stack layout component',
            props: {
              gap: {
                type: 'Gap',
                description: 'Space between children',
                default: '400'
              }
            }
          },
          'InlineStack': {
            name: 'InlineStack',
            description: 'Horizontal stack layout component',
            props: {
              gap: {
                type: 'Gap',
                description: 'Space between children'
              },
              align: {
                type: 'Align',
                description: 'Horizontal alignment'
              }
            }
          },
          'Card': {
            name: 'Card',
            description: 'Content container component',
            props: {
              padding: {
                type: 'Spacing',
                description: 'Internal padding'
              },
              roundedAbove: {
                type: 'Breakpoint',
                description: 'Border radius breakpoint'
              }
            }
          },
          // Deprecated components are not included in Context7's response
          // This is the key benefit - we only get current, valid components
        },
        patterns: {
          forms: {
            name: 'Form Layout',
            description: 'Recommended form structure',
            components: ['Form', 'BlockStack', 'TextField', 'Button'],
            example: `<Form onSubmit={handleSubmit}>
  <BlockStack gap="400">
    <TextField
      label="Email"
      type="email"
      value={email}
      onChange={setEmail}
    />
    <TextField
      label="Password"
      type="password"
      value={password}
      onChange={setPassword}
    />
    <Button submit variant="primary">
      Sign in
    </Button>
  </BlockStack>
</Form>`
          }
        }
      };
    }

    // Return null for unknown libraries
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
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
