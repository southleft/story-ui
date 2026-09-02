import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';
import { StoryUIConfig, DEFAULT_CONFIG, createStoryUIConfig, IconImportsConfig } from '../story-ui.config.js';

/**
 * Known icon packages for auto-detection
 * When a project has one of these packages installed, we automatically
 * configure icon imports to allow them in validation
 */
interface KnownIconPackage {
  name: string;
  importPath: string;
  commonIcons: string[];
}

const KNOWN_ICON_PACKAGES: KnownIconPackage[] = [
  {
    name: '@tabler/icons-react',
    importPath: '@tabler/icons-react',
    commonIcons: [
      'IconHome', 'IconSettings', 'IconUser', 'IconSearch', 'IconMenu2',
      'IconBell', 'IconMail', 'IconCalendar', 'IconClock', 'IconStar',
      'IconHeart', 'IconPlus', 'IconMinus', 'IconX', 'IconCheck',
      'IconChevronRight', 'IconChevronLeft', 'IconChevronDown', 'IconChevronUp',
      'IconArrowRight', 'IconArrowLeft', 'IconArrowUp', 'IconArrowDown',
      'IconEdit', 'IconTrash', 'IconDownload', 'IconUpload', 'IconShare',
      'IconFilter', 'IconSort', 'IconRefresh', 'IconEye', 'IconEyeOff',
      'IconLock', 'IconUnlock', 'IconCopy', 'IconClipboard', 'IconFolder',
      'IconFile', 'IconImage', 'IconVideo', 'IconMusic', 'IconLink',
      'IconExternalLink', 'IconDots', 'IconDotsVertical', 'IconGripVertical',
      'IconTrendingUp', 'IconTrendingDown', 'IconActivity', 'IconPieChart',
      'IconDatabase', 'IconServer', 'IconCode', 'IconTerminal',
    ],
  },
  {
    name: 'lucide-react',
    importPath: 'lucide-react',
    commonIcons: [
      'Home', 'Settings', 'User', 'Search', 'Menu',
      'Bell', 'Mail', 'Calendar', 'Clock', 'Star',
      'Heart', 'Plus', 'Minus', 'X', 'Check',
      'ChevronRight', 'ChevronLeft', 'ChevronDown', 'ChevronUp',
      'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
      'Edit', 'Trash', 'Download', 'Upload', 'Share',
      'Filter', 'RefreshCw', 'Eye', 'EyeOff',
      'Lock', 'Unlock', 'Copy', 'Clipboard', 'Folder',
    ],
  },
  {
    name: '@heroicons/react',
    importPath: '@heroicons/react/24/outline',
    commonIcons: [
      'HomeIcon', 'Cog6ToothIcon', 'UserIcon', 'MagnifyingGlassIcon', 'Bars3Icon',
      'BellIcon', 'EnvelopeIcon', 'CalendarIcon', 'ClockIcon', 'StarIcon',
      'HeartIcon', 'PlusIcon', 'MinusIcon', 'XMarkIcon', 'CheckIcon',
      'ChevronRightIcon', 'ChevronLeftIcon', 'ChevronDownIcon', 'ChevronUpIcon',
      'ArrowRightIcon', 'ArrowLeftIcon', 'ArrowUpIcon', 'ArrowDownIcon',
    ],
  },
  {
    name: 'react-icons',
    importPath: 'react-icons/fa',
    commonIcons: [
      'FaHome', 'FaCog', 'FaUser', 'FaSearch', 'FaBars',
      'FaBell', 'FaEnvelope', 'FaCalendar', 'FaClock', 'FaStar',
      'FaHeart', 'FaPlus', 'FaMinus', 'FaTimes', 'FaCheck',
      'FaChevronRight', 'FaChevronLeft', 'FaChevronDown', 'FaChevronUp',
    ],
  },
  {
    name: '@phosphor-icons/react',
    importPath: '@phosphor-icons/react',
    commonIcons: [
      'House', 'Gear', 'User', 'MagnifyingGlass', 'List',
      'Bell', 'Envelope', 'Calendar', 'Clock', 'Star',
      'Heart', 'Plus', 'Minus', 'X', 'Check',
      'CaretRight', 'CaretLeft', 'CaretDown', 'CaretUp',
    ],
  },
];

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// Config cache to prevent excessive loading
let cachedConfig: StoryUIConfig | null = null;
let configLoadTime: number = 0;
const CONFIG_CACHE_TTL = 30000; // 30 seconds

