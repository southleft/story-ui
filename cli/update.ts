import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import { createRequire } from 'module';
import { ensureManagerAddonWiring, ensureStoriesGlobCoversMdx, missingReactStorybookDep, ensureManagerHeadPort, readConfiguredPort } from './setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Runtime dependencies that consumer projects must have installed for
// managed template files to resolve. The voice canvas templates import
// `react-live` directly, so it cannot be resolved transitively through
// a symlinked @tpitre/story-ui install.
const REQUIRED_CONSUMER_DEPS = ['react-live'];

/**
 * Story UI Update Command
 *
 * Refreshes managed Story UI files (StoryUIPanel.tsx, StoryUIPanel.mdx, manager.tsx, ...)
 * while preserving user configuration files (story-ui.config.js, .env, etc.)
 */

export interface UpdateOptions {
  force?: boolean;      // Skip confirmation prompts
  backup?: boolean;     // Create backups (default: true)
  dryRun?: boolean;     // Show what would be updated without making changes
  verbose?: boolean;    // Show detailed output
}

export interface UpdateResult {
  success: boolean;
  filesUpdated: string[];
  filesBackedUp: string[];
  errors: string[];
  currentVersion: string;
  newVersion: string;
}

// Files managed by Story UI that can be safely overwritten
const MANAGED_FILES = [
  {
    source: 'templates/StoryUI/StoryUIPanel.tsx',
    target: 'src/stories/StoryUI/StoryUIPanel.tsx',
    description: 'Main chat panel component'
  },
  {
    source: 'templates/StoryUI/StoryUIPanel.css',
    target: 'src/stories/StoryUI/StoryUIPanel.css',
    description: 'Panel styles'
  },
  {
    source: 'templates/StoryUI/StoryUIPanel.mdx',
    target: 'src/stories/StoryUI/StoryUIPanel.mdx',
    description: 'Cross-framework MDX wrapper'
  },
  {
    source: 'templates/StoryUI/manager.tsx',
    target: 'src/stories/StoryUI/manager.tsx',
    description: 'Story UI manager tab (?path=/workspace/) and "Edit in Story UI" toolbar button'
  },
  // Panel siblings. StoryUIPanel.tsx imports each of these by relative path,
  // so shipping the panel without them leaves the consumer with three
  // unresolvable imports. `init` has always copied them; `update` did not,
  // which meant updating an existing project BROKE the V1 panel.
  // `__tests__/update-managed-files.test.ts` derives this list from the
  // panel's own imports so the two cannot drift again.
  {
    source: 'templates/StoryUI/DesignContextPanel.tsx',
    target: 'src/stories/StoryUI/DesignContextPanel.tsx',
    description: 'Design context panel'
  },
  {
    source: 'templates/StoryUI/VerificationBadge.tsx',
    target: 'src/stories/StoryUI/VerificationBadge.tsx',
    description: 'Verification result badge'
  },
  {
    source: 'templates/StoryUI/HandoffDialog.tsx',
    target: 'src/stories/StoryUI/HandoffDialog.tsx',
    description: 'Handoff dialog'
  },
  // Voice Canvas files
  {
    source: 'templates/StoryUI/voice/VoiceCanvas.tsx',
    target: 'src/stories/StoryUI/voice/VoiceCanvas.tsx',
    description: 'Voice Canvas component'
  },
  {
    source: 'templates/StoryUI/voice/VoiceControls.tsx',
    target: 'src/stories/StoryUI/voice/VoiceControls.tsx',
    description: 'Voice control UI components'
  },
  {
    source: 'templates/StoryUI/voice/useVoiceInput.ts',
    target: 'src/stories/StoryUI/voice/useVoiceInput.ts',
    description: 'Voice input hook'
  },
  {
    source: 'templates/StoryUI/voice/voiceCommands.ts',
    target: 'src/stories/StoryUI/voice/voiceCommands.ts',
    description: 'Voice command definitions'
  },
  {
    source: 'templates/StoryUI/voice/types.ts',
    target: 'src/stories/StoryUI/voice/types.ts',
    description: 'Voice module type definitions'
  },
  // V2 workspace — a single MDX entry beside the panel dir; the workspace
  // itself ships in the package and updates with it
  {
    source: 'templates/StoryUIV2/StoryUIV2.mdx',
    target: 'src/stories/StoryUIV2/StoryUIV2.mdx',
    description: 'Story UI workspace (V2) MDX entry'
  }
];

