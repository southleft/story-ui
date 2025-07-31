# Story UI MCP Server Integration

Story UI can now be used as a Model Context Protocol (MCP) server, allowing you to generate Storybook stories directly from Claude Desktop or any other MCP-compatible client.

## Overview

The MCP integration allows you to:
- Generate Storybook stories using natural language prompts
- List available components in your design system
- View and manage generated stories
- Get detailed component prop information
- All from within your AI assistant interface

## Prerequisites

1. Story UI must be installed and configured in your project
2. The Story UI HTTP server must be running (`story-ui start`)
3. Claude Desktop or another MCP-compatible client

## Setup for Claude Desktop

### 1. Install Story UI (if not already installed)

```bash
npm install -g @tpitre/story-ui
# or in your project
npm install --save-dev @tpitre/story-ui
```

### 2. Configure Claude Desktop

Add the following to your Claude Desktop configuration file:

**On macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**On Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "story-ui": {
      "command": "npx",
      "args": ["@tpitre/story-ui", "mcp"],
      "env": {
        "CLAUDE_API_KEY": "your-claude-api-key-here"
      }
    }
  }
}
```

Or if you have Story UI installed globally:

```json
{
  "mcpServers": {
    "story-ui": {
      "command": "story-ui",
      "args": ["mcp"],
      "env": {
        "CLAUDE_API_KEY": "your-claude-api-key-here"
      }
    }
  }
}
```

### 3. Start the Story UI HTTP Server

In your project directory, start the HTTP server:

```bash
story-ui start
```

This will start the HTTP server on port 4001 (or another available port).

### 4. Restart Claude Desktop

After updating the configuration, restart Claude Desktop to load the new MCP server.

## Available MCP Tools

Once connected, you can use the following tools in Claude Desktop:

### 1. **generate-story**
Generate a new Storybook story from a natural language prompt.

Example prompts:
- "Generate a hero section with a title, subtitle, and two buttons"
- "Create a card component with an image, title, and description"
- "Build a navigation bar with logo and menu items"

### 2. **list-components**
List all available components in your design system.

Options:
- `category` (optional): Filter by component category

### 3. **list-stories**
View all previously generated stories.

### 4. **get-story**
Retrieve the content of a specific story by ID.

Parameters:
- `storyId`: The ID of the story to retrieve

### 5. **delete-story**
Delete a generated story.

Parameters:
- `storyId`: The ID of the story to delete

### 6. **get-component-props**
Get detailed prop information for a specific component.

Parameters:
- `componentName`: The name of the component

## Usage Examples

In Claude Desktop, you can now interact with Story UI:

1. **Generate a story:**
   ```
   "Use the Story UI tools to create a hero section with a dark background,
   white text, a main heading saying 'Welcome to Our Platform', and a
   'Get Started' button"
   ```

2. **Explore components:**
   ```
   "List all available components in the Button category"
   ```

3. **Manage stories:**
   ```
   "Show me all the stories I've generated today"
   ```

## Troubleshooting

### MCP Server Not Connecting

1. Ensure the HTTP server is running: `story-ui start`
2. Check that the Claude API key is set in your environment
3. Verify the configuration file path is correct
4. Restart Claude Desktop after configuration changes

### Stories Not Appearing in Storybook

1. Ensure your Storybook is running and configured to watch the generated stories path
2. Check the `story-ui.config.js` file for the correct `generatedStoriesPath`
3. Verify file permissions in the generated stories directory

### Port Conflicts

If port 4001 is in use, you can specify a different port:

1. Start the HTTP server with a custom port:
   ```bash
   story-ui start --port 4002
   ```

2. Update the MCP command to use the same port:
   ```json
   {
     "mcpServers": {
       "story-ui": {
         "command": "npx",
         "args": ["@tpitre/story-ui", "mcp", "--http-port", "4002"],
         "env": {
           "CLAUDE_API_KEY": "your-claude-api-key-here"
         }
       }
     }
   }
   ```

## Advanced Configuration

### Running from Source

If you're developing Story UI or want to run from source:

```json
{
  "mcpServers": {
    "story-ui": {
      "command": "node",
      "args": ["/path/to/story-ui-repo/dist/cli/index.js", "mcp"],
      "env": {
        "CLAUDE_API_KEY": "your-claude-api-key-here"
      }
    }
  }
}
```

### Environment Variables

You can pass additional environment variables:

```json
{
  "mcpServers": {
    "story-ui": {
      "command": "story-ui",
      "args": ["mcp"],
      "env": {
        "CLAUDE_API_KEY": "your-claude-api-key-here",
        "STORY_UI_CONFIG_PATH": "./custom-config.js",
        "NODE_ENV": "production"
      }
    }
  }
}
```

## Security Considerations

1. **API Keys**: Keep your Claude API key secure and never commit it to version control
2. **Network Access**: The MCP server communicates with the local HTTP server only
3. **File System**: Generated stories are written to the configured directory only

## Contributing

To contribute to the MCP integration:

1. The MCP server code is in `mcp-server/mcp-stdio-server.ts`
2. Test changes by running `story-ui mcp` locally
3. Update this documentation for any new features

For more information about the Model Context Protocol, visit the [MCP documentation](https://modelcontextprotocol.io/).
