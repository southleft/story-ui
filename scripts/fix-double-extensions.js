#!/usr/bin/env node

/**
 * Script to fix double .stories.stories.tsx extensions in edited stories
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fixDoubleExtensions(directory) {
  if (!fs.existsSync(directory)) {
    console.log(`Directory not found: ${directory}`);
    return;
  }

  const files = fs.readdirSync(directory);
  let fixedCount = 0;

  files.forEach(file => {
    if (file.endsWith('.stories.stories.tsx')) {
      const oldPath = path.join(directory, file);
      const newFileName = file.replace('.stories.stories.tsx', '.stories.tsx');
      const newPath = path.join(directory, newFileName);

      // Check if target file already exists
      if (fs.existsSync(newPath)) {
        console.log(`⚠️  Target file already exists, skipping: ${newFileName}`);
        return;
      }

      // Rename the file
      fs.renameSync(oldPath, newPath);
      console.log(`✅ Fixed: ${file} → ${newFileName}`);
      fixedCount++;
    }
  });

  if (fixedCount > 0) {
    console.log(`\n✨ Fixed ${fixedCount} file(s) with double extensions`);
  } else {
    console.log('✨ No files with double extensions found');
  }
}

// Main execution
const editedStoriesPath = path.join(
  __dirname,
  '..',
  'test-storybooks',
  'mantine-storybook',
  'src',
  'stories',
  'edited'
);

console.log('🔧 Fixing double extensions in edited stories...');
console.log(`📁 Directory: ${editedStoriesPath}\n`);

fixDoubleExtensions(editedStoriesPath);