// Files that should NEVER be modified by update
const USER_CONFIG_FILES = [
  'story-ui.config.js',
  'story-ui.config.mjs',
  'story-ui.config.cjs',
  '.env',
  'story-ui-considerations.md',
  'story-ui-docs/'
];

// Directories that should NEVER be touched
const PROTECTED_DIRECTORIES = [
  'src/stories/generated/'
];

/**
 * Get the Story UI package version
 */
function getPackageVersion(): string {
  try {
    // Try multiple paths to find package.json
    // When running from dist/cli/index.js, we need to go up 2 levels
    const possiblePaths = [
      path.resolve(__dirname, '..', 'package.json'),      // From dist/cli
      path.resolve(__dirname, '..', '..', 'package.json'), // From src/cli
    ];

    for (const packageJsonPath of possiblePaths) {
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.name === '@tpitre/story-ui' && packageJson.version) {
          return packageJson.version;
        }
      }
    }
  } catch (error) {
    // Fallback
  }
  return 'unknown';
}

/**
 * Detect if Story UI is initialized in the current directory
 */
function detectStoryUIInstallation(): {
  isInstalled: boolean;
  storyUIDir?: string;
  configPath?: string;
  installedVersion?: string;
  componentFramework?: string;
} {
  const cwd = process.cwd();

  // Check for config file
  const configFiles = [
    'story-ui.config.js',
    'story-ui.config.mjs',
    'story-ui.config.cjs'
  ];

  let configPath: string | undefined;
  for (const configFile of configFiles) {
    const fullPath = path.join(cwd, configFile);
    if (fs.existsSync(fullPath)) {
      configPath = fullPath;
      break;
    }
  }

  // Try to read installed version and paths from config
  let installedVersion: string | undefined;
  let configuredStoriesPath: string | undefined;
  let componentFramework: string | undefined;
  if (configPath) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const versionMatch = configContent.match(/_storyUIVersion:\s*['"]([^'"]+)['"]/);
      if (versionMatch) {
        installedVersion = versionMatch[1];
      }
      const storiesPathMatch = configContent.match(/generatedStoriesPath:\s*['"]([^'"]+)['"]/);
      if (storiesPathMatch) {
        configuredStoriesPath = storiesPathMatch[1];
      }
      const frameworkMatch = configContent.match(/componentFramework:\s*['"]([^'"]+)['"]/);
      if (frameworkMatch) {
        componentFramework = frameworkMatch[1];
      }
    } catch (error) {
      // Ignore read errors
    }
  }

  // Check for Story UI directory. An init with a custom generatedStoriesPath
  // installs the panel beside it, so derive that location from the config
  // before falling back to the conventional spots.
  const possibleStoryUIDirs = [
    ...(configuredStoriesPath
      ? [path.join(path.dirname(path.resolve(cwd, configuredStoriesPath)), 'StoryUI')]
      : []),
    path.join(cwd, 'src', 'stories', 'StoryUI'),
    path.join(cwd, 'stories', 'StoryUI')
  ];

  let storyUIDir: string | undefined;
  for (const dir of possibleStoryUIDirs) {
    if (fs.existsSync(dir)) {
      storyUIDir = dir;
      break;
    }
  }

  return {
    isInstalled: !!(storyUIDir || configPath),
    storyUIDir,
    configPath,
    installedVersion,
    componentFramework
  };
}

/**
 * Create a backup of a file
 */
