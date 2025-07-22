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
  if (['antd', 'mantine', 'chakra'].includes(designSystem)) {
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
    antd: {
      imports: [
        "import type { Preview } from '@storybook/react-vite'",
        "import { ConfigProvider } from 'antd'",
        "import React from 'react'"
      ],
      decorator: `(Story) => (
      <ConfigProvider>
        <Story />
      </ConfigProvider>
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
  designSystem: 'auto' | 'chakra' | 'antd' | 'mantine' | 'custom';
  installDesignSystem?: boolean;
  importPath?: string;
  componentPrefix?: string;
  generatedStoriesPath?: string;
  componentsPath?: string;
  hasApiKey?: boolean;
  apiKey?: string;
  mcpPort?: string;
}

// Design system installation configurations
const DESIGN_SYSTEM_CONFIGS = {
  antd: {
    packages: ['antd'],
    name: 'Ant Design',
    importPath: 'antd',
    additionalSetup: 'import "antd/dist/reset.css";'
  },
  mantine: {
    packages: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
    name: 'Mantine',
    importPath: '@mantine/core',
    additionalSetup: 'import "@mantine/core/styles.css";'
  },
  chakra: {
    packages: ['@chakra-ui/react', '@emotion/react', '@emotion/styled', 'framer-motion'],
    name: 'Chakra UI',
    importPath: '@chakra-ui/react',
    additionalSetup: 'import { ChakraProvider } from "@chakra-ui/react";'
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

export async function setupCommand() {
  console.log(chalk.blue.bold('\n🎨 Story UI Setup\n'));
  console.log('This will help you configure Story UI for your design system.\n');

  // Check if we're in a valid project
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(chalk.red('❌ No package.json found. Please run this command in your project root.'));
    process.exit(1);
  }

  // Check if Storybook is installed
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const hasStorybook = packageJson.devDependencies?.['@storybook/react'] ||
                      packageJson.dependencies?.['@storybook/react'] ||
                      fs.existsSync(path.join(process.cwd(), '.storybook'));

  if (!hasStorybook) {
    console.warn(chalk.yellow('⚠️  Storybook not detected. Story UI works best with Storybook installed.'));
    console.log('Install Storybook first: npx storybook@latest init\n');
  }

  // Detect Storybook framework (Vite vs Webpack)
  let storybookFramework = '@storybook/react'; // default
  const devDeps = packageJson.devDependencies || {};
  const deps = packageJson.dependencies || {};

  // Check for Vite-based Storybook
  if (devDeps['@storybook/react-vite'] || deps['@storybook/react-vite']) {
    storybookFramework = '@storybook/react-vite';
    console.log(chalk.green('✅ Detected Vite-based Storybook'));
  } else if (devDeps['@storybook/react-webpack5'] || deps['@storybook/react-webpack5']) {
    storybookFramework = '@storybook/react-webpack5';
    console.log(chalk.green('✅ Detected Webpack 5-based Storybook'));
  } else if (devDeps['@storybook/nextjs'] || deps['@storybook/nextjs']) {
    storybookFramework = '@storybook/nextjs';
    console.log(chalk.green('✅ Detected Next.js Storybook'));
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

  const answers = await inquirer.prompt<SetupAnswers>([
    {
      type: 'list',
      name: 'designSystem',
      message: 'Which design system are you using?',
      choices: [
        { name: '🤖 Auto-detect from package.json', value: 'auto' },
        { name: '🐜 Ant Design (antd) - Install & Configure', value: 'antd' },
        { name: '🎯 Mantine (@mantine/core) - Install & Configure', value: 'mantine' },
        { name: '⚡ Chakra UI (@chakra-ui/react) - Install & Configure', value: 'chakra' },
        { name: '🔧 Custom/Other', value: 'custom' }
      ],
      default: autoDetected ? 'auto' : 'custom'
    },
    {
      type: 'confirm',
      name: 'installDesignSystem',
      message: (answers) => {
        const systemName = answers.designSystem === 'antd' ? 'Ant Design' : 
                          answers.designSystem === 'mantine' ? 'Mantine' :
                          answers.designSystem === 'chakra' ? 'Chakra UI' : 'the design system';
        return `Would you like to install ${systemName} and its dependencies now?`;
      },
      when: (answers) => ['antd', 'mantine', 'chakra'].includes(answers.designSystem),
      default: true
    },
    {
      type: 'input',
      name: 'importPath',
      message: 'What is the import path for your components?',
      when: (answers) => answers.designSystem === 'custom',
      validate: (input) => input.trim() ? true : 'Import path is required'
    },
    {
      type: 'input',
      name: 'componentPrefix',
      message: 'Do your components have a prefix? (e.g., "AL" for ALButton)',
      when: (answers) => answers.designSystem === 'custom',
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
      when: (answers) => answers.designSystem === 'custom'
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
      type: 'confirm',
      name: 'hasApiKey',
      message: 'Do you have a Claude API key? (You can add it later)',
      default: false
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your Claude API key:',
      when: (answers) => answers.hasApiKey,
      validate: (input) => input.trim() ? true : 'API key is required'
    }
  ]);

  // Install design system if requested
  if (answers.installDesignSystem && ['antd', 'mantine', 'chakra'].includes(answers.designSystem)) {
    const installSuccess = await installDesignSystem(answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS);
    if (!installSuccess) {
      console.log(chalk.red('❌ Installation failed! Cannot continue without required dependencies.'));
      console.log(chalk.yellow('Please install manually and run setup again:'));
      const config = DESIGN_SYSTEM_CONFIGS[answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
      console.log(chalk.cyan(`npm install ${config.packages.join(' ')}`));
      process.exit(1);
    }
    
    // Set up Storybook preview file after successful installation
    setupStorybookPreview(answers.designSystem);
  } else if (['antd', 'mantine', 'chakra'].includes(answers.designSystem)) {
    // User declined installation - verify dependencies exist
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const config = DESIGN_SYSTEM_CONFIGS[answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
      const missingDeps = config.packages.filter(pkg => !allDeps[pkg]);
      
      if (missingDeps.length > 0) {
        console.log(chalk.red('❌ Required dependencies missing:'), missingDeps.join(', '));
        console.log(chalk.yellow('Please install them manually:'));
        console.log(chalk.cyan(`npm install ${missingDeps.join(' ')}`));
        process.exit(1);
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
  } else if (answers.designSystem === 'antd') {
    config = {
      importPath: 'antd',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'Row',
        columnComponent: 'Col',
        containerComponent: 'div',
        layoutExamples: {
          twoColumn: `<Row gutter={16}>
  <Col span={12}>
    <Card title="Left Card" bordered={false}>
      <p>Left content goes here</p>
    </Card>
  </Col>
  <Col span={12}>
    <Card title="Right Card" bordered={false}>
      <p>Right content goes here</p>
    </Card>
  </Col>
</Row>`
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


  // Create configuration file
  const configContent = `module.exports = ${JSON.stringify(config, null, 2)};`;
  const configPath = path.join(process.cwd(), 'story-ui.config.js');

  fs.writeFileSync(configPath, configContent);


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
  const componentFiles = ['StoryUIPanel.tsx', 'StoryUIPanel.stories.tsx'];

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

  // Create .env file from template
  const envSamplePath = path.resolve(__dirname, '../../.env.sample');
  const envPath = path.join(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envSamplePath)) {
      let envContent = fs.readFileSync(envSamplePath, 'utf-8');

      // If user provided API key, update the template
      if (answers.apiKey) {
        envContent = envContent.replace('your-claude-api-key-here', answers.apiKey);
      }
      
      // Update the VITE_STORY_UI_PORT with the chosen port
      if (answers.mcpPort) {
        envContent = envContent.replace('VITE_STORY_UI_PORT=4001', `VITE_STORY_UI_PORT=${answers.mcpPort}`);
      }

      fs.writeFileSync(envPath, envContent);
      console.log(chalk.green(`✅ Created .env file${answers.apiKey ? ' with your API key' : ''}`));
    }
  } else {
    console.log(chalk.yellow('⚠️  .env file already exists, skipping'));
  }

  // Add .env to .gitignore if not already there
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    const patterns = [
      '.env',
      path.relative(process.cwd(), config.generatedStoriesPath),
      `${path.relative(process.cwd(), storiesDir)}/StoryUI/`
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
    console.log(chalk.yellow('\n⚠️  Don\'t forget to add your Claude API key to .env file!'));
    console.log('   Get your key from: https://console.anthropic.com/');
  }

  console.log('\n🚀 Next steps:');
  console.log('1. ' + (answers.apiKey ? 'Start' : 'Add your Claude API key to .env, then start') + ' Story UI: npm run story-ui');
  console.log('2. Start Storybook: npm run storybook');
  console.log('3. Navigate to "Story UI > Story Generator" in your Storybook sidebar');
  console.log('4. Start generating UI with natural language prompts!');

  console.log('\n💡 Tips:');
  console.log('- Run both together: npm run storybook-with-ui');
  console.log('- Generated stories are automatically excluded from git');
  console.log('- The Story UI panel is in your stories under "Story UI/Story Generator"');
  console.log('- You can modify story-ui.config.js to customize the configuration');
}