/**
 * Normalize relative paths in config to absolute paths based on config file location.
 * This fixes the issue where paths like './src/components' fail when process.cwd()
 * differs from the config file location (e.g., when running via MCP or symlinks).
 */
function normalizeConfigPaths(config: StoryUIConfig, configFileDir: string): StoryUIConfig {
  const resolvePath = (p: string | undefined): string | undefined => {
    if (!p) return p;
    // If already absolute, return as-is
    if (path.isAbsolute(p)) return p;
    // Resolve relative path against config file directory
    return path.resolve(configFileDir, p);
  };

  // Normalize all path-related config fields
  if (config.generatedStoriesPath) {
    config.generatedStoriesPath = resolvePath(config.generatedStoriesPath)!;
  }
  if (config.componentsPath) {
    config.componentsPath = resolvePath(config.componentsPath);
  }
  if (config.componentsMetadataPath) {
    config.componentsMetadataPath = resolvePath(config.componentsMetadataPath);
  }
  if (config.considerationsPath) {
    config.considerationsPath = resolvePath(config.considerationsPath);
  }

  return config;
}

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
    path.join(process.cwd(), 'story-ui.config.cjs'),
    path.join(process.cwd(), 'story-ui.config.ts'),
    path.join(process.cwd(), '.storybook', 'story-ui.config.js'),
    path.join(process.cwd(), '.storybook', 'story-ui.config.cjs'),
    path.join(process.cwd(), '.storybook', 'story-ui.config.ts')
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        // Only log to stderr when in MCP mode to avoid corrupting JSON-RPC communication
        const isMcpMode = process.argv.includes('mcp') || process.env.STORY_UI_MCP_MODE === 'true';
        if (isMcpMode) {
          console.error(`Loading Story UI config from: ${configPath}`);
        } else {
          console.log(`Loading Story UI config from: ${configPath}`);
        }

        // Use require() for safe config loading (no eval)
        // Clear require cache to ensure fresh config on reload
        const resolvedPath = path.resolve(configPath);
        delete require.cache[resolvedPath];

        let userConfig: any;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const loadedModule = require(resolvedPath);
          userConfig = loadedModule.default || loadedModule;
        } catch (requireError) {
          // If require() fails (e.g., ESM project with CJS config), fall back to parsing
          // This handles "type": "module" projects with module.exports configs
          const configContent = fs.readFileSync(configPath, 'utf-8');

          // Try to extract the config object from CommonJS module.exports
          // Match module.exports = { ... } with potential trailing semicolons and whitespace
          const match = configContent.match(/module\.exports\s*=\s*(\{[\s\S]*\})\s*;*/);
          if (match) {
            try {
              // Clean the config object: remove JS comments for JSON.parse compatibility
              let configObj = match[1]
                .replace(/\/\/[^\n]*/g, '') // Remove single-line comments
                .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas

              // Use vm.runInNewContext for sandboxed evaluation (no access to require, process, etc.)
              userConfig = vm.runInNewContext(`(${configObj})`, Object.create(null), { timeout: 1000 });
            } catch (parseError) {
              console.warn(`Failed to parse config from ${configPath}:`, parseError);
              throw requireError; // Re-throw original error
            }
          } else {
            throw requireError; // Re-throw if we can't parse it
          }
        }
        let config = createStoryUIConfig(userConfig);

        // CRITICAL: Normalize relative paths to absolute paths based on config file location
        // This ensures paths work regardless of process.cwd() (important for MCP servers and symlinks)
        const configFileDir = path.dirname(configPath);
        config = normalizeConfigPaths(config, configFileDir);

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

        // Auto-detect icon package if not already configured
        // This is critical for allowing icon imports in generated stories
        if (!config.iconImports) {
          const detectedIconPackage = detectInstalledIconPackage();
          if (detectedIconPackage) {
            config.iconImports = detectedIconPackage;
          }
        }

        // Cache the loaded config
        cachedConfig = config;
        configLoadTime = now;

        return config;
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