function createBackup(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;

  try {
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch (error) {
    return null;
  }
}

/**
 * Get the source path for a template file
 */
function getSourcePath(relativePath: string): string {
  // First try the dist directory (when installed as package)
  const pkgRoot = path.resolve(__dirname, '..');
  const distPath = path.join(pkgRoot, relativePath);

  if (fs.existsSync(distPath)) {
    return distPath;
  }

  // Fall back to project root (when running in development)
  const projectRoot = path.resolve(__dirname, '..', '..');
  const projectPath = path.join(projectRoot, relativePath);

  if (fs.existsSync(projectPath)) {
    return projectPath;
  }

  throw new Error(`Template file not found: ${relativePath}`);
}

/**
 * Compare file contents to check if update is needed
 */
function filesAreDifferent(sourcePath: string, targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return true;
  }

  try {
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const targetContent = fs.readFileSync(targetPath, 'utf-8');
    return sourceContent !== targetContent;
  } catch (error) {
    return true;
  }
}

/**
 * Update a single managed file
 */
function updateManagedFile(
  sourceRelative: string,
  targetRelative: string,
  options: UpdateOptions
): { updated: boolean; backupPath?: string; error?: string } {
  const cwd = process.cwd();
  const targetPath = path.join(cwd, targetRelative);

  try {
    const sourcePath = getSourcePath(sourceRelative);

    // Check if update is needed
    if (!filesAreDifferent(sourcePath, targetPath)) {
      if (options.verbose) {
        console.log(chalk.gray(`  ⏭️  ${targetRelative} (already up to date)`));
      }
      return { updated: false };
    }

    if (options.dryRun) {
      console.log(chalk.cyan(`  📋 Would update: ${targetRelative}`));
      return { updated: true };
    }

    // Create backup if enabled and file exists
    let backupPath: string | undefined;
    if (options.backup !== false && fs.existsSync(targetPath)) {
      const backup = createBackup(targetPath);
      if (backup) {
        backupPath = backup;
        if (options.verbose) {
          console.log(chalk.gray(`  💾 Backed up: ${path.basename(backup)}`));
        }
      }
    }

    // Ensure target directory exists
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copy the new file
    fs.copyFileSync(sourcePath, targetPath);
    console.log(chalk.green(`  ✅ Updated: ${targetRelative}`));

    return { updated: true, backupPath };

  } catch (error: any) {
    return { updated: false, error: error.message };
  }
}

/**
 * Update the config file with version tracking
 */
function updateConfigVersion(configPath: string, version: string): boolean {
  try {
    let content = fs.readFileSync(configPath, 'utf-8');

    // Check if version tracking already exists
    const hasVersion = /_storyUIVersion/.test(content);
    const hasLastUpdated = /_lastUpdated/.test(content);

    const timestamp = new Date().toISOString();

    if (hasVersion) {
      // Update existing version
      content = content.replace(
        /_storyUIVersion:\s*['"][^'"]*['"]/,
        `_storyUIVersion: '${version}'`
      );
    }

    if (hasLastUpdated) {
      // Update existing timestamp
      content = content.replace(
        /_lastUpdated:\s*['"][^'"]*['"]/,
        `_lastUpdated: '${timestamp}'`
      );
    }

    // If neither exists, add them before the closing brace
    if (!hasVersion && !hasLastUpdated) {
      // Find the last property and add version tracking
      const insertPosition = content.lastIndexOf('}');
      if (insertPosition !== -1) {
        const versionFields = `
  // Story UI version tracking (auto-generated)
  _storyUIVersion: '${version}',
  _lastUpdated: '${timestamp}',
`;
        // Check if there's a trailing comma needed
        const beforeInsert = content.substring(0, insertPosition).trim();
        const needsComma = beforeInsert.endsWith(',') || beforeInsert.endsWith('{') ? '' : ',';

        content = content.substring(0, insertPosition - 1) +
                  needsComma +
                  versionFields +
                  '};' +
                  content.substring(insertPosition + 1);
      }
    }

    fs.writeFileSync(configPath, content);
    return true;

  } catch (error) {
    return false;
  }
}

/**
 * Ensure the consumer project has the runtime deps required by managed
 * template files (e.g. react-live for voice canvas). Installs any missing
 * packages using the detected package manager.
 */
