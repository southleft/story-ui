import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { autoDetectDesignSystem } from '../story-generator/configLoader.js';
import { fileURLToPath } from 'url';
import net from 'net';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the Story UI package version for version tracking
 */
function getStoryUIVersion(): string {
  try {
    const pkgRoot = path.resolve(__dirname, '..');
    const packageJsonPath = path.join(pkgRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || 'unknown';
    }
  } catch (error) {
    // Fallback
  }
  return 'unknown';
}

// FIRST_EDIT: helper functions to check for free ports
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close();
        resolve(true);
      })
      .listen(port);
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  // eslint-disable-next-line no-await-in-loop
  while (!(await isPortAvailable(port))) {
    port += 1;
  }
  return port;
}

/**
 * Clean up default Storybook template components that could conflict with design system discovery
 */
export function cleanupDefaultStorybookComponents() {
  const possibleDirs = [
    path.join(process.cwd(), 'src', 'stories'),
    path.join(process.cwd(), 'stories'),
    path.join(process.cwd(), '.storybook', 'stories')
  ];
  
  // Comprehensive list of default Storybook files that cause conflicts
  const defaultFiles = [
    // Component files
    'Button.stories.ts', 'Button.stories.tsx', 'Button.stories.js', 'Button.stories.jsx',
    'Header.stories.ts', 'Header.stories.tsx', 'Header.stories.js', 'Header.stories.jsx', 
    'Page.stories.ts', 'Page.stories.tsx', 'Page.stories.js', 'Page.stories.jsx',
    'Introduction.stories.ts', 'Introduction.stories.tsx', 'Introduction.stories.js', 'Introduction.stories.jsx',
    'Configure.stories.ts', 'Configure.stories.tsx', 'Configure.stories.js', 'Configure.stories.jsx',
    // Component implementation files
    'Button.tsx', 'Button.ts', 'Button.jsx', 'Button.js',
    'Header.tsx', 'Header.ts', 'Header.jsx', 'Header.js',
    'Page.tsx', 'Page.ts', 'Page.jsx', 'Page.js',
    // CSS files
    'button.css', 'header.css', 'page.css', 'introduction.css',
    // MDX files
    'Introduction.stories.mdx', 'Configure.stories.mdx'
  ];

  let cleanedFiles = 0;

  for (const storiesDir of possibleDirs) {
    if (!fs.existsSync(storiesDir)) continue;

    for (const fileName of defaultFiles) {
      const filePath = path.join(storiesDir, fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          cleanedFiles++;
        } catch (error) {
          console.warn(`Could not remove ${fileName}: ${error}`);
        }
      }
    }
  }

  if (cleanedFiles > 0) {
    console.log(chalk.green(`✅ Cleaned up ${cleanedFiles} default Storybook template files to prevent component discovery conflicts`));
  }
}


/**
 * Set up Storybook preview file with appropriate providers for design systems
 */
function setupStorybookPreview(designSystem: string) {
  const storybookDir = path.join(process.cwd(), '.storybook');
  const previewTsPath = path.join(storybookDir, 'preview.ts');
  const previewTsxPath = path.join(storybookDir, 'preview.tsx');
  
  if (!fs.existsSync(storybookDir)) {
    console.log(chalk.yellow('⚠️  .storybook directory not found. Please run storybook init first.'));
    return;
  }

  // Verify required packages are installed before creating preview
  if (['mantine', 'chakra'].includes(designSystem)) {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const config = DESIGN_SYSTEM_CONFIGS[designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
      
      if (config) {
        const missingDeps = config.packages.filter(pkg => !allDeps[pkg]);
        if (missingDeps.length > 0) {
          console.log(chalk.red(`❌ Cannot create preview.tsx - missing dependencies: ${missingDeps.join(', ')}`));
          console.log(chalk.yellow(`Please install them first: npm install ${missingDeps.join(' ')}`));
          
          // Clean up existing preview.tsx if it has broken imports
          if (fs.existsSync(previewTsxPath)) {
            fs.unlinkSync(previewTsxPath);
            console.log(chalk.yellow('⚠️  Removed existing preview.tsx with broken imports'));
          }
          
          return;
        }
      }
    }
  }

  const designSystemConfigs = {
    chakra: {
      imports: [
        "import type { Preview } from '@storybook/react-vite'",
        "import { ChakraProvider, defaultSystem } from '@chakra-ui/react'",
        "import React from 'react'"
      ],
      decorator: `(Story) => (
      <ChakraProvider value={defaultSystem}>
        <Story />
      </ChakraProvider>
    )`
    },
    mantine: {
      imports: [
        "import type { Preview } from '@storybook/react-vite'",
        "import { MantineProvider } from '@mantine/core'",
        "import '@mantine/core/styles.css'",
        "import React from 'react'"
      ],
      decorator: `(Story) => (
      <MantineProvider>
        <Story />
      </MantineProvider>
    )`
    }
  };

  const config = designSystemConfigs[designSystem as keyof typeof designSystemConfigs];
  if (!config) return;

  // Create the preview content
  const previewContent = `${config.imports.join('\n')}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
  decorators: [
    ${config.decorator},
  ],
};

export default preview;
`;

  // Remove existing preview.ts if it exists
  if (fs.existsSync(previewTsPath)) {
    fs.unlinkSync(previewTsPath);
  }

  // Create preview.tsx with JSX support
  fs.writeFileSync(previewTsxPath, previewContent);
  
  console.log(chalk.green(`✅ Created .storybook/preview.tsx with ${designSystem} provider setup`));
}

interface SetupAnswers {
  designSystem: string; // 'auto', 'custom', or any key from DESIGN_SYSTEM_CONFIGS
  installDesignSystem?: boolean;
  importPath?: string;
  componentPrefix?: string;
  generatedStoriesPath?: string;
  componentsPath?: string;
  llmProvider?: 'claude' | 'openai' | 'gemini';
  hasApiKey?: boolean;
  apiKey?: string;
  mcpPort?: string;
}

