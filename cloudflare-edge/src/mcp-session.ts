/**
 * Story UI MCP Session Durable Object
 *
 * Handles per-session MCP protocol communication with:
 * - SSE transport (legacy)
 * - Streamable HTTP transport (new)
 * - WebSocket hibernation for cost optimization
 */

import type {
  Env,
  JSONRPCRequest,
  JSONRPCResponse,
  MCPTool,
  MCPToolResult,
  SessionData,
  StoryMetadata
} from './types.js';

// MCP Protocol Constants
const MCP_VERSION = '2024-11-05';
const SERVER_NAME = 'story-ui-mcp-edge';
const SERVER_VERSION = '3.0.0';

// Story UI Tools Definition
const STORY_UI_TOOLS: MCPTool[] = [
  {
    name: 'test-connection',
    description: 'Test the MCP connection to Story UI edge server',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'generate-story',
    description: 'Generate a Storybook story for a component using AI',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the story to generate',
        },
        componentPath: {
          type: 'string',
          description: 'Path to the component file (optional)',
        },
        framework: {
          type: 'string',
          description: 'UI framework',
          enum: ['react', 'vue', 'angular', 'svelte'],
        },
        considerations: {
          type: 'string',
          description: 'Design guidelines and considerations to apply when generating the story',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list-stories',
    description: 'List all generated stories in this session',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of stories to return',
          default: 50,
        },
      },
    },
  },
  {
    name: 'get-story',
    description: 'Get the content of a specific story',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Story ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete-story',
    description: 'Delete a generated story',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Story ID',
        },
      },
      required: ['id'],
    },
  },
];