function ensureConsumerDependencies(options: UpdateOptions, componentFramework?: string): { installed: string[]; errors: string[] } {
  const cwd = process.cwd();
  const packageJsonPath = path.join(cwd, 'package.json');
  const result = { installed: [] as string[], errors: [] as string[] };

  if (!fs.existsSync(packageJsonPath)) {
    return result;
  }

  let packageJson: any;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch (error: any) {
    result.errors.push(`Could not read package.json: ${error.message}`);
    return result;
  }

  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  // react-live is the Voice Canvas's dependency, and the canvas story only
  // compiles in a React Storybook; a Vue or Svelte host would carry it dead.
  const required = (componentFramework && componentFramework !== 'react') ? [] : REQUIRED_CONSUMER_DEPS;
  const missing = required.filter((pkg) => !allDeps[pkg]);

  // The panel and the V2 workspace are React, rendered through addon-docs even
  // in a non-React Storybook. react/@storybook/react are OPTIONAL peers of
  // @tpitre/story-ui, so nothing force-installs them: npm usually hoists
  // Storybook's own copy of react, pnpm does not — and then the /workspace
  // export fails to resolve 'react'. Check resolution, not just declaration.
  if (componentFramework && componentFramework !== 'react') {
    const hostRequire = createRequire(packageJsonPath);
    for (const pkg of ['react', 'react-dom']) {
      if (allDeps[pkg]) continue;
      try {
        hostRequire.resolve(pkg);
      } catch {
        missing.push(`${pkg}@^18.3.1`);
      }
    }
  }

  // React hosts need '@storybook/react' — the type import every generated
  // story starts with. It is an OPTIONAL peer of @tpitre/story-ui, and pnpm's
  // auto-install-peers skips optional peers, so a React + pnpm host loses it
  // unless it is installed explicitly, pinned to the host's Storybook major.
  const storybookReactDep = missingReactStorybookDep(cwd, allDeps, componentFramework);
  if (storybookReactDep) {
    missing.push(`${storybookReactDep.name}@${storybookReactDep.range}`);
  }

  if (missing.length === 0) {
    return result;
  }

  if (options.dryRun) {
    console.log(chalk.cyan(`  📋 Would install missing deps: ${missing.join(', ')}`));
    return result;
  }

  // Detect package manager
  const yarnLock = fs.existsSync(path.join(cwd, 'yarn.lock'));
  const pnpmLock = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'));
  let installCommand = `npm install --save-dev ${missing.join(' ')}`;
  if (yarnLock) {
    installCommand = `yarn add --dev ${missing.join(' ')}`;
  } else if (pnpmLock) {
    installCommand = `pnpm add -D ${missing.join(' ')}`;
  }

  console.log(chalk.bold('\n📦 Installing required runtime dependencies:'));
  for (const pkg of missing) {
    console.log(chalk.cyan(`   • ${pkg}`));
  }
  console.log(chalk.gray(`   Running: ${installCommand}`));

  try {
    execSync(installCommand, { stdio: 'inherit', cwd });
    result.installed.push(...missing);
    console.log(chalk.green(`   ✅ Installed: ${missing.join(', ')}`));
  } catch (error: any) {
    const message = `Failed to install ${missing.join(', ')}. Run "${installCommand}" manually.`;
    result.errors.push(message);
    console.log(chalk.yellow(`   ⚠️  ${message}`));
  }

  return result;
}

/**
 * Main update command
 */
