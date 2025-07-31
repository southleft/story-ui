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

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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
            text: "✅ MCP connection is working! Story UI is connected and ready."
          }]
        };
      }

      case "generate-story": {
        const { prompt, chatId } = args as { prompt: string; chatId?: string };

        // Use the HTTP server endpoint to generate the story
        const response = await fetch('http://localhost:4001/mcp/generate-story', {
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

        return {
          content: [{
            type: "text",
            text: `Story generated successfully!\n\nTitle: ${result.title}\nID: ${result.id}\n\nStory Code:\n\`\`\`tsx\n${result.content}\n\`\`\`\n\nOpen your Storybook instance to see the generated story.`
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
        const stories = storyService.getAllStories();

        if (stories.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No stories have been generated yet."
            }]
          };
        }

        const storyList = stories.map((story: any) =>
          `- ${story.title} (ID: ${story.id})\n  Created: ${story.timestamp ? new Date(story.timestamp).toLocaleString() : 'Unknown'}`
        ).join('\n\n');

        return {
          content: [{
            type: "text",
            text: `Found ${stories.length} generated stories:\n\n${storyList}`
          }]
        };
      }

      case "get-story": {
        const { storyId } = args as { storyId: string };
        const story = storyService.getStory(storyId);

        if (!story) {
          return {
            content: [{
              type: "text",
              text: `Story with ID ${storyId} not found.`
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: `# ${story.title}\n\nID: ${story.id}\nCreated: ${(story as any).timestamp ? new Date((story as any).timestamp).toLocaleString() : 'Unknown'}\n\n## Story Code:\n\`\`\`tsx\n${story.content}\n\`\`\``
          }]
        };
      }

      case "delete-story": {
        const { storyId } = args as { storyId: string };
        const deleted = storyService.deleteStory(storyId);

        if (!deleted) {
          return {
            content: [{
              type: "text",
              text: `Story with ID ${storyId} not found.`
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: `Story ${storyId} has been deleted successfully.`
          }]
        };
      }

      case "get-component-props": {
        const { componentName } = args as { componentName: string };
        const response = await fetch(`http://localhost:4001/mcp/props?component=${encodeURIComponent(componentName)}`);

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
  console.error("Note: This requires the Story UI HTTP server to be running on port 4001");
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
