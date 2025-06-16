# Contributing to Story UI

First off, thank you for considering contributing to Story UI! It's people like you that make Story UI such a great tool.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct: be respectful, inclusive, and constructive in all interactions.

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) to automate our release process. All commit messages must follow this format:

```
<type>(<scope>): <subject>
```

### Using Commitizen (Recommended)

The easiest way to create properly formatted commits is to use our interactive commit tool:

```bash
npm run commit
# or
git cz
```

This will guide you through creating a properly formatted commit message.

### Manual Commit Format

If you prefer to write commits manually, follow this format:

```bash
# Examples
git commit -m "feat(cli): add new init command options"
git commit -m "fix(mcp): resolve memory leak in story generation"
git commit -m "docs: update README with new examples"
```

#### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only changes
- `style`: Code style changes (formatting, missing semicolons, etc.)
- `refactor`: Code changes that neither fix bugs nor add features
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Changes to build process or auxiliary tools
- `ci`: Changes to CI configuration files and scripts

#### Scopes
- `cli`: CLI commands
- `mcp`: MCP server
- `ui`: Story UI panel
- `generator`: Story generation logic
- `config`: Configuration
- `ci`: CI/CD pipeline
- `deps`: Dependencies
- `docs`: Documentation

### Commit Validation

All commits are automatically validated by commitlint. If your commit message doesn't follow the convention, it will be rejected with a helpful error message.

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
7. Create commits using `npm run commit`
8. Submit a pull request

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

# Create a commit
npm run commit
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
5. Make sure all commits follow the conventional format

## Release Process

Releases are automated using semantic-release. When you merge a PR to `main`:

1. Commits are analyzed to determine the version bump
2. Version is updated in package.json
3. CHANGELOG.md is updated
4. A GitHub release is created
5. The package is published to npm

Your commit messages directly control the versioning:
- `fix:` triggers a patch release (1.0.1 → 1.0.2)
- `feat:` triggers a minor release (1.0.1 → 1.1.0)
- `feat!:` or `BREAKING CHANGE:` triggers a major release (1.0.1 → 2.0.0)

## Questions?

Feel free to open an issue for any questions about contributing!
