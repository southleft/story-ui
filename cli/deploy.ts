import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DeployOptions {
  // Live Storybook deployment (dev mode on server)
  live?: boolean;  // Deploy Storybook in dev mode with MCP server
  platform?: 'railway' | 'fly';
  projectName?: string;
  dryRun?: boolean;
  // Backend-only deployment
  backend?: boolean;
  backendUrl?: string;
}

function getPackageRoot(): string {
  // After compilation, __dirname is dist/cli/, so we need to go up two levels
  // to reach the repo root where templates/ and other directories are
  return path.resolve(__dirname, '../..');
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Check if a CLI tool is installed
 */
function isToolInstalled(tool: string): boolean {
  try {
    execSync(`which ${tool}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate deployment files for live Storybook deployment
 * This creates Dockerfile, start script, and platform configs
 */
function generateLiveDeploymentFiles(projectDir: string, platform: string): void {
  console.log('📝 Generating deployment files...\n');

  // 1. Create Dockerfile for running both servers
  const dockerfilePath = path.join(projectDir, 'Dockerfile');
  const dockerfile = `# Story UI Live Deployment
# Runs Storybook in dev mode with Story UI MCP server

FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy project files
COPY . .

# Make start script executable
RUN chmod +x ./start-production.sh

# Expose ports: Storybook (6006) and MCP server (4005)
EXPOSE 6006 4005

# Start both servers
CMD ["./start-production.sh"]
`;
  fs.writeFileSync(dockerfilePath, dockerfile);
  console.log('✅ Created Dockerfile');

  // 2. Create start script that runs both servers
  const startScriptPath = path.join(projectDir, 'start-production.sh');
  const startScript = `#!/bin/bash

# Story UI Live Production Start Script
# Runs Storybook in dev mode with Story UI MCP server

echo "🚀 Starting Story UI Live Environment..."

# Start Storybook dev server in background
echo "📖 Starting Storybook dev server on port 6006..."
npm run storybook -- --port 6006 --host 0.0.0.0 --ci --no-open &
STORYBOOK_PID=$!

# Wait a moment for Storybook to initialize
sleep 5

# Start Story UI MCP server in background
echo "🤖 Starting Story UI MCP server on port 4005..."
npx story-ui start --port 4005 &
MCP_PID=$!

echo ""
echo "✅ Story UI Live Environment is running!"
echo "   📖 Storybook:   http://localhost:6006"
echo "   🤖 MCP Server:  http://localhost:4005"
echo "   📡 MCP Endpoint: http://localhost:4005/mcp"
echo ""

# Wait for either process to exit
wait $STORYBOOK_PID $MCP_PID
`;
  fs.writeFileSync(startScriptPath, startScript);
  fs.chmodSync(startScriptPath, '755');
  console.log('✅ Created start-production.sh');

  // 3. Create platform-specific config
  switch (platform) {
    case 'railway':
      createRailwayConfig(projectDir);
      break;
    case 'fly':
      createFlyConfig(projectDir);
      break;
  }

  // 4. Create .dockerignore if it doesn't exist
  const dockerignorePath = path.join(projectDir, '.dockerignore');
  if (!fs.existsSync(dockerignorePath)) {
    const dockerignore = `node_modules
.git
.gitignore
*.md
.DS_Store
storybook-static
dist
.env.local
`;
    fs.writeFileSync(dockerignorePath, dockerignore);
    console.log('✅ Created .dockerignore');
  }

  // 5. Update package.json to ensure story-ui is a dependency
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Add story-ui as a dependency if not present
    if (!packageJson.dependencies?.['@tpitre/story-ui'] && !packageJson.devDependencies?.['@tpitre/story-ui']) {
      packageJson.devDependencies = packageJson.devDependencies || {};
      packageJson.devDependencies['@tpitre/story-ui'] = 'latest';
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log('✅ Added @tpitre/story-ui to package.json');
    }
  }
}

function createRailwayConfig(projectDir: string): void {
  const railwayJsonPath = path.join(projectDir, 'railway.json');
  const railwayJson = {
    "$schema": "https://railway.app/railway.schema.json",
    "build": {
      "builder": "DOCKERFILE"
    },
    "deploy": {
      "numReplicas": 1,
      "restartPolicyType": "ON_FAILURE"
    }
  };
  fs.writeFileSync(railwayJsonPath, JSON.stringify(railwayJson, null, 2));
  console.log('✅ Created railway.json');

  // Also create nixpacks.toml as alternative
  const nixpacksPath = path.join(projectDir, 'nixpacks.toml');
  const nixpacks = `[start]
cmd = "./start-production.sh"

[phases.install]
cmds = ["npm install"]

[phases.build]
cmds = []
`;
  fs.writeFileSync(nixpacksPath, nixpacks);
  console.log('✅ Created nixpacks.toml (Railway alternative)');
}

function createFlyConfig(projectDir: string): void {
  const flyTomlPath = path.join(projectDir, 'fly.toml');
  const projectName = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const flyToml = `app = "${projectName}-story-ui"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[[services]]
  internal_port = 6006
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

[[services]]
  internal_port = 4005
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 4005

[env]
  NODE_ENV = "production"
`;
  fs.writeFileSync(flyTomlPath, flyToml);
  console.log('✅ Created fly.toml');
}

/**
 * Deploy live Storybook (dev mode) with MCP server to a cloud platform
 * This is the RECOMMENDED approach for production Story UI deployment
 */
async function deployLiveStorybook(options: DeployOptions): Promise<{ storybookUrl: string | null; mcpUrl: string | null }> {
  console.log('\n🚀 Story UI Live Deployment');
  console.log('═'.repeat(50));
  console.log('This deploys your Storybook in DEV MODE with the MCP server.');
  console.log('Works with ANY components - exactly like your local environment!\n');

  const projectDir = process.cwd();
  const platform = options.platform || 'railway';

  // Validate project has Storybook
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ No package.json found. Run this from your Storybook project root.');
    return { storybookUrl: null, mcpUrl: null };
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const hasStorybook = packageJson.devDependencies?.storybook ||
                       packageJson.dependencies?.storybook ||
                       packageJson.devDependencies?.['@storybook/react'] ||
                       packageJson.dependencies?.['@storybook/react'];

  if (!hasStorybook) {
    console.error('❌ No Storybook found in package.json.');
    console.log('   Make sure you have Storybook installed: npx storybook@latest init');
    return { storybookUrl: null, mcpUrl: null };
  }

  // Generate deployment files
  generateLiveDeploymentFiles(projectDir, platform);

  if (options.dryRun) {
    console.log('\n[DRY RUN] Deployment files generated. Would deploy to', platform);
    console.log('[DRY RUN] To deploy manually:');

    switch (platform) {
      case 'railway':
        console.log('   1. railway login');
        console.log('   2. railway init');
        console.log('   3. railway up');
        console.log('   4. railway domain (to get URL)');
        break;
      case 'fly':
        console.log('   1. fly auth login');
        console.log('   2. fly launch');
        console.log('   3. fly secrets set ANTHROPIC_API_KEY=...');
        console.log('   4. fly deploy');
        break;
    }

    return { storybookUrl: 'https://dry-run.example.com', mcpUrl: 'https://dry-run.example.com:4005/mcp' };
  }

  // Actually deploy based on platform
  console.log(`\n☁️  Deploying to ${platform}...`);

  switch (platform) {
    case 'railway':
      return await deployLiveToRailway(projectDir);
    case 'fly':
      return await deployLiveToFly(projectDir);
    default:
      console.error(`❌ Unknown platform: ${platform}`);
      return { storybookUrl: null, mcpUrl: null };
  }
}

async function deployLiveToRailway(projectDir: string): Promise<{ storybookUrl: string | null; mcpUrl: string | null }> {
  console.log('\n🚂 Deploying to Railway...\n');

  if (!isToolInstalled('railway')) {
    console.log('📦 Railway CLI not found. Installing...');
    try {
      execSync('npm install -g @railway/cli', { stdio: 'inherit' });
    } catch {
      console.error('❌ Failed to install Railway CLI');
      console.log('   Install manually: npm install -g @railway/cli');
      return { storybookUrl: null, mcpUrl: null };
    }
  }

  // Check if logged in
  try {
    execSync('railway whoami', { stdio: 'pipe' });
  } catch {
    console.log('🔐 Not logged into Railway. Please login:');
    execSync('railway login', { stdio: 'inherit' });
  }

  try {
    // Check if project is linked
    try {
      execSync('railway status', { cwd: projectDir, stdio: 'pipe' });
      console.log('✅ Railway project already linked');
    } catch {
      console.log('📁 Creating new Railway project...');
      execSync('railway init', { cwd: projectDir, stdio: 'inherit' });
    }

    // Set environment variables reminder
    console.log('\n⚠️  Remember to set your API keys in Railway dashboard:');
    console.log('   railway variables set ANTHROPIC_API_KEY=your-key');
    console.log('   (or OPENAI_API_KEY, GEMINI_API_KEY)\n');

    // Deploy
    console.log('🚀 Deploying to Railway...');
    const result = execSync('railway up --detach 2>&1', {
      cwd: projectDir,
      encoding: 'utf-8'
    });
    console.log(result);

    // Get the deployment URL
    console.log('\n📋 Getting deployment URL...');
    try {
      const urlResult = execSync('railway domain 2>&1', {
        cwd: projectDir,
        encoding: 'utf-8'
      }).trim();

      if (urlResult && !urlResult.includes('No domain')) {
        const storybookUrl = `https://${urlResult}`;
        const mcpUrl = `https://${urlResult}:4005/mcp`;

        console.log(`\n✅ Deployment successful!`);
        console.log(`   📖 Storybook:   ${storybookUrl}`);
        console.log(`   🤖 MCP Server:  ${mcpUrl}`);

        return { storybookUrl, mcpUrl };
      }
    } catch {
      console.log('⚠️  Could not get domain automatically.');
    }

    // Try to generate a domain
    console.log('🌐 Generating Railway domain...');
    execSync('railway domain', { cwd: projectDir, stdio: 'inherit' });

    console.log('\n✅ Deployment submitted!');
    console.log('   Run "railway domain" to get your deployment URL.');

    return { storybookUrl: null, mcpUrl: null };
  } catch (error: any) {
    console.error('❌ Railway deployment failed:', error.message);
    return { storybookUrl: null, mcpUrl: null };
  }
}

