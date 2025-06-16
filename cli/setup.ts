import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { autoDetectDesignSystem } from '../story-generator/configLoader.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SetupAnswers {
  designSystem: 'auto' | 'mui' | 'chakra' | 'antd' | 'mantine' | 'custom';
  importPath?: string;
  componentPrefix?: string;
  generatedStoriesPath?: string;
  componentsPath?: string;
  hasApiKey?: boolean;
  apiKey?: string;
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
      fs.copyFileSync(sourcePath, targetPath);
      console.log(chalk.green(`✅ Copied ${file}`));
    } else {
      console.warn(chalk.yellow(`⚠️  Template file not found: ${file}`));
    }
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

    if (!scripts['story-ui']) {
      scripts['story-ui'] = 'story-ui start';
    }

    if (!scripts['storybook-with-ui'] && scripts['storybook']) {
      scripts['storybook-with-ui'] = 'concurrently "npm run storybook" "npm run story-ui"';
    }

    packageJson.scripts = scripts;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(chalk.green('✅ Added convenience scripts to package.json'));
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
