#!/usr/bin/env node

/**
 * Multi-instance launcher for Story UI MCP servers
 * Allows running multiple MCP servers for different Storybook projects simultaneously
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Load configuration
const configPath = join(rootDir, 'multi-instance.config.json');
let config;

try {
  const configContent = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(configContent);
} catch (error) {
  console.error(`❌ Failed to load multi-instance.config.json: ${error.message}`);
  console.error(`💡 Make sure the file exists at: ${configPath}`);
  process.exit(1);
}

// Extract enabled instances
const instances = config.instances.filter(instance => instance.enabled);

if (instances.length === 0) {
  console.error('❌ No enabled instances found in configuration');
  process.exit(1);
}

// Process tracking
const processes = [];

// Clean up on exit
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping all instances...');
  processes.forEach(({ mcp, storybook, name }) => {
    if (mcp && !mcp.killed) {
      console.log(`   Stopping ${name} MCP server...`);
      mcp.kill();
    }
    if (storybook && !storybook.killed) {
      console.log(`   Stopping ${name} Storybook...`);
      storybook.kill();
    }
  });
  setTimeout(() => {
    console.log('✅ All instances stopped');
    process.exit(0);
  }, 1000);
});

// Validate all directories exist
for (const instance of instances) {
  const projectPath = join(rootDir, instance.directory);
  if (!fs.existsSync(projectPath)) {
    console.error(`❌ Directory not found for ${instance.name}: ${projectPath}`);
    console.error(`💡 Create the directory or disable this instance in multi-instance.config.json`);
    process.exit(1);
  }
}

// Helper to create colored console prefix
function colorize(text, color) {
  const reset = '\x1b[0m';
  return `${color}[${text}]${reset}`;
}

// Start an instance
async function startInstance(instance) {
  const { name, directory, mcpPort, storybookPort, color } = instance;
  const projectPath = resolve(rootDir, directory);
  const prefix = colorize(name.padEnd(16), color);

  return new Promise((resolve) => {
    console.log(`${prefix} Starting MCP server on port ${mcpPort}...`);

    // Check if using local development or npm package
    const isLocalDev = config.settings.useNpmLink;

    // Start MCP server
    const mcpProcess = spawn('npm', ['exec', 'story-ui', 'start', '--port', mcpPort.toString()], {
      cwd: projectPath,
      stdio: 'pipe',
      shell: process.platform === 'win32'
    });

    mcpProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => console.log(`${prefix} ${line}`));
    });

    mcpProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => console.error(`${prefix} ${line}`));
    });

    mcpProcess.on('error', (error) => {
      console.error(`${prefix} Failed to start MCP server: ${error.message}`);
    });

    mcpProcess.on('exit', (code) => {
      console.log(`${prefix} MCP server exited with code ${code}`);
    });

    // Wait a bit for MCP to start, then start Storybook
    setTimeout(() => {
      console.log(`${prefix} Starting Storybook on port ${storybookPort}...`);

      const storybookProcess = spawn('npm', ['run', 'storybook', '-p', storybookPort.toString()], {
        cwd: projectPath,
        stdio: 'pipe',
        shell: process.platform === 'win32'
      });

      storybookProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach(line => {
          console.log(`${prefix} ${line}`);

          // Check if Storybook is ready
          if (line.includes(`localhost:${storybookPort}`) ||
              line.includes('Storybook started') ||
              line.includes('Local:') ||
              line.includes('On your network:')) {
            console.log(`${prefix} ✓ Storybook running on port ${storybookPort}`);
            console.log(`${prefix} ✓ All services running! Access at http://localhost:${storybookPort}`);
          }
        });
      });

      storybookProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach(line => console.error(`${prefix} ${line}`));
      });

      storybookProcess.on('error', (error) => {
        console.error(`${prefix} Failed to start Storybook: ${error.message}`);
      });

      storybookProcess.on('exit', (code) => {
        console.log(`${prefix} Storybook exited with code ${code}`);
      });

      processes.push({ name, mcp: mcpProcess, storybook: storybookProcess });
      resolve();
    }, config.settings.startDelay || 3000);
  });
}

// Main execution
async function main() {
  console.log('🚀 Starting all Story UI instances...');

  if (config.settings.parallelStart) {
    // Start all instances in parallel
    await Promise.all(instances.map(instance => startInstance(instance)));
  } else {
    // Start instances sequentially
    for (const instance of instances) {
      await startInstance(instance);
    }
  }

  console.log('\n✅ All instances started!');
  console.log('\n📺 Access your Storybooks at:');
  instances.forEach(({ name, storybookPort }) => {
    console.log(`   ${name}: http://localhost:${storybookPort}`);
  });

  console.log('\n💡 To add new instances:');
  console.log('   1. Edit multi-instance.config.json');
  console.log('   2. Add your new instance configuration');
  console.log('   3. Restart this script\n');

  console.log('💡 Press Ctrl+C to stop all instances\n');

  // Log configuration file location for reference
  if (config.settings.logFile) {
    console.log(`📝 Logs available at: ${config.settings.logFile}`);
  }
}

main().catch(console.error);