async function deployLiveToFly(projectDir: string): Promise<{ storybookUrl: string | null; mcpUrl: string | null }> {
  console.log('\n🪁 Deploying to Fly.io...\n');

  const flyCmd = isToolInstalled('flyctl') ? 'flyctl' : (isToolInstalled('fly') ? 'fly' : null);

  if (!flyCmd) {
    console.log('📦 Fly CLI not found. Installing...');
    try {
      execSync('curl -L https://fly.io/install.sh | sh', { stdio: 'inherit' });
    } catch {
      console.error('❌ Failed to install Fly CLI');
      console.log('   Install manually: https://fly.io/docs/hands-on/install-flyctl/');
      return { storybookUrl: null, mcpUrl: null };
    }
  }

  const cmd = flyCmd || 'fly';

  try {
    // Check if logged in
    try {
      execSync(`${cmd} auth whoami`, { stdio: 'pipe' });
    } catch {
      console.log('🔐 Not logged into Fly.io. Please login:');
      execSync(`${cmd} auth login`, { stdio: 'inherit' });
    }

    // Launch or deploy
    try {
      execSync(`${cmd} status`, { cwd: projectDir, stdio: 'pipe' });
      console.log('🚀 Deploying to existing Fly app...');
      execSync(`${cmd} deploy`, { cwd: projectDir, stdio: 'inherit' });
    } catch {
      console.log('📁 Creating new Fly app...');
      execSync(`${cmd} launch --no-deploy`, { cwd: projectDir, stdio: 'inherit' });

      console.log('\n⚠️  Before deploying, set your secrets:');
      console.log(`   ${cmd} secrets set ANTHROPIC_API_KEY=your-key`);
      console.log('\n   Then run:');
      console.log(`   ${cmd} deploy`);

      return { storybookUrl: null, mcpUrl: null };
    }

    // Get URL
    const appName = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-story-ui';
    const storybookUrl = `https://${appName}.fly.dev`;
    const mcpUrl = `https://${appName}.fly.dev:4005/mcp`;

    console.log(`\n✅ Deployment successful!`);
    console.log(`   📖 Storybook:   ${storybookUrl}`);
    console.log(`   🤖 MCP Server:  ${mcpUrl}`);

    return { storybookUrl, mcpUrl };
  } catch (error: any) {
    console.error('❌ Fly.io deployment failed:', error.message);
    return { storybookUrl: null, mcpUrl: null };
  }
}

