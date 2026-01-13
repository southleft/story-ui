/**
 * Storybook MCP Client
 *
 * This module provides a client for connecting to Storybook MCP servers
 * to fetch component documentation, design tokens, and existing story patterns.
 *
 * When Story UI is configured with a storybookMcpUrl, this client will
 * automatically fetch context before story generation to improve output quality.
 */

import { logger } from './logger.js';

/**
 * Context fetched from Storybook MCP
 */
export interface StorybookMcpContext {
  /** Whether Storybook MCP was successfully contacted */
  available: boolean;
  /** Component documentation from Storybook */
  componentDocs?: Record<string, ComponentDocumentation>;
  /** UI building instructions from Storybook */
  uiBuildingInstructions?: string;
  /** Existing story patterns for reference */
  storyPatterns?: StoryPattern[];
  /** Error message if connection failed */
  error?: string;
  /** Time taken to fetch context in milliseconds */
  fetchTimeMs?: number;
}

/**
 * Component documentation from Storybook MCP
 */
export interface ComponentDocumentation {
  id: string;
  name: string;
  description?: string;
  props?: Record<string, PropDocumentation>;
  examples?: CodeExample[];
  summary?: string;
}

/**
 * Prop documentation
 */
export interface PropDocumentation {
  type?: string;
  description?: string;
  defaultValue?: string;
  required?: boolean;
  options?: string[];
}

/**
 * Code example from Storybook
 */
export interface CodeExample {
  title: string;
  code: string;
  description?: string;
}

/**
 * Story pattern for reference
 */
export interface StoryPattern {
  componentName: string;
  storyTitle: string;
  code: string;
  description?: string;
}

/**
 * MCP Tool invocation request
 */
interface McpToolRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

/**
 * MCP Tool invocation response (parsed from SSE)
 */
interface McpToolResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content: Array<{
      type: 'text';
      text: string;
    }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Component info from list-all-components
 */
interface ComponentInfo {
  id: string;
  name: string;
  summary?: string;
}

/**
 * Component manifest from Storybook's experimentalComponentsManifest feature
 */
interface ComponentManifest {
  v: number;
  components: Record<string, ManifestComponent>;
}

/**
 * Component entry in the manifest
 */
interface ManifestComponent {
  id: string;
  name: string;
  path?: string;
  description?: string;
  import?: string;
  stories?: ManifestStory[];
  reactDocgen?: {
    description?: string;
    props?: Record<string, ManifestProp>;
  };
}

/**
 * Story in the manifest
 */
interface ManifestStory {
  name: string;
  snippet?: string;
  description?: string;
}

/**
 * Prop in the manifest (from react-docgen)
 */
interface ManifestProp {
  type?: {
    name?: string;
    raw?: string;
    value?: unknown;
  };
  description?: string;
  required?: boolean;
  defaultValue?: {
    value?: string;
  };
}

/**
 * Storybook MCP Client for fetching context from Storybook instances
 */
export class StorybookMcpClient {
  private baseUrl: string;
  private timeout: number;
  private requestId: number = 0;

  constructor(storybookUrl: string, timeout: number = 5000) {
    // Normalize URL - remove trailing slash
    this.baseUrl = storybookUrl.replace(/\/+$/, '');
    this.timeout = timeout;
  }

