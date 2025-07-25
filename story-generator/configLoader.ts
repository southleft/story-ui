import fs from 'fs';
import path from 'path';
import { StoryUIConfig, DEFAULT_CONFIG, createStoryUIConfig } from '../story-ui.config.js';

// Config cache to prevent excessive loading
let cachedConfig: StoryUIConfig | null = null;
let configLoadTime: number = 0;
const CONFIG_CACHE_TTL = 30000; // 30 seconds

/**
 * Loads Story UI configuration from the user's project
 * Looks for story-ui.config.js in the current working directory
 * Uses caching to prevent excessive loading
 */
export function loadUserConfig(): StoryUIConfig {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && (now - configLoadTime) < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  const configPaths = [
    path.join(process.cwd(), 'story-ui.config.js'),
    path.join(process.cwd(), 'story-ui.config.ts'),
    path.join(process.cwd(), '.storybook', 'story-ui.config.js'),
    path.join(process.cwd(), '.storybook', 'story-ui.config.ts')
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        console.log(`Loading Story UI config from: ${configPath}`);
        // Read and evaluate the config file
        const configContent = fs.readFileSync(configPath, 'utf-8');

        // Handle both CommonJS and ES modules
        if (configContent.includes('module.exports') || configContent.includes('export default')) {
          // Create a temporary module context
          const module = { exports: {} };
          const exports = module.exports;

          // For ES modules, convert to CommonJS for evaluation
          let evalContent = configContent;
          if (configContent.includes('export default')) {
            evalContent = configContent.replace(/export\s+default\s+/, 'module.exports = ');
          }

          // Evaluate the config file content
          eval(evalContent);

          const userConfig = module.exports as any;
          const config = createStoryUIConfig(userConfig.default || userConfig);

          // Detect Storybook framework if not already specified
          if (!config.storybookFramework) {
            const packageJsonPath = path.join(process.cwd(), 'package.json');
            if (fs.existsSync(packageJsonPath)) {
              try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
                config.storybookFramework = detectStorybookFramework(dependencies);
              } catch (error) {
                console.warn('Failed to detect Storybook framework:', error);
              }
            }
          }

          // Cache the loaded config
          cachedConfig = config;
          configLoadTime = now;

          return config;
        }
      } catch (error) {
        console.warn(`Failed to load config from ${configPath}:`, error);
      }
    }
  }

  // Only log warnings once per cache period
  if (!cachedConfig || (now - configLoadTime) >= CONFIG_CACHE_TTL) {
    console.warn('No story-ui.config.js found. Using default configuration.');
    console.warn('Please create a story-ui.config.js file in your project root to configure Story UI for your design system.');
  }

  // Create default config with detected framework
  const defaultConfig = { ...DEFAULT_CONFIG };
  
  // Detect Storybook framework for default config
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      defaultConfig.storybookFramework = detectStorybookFramework(dependencies);
    } catch (error) {
      console.warn('Failed to detect Storybook framework:', error);
    }
  }

  // Cache the default config
  cachedConfig = defaultConfig;
  configLoadTime = now;

  return defaultConfig;
}

/**
 * Validates that the configuration has the necessary paths and components
 */
