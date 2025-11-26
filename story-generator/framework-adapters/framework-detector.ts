/**
 * Framework Detection System
 *
 * Automatically detects the component framework and story framework
 * used in a project by analyzing package.json, config files, and
 * file patterns.
 */

import fs from 'fs';
import path from 'path';
import {
  FrameworkType,
  StoryFramework,
  DetectedFramework,
  FrameworkDetectionResult,
  FrameworkConfig,
} from './types.js';
import { logger } from '../logger.js';

/**
 * Framework detection patterns
 */
interface FrameworkPattern {
  framework: FrameworkType;
  storyFramework: StoryFramework;
  packageIndicators: string[];
  configFiles: string[];
  filePatterns: string[];
  weight: number;
}

const FRAMEWORK_PATTERNS: FrameworkPattern[] = [
  // React
  {
    framework: 'react',
    storyFramework: 'storybook-react',
    packageIndicators: ['react', 'react-dom', '@storybook/react', '@storybook/react-vite', '@storybook/react-webpack5'],
    configFiles: ['.storybook/main.js', '.storybook/main.ts', '.storybook/preview.js'],
    filePatterns: ['*.jsx', '*.tsx', '*.stories.tsx', '*.stories.jsx'],
    weight: 10,
  },
  // Vue 3
  {
    framework: 'vue',
    storyFramework: 'storybook-vue3',
    packageIndicators: ['vue', '@vue/runtime-core', '@storybook/vue3', '@storybook/vue3-vite'],
    configFiles: ['vite.config.ts', 'vue.config.js', 'nuxt.config.ts'],
    filePatterns: ['*.vue', '*.stories.ts'],
    weight: 10,
  },
  // Angular
  {
    framework: 'angular',
    storyFramework: 'storybook-angular',
    packageIndicators: ['@angular/core', '@angular/common', '@storybook/angular'],
    configFiles: ['angular.json', 'ng-package.json'],
    filePatterns: ['*.component.ts', '*.stories.ts'],
    weight: 10,
  },
  // Svelte
  {
    framework: 'svelte',
    storyFramework: 'storybook-svelte',
    packageIndicators: ['svelte', '@sveltejs/kit', '@storybook/svelte', '@storybook/svelte-vite'],
    configFiles: ['svelte.config.js', 'svelte.config.ts'],
    filePatterns: ['*.svelte', '*.stories.svelte'],
    weight: 10,
  },
  // Web Components
  {
    framework: 'web-components',
    storyFramework: 'storybook-web-components',
    packageIndicators: ['lit', 'lit-element', 'lit-html', '@storybook/web-components', '@open-wc/testing'],
    configFiles: ['web-dev-server.config.js', 'custom-elements.json'],
    filePatterns: ['*.element.ts', '*.element.js'],
    weight: 10,
  },
  // Solid
  {
    framework: 'solid',
    storyFramework: 'storybook-react', // Uses React adapter with solid-js
    packageIndicators: ['solid-js', '@solidjs/router'],
    configFiles: ['vite.config.ts'],
    filePatterns: ['*.tsx', '*.jsx'],
    weight: 8,
  },
  // Qwik
  {
    framework: 'qwik',
    storyFramework: 'custom',
    packageIndicators: ['@builder.io/qwik', '@builder.io/qwik-city'],
    configFiles: ['qwik.config.ts'],
    filePatterns: ['*.tsx'],
    weight: 8,
  },
  // Histoire (Vue alternative)
  {
    framework: 'vue',
    storyFramework: 'histoire',
    packageIndicators: ['histoire', '@histoire/plugin-vue'],
    configFiles: ['histoire.config.ts', 'histoire.config.js'],
    filePatterns: ['*.story.vue'],
    weight: 12,
  },
  // Ladle (React alternative)
  {
    framework: 'react',
    storyFramework: 'ladle',
    packageIndicators: ['@ladle/react'],
    configFiles: ['.ladle/config.mjs'],
    filePatterns: ['*.stories.tsx'],
    weight: 12,
  },
];

/**
 * Framework Detector Class
 */
export class FrameworkDetector {
  private projectRoot: string;
  private packageJson: Record<string, unknown> | null = null;
  private dependencies: Record<string, string> = {};
  private detectedConfigFiles: string[] = [];

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Detect frameworks used in the project
   */
  async detect(): Promise<FrameworkDetectionResult> {
    logger.debug('Starting framework detection', { projectRoot: this.projectRoot });

    // Load package.json
    await this.loadPackageJson();

    // Scan for config files
    this.scanConfigFiles();

    // Score each framework pattern
    const frameworkScores = this.scoreFrameworks();

    // Sort by score descending
    const sortedFrameworks = frameworkScores
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score);

    // Convert to DetectedFramework objects
    const detectedFrameworks: DetectedFramework[] = sortedFrameworks.map(f => ({
      componentFramework: f.pattern.framework,
      storyFramework: f.pattern.storyFramework,
      version: this.getFrameworkVersion(f.pattern.framework),
      config: this.getFrameworkConfig(f.pattern.framework),
      confidence: Math.min(f.score / 30, 1), // Normalize to 0-1
    }));

    // Default to React if nothing detected
    const defaultFramework: DetectedFramework = {
      componentFramework: 'react',
      storyFramework: 'storybook-react',
      config: this.getFrameworkConfig('react'),
      confidence: 0.5,
    };

    const primary = detectedFrameworks[0] || defaultFramework;

    logger.info('Framework detection complete', {
      primary: primary.componentFramework,
      storyFramework: primary.storyFramework,
      confidence: primary.confidence,
    });