  /**
   * Check if Storybook MCP is available by listing tools
   */
  async isAvailable(): Promise<boolean> {
    try {
      const request = {
        jsonrpc: '2.0',
        id: ++this.requestId,
        method: 'tools/list',
        params: {},
      };

      const response = await this.fetchWithTimeout(`${this.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) return false;

      const text = await response.text();
      const parsed = this.parseSseResponse(text) as any;
      // tools/list returns result.tools array
      return parsed?.result?.tools?.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fetch all available context from Storybook MCP
   */
  async fetchContext(componentNames?: string[]): Promise<StorybookMcpContext> {
    const startTime = Date.now();

    try {
      // First check if Storybook MCP is available
      const available = await this.isAvailable();
      if (!available) {
        return {
          available: false,
          error: 'Storybook MCP server not available or addon-mcp not installed',
          fetchTimeMs: Date.now() - startTime,
        };
      }

      // Fetch context in parallel
      const [componentDocs, uiBuildingInstructions] = await Promise.all([
        this.fetchComponentDocs(componentNames),
        this.fetchUiBuildingInstructions(),
      ]);

      // Extract story patterns from component docs
      const storyPatterns = this.extractStoryPatterns(componentDocs);

      return {
        available: true,
        componentDocs,
        uiBuildingInstructions,
        storyPatterns,
        fetchTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log(`⚠️ Failed to fetch Storybook MCP context: ${errorMessage}`);
      return {
        available: false,
        error: errorMessage,
        fetchTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Fetch UI building instructions
   */
  private async fetchUiBuildingInstructions(): Promise<string | undefined> {
    try {
      const result = await this.callTool('get-ui-building-instructions', {});
      return result || undefined;
    } catch (error) {
      logger.log(`⚠️ Failed to fetch UI building instructions: ${error}`);
      return undefined;
    }
  }

  /**
   * Fetch component documentation - tries manifest first, falls back to MCP tools
   */
  private async fetchComponentDocs(
    componentNames?: string[]
  ): Promise<Record<string, ComponentDocumentation> | undefined> {
    try {
      // First try to fetch from component manifest (Storybook's experimentalComponentsManifest)
      const manifestDocs = await this.fetchFromManifest(componentNames);
      if (manifestDocs && Object.keys(manifestDocs).length > 0) {
        logger.log(`✅ Fetched ${Object.keys(manifestDocs).length} components from Storybook manifest`);
        return manifestDocs;
      }

      // Fall back to MCP tools if manifest not available
      logger.log('📡 Manifest not available, trying MCP tools...');
      return await this.fetchFromMcpTools(componentNames);
    } catch (error) {
      logger.log(`⚠️ Failed to fetch component documentation: ${error}`);
      return undefined;
    }
  }

  /**
   * Fetch component documentation from the manifest endpoint
   */
  private async fetchFromManifest(
    componentNames?: string[]
  ): Promise<Record<string, ComponentDocumentation> | undefined> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/manifests/components.json`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        logger.log(`⚠️ Manifest not available (${response.status})`);
        return undefined;
      }

      const manifest: ComponentManifest = await response.json();
      if (!manifest.components || Object.keys(manifest.components).length === 0) {
        return undefined;
      }

      const docs: Record<string, ComponentDocumentation> = {};
      let componentEntries = Object.values(manifest.components);

      // Filter to requested components if specified
      if (componentNames && componentNames.length > 0) {
        const lowerNames = componentNames.map((n) => n.toLowerCase());
        const filtered = componentEntries.filter((c) =>
          lowerNames.some(
            (name) =>
              c.name.toLowerCase().includes(name) ||
              c.id.toLowerCase().includes(name)
          )
        );
        if (filtered.length > 0) {
          componentEntries = filtered;
        } else {
          // If no matches, use first 15 components
          componentEntries = componentEntries.slice(0, 15);
        }
      } else {
        // Limit to 15 components to avoid overwhelming context
        componentEntries = componentEntries.slice(0, 15);
      }

      for (const comp of componentEntries) {
        const doc: ComponentDocumentation = {
          id: comp.id,
          name: comp.name,
          description: comp.description || comp.reactDocgen?.description,
          examples: [],
          props: {},
        };

        // Extract stories as examples
        if (comp.stories && comp.stories.length > 0) {
          for (const story of comp.stories) {
            if (story.snippet) {
              doc.examples!.push({
                title: story.name,
                code: story.snippet,
                description: story.description,
              });
            }
          }
        }

        // Extract props from react-docgen
        if (comp.reactDocgen?.props) {
          for (const [propName, prop] of Object.entries(comp.reactDocgen.props)) {
            doc.props![propName] = {
              type: prop.type?.name || prop.type?.raw,
              description: prop.description,
              required: prop.required,
              defaultValue: prop.defaultValue?.value,
            };
          }
        }

        // Add import statement as summary if available
        if (comp.import) {
          doc.summary = `Import: ${comp.import}`;
        }

        docs[comp.name] = doc;
      }

      return docs;
    } catch (error) {
      logger.log(`⚠️ Error fetching manifest: ${error}`);
      return undefined;
    }
  }

