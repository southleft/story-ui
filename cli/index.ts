#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupCommand, cleanupDefaultStorybookComponents } from './setup.js';
import { deployCommand } from './deploy.js';
import { updateCommand, statusCommand } from './update.js';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const packageVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version;

const program = new Command();

program
  .name('story-ui')
  .description('AI-powered Storybook story generator for React component libraries')
  .version(packageVersion);

program
  .command('init')
  .description('Initialize Story UI configuration with interactive setup')
  .option('-d, --design-system <system>', 'Design system to configure (mantine, vuetify, angular-material, skeleton-ui, shoelace)')
  .option('-l, --llm-provider <provider>', 'LLM provider to use (claude, openai, gemini)')
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
  .option('--mcp', 'Also start MCP stdio server for Claude Desktop integration')
  .action(async (options) => {
    // Use stderr for all logging to avoid breaking MCP JSON-RPC protocol
    // when Claude Desktop spawns this process
    console.error('🚀 Starting Story UI server...');

    // Use absolute path to avoid dist/dist issue when package is linked
    const pkgRoot = path.resolve(__dirname, '..');
    const serverPath = path.join(pkgRoot, 'mcp-server/index.js');
    const mcpStdioPath = path.join(pkgRoot, 'mcp-server/mcp-stdio-server.js');
    console.error(`✅ Using HTTP server at: ${serverPath}`);

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
      console.error(`⚠️  Port ${requestedPort} is in use. Using ${finalPort} instead.`);
    }

    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(finalPort) };

    // Set memory limit to prevent heap exhaustion during vision/image processing
    // Default to 8GB for handling large images and self-healing retry loops
    if (!env.NODE_OPTIONS?.includes('--max-old-space-size')) {
      env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --max-old-space-size=8192`.trim();
    }

    if (options.config) {
      env.STORY_UI_CONFIG_PATH = options.config;
    }

    // Log the working directory for debugging
    console.error(`📁 Working directory: ${process.cwd()}`);

    // Redirect child stdout to stderr to avoid breaking MCP JSON-RPC protocol
    // when Claude Desktop spawns this process. The HTTP server logs will still
    // be visible but won't interfere with MCP communication.
    const server = spawn('node', [serverPath], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env,
      cwd: process.cwd()  // Explicitly pass cwd to ensure config is found
    });

    // Pipe child's stdout to stderr so logs are visible without breaking MCP
    if (server.stdout) {
      server.stdout.pipe(process.stderr);
    }

    server.on('close', (code) => {
      console.error(`HTTP server exited with code ${code}`);
    });

    // If --mcp flag is set, also start the MCP stdio server for Claude Desktop
    // This allows a single command to run both HTTP server and MCP protocol handler
    if (options.mcp) {
      console.error('📡 Starting MCP stdio server for Claude Desktop...');

      // Wait a moment for HTTP server to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      const mcpEnv: NodeJS.ProcessEnv = {
        ...process.env,
        STORY_UI_HTTP_PORT: String(finalPort)
      };

      // Spawn MCP stdio server with stdin/stdout inherited for JSON-RPC communication
      const mcpServer = spawn('node', [mcpStdioPath], {
        stdio: 'inherit',
        env: mcpEnv,
        cwd: process.cwd()  // Explicitly pass cwd to ensure config is found
      });

      mcpServer.on('close', (code) => {
        console.error(`MCP stdio server exited with code ${code}`);
        server.kill('SIGTERM');
      });

      process.on('SIGINT', () => {
        mcpServer.kill('SIGINT');
        server.kill('SIGINT');
      });
    } else {
      process.on('SIGINT', () => {
        server.kill('SIGINT');
      });
    }
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
  .description('Deploy Story UI to production')
  // RECOMMENDED: Live Storybook deployment
  .option('--live', 'Deploy Storybook in DEV MODE with MCP server (RECOMMENDED)')
  .option('--platform <platform>', 'Platform: railway (default), render, fly', 'railway')
  .option('--dry-run', 'Generate deployment files only, don\'t deploy')
  // Alternative approaches
  .option('--backend', 'Deploy only the MCP server backend')
  .option('--app', 'Deploy standalone production app (static build)')
  .option('--frontend', 'Deploy Storybook static build (legacy)')
  .option('--backend-url <url>', 'Use existing backend URL for app/frontend')
  .option('--storybook-dir <dir>', 'Path to Storybook project')
  .option('--project-name <name>', 'Project name prefix', 'story-ui')
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

program
  .command('update')
  .description('Update Story UI managed files to the latest version')
  .option('-f, --force', 'Skip confirmation prompts')
  .option('--no-backup', 'Skip creating backups of existing files')
  .option('-n, --dry-run', 'Show what would be updated without making changes')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (options) => {
    await updateCommand({
      force: options.force,
      backup: options.backup,
      dryRun: options.dryRun,
      verbose: options.verbose
    });
  });

program
  .command('status')
  .description('Show Story UI installation status and version info')
  .action(() => {
    statusCommand();
  });

program.parse(process.argv);