    return {
      frameworks: detectedFrameworks.length > 0 ? detectedFrameworks : [defaultFramework],
      primary,
      dependencies: this.dependencies,
      configFiles: this.detectedConfigFiles,
    };
  }

  /**
   * Load and parse package.json
   */
  private async loadPackageJson(): Promise<void> {
    const packagePath = path.join(this.projectRoot, 'package.json');

    try {
      if (fs.existsSync(packagePath)) {
        const content = fs.readFileSync(packagePath, 'utf-8');
        this.packageJson = JSON.parse(content);

        // Merge all dependencies
        this.dependencies = {
          ...(this.packageJson?.dependencies as Record<string, string> || {}),
          ...(this.packageJson?.devDependencies as Record<string, string> || {}),
          ...(this.packageJson?.peerDependencies as Record<string, string> || {}),
        };

        logger.debug('Loaded package.json', {
          dependencyCount: Object.keys(this.dependencies).length,
        });
      }
    } catch (error) {
      logger.warn('Failed to load package.json', { error });
    }
  }

  /**
   * Scan for framework configuration files
   */
  private scanConfigFiles(): void {
    const allConfigFiles = new Set<string>();

    for (const pattern of FRAMEWORK_PATTERNS) {
      for (const configFile of pattern.configFiles) {
        allConfigFiles.add(configFile);
      }
    }

    for (const configFile of allConfigFiles) {
      const fullPath = path.join(this.projectRoot, configFile);
      if (fs.existsSync(fullPath)) {
        this.detectedConfigFiles.push(configFile);
      }
    }

    logger.debug('Config files detected', {
      configFiles: this.detectedConfigFiles,
    });
  }

  /**
   * Score each framework pattern based on evidence
   */
  private scoreFrameworks(): Array<{ pattern: FrameworkPattern; score: number }> {
    return FRAMEWORK_PATTERNS.map(pattern => {
      let score = 0;

      // Check package indicators
      for (const pkg of pattern.packageIndicators) {
        if (this.dependencies[pkg]) {
          score += pattern.weight;

          // Extra weight for Storybook packages
          if (pkg.startsWith('@storybook/')) {
            score += 5;
          }
        }
      }

      // Check config files
      for (const configFile of pattern.configFiles) {
        if (this.detectedConfigFiles.includes(configFile)) {
          score += pattern.weight / 2;
        }
      }

      return { pattern, score };
    });
  }

  /**
   * Get framework version from dependencies
   */
  private getFrameworkVersion(framework: FrameworkType): string | undefined {
    const versionMap: Record<FrameworkType, string[]> = {
      'react': ['react'],
      'vue': ['vue'],
      'angular': ['@angular/core'],
      'svelte': ['svelte'],
      'web-components': ['lit', 'lit-element'],
      'solid': ['solid-js'],
      'qwik': ['@builder.io/qwik'],
    };

    const packages = versionMap[framework] || [];
    for (const pkg of packages) {
      if (this.dependencies[pkg]) {
        return this.dependencies[pkg].replace(/[\^~]/, '');
      }
    }
    return undefined;
  }

  /**
   * Get framework-specific configuration
   */
  private getFrameworkConfig(framework: FrameworkType): FrameworkConfig {
    const configs: Record<FrameworkType, FrameworkConfig> = {
      'react': {
        importStyle: 'named',
        storyExtension: '.stories.tsx',
        typescript: true,
        jsx: true,
        componentExtension: '.tsx',
      },
      'vue': {
        importStyle: 'default',
        storyExtension: '.stories.ts',
        typescript: true,
        jsx: false,
        componentExtension: '.vue',
      },
      'angular': {
        importStyle: 'named',
        storyExtension: '.stories.ts',
        typescript: true,
        jsx: false,
        componentExtension: '.component.ts',
      },
      'svelte': {
        importStyle: 'default',
        storyExtension: '.stories.svelte',
        typescript: true,
        jsx: false,
        componentExtension: '.svelte',
      },
      'web-components': {
        importStyle: 'named',
        storyExtension: '.stories.ts',
        typescript: true,
        jsx: false,
        componentExtension: '.ts',
      },
      'solid': {
        importStyle: 'named',
        storyExtension: '.stories.tsx',
        typescript: true,
        jsx: true,
        componentExtension: '.tsx',
      },
      'qwik': {
        importStyle: 'named',
        storyExtension: '.stories.tsx',
        typescript: true,
        jsx: true,
        componentExtension: '.tsx',
      },
    };

    return configs[framework] || configs['react'];
  }

  /**
   * Quick check for a specific framework
   */
  hasFramework(framework: FrameworkType): boolean {
    const packageMap: Record<FrameworkType, string[]> = {
      'react': ['react', 'react-dom'],
      'vue': ['vue'],
      'angular': ['@angular/core'],
      'svelte': ['svelte'],
      'web-components': ['lit', 'lit-element', '@open-wc/testing'],
      'solid': ['solid-js'],
      'qwik': ['@builder.io/qwik'],
    };

    const packages = packageMap[framework] || [];
    return packages.some(pkg => !!this.dependencies[pkg]);
  }
}

/**
 * Factory function for framework detection
 */
export function detectFramework(projectRoot?: string): Promise<FrameworkDetectionResult> {
  const detector = new FrameworkDetector(projectRoot);
  return detector.detect();
}

/**
 * Get framework detector instance
 */
export function getFrameworkDetector(projectRoot?: string): FrameworkDetector {
  return new FrameworkDetector(projectRoot);
}