export async function updateCommand(options: UpdateOptions = {}): Promise<UpdateResult> {
  const result: UpdateResult = {
    success: false,
    filesUpdated: [],
    filesBackedUp: [],
    errors: [],
    currentVersion: 'unknown',
    newVersion: getPackageVersion()
  };

  console.log(chalk.bold('\n🔄 Story UI Update\n'));

  // Step 1: Detect installation
  const installation = detectStoryUIInstallation();

  if (!installation.isInstalled) {
    console.log(chalk.red('❌ Story UI is not initialized in this directory.'));
    console.log(chalk.yellow('   Run "npx story-ui init" first to set up Story UI.'));
    result.errors.push('Story UI not initialized');
    return result;
  }

  result.currentVersion = installation.installedVersion || 'unknown';

  console.log(chalk.gray(`   Current version: ${result.currentVersion}`));
  console.log(chalk.gray(`   New version: ${result.newVersion}`));

  // Resolve managed-file targets against the DETECTED panel directory, so
  // installations at stories/StoryUI (no src/) update in place instead of
  // getting a duplicate panel written to src/stories/StoryUI. The StoryUIV2
  // dir lands beside the panel, so the shared prefix is the stories dir.
  const panelDirRel = installation.storyUIDir
    ? path.relative(process.cwd(), installation.storyUIDir).split(path.sep).join('/')
    : 'src/stories/StoryUI';
  const storiesDirRel = path.dirname(panelDirRel).split(path.sep).join('/');
  const resolveTarget = (target: string): string =>
    target.replace(/^src\/stories/, storiesDirRel);

  // Step 2: Show what will be updated
  console.log(chalk.bold('\n📦 Managed files to update:'));

  const filesToUpdate: Array<{ source: string; target: string; description: string }> = [];
  for (const managed of MANAGED_FILES) {
    const file = { ...managed, target: resolveTarget(managed.target) };
    try {
      const sourcePath = getSourcePath(file.source);
      const targetPath = path.join(process.cwd(), file.target);
      const needsUpdate = filesAreDifferent(sourcePath, targetPath);

      if (needsUpdate) {
        filesToUpdate.push(file);
        console.log(chalk.cyan(`   • ${file.target}`));
        console.log(chalk.gray(`     ${file.description}`));
      } else if (options.verbose) {
        console.log(chalk.gray(`   ⏭️ ${file.target} (up to date)`));
      }
    } catch (error: any) {
      console.log(chalk.red(`   ❌ ${file.target}: ${error.message}`));
      result.errors.push(`${file.target}: ${error.message}`);
    }
  }

  // The manager page reads its port from .storybook/manager-head.html, not
  // from .env. Refreshed from the port init recorded BEFORE the early return
  // below: an install whose managed files are current can still predate the
  // meta, and `check` sends people here to get it.
  if (!options.dryRun && fs.existsSync(path.join(process.cwd(), '.storybook'))) {
    const configured = readConfiguredPort(process.cwd());
    if (configured) {
      try {
        const head = ensureManagerHeadPort(process.cwd(), configured.port);
        if (head.action !== 'unchanged') {
          console.log(chalk.green(`   ✅ ${head.action === 'created' ? 'Created' : 'Updated'} .storybook/manager-head.html — the workspace page talks to port ${configured.port} (from ${configured.source})`));
        }
      } catch (headError: any) {
        result.errors.push(`manager-head.html: ${headError.message}`);
      }
    } else {
      console.log(chalk.yellow('   ⚠️  No port in .env (VITE_STORY_UI_PORT) or the story-ui script — .storybook/manager-head.html was not written'));
    }
  }

  if (filesToUpdate.length === 0) {
    console.log(chalk.green('\n✅ All files are already up to date!'));
    result.success = result.errors.length === 0;
    return result;
  }

  // Step 3: Confirm update (unless --force or --dry-run)
  if (!options.force && !options.dryRun) {
    console.log(chalk.yellow('\n⚠️  The following will NOT be modified:'));
    console.log(chalk.gray('   • story-ui.config.js (your configuration)'));
    console.log(chalk.gray('   • .env (your API keys)'));
    console.log(chalk.gray('   • story-ui-docs/ (your documentation)'));
    console.log(chalk.gray('   • src/stories/generated/ (your generated stories)'));

    // No terminal means no question: an agent or CI would hang on it.
    const unattended = !process.stdin.isTTY || process.env.CI === 'true' || process.env.CI === '1' || process.env.STORY_UI_NONINTERACTIVE === 'true';
    const { confirm } = unattended
      ? { confirm: true }
      : await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `Update ${filesToUpdate.length} file(s)?`,
          default: true
        }]);

    if (!confirm) {
      console.log(chalk.yellow('\n⏹️  Update cancelled.'));
      return result;
    }
  }

  // Step 4: Perform updates
  if (options.dryRun) {
    console.log(chalk.bold('\n📋 Dry run - no changes made:'));
  } else {
    console.log(chalk.bold('\n🔧 Updating files...'));
  }

  for (const file of filesToUpdate) {
    const updateResult = updateManagedFile(file.source, file.target, options);

    if (updateResult.updated) {
      result.filesUpdated.push(file.target);
    }

    if (updateResult.backupPath) {
      result.filesBackedUp.push(updateResult.backupPath);
    }

    if (updateResult.error) {
      result.errors.push(`${file.target}: ${updateResult.error}`);
    }
  }

  // Step 5: Ensure required consumer dependencies are installed
  // (e.g. react-live, which voice canvas templates import directly)
  const depsResult = ensureConsumerDependencies(options, installation.componentFramework);
  if (depsResult.errors.length > 0) {
    result.errors.push(...depsResult.errors);
  }

  // Wire the manager toolbar button for installs that predate it (no-op when
  // already wired or on Storybook <9).
  if (!options.dryRun && installation.storyUIDir) {
    try {
      ensureManagerAddonWiring(installation.storyUIDir);
    } catch (wireError: any) {
      result.errors.push(`manager wiring: ${wireError.message}`);
    }
  }

  // The V2 workspace is an MDX docs page — a stories glob that never matches
  // .mdx installs it invisibly. Same check init performs, same helper.
  if (!options.dryRun) {
    const globResult = ensureStoriesGlobCoversMdx(path.resolve(process.cwd(), storiesDirRel));
    if (!globResult.checked) {
      console.log(chalk.yellow('   ⚠️  No .storybook/main.ts or main.js found — MDX glob coverage was NOT checked'));
    } else if (globResult.added) {
      console.log(chalk.green(`   ✅ Added ${globResult.added} to the Storybook stories array`));
    } else if (!globResult.covered) {
      console.log(chalk.yellow('   ⚠️  Could not extend the stories array — the V2 workspace stays hidden until a glob matches its .mdx'));
    }
  }

  // Step 6: Update config version tracking
  if (!options.dryRun && installation.configPath) {
    if (updateConfigVersion(installation.configPath, result.newVersion)) {
      console.log(chalk.gray(`\n   Updated version tracking in ${path.basename(installation.configPath)}`));
    }
  }

  // Step 6: Summary
  console.log(chalk.bold('\n📊 Update Summary:'));
  console.log(chalk.green(`   ✅ Files updated: ${result.filesUpdated.length}`));

  if (result.filesBackedUp.length > 0) {
    console.log(chalk.gray(`   💾 Backups created: ${result.filesBackedUp.length}`));
  }

  if (result.errors.length > 0) {
    console.log(chalk.red(`   ❌ Errors: ${result.errors.length}`));
    for (const error of result.errors) {
      console.log(chalk.red(`      • ${error}`));
    }
  }

  result.success = result.errors.length === 0;

  if (result.success && !options.dryRun) {
    console.log(chalk.green('\n✅ Story UI updated successfully!'));
    console.log(chalk.gray('   Restart Storybook to see the changes.'));
  }

  return result;
}