// LLM Provider configurations - synced with production (cloudflare-edge/src/worker.ts)
const LLM_PROVIDERS = {
  claude: {
    name: 'Claude (Anthropic)',
    envKey: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
    docsUrl: 'https://console.anthropic.com/',
    description: 'Recommended - Best for complex reasoning and code quality'
  },
  openai: {
    name: 'OpenAI (GPT)',
    envKey: 'OPENAI_API_KEY',
    models: ['gpt-5.1', 'gpt-5.1-thinking', 'gpt-4o', 'gpt-4o-mini'],
    docsUrl: 'https://platform.openai.com/api-keys',
    description: 'Versatile and fast'
  },
  gemini: {
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    models: ['gemini-3-pro', 'gemini-2.0-flash-exp', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    docsUrl: 'https://aistudio.google.com/app/apikey',
    description: 'Cost-effective with good performance'
  }
};

// Design system installation configurations (organized by framework)
const DESIGN_SYSTEM_CONFIGS: Record<string, {
  packages: string[];
  name: string;
  importPath: string;
  additionalSetup?: string;
  framework: 'react' | 'angular' | 'vue' | 'svelte' | 'web-components';
}> = {
  // React design systems
  mantine: {
    packages: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
    name: 'Mantine',
    importPath: '@mantine/core',
    additionalSetup: 'import "@mantine/core/styles.css";',
    framework: 'react'
  },
  chakra: {
    packages: ['@chakra-ui/react', '@emotion/react', '@emotion/styled', 'framer-motion'],
    name: 'Chakra UI',
    importPath: '@chakra-ui/react',
    additionalSetup: 'import { ChakraProvider } from "@chakra-ui/react";',
    framework: 'react'
  },
  mui: {
    packages: ['@mui/material', '@emotion/react', '@emotion/styled'],
    name: 'Material UI',
    importPath: '@mui/material',
    additionalSetup: 'import { ThemeProvider } from "@mui/material/styles";',
    framework: 'react'
  },
  // Angular design systems
  'angular-material': {
    packages: ['@angular/material', '@angular/cdk'],
    name: 'Angular Material',
    importPath: '@angular/material',
    additionalSetup: 'import { MatModule } from "@angular/material";',
    framework: 'angular'
  },
  primeng: {
    packages: ['primeng', 'primeicons'],
    name: 'PrimeNG',
    importPath: 'primeng',
    additionalSetup: 'import "primeng/resources/themes/lara-light-blue/theme.css";',
    framework: 'angular'
  },
  'ng-zorro': {
    packages: ['ng-zorro-antd'],
    name: 'NG-ZORRO',
    importPath: 'ng-zorro-antd',
    additionalSetup: 'import "ng-zorro-antd/ng-zorro-antd.min.css";',
    framework: 'angular'
  },
  // Vue design systems
  primevue: {
    packages: ['primevue', 'primeicons'],
    name: 'PrimeVue',
    importPath: 'primevue',
    additionalSetup: 'import "primevue/resources/themes/lara-light-blue/theme.css";',
    framework: 'vue'
  },
  vuetify: {
    packages: ['vuetify', '@mdi/font', '@fontsource/roboto'],
    name: 'Vuetify',
    importPath: 'vuetify',
    additionalSetup: `import "vuetify/styles";
import "@mdi/font/css/materialdesignicons.css";
// Roboto font required for proper Vuetify typography
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";`,
    framework: 'vue'
  },
  'element-plus': {
    packages: ['element-plus'],
    name: 'Element Plus',
    importPath: 'element-plus',
    additionalSetup: 'import "element-plus/dist/index.css";',
    framework: 'vue'
  },
  // Svelte design systems
  'skeleton-ui': {
    packages: ['@skeletonlabs/skeleton'],
    name: 'Skeleton UI',
    importPath: '@skeletonlabs/skeleton',
    framework: 'svelte'
  },
  smui: {
    packages: ['svelte-material-ui'],
    name: 'Svelte Material UI',
    importPath: 'svelte-material-ui',
    framework: 'svelte'
  },
  // Web Components design systems
  shoelace: {
    packages: ['@shoelace-style/shoelace'],
    name: 'Shoelace',
    importPath: '@shoelace-style/shoelace',
    additionalSetup: 'import "@shoelace-style/shoelace/dist/themes/light.css";',
    framework: 'web-components'
  },
  lit: {
    packages: ['lit'],
    name: 'Lit',
    importPath: 'lit',
    framework: 'web-components'
  },
  vaadin: {
    packages: ['@vaadin/vaadin-core'],
    name: 'Vaadin',
    importPath: '@vaadin',
    additionalSetup: 'import "@vaadin/vaadin-lumo-styles/all-imports.js";',
    framework: 'web-components'
  }
};

async function installDesignSystem(systemKey: keyof typeof DESIGN_SYSTEM_CONFIGS) {
  const config = DESIGN_SYSTEM_CONFIGS[systemKey];
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
  
  // Check if packages are already installed
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const missingPackages = config.packages.filter(pkg => !dependencies[pkg]);
  
  if (missingPackages.length === 0) {
    console.log(chalk.green(`✅ ${config.name} packages already installed`));
    return true;
  }

  console.log(chalk.blue(`\n📦 Installing ${config.name} packages...`));
  console.log(chalk.gray(`Packages: ${missingPackages.join(', ')}`));
  
  // Detect package manager
  const npmLock = fs.existsSync(path.join(process.cwd(), 'package-lock.json'));
  const yarnLock = fs.existsSync(path.join(process.cwd(), 'yarn.lock'));
  const pnpmLock = fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'));
  
  let installCommand = `npm install ${missingPackages.join(' ')}`;
  if (yarnLock) {
    installCommand = `yarn add ${missingPackages.join(' ')}`;
  } else if (pnpmLock) {
    installCommand = `pnpm add ${missingPackages.join(' ')}`;
  }
  
  try {
    console.log(chalk.gray(`Running: ${installCommand}`));
    execSync(installCommand, { stdio: 'inherit' });
    
    // Verify installation was successful by re-checking package.json
    const updatedPackageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    const updatedDeps = { ...updatedPackageJson.dependencies, ...updatedPackageJson.devDependencies };
    const stillMissingPackages = config.packages.filter(pkg => !updatedDeps[pkg]);
    
    if (stillMissingPackages.length > 0) {
      throw new Error(`Installation failed: packages still missing: ${stillMissingPackages.join(', ')}`);
    }
    
    console.log(chalk.green(`✅ ${config.name} installed successfully!`));
    
    if (config.additionalSetup) {
      // Try to automatically add CSS import for Mantine
      if (systemKey === 'mantine') {
        const cssFiles = [
          path.join(process.cwd(), 'src', 'index.css'),
          path.join(process.cwd(), 'src', 'main.css'),
          path.join(process.cwd(), 'src', 'App.css')
        ];
        
        let cssAdded = false;
        for (const cssFile of cssFiles) {
          if (fs.existsSync(cssFile)) {
            try {
              const cssContent = fs.readFileSync(cssFile, 'utf-8');
              if (!cssContent.includes('@mantine/core/styles.css')) {
                const newContent = `@import "@mantine/core/styles.css";\n\n${cssContent}`;
                fs.writeFileSync(cssFile, newContent);
                console.log(chalk.green(`✅ Added Mantine CSS import to ${path.relative(process.cwd(), cssFile)}`));
                cssAdded = true;
                break;
              } else {
                console.log(chalk.blue(`ℹ️ Mantine CSS already imported in ${path.relative(process.cwd(), cssFile)}`));
                cssAdded = true;
                break;
              }
            } catch (error) {
              console.warn(chalk.yellow(`⚠️ Could not modify ${cssFile}:`, error));
            }
          }
        }
        
        if (!cssAdded) {
          console.log(chalk.blue('\n📋 Manual setup required:'));
          console.log(chalk.gray(`Add this import to your main CSS file:`));
          console.log(chalk.cyan(`${config.additionalSetup}`));
        }
      } else {
        console.log(chalk.blue('\n📋 Additional setup required:'));
        console.log(chalk.gray(`Add this import to your main CSS/index file:`));
        console.log(chalk.cyan(`${config.additionalSetup}`));
      }
    }
    
    return true;
  } catch (error) {
    console.error(chalk.red(`❌ Failed to install ${config.name}:`), error);
    console.log(chalk.yellow(`\n💡 You can install manually with: ${installCommand}`));
    return false;
  }
}

// CLI options interface
export interface SetupOptions {
  designSystem?: string;
  llmProvider?: 'claude' | 'openai' | 'gemini';
  yes?: boolean;
  skipInstall?: boolean;
}

export async function setupCommand(options: SetupOptions = {}) {
  console.log(chalk.blue.bold('\n🎨 Story UI Setup\n'));

  // Non-interactive mode indicator
  if (options.yes || options.designSystem) {
    console.log(chalk.gray('Running in non-interactive mode...\n'));
  } else {
    console.log('This will help you configure Story UI for your design system.\n');
  }

  // Check if we're in a valid project
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(chalk.red('❌ No package.json found. Please run this command in your project root.'));
    process.exit(1);
  }

  // Check if Storybook is installed (any framework)
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const devDeps = packageJson.devDependencies || {};
  const deps = packageJson.dependencies || {};

  // Check for any Storybook framework
  const storybookPackages = [
    '@storybook/react', '@storybook/react-vite', '@storybook/react-webpack5', '@storybook/nextjs',
    '@storybook/angular', '@storybook/vue3', '@storybook/vue3-vite',
    '@storybook/svelte', '@storybook/svelte-vite',
    '@storybook/web-components', '@storybook/web-components-vite', '@storybook/web-components-webpack5'
  ];
  const hasStorybook = storybookPackages.some(pkg => devDeps[pkg] || deps[pkg]) ||
                      fs.existsSync(path.join(process.cwd(), '.storybook'));

  if (!hasStorybook) {
    console.warn(chalk.yellow('⚠️  Storybook not detected. Story UI works best with Storybook installed.'));
    console.log('Install Storybook first: npx storybook@latest init\n');
  }

  // Detect Storybook framework and component framework type
  let storybookFramework = '@storybook/react'; // default
  let componentFramework: 'react' | 'angular' | 'vue' | 'svelte' | 'web-components' = 'react';

  // Check for React Storybook variants
  if (devDeps['@storybook/react-vite'] || deps['@storybook/react-vite']) {
    storybookFramework = '@storybook/react-vite';
    componentFramework = 'react';
    console.log(chalk.green('✅ Detected Vite-based React Storybook'));
  } else if (devDeps['@storybook/react-webpack5'] || deps['@storybook/react-webpack5']) {
    storybookFramework = '@storybook/react-webpack5';
    componentFramework = 'react';
    console.log(chalk.green('✅ Detected Webpack 5-based React Storybook'));
  } else if (devDeps['@storybook/nextjs'] || deps['@storybook/nextjs']) {
    storybookFramework = '@storybook/nextjs';
    componentFramework = 'react';
    console.log(chalk.green('✅ Detected Next.js Storybook'));
  }
  // Check for Angular Storybook
  else if (devDeps['@storybook/angular'] || deps['@storybook/angular']) {
    storybookFramework = '@storybook/angular';
    componentFramework = 'angular';
    console.log(chalk.green('✅ Detected Angular Storybook'));
  }
  // Check for Vue Storybook (vite variant first)
  else if (devDeps['@storybook/vue3-vite'] || deps['@storybook/vue3-vite']) {
    storybookFramework = '@storybook/vue3-vite';
    componentFramework = 'vue';
    console.log(chalk.green('✅ Detected Vite-based Vue 3 Storybook'));
  } else if (devDeps['@storybook/vue3'] || deps['@storybook/vue3']) {
    storybookFramework = '@storybook/vue3';
    componentFramework = 'vue';
    console.log(chalk.green('✅ Detected Vue 3 Storybook'));
  }
  // Check for Svelte Storybook (vite variant first)
  else if (devDeps['@storybook/svelte-vite'] || deps['@storybook/svelte-vite']) {
    storybookFramework = '@storybook/svelte-vite';
    componentFramework = 'svelte';
    console.log(chalk.green('✅ Detected Vite-based Svelte Storybook'));
  } else if (devDeps['@storybook/svelte'] || deps['@storybook/svelte']) {
    storybookFramework = '@storybook/svelte';
    componentFramework = 'svelte';
    console.log(chalk.green('✅ Detected Svelte Storybook'));
  }
  // Check for Web Components Storybook (webpack5 first, then vite, then generic)
  else if (devDeps['@storybook/web-components-webpack5'] || deps['@storybook/web-components-webpack5']) {
    storybookFramework = '@storybook/web-components-webpack5';
    componentFramework = 'web-components';
    console.log(chalk.green('✅ Detected Webpack 5-based Web Components Storybook'));
  } else if (devDeps['@storybook/web-components-vite'] || deps['@storybook/web-components-vite']) {
    storybookFramework = '@storybook/web-components-vite';
    componentFramework = 'web-components';
    console.log(chalk.green('✅ Detected Vite-based Web Components Storybook'));
  } else if (devDeps['@storybook/web-components'] || deps['@storybook/web-components']) {
    storybookFramework = '@storybook/web-components';
    componentFramework = 'web-components';
    console.log(chalk.green('✅ Detected Web Components Storybook'));
  }
  // Check for generic @storybook/react (old setup)
  else if (devDeps['@storybook/react'] || deps['@storybook/react']) {
    storybookFramework = '@storybook/react';
    componentFramework = 'react';
    console.log(chalk.green('✅ Detected React Storybook'));
  }

  // Auto-detect design system
  const autoDetected = autoDetectDesignSystem();
  if (autoDetected) {
    console.log(chalk.green(`✅ Auto-detected design system:`));
    console.log(`   📦 Import path: ${autoDetected.importPath}`);
    if (autoDetected.componentPrefix) {
      console.log(`   🏷️  Component prefix: ${autoDetected.componentPrefix}`);
    }
    if (autoDetected.componentsPath) {
      console.log(`   📁 Components path: ${autoDetected.componentsPath}`);
    }
  }

  // Build design system choices based on detected framework
  // Simplified to show only the most popular option per framework
  const getDesignSystemChoices = () => {
    const baseChoice = { name: '🤖 Auto-detect from package.json', value: 'auto' };
    const customChoice = { name: '🔧 Custom/Other', value: 'custom' };

    switch (componentFramework) {
      case 'angular':
        return [
          baseChoice,
          { name: '🅰️ Angular Material (@angular/material) - Most Popular', value: 'angular-material' },
          customChoice
        ];
      case 'vue':
        return [
          baseChoice,
          { name: '🎯 Vuetify (vuetify) - Most Popular', value: 'vuetify' },
          customChoice
        ];
      case 'svelte':
        return [
          baseChoice,
          { name: '🟠 Skeleton UI (@skeletonlabs/skeleton) - Most Popular', value: 'skeleton-ui' },
          customChoice
        ];
      case 'web-components':
        return [
          baseChoice,
          { name: '👟 Shoelace (@shoelace-style/shoelace) - Most Popular', value: 'shoelace' },
          customChoice
        ];
      case 'react':
      default:
        return [
          baseChoice,
          { name: '🎯 Mantine (@mantine/core) - Most Popular', value: 'mantine' },
          { name: '⚡ Chakra UI (@chakra-ui/react)', value: 'chakra' },
          { name: '🎨 Material UI (@mui/material)', value: 'mui' },
          customChoice
        ];
    }
  };;

  // Non-interactive mode: build answers from CLI options
  let answers: SetupAnswers;

  if (options.yes || options.designSystem) {
    // Non-interactive mode
    const designSystem = options.designSystem || (autoDetected ? 'auto' : 'custom');
    const mcpPort = String(await findAvailablePort(4001));

    // Validate design system choice
    const validSystems = ['auto', 'custom', ...Object.keys(DESIGN_SYSTEM_CONFIGS)];
    if (!validSystems.includes(designSystem)) {
      console.error(chalk.red(`❌ Invalid design system: ${designSystem}`));
      console.log(chalk.yellow(`Valid options: ${validSystems.join(', ')}`));
      process.exit(1);
    }

    const llmProvider = options.llmProvider || 'claude';

    answers = {
      designSystem,
      installDesignSystem: !options.skipInstall && Object.keys(DESIGN_SYSTEM_CONFIGS).includes(designSystem),
      generatedStoriesPath: './src/stories/generated/',
      llmProvider,
      mcpPort,
      hasApiKey: false,
    };

    console.log(chalk.blue(`📦 Design system: ${designSystem}`));
    console.log(chalk.blue(`🤖 AI Provider: ${LLM_PROVIDERS[llmProvider]?.name || llmProvider}`));
    console.log(chalk.blue(`📁 Generated stories: ${answers.generatedStoriesPath}`));
    console.log(chalk.blue(`🔌 MCP port: ${mcpPort}`));
    if (options.skipInstall) {
      console.log(chalk.yellow('⏭️  Skipping package installation'));
    }
  } else {
    // Interactive mode - use inquirer prompts
    answers = await inquirer.prompt<SetupAnswers>([
      {
        type: 'list',
        name: 'designSystem',
        message: `Which design system are you using? (${componentFramework} detected)`,
        choices: getDesignSystemChoices(),
        default: autoDetected ? 'auto' : 'custom'
      },
      {
        type: 'confirm',
        name: 'installDesignSystem',
        message: (promptAnswers) => {
          const config = DESIGN_SYSTEM_CONFIGS[promptAnswers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
          const systemName = config?.name || 'the design system';
          return `🚨 IMPORTANT: Would you like to install ${systemName} packages now?\n   Required packages: ${config?.packages.join(', ') || 'unknown'}\n   (Without these packages, Story UI and Storybook will not work properly)`;
        },
        when: (promptAnswers) => Object.keys(DESIGN_SYSTEM_CONFIGS).includes(promptAnswers.designSystem),
        default: true
      },
      {
        type: 'input',
        name: 'importPath',
        message: 'What is the import path for your components?',
        when: (promptAnswers) => promptAnswers.designSystem === 'custom',
        validate: (input) => input.trim() ? true : 'Import path is required'
      },
      {
        type: 'input',
        name: 'componentPrefix',
        message: 'Do your components have a prefix? (e.g., "AL" for ALButton)',
        when: (promptAnswers) => promptAnswers.designSystem === 'custom',
        default: ''
      },
      {
        type: 'input',
        name: 'generatedStoriesPath',
        message: 'Where should generated stories be saved?',
        default: './src/stories/generated/',
        validate: (input) => input.trim() ? true : 'Path is required'
      },
      {
        type: 'input',
        name: 'componentsPath',
        message: 'Where are your component files located?',
        default: './src/components',
        when: (promptAnswers) => promptAnswers.designSystem === 'custom'
      },
      {
        type: 'input',
        name: 'mcpPort',
        message: 'Port for the Story UI MCP server',
        default: async () => {
          const port = await findAvailablePort(4001);
          return String(port);
        },
        validate: async (input) => {
          const value = parseInt(input, 10);
          if (isNaN(value) || value <= 0) return 'Enter a valid port number';
          const available = await isPortAvailable(value);
          return available ? true : `Port ${value} is already in use`;
        }
      },
      {
        type: 'list',
        name: 'llmProvider',
        message: 'Which AI provider would you like to use?',
        choices: [
          { name: `${chalk.green('Claude (Anthropic)')} - ${chalk.gray('Recommended for complex reasoning and code quality')}`, value: 'claude' },
          { name: `${chalk.blue('OpenAI (GPT-5)')} - ${chalk.gray('Versatile and fast')}`, value: 'openai' },
          { name: `${chalk.yellow('Google Gemini')} - ${chalk.gray('Cost-effective with good performance')}`, value: 'gemini' }
        ],
        default: 'claude'
      },
      {
        type: 'confirm',
        name: 'hasApiKey',
        message: (promptAnswers) => {
          const provider = LLM_PROVIDERS[promptAnswers.llmProvider as keyof typeof LLM_PROVIDERS];
          return `Do you have a ${provider?.name || 'provider'} API key? (You can add it later)`;
        },
        default: false
      },
      {
        type: 'password',
        name: 'apiKey',
        message: (promptAnswers) => {
          const provider = LLM_PROVIDERS[promptAnswers.llmProvider as keyof typeof LLM_PROVIDERS];
          return `Enter your ${provider?.name || 'provider'} API key:`;
        },
        when: (promptAnswers) => promptAnswers.hasApiKey,
        validate: (input) => input.trim() ? true : 'API key is required'
      }
    ]);
  }

  // Install design system if requested
  if (answers.installDesignSystem && Object.keys(DESIGN_SYSTEM_CONFIGS).includes(answers.designSystem)) {
    const installSuccess = await installDesignSystem(answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS);
    if (!installSuccess) {
      console.log(chalk.red('❌ Installation failed! Cannot continue without required dependencies.'));
      console.log(chalk.yellow('Please install manually and run setup again:'));
      const config = DESIGN_SYSTEM_CONFIGS[answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
      console.log(chalk.cyan(`npm install ${config.packages.join(' ')}`));
      
      // Clean up any existing preview.tsx that might cause issues
      const previewTsxPath = path.join(process.cwd(), '.storybook', 'preview.tsx');
      if (fs.existsSync(previewTsxPath)) {
        fs.unlinkSync(previewTsxPath);
        console.log(chalk.yellow('⚠️  Removed preview.tsx to prevent import errors'));
      }
      
      process.exit(1);
    }
    
    // Set up Storybook preview file after successful installation
    setupStorybookPreview(answers.designSystem);
  } else if (Object.keys(DESIGN_SYSTEM_CONFIGS).includes(answers.designSystem)) {
    // User declined installation - verify dependencies exist
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const dsConfig = DESIGN_SYSTEM_CONFIGS[answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
      const missingDeps = dsConfig.packages.filter(pkg => !allDeps[pkg]);

      if (missingDeps.length > 0) {
        // If --skip-install was explicitly passed, just warn but continue with config generation
        if (options.skipInstall) {
          console.log(chalk.yellow('⚠️  Dependencies not installed (--skip-install used):'), missingDeps.join(', '));
          console.log(chalk.yellow('   Install them later with:'));
          console.log(chalk.cyan(`   npm install ${missingDeps.join(' ')}`));
          // Don't set up Storybook preview since deps are missing
        } else {
          // Interactive mode: user declined installation
          console.log(chalk.red('❌ Required dependencies missing:'), missingDeps.join(', '));
          console.log(chalk.yellow('Please install them manually:'));
          console.log(chalk.cyan(`npm install ${missingDeps.join(' ')}`));

          // Clean up any existing preview.tsx that might cause issues
          const previewTsxPath = path.join(process.cwd(), '.storybook', 'preview.tsx');
          if (fs.existsSync(previewTsxPath)) {
            fs.unlinkSync(previewTsxPath);
            console.log(chalk.yellow('⚠️  Removed preview.tsx to prevent import errors'));
          }

          process.exit(1);
        }
      } else {
        // Dependencies exist, set up Storybook preview
        setupStorybookPreview(answers.designSystem);
      }
    }
  }

  // Generate configuration
  let config: any = {};

  if (answers.designSystem === 'auto' && autoDetected) {
    config = autoDetected;
  } else if (answers.designSystem === 'chakra') {
    config = {
      importPath: '@chakra-ui/react',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'SimpleGrid',
        columnComponent: 'Box',
        containerComponent: 'Container',
        layoutExamples: {
          twoColumn: `<SimpleGrid columns={2} spacing={6}>
  <Box>
    <Card>
      <CardHeader>
        <Heading size="md">Left Card</Heading>
      </CardHeader>
      <CardBody>
        <Text>Left content goes here</Text>
      </CardBody>
    </Card>
  </Box>
  <Box>
    <Card>
      <CardHeader>
        <Heading size="md">Right Card</Heading>
      </CardHeader>
      <CardBody>
        <Text>Right content goes here</Text>
      </CardBody>
    </Card>
  </Box>
</SimpleGrid>`
        }
      }
    };
  } else if (answers.designSystem === 'mantine') {
    config = {
      importPath: '@mantine/core',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'SimpleGrid',
        columnComponent: 'div',
        containerComponent: 'Container',
        layoutExamples: {
          twoColumn: `<SimpleGrid cols={2} spacing="md">
  <div>
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Text fw={500} size="lg" mb="xs">Left Card</Text>
      <Text size="sm" c="dimmed">
        Left content goes here
      </Text>
    </Card>
  </div>
  <div>
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Text fw={500} size="lg" mb="xs">Right Card</Text>
      <Text size="sm" c="dimmed">
        Right content goes here
      </Text>
    </Card>
  </div>
</SimpleGrid>`
        }
      }
    };
  } else if (answers.designSystem === 'mui') {
    config = {
      importPath: '@mui/material',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'Grid',
        columnComponent: 'Grid',
        containerComponent: 'Container',
        layoutExamples: {
          twoColumn: `<Grid container spacing={2}>
  <Grid item xs={6}>
    <Card>
      <CardContent>
        <Typography variant="h6">Left Card</Typography>
        <Typography variant="body2" color="text.secondary">
          Left content goes here
        </Typography>
      </CardContent>
    </Card>
  </Grid>
  <Grid item xs={6}>
    <Card>
      <CardContent>
        <Typography variant="h6">Right Card</Typography>
        <Typography variant="body2" color="text.secondary">
          Right content goes here
        </Typography>
      </CardContent>
    </Card>
  </Grid>
</Grid>`
        }
      },
      designSystemGuidelines: {
        name: 'Material UI',
        additionalNotes: `
Material UI (MUI) is a React component library implementing Material Design.
- Import components from "@mui/material" (e.g., import { Button } from "@mui/material")
- Use the sx prop for inline styling with theme awareness
- Use Grid for layouts, Card for containers
- Leverage ThemeProvider for consistent theming
- Typography component for text with proper variants
        `.trim()
      }
    };
  } else {
    // Custom configuration
    config = {
      importPath: answers.importPath,
      componentPrefix: answers.componentPrefix || '',
      componentsPath: answers.componentsPath ? path.resolve(answers.componentsPath) : undefined,
      layoutRules: {
        multiColumnWrapper: 'div',
        columnComponent: 'div',
        containerComponent: 'div',
        layoutExamples: {
          twoColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
</div>`
        }
      }
    };
  }

  // Add common configuration
  config.generatedStoriesPath = path.resolve(answers.generatedStoriesPath || './src/stories/generated/');
  config.storyPrefix = 'Generated/';
  config.defaultAuthor = 'Story UI AI';
  config.componentFramework = componentFramework; // react, angular, vue, svelte, or web-components
  config.storybookFramework = storybookFramework; // e.g., @storybook/react-vite, @storybook/angular
  config.llmProvider = answers.llmProvider || 'claude'; // claude, openai, or gemini

  // For web-components with local imports, add importExamples guidance
  if (componentFramework === 'web-components' && config.importPath?.startsWith('.')) {
    config.importExamples = [
      `import '${config.importPath}/alert/alert'; // For <your-prefix-alert> component`,
      `import '${config.importPath}/button/button'; // For <your-prefix-button> component`,
      `// IMPORTANT: Update these examples to match your component library's folder structure`,
      `// The AI uses these patterns to generate correct import statements`
    ];
  }

  // Add version tracking for update command
  config._storyUIVersion = getStoryUIVersion();
  config._lastUpdated = new Date().toISOString();

  // Create configuration file
  const configContent = `module.exports = ${JSON.stringify(config, null, 2)};`;
  const configPath = path.join(process.cwd(), 'story-ui.config.js');

  fs.writeFileSync(configPath, configContent);
  console.log(chalk.green('✅ Created story-ui.config.js'));

  // For web-components, provide guidance about importExamples
  if (componentFramework === 'web-components' && config.importPath?.startsWith('.')) {
    console.log(chalk.yellow('\n⚠️  Web Components Setup - Important:'));
    console.log(chalk.gray('   Update "importExamples" in story-ui.config.js to match your component library\'s structure.'));
    console.log(chalk.gray('   This helps the AI generate correct import statements for your components.'));
    console.log(chalk.gray('   Also update story-ui-considerations.md with component-specific behaviors.'));
  }

  // Create generated stories directory
  const storiesDir = path.dirname(config.generatedStoriesPath);
  if (!fs.existsSync(storiesDir)) {
    fs.mkdirSync(storiesDir, { recursive: true });
  }

  // Copy StoryUI component to the project
  const storyUITargetDir = path.join(storiesDir, 'StoryUI');
  if (!fs.existsSync(storyUITargetDir)) {
    fs.mkdirSync(storyUITargetDir, { recursive: true });
  }

  // Copy component files
  const templatesDir = path.resolve(__dirname, '../../templates/StoryUI');
  const componentFiles = ['StoryUIPanel.tsx', 'StoryUIPanel.mdx', 'StoryUIPanel.css'];

  console.log(chalk.blue('\n📦 Installing Story UI component...'));

  for (const file of componentFiles) {
    const sourcePath = path.join(templatesDir, file);
    const targetPath = path.join(storyUITargetDir, file);

    if (fs.existsSync(sourcePath)) {
      let content = fs.readFileSync(sourcePath, 'utf-8');

      // Replace Storybook import based on detected framework
      if (file === 'StoryUIPanel.stories.tsx' && storybookFramework !== '@storybook/react') {
        content = content.replace(
          "import type { StoryFn, Meta } from '@storybook/react';",
          `import type { StoryFn, Meta } from '${storybookFramework}';`
        );
      }

      fs.writeFileSync(targetPath, content);
      console.log(chalk.green(`✅ Copied ${file}`));
    } else {
      console.warn(chalk.yellow(`⚠️  Template file not found: ${file}`));
    }
  }

  // Configure Storybook bundler for StoryUIPanel requirements
  console.log(chalk.blue('\n🔧 Configuring Storybook for Story UI...'));
  const mainConfigPath = path.join(process.cwd(), '.storybook', 'main.ts');
  const mainConfigPathJs = path.join(process.cwd(), '.storybook', 'main.js');
  const actualMainPath = fs.existsSync(mainConfigPath) ? mainConfigPath :
                         fs.existsSync(mainConfigPathJs) ? mainConfigPathJs : null;

  if (actualMainPath) {
    let mainContent = fs.readFileSync(actualMainPath, 'utf-8');
    let configUpdated = false;

    // Add Story UI path to stories array if not already present
    const storyUIStoriesPath = `'../src/stories/**/*.@(mdx|stories.@(js|jsx|ts|tsx))'`;
    if (!mainContent.includes('src/stories/**/*')) {
      // Find the stories array and add our path
      const storiesArrayPattern = /(stories\s*:\s*\[[\s\S]*?)(\],?)/;
      const match = mainContent.match(storiesArrayPattern);
      if (match) {
        // Check if the array has content
        const arrayContent = match[1];
        // Add Story UI path at the end of the stories array
        mainContent = mainContent.replace(
          storiesArrayPattern,
          `$1,\n    ${storyUIStoriesPath}\n  $2`
        );
        configUpdated = true;
        console.log(chalk.green('✅ Added Story UI path to Storybook stories array'));
      }
    }

    // Check if StoryUI config already exists
    if (mainContent.includes('@tpitre/story-ui') || mainContent.includes('StoryUIPanel')) {
      console.log(chalk.blue('ℹ️  Storybook already configured for Story UI'));
    } else if (componentFramework === 'angular') {
      // Angular uses webpack - needs CSS loaders
      if (!mainContent.includes('webpackFinal')) {
        const webpackConfig = `webpackFinal: async (config) => {
    // Story UI: Add CSS loader for StoryUIPanel CSS imports
    config.module?.rules?.push({
      test: /\\.css$/,
      use: ['style-loader', 'css-loader'],
    });
    return config;
  },`;
        // Insert webpackFinal inside the config object, before the closing };
        if (mainContent.match(/};\s*\n+\s*export\s+default/)) {
          mainContent = mainContent.replace(
            /(\n)(};\s*\n+\s*export\s+default)/,
            `\n  ${webpackConfig}\n$2`
          );
          configUpdated = true;
        }
      }

      // Install required loaders for Angular
      console.log(chalk.blue('📦 Installing CSS loaders for Angular...'));
      try {
        execSync('npm install --save-dev style-loader css-loader', { stdio: 'inherit' });
        console.log(chalk.green('✅ Installed style-loader and css-loader'));
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Could not install CSS loaders. You may need to run: npm install --save-dev style-loader css-loader'));
      }
    } else if (storybookFramework === '@storybook/web-components-webpack5') {
      // Web Components with Webpack5 - needs babel-loader for TSX
      const hasBabelConfig = mainContent.includes('babel-loader') && mainContent.includes('StoryUI');

      if (!hasBabelConfig) {
        const babelLoaderRule = `
    // Story UI: Add babel-loader for TSX/JSX support (React panel in Web Components project)
    config.module?.rules?.push({
      test: /stories\\/StoryUI\\/.*\\.tsx$/,
      use: {
        loader: 'babel-loader',
        options: {
          presets: [
            ['@babel/preset-react', { runtime: 'automatic' }],
            '@babel/preset-typescript'
          ]
        }
      }
    });`;

        if (mainContent.includes('webpackFinal')) {
          // webpackFinal exists - inject babel-loader rule before return statement
          // Look for the return statement in webpackFinal and insert before it
          const returnPattern = /(webpackFinal[\s\S]*?)(return\s+config\s*;)/;
          if (mainContent.match(returnPattern)) {
            mainContent = mainContent.replace(
              returnPattern,
              `$1${babelLoaderRule}\n\n    $2`
            );
            configUpdated = true;
          }
        } else {
          // webpackFinal doesn't exist - add a complete block
          const webpackConfig = `webpackFinal: async (config) => {${babelLoaderRule}
    return config;
  },`;
          // Insert webpackFinal inside the config object, before the closing };
          if (mainContent.match(/};\s*\n+\s*export\s+default/)) {
            mainContent = mainContent.replace(
              /(\n)(};\s*\n+\s*export\s+default)/,
              `\n  ${webpackConfig}\n$2`
            );
            configUpdated = true;
          }
        }
      }

      // Install required loaders for Web Components Webpack5
      console.log(chalk.blue('📦 Installing babel loaders for Web Components Webpack5...'));
      try {
        execSync('npm install --save-dev babel-loader @babel/preset-react @babel/preset-typescript @babel/core', { stdio: 'inherit' });
        console.log(chalk.green('✅ Installed babel-loader and presets'));
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Could not install babel loaders. You may need to run: npm install --save-dev babel-loader @babel/preset-react @babel/preset-typescript @babel/core'));
      }
    } else {
      // Vite-based frameworks (React, Vue, Svelte, Web Components with Vite)
      if (!mainContent.includes('viteFinal')) {
        const viteConfig = `viteFinal: async (config) => {
    // Story UI: Exclude from dependency optimization to handle CSS imports correctly
    config.optimizeDeps = {
      ...config.optimizeDeps,
      exclude: [
        ...(config.optimizeDeps?.exclude || []),
        '@tpitre/story-ui'
      ]
    };
    return config;
  },`;
        // Insert viteFinal inside the config object, before the closing };
        // Find the last property line and add viteFinal after it
        // Pattern: match the closing }; that ends the config object (before export default)
        if (mainContent.match(/};\s*\n+\s*export\s+default/)) {
          mainContent = mainContent.replace(
            /(\n)(};\s*\n+\s*export\s+default)/,
            `\n  ${viteConfig}\n$2`
          );
          configUpdated = true;
        }
      }
    }

    // For Web Components: Update tsconfig.json for TSX support
    if (componentFramework === 'web-components') {
      const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
      if (fs.existsSync(tsconfigPath)) {
        try {
          let tsconfigContent = fs.readFileSync(tsconfigPath, 'utf-8');
          if (!tsconfigContent.includes('"jsx"')) {
            // Add jsx config for TSX compilation
            tsconfigContent = tsconfigContent.replace(
              /"compilerOptions"\s*:\s*\{/,
              '"compilerOptions": {\n    "jsx": "react-jsx",'
            );
            fs.writeFileSync(tsconfigPath, tsconfigContent);
            console.log(chalk.green('✅ Added JSX support to tsconfig.json'));
          }
        } catch (error) {
          console.warn(chalk.yellow('⚠️  Could not update tsconfig.json. You may need to add "jsx": "react-jsx" manually.'));
        }
      }
    }

    if (configUpdated) {
      fs.writeFileSync(actualMainPath, mainContent);
      console.log(chalk.green('✅ Updated Storybook configuration for Story UI'));
    }
  } else {
    console.warn(chalk.yellow('⚠️  Could not find .storybook/main.ts or main.js'));
  }

  // Create considerations file
  const considerationsTemplatePath = path.resolve(__dirname, '../../templates/story-ui-considerations.md');
  const considerationsPath = path.join(process.cwd(), 'story-ui-considerations.md');

  if (!fs.existsSync(considerationsPath) && fs.existsSync(considerationsTemplatePath)) {
    let considerationsContent = fs.readFileSync(considerationsTemplatePath, 'utf-8');

    // Customize based on selected design system
    if (config.importPath) {
      considerationsContent = considerationsContent.replace('[Your Component Library]', config.importPath);
      considerationsContent = considerationsContent.replace('[your-import-path]', config.importPath);
    }

    fs.writeFileSync(considerationsPath, considerationsContent);
    console.log(chalk.green('✅ Created story-ui-considerations.md for AI customization'));
  }

  // Create documentation directory structure
  const docsDir = path.join(process.cwd(), 'story-ui-docs');
  if (!fs.existsSync(docsDir)) {
    console.log(chalk.blue('\n📚 Creating documentation directory structure...'));
    
    // Create main directory and subdirectories
    const subdirs = ['guidelines', 'tokens', 'components', 'patterns'];
    fs.mkdirSync(docsDir, { recursive: true });
    
    for (const subdir of subdirs) {
      fs.mkdirSync(path.join(docsDir, subdir), { recursive: true });
    }

    // Copy README template
    const docsReadmeTemplatePath = path.resolve(__dirname, '../../templates/story-ui-docs-README.md');
    const docsReadmePath = path.join(docsDir, 'README.md');
    
    if (fs.existsSync(docsReadmeTemplatePath)) {
      fs.writeFileSync(docsReadmePath, fs.readFileSync(docsReadmeTemplatePath, 'utf-8'));
    }
    
    console.log(chalk.green('✅ Created story-ui-docs/ directory structure'));
    console.log(chalk.gray('   Add your design system documentation to enhance AI story generation'));
  }

  // Create .env file with provider-specific configuration
  const envPath = path.join(process.cwd(), '.env');
  const selectedProvider = answers.llmProvider || 'claude';
  const providerConfig = LLM_PROVIDERS[selectedProvider as keyof typeof LLM_PROVIDERS];

  if (!fs.existsSync(envPath)) {
    // Generate .env content based on selected provider
    let envContent = `# Story UI Configuration
# Generated by: npx story-ui init

# LLM Provider: ${providerConfig?.name || selectedProvider}
LLM_PROVIDER=${selectedProvider}

# API Key for ${providerConfig?.name || selectedProvider}
# Get your key from: ${providerConfig?.docsUrl || 'your provider dashboard'}
${providerConfig?.envKey || 'API_KEY'}=${answers.apiKey || 'your-api-key-here'}

# Story UI MCP Server Port
VITE_STORY_UI_PORT=${answers.mcpPort || '4001'}

# Optional: Add additional provider keys if you want to switch providers later
# ANTHROPIC_API_KEY=your-anthropic-key
# OPENAI_API_KEY=your-openai-key
# GEMINI_API_KEY=your-gemini-key
`;

    fs.writeFileSync(envPath, envContent);
    console.log(chalk.green(`✅ Created .env file for ${providerConfig?.name || selectedProvider}${answers.apiKey ? ' with your API key' : ''}`));
  } else {
    console.log(chalk.yellow('⚠️  .env file already exists, skipping'));
  }

  // Add .env to .gitignore if not already there
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    // NOTE: Do NOT add StoryUI/ to gitignore - it must be committed for production deployments
    // The StoryUI panel component needs to be deployed to Railway/production environments
    const patterns = [
      '.env',
      path.relative(process.cwd(), config.generatedStoriesPath),
      '.story-ui-history/'
    ];

    let gitignoreUpdated = false;
    for (const pattern of patterns) {
      if (!gitignoreContent.includes(pattern)) {
        fs.appendFileSync(gitignorePath, `\n${pattern}`);
        gitignoreUpdated = true;
      }
    }

    if (gitignoreUpdated) {
      fs.appendFileSync(gitignorePath, '\n');
      console.log(chalk.green(`✅ Updated .gitignore with Story UI patterns`));
    }
  }

  // Clean up default Storybook template components to prevent conflicts
  cleanupDefaultStorybookComponents();

  // Update package.json with convenience scripts
  if (packageJson) {
    const scripts = packageJson.scripts || {};
    // FIRST_EDIT: include chosen port in script
    const portFlag = `--port ${answers.mcpPort || '4001'}`;

    if (!scripts['story-ui']) {
      scripts['story-ui'] = `story-ui start ${portFlag}`;
    } else if (!scripts['story-ui'].includes('--port')) {
      scripts['story-ui'] += ` ${portFlag}`;
    }

    if (!scripts['storybook-with-ui'] && scripts['storybook']) {
      scripts['storybook-with-ui'] = 'concurrently "npm run storybook" "npm run story-ui"';
    }

    packageJson.scripts = scripts;
    
    // Check and add required dependencies
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};
    let needsInstall = false;
    
    
    // Check for concurrently (needed for storybook-with-ui script)
    if (!dependencies['concurrently'] && !devDependencies['concurrently']) {
      console.log(chalk.blue('📦 Adding concurrently dependency...'));
      devDependencies['concurrently'] = '^8.2.0';
      needsInstall = true;
    }
    
    packageJson.dependencies = dependencies;
    packageJson.devDependencies = devDependencies;
    
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(chalk.green('✅ Added convenience scripts to package.json'));
    
    if (needsInstall) {
      console.log(chalk.blue('\n📦 Installing required dependencies...'));
      console.log(chalk.gray('This may take a moment...\n'));
      
      // Detect package manager
      const npmLock = fs.existsSync(path.join(process.cwd(), 'package-lock.json'));
      const yarnLock = fs.existsSync(path.join(process.cwd(), 'yarn.lock'));
      const pnpmLock = fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'));
      
      let installCommand = 'npm install';
      if (yarnLock) {
        installCommand = 'yarn install';
      } else if (pnpmLock) {
        installCommand = 'pnpm install';
      }
      
      try {
        execSync(installCommand, { stdio: 'inherit' });
        console.log(chalk.green('✅ Dependencies installed successfully'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Failed to install dependencies automatically.'));
        console.log(chalk.yellow(`   Please run "${installCommand}" manually to complete the setup.`));
      }
    }
  }


  console.log(chalk.green.bold('\n🎉 Setup complete!\n'));
  console.log(`📁 Configuration saved to: ${chalk.cyan(configPath)}`);
  console.log(`📁 Generated stories will be saved to: ${chalk.cyan(config.generatedStoriesPath)}`);
  console.log(`📁 Story UI component installed to: ${chalk.cyan(path.relative(process.cwd(), storyUITargetDir))}`);

  if (config.importPath) {
    console.log(`📦 Import path: ${chalk.cyan(config.importPath)}`);
  }

  if (!answers.apiKey) {
    const provider = LLM_PROVIDERS[answers.llmProvider as keyof typeof LLM_PROVIDERS] || LLM_PROVIDERS.claude;
    console.log(chalk.yellow(`\n⚠️  Don't forget to add your ${provider.name} API key to .env file!`));
    console.log(`   Get your key from: ${provider.docsUrl}`);
  }

  const providerName = LLM_PROVIDERS[answers.llmProvider as keyof typeof LLM_PROVIDERS]?.name || 'your LLM provider';
  console.log('\n🚀 Next steps:');
  console.log('1. ' + (answers.apiKey ? 'Start' : `Add your ${providerName} API key to .env, then start`) + ' Story UI: npm run story-ui');
  console.log('2. Start Storybook: npm run storybook');
  console.log('3. Navigate to "Story UI > Story Generator" in your Storybook sidebar');
  console.log('4. Start generating UI with natural language prompts!');

  console.log('\n💡 Tips:');
  console.log('- Run both together: npm run storybook-with-ui');
  console.log('- Generated stories are automatically excluded from git');
  console.log('- The Story UI panel is in your stories under "Story UI/Story Generator"');
  console.log('- You can modify story-ui.config.js to customize the configuration');
}