/**
 * Deploy backend to Railway
 */
async function deployToRailway(dryRun: boolean): Promise<string | null> {
  console.log('\n🚂 Deploying backend to Railway...\n');

  const pkgRoot = getPackageRoot();

  // Check dry-run FIRST before any installation or login
  if (dryRun) {
    console.log('[DRY RUN] Would deploy to Railway from:', pkgRoot);
    console.log('[DRY RUN] Required env vars: CLAUDE_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY');
    console.log('[DRY RUN] Prerequisites: Railway CLI, Railway login');
    return 'https://dry-run.railway.app';
  }

  if (!isToolInstalled('railway')) {
    console.log('📦 Railway CLI not found. Installing...');
    try {
      execSync('npm install -g @railway/cli', { stdio: 'inherit' });
    } catch {
      console.error('❌ Failed to install Railway CLI');
      console.log('   Install manually: npm install -g @railway/cli');
      return null;
    }
  }

  // Check if logged in
  try {
    execSync('railway whoami', { stdio: 'pipe' });
  } catch {
    console.log('🔐 Not logged into Railway. Please login:');
    execSync('railway login', { stdio: 'inherit' });
  }

  try {
    // Check if project is linked
    try {
      execSync('railway status', { cwd: pkgRoot, stdio: 'pipe' });
      console.log('✅ Railway project already linked');
    } catch {
      console.log('📁 Creating new Railway project...');
      execSync('railway init', { cwd: pkgRoot, stdio: 'inherit' });
    }

    // Build the project first
    console.log('🔨 Building project...');
    execSync('npm run build', { cwd: pkgRoot, stdio: 'inherit' });

    // Deploy
    console.log('🚀 Deploying to Railway...');
    const result = execSync('railway up --detach 2>&1', {
      cwd: pkgRoot,
      encoding: 'utf-8'
    });
    console.log(result);

    // Get the deployment URL
    console.log('\n📋 Getting deployment URL...');
    const urlResult = execSync('railway domain 2>&1', {
      cwd: pkgRoot,
      encoding: 'utf-8'
    }).trim();

    if (urlResult && !urlResult.includes('No domain')) {
      console.log(`\n✅ Backend deployed to: https://${urlResult}`);
      return `https://${urlResult}`;
    }

    // Try to generate a domain
    console.log('🌐 Generating Railway domain...');
    execSync('railway domain', { cwd: pkgRoot, stdio: 'inherit' });

    const newUrlResult = execSync('railway domain 2>&1', {
      cwd: pkgRoot,
      encoding: 'utf-8'
    }).trim();

    if (newUrlResult) {
      console.log(`\n✅ Backend deployed to: https://${newUrlResult}`);
      return `https://${newUrlResult}`;
    }

    console.log('\n⚠️  Deployment successful but could not get URL.');
    console.log('   Run "railway domain" to get your deployment URL.');
    return null;
  } catch (error: any) {
    console.error('❌ Railway deployment failed:', error.message);
    return null;
  }
}