export function validateConfig(config: StoryUIConfig): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if generated stories path exists or can be created
  if (!config.generatedStoriesPath) {
    errors.push('generatedStoriesPath is required');
  } else {
    const dir = path.dirname(config.generatedStoriesPath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        errors.push(`Cannot create generated stories directory: ${dir}`);
      }
    }
  }

  // Determine if we're using an external package (like antd, @chakra-ui/react, etc.)
  const isExternalPackage = config.importPath &&
    !config.importPath.startsWith('.') &&
    !config.importPath.startsWith('/') &&
    config.importPath !== 'your-component-library' &&
    config.importPath.trim() !== '';

  // Check if components can be discovered
  if (!isExternalPackage && !config.componentsPath && !config.componentsMetadataPath && (!config.components || config.components.length === 0)) {
    errors.push('Either componentsPath, componentsMetadataPath, or a components array must be specified');
  }

  // Only validate componentsPath if it's provided AND we're not using an external package
  if (!isExternalPackage && config.componentsPath && config.componentsPath !== null && !fs.existsSync(config.componentsPath)) {
    errors.push(`Components path does not exist: ${config.componentsPath}`);
  }

  if (config.componentsMetadataPath && !fs.existsSync(config.componentsMetadataPath)) {
    errors.push(`Components metadata path does not exist: ${config.componentsMetadataPath}`);
  }

  // Check import path - but allow it to be optional if auto-discovery will find local components
  const hasManualImportPath = config.importPath && 
    config.importPath !== 'your-component-library' && 
    config.importPath.trim() !== '';
  
  const hasLocalComponents = checkForLocalComponents(config);
  const hasManualComponents = config.components && config.components.length > 0;
  
  if (!hasManualImportPath && !hasLocalComponents && !hasManualComponents) {
    errors.push('Either importPath must be configured, or local components must be available for auto-discovery');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Check if local components are available for auto-discovery
 */
function checkForLocalComponents(config: StoryUIConfig): boolean {
  // Get project root from generated stories path
  let projectRoot = process.cwd();
  
  if (config.generatedStoriesPath) {
    let currentPath = path.resolve(config.generatedStoriesPath);
    while (currentPath !== path.dirname(currentPath)) {
      if (fs.existsSync(path.join(currentPath, 'package.json'))) {
        projectRoot = currentPath;
        break;
      }
      currentPath = path.dirname(currentPath);
    }
  }

  // Check for manually configured components path
  if (config.componentsPath && fs.existsSync(config.componentsPath)) {
    return true;
  }

  // Check for common React component directories
  const commonComponentDirs = [
    'src/components',
    'src/ui', 
    'components',
    'ui',
    'src/lib/components',
    'lib/components',
    'src/shared/components',
    'shared/components'
  ];

  for (const dir of commonComponentDirs) {
    const fullPath = path.join(projectRoot, dir);
    if (fs.existsSync(fullPath)) {
      // Check if it contains React component files
      try {
        const files = fs.readdirSync(fullPath);
        const hasComponents = files.some(file => 
          file.endsWith('.tsx') || file.endsWith('.jsx')
        );
        if (hasComponents) {
          return true;
        }
      } catch (error) {
        // Ignore errors and continue checking
      }
    }
  }

  return false;
}

/**
 * Analyzes existing Storybook files to detect design system patterns
 */
export function analyzeExistingStories(projectRoot: string = process.cwd()): {
  storyFiles: string[];
  componentDirs: string[];
  importPaths: string[];
  componentPrefixes: string[];
  layoutPatterns: string[];
} {
  const storyFiles: string[] = [];
  const componentDirs: string[] = [];
  const importPaths: string[] = [];
  const componentPrefixes: string[] = [];
  const layoutPatterns: string[] = [];

  // Find all .stories.tsx/.stories.ts files
  function findStoryFiles(dir: string, depth: number = 0): void {
    if (depth > 4) return; // Limit recursion depth

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          findStoryFiles(fullPath, depth + 1);
        } else if (entry.name.match(/\.stories\.(tsx?|jsx?)$/)) {
          storyFiles.push(fullPath);

          // Track component directory (parent of story file)
          const componentDir = path.dirname(fullPath);
          if (!componentDirs.includes(componentDir)) {
            componentDirs.push(componentDir);
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  findStoryFiles(projectRoot);

  // Analyze story files for patterns
  for (const storyFile of storyFiles) {
    try {
      const content = fs.readFileSync(storyFile, 'utf-8');

      // Extract import statements
      const importMatches = content.match(/import\s+{[^}]+}\s+from\s+['"]([^'"]+)['"]/g);
      if (importMatches) {
        for (const importMatch of importMatches) {
          const pathMatch = importMatch.match(/from\s+['"]([^'"]+)['"]/);
          if (pathMatch) {
            const importPath = pathMatch[1];
            // Skip relative imports and focus on package imports
            if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
              if (!importPaths.includes(importPath)) {
                importPaths.push(importPath);
              }
            }
          }
        }
      }

      // Extract component names to detect prefixes
      const componentMatches = content.match(/<([A-Z][A-Za-z0-9]*)/g);
      if (componentMatches) {
        for (const match of componentMatches) {
          const componentName = match.slice(1); // Remove '<'

          // Detect common prefixes (2-3 characters)
          const prefixMatch = componentName.match(/^([A-Z]{1,3})[A-Z]/);
          if (prefixMatch) {
            const prefix = prefixMatch[1];
            if (!componentPrefixes.includes(prefix)) {
              componentPrefixes.push(prefix);
            }
          }
        }
      }

      // Look for layout patterns
      const layoutMatches = content.match(/<(Grid|Row|Col|Box|Stack|Flex|Layout|Container|Section)[^>]*>/g);
      if (layoutMatches) {
        for (const match of layoutMatches) {
          if (!layoutPatterns.includes(match)) {
            layoutPatterns.push(match);
          }
        }
      }
    } catch (error) {
      // Skip files we can't read
    }
  }

  return {
    storyFiles,
    componentDirs,
    importPaths,
    componentPrefixes,
    layoutPatterns
  };
}

/**
 * Detects the Storybook framework being used
 */
export function detectStorybookFramework(dependencies: Record<string, string>): string {
  // Check for Vite-based Storybook
  if (dependencies['@storybook/react-vite']) {
    return '@storybook/react-vite';
  } else if (dependencies['@storybook/react-webpack5']) {
    return '@storybook/react-webpack5';
  } else if (dependencies['@storybook/nextjs']) {
    return '@storybook/nextjs';
  }
  // Default to generic React
  return '@storybook/react';
}

/**
 * Auto-detects design system configuration by analyzing the project structure
 */
export function autoDetectDesignSystem(): Partial<StoryUIConfig> | null {
  const cwd = process.cwd();
  const packageJsonPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // First, try to detect known design systems from package.json
    const knownSystems = detectKnownDesignSystems(dependencies);
    if (knownSystems) {
      console.log(`🎨 Detected known design system: ${knownSystems.importPath}`);
    }

    // Analyze existing Storybook files for patterns
    const analysis = analyzeExistingStories(cwd);
    console.log(`📊 Analysis found: ${analysis.storyFiles.length} story files, ${analysis.componentDirs.length} component directories`);

    // Determine if we're using an external package
    const isExternalPackage = knownSystems && knownSystems.importPath &&
      !knownSystems.importPath.startsWith('.') &&
      !knownSystems.importPath.startsWith('/');

    // Only determine component path if we're not using an external package
    const componentPath = !isExternalPackage ?
      findMostLikelyComponentDirectory(analysis.componentDirs, cwd) :
      undefined;

    // Determine the most likely import path
    const importPath = findMostLikelyImportPath(analysis.importPaths, packageJson.name);

    // Determine component prefix
    const componentPrefix = findMostLikelyPrefix(analysis.componentPrefixes);

    // Determine layout patterns
    const layoutRules = detectLayoutPatterns(analysis.layoutPatterns, componentPrefix);

    // Detect Storybook framework
    const storybookFramework = detectStorybookFramework(dependencies);

    // Build configuration
    const config: Partial<StoryUIConfig> = {
      generatedStoriesPath: path.join(cwd, 'src/stories/generated/'),
      importPath: importPath,
      componentPrefix: componentPrefix,
      layoutRules: layoutRules,
      storybookFramework: storybookFramework
    };

    // Only set componentsPath for local component libraries
    if (componentPath && !isExternalPackage) {
      config.componentsPath = componentPath;
    }

    // Merge with known system config if available
    if (knownSystems) {
      return { ...knownSystems, ...config };
    }

    return config;

  } catch (error) {
    console.warn('Failed to auto-detect design system:', error);
    return null;
  }
}

