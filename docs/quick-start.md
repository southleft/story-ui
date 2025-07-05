# Quick Start Guide

Get up and running with Story UI in minutes!

## Prerequisites

- Node.js 16+
- An existing Storybook project
- Claude Desktop app with MCP enabled

## Installation

```bash
npm install --save-dev @tpitre/story-ui
```

## Initial Setup

Run the setup command in your project root:

```bash
npx story-ui setup
```

This will:
1. Create a `story-ui.config.js` file
2. Set up the Story UI panel component
3. Configure your environment

## Configuration

Edit `story-ui.config.js` to specify your component library:

```javascript
export default {
  importPath: '@your-org/your-component-library',
  generatedStoriesPath: './src/stories/generated/',
  componentsPath: './src/components/' // Optional: for local components
};
```

## Using Story UI

1. Open Claude Desktop
2. Navigate to your project directory
3. Use the Story UI MCP server to generate stories
4. Stories will appear in your Storybook under "Generated/"

## Next Steps

- Learn about [Considerations Files](./considerations.md) for better story generation
- Explore [Configuration Options](./config-reference.md)
- Set up [Multi-Instance Support](./multi-instance.md) for multiple design systems
