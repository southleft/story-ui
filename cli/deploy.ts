import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DeployOptions {
  // New recommended approach
  backend?: boolean;
  frontend?: boolean;
  platform?: 'railway' | 'render' | 'fly';
  backendUrl?: string;
  storybookDir?: string;
  projectName?: string;
  dryRun?: boolean;
  // Legacy Cloudflare Edge approach (deprecated)
  init?: boolean;
  edge?: boolean;
  pages?: boolean;
  all?: boolean;
}

function getPackageRoot(): string {
  return path.resolve(__dirname, '..');
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
 * Deploy backend to Render
 */
async function deployToRender(dryRun: boolean): Promise<string | null> {
  console.log('\n🎨 Deploying backend to Render...\n');

  const pkgRoot = getPackageRoot();

  // Create render.yaml if it doesn't exist
  const renderYamlPath = path.join(pkgRoot, 'render.yaml');
  if (!fs.existsSync(renderYamlPath)) {
    console.log('📝 Creating render.yaml...');
    const renderYaml = `services:
  - type: web
    name: story-ui-backend
    env: node
    buildCommand: npm install && npm run build
    startCommand: node dist/mcp-server/index.js
    healthCheckPath: /story-ui/providers
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 4001
      - key: CLAUDE_API_KEY
        sync: false
      - key: OPENAI_API_KEY
        sync: false
      - key: GEMINI_API_KEY
        sync: false
`;
    fs.writeFileSync(renderYamlPath, renderYaml);
    console.log('✅ Created render.yaml');
  }

  if (dryRun) {
    console.log('[DRY RUN] render.yaml created at:', renderYamlPath);
    console.log('[DRY RUN] To deploy:');
    console.log('   1. Push this repo to GitHub');
    console.log('   2. Go to https://render.com');
    console.log('   3. Create new Web Service from your repo');
    console.log('   4. Set environment variables');
    return 'https://dry-run.onrender.com';
  }

  console.log('\n📋 Render deployment is Git-based.');
  console.log('   To deploy to Render:\n');
  console.log('   1. Push your code to GitHub/GitLab');
  console.log('   2. Go to https://dashboard.render.com');
  console.log('   3. Click "New" → "Web Service"');
  console.log('   4. Connect your repository');
  console.log('   5. Render will auto-detect the render.yaml config');
  console.log('   6. Add your API keys as environment variables:');
  console.log('      - CLAUDE_API_KEY');
  console.log('      - OPENAI_API_KEY');
  console.log('      - GEMINI_API_KEY');
  console.log('\n   render.yaml has been created in your project root.');

  return null;
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
 * Print deployment summary
 */
function printSummary(backendUrl: string | null, frontendUrl: string | null) {
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

  if (frontendUrl) {
    console.log(`\n🌐 Storybook UI: ${frontendUrl}`);
    console.log('   Users can access this URL to use Story UI');
  }

  if (backendUrl && frontendUrl) {
    console.log('\n✅ Full deployment complete!');
    console.log('   Non-developers can now access Story UI at:');
    console.log(`   ${frontendUrl}`);
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

  // New recommended deployment flow
  let backendUrl = options.backendUrl || null;
  let frontendUrl: string | null = null;

  // Deploy backend
  if (options.backend) {
    const platform = options.platform || 'railway';

    switch (platform) {
      case 'railway':
        backendUrl = await deployToRailway(options.dryRun || false);
        break;
      case 'render':
        backendUrl = await deployToRender(options.dryRun || false);
        break;
      case 'fly':
        backendUrl = await deployToFly(options.dryRun || false);
        break;
      default:
        console.error(`❌ Unknown platform: ${platform}`);
        console.log('   Supported platforms: railway, render, fly');
        return;
    }

    if (!backendUrl && !options.dryRun) {
      console.log('\n⚠️  Backend deployment did not return a URL.');
      console.log('   You may need to check the platform dashboard for the URL.');
    }
  }

  // Deploy frontend
  if (options.frontend) {
    if (!backendUrl) {
      backendUrl = await prompt('Enter your backend URL: ');
      if (!backendUrl) {
        console.error('❌ Backend URL is required for frontend deployment.');
        return;
      }
    }

    const storybookDir = options.storybookDir || path.join(process.cwd(), 'test-storybooks/mantine-storybook');
    const projectName = options.projectName || 'story-ui';

    frontendUrl = await deployStorybook(backendUrl, storybookDir, projectName, options.dryRun || false);
  }

  // Print summary
  if (options.backend || options.frontend) {
    printSummary(backendUrl, frontendUrl);
  }

  // Show help if no flags provided
  if (!options.backend && !options.frontend && !options.edge && !options.pages && !options.all && !options.init) {
    console.log('Story UI Deployment - Deploy your Storybook + Story UI to production\n');
    console.log('RECOMMENDED APPROACH (Full-Stack Deployment):');
    console.log('─'.repeat(45));
    console.log('  --backend              Deploy MCP server backend');
    console.log('  --frontend             Deploy Storybook frontend');
    console.log('  --platform <name>      Backend platform: railway (default), render, fly');
    console.log('  --backend-url <url>    Use existing backend URL for frontend deployment');
    console.log('  --storybook-dir <dir>  Path to Storybook project');
    console.log('  --project-name <name>  Project name prefix (default: story-ui)');
    console.log('  --dry-run              Show what would be deployed\n');

    console.log('EXAMPLES:');
    console.log('─'.repeat(45));
    console.log('  # Deploy everything (recommended)');
    console.log('  npx story-ui deploy --backend --frontend\n');

    console.log('  # Deploy backend only to Railway');
    console.log('  npx story-ui deploy --backend --platform=railway\n');

    console.log('  # Deploy frontend with existing backend');
    console.log('  npx story-ui deploy --frontend --backend-url=https://your-api.railway.app\n');

    console.log('  # Deploy to a different Storybook project');
    console.log('  npx story-ui deploy --backend --frontend --storybook-dir=./my-storybook\n');

    console.log('ENVIRONMENT VARIABLES (set on backend platform):');
    console.log('─'.repeat(45));
    console.log('  CLAUDE_API_KEY    - Anthropic API key');
    console.log('  OPENAI_API_KEY    - OpenAI API key');
    console.log('  GEMINI_API_KEY    - Google Gemini API key');
    console.log('  (Set at least one of these)\n');

    console.log('DEPRECATED OPTIONS (Cloudflare Edge approach):');
    console.log('─'.repeat(45));
    console.log('  --init, --edge, --pages, --all');
    console.log('  These are deprecated. Use --backend and --frontend instead.\n');
  }
}
