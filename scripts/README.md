# Story UI Cleanup Scripts

This directory contains scripts to clean up Story UI installations for testing and demo purposes.

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

## What Gets Cleaned Up

Both scripts remove the following Story UI related files and configurations:

### 📋 Configuration Files
- `story-ui.config.js`
- `story-ui.config.ts`
- `.env` (if created by Story UI)

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

These scripts are particularly useful for:

- 🎥 **Demo Preparation** - Clean slate for video recordings
- 🧪 **Testing** - Reset environment between test runs
- 🎯 **Fresh Installation** - Start with a clean project
- 📦 **Package Development** - Test installation scenarios

## Safety Features

- **Safe Removal** - Only removes files that actually exist
- **Colored Output** - Easy to understand status messages
- **Detailed Logging** - Shows exactly what was removed
- **Manual Review** - Lists remaining files for manual review
- **Non-destructive** - Won't break your project

## Running from NPM Scripts

The Node.js script can be run via npm scripts added to your package.json:

```json
{
  "scripts": {
    "cleanup": "node scripts/cleanup-story-ui.js",
    "cleanup:bash": "./scripts/cleanup-story-ui.sh"
  }
}
```

Then run with:
```bash
npm run cleanup
```
