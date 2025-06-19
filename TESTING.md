# Testing Story UI

This document explains how to test Story UI installations and use the cleanup scripts for clean testing cycles.

## Test Projects

The `test-storybooks/` directory contains test projects for different design systems:

- **ant-design-test** - Ant Design (antd) components
- **chakra-test** - Chakra UI components
- **custom-design-test** - Custom/generic components

## Quick Testing Workflow

### 1. Clean Up Previous Installation

```bash
# Clean up a specific test project
./scripts/manage-test-projects.sh cleanup ant-design-test

# Or clean up all test projects
npm run test:cleanup
```

### 2. Install Story UI in Test Project

```bash
cd test-storybooks/ant-design-test
npm install @tpitre/story-ui
npx story-ui init
```

### 3. Test the Installation

```bash
npm run storybook-with-ui
# Test generating stories through the UI
```

### 4. Clean Up for Next Test

```bash
# From within the test project
npm run cleanup

# Or from the main repo
./scripts/manage-test-projects.sh cleanup ant-design-test
```

## Available Commands

### From Main Repository

```bash
# List all test projects
npm run test:list

# Setup cleanup scripts in all test projects
npm run test:setup

# Clean up all test projects
npm run test:cleanup

# Manage specific projects
./scripts/manage-test-projects.sh cleanup ant-design-test
./scripts/manage-test-projects.sh setup chakra-test
```

### From Within Test Projects

```bash
# Clean up Story UI installation
npm run cleanup

# Or use bash version
npm run cleanup:bash
```

## What Gets Cleaned Up

The cleanup scripts remove:

✅ **Configuration files**
- `story-ui.config.js`
- `story-ui.config.ts`
- `.env` (only if created by Story UI)

✅ **Generated content**
- `src/stories/generated/` directory
- `src/stories/StoryUI/` component directory
- `.story-mappings.json` tracking files

✅ **Git configuration**
- Story UI patterns from `.gitignore`

✅ **Cache files**
- `.story-ui/` cache directory
- Temporary files

## Safety Features

🛡️ **Environment Protection**
- Only removes `.env` files created by Story UI
- Preserves existing environment variables

🛡️ **Safe Removal**
- Only removes files that actually exist
- Non-destructive - won't break your project

🛡️ **Clear Feedback**
- Colored output showing what was removed
- Lists remaining files for manual review

## Manual Steps After Cleanup

The cleanup scripts will remind you to manually:

1. **Uninstall the package:**
   ```bash
   npm uninstall @tpitre/story-ui
   ```

2. **Remove npm scripts** (optional):
   - `story-ui`
   - `storybook-with-ui`
   - `cleanup` and `cleanup:bash`

## Demo Preparation Workflow

Perfect for preparing clean demo videos:

```bash
# 1. Clean up the test project
./scripts/manage-test-projects.sh cleanup ant-design-test

# 2. Navigate to test project
cd test-storybooks/ant-design-test

# 3. Uninstall Story UI package
npm uninstall @tpitre/story-ui

# 4. Start recording your demo
# 5. Install Story UI fresh
npm install @tpitre/story-ui
npx story-ui init

# 6. Demo the features
npm run storybook-with-ui
```

## Troubleshooting

### "Missing script: cleanup"

If you get this error, the cleanup scripts haven't been set up in the test project:

```bash
# From main repo, setup cleanup scripts
./scripts/manage-test-projects.sh setup ant-design-test

# Or setup all projects
npm run test:setup
```

### "No such file or directory: cleanup-story-ui.sh"

The cleanup script files need to be copied to the test project:

```bash
# Copy scripts to specific project
cp scripts/cleanup-story-ui.* test-storybooks/ant-design-test/
chmod +x test-storybooks/ant-design-test/cleanup-story-ui.sh

# Or use the management script
./scripts/manage-test-projects.sh setup ant-design-test
```

### Environment File Not Removed

This is expected behavior! The cleanup script only removes `.env` files that contain the Story UI header (`# Story UI Configuration`). Existing environment files are preserved for safety.

## Advanced Usage

### Testing Multiple Design Systems

```bash
# Clean up all projects
npm run test:cleanup

# Test Ant Design
cd test-storybooks/ant-design-test
npm install @tpitre/story-ui && npx story-ui init
# ... test features ...
npm run cleanup

# Test Chakra UI
cd ../chakra-test
npm install @tpitre/story-ui && npx story-ui init
# ... test features ...
npm run cleanup
```

### Automated Testing Script

```bash
#!/bin/bash
# Example automated testing script

projects=("ant-design-test" "chakra-test")

for project in "${projects[@]}"; do
    echo "Testing $project..."

    # Clean up
    ./scripts/manage-test-projects.sh cleanup "$project"

    # Install and test
    cd "test-storybooks/$project"
    npm install @tpitre/story-ui
    npx story-ui init --auto-detect

    # Run tests here...

    # Clean up
    npm run cleanup
    cd ../..
done
```

This testing workflow ensures you always have a clean slate for testing Story UI installations and demos!
