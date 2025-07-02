# Story UI Scripts

This directory contains utility scripts for Story UI development and demos.

## multi-instance.js

A script for running multiple Storybook instances with Story UI simultaneously. Perfect for:
- Cross-design system comparisons
- Testing Story UI with multiple UI libraries
- Demonstrating Story UI's flexibility

### Setup

1. **Copy the example configuration**:
   ```bash
   cp multi-instance.config.example.json multi-instance.config.json
   ```

2. **Customize the configuration** (optional):
   - Enable/disable instances by setting `"enabled": true/false`
   - Add new instances by following the pattern
   - Adjust ports if there are conflicts

3. **Run the script**:
   ```bash
   npm run multi-instance
   ```

### Configuration Structure

```json
{
  "instances": [
    {
      "name": "Display name",
      "directory": "path/to/storybook/project",
      "mcpPort": 4001,         // Must be unique
      "storybookPort": 6006,   // Must be unique
      "color": "\u001b[36m",   // ANSI color code
      "enabled": true          // Enable/disable
    }
  ],
  "settings": {
    "logFile": "~/.story-ui-multi-instance.log",
    "useNpmLink": true,      // For development
    "parallelStart": true,   // Start all at once
    "startDelay": 3000       // Delay between MCP and Storybook
  }
}
```

### Adding New Instances

1. Create a new test Storybook project in `test-storybooks/`
2. Install your UI library
3. Run `npx story-ui init` in the project
4. Add the instance to `multi-instance.config.json`
5. Restart the script

### Available ANSI Colors

- `\u001b[30m` - Black
- `\u001b[31m` - Red
- `\u001b[32m` - Green
- `\u001b[33m` - Yellow
- `\u001b[34m` - Blue
- `\u001b[35m` - Magenta
- `\u001b[36m` - Cyan
- `\u001b[37m` - White
- `\u001b[90m` - Bright Black (Gray)

### Troubleshooting

**Port conflicts**: Kill existing processes or change ports in the config
```bash
lsof -ti:4001 | xargs kill  # Kill process on port 4001
```

**Missing config**: Make sure to copy the example config
```bash
cp multi-instance.config.example.json multi-instance.config.json
```

**Instance not starting**: Check that the directory exists and has Story UI initialized

## setup.sh

Initial setup script for Story UI development environment.

## push.sh

Utility script for git operations.
