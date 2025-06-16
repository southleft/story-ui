import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';

/**
 * Production-ready gitignore manager that handles both development and server environments
 */
export class ProductionGitignoreManager {
  private config: StoryUIConfig;
  private projectRoot: string;
  private isProduction: boolean;

  constructor(config: StoryUIConfig, projectRoot: string = process.cwd()) {
    this.config = config;
    this.projectRoot = projectRoot;
    this.isProduction = this.detectProductionEnvironment();
  }

  /**
   * Detects if we're running in a production/read-only environment
   */
  private detectProductionEnvironment(): boolean {
    // Check common production environment indicators
    const prodIndicators = [
      process.env.NODE_ENV === 'production',
      process.env.VERCEL === '1',
      process.env.NETLIFY === 'true',
      process.env.CF_PAGES === '1', // Cloudflare Pages
      process.env.RENDER === 'true',
      process.env.RAILWAY_ENVIRONMENT === 'production',
      // Check if we can't write to project root
      !this.canWriteToProjectRoot()
    ];

    return prodIndicators.some(indicator => indicator);
  }

  /**
   * Tests if we can write to the project root
   */
  private canWriteToProjectRoot(): boolean {
    try {
      const testFile = path.join(this.projectRoot, '.story-ui-write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Main setup method that adapts to environment
   */
  setupGitignoreIntegration(): void {
    if (this.isProduction) {
      this.handleProductionEnvironment();
    } else {
      this.handleDevelopmentEnvironment();
    }
  }

  /**
   * Production environment: Use in-memory story generation
   */
  private handleProductionEnvironment(): void {
    console.log('🌐 Production environment detected - using in-memory story generation');

    // Validate that gitignore is already set up
    this.validateProductionSetup();

    // Set up temporary directory for story generation if needed
    this.setupTemporaryDirectory();
  }

  /**
   * Development environment: Full gitignore management
   */
  private handleDevelopmentEnvironment(): void {
    console.log('🔧 Development environment - setting up gitignore integration');

    this.ensureGeneratedDirectoryExists();
    this.ensureGeneratedDirectoryIgnored();
    this.createGeneratedDirectoryReadme();
  }

  /**
   * Validates that production environment is properly configured
   */
  private validateProductionSetup(): void {
    const gitignorePath = path.join(this.projectRoot, '.gitignore');

    if (!fs.existsSync(gitignorePath)) {
      console.warn('⚠️  No .gitignore found in production. Stories will be generated in memory only.');
      return;
    }

    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    const generatedPath = this.getRelativeGeneratedPath();

    if (generatedPath && !this.isPathIgnored(gitignoreContent, generatedPath)) {
      console.warn(`⚠️  Generated path not in .gitignore: ${generatedPath}`);
      console.warn('   Run "npx story-ui setup-gitignore" in development to fix this.');
    } else {
      console.log('✅ Production gitignore configuration validated');
    }
  }

  /**
   * Sets up temporary directory for production story generation
   */
  private setupTemporaryDirectory(): void {
    try {
      const tempDir = this.getProductionTempDirectory();
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log(`✅ Created temporary directory: ${tempDir}`);
      }
    } catch (error) {
      console.warn('⚠️  Could not create temporary directory, using in-memory generation only');
    }
  }

  /**
   * Gets a writable temporary directory for production
   */
  getProductionTempDirectory(): string {
    // Try various temporary directory locations
    const tempOptions = [
      process.env.TMPDIR,
      process.env.TMP,
      process.env.TEMP,
      '/tmp',
      path.join(process.cwd(), '.tmp')
    ].filter(Boolean);

    for (const tempPath of tempOptions) {
      try {
        const storyTempDir = path.join(tempPath!, 'story-ui-generated');
        fs.mkdirSync(storyTempDir, { recursive: true });
        return storyTempDir;
      } catch {
        continue;
      }
    }

    throw new Error('No writable temporary directory found');
  }

  /**
   * Creates the generated directory if it doesn't exist (development only)
   */
  private ensureGeneratedDirectoryExists(): void {
    const generatedDir = this.config.generatedStoriesPath;

    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
      console.log(`✅ Created generated stories directory: ${generatedDir}`);
    }
  }

  /**
   * Ensures the generated stories directory is added to .gitignore (development only)
   */
  private ensureGeneratedDirectoryIgnored(): void {
    const gitignorePath = path.join(this.projectRoot, '.gitignore');
    const generatedPath = this.getRelativeGeneratedPath();

    if (!generatedPath) {
      console.warn('Could not determine relative path for generated stories directory');
      return;
    }

    // Create .gitignore if it doesn't exist
    if (!fs.existsSync(gitignorePath)) {
      this.createGitignore(gitignorePath, generatedPath);
      return;
    }

    // Check if the path is already ignored
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    if (this.isPathIgnored(gitignoreContent, generatedPath)) {
      console.log(`✅ Generated stories directory already ignored: ${generatedPath}`);
      return;
    }

    // Add the ignore rule
    this.addIgnoreRule(gitignorePath, generatedPath);
  }

  /**
   * Gets the relative path from project root to generated stories directory
   */
  private getRelativeGeneratedPath(): string | null {
    try {
      const absoluteGeneratedPath = path.resolve(this.config.generatedStoriesPath);
      const absoluteProjectRoot = path.resolve(this.projectRoot);

      let relativePath = path.relative(absoluteProjectRoot, absoluteGeneratedPath);
      relativePath = relativePath.replace(/\\/g, '/');

      if (!relativePath.startsWith('../') && !relativePath.startsWith('/')) {
        relativePath = './' + relativePath;
      }

      return relativePath;
    } catch (error) {
      console.error('Error calculating relative path:', error);
      return null;
    }
  }

  /**
   * Creates a new .gitignore file with Story UI section
   */
  private createGitignore(gitignorePath: string, generatedPath: string): void {
    const content = this.generateGitignoreSection(generatedPath);
    fs.writeFileSync(gitignorePath, content);
    console.log(`✅ Created .gitignore with Story UI generated directory: ${generatedPath}`);
  }

  /**
   * Checks if the generated path is already ignored
   */
  private isPathIgnored(gitignoreContent: string, generatedPath: string): boolean {
    const lines = gitignoreContent.split('\n').map(line => line.trim());

    const pathVariations = [
      generatedPath,
      generatedPath.replace(/^\.\//, ''),
      generatedPath + '/',
      generatedPath.replace(/^\.\//, '') + '/',
      generatedPath + '/**',
      generatedPath.replace(/^\.\//, '') + '/**'
    ];

    return pathVariations.some(variation =>
      lines.includes(variation) ||
      lines.includes(variation.replace(/\/$/, ''))
    );
  }

  /**
   * Adds ignore rule to existing .gitignore
   */
  private addIgnoreRule(gitignorePath: string, generatedPath: string): void {
    const existingContent = fs.readFileSync(gitignorePath, 'utf-8');
    const newSection = this.generateGitignoreSection(generatedPath);

    const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
    const updatedContent = existingContent + separator + newSection;

    fs.writeFileSync(gitignorePath, updatedContent);
    console.log(`✅ Added Story UI generated directory to .gitignore: ${generatedPath}`);
  }

  /**
   * Generates the gitignore section for Story UI
   */
  private generateGitignoreSection(generatedPath: string): string {
    return `# Story UI - AI Generated Stories (ephemeral, not for version control)
# These are temporary stories for testing layouts and should not be committed
${generatedPath}/
${generatedPath}/**`;
  }

  /**
   * Creates a README in the generated directory explaining its purpose (development only)
   */
  private createGeneratedDirectoryReadme(): void {
    const generatedDir = this.config.generatedStoriesPath;
    const readmePath = path.join(generatedDir, 'README.md');

    if (fs.existsSync(readmePath)) {
      return; // Don't overwrite existing README
    }

    const readmeContent = `# AI Generated Stories

This directory contains stories generated by Story UI for testing and iteration purposes.

## ⚠️ Important Notes

- **These stories are ephemeral** - they are meant for testing layouts and sharing with stakeholders
- **Do not commit these files** - they are automatically ignored by git
- **Stories are regenerated** - feel free to delete and regenerate as needed

## Purpose

These stories are designed for:
- 🎨 **Layout Testing** - Test different component arrangements
- 👥 **Stakeholder Review** - Share layouts with product owners, designers, and project managers
- 🔄 **Rapid Iteration** - Quickly generate and modify layouts
- 📱 **Design Validation** - Validate designs before implementation

## Usage

Stories in this directory will appear in Storybook under the "${this.config.storyPrefix}" section.

Generated by [Story UI](https://github.com/your-org/story-ui) - AI-powered Storybook story generator.
`;

    try {
      fs.writeFileSync(readmePath, readmeContent);
      console.log(`✅ Created README in generated directory`);
    } catch (error) {
      console.warn('⚠️  Could not create README in generated directory');
    }
  }

  /**
   * Cleans up old generated stories (safe for both environments)
   */
  cleanupOldStories(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
    const directories = [
      this.config.generatedStoriesPath,
      this.isProduction ? this.getProductionTempDirectory() : null
    ].filter(Boolean);

    for (const dir of directories) {
      if (!dir || !fs.existsSync(dir)) continue;

      try {
        const files = fs.readdirSync(dir);
        const now = Date.now();
        let cleanedCount = 0;

        for (const file of files) {
          if (!file.endsWith('.stories.tsx')) continue;

          const filePath = path.join(dir, file);
          const stats = fs.statSync(filePath);
          const age = now - stats.mtime.getTime();

          if (age > maxAge) {
            fs.unlinkSync(filePath);
            cleanedCount++;
          }
        }

        if (cleanedCount > 0) {
          console.log(`🧹 Cleaned up ${cleanedCount} old generated stories from ${dir}`);
        }
      } catch (error) {
        console.warn(`⚠️  Could not clean up stories in ${dir}`);
      }
    }
  }

  /**
   * Gets the appropriate directory for story generation based on environment
   */
  getStoryGenerationPath(): string {
    if (this.isProduction) {
      try {
        return this.getProductionTempDirectory();
      } catch {
        // Fallback to in-memory only
        return '';
      }
    }
    return this.config.generatedStoriesPath;
  }

  /**
   * Checks if we're in production mode
   */
  isProductionMode(): boolean {
    return this.isProduction;
  }
}

/**
 * Convenience function to set up gitignore for Story UI (production-ready)
 */
export function setupProductionGitignore(config: StoryUIConfig, projectRoot?: string): ProductionGitignoreManager {
  const manager = new ProductionGitignoreManager(config, projectRoot);
  manager.setupGitignoreIntegration();
  return manager;
}
