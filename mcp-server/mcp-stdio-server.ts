#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from 'node-fetch';
import { loadUserConfig } from '../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../story-generator/enhancedComponentDiscovery.js';
import { getInMemoryStoryService } from '../story-generator/inMemoryStoryService.js';
import dotenv from 'dotenv';
import path from 'path';

// Check for working directory override from environment or command line
const workingDir = process.env.STORY_UI_CWD || process.argv.find(arg => arg.startsWith('--cwd='))?.split('=')[1];

if (workingDir) {
  console.error(`Story UI MCP Server: Changing working directory to ${workingDir}`);
  process.chdir(workingDir);
}

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Set MCP mode to suppress emojis in logging
process.env.STORY_UI_MCP_MODE = 'true';

// Get HTTP server port from environment variables (check multiple possible names)
const HTTP_PORT = process.env.VITE_STORY_UI_PORT || process.env.STORY_UI_HTTP_PORT || process.env.PORT || '4001';
const HTTP_BASE_URL = `http://localhost:${HTTP_PORT}`;

// Initialize configuration
const config = loadUserConfig();
const storyService = getInMemoryStoryService(config);

// Create MCP server instance
const server = new Server(
  {
    name: "story-ui",
    version: "2.1.5",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const TOOLS = [
  {
    name: "test-connection",
    description: "Test if MCP connection is working",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "generate-story",
    description: "Generate a Storybook story from a natural language prompt",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The prompt describing what UI to generate",
        },
        chatId: {
          type: "string",
          description: "Optional chat ID for tracking",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "list-components",
    description: "List all available components that can be used in stories",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Filter by category",
        },
      },
    },
  },
  {
    name: "list-stories",
    description: "List all generated stories",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get-story",
    description: "Get the content of a specific generated story",
    inputSchema: {
      type: "object",
      properties: {
        storyId: {
          type: "string",
          description: "The ID of the story to retrieve",
        },
      },
      required: ["storyId"],
    },
  },
  {
    name: "delete-story",
    description: "Delete a generated story",
    inputSchema: {
      type: "object",
      properties: {
        storyId: {
          type: "string",
          description: "The ID of the story to delete",
        },
      },
      required: ["storyId"],
    },
  },
  {
    name: "get-component-props",
    description: "Get detailed prop information for a specific component",
    inputSchema: {
      type: "object",
      properties: {
        componentName: {
          type: "string",
          description: "The name of the component",
        },
      },
      required: ["componentName"],
    },
  },
];