/**
 * Show current Story UI installation status
 */
export function statusCommand(): void {
  console.log(chalk.bold('\n📊 Story UI Status\n'));

  const installation = detectStoryUIInstallation();
  const packageVersion = getPackageVersion();

  if (!installation.isInstalled) {
    console.log(chalk.red('❌ Story UI is not initialized in this directory.'));
    console.log(chalk.gray('   Run "npx story-ui init" to set up Story UI.'));
    return;
  }

  console.log(chalk.green('✅ Story UI is installed'));
  console.log(chalk.gray(`   Package version: ${packageVersion}`));
  console.log(chalk.gray(`   Installed version: ${installation.installedVersion || 'unknown'}`));

  if (installation.configPath) {
    console.log(chalk.gray(`   Config: ${path.basename(installation.configPath)}`));
  }

  if (installation.storyUIDir) {
    console.log(chalk.gray(`   Panel directory: ${installation.storyUIDir}`));
  }

  // Check for updates
  if (installation.installedVersion && installation.installedVersion !== packageVersion) {
    console.log(chalk.yellow(`\n⚡ Update available: ${installation.installedVersion} → ${packageVersion}`));
    console.log(chalk.gray('   Run "npx story-ui update" to update.'));
  } else if (installation.installedVersion === packageVersion) {
    console.log(chalk.green('\n✅ Up to date!'));
  }
}
