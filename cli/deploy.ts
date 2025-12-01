import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DeployOptions {
  // NEW RECOMMENDED: Live Storybook deployment (dev mode on server)
  live?: boolean;  // Deploy Storybook in dev mode with MCP server
  platform?: 'railway' | 'fly';
  projectName?: string;
  dryRun?: boolean;
  // Legacy approaches (still supported)
  backend?: boolean;
  frontend?: boolean;
  app?: boolean;  // Deploy standalone production app
  backendUrl?: string;
  storybookDir?: string;
  // Legacy Cloudflare Edge approach (deprecated)
  init?: boolean;
  edge?: boolean;
  pages?: boolean;
  all?: boolean;
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
 * Deploy Storybook frontend to Cloudflare Pages
 */
async function deployStorybook(backendUrl: string, storybookDir: string, projectName: string, dryRun: boolean): Promise<string | null> {
  console.log('\n📖 Deploying Storybook to Cloudflare Pages...\n');

  // Check wrangler auth
  try {
    execSync('npx wrangler whoami', { stdio: 'pipe' });
  } catch {
    console.log('🔐 Not authenticated with Cloudflare.');
    execSync('npx wrangler login', { stdio: 'inherit' });
  }

  // Validate storybook directory
  if (!fs.existsSync(storybookDir)) {
    console.error(`❌ Storybook directory not found: ${storybookDir}`);
    console.log('   Make sure you have a Storybook project set up.');
    return null;
  }

  const packageJsonPath = path.join(storybookDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ No package.json found in storybook directory');
    return null;
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would build Storybook with VITE_STORY_UI_EDGE_URL=${backendUrl}`);
    console.log(`[DRY RUN] Would deploy from: ${storybookDir}`);
    return 'https://dry-run.pages.dev';
  }

  try {
    // Install dependencies if needed
    if (!fs.existsSync(path.join(storybookDir, 'node_modules'))) {
      console.log('📦 Installing dependencies...');
      execSync('npm install', { cwd: storybookDir, stdio: 'inherit' });
    }

    // Build storybook with the backend URL
    console.log(`🔨 Building Storybook with backend URL: ${backendUrl}`);
    execSync(`VITE_STORY_UI_EDGE_URL=${backendUrl} npm run build-storybook`, {
      cwd: storybookDir,
      stdio: 'inherit'
    });

    // Deploy to Cloudflare Pages
    const staticDir = path.join(storybookDir, 'storybook-static');
    if (!fs.existsSync(staticDir)) {
      console.error('❌ storybook-static directory not found after build');
      return null;
    }

    console.log('🚀 Deploying to Cloudflare Pages...');
    const result = execSync(`npx wrangler pages deploy ${staticDir} --project-name=${projectName}-storybook 2>&1`, {
      encoding: 'utf-8'
    });
    console.log(result);

    // Extract URL from output
    const urlMatch = result.match(/https:\/\/[^\s]+\.pages\.dev/);
    if (urlMatch) {
      console.log(`\n✅ Storybook deployed to: ${urlMatch[0]}`);
      return urlMatch[0];
    }

    return null;
  } catch (error: any) {
    console.error('❌ Storybook deployment failed:', error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
    return null;
  }
}

/**
 * Build and deploy standalone production app
 * This builds a React app with the user's component library bundled in
 */
async function deployProductionApp(backendUrl: string, projectName: string, dryRun: boolean): Promise<string | null> {
  console.log('\n🚀 Building Standalone Production App...\n');
  console.log('   This creates a standalone web app with your component library\n');

  const pkgRoot = getPackageRoot();
  const userCwd = process.cwd();
  const templateDir = path.join(pkgRoot, 'templates/production-app');
  const buildDir = path.join(userCwd, '.story-ui-build');

  // Check for story-ui.config.js in user's project
  const configPath = path.join(userCwd, 'story-ui.config.js');
  if (!fs.existsSync(configPath)) {
    console.error('❌ No story-ui.config.js found in current directory');
    console.log('   Run "npx story-ui init" first to configure your component library');
    return null;
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would build production app from: ${templateDir}`);
    console.log(`[DRY RUN] Would bundle with components from: ${configPath}`);
    console.log(`[DRY RUN] Backend URL would be: ${backendUrl}`);
    return 'https://dry-run.pages.dev';
  }

  try {
    // 1. Copy template to build directory
    console.log('📁 Setting up build directory...');
    if (fs.existsSync(buildDir)) {
      fs.rmSync(buildDir, { recursive: true });
    }
    fs.mkdirSync(buildDir, { recursive: true });

    // Copy template files
    copyDirectory(templateDir, buildDir);

    // 2. Load user config and discover components
    console.log('🔍 Discovering components from your library...');
    const { generateComponentRegistry } = await import('../story-generator/componentRegistryGenerator.js');
    const registryOutputPath = path.join(buildDir, 'src/componentRegistry.ts');

    // Generate the component registry in the user's project context
    process.chdir(userCwd);
    await generateComponentRegistry(registryOutputPath);

    // 2.5. Load ALL design system documentation (story-ui-docs/ AND story-ui-considerations.md)
    console.log('📚 Loading design system documentation...');

    // First, try the full documentation directory (story-ui-docs/)
    const { DocumentationLoader } = await import('../story-generator/documentationLoader.js');
    const docLoader = new DocumentationLoader(userCwd);

    let fullDocumentation = '';
    let documentationTokens: Record<string, any> = {};
    let documentationPatterns: Record<string, string> = {};
    let hasFullDocs = false;

    if (docLoader.hasDocumentation()) {
      console.log('📂 Found story-ui-docs/ directory, loading all documentation...');
      const docs = await docLoader.loadDocumentation();
      fullDocumentation = docLoader.formatForPrompt(docs);
      documentationTokens = docs.tokens;
      documentationPatterns = docs.patterns;
      hasFullDocs = true;
      console.log(`   ✅ Loaded ${docs.guidelines.length} guidelines, ${Object.keys(docs.tokens).length} token categories, ${Object.keys(docs.patterns).length} patterns`);
    }

    // Also load legacy considerations file (story-ui-considerations.md)
    const { loadConsiderations, considerationsToPrompt } = await import('../story-generator/considerationsLoader.js');
    const considerations = loadConsiderations(); // Auto-finds in common locations
    const considerationsPrompt = considerations ? considerationsToPrompt(considerations) : '';

    // Combine both sources - full docs take priority, considerations supplement
    let combinedDocumentation = '';
    if (fullDocumentation) {
      combinedDocumentation = fullDocumentation;
      if (considerationsPrompt) {
        // Add considerations as supplementary rules
        combinedDocumentation += '\n\n📋 ADDITIONAL DESIGN SYSTEM RULES:\n' + considerationsPrompt;
      }
    } else if (considerationsPrompt) {
      combinedDocumentation = considerationsPrompt;
    }

    const considerationsOutputPath = path.join(buildDir, 'src/considerations.ts');

    // Write comprehensive documentation to a TypeScript file
    const considerationsContent = `/**
 * AI Design System Documentation - Auto-generated
 *
 * This file contains ALL design system documentation for the AI:
 * - Guidelines from story-ui-docs/ directory
 * - Design tokens (colors, spacing, typography, etc.)
 * - Component-specific documentation
 * - Layout patterns
 * - Accessibility rules
 * - Legacy considerations from story-ui-considerations.md
 *
 * To customize:
 * 1. Create a story-ui-docs/ directory with markdown/JSON files
 * 2. And/or edit story-ui-considerations.md in your project root
 */

export const aiConsiderations = ${JSON.stringify(combinedDocumentation, null, 2)};

export const hasConsiderations = ${(hasFullDocs || considerations) ? 'true' : 'false'};

// Design tokens for programmatic access (if needed)
export const designTokens = ${JSON.stringify(documentationTokens, null, 2)};

// Design patterns for programmatic access (if needed)
export const designPatterns = ${JSON.stringify(documentationPatterns, null, 2)};

// Source information
export const documentationSource = {
  hasFullDocs: ${hasFullDocs},
  hasLegacyConsiderations: ${considerations ? 'true' : 'false'},
  libraryName: ${JSON.stringify(considerations?.libraryName || null)}
};
`;
    fs.writeFileSync(considerationsOutputPath, considerationsContent);

    if (hasFullDocs && considerations) {
      console.log(`✅ Loaded full documentation + considerations for: ${considerations.libraryName || 'your component library'}`);
    } else if (hasFullDocs) {
      console.log('✅ Loaded full documentation from story-ui-docs/');
    } else if (considerations) {
      console.log(`✅ Loaded considerations for: ${considerations.libraryName || 'your component library'}`);
    } else {
      console.log('⚠️  No documentation found - using default prompts');
      console.log('   Create story-ui-docs/ directory or story-ui-considerations.md for better results');
    }

    process.chdir(buildDir);

    // 3. Install dependencies
    console.log('📦 Installing dependencies...');

    // Read the user's config
    const userConfig = await import(configPath);
    const config = userConfig.default;
    const componentLibraryPackage = config.importPath;

    // Update package.json to include the component library as a dependency
    const packageJsonPath = path.join(buildDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Add dependencies from user config (design system agnostic)
    const packagesToAdd = config.dependencies || [componentLibraryPackage];
    for (const pkg of packagesToAdd) {
      packageJson.dependencies[pkg] = '*';
    }

    // Add any additional imports as dependencies
    if (config.additionalImports) {
      for (const imp of config.additionalImports) {
        packageJson.dependencies[imp.path] = '*';
      }
    }

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // 3.5. Generate main.tsx with user-defined provider (design system agnostic)
    console.log('⚙️  Configuring app providers from story-ui.config.js...');
    const mainTsxPath = path.join(buildDir, 'src/main.tsx');
    const mainTsxContent = generateMainTsxFromConfig(config);
    fs.writeFileSync(mainTsxPath, mainTsxContent);

    // Install deps using npm with link to use local versions
    execSync('npm install', { cwd: buildDir, stdio: 'inherit' });

    // 4. Create .env file with backend URL
    console.log('⚙️  Configuring backend URL...');
    fs.writeFileSync(
      path.join(buildDir, '.env'),
      `VITE_STORY_UI_SERVER=${backendUrl}\nVITE_APP_TITLE=Story UI\n`
    );

    // 5. Build the app
    console.log('🔨 Building production app...');
    execSync('npm run build', { cwd: buildDir, stdio: 'inherit' });

    // 6. Deploy to Cloudflare Pages
    console.log('☁️  Deploying to Cloudflare Pages...');

    // Check wrangler auth
    try {
      execSync('npx wrangler whoami', { stdio: 'pipe' });
    } catch {
      console.log('🔐 Not authenticated with Cloudflare.');
      execSync('npx wrangler login', { stdio: 'inherit' });
    }

    const distDir = path.join(buildDir, 'dist');
    const result = execSync(`npx wrangler pages deploy ${distDir} --project-name=${projectName}-app 2>&1`, {
      encoding: 'utf-8'
    });
    console.log(result);

    // Extract URL from output
    const urlMatch = result.match(/https:\/\/[^\s]+\.pages\.dev/);
    if (urlMatch) {
      console.log(`\n✅ Production app deployed to: ${urlMatch[0]}`);
      return urlMatch[0];
    }

    console.log('\n⚠️  Deployment completed but URL not detected in output.');
    return null;
  } catch (error: any) {
    console.error('❌ Production app deployment failed:', error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
    return null;
  } finally {
    // Return to original directory
    process.chdir(userCwd);
  }
}

/**
 * Generate main.tsx from user config (design system agnostic)
 *
 * User's story-ui.config.js can define provider configuration:
 * {
 *   provider: {
 *     cssImports: ["your-library/styles.css"],  // CSS files to import
 *     imports: ["import { YourProvider } from 'your-library';"],  // Provider imports
 *     wrapper: "<YourProvider>{children}</YourProvider>"  // JSX wrapper with {children} placeholder
 *   }
 * }
 */
function generateMainTsxFromConfig(config: any): string {
  const provider = config.provider || {};

  // CSS imports (if any)
  const cssImports = (provider.cssImports || [])
    .map((css: string) => `import '${css}';`)
    .join('\n');

  // Provider component imports (if any)
  const providerImports = (provider.imports || []).join('\n');

  // Provider wrapper - replace {children} with <App />
  let appElement = '<App />';
  if (provider.wrapper) {
    appElement = provider.wrapper.replace('{children}', '<App />');
  }

  return `/**
 * Production App Entry Point
 *
 * This is the main entry point for the Story UI production app.
 * Provider configuration is read from story-ui.config.js
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
${cssImports}
${providerImports}
import App from './App';
import './index.css';

// Mount the app
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Make sure there is a <div id="root"></div> in your HTML.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    ${appElement}
  </React.StrictMode>
);
`;
}

/**
 * Helper function to copy directory recursively
 */
function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Print deployment summary
 */
function printSummary(backendUrl: string | null, frontendUrl: string | null, appUrl?: string | null) {
  console.log('\n' + '═'.repeat(60));
  console.log('📋 DEPLOYMENT SUMMARY');
  console.log('═'.repeat(60));

  if (backendUrl) {
    console.log(`\n🖥️  Backend API:  ${backendUrl}`);
    console.log('   Endpoints:');
    console.log(`   - ${backendUrl}/story-ui/providers`);
    console.log(`   - ${backendUrl}/story-ui/generate-stream`);
    console.log(`   - ${backendUrl}/story-ui/stories`);
  }

  if (appUrl) {
    console.log(`\n🚀 Production App: ${appUrl}`);
    console.log('   This is your standalone web app with your component library');
    console.log('   Users can prompt and see live-rendered components!');
  }

  if (frontendUrl) {
    console.log(`\n🌐 Storybook UI: ${frontendUrl}`);
    console.log('   (Legacy Storybook-based interface)');
  }

  if (backendUrl && (appUrl || frontendUrl)) {
    console.log('\n✅ Full deployment complete!');
    console.log('   Non-developers can now access Story UI at:');
    if (appUrl) {
      console.log(`   ${appUrl} (Recommended)`);
    }
    if (frontendUrl) {
      console.log(`   ${frontendUrl} (Storybook)`);
    }
  }

  console.log('\n' + '═'.repeat(60));
}

/**
 * Legacy Cloudflare Edge deployment (deprecated)
 */
async function legacyEdgeDeployment(options: DeployOptions): Promise<void> {
  console.log('\n⚠️  WARNING: The Edge Worker deployment is deprecated.');
  console.log('   It\'s recommended to use the new approach instead:');
  console.log('   npx story-ui deploy --backend --platform=railway');
  console.log('   npx story-ui deploy --frontend --backend-url=<your-backend-url>\n');

  const answer = await prompt('Continue with legacy deployment? (y/N): ');
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted. Use --backend and --frontend for the new approach.');
    return;
  }

  // Original legacy code here...
  console.log('Legacy deployment not implemented in new CLI.');
  console.log('Please use the new --backend and --frontend flags.');
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  console.log('\n☁️  Story UI Production Deployment');
  console.log('═'.repeat(40) + '\n');

  // Handle legacy flags
  if (options.edge || options.pages || options.all || options.init) {
    await legacyEdgeDeployment(options);
    return;
  }

  // NEW RECOMMENDED: Live Storybook deployment
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

  // Legacy deployment flows
  let backendUrl = options.backendUrl || null;
  let frontendUrl: string | null = null;
  let appUrl: string | null = null;

  // Deploy backend
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
  }

  // Deploy standalone production app (Lovable/Bolt-style)
  if (options.app) {
    if (!backendUrl) {
      backendUrl = await prompt('Enter your backend URL: ');
      if (!backendUrl) {
        console.error('❌ Backend URL is required for app deployment.');
        return;
      }
    }

    const projectName = options.projectName || 'story-ui';
    appUrl = await deployProductionApp(backendUrl, projectName, options.dryRun || false);
  }

  // Deploy frontend (legacy Storybook-based)
  if (options.frontend) {
    if (!backendUrl) {
      backendUrl = await prompt('Enter your backend URL: ');
      if (!backendUrl) {
        console.error('❌ Backend URL is required for frontend deployment.');
        return;
      }
    }

    const storybookDir = options.storybookDir || process.cwd();
    const projectName = options.projectName || 'story-ui';

    frontendUrl = await deployStorybook(backendUrl, storybookDir, projectName, options.dryRun || false);
  }

  // Print summary
  if (options.backend || options.frontend || options.app) {
    printSummary(backendUrl, frontendUrl, appUrl);
  }

  // Show help if no flags provided
  if (!options.backend && !options.frontend && !options.app && !options.live && !options.edge && !options.pages && !options.all && !options.init) {
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
    console.log('  (Set at least one of these)\n');

    console.log('ALTERNATIVE APPROACHES (for specific use cases):');
    console.log('─'.repeat(60));
    console.log('  --backend              Deploy only the MCP server backend');
    console.log('  --app                  Deploy standalone production app (static)');
    console.log('  --frontend             Deploy Storybook static build');
    console.log('  --backend-url <url>    Use existing backend URL\n');

    console.log('DEPRECATED:');
    console.log('─'.repeat(60));
    console.log('  --init, --edge, --pages, --all');
    console.log('  These Cloudflare Edge options are deprecated. Use --live instead.\n');
  }
}
