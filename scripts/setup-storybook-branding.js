#!/usr/bin/env node

/**
 * Setup Storybook branding for all test instances
 * This script automatically creates manager.ts files for all test storybook instances
 * based on the multi-instance configuration, making it easy to distinguish between different environments.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.join(__dirname, '..');

// Design system branding configurations
const DESIGN_SYSTEM_CONFIGS = {
  'atlassian': {
    name: 'Atlassian Design System',
    url: 'https://atlassian.design',
    primaryColor: '#0052CC',
    secondaryColor: '#42526E',
    fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'adobe-spectrum': {
    name: 'Adobe Spectrum',
    url: 'https://spectrum.adobe.com',
    primaryColor: '#1473e6',
    secondaryColor: '#999999',
    fontBase: '"adobe-clean", "Trebuchet MS", sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'material-ui': {
    name: 'Material-UI',
    url: 'https://mui.com',
    primaryColor: '#1976d2',
    secondaryColor: '#999999',
    fontBase: '"Roboto", "Helvetica", "Arial", sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'ant-design': {
    name: 'Ant Design',
    url: 'https://ant.design',
    primaryColor: '#1890ff',
    secondaryColor: '#999999',
    fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'mantine': {
    name: 'Mantine',
    url: 'https://mantine.dev',
    primaryColor: '#228be6',
    secondaryColor: '#999999',
    fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'chakra-ui': {
    name: 'Chakra UI',
    url: 'https://chakra-ui.com',
    primaryColor: '#319795',
    secondaryColor: '#999999',
    fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'primer': {
    name: 'GitHub Primer',
    url: 'https://primer.style',
    primaryColor: '#0969da',
    secondaryColor: '#999999',
    fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'fluent-ui': {
    name: 'Fluent UI',
    url: 'https://react.fluentui.dev',
    primaryColor: '#0078d4',
    secondaryColor: '#999999',
    fontBase: '"Segoe UI", "Segoe UI Web (West European)", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'carbon': {
    name: 'IBM Carbon',
    url: 'https://carbondesignsystem.com',
    primaryColor: '#0f62fe',
    secondaryColor: '#999999',
    fontBase: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'polaris': {
    name: 'Shopify Polaris',
    url: 'https://polaris.shopify.com',
    primaryColor: '#008060',
    secondaryColor: '#999999',
    fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  },
  'default': {
    name: 'Design System',
    url: 'https://storybook.js.org',
    primaryColor: '#ff4785',
    secondaryColor: '#999999',
    fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    appBg: '#161616',
    barBg: '#1f1f1f',
  }
};

/**
 * Generates a manager.ts file content for a given design system
 */
function generateManagerTsContent(config) {
  return `import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

const theme = create({
  base: 'dark',
  brandTitle: '${config.name}',
  brandUrl: '${config.url}',
  brandTarget: '_self',
  colorPrimary: '${config.primaryColor}',
  colorSecondary: '${config.secondaryColor}',

  // Typography
  fontBase: '${config.fontBase}',
  fontCode: 'monospace',

  // UI
  appBg: '${config.appBg}',
  appContentBg: '${config.appBg}',
  appBorderColor: '#333333',
  appBorderRadius: 4,

  // Toolbar default and active colors
  barTextColor: '#cccccc',
  barSelectedColor: '${config.primaryColor}',
  barBg: '${config.barBg}',

  // Form colors
  inputBg: '#2a2a2a',
  inputBorder: '#333333',
  inputTextColor: '#cccccc',
  inputBorderRadius: 4,
});

addons.setConfig({
  theme,
});`;
}

/**
 * Detects the design system from directory name or package.json
 */
