#!/usr/bin/env node

/**
 * Script to detect and fix incorrect style prop serialization in generated story files.
 * This addresses the issue where style props are incorrectly serialized as strings
 * instead of JSX objects, causing React errors.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Define the root directory to search (relative to script location)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const STORIES_DIRS = [
  path.join(PROJECT_ROOT, 'test-storybooks/mantine-storybook/src/stories'),
  // Add other storybook directories here as needed
];

// Pattern to match incorrect style props: style="{ ... }"
const INCORRECT_STYLE_PATTERN = /style="(\{[^}]+\})"/g;

// Function to fix a single line
function fixStyleProp(line) {
  return line.replace(INCORRECT_STYLE_PATTERN, (match, styleContent) => {
    // Convert string format to JSX object format
    return `style={${styleContent}}`;
  });
}

// Function to process a single file
function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let hasChanges = false;
    
    const fixedLines = lines.map((line, index) => {
      const fixedLine = fixStyleProp(line);
      if (fixedLine !== line) {
        console.log(`📝 Fixed line ${index + 1} in ${path.relative(PROJECT_ROOT, filePath)}`);
        console.log(`   Before: ${line.trim()}`);
        console.log(`   After:  ${fixedLine.trim()}`);
        hasChanges = true;
      }
      return fixedLine;
    });
    
    if (hasChanges) {
      fs.writeFileSync(filePath, fixedLines.join('\n'), 'utf-8');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error processing file ${filePath}:`, error.message);
    return false;
  }
}

// Function to scan a directory recursively
function scanDirectory(dirPath, processedFiles = new Set()) {
  const files = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        files.push(...scanDirectory(fullPath, processedFiles));
      } else if (entry.isFile() && entry.name.endsWith('.tsx') && !processedFiles.has(fullPath)) {
        files.push(fullPath);
        processedFiles.add(fullPath);
      }
    }
  } catch (error) {
    console.warn(`⚠️  Cannot access directory ${dirPath}:`, error.message);
  }
  
  return files;
}

// Main function
function main() {
  console.log('🔍 Scanning for incorrect style prop serialization...\n');
  
  let totalFiles = 0;
  let fixedFiles = 0;
  
  for (const storiesDir of STORIES_DIRS) {
    console.log(`📁 Scanning directory: ${path.relative(PROJECT_ROOT, storiesDir)}`);
    
    if (!fs.existsSync(storiesDir)) {
      console.log(`   Directory not found, skipping.\n`);
      continue;
    }
    
    const files = scanDirectory(storiesDir);
    console.log(`   Found ${files.length} TypeScript files\n`);
    
    for (const filePath of files) {
      totalFiles++;
      const wasFixed = processFile(filePath);
      if (wasFixed) {
        fixedFiles++;
      }
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`   Total files scanned: ${totalFiles}`);
  console.log(`   Files fixed: ${fixedFiles}`);
  
  if (fixedFiles > 0) {
    console.log('\n✅ Style prop serialization issues have been fixed!');
    console.log('   The affected files now use correct JSX object syntax for style props.');
  } else {
    console.log('\n✅ No style prop serialization issues found.');
  }
  
  return fixedFiles;
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixedCount = main();
  process.exit(fixedCount > 0 ? 0 : 0); // Always exit success
}

export { main as fixStyleProps };