/**
 * MCP Remote HTTP Transport Routes
 *
 * Implements both Streamable HTTP (modern) and SSE (legacy) transports
 * from the MCP SDK to enable remote connections from Claude Desktop
 * and other MCP clients.
 *
 * - Streamable HTTP: Single POST endpoint at /mcp (recommended for Claude Desktop)
 * - SSE: GET /sse + POST /messages (legacy, kept for backwards compatibility)
 *
 * This allows Story UI to be accessed from Claude Desktop without requiring
 * a local process - useful for cloud deployments and shared Storybook instances.
 *
 * Uses MCP SDK v1.23.0+ with Streamable HTTP transport
 */

import { Request, Response, Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';

// Get package version
const packageJsonPath = path.resolve(process.cwd(), 'package.json');
let PACKAGE_VERSION = '1.0.0';
try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  PACKAGE_VERSION = packageJson.version;
} catch {
  // Use default version
}

// Get HTTP server port from environment variables
const HTTP_PORT = process.env.VITE_STORY_UI_PORT || process.env.STORY_UI_HTTP_PORT || process.env.PORT || '4001';
const HTTP_BASE_URL = `http://localhost:${HTTP_PORT}`;

// Load configuration
const config = loadUserConfig();

export const router = Router();

// Store SSE transports for legacy session management
const sseTransports: Record<string, SSEServerTransport> = {};

// Define available tools with JSON Schema (avoids Zod type recursion issues)
const TOOLS = [
  {
    name: 'test-connection',
    description: 'Test if MCP connection is working',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'generate-story',
    description: 'Generate a Storybook story from a natural language prompt',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'The prompt describing what UI to generate',
        },
        chatId: {
          type: 'string',
          description: 'Optional chat ID for tracking',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list-components',
    description: 'List all available components that can be used in stories',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category',
        },
      },
    },
  },
  {
    name: 'list-stories',
    description: 'List all generated stories',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get-story',
    description: 'Get the content of a specific generated story',
    inputSchema: {
      type: 'object' as const,
      properties: {
        storyId: {
          type: 'string',
          description: 'The ID of the story to retrieve',
        },
      },
      required: ['storyId'],
    },
  },
  {
    name: 'delete-story',
    description: 'Delete a generated story',
    inputSchema: {
      type: 'object' as const,
      properties: {
        storyId: {
          type: 'string',
          description: 'The ID of the story to delete',
        },
      },
      required: ['storyId'],
    },
  },
  {
    name: 'get-component-props',
    description: 'Get detailed prop information for a specific component',
    inputSchema: {
      type: 'object' as const,
      properties: {
        componentName: {
          type: 'string',
          description: 'The name of the component',
        },
      },
      required: ['componentName'],
    },
  },
  {
    name: 'update-story',
    description: 'Update an existing Storybook story with modifications',
    inputSchema: {
      type: 'object' as const,
      properties: {
        storyId: {
          type: 'string',
          description: 'Optional: The ID of the story to update',
        },
        prompt: {
          type: 'string',
          description: 'Description of the changes to make to the story',
        },
      },
      required: ['prompt'],
    },
  },
];

