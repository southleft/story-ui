#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupProductionGitignore } from '../story-generator/productionGitignoreManager.js';
import { createStoryUIConfig } from '../story-ui.config.js';
import { setupCommand, cleanupDefaultStorybookComponents } from './setup.js';
import { deployCommand } from './deploy.js';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('story-ui')
  .description('AI-powered Storybook story generator for React component libraries')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Story UI configuration with interactive setup')
  .option('-d, --design-system <system>', 'Design system to configure (shadcn, mantine, chakra, antd, mui)')
  .option('-y, --yes', 'Skip interactive prompts and use defaults')
  .option('--skip-install', 'Skip package installation')
  .action(async (options) => {
    await setupCommand(options);
  });

program
  .command('start')
  .description('Start the Story UI server')
  .option('-p, --port <port>', 'Port to run the server on', '4001')
  .option('-c, --config <config>', 'Path to configuration file')
  .action(async (options) => {
    console.log('🚀 Starting Story UI server...');

    // Use absolute path to avoid dist/dist issue when package is linked
    const pkgRoot = path.resolve(__dirname, '..');
    const serverPath = path.join(pkgRoot, 'mcp-server/index.js');
    console.log(`✅ Using MCP server at: ${serverPath}`);

    // FIRST_EDIT: determine an available port
    const requestedPort = parseInt(options.port || '4001', 10);

    const isPortFree = (port: number) => {
      return new Promise<boolean>((resolve) => {
        const tester = net.createServer()
          .once('error', () => resolve(false))
          .once('listening', () => {
            tester.close();
            resolve(true);
          })
          .listen(port);
      });
    };

    let finalPort = requestedPort;
    // eslint-disable-next-line no-await-in-loop
    while (!(await isPortFree(finalPort))) {
      finalPort += 1;
    }

    if (finalPort !== requestedPort) {
      console.log(`⚠️  Port ${requestedPort} is in use. Using ${finalPort} instead.`);
    }

    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(finalPort) };

    if (options.config) {
      env.STORY_UI_CONFIG_PATH = options.config;
    }

    const server = spawn('node', [serverPath], {
      stdio: 'inherit',
      env
    });

    server.on('close', (code) => {
      console.log(`Server exited with code ${code}`);
    });

    process.on('SIGINT', () => {
      server.kill('SIGINT');
    });
  });

program
  .command('config')
  .description('Configuration utilities')
  .option('--generate', 'Generate a sample configuration file')
  .option('--type <type>', 'Configuration file type (json|js)', 'js')
  .action((options) => {
    if (options.generate) {
      const filename = `story-ui.config.${options.type}`;
      generateSampleConfig(filename, options.type);
      console.log(`✅ Sample configuration generated: ${filename}`);
    }
  });

program
  .command('setup-gitignore')
  .description('Set up .gitignore for Story UI generated stories')
  .option('-c, --config <path>', 'Path to Story UI config file', 'story-ui.config.js')
  .action(async (options) => {
    console.log('🔧 Setting up .gitignore for Story UI...');

    try {
      const configPath = path.resolve(process.cwd(), options.config);
      const configModule = await import(configPath);
      const userConfig = configModule.default;
      const fullConfig = createStoryUIConfig(userConfig);

      const manager = setupProductionGitignore(fullConfig);

      if (manager.isProductionMode()) {
        console.log('🌐 Production environment detected');
        console.log('✅ Gitignore validation completed');
      } else {
        console.log('🔧 Development environment - gitignore updated');
      }

      console.log('✅ Gitignore setup completed successfully!');
    } catch (error) {
      console.error('❌ Failed to set up gitignore:', error);
      console.log('💡 Make sure you have a valid story-ui.config.js file');
      process.exit(1);
    }
  });



async function autoDetectAndCreateConfig() {
  const cwd = process.cwd();
  const config: any = {
    generatedStoriesPath: './src/stories/generated',
    storyPrefix: 'Generated/',
    defaultAuthor: 'Story UI AI',
    componentPrefix: '',
    layoutRules: {
      multiColumnWrapper: 'div',
      columnComponent: 'div',
      layoutExamples: {
        twoColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
</div>`
      },
      prohibitedElements: []
    }
  };

  // Try to detect package.json
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    config.importPath = packageJson.name || 'your-component-library';
  }

  // Try to detect components directory
  const possibleComponentPaths = [
    './src/components',
    './lib/components',
    './components',
    './src'
  ];

  for (const possiblePath of possibleComponentPaths) {
    if (fs.existsSync(path.join(cwd, possiblePath))) {
      config.componentsPath = possiblePath;
      break;
    }
  }

  writeConfig(config, 'js');
}

async function createTemplateConfig(template: string) {
  let config: any;

  switch (template) {
    case 'chakra-ui':
      config = {
        importPath: '@chakra-ui/react',
        componentPrefix: '',
        layoutRules: {
          multiColumnWrapper: 'SimpleGrid',
          columnComponent: 'Box',
          layoutExamples: {
            twoColumn: `<SimpleGrid columns={2} spacing={4}>
  <Box><Card>Left content</Card></Box>
  <Box><Card>Right content</Card></Box>
</SimpleGrid>`
          }
        }
      };
      break;

    case 'ant-design':
      config = {
        importPath: 'antd',
        componentPrefix: '',
        layoutRules: {
          multiColumnWrapper: 'Row',
          columnComponent: 'Col',
          layoutExamples: {
            twoColumn: `<Row gutter={16}>
  <Col span={12}><Card>Left content</Card></Col>
  <Col span={12}><Card>Right content</Card></Col>
</Row>`
          }
        }
      };
      break;

    default:
      throw new Error(`Unknown template: ${template}`);
  }

  // Add common defaults
  config = {
    generatedStoriesPath: './src/stories/generated',
    componentsPath: './src/components',
    storyPrefix: 'Generated/',
    defaultAuthor: 'Story UI AI',
    ...config
  };

  writeConfig(config, 'js');
}

async function createBasicConfig() {
  const config = {
    generatedStoriesPath: './src/stories/generated',
    componentsPath: './src/components',
    storyPrefix: 'Generated/',
    defaultAuthor: 'Story UI AI',
    importPath: 'your-component-library',
    componentPrefix: '',
    layoutRules: {
      multiColumnWrapper: 'div',
      columnComponent: 'div',
      layoutExamples: {
        twoColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
</div>`
      },
      prohibitedElements: []
    }
  };

  writeConfig(config, 'js');
}

