#!/usr/bin/env node

/**
 * Story UI Cleanup Script (Node.js version)
 * Removes all Story UI installations, configurations, and generated files
 * Cross-platform compatible alternative to the bash script
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Helper function to colorize output
function colorize(text, color) {
  return colors[color] + text + colors.reset;
}

// Function to safely remove files/directories
function safeRemove(targetPath, description) {
  const fullPath = path.resolve(targetPath);

  if (fs.existsSync(fullPath)) {
    console.log(colorize(`🗑️  Removing ${description}:`, 'yellow'), fullPath);
    try {
      if (fs.lstatSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
      console.log(colorize('✅ Removed', 'green'));
    } catch (error) {
      console.log(colorize(`❌ Failed to remove: ${error.message}`, 'red'));
    }
  } else {
    console.log(colorize(`ℹ️  Not found:`, 'blue'), fullPath);
  }
}

// Function to clean .gitignore
function cleanGitignore() {
  const gitignorePath = '.gitignore';

  if (fs.existsSync(gitignorePath)) {
    console.log(colorize('📝 Cleaning .gitignore...', 'yellow'));

    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const lines = content.split('\n');

      // Remove Story UI related patterns
      const cleanedLines = lines.filter(line => {
        const trimmed = line.trim();
        return !trimmed.includes('Story UI') &&
               !trimmed.includes('src/stories/generated') &&
               !trimmed.includes('generated/') &&
               !trimmed.includes('StoryUI/') &&
               !trimmed.includes('story-ui');
      });

      if (cleanedLines.length !== lines.length) {
        fs.writeFileSync(gitignorePath, cleanedLines.join('\n'));
        console.log(colorize('✅ Cleaned .gitignore', 'green'));
      } else {
        console.log(colorize('ℹ️  No Story UI entries found in .gitignore', 'blue'));
      }
    } catch (error) {
      console.log(colorize(`❌ Failed to clean .gitignore: ${error.message}`, 'red'));
    }
  } else {
    console.log(colorize('ℹ️  No .gitignore file found', 'blue'));
  }
}

// Function to check package.json
function checkPackageJson() {
  const packagePath = 'package.json';

  if (fs.existsSync(packagePath)) {
    console.log(colorize('📝 Checking package.json...', 'yellow'));

    try {
      const content = fs.readFileSync(packagePath, 'utf-8');

      // Check for Story UI dependencies
      if (content.includes('"@tpitre/story-ui"') || content.includes('"story-ui"')) {
        console.log(colorize('⚠️  Found Story UI in package.json dependencies.', 'yellow'));
        console.log(colorize('   Run:', 'yellow'), 'npm uninstall @tpitre/story-ui story-ui');
      }

      // Check for Story UI scripts
      if (content.includes('"story-ui"') || content.includes('"storybook-with-ui"')) {
        console.log(colorize('⚠️  Found Story UI scripts in package.json.', 'yellow'));
        console.log(colorize('   You may want to manually remove:', 'yellow'));
        console.log(colorize('   - story-ui script', 'yellow'));
        console.log(colorize('   - storybook-with-ui script', 'yellow'));
      }

      // Check for storyUI config
      if (content.includes('"storyUI"')) {
        console.log(colorize('⚠️  Found Story UI configuration in package.json.', 'yellow'));
        console.log(colorize('   You may want to manually remove the \'storyUI\' section', 'yellow'));
      }
    } catch (error) {
      console.log(colorize(`❌ Failed to read package.json: ${error.message}`, 'red'));
    }
  } else {
    console.log(colorize('ℹ️  No package.json file found', 'blue'));
  }
}

// Function to find remaining Story UI files
function findRemainingFiles() {
  console.log(colorize('🔍 Scanning for remaining Story UI files...', 'blue'));

  const excludeDirs = ['node_modules', '.git', 'dist'];
  const foundFiles = [];

  function searchDir(dirPath, maxDepth = 3) {
    if (maxDepth <= 0) return;

    try {
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        if (excludeDirs.includes(item)) continue;

        const fullPath = path.join(dirPath, item);
        const stat = fs.lstatSync(fullPath);

        if (item.toLowerCase().includes('story-ui') || item.toLowerCase().includes('storyui')) {
          foundFiles.push(path.relative('.', fullPath));
        }

        if (stat.isDirectory() && foundFiles.length < 10) {
          searchDir(fullPath, maxDepth - 1);
        }
      }
    } catch (error) {
      // Ignore permission errors
    }
  }

  searchDir('.');

  if (foundFiles.length > 0) {
    console.log(colorize('⚠️  Found additional files that may be related to Story UI:', 'yellow'));
    foundFiles.forEach(file => {
      console.log(colorize(`   - ${file}`, 'yellow'));
    });
    console.log(colorize('   Review these files manually if needed.', 'yellow'));
  } else {
    console.log(colorize('✅ No additional Story UI files found', 'green'));
  }
}

// Main cleanup function
function cleanup() {
  console.log('🧹 Story UI Cleanup Script (Node.js)');
  console.log('=====================================');
  console.log('');

  console.log(colorize('🔍 Scanning for Story UI files...', 'blue'));
  console.log('');

  // 1. Remove configuration files
  console.log(colorize('📋 Configuration Files:', 'blue'));
  safeRemove('story-ui.config.js', 'Story UI config file');
  safeRemove('story-ui.config.ts', 'Story UI TypeScript config file');

  // Only remove .env if it was created by Story UI
  const envPath = '.env';
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      if (envContent.includes('# Story UI Configuration')) {
        console.log(colorize('🗑️  Removing Story UI .env file:', 'yellow'), path.resolve(envPath));
        fs.unlinkSync(envPath);
        console.log(colorize('✅ Removed', 'green'));
      } else {
        console.log(colorize('ℹ️  .env file exists but was not created by Story UI (keeping it safe)', 'blue'));
      }
    } catch (error) {
      console.log(colorize('ℹ️  Could not read .env file (keeping it safe)', 'blue'));
    }
  } else {
    console.log(colorize('ℹ️  Not found:', 'blue'), path.resolve(envPath));
  }
  console.log('');

  // 2. Remove generated stories directories
  console.log(colorize('📁 Generated Stories Directories:', 'blue'));
  safeRemove('src/stories/generated', 'Generated stories (src/stories/generated)');
  safeRemove('stories/generated', 'Generated stories (stories/generated)');
  safeRemove('.storybook/generated', 'Generated stories (.storybook/generated)');
  safeRemove('src/components/generated', 'Generated stories (src/components/generated)');
  console.log('');

  // 3. Remove StoryUI component directories
  console.log(colorize('🎛️  Story UI Components:', 'blue'));
  safeRemove('src/stories/StoryUI', 'Story UI Panel component (src/stories/StoryUI)');
  safeRemove('stories/StoryUI', 'Story UI Panel component (stories/StoryUI)');
  safeRemove('.storybook/StoryUI', 'Story UI Panel component (.storybook/StoryUI)');
  safeRemove('src/stories/generated/StoryUI', 'Story UI Panel component (src/stories/generated/StoryUI)');
  console.log('');

  // 4. Remove cache and temp files
  console.log(colorize('💾 Cache and Temp Files:', 'blue'));
  safeRemove('.story-ui', 'Story UI cache directory');
  safeRemove('node_modules/.story-ui', 'Story UI node modules cache');
  console.log('');

  // 5. Remove story tracking files
  console.log(colorize('📊 Story Tracking Files:', 'blue'));
  safeRemove('src/stories/.story-mappings.json', 'Story mappings file');
  safeRemove('stories/.story-mappings.json', 'Story mappings file');
  safeRemove('.storybook/.story-mappings.json', 'Story mappings file');
  console.log('');

  // 6. Clean .gitignore
  console.log(colorize('📝 Git Configuration:', 'blue'));
  cleanGitignore();
  console.log('');

  // 7. Check package.json
  console.log(colorize('📦 Package Configuration:', 'blue'));
  checkPackageJson();
  console.log('');

  // 8. Find remaining files
  findRemainingFiles();
  console.log('');

  // Final summary
  console.log(colorize('🎉 Story UI cleanup completed!', 'green'));
  console.log('');
  console.log(colorize('📋 Manual steps (if applicable):', 'blue'));
  console.log(colorize('1. Uninstall Story UI package:', 'yellow'));
  console.log('   npm uninstall @tpitre/story-ui story-ui');
  console.log('');
  console.log(colorize('2. Remove Story UI scripts from package.json:', 'yellow'));
  console.log('   - "story-ui": "story-ui start"');
  console.log('   - "storybook-with-ui": "concurrently ..."');
  console.log('');
  console.log(colorize('3. Remove Story UI configuration from package.json:', 'yellow'));
  console.log('   - "storyUI": { ... } section');
  console.log('');
  console.log(colorize('4. Clean npm/yarn cache (optional):', 'yellow'));
  console.log('   npm cache clean --force');
  console.log('   # or');
  console.log('   yarn cache clean');
  console.log('');
  console.log(colorize('✨ Your project is now clean and ready for a fresh Story UI installation!', 'green'));
}

// Run the cleanup
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanup();
}

export { cleanup };
