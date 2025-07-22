import { EnhancedComponentDiscovery } from './story-generator/enhancedComponentDiscovery.js';
import { loadUserConfig } from './story-generator/configLoader.js';

async function testComponentPath() {
  console.log('🧪 Testing __componentPath preservation...');
  
  const config = loadUserConfig();
  console.log(`📝 Using config with importPath: ${config.importPath}`);
  
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();
  
  console.log(`✅ Discovered ${components.length} total components`);
  
  // Find components with __componentPath
  const componentsWithPath = components.filter(c => c.__componentPath);
  console.log(`📍 Components with __componentPath: ${componentsWithPath.length}`);
  
  if (componentsWithPath.length > 0) {
    console.log('\n📦 Sample components with paths:');
    componentsWithPath.slice(0, 5).forEach(c => {
      console.log(`  - ${c.name} → ${c.__componentPath}`);
    });
    
    // Test the prompt generation part
    console.log('\n🔧 Testing import generation...');
    const sampleComponentNames = componentsWithPath.slice(0, 3).map(c => c.name);
    console.log(`Testing with components: ${sampleComponentNames.join(', ')}`);
    
    // Simulate what generateImportStatements does
    const importMap = new Map();
    for (const componentName of sampleComponentNames) {
      const component = components.find(c => c.name === componentName);
      if (component && component.__componentPath) {
        console.log(`  ✅ ${componentName} has __componentPath: ${component.__componentPath}`);
        if (!importMap.has(component.__componentPath)) {
          importMap.set(component.__componentPath, []);
        }
        importMap.get(component.__componentPath).push(componentName);
      } else {
        console.log(`  ❌ ${componentName} missing __componentPath, falling back to main import`);
        if (!importMap.has(config.importPath)) {
          importMap.set(config.importPath, []);
        }
        importMap.get(config.importPath).push(componentName);
      }
    }
    
    console.log('\n📜 Generated import statements:');
    for (const [importPath, componentNames] of importMap) {
      console.log(`import { ${componentNames.join(', ')} } from '${importPath}';`);
    }
  } else {
    console.log('❌ No components have __componentPath set');
  }
}

testComponentPath().catch(console.error);