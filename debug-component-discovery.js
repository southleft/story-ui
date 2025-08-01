#!/usr/bin/env node

// Set working directory to the test storybook
process.chdir('/Users/tjpitre/Sites/story-ui/test-storybooks/ant-storybook');

import { loadUserConfig } from './story-generator/configLoader.ts';
import { EnhancedComponentDiscovery } from './story-generator/enhancedComponentDiscovery.ts';

async function testComponentDiscovery() {
  console.log('🔍 Testing component discovery in ant-storybook...');
  console.log('Current working directory:', process.cwd());
  
  try {
    // Load configuration
    console.log('\n📋 Loading configuration...');
    const config = loadUserConfig();
    console.log('Config:', JSON.stringify(config, null, 2));
    
    // Test enhanced component discovery
    console.log('\n🔍 Starting enhanced component discovery...');
    const discovery = new EnhancedComponentDiscovery(config);
    const components = await discovery.discoverAll();
    
    console.log(`\n✅ Discovery completed! Found ${components.length} components:`);
    for (const component of components) {
      console.log(`  - ${component.name} (${component.source.type}:${component.source.path})`);
    }
    
    if (components.length === 0) {
      console.log('\n❌ No components found! Debugging...');
      
      // Check if antd package exists
      const fs = await import('fs');
      const path = await import('path');
      
      const antdPath = path.join(process.cwd(), 'node_modules/antd');
      console.log('antd package exists?', fs.existsSync(antdPath));
      
      if (fs.existsSync(antdPath)) {
        const packageJsonPath = path.join(antdPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          console.log('antd version:', packageJson.version);
          console.log('antd main entry:', packageJson.main);
          console.log('antd exports:', packageJson.exports ? 'present' : 'not present');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error during discovery:', error);
  }
}

testComponentDiscovery();