/** The file stems `storybook init` writes into its scaffold stories directory. */
export const STORYBOOK_SCAFFOLD_STEMS = ['Button', 'Header', 'Page', 'Introduction', 'Configure'];

/**
 * Is this story file Storybook's own scaffold? Every story imports from
 * `storybook`, so the package name proves nothing for a story file. The
 * scaffold's stories carry one of five file stems, link to storybook.js.org
 * from their comments and title themselves `Example/…`; a project's own
 * Button.stories.tsx does neither.
 */
export function isStorybookScaffoldStory(fileName: string, content: string): boolean {
  const stem = path.basename(fileName).split('.')[0];
  if (!STORYBOOK_SCAFFOLD_STEMS.includes(stem)) return false;
  return /storybook\.js\.org|title:\s*['"]Example\//.test(content);
}

/** Directories a local component library usually lives in, most common first. */
export const LOCAL_COMPONENT_DIR_CANDIDATES = [
  'src/components', 'src/ui', 'components', 'src/lib/components', 'lib/components', 'src/design-system', 'packages/ui/src', 'ui',
];

const isComponentSourceFile = (f: string) =>
  /^[A-Z][\w-]*\.(tsx|jsx|vue|svelte)$/.test(f) && !/\.(stories|test|spec)\./.test(f);

/**
 * Is this component file Storybook's scaffold (src/stories/Button.tsx and
 * friends)? Only the scaffold's stems are read; the scaffold names its own
 * CSS classes `storybook-button`, a project's Button does not.
 */
function isStorybookScaffoldComponent(file: string): boolean {
  if (!STORYBOOK_SCAFFOLD_STEMS.includes(path.basename(file).split('.')[0])) return false;
  try { return /storybook/i.test(fs.readFileSync(file, 'utf-8')); } catch { return false; }
}

/** How many component source files `dir` holds, two levels deep, Storybook's scaffold excluded; 0 when it does not exist. */
export function countComponentFiles(dir: string): number {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 0;
  let count = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 2) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!/node_modules|__tests__|stories|generated/.test(e.name)) walk(path.join(d, e.name), depth + 1); }
      else if (isComponentSourceFile(e.name) && !isStorybookScaffoldComponent(path.join(d, e.name))) count++;
    }
  };
  try { walk(dir, 0); } catch { return 0; }
  return count;
}

/**
 * The local component directory, found on disk: the candidate holding the
 * most component source files. Null when none holds any — a project whose
 * only components are Storybook's scaffold has no component library.
 */
export function findLocalComponentDirectory(cwd: string): { dir: string; count: number } | null {
  let best: { dir: string; count: number } | null = null;
  for (const rel of LOCAL_COMPONENT_DIR_CANDIDATES) {
    const count = countComponentFiles(path.join(cwd, rel));
    if (count > 0 && (!best || count > best.count)) best = { dir: rel, count };
  }
  return best;
}

/**
 * Analyzes existing Storybook files to detect design system patterns
 */