/**
 * Detects known design systems from package.json dependencies
 */
function detectKnownDesignSystems(dependencies: Record<string, string>): Partial<StoryUIConfig> | null {
  // Chakra UI detection
  if (dependencies['@chakra-ui/react']) {
    return {
      importPath: '@chakra-ui/react',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'SimpleGrid',
        columnComponent: 'Box',
        containerComponent: 'Container'
      }
    };
  }

  // Ant Design detection
  if (dependencies['antd']) {
    return {
      importPath: 'antd',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'Row',
        columnComponent: 'Col',
        containerComponent: 'div'
      }
    };
  }

  // Mantine detection
  if (dependencies['@mantine/core']) {
    return {
      importPath: '@mantine/core',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'SimpleGrid',
        columnComponent: 'div',
        containerComponent: 'Container'
      }
    };
  }


  // ShadCN/UI detection
  if (dependencies['@radix-ui/react-slot'] || dependencies['class-variance-authority']) {
    return {
      importPath: '@/components/ui',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'div',
        columnComponent: 'div',
        containerComponent: 'div',
        layoutExamples: {
          twoColumn: `<div className="grid grid-cols-2 gap-4">
  <div>
    <Card>
      <CardHeader>
        <CardTitle>Left Card</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Left content</p>
      </CardContent>
    </Card>
  </div>
  <div>
    <Card>
      <CardHeader>
        <CardTitle>Right Card</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Right content</p>
      </CardContent>
    </Card>
  </div>
</div>`
        }
      }
    };
  }

  return null;
}

/**
 * Finds the most likely component directory based on story file locations
 */
