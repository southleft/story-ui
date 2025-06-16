# Commit Convention

This project uses [Semantic Release](https://semantic-release.gitbook.io/semantic-release/) for automated versioning and releases. To ensure proper version bumps, please follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types

- **feat**: A new feature (triggers MINOR version bump)
- **fix**: A bug fix (triggers PATCH version bump)
- **docs**: Documentation only changes (no version bump)
- **style**: Changes that do not affect the meaning of the code (no version bump)
- **refactor**: A code change that neither fixes a bug nor adds a feature (no version bump)
- **perf**: A code change that improves performance (triggers PATCH version bump)
- **test**: Adding missing tests or correcting existing tests (no version bump)
- **chore**: Changes to the build process or auxiliary tools (no version bump)

## Breaking Changes

To trigger a MAJOR version bump, add `BREAKING CHANGE:` in the commit body or footer, or append `!` after the type/scope.

### Examples:

```bash
# Feature (Minor version bump: 1.0.0 → 1.1.0)
git commit -m "feat: add support for custom themes"

# Bug fix (Patch version bump: 1.0.0 → 1.0.1)
git commit -m "fix: resolve memory leak in story generation"

# Breaking change (Major version bump: 1.0.0 → 2.0.0)
git commit -m "feat!: change API endpoint structure"

# Breaking change with body
git commit -m "feat: redesign configuration system

BREAKING CHANGE: Configuration file format has changed from JSON to JavaScript module"

# With scope
git commit -m "fix(cli): correct path resolution on Windows"

# No version bump
git commit -m "docs: update installation instructions"
git commit -m "chore: update dependencies"
```

## Scope Examples

- **cli**: Changes to CLI commands
- **mcp**: MCP server changes
- **ui**: Story UI panel changes
- **generator**: Story generation logic
- **config**: Configuration changes

## Tips

1. Keep the subject line under 50 characters
2. Use the imperative mood ("add" not "added")
3. Don't end the subject line with a period
4. Separate subject from body with a blank line
5. Use the body to explain what and why, not how

## Automated Releases

When you push to the `main` branch:
1. GitHub Actions runs semantic-release
2. It analyzes commit messages since the last release
3. Determines the version bump type (major/minor/patch)
4. Updates package.json version
5. Generates/updates CHANGELOG.md
6. Creates a GitHub release
7. Publishes to npm
8. Commits the changes back to the repository

All of this happens automatically based on your commit messages!