function generateSampleConfig(filename: string, type: 'json' | 'js') {
  const config = {
    generatedStoriesPath: './src/stories/generated',
    componentsPath: './src/components',
    storyPrefix: 'Generated/',
    defaultAuthor: 'Story UI AI',
    importPath: 'your-component-library',
    componentPrefix: 'UI',
    layoutRules: {
      multiColumnWrapper: 'UIGrid',
      columnComponent: 'UIColumn',
      layoutExamples: {
        twoColumn: `<UIGrid columns={2}>
  <UIColumn><UICard>Left content</UICard></UIColumn>
  <UIColumn><UICard>Right content</UICard></UIColumn>
</UIGrid>`
      },
      prohibitedElements: []
    }
  };

  writeConfig(config, type, filename);
}

function writeConfig(config: any, type: 'json' | 'js', filename?: string) {
  const outputFile = filename || `story-ui.config.${type}`;

  if (type === 'json') {
    fs.writeFileSync(outputFile, JSON.stringify(config, null, 2));
  } else {
    const jsContent = `export default ${JSON.stringify(config, null, 2)};`;
    fs.writeFileSync(outputFile, jsContent);
  }
}

program
  .command('cleanup')
  .description('Remove default Storybook template files that conflict with component discovery')
  .action(() => {
    console.log('🧹 Cleaning up default Storybook template files...');
    cleanupDefaultStorybookComponents();
    console.log('✅ Cleanup complete! Component discovery should now work properly.');
  });

program
  .command('deploy')
  .description('Deploy Story UI to production (backend + standalone app)')
  // New recommended approach
  .option('--backend', 'Deploy MCP server backend to Railway/Render/Fly.io')
  .option('--app', 'Deploy standalone production app (Lovable/Bolt-style with live preview)')
  .option('--frontend', 'Deploy Storybook frontend (legacy, use --app instead)')
  .option('--platform <platform>', 'Backend platform: railway (default), render, fly', 'railway')
  .option('--backend-url <url>', 'Use existing backend URL for app/frontend deployment')
  .option('--storybook-dir <dir>', 'Path to Storybook project (for --frontend only)')
  .option('--project-name <name>', 'Project name prefix', 'story-ui')
  .option('--dry-run', 'Show what would be deployed without deploying')
  // Legacy flags (deprecated)
  .option('--init', '[DEPRECATED] Initialize deployment templates')
  .option('--edge', '[DEPRECATED] Deploy Edge Worker only')
  .option('--pages', '[DEPRECATED] Deploy Pages UI only')
  .option('--all', '[DEPRECATED] Deploy both Edge Worker and Pages UI')
  .action(async (options) => {
    await deployCommand(options);
  });

program
  .command('mcp')
  .description('Start Story UI as an MCP server (for use with Claude Desktop and other MCP clients)')
  .option('--http-port <port>', 'Port for the HTTP server', '4001')
  .action(async (options) => {
    // For MCP mode, DO NOT output anything to stdout - it's reserved for JSON-RPC
    // Use stderr for all logging
    console.error('🚀 Starting Story UI as MCP server...');
    console.error('📡 This server uses stdio transport for MCP communication');
    console.error('⚠️  Note: The HTTP server must be running on port ' + options.httpPort);
    console.error('    Run "story-ui start" in another terminal if not already running.\n');

    // Use absolute path to MCP stdio server
    const pkgRoot = path.resolve(__dirname, '..');
    const mcpServerPath = path.join(pkgRoot, 'mcp-server/mcp-stdio-server.js');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      STORY_UI_HTTP_PORT: options.httpPort
    };

    const mcpServer = spawn('node', [mcpServerPath], {
      stdio: 'inherit',
      env
    });

    mcpServer.on('close', (code) => {
      console.error(`MCP server exited with code ${code}`);
    });

    process.on('SIGINT', () => {
      mcpServer.kill('SIGINT');
    });
  });

program.parse(process.argv);