export function analyzeExistingStories(projectRoot: string = process.cwd()): {
  storyFiles: string[];
  /** Storybook's scaffold stories — seen, and left out of every other list. */
  scaffoldFiles: string[];
  componentDirs: string[];
  importPaths: string[];
  componentPrefixes: string[];
  layoutPatterns: string[];
} {
  const storyFiles: string[] = [];
  const scaffoldFiles: string[] = [];
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
          // The scaffold's stories say nothing about the project: their
          // parent is src/stories, which is where init would then have
          // pointed componentsPath — and deleted a moment later.
          let content = '';
          try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { /* unreadable: treated as the project's own */ }
          if (isStorybookScaffoldStory(entry.name, content)) {
            scaffoldFiles.push(fullPath);
            continue;
          }
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
    scaffoldFiles,
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
    console.log(`📊 Analysis found: ${analysis.storyFiles.length} story files, ${analysis.componentDirs.length} component directories${analysis.scaffoldFiles.length ? ` (${analysis.scaffoldFiles.length} Storybook scaffold stories ignored)` : ''}`);

    const generatedStoriesPath = path.join(cwd, 'src/stories/generated/');

    // Determine the most likely import path: a known system from package.json
    // first, then what the project's own stories import.
    let importPath: string | null = knownSystems?.importPath
      || findMostLikelyImportPath(analysis.importPaths, packageJson.name);

    /**
     * External means the RESOLVED import path is a bare specifier, whether
     * it came from the known list or from the stories. Judging it from the
     * known list alone gave an MUI project — found through its stories, not
     * the list — a componentsPath pointing at its own stories folder.
     *
     * A stories-derived specifier must also be INSTALLABLE: declared in
     * package.json or present in node_modules. One that is neither — the
     * project's own name, or a package that was removed — is not a design
     * system anyone can import from, and the project's component directory
     * is the truth instead.
     */
    const isPackageSpecifier = (p: string) => !/^(\.|\/|@\/|~|#)/.test(p);
    const packageRoot = (p: string) => p.split('/').slice(0, p.startsWith('@') ? 2 : 1).join('/');
    let isExternalPackage = false;
    if (importPath && isPackageSpecifier(importPath)) {
      const root = packageRoot(importPath);
      const declared = Boolean(dependencies[root]);
      const installed = declared || fs.existsSync(path.join(cwd, 'node_modules', root));
      const isSelf = root === packageJson.name;
      if (knownSystems?.importPath === importPath) {
        isExternalPackage = declared;
      } else if (isSelf || !installed) {
        console.log(`ℹ️  Stories import from ${importPath}, which is ${isSelf ? "this project's own package name" : 'not installed'} — using the local component directory instead`);
        importPath = null;
      } else {
        isExternalPackage = true;
      }
    }

    // Only determine component path if we're not using an external package
    const componentPath = !isExternalPackage ?
      findMostLikelyComponentDirectory(analysis.componentDirs, cwd) :
      undefined;

    // A local library is imported by a path RELATIVE to the generated stories
    // directory (the form init writes for local libraries everywhere else),
    // and one that resolves — see localImportForComponents; the project's
    // own package name is never emitted.
    let importStyle: 'individual' | undefined;
    if (!importPath) {
      if (componentPath && fs.existsSync(componentPath)) {
        const local = localImportForComponents(generatedStoriesPath, componentPath, cwd);
        importPath = local.importPath;
        importStyle = local.importStyle;
        if (local.barrel && path.dirname(local.barrel) !== path.resolve(componentPath)) {
          console.log(`ℹ️  ${path.relative(cwd, componentPath)} has no index; stories import the barrel at ${path.relative(cwd, local.barrel)} as ${importPath}`);
        } else if (importStyle === 'individual') {
          console.log(`ℹ️  ${path.relative(cwd, componentPath)} has no index and no ancestor barrel re-exports it; stories import each component by its own path (importStyle: individual)`);
        }
      } else {
        importPath = 'your-component-library';
      }
    } else if (importPath.startsWith('.') && componentPath && fs.existsSync(componentPath)
      && !relativeImportResolves(generatedStoriesPath, importPath)) {
      /**
       * A configured relative importPath that does not resolve is a story
       * Vite cannot serve. An earlier init wrote `../../components` for a
       * directory with no index (the barrel was src/index.ts); every story
       * imported it and every preview was a red overlay. The config is the
       * user's, so it is not rewritten — but the runtime uses the path that
       * resolves and says so, and `check` names the fix.
       */
      const local = localImportForComponents(generatedStoriesPath, componentPath, cwd);
      if (local.importPath && local.importPath !== importPath) {
        console.warn(`⚠️  importPath "${importPath}" does not resolve from ${path.relative(cwd, generatedStoriesPath)} — using "${local.importPath}"${local.importStyle === 'individual' ? ' with per-component imports' : ''}. Update story-ui.config.js (npx story-ui check shows the fix).`);
        importPath = local.importPath;
        importStyle = local.importStyle;
      }
    }

    // Determine component prefix
    const componentPrefix = findMostLikelyPrefix(analysis.componentPrefixes);

    // Determine layout patterns
    const layoutRules = detectLayoutPatterns(analysis.layoutPatterns, componentPrefix);

    // Detect Storybook framework
    const storybookFramework = detectStorybookFramework(dependencies);

    // Build configuration
    const config: Partial<StoryUIConfig> = {
      generatedStoriesPath,
      importPath: importPath,
      componentPrefix: componentPrefix,
      layoutRules: layoutRules,
      storybookFramework: storybookFramework
    };

    // Only set componentsPath for local component libraries
    if (componentPath && !isExternalPackage) {
      config.componentsPath = componentPath;
    }
    if (importStyle) {
      config.importStyle = importStyle;
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
/**
 * npm design systems recognised by package name alone. The import path is the
 * package; discovery reads its declarations for everything else.
 */
const KNOWN_NPM_DESIGN_SYSTEMS: string[] = [
  '@mui/material', '@carbon/react', '@fluentui/react-components', '@radix-ui/themes',
  '@base-ui/react', '@shopify/polaris', '@primer/react', '@heroui/react', '@nextui-org/react',
  'flowbite-react', '@salt-ds/core', '@blueprintjs/core', '@adobe/react-spectrum', 'react-aria-components',
  '@atlaskit/button', 'vuetify', 'primevue', 'element-plus', '@angular/material', 'primeng',
  'flowbite-svelte', '@skeletonlabs/skeleton', '@shoelace-style/shoelace',
];

function detectKnownDesignSystems(dependencies: Record<string, string>): Partial<StoryUIConfig> | null {
  for (const pkg of KNOWN_NPM_DESIGN_SYSTEMS) {
    if (dependencies[pkg]) {
      // Atlassian is one package per component; the scope is the design system.
      return { importPath: pkg === '@atlaskit/button' ? '@atlaskit' : pkg };
    }
  }
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
export function findMostLikelyComponentDirectory(componentDirs: string[], projectRoot: string): string {
  const local = findLocalComponentDirectory(projectRoot);
  if (componentDirs.length === 0) {
    // No stories of the project's own to learn from: the directory that
    // holds component files, or the conventional default when none does.
    return path.join(projectRoot, local ? local.dir : 'src/components');
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

  // Stories that live apart from their components (src/stories importing
  // ../components/Button) name a directory with no component in it. The
  // directory that holds the components is the one to record.
  if (local && countComponentFiles(bestDir) === 0) {
    return path.join(projectRoot, local.dir);
  }

  return bestDir;
}

/** The specifier a file in `fromDir` uses to import `toDir` — always relative, POSIX separators. */
export function relativeImportPath(fromDir: string, toDir: string): string {
  let rel = path.relative(path.resolve(fromDir), path.resolve(toDir)).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

const MODULE_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs'];

/** The index module in `dir`, or null. */
export function moduleIndexIn(dir: string): string | null {
  for (const ext of MODULE_EXTS) {
    const f = path.join(dir, `index.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * Would a bundler resolve `specifier` from a file in `fromDir`? A module
 * file (with or without its extension), or a directory with an index. This
 * is the check a written importPath must pass: `../../components` pointing
 * at a directory with no index is "Failed to resolve import" in every
 * generated story, and Storybook's red overlay on all of them.
 */
export function relativeImportResolves(fromDir: string, specifier: string): boolean {
  if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) return false;
  const target = path.resolve(fromDir, specifier);
  try {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return /\.(tsx?|jsx?|mjs)$/.test(target);
    for (const ext of MODULE_EXTS) {
      if (fs.existsSync(`${target}.${ext}`)) return true;
    }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return moduleIndexIn(target) !== null;
  } catch { /* unreadable: does not resolve */ }
  return false;
}

/** Does the index module at `barrel` re-export anything from inside `componentsDir`? */
function barrelReexportsFrom(barrel: string, componentsDir: string): boolean {
  let content = '';
  try { content = fs.readFileSync(barrel, 'utf-8'); } catch { return false; }
  const root = path.resolve(componentsDir);
  for (const m of content.matchAll(/(?:export|import)\b[^;]*?\bfrom\s*["'](\.[^"']+)["']/g)) {
    const target = path.resolve(path.dirname(barrel), m[1]);
    if (target === root || target.startsWith(root + path.sep)) return true;
  }
  return false;
}

/**
 * The import a generated story uses for a local component directory, chosen
 * so that it RESOLVES from the generated stories directory:
 *
 * 1. the directory itself, when it has an index;
 * 2. the nearest ancestor (up to the project root) whose index re-exports
 *    from it — a project with `src/index.ts` re-exporting `./components/*`
 *    and no `src/components/index.ts` is imported as `../..`, the directory
 *    form, which is what the prop extractor and a bundler both resolve;
 * 3. otherwise the directory with `importStyle: 'individual'`, so the prompt
 *    shows per-component paths rather than a barrel that does not exist.
 */
export function localImportForComponents(
  generatedDir: string,
  componentsDir: string,
  projectRoot: string,
): { importPath: string; importStyle?: 'individual'; barrel?: string } {
  const target = path.resolve(componentsDir);
  const own = moduleIndexIn(target);
  if (own) return { importPath: relativeImportPath(generatedDir, target), barrel: own };
  const root = path.resolve(projectRoot);
  let dir = path.dirname(target);
  while (dir.startsWith(root) && dir !== path.dirname(dir)) {
    const index = moduleIndexIn(dir);
    if (index && barrelReexportsFrom(index, target)) {
      return { importPath: relativeImportPath(generatedDir, dir), barrel: index };
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return { importPath: relativeImportPath(generatedDir, target), importStyle: 'individual' };
}

/**
 * Finds the most likely import path based on import analysis
 */
/** Runtime and tooling packages a story imports that are never the design system. */
const NOT_A_DESIGN_SYSTEM = /^(react|react-dom|react\/.*|react-dom\/.*|storybook|storybook\/.*|@storybook\/.*|@testing-library\/.*|jest|vitest|@vitest\/.*|vite|next|next\/.*)$/;

/**
 * The bare specifier the project's own stories import components from, or
 * null when they import none. `ownPackageName` is the project's package.json
 * name and is never a candidate: a design system's stories may import the
 * library by its own name through a workspace alias, but that name is not
 * installable, `story-ui check` would ask for `npm install <itself>`
 * forever, and every component would carry an import path no consumer can
 * resolve. The caller turns null into a relative path to the component
 * directory.
 */
export function findMostLikelyImportPath(importPaths: string[], ownPackageName?: string): string | null {
  if (importPaths.length === 0) {
    return null;
  }

  // Count frequency of import paths
  const pathCounts: Record<string, number> = {};

  for (const importPath of importPaths) {
    /**
     * Skip the runtime, not everything with "react" in its name. The old
     * substring test dropped @carbon/react, @chakra-ui/react and
     * @fluentui/react-components — the design system itself — and a fresh
     * Carbon project was configured with its own package name as the
     * import path.
     */
    if (NOT_A_DESIGN_SYSTEM.test(importPath)) continue;
    if (ownPackageName && (importPath === ownPackageName || importPath.startsWith(ownPackageName + '/'))) continue;

    pathCounts[importPath] = (pathCounts[importPath] || 0) + 1;
  }

  // Find the most common import path
  let maxCount = 0;
  let bestPath: string | null = null;

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

/**
 * Detects installed icon package from package.json dependencies
 * Returns configuration for the first detected icon package
 */
export function detectInstalledIconPackage(projectPath?: string): IconImportsConfig | null {
  const cwd = projectPath || process.cwd();
  const packageJsonPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Check for known icon packages
    for (const iconPackage of KNOWN_ICON_PACKAGES) {
      if (allDeps[iconPackage.name]) {
        console.log(`🎨 Detected icon package: ${iconPackage.name}`);
        return {
          package: iconPackage.name,
          importPath: iconPackage.importPath,
          commonIcons: iconPackage.commonIcons,
          // Allow all icons from this package - don't require explicit validation
          // This is crucial: icon libraries have thousands of icons, we can't list them all
          allowAllIcons: true,
        };
      }
    }
  } catch (error) {
    console.warn('Failed to detect icon package:', error);
  }

  return null;
}
