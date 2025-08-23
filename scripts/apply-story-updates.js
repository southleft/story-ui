#!/usr/bin/env node

/**
 * Script to apply Visual Builder story updates from localStorage to actual files
 * This script reads the story updates from localStorage and writes them to the files
 * 
 * Note: In production, this would be handled by a backend API
 * For development, this script can be run manually or integrated into the build process
 */

const fs = require('fs');
const path = require('path');

// Read updates from a JSON file (exported from browser localStorage)
const updatesFile = process.argv[2];

if (!updatesFile) {
  console.log('Usage: node apply-story-updates.js <updates.json>');
  console.log('\nTo export updates from browser console:');
  console.log('copy(JSON.stringify({updates: JSON.parse(localStorage.getItem("story-updates") || "[]")}))');
  process.exit(1);
}

try {
  const data = JSON.parse(fs.readFileSync(updatesFile, 'utf8'));
  const updates = data.updates || [];
  
  if (updates.length === 0) {
    console.log('No updates found in the file');
    process.exit(0);
  }
  
  console.log(`Found ${updates.length} story update(s) to apply\n`);
  
  updates.forEach((update, index) => {
    console.log(`[${index + 1}/${updates.length}] Processing: ${update.storyName}`);
    console.log(`  File: ${update.filePath}`);
    console.log(`  Timestamp: ${new Date(update.timestamp).toLocaleString()}`);
    
    // Construct the full file path
    // Adjust this based on your project structure
    const fullPath = path.join(
      __dirname,
      '..',
      'test-storybooks',
      'mantine-storybook',
      'src',
      'stories',
      'generated',
      update.filePath.includes('.stories.tsx') ? update.filePath : `${update.filePath}.stories.tsx`
    );
    
    console.log(`  Full path: ${fullPath}`);
    
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`  Created directory: ${dir}`);
      }
      
      // Write the updated content
      fs.writeFileSync(fullPath, update.content, 'utf8');
      console.log(`  ✅ Successfully updated story file\n`);
    } catch (error) {
      console.error(`  ❌ Failed to write file: ${error.message}\n`);
    }
  });
  
  console.log('Done! Refresh Storybook to see the changes.');
  
} catch (error) {
  console.error('Error reading updates file:', error.message);
  process.exit(1);
}