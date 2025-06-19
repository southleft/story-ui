# Story UI Scripts

This directory contains scripts for managing Story UI installations, cleanup, and testing workflows.

## Scripts

### `cleanup-story-ui.sh` (Bash)
A comprehensive bash script that removes all Story UI related files and configurations.

**Usage:**
```bash
./scripts/cleanup-story-ui.sh
```

**Platform:** Linux, macOS, Windows (with WSL/Git Bash)

### `cleanup-story-ui.js` (Node.js)
A cross-platform Node.js script that performs the same cleanup operations.

**Usage:**
```bash
node scripts/cleanup-story-ui.js
# or
npm run cleanup
```

**Platform:** Cross-platform (Windows, macOS, Linux)

### `manage-test-projects.sh` (Test Management)
A management script for handling Story UI installations across test projects in `test-storybooks/`.

**Usage:**
```bash
# List all test projects
./scripts/manage-test-projects.sh list

# Setup cleanup scripts in a specific project
./scripts/manage-test-projects.sh setup ant-design-test

# Clean up a specific test project
./scripts/manage-test-projects.sh cleanup ant-design-test

# Setup/cleanup all test projects
./scripts/manage-test-projects.sh setup all
./scripts/manage-test-projects.sh cleanup all
```

**Platform:** Linux, macOS, Windows (with WSL/Git Bash)

## What Gets Cleaned Up

Both scripts remove the following Story UI related files and configurations:

### 📋 Configuration Files
- `story-ui.config.js`
- `story-ui.config.ts`
- `.env` (only if it contains Story UI header - existing .env files are preserved)

### 📁 Generated Stories Directories
- `src/stories/generated/`
- `stories/generated/`
- `.storybook/generated/`
- `src/components/generated/`

### 🎛️ Story UI Components
- `src/stories/StoryUI/`
- `stories/StoryUI/`
- `.storybook/StoryUI/`
- `src/stories/generated/StoryUI/`

### 💾 Cache and Temp Files
- `.story-ui/`
- `node_modules/.story-ui/`

### 📊 Story Tracking Files
- `.story-mappings.json` (in various locations)

### 📝 Git Configuration
- Removes Story UI patterns from `.gitignore`

## Manual Steps

After running the cleanup script, you may need to manually:

1. **Uninstall Story UI package:**
   ```bash
   npm uninstall @tpitre/story-ui story-ui
   ```

2. **Remove Story UI scripts from package.json:**
   - `"story-ui": "story-ui start"`
   - `"storybook-with-ui": "concurrently ..."`

3. **Remove Story UI configuration from package.json:**
   - `"storyUI": { ... }` section

4. **Clean npm/yarn cache (optional):**
   ```bash
   npm cache clean --force
   # or
   yarn cache clean
   ```

## Use Cases

### Cleanup Scripts (`cleanup-story-ui.*`)
Perfect for cleaning up Story UI from any project:

- 🎥 **Demo Preparation** - Clean slate for video recordings
- 🧪 **Testing** - Reset environment between test runs
- 🎯 **Fresh Installation** - Start with a clean project
- 📦 **Package Development** - Test installation scenarios

### Test Management Script (`manage-test-projects.sh`)
Specifically designed for managing the test projects in `test-storybooks/`:

- 🔄 **Batch Operations** - Setup/cleanup multiple test projects at once
- 🧪 **Test Automation** - Integrate into testing workflows
- 📋 **Project Discovery** - List and manage all available test projects
- 🎯 **Targeted Cleanup** - Clean specific test projects without affecting others

## Safety Features

- **Safe Removal** - Only removes files that actually exist
- **Environment Protection** - Only removes .env files created by Story UI (preserves existing ones)
- **Colored Output** - Easy to understand status messages
- **Detailed Logging** - Shows exactly what was removed
- **Manual Review** - Lists remaining files for manual review
- **Non-destructive** - Won't break your project

## Running from NPM Scripts

### Main Repository Scripts

The main Story UI repository includes these npm scripts:

```json
{
  "scripts": {
    "cleanup": "node scripts/cleanup-story-ui.js",
    "cleanup:bash": "./scripts/cleanup-story-ui.sh",
    "test:setup": "./scripts/manage-test-projects.sh setup all",
    "test:cleanup": "./scripts/manage-test-projects.sh cleanup all",
    "test:list": "./scripts/manage-test-projects.sh list"
  }
}
```

**Usage:**
```bash
# Clean up current directory
npm run cleanup

# Manage test projects
npm run test:list
npm run test:cleanup
npm run test:setup
```

### Test Project Scripts

Test projects (after setup) include these npm scripts:

```json
{
  "scripts": {
    "cleanup": "node cleanup-story-ui.js",
    "cleanup:bash": "./cleanup-story-ui.sh"
  }
}
```

**Usage from within test projects:**
```bash
cd test-storybooks/ant-design-test
npm run cleanup
```

## Quick Reference

### From Main Repository

```bash
# List test projects
npm run test:list

# Setup cleanup scripts in all test projects
npm run test:setup

# Clean up all test projects
npm run test:cleanup

# Clean up specific test project
./scripts/manage-test-projects.sh cleanup ant-design-test

# Clean up current directory (main repo)
npm run cleanup
```

### From Test Projects

```bash
cd test-storybooks/ant-design-test

# Clean up this test project
npm run cleanup

# Alternative bash version
npm run cleanup:bash
```

## See Also

- **[TESTING.md](../TESTING.md)** - Complete testing workflows and demo preparation guide
- **[README.md](../README.md)** - Main Story UI documentation
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** - Development and contribution guidelines
