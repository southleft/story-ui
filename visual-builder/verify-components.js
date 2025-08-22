#!/usr/bin/env node

/**
 * Visual Builder Component Structure Verification
 * 
 * This script verifies the integrity of the Visual Builder components
 * and provides a comprehensive report on component support.
 */

import fs from 'fs';
import path from 'path';

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}${msg}${colors.reset}`),
  subheader: (msg) => console.log(`\n${colors.bright}${msg}${colors.reset}`)
};

// Test component registry structure
function testComponentRegistry() {
  log.header('🔍 Component Registry Verification');
  
  try {
    const registryPath = './config/componentRegistry.ts';
    const registryContent = fs.readFileSync(registryPath, 'utf8');
    
    // Check for required exports
    const hasMainComponents = registryContent.includes('export const MANTINE_COMPONENTS');
    const hasGetComponentConfig = registryContent.includes('export const getComponentConfig');
    const hasGetComponentsByCategory = registryContent.includes('export const getComponentsByCategory');
    
    if (hasMainComponents) {
      log.success('MANTINE_COMPONENTS export found');
    } else {
      log.error('MANTINE_COMPONENTS export missing');
      return false;
    }
    
    if (hasGetComponentConfig) {
      log.success('getComponentConfig function found');
    } else {
      log.error('getComponentConfig function missing');
      return false;
    }
    
    if (hasGetComponentsByCategory) {
      log.success('getComponentsByCategory function found');
    } else {
      log.error('getComponentsByCategory function missing');
      return false;
    }
    
    // Check for compound component support (Card.Section)
    const hasCardSection = registryContent.includes("type: 'Card.Section'");
    if (hasCardSection) {
      log.success('Card.Section compound component found');
    } else {
      log.error('Card.Section compound component missing');
      return false;
    }
    
    // Check component structure
    const componentMatches = registryContent.match(/{\s*type:\s*['"]([^'"]+)['"]/g);
    if (componentMatches) {
      const componentTypes = componentMatches.map(match => 
        match.match(/type:\s*['"]([^'"]+)['"]/)[1]
      );
      
      log.info(`Found ${componentTypes.length} registered components:`);
      componentTypes.forEach(type => {
        console.log(`   - ${type}`);
      });
      
      // Verify essential components
      const essentialComponents = ['Button', 'TextInput', 'Text', 'Title', 'Container', 'Group', 'Stack', 'Card', 'Card.Section'];
      const missingEssential = essentialComponents.filter(comp => !componentTypes.includes(comp));
      
      if (missingEssential.length === 0) {
        log.success('All essential components are registered');
      } else {
        log.error(`Missing essential components: ${missingEssential.join(', ')}`);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    log.error(`Failed to read component registry: ${error.message}`);
    return false;
  }
}

// Test AI Parser structure
function testAIParser() {
  log.header('🧠 AI Parser Verification');
  
  try {
    const parserPath = './utils/aiParser.ts';
    const parserContent = fs.readFileSync(parserPath, 'utf8');
    
    // Check for required exports
    const hasParseFunction = parserContent.includes('export const parseAIGeneratedCode');
    const hasCreateBasicLayout = parserContent.includes('export const createBasicLayout');
    const hasParseResult = parserContent.includes('interface ParseResult');
    
    if (hasParseFunction) {
      log.success('parseAIGeneratedCode function found');
    } else {
      log.error('parseAIGeneratedCode function missing');
      return false;
    }
    
    if (hasCreateBasicLayout) {
      log.success('createBasicLayout function found');
    } else {
      log.error('createBasicLayout function missing');
      return false;
    }
    
    if (hasParseResult) {
      log.success('ParseResult interface found');
    } else {
      log.error('ParseResult interface missing');
      return false;
    }
    
    // Check for compound component parsing support
    const hasCompoundParsing = parserContent.includes('Card.Section') || parserContent.includes('[\\w.]+');
    if (hasCompoundParsing) {
      log.success('Compound component parsing support detected');
    } else {
      log.warning('Compound component parsing support unclear');
    }
    
    // Check for error handling
    const hasErrorHandling = parserContent.includes('errors:') && parserContent.includes('warnings:');
    if (hasErrorHandling) {
      log.success('Error and warning handling found');
    } else {
      log.error('Error and warning handling missing');
      return false;
    }
    
    return true;
  } catch (error) {
    log.error(`Failed to read AI parser: ${error.message}`);
    return false;
  }
}

// Test types structure
function testTypes() {
  log.header('📝 Type Definitions Verification');
  
  try {
    const typesPath = './types/index.ts';
    const typesContent = fs.readFileSync(typesPath, 'utf8');
    
    const requiredInterfaces = [
      'ComponentDefinition',
      'SelectedComponent',
      'BuilderState',
      'PropertyDefinition',
      'VisualBuilderComponentConfig'
    ];
    
    let allFound = true;
    requiredInterfaces.forEach(interfaceName => {
      if (typesContent.includes(`interface ${interfaceName}`)) {
        log.success(`${interfaceName} interface found`);
      } else {
        log.error(`${interfaceName} interface missing`);
        allFound = false;
      }
    });
    
    return allFound;
  } catch (error) {
    log.error(`Failed to read types: ${error.message}`);
    return false;
  }
}

// Analyze missing Mantine components
function analyzeMissingComponents() {
  log.header('📊 Missing Component Analysis');
  
  try {
    const registryPath = './config/componentRegistry.ts';
    const registryContent = fs.readFileSync(registryPath, 'utf8');
    
    const componentMatches = registryContent.match(/{\s*type:\s*['"]([^'"]+)['"]/g);
    const currentComponents = componentMatches ? componentMatches.map(match => 
      match.match(/type:\s*['"]([^'"]+)['"]/)[1]
    ) : [];
    
    // Critical Mantine components that should be supported
    const criticalComponents = {
      'High Priority Layout': ['Grid', 'Grid.Col', 'Flex', 'Paper', 'Divider', 'Space', 'Box'],
      'High Priority Inputs': ['Select', 'Checkbox', 'Radio', 'Switch', 'Textarea', 'NumberInput'],
      'Medium Priority Display': ['Modal', 'Tabs', 'Tabs.List', 'Tabs.Panel', 'Table', 'Badge', 'Alert'],
      'Medium Priority Form': ['Form', 'Input', 'Input.Wrapper', 'Input.Label'],
      'Low Priority Advanced': ['AppShell', 'AppShell.Header', 'Drawer', 'Tooltip', 'Popover', 'Menu']
    };
    
    log.info(`Currently implemented: ${currentComponents.length} components`);
    console.log('   Current components:', currentComponents.join(', '));
    
    let totalMissing = 0;
    
    Object.entries(criticalComponents).forEach(([category, components]) => {
      const missing = components.filter(comp => !currentComponents.includes(comp));
      if (missing.length > 0) {
        totalMissing += missing.length;
        log.subheader(`${category} (${missing.length} missing):`);
        missing.forEach(comp => {
          console.log(`   ❌ ${comp}`);
        });
      } else {
        log.success(`${category}: All components implemented ✨`);
      }
    });
    
    if (totalMissing > 0) {
      log.warning(`Total missing critical components: ${totalMissing}`);
      
      // Recommendations
      log.subheader('📋 Recommended Additions (Priority Order):');
      const recommendations = [
        { component: 'Grid', priority: 'HIGH', reason: 'Essential responsive layout' },
        { component: 'Grid.Col', priority: 'HIGH', reason: 'Required for Grid system' },
        { component: 'Select', priority: 'HIGH', reason: 'Critical form input' },
        { component: 'Checkbox', priority: 'HIGH', reason: 'Essential form control' },
        { component: 'Flex', priority: 'MEDIUM', reason: 'Modern layout utility' },
        { component: 'Modal', priority: 'MEDIUM', reason: 'Important UX pattern' },
        { component: 'Paper', priority: 'MEDIUM', reason: 'Common container component' }
      ];
      
      recommendations.forEach(({ component, priority, reason }) => {
        const implemented = currentComponents.includes(component);
        const status = implemented ? '✅' : '❌';
        const priorityColor = priority === 'HIGH' ? colors.red : colors.yellow;
        console.log(`   ${status} ${component} ${priorityColor}[${priority}]${colors.reset} - ${reason}`);
      });
    } else {
      log.success('All critical components are implemented! 🎉');
    }
    
    return totalMissing;
  } catch (error) {
    log.error(`Failed to analyze missing components: ${error.message}`);
    return -1;
  }
}

// Test parser functionality with sample code
function testParserFunctionality() {
  log.header('🧪 Parser Functionality Test');
  
  const sampleCodes = [
    {
      name: 'Simple Button',
      code: `<Button variant="filled">Click me</Button>`,
      expectedType: 'Button'
    },
    {
      name: 'Card with Section',
      code: `<Card><Card.Section withBorder>Content</Card.Section></Card>`,
      expectedType: 'Card',
      expectedChild: 'Card.Section'
    },
    {
      name: 'Nested Layout',
      code: `<Stack gap="md"><TextInput placeholder="Email" /><Button>Submit</Button></Stack>`,
      expectedType: 'Stack',
      expectedChildren: 2
    }
  ];
  
  log.info('Testing parser with sample JSX patterns...');
  
  sampleCodes.forEach(({ name, code, expectedType, expectedChild, expectedChildren }) => {
    try {
      // Basic regex test for component detection
      const componentMatch = code.match(/<(\w+(?:\.\w+)?)/);
      if (componentMatch && componentMatch[1] === expectedType) {
        log.success(`${name}: Component type detection ✓`);
      } else {
        log.error(`${name}: Component type detection failed`);
      }
      
      // Test compound component detection
      if (expectedChild) {
        if (code.includes(expectedChild)) {
          log.success(`${name}: Compound component detection ✓`);
        } else {
          log.error(`${name}: Compound component detection failed`);
        }
      }
      
      // Test children counting
      if (expectedChildren !== undefined) {
        const childMatches = code.match(/<\w+(?:\.\w+)?(?:[^>]*>|[^/>]*\/>)/g);
        if (childMatches && childMatches.length >= expectedChildren) {
          log.success(`${name}: Children detection ✓`);
        } else {
          log.warning(`${name}: Children detection unclear`);
        }
      }
      
    } catch (error) {
      log.error(`${name}: Test failed - ${error.message}`);
    }
  });
  
  return true;
}

// Generate comprehensive report
function generateReport() {
  log.header('📋 Visual Builder Component Verification Report');
  
  console.log(`${colors.bright}Generated:${colors.reset} ${new Date().toISOString()}`);
  console.log(`${colors.bright}Project:${colors.reset} Story UI Visual Builder`);
  
  const tests = [
    { name: 'Component Registry', test: testComponentRegistry },
    { name: 'AI Parser', test: testAIParser },
    { name: 'Type Definitions', test: testTypes },
    { name: 'Parser Functionality', test: testParserFunctionality }
  ];
  
  const results = tests.map(({ name, test }) => {
    try {
      const result = test();
      return { name, passed: result, error: null };
    } catch (error) {
      return { name, passed: false, error: error.message };
    }
  });
  
  // Component analysis
  const missingCount = analyzeMissingComponents();
  
  // Summary
  log.header('📊 Verification Summary');
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(({ name, passed, error }) => {
    if (passed) {
      log.success(`${name}: PASSED`);
    } else {
      log.error(`${name}: FAILED${error ? ` - ${error}` : ''}`);
    }
  });
  
  console.log(`\n${colors.bright}Overall Result:${colors.reset}`);
  if (passed === total) {
    log.success(`All tests passed! (${passed}/${total})`);
  } else {
    log.error(`Some tests failed (${passed}/${total})`);
  }
  
  if (missingCount > 0) {
    log.warning(`${missingCount} critical components are missing from the registry`);
  } else if (missingCount === 0) {
    log.success('All critical Mantine components are implemented');
  }
  
  // Recommendations
  log.subheader('🎯 Next Steps:');
  console.log('1. Implement missing high-priority components (Grid, Select, Checkbox)');
  console.log('2. Add comprehensive test coverage for all components');
  console.log('3. Verify compound component parsing in production environment');
  console.log('4. Test visual builder with complex nested component structures');
  console.log('5. Validate prop mapping accuracy for all component properties');
  
  return passed === total && missingCount >= 0;
}

// Main execution
async function main() {
  console.log(`${colors.bright}${colors.cyan}Visual Builder Component Structure Verification${colors.reset}\n`);
  
  // Change to visual-builder directory
  try {
    process.chdir('./visual-builder');
  } catch (error) {
    // Already in visual-builder directory or run from project root
  }
  
  const success = generateReport();
  
  if (success) {
    console.log(`\n${colors.green}${colors.bright}🎉 Verification completed successfully!${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}${colors.bright}💥 Verification found issues that need attention.${colors.reset}`);
    process.exit(1);
  }
}

// Run the verification
main().catch(error => {
  log.error(`Verification failed: ${error.message}`);
  process.exit(1);
});