function detectDesignSystem(directory) {
  const dirName = path.basename(directory).toLowerCase();

  // Check for exact matches first
  for (const [key, config] of Object.entries(DESIGN_SYSTEM_CONFIGS)) {
    if (dirName.includes(key) || dirName.includes(key.replace('-', ''))) {
      return config;
    }
  }

  // Try to detect from package.json
  const packageJsonPath = path.join(rootDir, directory, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

      // Check for known design system packages
      if (dependencies['@atlaskit/button'] || dependencies['@atlaskit/primitives']) return DESIGN_SYSTEM_CONFIGS['atlassian'];
      if (dependencies['@mui/material']) return DESIGN_SYSTEM_CONFIGS['material-ui'];
      if (dependencies['antd']) return DESIGN_SYSTEM_CONFIGS['ant-design'];
      if (dependencies['@mantine/core']) return DESIGN_SYSTEM_CONFIGS['mantine'];
      if (dependencies['@chakra-ui/react']) return DESIGN_SYSTEM_CONFIGS['chakra-ui'];
      if (dependencies['@primer/react']) return DESIGN_SYSTEM_CONFIGS['primer'];
      if (dependencies['@fluentui/react-components']) return DESIGN_SYSTEM_CONFIGS['fluent-ui'];
      if (dependencies['@carbon/react']) return DESIGN_SYSTEM_CONFIGS['carbon'];
      if (dependencies['@shopify/polaris']) return DESIGN_SYSTEM_CONFIGS['polaris'];
      if (dependencies['@adobe/react-spectrum']) return DESIGN_SYSTEM_CONFIGS['adobe-spectrum'];
    } catch (error) {
      console.warn(`Warning: Could not read package.json for ${directory}: ${error.message}`);
    }
  }

  // Return default configuration
  return DESIGN_SYSTEM_CONFIGS['default'];
}

/**
 * Gets the custom name from multi-instance config if available
 */
function getCustomNameFromConfig(directory) {
  const configPath = path.join(rootDir, 'multi-instance.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const instance = config.instances?.find(inst => inst.directory === directory);
      return instance?.name;
    } catch (error) {
      console.warn(`Warning: Could not read multi-instance config: ${error.message}`);
    }
  }
  return null;
}

/**
 * Setup branding for a specific directory
 */
function setupBrandingForDirectory(directory, customName = null) {
  const fullPath = path.join(rootDir, directory);
  const storybookPath = path.join(fullPath, '.storybook');
  const managerPath = path.join(storybookPath, 'manager.ts');

  // Check if directory and .storybook exist
  if (!fs.existsSync(fullPath)) {
    console.warn(`❌ Directory not found: ${directory}`);
    return false;
  }

  if (!fs.existsSync(storybookPath)) {
    console.warn(`❌ .storybook directory not found: ${directory}`);
    return false;
  }

  // Detect design system configuration
  const designSystemConfig = detectDesignSystem(directory);

  // Use custom name if provided, otherwise use detected name
  if (customName) {
    designSystemConfig.name = customName;
  }

  // Generate manager.ts content
  const content = generateManagerTsContent(designSystemConfig);

  // Write the file
  fs.writeFileSync(managerPath, content);
  console.log(`✅ Created branding for ${designSystemConfig.name} at ${directory}`);

  return true;
}

/**
 * Setup branding for all test storybook instances
 */
function setupBrandingForAllInstances() {
  const testStorybooksPath = path.join(rootDir, 'test-storybooks');

  // Check if test-storybooks directory exists
  if (!fs.existsSync(testStorybooksPath)) {
    console.warn('❌ test-storybooks directory not found');
    return;
  }

  // Get all subdirectories
  const directories = fs.readdirSync(testStorybooksPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  console.log(`🎨 Setting up Storybook branding for ${directories.length} instances...\n`);

  let successCount = 0;

  for (const dir of directories) {
    const relativePath = `test-storybooks/${dir}`;
    const customName = getCustomNameFromConfig(relativePath);

    if (setupBrandingForDirectory(relativePath, customName)) {
      successCount++;
    }
  }

  console.log(`\n✅ Successfully set up branding for ${successCount}/${directories.length} instances`);

  if (successCount > 0) {
    console.log('\n💡 Restart your Storybook instances to see the new branding!');
    console.log('   Each instance will now show its design system name instead of "Storybook"');
  }
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Setup branding for all instances
    setupBrandingForAllInstances();
  } else if (args.length === 1) {
    // Setup branding for a specific directory
    const directory = args[0];
    const customName = getCustomNameFromConfig(directory);
    setupBrandingForDirectory(directory, customName);
  } else if (args.length === 2) {
    // Setup branding for a specific directory with custom name
    const directory = args[0];
    const customName = args[1];
    setupBrandingForDirectory(directory, customName);
  } else {
    console.error('Usage:');
    console.error('  npm run setup-branding                    # Setup branding for all instances');
    console.error('  npm run setup-branding <directory>        # Setup branding for specific directory');
    console.error('  npm run setup-branding <directory> <name> # Setup branding with custom name');
    process.exit(1);
  }
}

// Only run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { setupBrandingForDirectory, setupBrandingForAllInstances, generateManagerTsContent, DESIGN_SYSTEM_CONFIGS };