// Set up request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "test-connection": {
        return {
          content: [{
            type: "text",
            text: "MCP connection is working! Story UI is connected and ready."
          }]
        };
      }

      case "generate-story": {
        const { prompt, chatId } = args as { prompt: string; chatId?: string };

        // Use the HTTP server endpoint to generate the story
        const response = await fetch(`${HTTP_BASE_URL}/mcp/generate-story`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt, chatId }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Failed to generate story: ${error}`);
        }

        const result = await response.json();
        
        // Debug log to see what we're getting
        console.error('Story generation result:', JSON.stringify(result, null, 2));

        return {
          content: [{
            type: "text",
            text: `Story generated successfully!\n\nTitle: ${result.title || 'Untitled'}\nID: ${result.storyId || result.fileName || 'Unknown'}\n\nStory Code:\n\`\`\`tsx\n${result.story || 'Story code not available'}\n\`\`\`\n\nOpen your Storybook instance to see the generated story.`
          }]
        };
      }

            case "list-components": {
        const { category } = args as { category?: string };

        try {
          const discovery = new EnhancedComponentDiscovery(config);
          const components = await discovery.discoverAll();

          let filteredComponents = components;
          if (category) {
            filteredComponents = components.filter(comp =>
              comp.category?.toLowerCase() === category.toLowerCase()
            );
          }

                    // Limit response size for Claude Desktop
          const maxComponents = 50;
          const displayComponents = filteredComponents.slice(0, maxComponents);
          const componentList = displayComponents.map(comp =>
            `- ${comp.name} (${comp.category || 'Uncategorized'})`
          ).join('\n');

          const responseText = filteredComponents.length > maxComponents
            ? `Found ${filteredComponents.length} components (showing first ${maxComponents}):\n\n${componentList}\n\n...and ${filteredComponents.length - maxComponents} more components`
            : `Found ${filteredComponents.length} components:\n\n${componentList}`;

          return {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          console.error('Error in list-components:', error);
          return {
            content: [{
              type: "text",
              text: `Error discovering components: ${error instanceof Error ? error.message : String(error)}`
            }],
            isError: true
          };
        }
      }

      case "list-stories": {
        try {
          const response = await fetch(`${HTTP_BASE_URL}/mcp/stories`);
          
          if (!response.ok) {
            throw new Error(`Failed to list stories: ${response.statusText}`);
          }
          
          const stories = await response.json();
          
          if (!stories || stories.length === 0) {
            return {
              content: [{
                type: "text",
                text: "No stories have been generated yet."
              }]
            };
          }

          const storyList = stories.map((story: any) =>
            `- ${story.title || story.fileName || 'Untitled'} (ID: ${story.id || story.storyId})\n  Created: ${story.timestamp || story.createdAt ? new Date(story.timestamp || story.createdAt).toLocaleString() : 'Unknown'}`
          ).join('\n\n');

          return {
            content: [{
              type: "text",
              text: `Found ${stories.length} generated stories:\n\n${storyList}`
            }]
          };
        } catch (error) {
          console.error('Error listing stories:', error);
          return {
            content: [{
              type: "text",
              text: `Error listing stories: ${error instanceof Error ? error.message : String(error)}`
            }],
            isError: true
          };
        }
      }

      case "get-story": {
        const { storyId } = args as { storyId: string };
        
        try {
          // First try to get the story metadata
          const response = await fetch(`${HTTP_BASE_URL}/mcp/stories/${storyId}`);
          
          if (!response.ok) {
            throw new Error(`Story with ID ${storyId} not found`);
          }
          
          const story = await response.json();
          
          // Then get the story content
          const contentResponse = await fetch(`${HTTP_BASE_URL}/mcp/stories/${storyId}/content`);
          const content = contentResponse.ok ? await contentResponse.text() : story.content || story.story || 'Content not available';

          return {
            content: [{
              type: "text",
              text: `# ${story.title || story.fileName || 'Untitled'}\n\nID: ${story.id || story.storyId || storyId}\nCreated: ${story.timestamp || story.createdAt ? new Date(story.timestamp || story.createdAt).toLocaleString() : 'Unknown'}\n\n## Story Code:\n\`\`\`tsx\n${content}\n\`\`\``
            }]
          };
        } catch (error) {
          console.error('Error getting story:', error);
          return {
            content: [{
              type: "text",
              text: `Story with ID ${storyId} not found or error retrieving it: ${error instanceof Error ? error.message : String(error)}`
            }],
            isError: true
          };
        }
      }

      case "delete-story": {
        const { storyId } = args as { storyId: string };
        
        try {
          const response = await fetch(`${HTTP_BASE_URL}/mcp/stories/${storyId}`, {
            method: 'DELETE'
          });
          
          if (!response.ok) {
            throw new Error(`Failed to delete story: ${response.statusText}`);
          }

          return {
            content: [{
              type: "text",
              text: `Story ${storyId} has been deleted successfully.`
            }]
          };
        } catch (error) {
          console.error('Error deleting story:', error);
          return {
            content: [{
              type: "text",
              text: `Failed to delete story ${storyId}: ${error instanceof Error ? error.message : String(error)}`
            }],
            isError: true
          };
        }
      }

      case "get-component-props": {
        const { componentName } = args as { componentName: string };
        const response = await fetch(`${HTTP_BASE_URL}/mcp/props?component=${encodeURIComponent(componentName)}`);

        if (!response.ok) {
          throw new Error(`Failed to get component props: ${response.statusText}`);
        }

        const props = await response.json();

        if (!props || Object.keys(props).length === 0) {
          return {
            content: [{
              type: "text",
              text: `No prop information found for component ${componentName}.`
            }]
          };
        }

        const propsList = Object.entries(props).map(([name, info]: [string, any]) =>
          `- ${name}: ${info.type} ${info.required ? '(required)' : '(optional)'}${info.description ? ` - ${info.description}` : ''}`
        ).join('\n');

        return {
          content: [{
            type: "text",
            text: `Props for ${componentName}:\n\n${propsList}`
          }]
        };
      }

      default:
        return {
          content: [{
            type: "text",
            text: `Unknown tool: ${name}`
          }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
});

// Main function to start the server
async function main() {
  // Log to stderr so it doesn't interfere with stdio communication
  console.error("Story UI MCP Server starting...");
  console.error(`Note: This requires the Story UI HTTP server to be running on port ${HTTP_PORT}`);
  console.error("Run 'story-ui start' in a separate terminal if not already running.\n");

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect the server to the transport
  await server.connect(transport);

  console.error("Story UI MCP Server is now running and ready to accept connections.");
}

// Run the server
main().catch((error) => {
  console.error("Failed to start Story UI MCP Server:", error);
  process.exit(1);
});
