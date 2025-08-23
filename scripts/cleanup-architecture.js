#!/usr/bin/env node

/**
 * Cleanup Script for Story UI Architecture Redesign
 * 
 * This script:
 * 1. Moves all files from /generated/edited/ back to /generated/
 * 2. Removes duplicate "generated-" prefixes
 * 3. Fixes import paths in moved files
 * 4. Removes empty edited directories
 * 5. Creates .backup files for originals if needed
 */

import fs from 'fs';
import path from 'path';

function findGeneratedDirectories(rootDir) {
  const generatedDirs = [];
  
  function searchDir(currentDir) {
    try {
      const items = fs.readdirSync(currentDir);
      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          if (item === 'generated') {
            generatedDirs.push(fullPath);
          } else if (item !== 'node_modules' && item !== '.git') {
            searchDir(fullPath); // Recursive search
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  searchDir(rootDir);
  return generatedDirs;
}

function cleanupGeneratedDirectory(generatedDir) {
  const editedDir = path.join(generatedDir, 'edited');
  
  if (!fs.existsSync(editedDir)) {
    console.log(`ℹ️  No edited directory found in ${generatedDir}`);
    return;
  }
  
  console.log(`🔄 Processing: ${editedDir}`);
  
  // Get all .stories.tsx files in edited directory
  const editedFiles = fs.readdirSync(editedDir).filter(f => f.endsWith('.stories.tsx'));
  
  for (const fileName of editedFiles) {
    const sourcePath = path.join(editedDir, fileName);
    
    // Clean up the filename by removing duplicate "generated-" prefixes
    let cleanFileName = fileName;
    while (cleanFileName.startsWith('generated-generated-')) {
      cleanFileName = cleanFileName.replace(/^generated-/, '');
    }
    
    const targetPath = path.join(generatedDir, cleanFileName);
    
    // Read and fix the content
    const content = fs.readFileSync(sourcePath, 'utf8');
    
    // Fix the decorator import path (from ../../ back to ../)
    const fixedContent = content.replace(
      /from ['"]\.\.\/\.\.\/decorators\/VisualBuilderDecorator['"]/g,
      "from '../decorators/VisualBuilderDecorator'"
    );
    
    // Remove "(Edited)" suffix from titles
    const finalContent = fixedContent.replace(
      /title: ['"]Generated\/(.+?) \(Edited\)['"]/g,
      "title: 'Generated/$1'"
    );
    
    // Create backup if target file exists and is different
    if (fs.existsSync(targetPath)) {
      const existingContent = fs.readFileSync(targetPath, 'utf8');
      if (existingContent !== finalContent) {
        const backupPath = targetPath.replace('.stories.tsx', '.backup.stories.tsx');
        fs.copyFileSync(targetPath, backupPath);
        console.log(`  📦 Created backup: ${path.basename(backupPath)}`);
      }
    }
    
    // Write the cleaned file
    fs.writeFileSync(targetPath, finalContent, 'utf8');
    console.log(`  ✅ Moved and cleaned: ${fileName} → ${cleanFileName}`);
    
    // Remove the original edited file
    fs.unlinkSync(sourcePath);
  }
  
  // Remove the empty edited directory
  try {
    fs.rmdirSync(editedDir);
    console.log(`  🗑️  Removed empty edited directory`);
  } catch (error) {
    console.log(`  ⚠️  Could not remove edited directory: ${error.message}`);
  }
}

function main() {
  const rootDir = process.cwd();
  console.log(`🚀 Starting architecture cleanup from: ${rootDir}\n`);
  
  // Find all generated directories
  const generatedDirs = findGeneratedDirectories(rootDir);
  
  if (generatedDirs.length === 0) {
    console.log('❌ No generated directories found');
    return;
  }
  
  console.log(`📁 Found ${generatedDirs.length} generated directories:`);
  generatedDirs.forEach(dir => console.log(`   ${dir}`));
  console.log();
  
  // Process each generated directory
  for (const genDir of generatedDirs) {
    cleanupGeneratedDirectory(genDir);
    console.log();
  }
  
  console.log('🎉 Architecture cleanup completed!');
  console.log('\nNext steps:');
  console.log('1. Test your stories in Storybook');
  console.log('2. Delete .backup files once you\'re confident');
  console.log('3. The Visual Builder now saves directly to the main directory');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { cleanupGeneratedDirectory, findGeneratedDirectories };