function findMostLikelyComponentDirectory(componentDirs: string[], projectRoot: string): string {
  if (componentDirs.length === 0) {
    // Fallback to common patterns
    const commonPaths = [
      path.join(projectRoot, 'src/components'),
      path.join(projectRoot, 'components'),
      path.join(projectRoot, 'lib/components'),
      path.join(projectRoot, 'src/ui'),
      path.join(projectRoot, 'ui')
    ];

    for (const commonPath of commonPaths) {
      if (fs.existsSync(commonPath)) {
        return commonPath;
      }
    }

    return path.join(projectRoot, 'src/components');
  }

  // Find the common parent directory of most story files
  const dirCounts: Record<string, number> = {};

  for (const dir of componentDirs) {
    // Count occurrences of parent directories
    let currentDir = dir;
    while (currentDir !== projectRoot && currentDir !== path.dirname(currentDir)) {
      dirCounts[currentDir] = (dirCounts[currentDir] || 0) + 1;
      currentDir = path.dirname(currentDir);
    }
  }

  // Find the directory with the most story files
  let maxCount = 0;
  let bestDir = path.join(projectRoot, 'src/components');

  for (const [dir, count] of Object.entries(dirCounts)) {
    if (count > maxCount) {
      maxCount = count;
      bestDir = dir;
    }
  }

  return bestDir;
}

/**
 * Finds the most likely import path based on import analysis
 */
function findMostLikelyImportPath(importPaths: string[], packageName?: string): string {
  if (importPaths.length === 0) {
    return packageName || 'your-component-library';
  }

  // Count frequency of import paths
  const pathCounts: Record<string, number> = {};

  for (const importPath of importPaths) {
    // Skip common non-component libraries
    if (importPath.includes('react') || importPath.includes('storybook') ||
        importPath.includes('testing') || importPath.includes('jest')) {
      continue;
    }

    pathCounts[importPath] = (pathCounts[importPath] || 0) + 1;
  }

  // Find the most common import path
  let maxCount = 0;
  let bestPath = packageName || 'your-component-library';

  for (const [importPath, count] of Object.entries(pathCounts)) {
    if (count > maxCount) {
      maxCount = count;
      bestPath = importPath;
    }
  }

  return bestPath;
}

/**
 * Finds the most likely component prefix
 */
function findMostLikelyPrefix(componentPrefixes: string[]): string {
  if (componentPrefixes.length === 0) {
    return '';
  }

  // Count frequency of prefixes
  const prefixCounts: Record<string, number> = {};

  for (const prefix of componentPrefixes) {
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
  }

  // Find the most common prefix
  let maxCount = 0;
  let bestPrefix = '';

  for (const [prefix, count] of Object.entries(prefixCounts)) {
    if (count > maxCount && count > 2) { // Only consider prefixes used multiple times
      maxCount = count;
      bestPrefix = prefix;
    }
  }

  return bestPrefix;
}

/**
 * Detects layout patterns from existing components
 */
function detectLayoutPatterns(layoutPatterns: string[], componentPrefix: string): any {
  const rules: any = {
    multiColumnWrapper: 'div',
    columnComponent: 'div',
    containerComponent: 'div',
    layoutExamples: {
      twoColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
</div>`
    },
    prohibitedElements: []
  };

  // Analyze layout patterns to determine best components
  for (const pattern of layoutPatterns) {
    if (pattern.includes('Grid')) {
      rules.multiColumnWrapper = componentPrefix ? `${componentPrefix}Grid` : 'Grid';
      rules.columnComponent = componentPrefix ? `${componentPrefix}Grid` : 'Grid';
    } else if (pattern.includes('Row') && pattern.includes('Col')) {
      rules.multiColumnWrapper = componentPrefix ? `${componentPrefix}Row` : 'Row';
      rules.columnComponent = componentPrefix ? `${componentPrefix}Col` : 'Col';
    } else if (pattern.includes('Stack')) {
      rules.multiColumnWrapper = componentPrefix ? `${componentPrefix}Stack` : 'Stack';
      rules.columnComponent = componentPrefix ? `${componentPrefix}Box` : 'Box';
    } else if (pattern.includes('Layout')) {
      rules.multiColumnWrapper = componentPrefix ? `${componentPrefix}Layout` : 'Layout';
      rules.columnComponent = componentPrefix ? `${componentPrefix}LayoutSection` : 'LayoutSection';
    }

    if (pattern.includes('Container')) {
      rules.containerComponent = componentPrefix ? `${componentPrefix}Container` : 'Container';
    }
  }

  return rules;
}