  /**
   * Fetch component documentation from MCP tools (fallback)
   */
  private async fetchFromMcpTools(
    componentNames?: string[]
  ): Promise<Record<string, ComponentDocumentation> | undefined> {
    try {
      // List all components first
      const listResult = await this.callTool('list-all-components', {});
      if (!listResult) return undefined;

      // Parse the XML response to extract component info
      const components = this.parseComponentList(listResult);
      if (components.length === 0) return undefined;

      // Filter to requested components if specified
      let targetComponents: ComponentInfo[];
      if (componentNames && componentNames.length > 0) {
        // Match by name (case-insensitive partial match)
        const lowerNames = componentNames.map((n) => n.toLowerCase());
        targetComponents = components.filter((c) =>
          lowerNames.some(
            (name) => c.name.toLowerCase().includes(name) || c.id.toLowerCase().includes(name)
          )
        );
        // If no matches, use first 10 components
        if (targetComponents.length === 0) {
          targetComponents = components.slice(0, 10);
        }
      } else {
        // Limit to 10 components to avoid overwhelming context
        targetComponents = components.slice(0, 10);
      }

      // Fetch documentation for target components
      const componentIds = targetComponents.map((c) => c.id);
      if (componentIds.length === 0) return undefined;

      const docResult = await this.callTool('get-component-documentation', {
        componentIds,
      });

      if (!docResult) {
        // Return basic info from list if detailed docs fail
        const docs: Record<string, ComponentDocumentation> = {};
        for (const comp of targetComponents) {
          docs[comp.name] = {
            id: comp.id,
            name: comp.name,
            summary: comp.summary,
          };
        }
        return docs;
      }

      // Parse the detailed documentation
      return this.parseComponentDocs(docResult);
    } catch (error) {
      logger.log(`⚠️ Failed to fetch from MCP tools: ${error}`);
      return undefined;
    }
  }

  /**
   * Parse component list from XML response
   */
  private parseComponentList(xmlText: string): ComponentInfo[] {
    const components: ComponentInfo[] = [];

    // Extract component blocks
    const componentMatches = xmlText.matchAll(/<component>([\s\S]*?)<\/component>/g);

    for (const match of componentMatches) {
      const block = match[1];

      const idMatch = block.match(/<id>(.*?)<\/id>/);
      const nameMatch = block.match(/<name>(.*?)<\/name>/);
      const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);

      if (idMatch && nameMatch) {
        components.push({
          id: idMatch[1].trim(),
          name: nameMatch[1].trim(),
          summary: summaryMatch ? summaryMatch[1].trim() : undefined,
        });
      }
    }

