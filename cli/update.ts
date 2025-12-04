import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Story UI Update Command
 *
 * Refreshes managed Story UI files (StoryUIPanel.tsx, StoryUIPanel.mdx, index.tsx)
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
    source: 'templates/StoryUI/StoryUIPanel.mdx',
    target: 'src/stories/StoryUI/StoryUIPanel.mdx',
    description: 'Cross-framework MDX wrapper'
  },
  {
    source: 'templates/StoryUI/index.tsx',
    target: 'src/stories/StoryUI/index.tsx',
    description: 'Panel registration'
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
} {
  const cwd = process.cwd();

  // Check for Story UI directory
  const possibleStoryUIDirs = [
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

  // Try to read installed version from config
  let installedVersion: string | undefined;
  if (configPath) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const versionMatch = configContent.match(/_storyUIVersion:\s*['"]([^'"]+)['"]/);
      if (versionMatch) {
        installedVersion = versionMatch[1];
      }
    } catch (error) {
      // Ignore read errors
    }
  }

  return {
    isInstalled: !!(storyUIDir || configPath),
    storyUIDir,
    configPath,
    installedVersion
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

  // Step 2: Show what will be updated
  console.log(chalk.bold('\n📦 Managed files to update:'));

  const filesToUpdate: typeof MANAGED_FILES = [];
  for (const file of MANAGED_FILES) {
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

  if (filesToUpdate.length === 0) {
    console.log(chalk.green('\n✅ All files are already up to date!'));
    result.success = true;
    return result;
  }

  // Step 3: Confirm update (unless --force or --dry-run)
  if (!options.force && !options.dryRun) {
    console.log(chalk.yellow('\n⚠️  The following will NOT be modified:'));
    console.log(chalk.gray('   • story-ui.config.js (your configuration)'));
    console.log(chalk.gray('   • .env (your API keys)'));
    console.log(chalk.gray('   • story-ui-docs/ (your documentation)'));
    console.log(chalk.gray('   • src/stories/generated/ (your generated stories)'));

    const { confirm } = await inquirer.prompt([{
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

  // Step 5: Update config version tracking
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
