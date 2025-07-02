# Multi-Instance Story UI Demo

This document explains how to run multiple Storybook instances with Story UI for cross-design-system comparisons.

## Overview

The multi-instance feature allows you to run multiple Storybooks simultaneously, each with their own MCP server and design system configuration. This is perfect for:

- Comparing how the same prompt generates different stories across design systems
- Testing Story UI with multiple UI libraries simultaneously
- Demonstrating Story UI's flexibility across different component libraries

## Configuration

The multi-instance setup is controlled by `multi-instance.config.json` in the root directory:

```json
{
  "instances": [
    {
      "name": "Your Library Name",
      "directory": "test-storybooks/your-test-dir",
      "mcpPort": 4005,
      "storybookPort": 6010,
      "color": "\u001b[34m",
      "enabled": true
    }
  ],
  "settings": {
    "logFile": "~/.story-ui-multi-instance.log",
    "useNpmLink": true,
    "parallelStart": true,
    "startDelay": 3000
  }
}
```

### Adding a New Instance

1. **Create a new test Storybook project**:
   ```bash
   cd test-storybooks
   npx create-vite@latest your-library-test --template react-ts
   cd your-library-test
   npx storybook@latest init
   ```

2. **Install your UI library** (e.g., Material-UI):
   ```bash
   npm install @mui/material @emotion/react @emotion/styled
   ```

3. **Initialize Story UI**:
   ```bash
   npx story-ui init
   ```

4. **Update your `story-ui.config.js`** with library-specific settings

5. **Add to `multi-instance.config.json`**:
   ```json
   {
     "name": "Material-UI",
     "directory": "test-storybooks/mui-test",
     "mcpPort": 4005,
     "storybookPort": 6010,
     "color": "\u001b[34m",
     "enabled": true
   }
   ```

6. **Restart the multi-instance script**:
   ```bash
   npm run multi-instance
   ```

## Running the Demo

### Prerequisites

1. Make sure you're in the Story UI root directory
2. Build the project: `npm run build`
3. Link the package: `npm link`

### Start All Instances

```bash
npm run multi-instance
```

This will start:
- Primer (GitHub) on port 6006 (MCP: 4001)
- Ant Design on port 6007 (MCP: 4002)
- Mantine on port 6008 (MCP: 4003)
- Chakra UI on port 6009 (MCP: 4004)
- Any additional instances you've configured

### Accessing the Instances

Each Storybook will be available at its configured port:
- http://localhost:6006 - Primer
- http://localhost:6007 - Ant Design
- http://localhost:6008 - Mantine
- http://localhost:6009 - Chakra UI

## Demo Scenarios

### 1. Cross-Design System Comparison

Try the same prompt in each Storybook:

```
Generate a user profile card with avatar, name, bio, and follow button
```

Notice how each design system interprets the prompt differently:
- Primer uses GitHub's design language
- Ant Design applies its enterprise-focused patterns
- Mantine uses its modern, customizable approach
- Chakra UI leverages its modular system

### 2. Complex Layout Generation

```
Create a dashboard with sidebar navigation, header with search, and a grid of metric cards
```

This demonstrates how Story UI adapts to each library's layout system.

### 3. Form Generation

```
Build a multi-step registration form with validation
```

Compare how different libraries handle form controls and validation.

## Configuration Options

### Instance Configuration

- `name`: Display name for the instance
- `directory`: Path to the test Storybook project
- `mcpPort`: Port for the MCP server (must be unique)
- `storybookPort`: Port for Storybook (must be unique)
- `color`: ANSI color code for console output
- `enabled`: Set to false to disable an instance

### Settings

- `logFile`: Path to store logs (optional)
- `useNpmLink`: Whether to use npm link (for development)
- `parallelStart`: Start all instances simultaneously (faster)
- `startDelay`: Delay between starting MCP and Storybook (ms)

### Available Colors

The configuration includes these ANSI color codes:
- `\u001b[34m` - Blue
- `\u001b[31m` - Red
- `\u001b[32m` - Green
- `\u001b[33m` - Yellow
- `\u001b[35m` - Magenta
- `\u001b[36m` - Cyan
- `\u001b[37m` - White
- `\u001b[90m` - Gray

## Troubleshooting

### Port Already in Use

If you see "Port X is already in use", either:
1. Kill the process: `lsof -ti:PORT | xargs kill`
2. Change the port in `multi-instance.config.json`

### MCP Connection Issues

Ensure the StoryUI panel in each Storybook is configured with the correct MCP port:
- The panel should show "Connected to MCP server on port X" at the bottom

### Missing Dependencies

If a Storybook fails to start, check that all dependencies are installed:
```bash
cd test-storybooks/your-test
npm install
```

## Tips

1. **Use unique ports**: Each instance needs unique MCP and Storybook ports
2. **Monitor resources**: Running multiple instances can be resource-intensive
3. **Check configs**: Each test project needs its own `story-ui.config.js`
4. **Customize prompts**: Tailor prompts to showcase each library's strengths

## Example Custom Configuration

Here's an example of adding Material-UI to the setup:

```json
{
  "name": "Material-UI",
  "directory": "test-storybooks/mui-test",
  "mcpPort": 4005,
  "storybookPort": 6010,
  "color": "\u001b[34m",
  "enabled": true
}
```

Then create the appropriate `story-ui.config.js`:

```javascript
module.exports = {
  "importPath": "@mui/material",
  "componentPrefix": "",
  "layoutRules": {
    "defaultWrapper": "Box",
    "defaultLayout": "flex",
    "containerComponent": "Container"
  },
  "generatedStoriesPath": "./src/stories/generated",
  "storyPrefix": "Generated/",
  "defaultAuthor": "Story UI AI"
};
```