    return components;
  }

  /**
   * Parse component documentation from XML response
   */
  private parseComponentDocs(xmlText: string): Record<string, ComponentDocumentation> {
    const docs: Record<string, ComponentDocumentation> = {};

    // Extract component blocks
    const componentMatches = xmlText.matchAll(/<component>([\s\S]*?)<\/component>/g);

    for (const match of componentMatches) {
      const block = match[1];

      const idMatch = block.match(/<id>(.*?)<\/id>/);
      const nameMatch = block.match(/<name>(.*?)<\/name>/);
      const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);

      if (nameMatch) {
        const name = nameMatch[1].trim();
        const doc: ComponentDocumentation = {
          id: idMatch ? idMatch[1].trim() : name.toLowerCase().replace(/\s+/g, '-'),
          name,
          description: descMatch ? descMatch[1].trim() : undefined,
          examples: [],
          props: {},
        };

        // Extract stories as examples
        const storyMatches = block.matchAll(/<story>([\s\S]*?)<\/story>/g);
        for (const storyMatch of storyMatches) {
          const storyBlock = storyMatch[1];
          const storyNameMatch = storyBlock.match(/<story_name>(.*?)<\/story_name>/);
          const storyDescMatch = storyBlock.match(/<story_description>([\s\S]*?)<\/story_description>/);
          const storyCodeMatch = storyBlock.match(/<story_code>([\s\S]*?)<\/story_code>/);

          if (storyNameMatch && storyCodeMatch) {
            doc.examples!.push({
              title: storyNameMatch[1].trim(),
              description: storyDescMatch ? storyDescMatch[1].trim() : undefined,
              code: storyCodeMatch[1].trim(),
            });
          }
        }

        // Extract props
        const propsMatch = block.match(/<props>([\s\S]*?)<\/props>/);
        if (propsMatch) {
          const propMatches = propsMatch[1].matchAll(/<prop>([\s\S]*?)<\/prop>/g);
          for (const propMatch of propMatches) {
            const propBlock = propMatch[1];
            const propNameMatch = propBlock.match(/<prop_name>(.*?)<\/prop_name>/);
            const propTypeMatch = propBlock.match(/<prop_type>(.*?)<\/prop_type>/);
            const propDescMatch = propBlock.match(/<prop_description>([\s\S]*?)<\/prop_description>/);
            const propRequiredMatch = propBlock.match(/<prop_required>(.*?)<\/prop_required>/);
            const propDefaultMatch = propBlock.match(/<prop_default>(.*?)<\/prop_default>/);

            if (propNameMatch) {
              doc.props![propNameMatch[1].trim()] = {
                type: propTypeMatch ? propTypeMatch[1].trim() : undefined,
                description: propDescMatch ? propDescMatch[1].trim() : undefined,
                required: propRequiredMatch ? propRequiredMatch[1].trim() === 'true' : false,
                defaultValue: propDefaultMatch ? propDefaultMatch[1].trim() : undefined,
              };
            }
          }
        }

        docs[name] = doc;
      }
    }

    return docs;
  }

  /**
   * Extract story patterns from component documentation
   */
  private extractStoryPatterns(
    docs?: Record<string, ComponentDocumentation>
  ): StoryPattern[] | undefined {
    if (!docs) return undefined;

    const patterns: StoryPattern[] = [];

    for (const [name, doc] of Object.entries(docs)) {
      if (doc.examples && doc.examples.length > 0) {
        // Take first 2 examples per component
        for (const example of doc.examples.slice(0, 2)) {
          patterns.push({
            componentName: name,
            storyTitle: example.title,
            code: example.code,
            description: example.description,
          });
        }
      }
    }

    // Limit total patterns to avoid overwhelming context
    return patterns.length > 0 ? patterns.slice(0, 10) : undefined;
  }

  /**
   * Call an MCP tool via SSE endpoint
   */
  private async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string | undefined> {
    try {
      const request: McpToolRequest = {
        jsonrpc: '2.0',
        id: ++this.requestId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      };

      const response = await this.fetchWithTimeout(`${this.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        return undefined;
      }

      // Parse SSE response
      const text = await response.text();
      const result = this.parseSseResponse(text);

      if (result?.error) {
        logger.log(`⚠️ MCP tool error: ${result.error.message}`);
        return undefined;
      }

      // Extract text content from result
      if (result?.result?.content) {
        const textContent = result.result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
        return textContent || undefined;
      }

      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Parse SSE response format (event: message\ndata: {...})
   */
  private parseSseResponse(text: string): McpToolResponse | null {
    try {
      // SSE format: "event: message\ndata: {...json...}"
      const lines = text.split('\n');
      let dataLine = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          dataLine = line.slice(6);
          break;
        }
      }

      if (dataLine) {
        return JSON.parse(dataLine);
      }

      // Try parsing as plain JSON (in case format changes)
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Format Storybook MCP context for inclusion in prompts
 */
export function formatStorybookContext(context: StorybookMcpContext): string {
  if (!context.available) {
    return '';
  }

  const sections: string[] = [];

  // UI Building Instructions section
  if (context.uiBuildingInstructions) {
    sections.push(`## UI Building Instructions from Storybook\n\n${context.uiBuildingInstructions}`);
  }

  // Component documentation section
  if (context.componentDocs && Object.keys(context.componentDocs).length > 0) {
    const docsSection = Object.entries(context.componentDocs)
      .map(([name, doc]) => {
        let entry = `### ${name}`;
        if (doc.description) {
          entry += `\n${doc.description}`;
        } else if (doc.summary) {
          entry += `\n${doc.summary}`;
        }
        if (doc.props && Object.keys(doc.props).length > 0) {
          entry += '\n\n**Props:**';
          for (const [propName, prop] of Object.entries(doc.props)) {
            entry += `\n- \`${propName}\``;
            if (prop.type) {
              entry += `: ${prop.type}`;
            }
            if (prop.defaultValue) {
              entry += ` (default: ${prop.defaultValue})`;
            }
            if (prop.required) {
              entry += ' *required*';
            }
            if (prop.description) {
              entry += ` - ${prop.description}`;
            }
          }
        }
        return entry;
      })
      .join('\n\n');

    sections.push(`## Component Documentation from Storybook\n\n${docsSection}`);
  }

  // Story patterns section
  if (context.storyPatterns && context.storyPatterns.length > 0) {
    const patternsSection = context.storyPatterns
      .map((pattern) => {
        let entry = `### ${pattern.componentName} - "${pattern.storyTitle}"`;
        if (pattern.description) {
          entry += `\n${pattern.description}`;
        }
        entry += `\n\`\`\`tsx\n${pattern.code}\n\`\`\``;
        return entry;
      })
      .join('\n\n');

    sections.push(
      `## Existing Story Patterns from Storybook\n\nUse these patterns as reference for consistent code style:\n\n${patternsSection}`
    );
  }

  if (sections.length === 0) {
    return '';
  }

  return `
---
# STORYBOOK MCP CONTEXT

The following information was fetched from the Storybook MCP server.
Use this context to ensure generated stories match existing patterns and use correct component APIs.

${sections.join('\n\n')}

---
`;
}

/**
 * Create a Storybook MCP client from config
 */
export function createStorybookMcpClient(
  storybookMcpUrl?: string,
  timeout?: number
): StorybookMcpClient | null {
  if (!storybookMcpUrl) {
    return null;
  }

  return new StorybookMcpClient(storybookMcpUrl, timeout || 5000);
}
