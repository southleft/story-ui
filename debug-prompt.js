import { EnhancedComponentDiscovery } from './story-generator/enhancedComponentDiscovery.js';
import { loadUserConfig } from './story-generator/configLoader.js';
import { buildClaudePrompt } from './story-generator/promptGenerator.js';

async function debugPromptGeneration() {
  console.log('🔍 Debugging prompt generation...\n');
  
  const config = loadUserConfig();
  console.log('📝 Config importPath:', config.importPath);
  
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();
  
  console.log(`✅ Discovered ${components.length} total components`);
  
  // Find specific components and check their __componentPath
  const testComponents = ['Card', 'Button', 'Heading'].map(name => 
    components.find(c => c.name === name)
  ).filter(Boolean);
  
  console.log('\n📦 Test components with __componentPath:');
  testComponents.forEach(comp => {
    console.log(`  - ${comp.name}: ${comp.__componentPath || 'NOT SET'}`);
  });
  
  // Generate the prompt and extract the component reference section
  const prompt = await buildClaudePrompt('Test prompt', config, components);
  
  // Extract the "Available components:" section
  const lines = prompt.split('\n');
  const availableIndex = lines.findIndex(line => line.includes('Available components:'));
  
  if (availableIndex !== -1) {
    console.log('\n📋 Component reference section:');
    // Show the next 20 lines after "Available components:"
    const componentSection = lines.slice(availableIndex, availableIndex + 25);
    componentSection.forEach((line, i) => {
      console.log(`${String(i + 1).padStart(2, ' ')}: ${line}`);
    });
  }
  
  console.log('\n🔍 Searching for import path mentions in prompt:');
  const importPathLines = lines.filter(line => 
    line.includes('import from') || 
    line.includes('__componentPath') ||
    line.includes('baseui/')
  );
  
  if (importPathLines.length > 0) {
    importPathLines.forEach(line => console.log('  >', line.trim()));
  } else {
    console.log('  ❌ No import path information found in prompt');
  }
}

debugPromptGeneration().catch(console.error);