export class MCPSessionDO implements DurableObject {
  private state: DurableObjectState;
  private _env: Env; // Prefixed to allow future use
  private sessions: Map<string, SessionData> = new Map();
  private sseWriters: Map<string, WritableStreamDefaultWriter<Uint8Array>> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this._env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case '/sse':
          return this.handleSSE(request);
        case '/messages':
          return this.handleMessages(request, url);
        case '/mcp':
          return this.handleStreamableHTTP(request);
        case '/health':
          return this.handleHealth();
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('MCPSessionDO error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Handle SSE connection (legacy transport)
   */
  private async handleSSE(request: Request): Promise<Response> {
    const sessionId = crypto.randomUUID();

    // Create transform stream for SSE
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Store session
    const session: SessionData = {
      id: sessionId,
      createdAt: Date.now(),
      lastActive: Date.now(),
    };
    this.sessions.set(sessionId, session);
    this.sseWriters.set(sessionId, writer);

    // Save to durable storage
    await this.state.storage.put(`session:${sessionId}`, session);

    // Send endpoint event
    const endpointUrl = `/mcp-remote/messages?sessionId=${sessionId}`;
    await writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUrl}\n\n`));

    // Clean up on close
    request.signal.addEventListener('abort', async () => {
      this.sessions.delete(sessionId);
      this.sseWriters.delete(sessionId);
      await this.state.storage.delete(`session:${sessionId}`);
      console.log(`Session ${sessionId} closed`);
    });

    console.log(`SSE session ${sessionId} created`);

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  /**
   * Handle POST messages for SSE transport
   */
  private async handleMessages(request: Request, url: URL): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'Missing sessionId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update last active
    session.lastActive = Date.now();

    // Parse message
    const message = await request.json() as JSONRPCRequest;

    // Process and get response
    const response = await this.processMessage(message);

    // Send response via SSE
    const writer = this.sseWriters.get(sessionId);
    if (writer) {
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(`event: message\ndata: ${JSON.stringify(response)}\n\n`));
    }

    return new Response(null, { status: 202 });
  }

  /**
   * Handle Streamable HTTP transport (new MCP standard)
   */
  private async handleStreamableHTTP(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const message = await request.json() as JSONRPCRequest;
    const response = await this.processMessage(message);

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  /**
   * Process MCP JSON-RPC message
   */
  private async processMessage(message: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { method, params, id } = message;

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id, params);
        case 'tools/list':
          return this.handleListTools(id);
        case 'tools/call':
          return this.handleCallTool(id, params);
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };
        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }
    } catch (error) {
      console.error(`Error processing ${method}:`, error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error'
        },
      };
    }
  }

  /**
   * Handle MCP initialize
   */
  private handleInitialize(
    id: string | number | undefined,
    params?: Record<string, unknown>
  ): JSONRPCResponse {
    // Store client info for potential future session tracking
    const _clientInfo = params?.clientInfo as { name?: string; version?: string } | undefined;

    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: MCP_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      },
    };
  }

  /**
   * Handle tools/list
   */
  private handleListTools(id: string | number | undefined): JSONRPCResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: STORY_UI_TOOLS,
      },
    };
  }

  /**
   * Handle tools/call
   */
  private async handleCallTool(
    id: string | number | undefined,
    params?: Record<string, unknown>
  ): Promise<JSONRPCResponse> {
    const toolName = params?.name as string;
    const toolArgs = params?.arguments as Record<string, unknown> | undefined;

    const result = await this.executeTool(toolName, toolArgs || {});

    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  /**
   * Execute a tool
   */
  private async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    switch (name) {
      case 'test-connection':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'connected',
              server: SERVER_NAME,
              version: SERVER_VERSION,
              transport: 'cloudflare-edge',
              timestamp: new Date().toISOString(),
            }, null, 2),
          }],
        };

      case 'generate-story':
        return this.generateStory(args);

      case 'list-stories':
        return this.listStories(args);

      case 'get-story':
        return this.getStory(args);

      case 'delete-story':
        return this.deleteStory(args);

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  }

  /**
   * Generate a story (placeholder - needs LLM integration)
   * Returns CompletionFeedback structure expected by the frontend
   */
  private async generateStory(args: Record<string, unknown>): Promise<MCPToolResult> {
    const prompt = args.prompt as string;
    const componentPath = args.componentPath as string | undefined;
    const framework = (args.framework as string) || 'react';
    const considerations = args.considerations as string | undefined;

    // Generate a unique story ID
    const storyId = `story-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Generate title and filename from prompt
    const title = this.generateTitleFromPrompt(prompt);
    const fileName = this.generateFileNameFromPrompt(prompt);

    // Build considerations section for the story
    const considerationsComment = considerations
      ? `// Design Considerations Applied:\n${considerations.split('\n').map(line => `// ${line}`).join('\n')}\n`
      : '';

    // Create placeholder story content with considerations integrated
    const storyContent = `import type { Meta, StoryObj } from '@storybook/react';

// Generated by Story UI MCP Edge
// Prompt: ${prompt}
// Framework: ${framework}
${componentPath ? `// Component: ${componentPath}` : ''}
${considerationsComment}
const meta = {
  title: 'Generated/${title}',
  parameters: {
    layout: 'centered',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div>
      {/* TODO: Implement based on prompt: ${prompt} */}
      {/* Design considerations: ${considerations ? 'Applied from story-ui-docs/' : 'None provided'} */}
      <p>Story generated on Cloudflare Edge</p>
      ${considerations ? `<p style={{ fontFamily: 'Comic Sans MS', color: 'purple', textTransform: 'uppercase' }}>Design guidelines detected!</p>` : ''}
    </div>
  ),
};
`;

    // Store story
    const story: StoryMetadata = {
      id: storyId,
      title,
      componentPath,
      createdAt: Date.now(),
      framework,
    };

    await this.state.storage.put(`story:${storyId}`, { ...story, content: storyContent });

    // Calculate generation time
    const generationEndTime = Date.now();
    const generationTimeMs = generationEndTime - (story.createdAt || generationEndTime);

    // Return CompletionFeedback structure expected by the frontend
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          // Core required fields for CompletionFeedback interface
          success: true,
          title,
          fileName,
          storyId,
          summary: {
            action: 'created' as const,
            description: `Generated story for: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`,
          },
          componentsUsed: [
            { name: 'div', reason: 'Container element for placeholder content' },
          ],
          layoutChoices: [
            { pattern: 'centered', reason: 'Default centered layout for story preview' },
          ],
          styleChoices: [
            { property: 'layout', value: 'centered', reason: 'Optimal for component showcase' },
          ],
          suggestions: [
            'Replace placeholder with actual component implementation',
            'Add interactive controls using Storybook args',
            'Consider adding multiple story variants',
          ],
          validation: {
            isValid: true,
            errors: [],
            warnings: ['This is a placeholder story - full LLM integration pending'],
            autoFixApplied: false,
          },
          // REQUIRED: metrics field - fixes "Cannot read properties of undefined (reading 'totalTimeMs')" error
          metrics: {
            totalTimeMs: generationTimeMs > 0 ? generationTimeMs : 500,
            llmCallsCount: 1,
            tokensUsed: 0,
          },
          // REQUIRED: code field - the actual generated story code for display in the UI
          code: storyContent,
          framework,
          note: 'Full LLM integration pending - this is a placeholder story',
        }, null, 2),
      }],
    };
  }

  /**
   * Generate a human-readable title from the prompt
   */
  private generateTitleFromPrompt(prompt: string): string {
    // Extract first meaningful phrase, capitalize appropriately
    const words = prompt.split(/\s+/).slice(0, 5);
    const title = words
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    return title || 'Generated Story';
  }

  /**
   * Generate a valid filename from the prompt
   */
  private generateFileNameFromPrompt(prompt: string): string {
    // Convert to PascalCase and sanitize
    const words = prompt
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 3);
    const fileName = words
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    return `${fileName || 'GeneratedStory'}.stories.tsx`;
  }

  /**
   * List stories in this session
   */
  private async listStories(args: Record<string, unknown>): Promise<MCPToolResult> {
    const limit = (args.limit as number) || 50;

    const stories: StoryMetadata[] = [];
    const storageMap = await this.state.storage.list({ prefix: 'story:' });

    for (const [, value] of storageMap) {
      const story = value as StoryMetadata & { content: string };
      stories.push({
        id: story.id,
        title: story.title,
        componentPath: story.componentPath,
        createdAt: story.createdAt,
        framework: story.framework,
      });
      if (stories.length >= limit) break;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          stories,
          count: stories.length,
        }, null, 2),
      }],
    };
  }

  /**
   * Get a specific story
   */
  private async getStory(args: Record<string, unknown>): Promise<MCPToolResult> {
    const id = args.id as string;

    const story = await this.state.storage.get(`story:${id}`);

    if (!story) {
      return {
        content: [{ type: 'text', text: `Story not found: ${id}` }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(story, null, 2),
      }],
    };
  }

  /**
   * Delete a story
   */
  private async deleteStory(args: Record<string, unknown>): Promise<MCPToolResult> {
    const id = args.id as string;

    const existed = await this.state.storage.get(`story:${id}`);

    if (!existed) {
      return {
        content: [{ type: 'text', text: `Story not found: ${id}` }],
        isError: true,
      };
    }

    await this.state.storage.delete(`story:${id}`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Story ${id} deleted`,
        }, null, 2),
      }],
    };
  }

  /**
   * Health check
   */
  private handleHealth(): Response {
    return new Response(
      JSON.stringify({
        status: 'ok',
        service: SERVER_NAME,
        version: SERVER_VERSION,
        transport: 'cloudflare-edge',
        activeSessions: this.sessions.size,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
