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
import { SessionManager } from './sessionManager.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Get package version dynamically
const __filename_mcp = fileURLToPath(import.meta.url);
const __dirname_mcp = path.dirname(__filename_mcp);
const packageJsonPath = path.resolve(__dirname_mcp, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const PACKAGE_VERSION = packageJson.version;

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
const sessionManager = SessionManager.getInstance();

// Generate a session ID for this MCP connection
const sessionId = crypto.randomBytes(16).toString('hex');
console.error(`[MCP] Session ID: ${sessionId}`);

// Create MCP server instance
const server = new Server(
  {
    name: "story-ui",
    version: PACKAGE_VERSION,
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
  {
    name: "update-story",
    description: "Update an existing Storybook story with modifications. If no storyId is provided, I'll update the most recent story or find the right one based on context.",
    inputSchema: {
      type: "object",
      properties: {
        storyId: {
          type: "string",
          description: "Optional: The ID of the story to update. If not provided, will use context to find the right story.",
        },
        prompt: {
          type: "string",
          description: "Description of the changes to make to the story",
        },
      },
      required: ["prompt"],
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

        // Track the story in session
        if (result.storyId && result.fileName && result.title) {
          sessionManager.trackStory(sessionId, {
            id: result.storyId,
            fileName: result.fileName,
            title: result.title,
            prompt: prompt
          });
        }

        return {
          content: [{
            type: "text",
            text: `Story generated successfully!\n\nTitle: ${result.title || 'Untitled'}\nStory ID: ${result.storyId || 'Unknown'}\nFile Name: ${result.fileName || 'Unknown'}\n\nStory Code:\n\`\`\`tsx\n${result.story || 'Story code not available'}\n\`\`\`\n\nOpen your Storybook instance to see the generated story.\n\nTo update this story later, use the Story ID: ${result.storyId}`
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
          // Get session stories
          const sessionStories = sessionManager.getSessionStories(sessionId);
          
          // Also try to get file system stories
          let fileStories: any[] = [];
          if (config.generatedStoriesPath && fs.existsSync(config.generatedStoriesPath)) {
            const files = fs.readdirSync(config.generatedStoriesPath);
            fileStories = files
              .filter(file => file.endsWith('.stories.tsx'))
              .map(file => {
                const hash = file.match(/-([a-f0-9]{8})\.stories\.tsx$/)?.[1] || '';
                const storyId = hash ? `story-${hash}` : file.replace('.stories.tsx', '');
                
                // Try to read title from file
                let title = file.replace('.stories.tsx', '').replace(/-/g, ' ');
                try {
                  const filePath = path.join(config.generatedStoriesPath, file);
                  const content = fs.readFileSync(filePath, 'utf-8');
                  const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
                  if (titleMatch) {
                    title = titleMatch[1].replace('Generated/', '');
                  }
                } catch (e) {
                  // Use filename as fallback
                }
                
                return {
                  id: storyId,
                  fileName: file,
                  title,
                  source: 'file-system',
                  isInSession: sessionStories.some(s => s.id === storyId)
                };
              });
          }
          
          if (sessionStories.length === 0 && fileStories.length === 0) {
            return {
              content: [{
                type: "text",
                text: "No stories have been generated yet.\n\nGenerate your first story by describing what UI component you'd like to create!"
              }]
            };
          }

          let responseText = '';
          
          // Show session stories first
          if (sessionStories.length > 0) {
            responseText += `**Stories in current session:**\n`;
            const currentStory = sessionManager.getCurrentStory(sessionId);
            
            sessionStories.forEach(story => {
              const isCurrent = currentStory?.id === story.id;
              responseText += `\n${isCurrent ? '→ ' : '  '}${story.title}\n`;
              responseText += `  ID: ${story.id}\n`;
              responseText += `  File: ${story.fileName}\n`;
              if (isCurrent) {
                responseText += `  (Currently discussing this story)\n`;
              }
            });
          }
          
          // Show other available stories
          const nonSessionFiles = fileStories.filter(f => !f.isInSession);
          if (nonSessionFiles.length > 0) {
            responseText += `\n\n**Other available stories:**\n`;
            nonSessionFiles.forEach(story => {
              responseText += `\n- ${story.title}\n`;
              responseText += `  ID: ${story.id}\n`;
              responseText += `  File: ${story.fileName}\n`;
            });
          }
          
          responseText += `\n\n**Tips:**\n`;
          responseText += `- To update a story, just describe what changes you want\n`;
          responseText += `- I'll automatically work with the most recent story or find the right one based on context\n`;
          responseText += `- You can also specify a story ID directly if needed`;

          return {
            content: [{
              type: "text",
              text: responseText
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
          // Try to delete from file system directly
          if (config.generatedStoriesPath && fs.existsSync(config.generatedStoriesPath)) {
            const files = fs.readdirSync(config.generatedStoriesPath);
            
            // Extract hash from story ID
            const hashMatch = storyId.match(/^story-([a-f0-9]{8})$/);
            const hash = hashMatch ? hashMatch[1] : null;
            
            // Find matching file
            const matchingFile = files.find(file => {
              if (hash && file.includes(`-${hash}.stories.tsx`)) return true;
              if (file === `${storyId}.stories.tsx`) return true;
              if (file === storyId) return true;
              return false;
            });
            
            if (matchingFile) {
              const filePath = path.join(config.generatedStoriesPath, matchingFile);
              fs.unlinkSync(filePath);
              console.error(`[MCP] Deleted story file: ${filePath}`);
              
              // Also remove from session
              const sessionStories = sessionManager.getSessionStories(sessionId);
              const storyInSession = sessionStories.find(s => s.id === storyId);
              if (storyInSession) {
                // Note: SessionManager doesn't have a removeStory method yet
                // For now, just clear current if it matches
                const current = sessionManager.getCurrentStory(sessionId);
                if (current?.id === storyId) {
                  sessionManager.setCurrentStory(sessionId, '');
                }
              }
              
              return {
                content: [{
                  type: "text",
                  text: `Story "${matchingFile}" has been deleted successfully.`
                }]
              };
            }
          }
          
          // Fallback to HTTP endpoint
          const response = await fetch(`${HTTP_BASE_URL}/mcp/stories/${storyId}`, {
            method: 'DELETE'
          });
          
          if (!response.ok) {
            throw new Error(`Story not found in file system or via HTTP endpoint`);
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

      case "update-story": {
        let { storyId, prompt } = args as { storyId?: string; prompt: string };
        
        try {
          // If no storyId provided, try to find the right story
          if (!storyId) {
            // First check current story in session
            const currentStory = sessionManager.getCurrentStory(sessionId);
            if (currentStory) {
              storyId = currentStory.id;
              console.error(`[MCP] Using current story: ${currentStory.title} (${storyId})`);
            } else {
              // Try to find by context
              const contextStory = sessionManager.findStoryByContext(sessionId, prompt);
              if (contextStory) {
                storyId = contextStory.id;
                console.error(`[MCP] Found story by context: ${contextStory.title} (${storyId})`);
              } else {
                // Use the most recent story
                const sessionStories = sessionManager.getSessionStories(sessionId);
                if (sessionStories.length > 0) {
                  const recentStory = sessionStories[sessionStories.length - 1];
                  storyId = recentStory.id;
                  console.error(`[MCP] Using most recent story: ${recentStory.title} (${storyId})`);
                } else {
                  return {
                    content: [{
                      type: "text",
                      text: "No story found to update. Please generate a story first or specify which story you'd like to update."
                    }],
                    isError: true
                  };
                }
              }
            }
          }
          
          // Try to get story content directly from file system first
          let existingCode = '';
          let storyMetadata: any = {};
          let foundLocally = false;
          
          if (config.generatedStoriesPath && fs.existsSync(config.generatedStoriesPath)) {
            const files = fs.readdirSync(config.generatedStoriesPath);
            
            // Extract hash from story ID
            const hashMatch = storyId.match(/^story-([a-f0-9]{8})$/);
            const hash = hashMatch ? hashMatch[1] : null;
            
            // Find matching file
            const matchingFile = files.find(file => {
              if (hash && file.includes(`-${hash}.stories.tsx`)) return true;
              if (file === `${storyId}.stories.tsx`) return true;
              return false;
            });
            
            if (matchingFile) {
              const filePath = path.join(config.generatedStoriesPath, matchingFile);
              existingCode = fs.readFileSync(filePath, 'utf-8');
              
              // Extract metadata from the story content
              const titleMatch = existingCode.match(/title:\s*['"]([^'"]+)['"]/);
              storyMetadata = {
                fileName: matchingFile,
                title: titleMatch ? titleMatch[1] : 'Untitled', // Keep the full title with prefix
                prompt: prompt // Use the update prompt as context
              };
              foundLocally = true;
              console.error(`[MCP] Found story locally: ${filePath}`);
            }
          }
          
          // If not found locally, fall back to HTTP endpoint
          if (!foundLocally) {
            console.error(`[MCP] Story not found locally, trying HTTP endpoint`);
            const storyResponse = await fetch(`${HTTP_BASE_URL}/mcp/stories/${storyId}`);
            
            if (!storyResponse.ok) {
              throw new Error(`Story with ID ${storyId} not found`);
            }
            
            storyMetadata = await storyResponse.json();
            
            // Get the actual story content
            const contentResponse = await fetch(`${HTTP_BASE_URL}/mcp/stories/${storyId}/content`);
            if (!contentResponse.ok) {
              throw new Error(`Could not retrieve content for story ${storyId}`);
            }
            
            existingCode = await contentResponse.text();
          }
          
          // Build conversation context for the update
          const conversation = [
            {
              role: 'user',
              content: storyMetadata.prompt || 'Generate a story'
            },
            {
              role: 'assistant', 
              content: existingCode
            },
            {
              role: 'user',
              content: prompt
            }
          ];
          
          // Send update request to the generation endpoint
          const response = await fetch(`${HTTP_BASE_URL}/mcp/generate-story`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              prompt,
              fileName: storyMetadata.fileName || storyId,
              conversation,
              isUpdate: true,
              originalTitle: storyMetadata.title,
              storyId: storyId
            }),
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to update story: ${error}`);
          }

          const result = await response.json();
          
          // Debug log to see what we're getting
          console.error('Story update result:', JSON.stringify(result, null, 2));

          // Update session tracking with preserved metadata
          if (result.storyId && result.fileName && result.title) {
            sessionManager.trackStory(sessionId, {
              id: result.storyId,
              fileName: result.fileName,
              title: result.title,
              prompt: prompt
            });
          }

          return {
            content: [{
              type: "text",
              text: `Story updated successfully!\n\nTitle: ${result.title || 'Untitled'}\nID: ${result.storyId || result.fileName || 'Unknown'}\n\nUpdated Story Code:\n\`\`\`tsx\n${result.story || 'Story code not available'}\n\`\`\`\n\nThe story has been updated in your Storybook instance.`
            }]
          };
        } catch (error) {
          console.error('Error updating story:', error);
          return {
            content: [{
              type: "text",
              text: `Failed to update story: ${error instanceof Error ? error.message : String(error)}`
            }],
            isError: true
          };
        }
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
