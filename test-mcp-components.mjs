#!/usr/bin/env node

// Test the list-components functionality directly
import { execSync } from 'child_process';

console.log('Testing MCP list-components tool...');

// Set the environment variable for working directory
process.env.STORY_UI_CWD = '/Users/tjpitre/Sites/story-ui/test-storybooks/ant-storybook';

// Import the modules after setting environment
const { loadUserConfig } = await import('./dist/story-generator/configLoader.js');
const { EnhancedComponentDiscovery } = await import('./dist/story-generator/enhancedComponentDiscovery.js');

console.log('Testing component discovery in correct working directory...');

// Change to the working directory (like the MCP server does)
process.chdir(process.env.STORY_UI_CWD);

const config = loadUserConfig();
console.log('Config loaded from:', config.generatedStoriesPath ? 'correct path' : 'default');
console.log('Import path:', config.importPath);

const discovery = new EnhancedComponentDiscovery(config);
const components = await discovery.discoverAll();

console.log(`Found ${components.length} components!`);

if (components.length > 0) {
  console.log('First 10 components:');
  components.slice(0, 10).forEach(comp => {
    console.log(`  - ${comp.name} (${comp.category})`);
  });
} else {
  console.log('No components found - there may still be an issue');
}