/**
 * Deploy backend to Fly.io
 */
async function deployToFly(dryRun: boolean): Promise<string | null> {
  console.log('\n🪁 Deploying backend to Fly.io...\n');

  if (!isToolInstalled('flyctl') && !isToolInstalled('fly')) {
    console.log('📦 Fly CLI not found. Installing...');
    try {
      execSync('curl -L https://fly.io/install.sh | sh', { stdio: 'inherit' });
    } catch {
      console.error('❌ Failed to install Fly CLI');
      console.log('   Install manually: https://fly.io/docs/hands-on/install-flyctl/');
      return null;
    }
  }

  const pkgRoot = getPackageRoot();
  const flyCmd = isToolInstalled('flyctl') ? 'flyctl' : 'fly';

  // Create fly.toml if it doesn't exist
  const flyTomlPath = path.join(pkgRoot, 'fly.toml');
  if (!fs.existsSync(flyTomlPath)) {
    console.log('📝 Creating fly.toml...');
    const flyToml = `app = "story-ui-backend"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 4001
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[checks]
  [checks.health]
    grace_period = "30s"
    interval = "30s"
    method = "GET"
    path = "/story-ui/providers"
    timeout = "5s"

[env]
  NODE_ENV = "production"
  PORT = "4001"
`;
    fs.writeFileSync(flyTomlPath, flyToml);
    console.log('✅ Created fly.toml');
  }

  if (dryRun) {
    console.log('[DRY RUN] Would deploy to Fly.io from:', pkgRoot);
    return 'https://dry-run.fly.dev';
  }

  try {
    // Check if logged in
    try {
      execSync(`${flyCmd} auth whoami`, { stdio: 'pipe' });
    } catch {
      console.log('🔐 Not logged into Fly.io. Please login:');
      execSync(`${flyCmd} auth login`, { stdio: 'inherit' });
    }

    // Launch or deploy
    try {
      execSync(`${flyCmd} status`, { cwd: pkgRoot, stdio: 'pipe' });
      console.log('🚀 Deploying to existing Fly app...');
      execSync(`${flyCmd} deploy`, { cwd: pkgRoot, stdio: 'inherit' });
    } catch {
      console.log('📁 Creating new Fly app...');
      execSync(`${flyCmd} launch --no-deploy`, { cwd: pkgRoot, stdio: 'inherit' });

      console.log('\n⚠️  Before deploying, set your secrets:');
      console.log(`   ${flyCmd} secrets set CLAUDE_API_KEY=your-key`);
      console.log(`   ${flyCmd} secrets set OPENAI_API_KEY=your-key`);
      console.log(`   ${flyCmd} secrets set GEMINI_API_KEY=your-key`);
      console.log(`\n   Then run: ${flyCmd} deploy`);
      return null;
    }

    // Get URL
    const appName = execSync(`${flyCmd} status --json 2>/dev/null | grep -o '"Name":"[^"]*"' | head -1 | cut -d'"' -f4`, {
      cwd: pkgRoot,
      encoding: 'utf-8'
    }).trim() || 'story-ui-backend';

    const url = `https://${appName}.fly.dev`;
    console.log(`\n✅ Backend deployed to: ${url}`);
    return url;
  } catch (error: any) {
    console.error('❌ Fly.io deployment failed:', error.message);
    return null;
  }
}



