import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { autoDetectDesignSystem } from '../story-generator/configLoader.js';
import { fileURLToPath } from 'url';
import net from 'net';

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

interface SetupAnswers {
  designSystem: 'auto' | 'mui' | 'chakra' | 'antd' | 'mantine' | 'spectrum' | 'custom';
  importPath?: string;
  componentPrefix?: string;
  generatedStoriesPath?: string;
  componentsPath?: string;
  hasApiKey?: boolean;
  apiKey?: string;
  enableContext7?: boolean;
  mcpPort?: string;
}

// Context7 configuration is now handled entirely through MCP tools
// No local configuration files are created

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
        { name: '🎨 Material-UI (@mui/material)', value: 'mui' },
        { name: '⚡ Chakra UI (@chakra-ui/react)', value: 'chakra' },
        { name: '🐜 Ant Design (antd)', value: 'antd' },
        { name: '🎯 Mantine (@mantine/core)', value: 'mantine' },
        { name: '🎭 Adobe Spectrum (@adobe/react-spectrum)', value: 'spectrum' },
        { name: '🔧 Custom/Other', value: 'custom' }
      ],
      default: autoDetected ? 'auto' : 'custom'
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

  // Generate configuration
  let config: any = {};

  if (answers.designSystem === 'auto' && autoDetected) {
    config = autoDetected;
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
        <Typography variant="h5">Left Card</Typography>
        <Typography>Left content</Typography>
      </CardContent>
    </Card>
  </Grid>
  <Grid item xs={6}>
    <Card>
      <CardContent>
        <Typography variant="h5">Right Card</Typography>
        <Typography>Right content</Typography>
      </CardContent>
    </Card>
  </Grid>
</Grid>`
        }
      }
    };
  } else if (answers.designSystem === 'chakra') {
    config = {
      importPath: '@chakra-ui/react',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'SimpleGrid',
        columnComponent: 'Box',
        containerComponent: 'Container'
      }
    };
  } else if (answers.designSystem === 'antd') {
    config = {
      importPath: 'antd',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'Row',
        columnComponent: 'Col',
        containerComponent: 'div'
      }
    };
  } else if (answers.designSystem === 'mantine') {
    config = {
      importPath: '@mantine/core',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'SimpleGrid',
        columnComponent: 'div',
        containerComponent: 'Container'
      }
    };
  } else if (answers.designSystem === 'spectrum') {
    config = {
      importPath: '@adobe/react-spectrum',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'Flex',
        columnComponent: 'View',
        containerComponent: 'View',
        layoutExamples: {
          twoColumn: `<Flex gap="size-200">
  <View>Column 1 content</View>
  <View>Column 2 content</View>
</Flex>`,
          threeColumn: `<Flex gap="size-200">
  <View>Column 1</View>
  <View>Column 2</View>
  <View>Column 3</View>
</Flex>`,
          grid: `<View display="grid" gridTemplateColumns="repeat(auto-fill, minmax(300px, 1fr))" gap="size-200">
  <View>Item 1</View>
  <View>Item 2</View>
  <View>Item 3</View>
</View>`
        },
        prohibitedElements: ['div', 'span', 'section']
      },
      systemPrompt: 'You are an expert UI developer creating Storybook stories for Adobe Spectrum React components. Use ONLY the React components from @adobe/react-spectrum listed below. Adobe Spectrum uses a token-based spacing and sizing system (e.g., size-100, size-200, gap="size-200"). Never import from @internationalized/date unless specifically working with date/time components. For layout, use Flex and View components, not HTML div elements.',
      additionalImports: [
        {
          path: '@internationalized/date',
          components: ['parseDate', 'today', 'getLocalTimeZone', 'now', 'CalendarDate', 'CalendarDateTime', 'Time', 'ZonedDateTime']
        },
        {
          path: '@spectrum-icons/workflow',
          components: [
            'Add', 'Alert', 'Archive', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
            'Audio', 'Back', 'Bell', 'Bookmark', 'Calendar', 'Camera', 'Chat',
            'ChevronDown', 'ChevronLeft', 'ChevronRight', 'ChevronUp', 'Clock', 'Close', 'Cloud',
            'Comment', 'Copy', 'Cut', 'Data', 'Delete', 'Document', 'Download',
            'Draft', 'Duplicate', 'Edit', 'Email', 'Export', 'Filter', 'Flag',
            'Folder', 'Forward', 'FullScreen', 'Group', 'Heart', 'Help', 'History',
            'Home', 'Image', 'Import', 'Info', 'Label', 'Link', 'Location',
            'Maximize', 'Menu', 'Merge', 'Minimize', 'More', 'Move', 'Paste',
            'Pause', 'Pending', 'Play', 'Print', 'Question', 'Redo', 'Refresh',
            'Rename', 'Reply', 'Search', 'Settings', 'Share', 'Star', 'Stop',
            'Sync', 'ThumbDown', 'ThumbUp', 'Undo', 'Ungroup', 'User', 'Workflow',
            'ZoomIn', 'ZoomOut'
          ]
        }
      ]
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
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(chalk.green('✅ Added convenience scripts to package.json'));
  }

  // Check if documentation scraping is supported for this design system
  const supportedDocSystems = ['@shopify/polaris', '@mui/material', '@chakra-ui/react', 'antd', '@mantine/core', '@adobe/react-spectrum'];
  const supportsDocScraping = supportedDocSystems.includes(config.importPath);

  if (supportsDocScraping) {
    console.log(chalk.blue('\n📚 Documentation Enhancement Available\n'));
    console.log(`Story UI can scrape the official ${config.importPath} documentation to generate more accurate stories.`);
    console.log('This will provide:');
    console.log('  ✅ Exact spacing tokens and design patterns');
    console.log('  ✅ Component best practices and examples');
    console.log('  ✅ Accessibility guidelines');
    console.log('  ✅ Content writing guidelines\n');

    const { shouldScrape } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldScrape',
        message: 'Would you like to enhance Story UI with official documentation?',
        default: true
      }
    ]);

    if (shouldScrape) {
      console.log(chalk.gray('\nNote: Documentation scraping will be available in the next version.'));
      console.log(chalk.gray('For now, Story UI will use its built-in knowledge of design systems.\n'));

      // In future version, this would run:
      // await runDocumentationScraper(config.importPath);
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
