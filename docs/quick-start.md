# Quick Start Guide

Get up and running with Story UI in minutes!

## Prerequisites

- Node.js 16+
- An existing Storybook project
- A Claude API key (get one at https://console.anthropic.com/)

## Installation

```bash
npm install --save-dev @tpitre/story-ui
```

## Initial Setup

Run the initialization command in your project root:

```bash
npx story-ui init
```

This will:
1. Auto-detect your existing design system (if any)
2. Optionally install and configure popular design systems (Mantine, Chakra UI, Material UI)
3. Create a `story-ui.config.js` file with optimized settings
4. Set up the Story UI panel component in your Storybook
5. Configure `.gitignore` for generated stories
6. Create a `story-ui-docs/` directory for your documentation

## Configuration

The generated `story-ui.config.js` will be pre-configured based on your choices:

```javascript
module.exports = {
  generatedStoriesPath: "./src/stories/generated/",
  importPath: "@mantine/core", // or "@chakra-ui/react", "@mui/material", etc.
  componentPrefix: "",
  layoutRules: {
    // Pre-configured for your design system
  },
  storyPrefix: "Generated/",
  defaultAuthor: "Story UI AI"
};
```

## Starting Story UI

```bash
# Start Story UI server (defaults to port 4001)
npm run story-ui

# Start Storybook and Story UI together
npm run storybook-with-ui
```

## Using Story UI

1. Start Story UI and Storybook
2. Navigate to "Story UI > Story Generator" in Storybook
3. Chat with the AI to generate stories
4. Stories appear instantly under "Generated/" in your Storybook

## Next Steps

- Add design system documentation to `story-ui-docs/` for better AI generation
- See [Custom Documentation](./CUSTOM_DOCUMENTATION.md) for details
- Check the [main README](../README.md) for advanced features
