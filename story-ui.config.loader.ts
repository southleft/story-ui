import fs from 'fs';
import path from 'path';
import { StoryUIConfig, createStoryUIConfig, GENERIC_CONFIG_TEMPLATE } from './story-ui.config.js';

/**
 * Loads Story UI configuration from various sources
 */
export class StoryUIConfigLoader {
  private static instance: StoryUIConfigLoader;
  private config: StoryUIConfig | null = null;

  static getInstance(): StoryUIConfigLoader {
    if (!StoryUIConfigLoader.instance) {
      StoryUIConfigLoader.instance = new StoryUIConfigLoader();
    }
    return StoryUIConfigLoader.instance;
  }

  /**
   * Load configuration from a file
   */
  async loadFromFile(configPath: string): Promise<StoryUIConfig> {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    try {
      // Support both .js and .json config files
      let userConfig: Partial<StoryUIConfig>;

      if (configPath.endsWith('.json')) {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        userConfig = JSON.parse(configContent);
      } else {
        // Dynamic import for .js/.ts files
        const configModule = await import(configPath);
        userConfig = configModule.default || configModule.config || configModule;
      }

      this.config = createStoryUIConfig(userConfig);
      return this.config;
    } catch (error) {
      throw new Error(`Failed to load configuration from ${configPath}: ${error}`);
    }
  }

  /**
   * Load configuration from package.json
   */
  loadFromPackageJson(packagePath: string = process.cwd()): StoryUIConfig {
    const packageJsonPath = path.join(packagePath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(`package.json not found at ${packageJsonPath}`);
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const storyUIConfig = packageJson.storyUI || {};

      // Auto-detect common paths if not specified
      if (!storyUIConfig.generatedStoriesPath) {
        const possiblePaths = [
          path.join(packagePath, 'src/stories/generated'),
          path.join(packagePath, 'stories/generated'),
          path.join(packagePath, '.storybook/generated'),
          path.join(packagePath, 'src/components/generated')
        ];

        for (const possiblePath of possiblePaths) {
          if (fs.existsSync(path.dirname(possiblePath))) {
            storyUIConfig.generatedStoriesPath = possiblePath;
            break;
          }
        }
      }

      // Auto-detect components path
      if (!storyUIConfig.componentsPath) {
        const possiblePaths = [
          path.join(packagePath, 'src/components'),
          path.join(packagePath, 'lib/components'),
          path.join(packagePath, 'components'),
          path.join(packagePath, 'src')
        ];

        for (const possiblePath of possiblePaths) {
          if (fs.existsSync(possiblePath)) {
            storyUIConfig.componentsPath = possiblePath;
            break;
          }
        }
      }

      // Auto-detect import path from package name
      if (!storyUIConfig.importPath && packageJson.name) {
        storyUIConfig.importPath = packageJson.name;
      }

      this.config = createStoryUIConfig(storyUIConfig);
      return this.config;
    } catch (error) {
      throw new Error(`Failed to load configuration from package.json: ${error}`);
    }
  }

  /**
   * Auto-detect configuration from project structure
   */
  autoDetectConfig(projectPath: string = process.cwd()): StoryUIConfig {
    const config: Partial<StoryUIConfig> = { ...GENERIC_CONFIG_TEMPLATE };

    // Try to detect from package.json first
    try {
      return this.loadFromPackageJson(projectPath);
    } catch (error) {
      console.warn('Could not load from package.json, using auto-detection');
    }

    // Auto-detect paths
    const possibleComponentPaths = [
      path.join(projectPath, 'src/components'),
      path.join(projectPath, 'lib/components'),
      path.join(projectPath, 'components'),
      path.join(projectPath, 'src')
    ];

    for (const possiblePath of possibleComponentPaths) {
      if (fs.existsSync(possiblePath)) {
        config.componentsPath = possiblePath;
        break;
      }
    }

    // Set generated stories path
    config.generatedStoriesPath = path.join(projectPath, 'src/stories/generated');

    // Try to detect component prefix from existing components
    if (config.componentsPath) {
      const componentDirs = fs.readdirSync(config.componentsPath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .slice(0, 5); // Check first 5 components

      // Look for common prefixes
      const prefixes = ['UI', 'App', 'My', 'Custom'];
      for (const prefix of prefixes) {
        if (componentDirs.some(name => name.startsWith(prefix))) {
          config.componentPrefix = prefix;
          break;
        }
      }
    }

    this.config = createStoryUIConfig(config);
    return this.config;
  }

  /**
   * Get current configuration
   */
  getConfig(): StoryUIConfig | null {
    return this.config;
  }

  /**
   * Set configuration directly
   */
  setConfig(config: StoryUIConfig): void {
    this.config = config;
  }

  /**
   * Generate a sample configuration file
   */
  generateSampleConfig(outputPath: string, type: 'json' | 'js' = 'json'): void {
    const sampleConfig: Partial<StoryUIConfig> = {
      generatedStoriesPath: './src/stories/generated',
      componentsPath: './src/components',
      storyPrefix: 'Generated/',
      defaultAuthor: 'Story UI AI',
      importPath: 'your-component-library',
      componentPrefix: 'UI',
      layoutRules: {
        multiColumnWrapper: 'div',
        columnComponent: 'div',
        layoutExamples: {
          twoColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
</div>`,
          threeColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
  <div>Column 3 content</div>
</div>`
        },
        prohibitedElements: []
      }
    };

    if (type === 'json') {
      fs.writeFileSync(outputPath, JSON.stringify(sampleConfig, null, 2));
    } else {
      const jsContent = `export default ${JSON.stringify(sampleConfig, null, 2)};`;
      fs.writeFileSync(outputPath, jsContent);
    }

    console.log(`Sample configuration written to: ${outputPath}`);
  }
}

// Convenience functions
export const configLoader = StoryUIConfigLoader.getInstance();

export function loadStoryUIConfig(configPath?: string): Promise<StoryUIConfig> {
  if (configPath) {
    return configLoader.loadFromFile(configPath);
  } else {
    // Try auto-detection
    try {
      return Promise.resolve(configLoader.loadFromPackageJson());
    } catch {
      return Promise.resolve(configLoader.autoDetectConfig());
    }
  }
}
