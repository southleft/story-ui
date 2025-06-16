# Contributing to Story UI

First off, thank you for considering contributing to Story UI! It's people like you that make Story UI such a great tool.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct: be respectful, inclusive, and constructive in all interactions.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Your environment (OS, Node version, Storybook version)
- Screenshots if applicable

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- A clear and descriptive title
- A detailed description of the proposed functionality
- Why this enhancement would be useful
- Examples of how it would be used

### Pull Requests

1. Fork the repo and create your branch from `main`
2. Run `npm install` to install dependencies
3. Make your changes
4. Run `npm run build` to ensure everything compiles
5. Test your changes thoroughly
6. Update documentation if needed
7. Submit a pull request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/story-ui.git
cd story-ui

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev
```

## Project Structure

```
story-ui/
├── cli/                 # CLI commands
├── mcp-server/         # MCP server implementation
├── story-generator/    # Story generation logic
├── templates/          # Component templates
└── src/                # Source files
```

## Adding Support for New Design Systems

To add support for a new design system:

1. Add detection logic in `story-generator/configLoader.ts`
2. Add configuration template in `cli/setup.ts`
3. Add examples in the README
4. Submit a PR with your changes

## Testing

Before submitting a PR:

1. Test the CLI commands work correctly
2. Test story generation with various prompts
3. Verify the setup process works smoothly
4. Ensure TypeScript compilation succeeds

## Questions?

Feel free to open an issue for any questions about contributing!