/**
 * Print deployment summary
 */
function printSummary(backendUrl: string | null) {
  console.log('\n' + '═'.repeat(60));
  console.log('📋 DEPLOYMENT SUMMARY');
  console.log('═'.repeat(60));

  if (backendUrl) {
    console.log(`\n🖥️  Backend API:  ${backendUrl}`);
    console.log('   Endpoints:');
    console.log(`   - ${backendUrl}/story-ui/providers`);
    console.log(`   - ${backendUrl}/story-ui/generate-stream`);
    console.log(`   - ${backendUrl}/story-ui/stories`);
    console.log('\n✅ Deployment complete!');
  }

  console.log('\n' + '═'.repeat(60));
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  console.log('\n☁️  Story UI Production Deployment');
  console.log('═'.repeat(40) + '\n');

  // Live Storybook deployment (recommended)
  // Runs Storybook in dev mode with MCP server - works with ANY components
  if (options.live) {
    const result = await deployLiveStorybook(options);

    if (result.storybookUrl || result.mcpUrl) {
      console.log('\n' + '═'.repeat(60));
      console.log('📋 LIVE DEPLOYMENT SUMMARY');
      console.log('═'.repeat(60));

      if (result.storybookUrl) {
        console.log(`\n📖 Storybook (Live Dev Mode): ${result.storybookUrl}`);
        console.log('   This runs in dev mode - Story UI can generate & hot-reload stories!');
      }

      if (result.mcpUrl) {
        console.log(`\n🤖 MCP Server: ${result.mcpUrl}`);
        console.log('   Connect Claude Desktop with:');
        console.log(`   claude mcp add --transport http story-ui ${result.mcpUrl}`);
      }

      console.log('\n✅ This is the EXACT same experience as local development!');
      console.log('   - Works with ANY components (custom, Tailwind, multiple libraries)');
      console.log('   - Generated stories are hot-reloaded instantly');
      console.log('   - MCP server accessible from anywhere');
      console.log('\n' + '═'.repeat(60));
    }

    return;
  }

  // Backend-only deployment
  let backendUrl = options.backendUrl || null;

  if (options.backend) {
    const platform = options.platform || 'railway';

    switch (platform) {
      case 'railway':
        backendUrl = await deployToRailway(options.dryRun || false);
        break;
      case 'fly':
        backendUrl = await deployToFly(options.dryRun || false);
        break;
      default:
        console.error(`❌ Unknown platform: ${platform}`);
        console.log('   Supported platforms: railway, fly');
        return;
    }

    if (!backendUrl && !options.dryRun) {
      console.log('\n⚠️  Backend deployment did not return a URL.');
      console.log('   You may need to check the platform dashboard for the URL.');
    }

    printSummary(backendUrl);
    return;
  }

  // Show help if no flags provided
  if (!options.backend && !options.live) {
    console.log('Story UI Deployment - Deploy your Storybook with AI story generation\n');

    console.log('═'.repeat(60));
    console.log('  RECOMMENDED: Live Storybook Deployment');
    console.log('═'.repeat(60));
    console.log('  --live                 Deploy Storybook in DEV MODE with MCP server');
    console.log('                         Works with ANY components - exactly like local dev!');
    console.log('  --platform <name>      Platform: railway (default), fly');
    console.log('  --dry-run              Generate deployment files only\n');

    console.log('EXAMPLES:');
    console.log('─'.repeat(60));
    console.log('  # Deploy your Storybook to Railway (recommended)');
    console.log('  npx story-ui deploy --live\n');

    console.log('  # Deploy to Fly.io');
    console.log('  npx story-ui deploy --live --platform=fly\n');

    console.log('  # Just generate deployment files (no actual deploy)');
    console.log('  npx story-ui deploy --live --dry-run\n');

    console.log('WHY --live IS RECOMMENDED:');
    console.log('─'.repeat(60));
    console.log('  - Works with ANY components (custom, Tailwind, multiple libraries)');
    console.log('  - Exactly the same experience as local development');
    console.log('  - Story UI writes stories to disk, Storybook hot-reloads them');
    console.log('  - MCP server accessible from Claude Desktop anywhere');
    console.log('  - No design system lock-in - completely agnostic\n');

    console.log('ENVIRONMENT VARIABLES (set on your platform):');
    console.log('─'.repeat(60));
    console.log('  ANTHROPIC_API_KEY  - Claude API key (recommended)');
    console.log('  OPENAI_API_KEY     - OpenAI API key (optional)');
    console.log('  GEMINI_API_KEY     - Google Gemini API key (optional)');
    console.log('  DATABASE_URL       - PostgreSQL URL for story persistence');
    console.log('  (Set at least one API key)\n');

    console.log('BACKEND-ONLY DEPLOYMENT:');
    console.log('─'.repeat(60));
    console.log('  --backend              Deploy only the MCP server backend');
    console.log('  --backend-url <url>    Use existing backend URL\n');
  }
}
