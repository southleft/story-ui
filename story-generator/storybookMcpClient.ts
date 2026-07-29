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
import { rankByRelevance } from './knowledge/storybookCatalog.js';

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
/**
 * Choose which manifest components to spend prompt space on.
 *
 * Delegates the scoring to `rankByRelevance`, the same function the catalog
 * path uses, rather than reimplementing it — two rankers that drift is how the
 * catalog and validator ended up disagreeing about which components exist.
 *
 * With no prompt there is nothing to rank on, so manifest order stands; that is
 * the old behaviour, kept for the case where it is genuinely all we know.
 */
function selectRelevant<T extends { name: string; id: string }>(
  entries: T[],
  prompt: string,
  limit: number,
): T[] {
  if (!prompt.trim() || entries.length <= limit) return entries.slice(0, limit);
  const byName = new Map(entries.map(e => [e.name, e]));
  const ranked = rankByRelevance(
    entries.map(e => ({ name: e.name, title: e.name, importPath: e.id, storyNames: [] })),
    prompt,
    limit,
  );
  const picked = ranked.map(r => byName.get(r.name)).filter(Boolean) as T[];
  // Top up from manifest order if ranking returned fewer than the budget.
  for (const e of entries) {
    if (picked.length >= limit) break;
    if (!picked.includes(e)) picked.push(e);
  }
  return picked.slice(0, limit);
}

export class StorybookMcpClient {
  private baseUrl: string;
  private timeout: number;
  private requestId: number = 0;
  /**
   * Path fragment identifying Story UI's own generated output. Those stories are
   * excluded from the exemplar pool: feeding the model its previous generations
   * as "reference for consistent code style" turns any defect into a house style.
   */
  private excludePathFragment?: string;

  constructor(storybookUrl: string, timeout: number = 5000, excludePathFragment?: string) {
    // Normalize URL - remove trailing slash
    this.baseUrl = storybookUrl.replace(/\/+$/, '');
    this.timeout = timeout;
    this.excludePathFragment = excludePathFragment;
  }

  /** True when a manifest entry is one of our own generated stories. */
  private isSelfGenerated(comp: { id?: string; path?: string; import?: string }): boolean {
    if (!this.excludePathFragment) return false;
    const frag = this.excludePathFragment.toLowerCase();
    return [comp.id, comp.path, comp.import]
      .filter((v): v is string => typeof v === 'string')
      .some(v => v.toLowerCase().includes(frag));
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
  /** The request being served, so exemplars can be chosen for it rather than alphabetically. */
  private lastPrompt = '';

  async fetchContext(componentNames?: string[], prompt?: string): Promise<StorybookMcpContext> {
    this.lastPrompt = prompt || '';
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
      // addon-mcp ≥0.5 tool name (was `get-ui-building-instructions` in earlier versions)
      const result = await this.callTool('get-storybook-story-instructions', {});
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
      // The components manifest is the only real data source in addon-mcp ≥0.5
      // (its documentation tools are themselves manifest-backed).
      const manifestDocs = await this.fetchFromManifest(componentNames);
      if (manifestDocs && Object.keys(manifestDocs).length > 0) {
        logger.log(`✅ Fetched ${Object.keys(manifestDocs).length} components from Storybook manifest`);
        return manifestDocs;
      }

      logger.log(
        '⚠️ Storybook components manifest not available — component docs/story snippets will be skipped. ' +
        'Enable it in the consumer Storybook: add `features: { experimentalComponentsManifest: true }` to .storybook/main.ts'
      );
      return undefined;
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

      // Drop our own generated stories before selection, so the exemplars shown
      // to the model are the project's hand-written components.
      const beforeSelfFilter = componentEntries.length;
      componentEntries = componentEntries.filter(c => !this.isSelfGenerated(c));
      if (componentEntries.length !== beforeSelfFilter) {
        logger.log(`\u{1F9F9} Excluded ${beforeSelfFilter - componentEntries.length} Story UI-generated stories from the exemplar pool`);
      }

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
          componentEntries = selectRelevant(componentEntries, this.lastPrompt, 15);
        }
      } else {
        /**
         * Rank by relevance to the request, not alphabetically.
         *
         * `slice(0, 15)` took the first fifteen in manifest order, and a
         * non-empty manifest also SUPPRESSES the prompt-ranked catalog path in
         * generationCore. Measured on a 51-component project, a request for a
         * data table was answered with Accordion, Alert, AspectRatio, Avatar,
         * Badge, Breadcrumb… — the alphabetical head, with the ranked path
         * switched off.
         */
        componentEntries = selectRelevant(componentEntries, this.lastPrompt, 15);
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
  timeout?: number,
  excludePathFragment?: string
): StorybookMcpClient | null {
  if (!storybookMcpUrl) {
    return null;
  }

  return new StorybookMcpClient(storybookMcpUrl, timeout || 5000, excludePathFragment);
}