/**
 * Handle tool execution
 */
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}> {
  switch (name) {
    case 'test-connection': {
      return {
        content: [{
          type: 'text',
          text: 'MCP remote connection is working! Story UI is connected via Streamable HTTP.',
        }],
      };
    }

    case 'generate-story': {
      const { prompt, chatId } = args as { prompt: string; chatId?: string };

      const response = await fetch(`${HTTP_BASE_URL}/mcp/generate-story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, chatId }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to generate story: ${error}`);
      }

      const result = await response.json() as any;

      return {
        content: [{
          type: 'text',
          text: `Story generated successfully!\n\nTitle: ${result.title || 'Untitled'}\nStory ID: ${result.storyId || 'Unknown'}\nFile Name: ${result.fileName || 'Unknown'}\n\nStory Code:\n\`\`\`tsx\n${result.story || 'Story code not available'}\n\`\`\`\n\nOpen your Storybook instance to see the generated story.\n\nTo update this story later, use the Story ID: ${result.storyId}`,
        }],
      };
    }

    case 'list-components': {
      const { category } = args as { category?: string };

      const discovery = new EnhancedComponentDiscovery(config);
      const components = await discovery.discoverAll();

      let filteredComponents = components;
      if (category) {
        filteredComponents = components.filter(comp =>
          comp.category?.toLowerCase() === category.toLowerCase()
        );
      }

      const maxComponents = 50;
      const displayComponents = filteredComponents.slice(0, maxComponents);
      const componentList = displayComponents.map(comp =>
        `- ${comp.name} (${comp.category || 'Uncategorized'})`
      ).join('\n');

      const responseText = filteredComponents.length > maxComponents
        ? `Found ${filteredComponents.length} components (showing first ${maxComponents}):\n\n${componentList}\n\n...and ${filteredComponents.length - maxComponents} more components`
        : `Found ${filteredComponents.length} components:\n\n${componentList}`;

      return {
        content: [{ type: 'text', text: responseText }],
      };
    }

    case 'list-stories': {
      let fileStories: any[] = [];
      if (config.generatedStoriesPath && fs.existsSync(config.generatedStoriesPath)) {
        const files = fs.readdirSync(config.generatedStoriesPath);
        fileStories = files
          .filter(file => file.endsWith('.stories.tsx'))
          .map(file => {
            const hash = file.match(/-([a-f0-9]{8})\.stories\.tsx$/)?.[1] || '';
            const storyId = hash ? `story-${hash}` : file.replace('.stories.tsx', '');

            let title = file.replace('.stories.tsx', '').replace(/-/g, ' ');
            try {
              const filePath = path.join(config.generatedStoriesPath, file);
              const content = fs.readFileSync(filePath, 'utf-8');
              const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
              if (titleMatch) {
                title = titleMatch[1].replace('Generated/', '');
              }
            } catch {
              // Use filename as fallback
            }

            return { id: storyId, fileName: file, title };
          });
      }

      if (fileStories.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No stories have been generated yet.\n\nGenerate your first story by describing what UI component you\'d like to create!',
          }],
        };
      }

      let responseText = `**Available stories (${fileStories.length}):**\n`;
      fileStories.forEach(story => {
        responseText += `\n- ${story.title}\n  ID: ${story.id}\n  File: ${story.fileName}\n`;
      });

      return { content: [{ type: 'text', text: responseText }] };
    }

    case 'get-story': {
      const { storyId } = args as { storyId: string };

      if (config.generatedStoriesPath && fs.existsSync(config.generatedStoriesPath)) {
        const files = fs.readdirSync(config.generatedStoriesPath);
        const hashMatch = storyId.match(/^story-([a-f0-9]{8})$/);
        const hash = hashMatch ? hashMatch[1] : null;

        const matchingFile = files.find(file => {
          if (hash && file.includes(`-${hash}.stories.tsx`)) return true;
          if (file === `${storyId}.stories.tsx`) return true;
          if (file === storyId) return true;
          return false;
        });

        if (matchingFile) {
          const filePath = path.join(config.generatedStoriesPath, matchingFile);
          const content = fs.readFileSync(filePath, 'utf-8');
          const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
          const title = titleMatch ? titleMatch[1] : 'Untitled';

          return {
            content: [{
              type: 'text',
              text: `# ${title}\n\nID: ${storyId}\nFile: ${matchingFile}\n\n## Story Code:\n\`\`\`tsx\n${content}\n\`\`\``,
            }],
          };
        }
      }

      throw new Error(`Story with ID ${storyId} not found`);
    }

    case 'delete-story': {
      const { storyId } = args as { storyId: string };

      if (config.generatedStoriesPath && fs.existsSync(config.generatedStoriesPath)) {
        const files = fs.readdirSync(config.generatedStoriesPath);
        const hashMatch = storyId.match(/^story-([a-f0-9]{8})$/);
        const hash = hashMatch ? hashMatch[1] : null;

        const matchingFile = files.find(file => {
          if (hash && file.includes(`-${hash}.stories.tsx`)) return true;
          if (file === `${storyId}.stories.tsx`) return true;
          if (file === storyId) return true;
          return false;
        });

        if (matchingFile) {
          const filePath = path.join(config.generatedStoriesPath, matchingFile);
          fs.unlinkSync(filePath);
          return {
            content: [{
              type: 'text',
              text: `Story "${matchingFile}" has been deleted successfully.`,
            }],
          };
        }
      }

      throw new Error(`Story not found in file system`);
    }

    case 'get-component-props': {
      const { componentName } = args as { componentName: string };

      const response = await fetch(`${HTTP_BASE_URL}/mcp/props?component=${encodeURIComponent(componentName)}`);

      if (!response.ok) {
        throw new Error(`Failed to get component props: ${response.statusText}`);
      }

      const props = await response.json() as any;

      if (!props || Object.keys(props).length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No prop information found for component ${componentName}.`,
          }],
        };
      }

      const propsList = Object.entries(props).map(([propName, info]: [string, any]) =>
        `- ${propName}: ${info.type} ${info.required ? '(required)' : '(optional)'}${info.description ? ` - ${info.description}` : ''}`
      ).join('\n');

      return {
        content: [{
          type: 'text',
          text: `Props for ${componentName}:\n\n${propsList}`,
        }],
      };
    }

    case 'update-story': {
      let { storyId, prompt } = args as { storyId?: string; prompt: string };

      // Find the story to update if no ID provided
      if (!storyId && config.generatedStoriesPath && fs.existsSync(config.generatedStoriesPath)) {
        const files = fs.readdirSync(config.generatedStoriesPath)
          .filter(f => f.endsWith('.stories.tsx'))
          .sort((a, b) => {
            const statA = fs.statSync(path.join(config.generatedStoriesPath, a));
            const statB = fs.statSync(path.join(config.generatedStoriesPath, b));
            return statB.mtime.getTime() - statA.mtime.getTime();
          });

        if (files.length > 0) {
          const hash = files[0].match(/-([a-f0-9]{8})\.stories\.tsx$/)?.[1];
          storyId = hash ? `story-${hash}` : files[0].replace('.stories.tsx', '');
        }
      }

      if (!storyId) {
        return {
          content: [{
            type: 'text',
            text: 'No story found to update. Please generate a story first or specify which story you\'d like to update.',
          }],
          isError: true,
        };
      }

      // Get existing story content
      let existingCode = '';
      let storyMetadata: any = {};

      if (config.generatedStoriesPath && fs.existsSync(config.generatedStoriesPath)) {
        const files = fs.readdirSync(config.generatedStoriesPath);
        const hashMatch = storyId.match(/^story-([a-f0-9]{8})$/);
        const hash = hashMatch ? hashMatch[1] : null;

        const matchingFile = files.find(file => {
          if (hash && file.includes(`-${hash}.stories.tsx`)) return true;
          return false;
        });

        if (matchingFile) {
          const filePath = path.join(config.generatedStoriesPath, matchingFile);
          existingCode = fs.readFileSync(filePath, 'utf-8');
          const titleMatch = existingCode.match(/title:\s*['"]([^'"]+)['"]/);
          storyMetadata = {
            fileName: matchingFile,
            title: titleMatch ? titleMatch[1] : 'Untitled',
          };
        }
      }

      const conversation = [
        { role: 'user', content: storyMetadata.prompt || 'Generate a story' },
        { role: 'assistant', content: existingCode },
        { role: 'user', content: prompt },
      ];

      const response = await fetch(`${HTTP_BASE_URL}/mcp/generate-story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          fileName: storyMetadata.fileName || storyId,
          conversation,
          isUpdate: true,
          originalTitle: storyMetadata.title,
          storyId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to update story: ${error}`);
      }

      const result = await response.json() as any;

      return {
        content: [{
          type: 'text',
          text: `Story updated successfully!\n\nTitle: ${result.title || 'Untitled'}\nID: ${result.storyId || result.fileName || 'Unknown'}\n\nUpdated Story Code:\n\`\`\`tsx\n${result.story || 'Story code not available'}\n\`\`\`\n\nThe story has been updated in your Storybook instance.`,
        }],
      };
    }

    default:
      return {
        content: [{
          type: 'text',
          text: `Unknown tool: ${name}`,
        }],
        isError: true,
      };
  }
}

