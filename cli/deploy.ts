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
  app?: boolean;  // New: Deploy standalone production app (Lovable/Bolt-style)
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
 * Build and deploy standalone production app (Lovable/Bolt-style)
 * This builds a React app with the user's component library bundled in
 */
async function deployProductionApp(backendUrl: string, projectName: string, dryRun: boolean): Promise<string | null> {
  console.log('\n🚀 Building Standalone Production App...\n');
  console.log('   This creates a Lovable/Bolt-style UI with your component library\n');

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

    // 2.5. Generate AI considerations from story-ui-considerations.md (if exists)
    console.log('📝 Loading AI considerations...');
    const { loadConsiderations, considerationsToPrompt } = await import('../story-generator/considerationsLoader.js');
    const considerations = loadConsiderations(); // Auto-finds in common locations
    const considerationsPrompt = considerations ? considerationsToPrompt(considerations) : '';
    const considerationsOutputPath = path.join(buildDir, 'src/considerations.ts');

    // Write considerations to a TypeScript file
    const considerationsContent = `/**
 * AI Considerations - Auto-generated from story-ui-considerations.md
 *
 * This file contains design-system-specific instructions for the AI
 * when generating components. Edit story-ui-considerations.md in your
 * project root to customize these rules.
 */

export const aiConsiderations = ${JSON.stringify(considerationsPrompt, null, 2)};

export const hasConsiderations = ${considerations ? 'true' : 'false'};
`;
    fs.writeFileSync(considerationsOutputPath, considerationsContent);
    console.log(considerations
      ? `✅ Loaded AI considerations for: ${considerations.libraryName || 'your component library'}`
      : '⚠️  No story-ui-considerations.md found - using default prompts');

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
      `VITE_BACKEND_URL=${backendUrl}\nVITE_APP_TITLE=Story UI\n`
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
    console.log('   This is your Lovable/Bolt-style UI with your component library');
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

  // New recommended deployment flow
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
  if (!options.backend && !options.frontend && !options.app && !options.edge && !options.pages && !options.all && !options.init) {
    console.log('Story UI Deployment - Deploy your component library as a production app\n');
    console.log('RECOMMENDED APPROACH (Lovable/Bolt-style App):');
    console.log('─'.repeat(50));
    console.log('  --backend              Deploy MCP server backend');
    console.log('  --app                  Deploy standalone production app (RECOMMENDED)');
    console.log('                         Builds a Lovable/Bolt-style UI with your components');
    console.log('  --platform <name>      Backend platform: railway (default), render, fly');
    console.log('  --backend-url <url>    Use existing backend URL');
    console.log('  --project-name <name>  Project name prefix (default: story-ui)');
    console.log('  --dry-run              Show what would be deployed\n');

    console.log('EXAMPLES:');
    console.log('─'.repeat(50));
    console.log('  # Deploy everything (recommended)');
    console.log('  npx story-ui deploy --backend --app\n');

    console.log('  # Deploy backend only to Railway');
    console.log('  npx story-ui deploy --backend --platform=railway\n');

    console.log('  # Deploy app with existing backend');
    console.log('  npx story-ui deploy --app --backend-url=https://your-api.railway.app\n');

    console.log('  # Custom project name');
    console.log('  npx story-ui deploy --backend --app --project-name=my-design-system\n');

    console.log('ENVIRONMENT VARIABLES (set on backend platform):');
    console.log('─'.repeat(50));
    console.log('  CLAUDE_API_KEY    - Anthropic API key');
    console.log('  OPENAI_API_KEY    - OpenAI API key');
    console.log('  GEMINI_API_KEY    - Google Gemini API key');
    console.log('  (Set at least one of these)\n');

    console.log('LEGACY OPTIONS (Storybook-based frontend):');
    console.log('─'.repeat(50));
    console.log('  --frontend             Deploy Storybook frontend (use --app instead)');
    console.log('  --storybook-dir <dir>  Path to Storybook project\n');

    console.log('DEPRECATED OPTIONS (Cloudflare Edge approach):');
    console.log('─'.repeat(50));
    console.log('  --init, --edge, --pages, --all');
    console.log('  These are deprecated. Use --backend and --app instead.\n');
  }
}