/**
 * Create a configured MCP server instance with Story UI tools
 * Uses the low-level Server class with request handlers
 */
function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'story-ui-remote',
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Register tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      return await handleToolCall(name, args as Record<string, unknown>);
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Streamable HTTP endpoint for MCP (modern transport for Claude Desktop)
 * POST /mcp-remote/mcp
 *
 * This is the recommended endpoint for Claude Desktop connections.
 * Uses stateless mode - each request gets a fresh server and transport
 * to prevent JSON-RPC request ID collisions between different clients.
 */
router.post('/mcp', async (req: Request, res: Response) => {
  console.log('[MCP Remote] Streamable HTTP request received');

  try {
    // Create new server and transport for each request (stateless mode)
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Clean up transport when response closes
    res.on('close', () => {
      transport.close();
    });

    // Connect server to this transport and handle the request
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[MCP Remote] Error handling Streamable HTTP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

/**
 * Also handle GET and DELETE for the /mcp endpoint
 * Some MCP clients may probe with GET first
 */
router.get('/mcp', (req: Request, res: Response) => {
  res.json({
    jsonrpc: '2.0',
    result: {
      name: 'story-ui-remote',
      version: PACKAGE_VERSION,
      transport: 'streamable-http',
      description: 'Story UI MCP Server - Use POST for MCP requests',
    },
    id: null,
  });
});

/**
 * Legacy SSE endpoint for establishing the MCP connection
 * GET /mcp-remote/sse
 *
 * Kept for backwards compatibility with older clients.
 * New clients should use the Streamable HTTP endpoint at /mcp-remote/mcp
 */
router.get('/sse', async (req: Request, res: Response) => {
  try {
    console.log('[MCP Remote] New SSE connection request (legacy)');

    // Create SSE transport
    const transport = new SSEServerTransport('/mcp-remote/messages', res);
    sseTransports[transport.sessionId] = transport;

    console.log(`[MCP Remote] SSE session created: ${transport.sessionId}`);

    // Handle connection close
    res.on('close', () => {
      delete sseTransports[transport.sessionId];
      console.log(`[MCP Remote] SSE session closed: ${transport.sessionId}`);
    });

    // Create a new server for this SSE session and connect
    const legacyServer = createMcpServer();
    await legacyServer.connect(transport);
  } catch (error) {
    console.error('[MCP Remote] Error creating SSE session:', error);
    if (!res.headersSent) {
      res.status(500).send('Failed to create SSE session');
    }
  }
});

/**
 * Legacy message endpoint for SSE transport
 * POST /mcp-remote/messages
 */
router.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).json({ error: 'sessionId query parameter is required' });
    return;
  }

  const transport = sseTransports[sessionId];

  if (!transport) {
    res.status(400).json({ error: `No transport found for sessionId: ${sessionId}` });
    return;
  }

  try {
    await transport.handlePostMessage(req as any, res as any);
  } catch (error) {
    console.error('[MCP Remote] Error handling message:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to handle message' });
    }
  }
});

/**
 * Health check endpoint for the MCP remote service
 * GET /mcp-remote/health
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'story-ui-mcp-remote',
    version: PACKAGE_VERSION,
    transports: {
      streamableHttp: {
        enabled: true,
        endpoint: '/mcp-remote/mcp',
        description: 'Modern transport for Claude Desktop (recommended)',
      },
      sse: {
        enabled: true,
        endpoint: '/mcp-remote/sse',
        messagesEndpoint: '/mcp-remote/messages',
        description: 'Legacy transport (deprecated)',
        activeSessions: Object.keys(sseTransports).length,
      },
    },
    tools: [
      'test-connection',
      'generate-story',
      'list-components',
      'list-stories',
      'get-story',
      'delete-story',
      'get-component-props',
      'update-story',
    ],
  });
});

export default router;
