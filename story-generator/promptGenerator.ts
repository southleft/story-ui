import { StoryUIConfig } from '../story-ui.config.js';
import { DiscoveredComponent, PropInfo } from './componentDiscovery.js';
import { EnhancedComponentDiscovery } from './enhancedComponentDiscovery.js';
import { loadConsiderations, considerationsToPrompt } from './considerationsLoader.js';
import { DocumentationLoader } from './documentationLoader.js';
import {
  getAdapterRegistry,
  FrameworkPrompt,
  StoryGenerationOptions,
  FrameworkType,
  FrameworkAdapter,
} from './framework-adapters/index.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Icon package information for smart detection
 */
interface IconPackageInfo {
  name: string;
  importPath: string;
  commonIcons: string[];
  importStyle: 'named' | 'default';
  description: string;
}

/**
 * Known icon packages and their common icons
 * Used for smart detection when icon packages are installed
 */
const KNOWN_ICON_PACKAGES: IconPackageInfo[] = [
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
      'IconSun', 'IconMoon', 'IconCloud', 'IconBolt', 'IconDroplet',
      'IconMapPin', 'IconPhone', 'IconMessage', 'IconSend', 'IconInbox',
      'IconArchive', 'IconTag', 'IconBookmark', 'IconFlag', 'IconAward',
      'IconTrendingUp', 'IconTrendingDown', 'IconActivity', 'IconPieChart',
      'IconBarChart', 'IconLineChart', 'IconDatabase', 'IconServer', 'IconCode',
      'IconTerminal', 'IconBrandGithub', 'IconBrandTwitter', 'IconBrandLinkedin',
      'IconWorld', 'IconGlobe', 'IconWifi', 'IconBluetooth', 'IconCpu',
      'IconDeviceDesktop', 'IconDeviceMobile', 'IconPrinter', 'IconCamera',
      'IconMicrophone', 'IconVolume', 'IconPlayerPlay', 'IconPlayerPause',
    ],
    importStyle: 'named',
    description: 'Tabler Icons - Free and open source icons (Mantine recommended)',
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
      'File', 'Image', 'Video', 'Music', 'Link',
      'ExternalLink', 'MoreHorizontal', 'MoreVertical', 'GripVertical',
      'Sun', 'Moon', 'Cloud', 'Zap', 'Droplet',
      'MapPin', 'Phone', 'MessageSquare', 'Send', 'Inbox',
    ],
    importStyle: 'named',
    description: 'Lucide Icons - Beautiful & consistent icons',
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
      'PencilIcon', 'TrashIcon', 'ArrowDownTrayIcon', 'ArrowUpTrayIcon', 'ShareIcon',
      'FunnelIcon', 'ArrowPathIcon', 'EyeIcon', 'EyeSlashIcon',
      'LockClosedIcon', 'LockOpenIcon', 'ClipboardIcon', 'FolderIcon',
      'DocumentIcon', 'PhotoIcon', 'VideoCameraIcon', 'MusicalNoteIcon', 'LinkIcon',
    ],
    importStyle: 'named',
    description: 'Heroicons - Beautiful hand-crafted SVG icons by Tailwind',
  },
  {
    name: 'react-icons',
    importPath: 'react-icons/fi', // Feather icons subset - most common
    commonIcons: [
      'FiHome', 'FiSettings', 'FiUser', 'FiSearch', 'FiMenu',
      'FiBell', 'FiMail', 'FiCalendar', 'FiClock', 'FiStar',
      'FiHeart', 'FiPlus', 'FiMinus', 'FiX', 'FiCheck',
      'FiChevronRight', 'FiChevronLeft', 'FiChevronDown', 'FiChevronUp',
      'FiArrowRight', 'FiArrowLeft', 'FiArrowUp', 'FiArrowDown',
      'FiEdit', 'FiTrash', 'FiDownload', 'FiUpload', 'FiShare',
      'FiFilter', 'FiRefreshCw', 'FiEye', 'FiEyeOff',
    ],
    importStyle: 'named',
    description: 'React Icons - Popular icon packs as React components',
  },
  {
    name: '@phosphor-icons/react',
    importPath: '@phosphor-icons/react',
    commonIcons: [
      'House', 'Gear', 'User', 'MagnifyingGlass', 'List',
      'Bell', 'Envelope', 'Calendar', 'Clock', 'Star',
      'Heart', 'Plus', 'Minus', 'X', 'Check',
      'CaretRight', 'CaretLeft', 'CaretDown', 'CaretUp',
      'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
      'PencilSimple', 'Trash', 'DownloadSimple', 'UploadSimple', 'ShareNetwork',
      'Funnel', 'ArrowsClockwise', 'Eye', 'EyeSlash',
    ],
    importStyle: 'named',
    description: 'Phosphor Icons - Flexible icon family',
  },
];

/**
 * Detects installed icon packages by checking package.json
 * Returns the first detected icon package info, or null if none found
 */
function detectInstalledIconPackage(projectPath?: string): IconPackageInfo | null {
  const cwd = projectPath || process.cwd();
  const packageJsonPath = path.join(cwd, 'package.json');

  try {
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Check each known icon package
    for (const iconPackage of KNOWN_ICON_PACKAGES) {
      if (allDeps[iconPackage.name]) {
        return iconPackage;
      }
    }

    return null;
  } catch (error) {
    // If we can't read package.json, assume no icon package
    return null;
  }
}

/**
 * Generates icon usage instructions for the prompt
 * Uses smart detection to enable real icons when a supported icon package is installed
 */
function generateIconInstructions(components: DiscoveredComponent[], projectPath?: string): string[] {
  const instructions: string[] = [];

  // First, check if an icon package is installed in the project
  const installedIconPackage = detectInstalledIconPackage(projectPath);

  if (installedIconPackage) {
    // Icon package detected - enable icon usage with the installed package
    const sampleIcons = installedIconPackage.commonIcons.slice(0, 20).join(', ');
    instructions.push(
      '',
      '✅ ICON LIBRARY AVAILABLE ✅',
      `You have ${installedIconPackage.name} installed in this project.`,
      `${installedIconPackage.description}`,
      '',
      '📦 How to use icons:',
      `   Import path: import { IconName } from '${installedIconPackage.importPath}';`,
      `   Example icons: ${sampleIcons}`,
      '',
      '🎯 ICON BEST PRACTICES:',
      '   - Use icons to enhance visual clarity and user experience',
      '   - Common use cases: navigation, actions, status indicators, decorative elements',
      '   - Icons should complement text, not replace it entirely for accessibility',
      '   - Use consistent icon sizing (typically 16-24px for inline, 24-48px for prominent)',
      '',
      '⚠️ IMPORTANT:',
      `   - ONLY import icons from '${installedIconPackage.importPath}'`,
      '   - Do NOT import from other icon libraries not installed in the project',
      '   - If you need an icon that may not exist, use a similar common icon from the list above',
      ''
    );
    return instructions;
  }

  // No icon package installed - check if design system has icon components
  const iconComponents = components.filter(c =>
    c.name && typeof c.name === 'string' &&
    (c.name.toLowerCase().includes('icon') || c.name === 'Icon' || c.name === 'v-icon' || c.name === 'mat-icon' || c.name === 'sl-icon')
  );

  if (iconComponents.length > 0) {
    // Design system has icon support - allow those, prohibit external libraries
    const allowedIconNames = iconComponents.map(c => c.name).join(', ');
    instructions.push(
      '',
      '🔶 ICON USAGE RULES 🔶',
      `Your design system includes icon components: ${allowedIconNames}`,
      '✅ You MAY use these icon components from the Available components list',
      '🚫 Do NOT import from external icon libraries:',
      '   - @tabler/icons-react, @tabler/icons',
      '   - react-icons, lucide-react, @heroicons/react',
      '   - @fortawesome/react-fontawesome, @phosphor-icons/react',
      '   - Any other external icon package',
      'If you need icons beyond what the design system provides, use Unicode symbols (→ ✓ + ×) or text labels instead.',
      ''
    );
  } else {
    // No icon components discovered - prohibit all icon imports
    instructions.push(
      '',
      '🔴 ICON IMPORT RESTRICTION 🔴',
      'This design system does not include icon components in the available components list.',
      '🚫 Do NOT import from ANY icon library:',
      '   - @tabler/icons-react, @tabler/icons',
      '   - react-icons, lucide-react, @heroicons/react',
      '   - @fortawesome/react-fontawesome, @phosphor-icons/react',
      '   - @mui/icons-material, @chakra-ui/icons',
      '   - Any other icon package',
      '✅ Instead, use:',
      '   - Unicode symbols: → ✓ ✗ + − × ÷ • ★ ♦ ▶ ◀ ▲ ▼',
      '   - Text labels: "Add", "Remove", "Edit", "Delete"',
      '   - Badge or Button components with text content',
      'Icons are NOT in the available components list and WILL cause import errors.',
      ''
    );
  }

  return instructions;
}

/**
 * Extended prompt interface that includes framework information
 * Uses string[] for layoutInstructions instead of string
 */
export interface FrameworkAwarePrompt extends Omit<FrameworkPrompt, 'layoutInstructions'> {
  layoutInstructions: string[];
}

export interface GeneratedPrompt {
  systemPrompt: string;
  componentReference: string;
  layoutInstructions: string[];
  examples: string[];
  sampleStory: string;
}

/**
 * Generates a comprehensive AI prompt based on the configuration and discovered components
 */
export function generatePrompt(config: StoryUIConfig, components: DiscoveredComponent[]): GeneratedPrompt {
  const componentReference = generateComponentReference(components, config);
  const layoutInstructions = generateLayoutInstructions(config);
  const examples = generateExamples(config);
  const systemPrompt = generateSystemPrompt(config);
  const sampleStory = config.sampleStory || generateDefaultSampleStory(config, components);

  // DEBUG: Log component reference to see import paths
  console.log('[DEBUG] Import style:', config.importStyle);
  console.log('[DEBUG] Sample component reference (first 500 chars):', componentReference.substring(0, 500));

  return {
    systemPrompt,
    componentReference,
    layoutInstructions,
    examples,
    sampleStory
  };
}

/**
 * Generates the system prompt based on configuration
 */
function generateSystemPrompt(config: StoryUIConfig): string {
  if (config.systemPrompt) {
    return config.systemPrompt;
  }

  const componentSystemName = config.componentPrefix ?
    `${config.componentPrefix.replace(/^[A-Z]+/, '')} design system` :
    'component library';

  // Get the library name for prominent constraint
  const libraryName = config.designSystemGuidelines?.name || config.importPath || 'configured library';
  const importPath = config.importPath || 'your-library';

  // Determine the framework from config (componentFramework takes precedence)
  const framework = config.componentFramework || config.framework || 'react';
  const isReactFramework = framework === 'react' || framework.includes('react');
  const storybookFramework = config.storybookFramework || '@storybook/react';

  // Build framework-specific import instructions
  let frameworkImportInstructions = '';
  let frameworkExampleImports = '';

  if (isReactFramework) {
    frameworkImportInstructions = `
🚨 CRITICAL: EVERY STORY MUST START WITH "import React from 'react';" AS THE FIRST LINE 🚨

🔴 MANDATORY FIRST LINE - NO EXCEPTIONS:
The VERY FIRST LINE of every story file MUST be:
import React from 'react';

CRITICAL IMPORT RULES - MUST FOLLOW EXACTLY:
1. **LINE 1: import React from 'react';** (MANDATORY - NEVER SKIP THIS)
2. **LINE 2: import type { Meta, StoryObj } from '${storybookFramework}';**
3. **LINE 3: import { ComponentName } from '[your-import-path]';**

⚠️  WITHOUT "import React from 'react';" THE STORY WILL FAIL WITH "React is not defined" ERROR ⚠️`;

    frameworkExampleImports = `Example correct order:
import React from 'react';
import type { Meta, StoryObj } from '${storybookFramework}';
import { ComponentName } from '[your-import-path]';

REQUIRED STORY STRUCTURE:
Every story MUST start with these three imports in this order:
1. import React from 'react';
2. import type { Meta, StoryObj } from '${storybookFramework}';
3. import { ComponentName } from '[library-path]';`;
  } else if (framework === 'vue') {
    frameworkImportInstructions = `
CRITICAL IMPORT RULES FOR VUE STORIES:
1. **DO NOT import React** - This is a Vue project, not React!
2. **LINE 1: import type { Meta, StoryObj } from '${storybookFramework}';**
3. **LINE 2: import { ComponentName } from '[your-import-path]';**

⚠️  DO NOT ADD "import React from 'react';" - Vue does NOT use React! ⚠️`;

    frameworkExampleImports = `Example correct order for Vue:
import type { Meta, StoryObj } from '${storybookFramework}';
import { VBtn, VCard } from 'vuetify/components';

REQUIRED STORY STRUCTURE:
Every Vue story MUST start with:
1. import type { Meta, StoryObj } from '${storybookFramework}';
2. import { ComponentName } from '[library-path]';`;
  } else if (framework === 'angular') {
    frameworkImportInstructions = `
CRITICAL IMPORT RULES FOR ANGULAR STORIES:
1. **DO NOT import React** - This is an Angular project, not React!
2. **LINE 1: import type { Meta, StoryObj } from '${storybookFramework}';**
3. **LINE 2: Import Angular Material modules as needed**

⚠️  DO NOT ADD "import React from 'react';" - Angular does NOT use React! ⚠️`;

    frameworkExampleImports = `Example correct order for Angular:
import type { Meta, StoryObj } from '${storybookFramework}';
import { MatButtonModule } from '@angular/material/button';
import { moduleMetadata } from '@storybook/angular';

REQUIRED STORY STRUCTURE:
Every Angular story MUST:
1. Import from '${storybookFramework}';
2. Import Angular Material modules from their specific paths
3. Use moduleMetadata or applicationConfig decorators`;
  } else if (framework === 'svelte') {
    frameworkImportInstructions = `
CRITICAL IMPORT RULES FOR SVELTE STORIES:
1. **DO NOT import React** - This is a Svelte project, not React!
2. **LINE 1: import type { Meta, StoryObj } from '${storybookFramework}';**
3. **LINE 2: import { ComponentName } from '[your-import-path]';**

⚠️  DO NOT ADD "import React from 'react';" - Svelte does NOT use React! ⚠️`;

    frameworkExampleImports = `Example correct order for Svelte:
import type { Meta, StoryObj } from '${storybookFramework}';
import { Button, Card } from 'flowbite-svelte';

REQUIRED STORY STRUCTURE:
Every Svelte story MUST:
1. Import from '${storybookFramework}';
2. Import Svelte components from the library`;
  } else if (framework === 'web-components') {
    frameworkImportInstructions = `
CRITICAL IMPORT RULES FOR WEB COMPONENTS STORIES:
1. **DO NOT import React** - This is a Web Components project!
2. **LINE 1: import { html } from 'lit';**
3. **LINE 2: import type { Meta, StoryObj } from '${storybookFramework}';**
4. **LINE 3: Import web components from the library**

⚠️  DO NOT ADD "import React from 'react';" - Web Components do NOT use React! ⚠️
⚠️  Use html\`\` template literals, NOT JSX! ⚠️`;

    frameworkExampleImports = `Example correct order for Web Components:
import { html } from 'lit';
import type { Meta, StoryObj } from '${storybookFramework}';
import '@shoelace-style/shoelace/dist/components/button/button.js';

REQUIRED STORY STRUCTURE:
Every Web Components story MUST:
1. Import { html } from 'lit';
2. Import from '${storybookFramework}';
3. Import web components as side-effect imports`;
  } else {
    // Generic fallback
    frameworkImportInstructions = `
CRITICAL IMPORT RULES:
1. Import type { Meta, StoryObj } from '${storybookFramework}';
2. Import components from the configured library`;

    frameworkExampleImports = `Example imports:
import type { Meta, StoryObj } from '${storybookFramework}';
import { ComponentName } from '[your-import-path]';`;
  }

  // Determine import style - individual file imports vs barrel imports
  const useIndividualImports = config.importStyle === 'individual';

  // Generate appropriate import instruction based on importStyle
  let importInstructionText: string;
  let importExampleText: string;

  if (useIndividualImports) {
    // Individual file imports - each component from its own file
    importInstructionText = `║  IMPORT STYLE: INDIVIDUAL FILE IMPORTS                             ║
╠════════════════════════════════════════════════════════════════════╣
║  Each component MUST be imported from its own file:                ║
║  import { Button } from '${importPath}/button';${' '.repeat(Math.max(0, 20 - importPath.length))}║
║  import { Card, CardHeader } from '${importPath}/card';${' '.repeat(Math.max(0, 11 - importPath.length))}║
║  import { Input } from '${importPath}/input';${' '.repeat(Math.max(0, 21 - importPath.length))}║
╠════════════════════════════════════════════════════════════════════╣
║  🚫 DO NOT use barrel imports like:                                ║
║  import { Button, Card } from '${importPath}';${' '.repeat(Math.max(0, 18 - importPath.length))}║`;
    importExampleText = `
🔴 CRITICAL: INDIVIDUAL FILE IMPORTS REQUIRED 🔴
This library does NOT have a barrel export (no index.ts). Each component MUST be imported from its own file!

CORRECT import pattern:
import { Button } from '${importPath}/button';
import { Card, CardHeader, CardContent } from '${importPath}/card';
import { Dialog, DialogContent, DialogTrigger } from '${importPath}/dialog';
import { Input } from '${importPath}/input';

WRONG - DO NOT USE (will cause "Failed to fetch dynamically imported module" error):
import { Button, Card, Input } from '${importPath}';

File naming convention:
- Component names are PascalCase: Button, AlertDialog, NavigationMenu
- File names are kebab-case: button, alert-dialog, navigation-menu
- Sub-components share the same file: CardHeader, CardContent → card`;
  } else {
    // Barrel imports - all components from single entry point (default)
    importInstructionText = `║  ALL component imports MUST use:                                   ║
║  import { ComponentName } from '${importPath}';${' '.repeat(Math.max(0, 32 - importPath.length))}║`;
    importExampleText = '';
  }

  return `
╔════════════════════════════════════════════════════════════════════╗
║                    🚨 MANDATORY LIBRARY CONSTRAINT 🚨                ║
╠════════════════════════════════════════════════════════════════════╣
║  REQUIRED LIBRARY: ${libraryName.padEnd(46)}║
║  IMPORT PATH:      ${importPath.padEnd(46)}║
║  FRAMEWORK:        ${framework.padEnd(46)}║
╠════════════════════════════════════════════════════════════════════╣
${importInstructionText}
╠════════════════════════════════════════════════════════════════════╣
║  🚫 FORBIDDEN LIBRARIES - DO NOT USE:                              ║
║  - tamagui, @tamagui/core (NEVER USE)                              ║
║  - @chakra-ui/react (unless configured)                            ║
║  - @mui/material (unless configured)                               ║
║  - antd (unless configured)                                        ║
║  - Any library NOT matching: ${importPath.padEnd(36)}║
╚════════════════════════════════════════════════════════════════════╝${importExampleText}
${frameworkImportInstructions}

🔴 CRITICAL RULE: NEVER use children in args for ANY component or layout. Always use render functions. 🔴

You are an expert UI developer creating Storybook stories for ${framework.toUpperCase()}. Use ONLY the components from the ${componentSystemName} listed below.

🚨 COMPONENT IMPORT VALIDATION - CRITICAL 🚨
You can ONLY import components that are explicitly listed in the "Available components" section below.
ANY component not in that list DOES NOT EXIST and will cause import errors.
Before importing any component, verify it exists in the Available components list.
If a component is not listed, DO NOT use it - choose an alternative from the available list.

🎨 CREATIVE APPROXIMATION - WHEN COMPONENTS DON'T EXIST 🎨
If the user asks for a UI that requires components NOT in your available list (like Calendar, Chart, Map, etc.):
**DO NOT fail or refuse** - instead, CREATIVELY APPROXIMATE the UI using available components!

Common approximation strategies:
• Calendar/DatePicker → Use Grid/SimpleGrid with Text for days, Badge for selected dates
• Charts/Graphs → Use Progress bars, RingProgress, or Stack of colored Box components
• Timeline → Use Stack with Card/Paper for each event, connecting lines with Divider
• Carousel/Slider → Use Group with Image components and Button for navigation
• Data Tables → Use Table components, or Stack of Card/Paper rows
• Tree View → Use nested Stack/Accordion with List or NavLink components
• Star Ratings → Use Group of ThemeIcon or inline SVG stars
• Maps → Use Image with a static map placeholder

The goal is VISUAL SIMILARITY, not exact functionality. Users are exploring design possibilities.
They want to see what a UI COULD look like - be creative with basic layout components!

🔴 IMPORT PATH RULE - MANDATORY 🔴
ALWAYS use the EXACT import path shown in parentheses after each component name.
For example: If the Available components list shows "Button (import from 'antd')",
you MUST use: import { Button } from 'antd';
NEVER use the main package import if a specific path is shown.
This is critical for proper component resolution.

${frameworkExampleImports}

2. Use the correct Storybook framework import for your environment
3. ONLY import components that are explicitly listed in the "Available components" section below
4. Do NOT create or import any components that are not in the list
5. Do NOT import story exports from other story files
6. When in doubt, use the basic components listed below

GENERAL COMPONENT RULES:
- StoryUIPanel is the Story UI interface, not a design system component - never import it
- Do not import components that end with Story, Example, Demo, or that appear to be story exports
- Only use components explicitly listed in the available components section

CRITICAL STORY FORMAT RULES:
- Use ES modules syntax for exports: "export default meta;" NOT "module.exports = meta;"
- Every story file MUST have a default export with the meta object
- Follow the Component Story Format (CSF) 3.0 standard

IMPORTANT IMAGE RULES:
- When using image components or <img> tags, ALWAYS include a src attribute
- Use Lorem Picsum for all placeholder images: https://picsum.photos/[width]/[height] (e.g., https://picsum.photos/300/200)
- You can add random variation with: https://picsum.photos/300/200?random=1
- Never create <img> tags without a src attribute

STORY STRUCTURE RULES:
- NEVER pass children through args for ANY component - this breaks story rendering
- Always use render functions: render: () => (<YourLayout />)
- For layouts with multiple components, DO NOT set component in meta
- Only set component in meta when showcasing a SINGLE component's variations
- Examples of what NOT to do:
  ❌ args: { children: <div>content</div> }
  ❌ args: { children: (<><Component1 /><Component2 /></>) }
  ✅ render: () => (<div><Component1 /><Component2 /></div>)

SPACING AND LAYOUT RULES:
- Use the layout components provided in the component library when available
- If no layout components are available, use appropriate HTML elements with inline styles
- Follow the design system's spacing and styling conventions
- Use the component library's design tokens and spacing system when available`;
}

/**
 * Generates component reference documentation
 */
function generateComponentReference(components: DiscoveredComponent[], config: StoryUIConfig): string {
  let reference = '';

  // Custom in-project components first — they are part of the allowed set and
  // easily drowned out by a large npm library, so they get their own section.
  const customComponents = components.filter(c => getLocalComponentImportPath(c, config));
  if (customComponents.length > 0) {
    reference += 'CUSTOM PROJECT COMPONENTS (in-repo components — fully allowed; import each from the EXACT relative path shown):\n';
    for (const component of customComponents) {
      reference += formatComponentReference(component, config);
    }
    reference += '\n';
  }
  const packageComponents = components.filter(c => !getLocalComponentImportPath(c, config));

  // Group components by category
  const componentsByCategory = packageComponents.reduce((acc, component) => {
    if (!acc[component.category]) {
      acc[component.category] = [];
    }
    acc[component.category].push(component);
    return acc;
  }, {} as Record<string, DiscoveredComponent[]>);

  // Layout components first (most important for multi-column layouts)
  if (componentsByCategory.layout) {
    reference += 'LAYOUT COMPONENTS (for multi-column layouts, grids, etc.):\n';
    for (const component of componentsByCategory.layout) {
      reference += formatComponentReference(component, config);
    }
    reference += '\n';
  }

  // Other categories
  const categoryOrder = ['content', 'form', 'navigation', 'feedback', 'other'];
  for (const category of categoryOrder) {
    if (componentsByCategory[category] && componentsByCategory[category].length > 0) {
      reference += `${category.toUpperCase()} COMPONENTS:\n`;
      for (const component of componentsByCategory[category]) {
        reference += formatComponentReference(component, config);
      }
      reference += '\n';
    }
  }

  return reference;
}

/**
 * For components discovered from local project files (custom, non-npm
 * component libraries), compute the relative import path from the generated
 * stories directory to the component source file. Returns null for npm
 * package components.
 */
function getLocalComponentImportPath(component: DiscoveredComponent, config: StoryUIConfig): string | null {
  const filePath = component.filePath;
  if (!filePath || filePath.includes('node_modules')) return null;
  // Only real project source files (absolute paths from local discovery)
  if (!path.isAbsolute(filePath) || !fs.existsSync(filePath)) return null;

  const generatedDir = path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated/');
  let relative = path.relative(generatedDir, filePath).split(path.sep).join('/');
  relative = relative.replace(/\.(tsx|jsx|ts|js|vue|svelte)$/, '');
  if (!relative.startsWith('.')) relative = './' + relative;
  return relative;
}

/**
 * Convert PascalCase to kebab-case
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Get the base component name (for sub-components like CardHeader, returns 'Card')
 */
function getBaseComponentName(componentName: string): string {
  // Common sub-component patterns in shadcn/ui and other design systems
  const subComponentPatterns = [
    /^(Card)(Header|Footer|Title|Action|Description|Content)$/,
    /^(Dialog)(Close|Content|Description|Footer|Header|Overlay|Portal|Title|Trigger)$/,
    /^(AlertDialog)(Portal|Overlay|Trigger|Content|Header|Footer|Title|Description|Action|Cancel)$/,
    /^(DropdownMenu)(Portal|Trigger|Content|Group|Label|Item|CheckboxItem|RadioGroup|RadioItem|Separator|Shortcut|Sub|SubTrigger|SubContent)$/,
    /^(ContextMenu)(Trigger|Content|Item|CheckboxItem|RadioItem|Label|Separator|Shortcut|Group|Portal|Sub|SubContent|SubTrigger|RadioGroup)$/,
    /^(NavigationMenu)(List|Item|Content|Trigger|Link|Indicator|Viewport)$/,
    /^(Select)(Content|Group|Item|Label|ScrollDownButton|ScrollUpButton|Separator|Trigger|Value)$/,
    /^(Menubar)(Portal|Menu|Trigger|Content|Group|Separator|Label|Item|Shortcut|CheckboxItem|RadioGroup|RadioItem|Sub|SubTrigger|SubContent)$/,
    /^(Accordion)(Item|Trigger|Content)$/,
    /^(Tabs)(List|Trigger|Content)$/,
    /^(Sheet)(Trigger|Close|Content|Header|Footer|Title|Description)$/,
    /^(Avatar)(Image|Fallback)$/,
    /^(Breadcrumb)(List|Item|Link|Page|Separator|Ellipsis)$/,
    /^(Command)(Dialog|Input|List|Empty|Group|Item|Shortcut|Separator)$/,
    /^(HoverCard)(Trigger|Content)$/,
    /^(Popover)(Trigger|Content|Anchor)$/,
    /^(Collapsible)(Trigger|Content)$/,
    /^(Drawer)(Portal|Overlay|Trigger|Close|Content|Header|Footer|Title|Description)$/,
    /^(RadioGroup)(Item)$/,
    /^(ToggleGroup)(Item)$/,
    /^(Tooltip)(Trigger|Content|Provider)$/,
    /^(Table)(Header|Body|Footer|Head|Row|Cell|Caption)$/,
    /^(InputOTP)(Group|Slot|Separator)$/,
    /^(Resizable)(PanelGroup|Panel|Handle)$/,
    /^(ScrollArea|ScrollBar)$/,
    /^(Pagination)(Content|Link|Item|Previous|Next|Ellipsis)$/,
    /^(Alert)(Title|Description)$/,
  ];

  for (const pattern of subComponentPatterns) {
    const match = componentName.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return componentName;
}

/**
 * Formats a single component reference
 */
function formatComponentReference(component: DiscoveredComponent, config: StoryUIConfig): string {
  let reference = `- ${component.name}`;

  // Add import path information
  let importPath: string;
  const localImportPath = getLocalComponentImportPath(component, config);
  if (component.__componentPath) {
    importPath = component.__componentPath;
  } else if (localImportPath) {
    // Custom in-project component (not an npm package): the model must
    // import it via its real relative path, not the library import path.
    importPath = localImportPath;
  } else if (config.importStyle === 'individual') {
    // Generate individual import path based on component name
    const basePath = config.importPath || 'unknown';
    const baseComponentName = getBaseComponentName(component.name);
    const kebabName = toKebabCase(baseComponentName);
    importPath = `${basePath}/${kebabName}`;
  } else {
    importPath = config.importPath || '';
  }

  if (importPath) {
    reference += ` (import from '${importPath}')`;
  }

  // Use rich prop types if available, otherwise fall back to simple prop names
  if (component.propTypes && component.propTypes.length > 0) {
    reference += '\n    Props:';
    for (const prop of component.propTypes) {
      let propLine = `\n      - ${prop.name}`;
      
      // Add type information
      if (prop.type !== 'unknown') {
        propLine += `: ${prop.type}`;
      }
      
      // Add options for select/radio types
      if (prop.options && prop.options.length > 0) {
        const optionsStr = prop.options.slice(0, 5).map(o => `"${o}"`).join(' | ');
        propLine += ` [${optionsStr}${prop.options.length > 5 ? '...' : ''}]`;
      }
      
      // Add description
      if (prop.description) {
        propLine += ` - ${prop.description}`;
      }
      
      // Add default value
      if (prop.defaultValue !== undefined) {
        propLine += ` (default: ${JSON.stringify(prop.defaultValue)})`;
      }
      
      reference += propLine;
    }
  } else if (component.props && component.props.length > 0) {
    // Fall back to simple prop names
    reference += `: Props: ${component.props.join(', ')}`;
  }

  if (component.slots && component.slots.length > 0) {
    reference += `. Slots: ${component.slots.join(', ')}`;
  }

  if (component.description && component.description !== `${component.name} component`) {
    reference += ` - ${component.description}`;
  }

  // Add specific usage notes for layout components
  if (component.category === 'layout' && component.name && typeof component.name === 'string') {
    if (component.name.toLowerCase().includes('layout') && !component.name.toLowerCase().includes('section')) {
      reference += ' - Use as main wrapper for multi-column layouts';
    } else if (component.name.toLowerCase().includes('section')) {
      reference += ' - Use inside layout wrapper for individual columns';
    }
  }


  reference += '\n';
  return reference;
}

/**
 * Generates layout-specific instructions including MANDATORY vertical spacing rules
 * @param config - The StoryUI configuration object
 * @returns Array of layout instruction strings to be included in the prompt
 */
export function generateLayoutInstructions(config: StoryUIConfig): string[] {
  const instructions: string[] = [];
  const layoutRules = config.layoutRules;

  // MANDATORY VERTICAL SPACING RULES - These are non-negotiable for professional UI quality
  instructions.push('MANDATORY VERTICAL SPACING RULES (NON-NEGOTIABLE):');
  instructions.push('');
  instructions.push('** CRITICAL: Every component MUST have proper vertical spacing. Components without spacing look broken and unprofessional. **');
  instructions.push('');
  instructions.push('1. FORM FIELDS: Always wrap form fields in a container with vertical spacing:');
  instructions.push('   - Use flexbox column with gap: <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>');
  instructions.push('   - Or use your design system\'s spacing tokens if available');
  instructions.push('   - MINIMUM 16px gap between form fields, 24px for complex forms');
  instructions.push('');
  instructions.push('2. BUTTON SPACING: Buttons MUST have margin-top from content above:');
  instructions.push('   - Submit/action buttons: 24px margin-top from form fields');
  instructions.push('   - Button groups: wrap in <div style={{ marginTop: "24px" }}>');
  instructions.push('');
  instructions.push('3. SECTION SPACING: Logical sections need clear visual separation:');
  instructions.push('   - Between major sections: 32-48px');
  instructions.push('   - Between related content groups: 24px');
  instructions.push('   - Use dividers or significant whitespace between unrelated content');
  instructions.push('');
  instructions.push('4. HEADING SPACING: Headings need asymmetric spacing:');
  instructions.push('   - More space ABOVE headings (24-32px) than below (8-16px)');
  instructions.push('   - This creates visual hierarchy and groups content with its heading');
  instructions.push('');
  instructions.push('5. CARD/CONTAINER PADDING: Internal padding is mandatory:');
  instructions.push('   - Minimum 16px padding on all sides');
  instructions.push('   - Preferred 24px for cards with multiple elements');
  instructions.push('   - Use design system spacing tokens when available');
  instructions.push('');
  instructions.push('6. WRAPPER PATTERN (REQUIRED): The story render function MUST return a wrapper div with padding:');
  instructions.push('   - render: () => <div style={{ padding: "24px" }}>...content...</div>');
  instructions.push('   - This ensures content has breathing room within the Storybook canvas');
  instructions.push('');

  if (layoutRules.multiColumnWrapper && layoutRules.columnComponent) {
    instructions.push('MULTI-COLUMN LAYOUT RULES:');
    instructions.push(`- For ANY multi-column layout (2, 3, or more columns), use ${layoutRules.multiColumnWrapper} components`);
    instructions.push(`- Each column must be wrapped in its own ${layoutRules.columnComponent} element`);
    instructions.push(`- Structure: <${layoutRules.multiColumnWrapper}><${layoutRules.columnComponent}>column 1</${layoutRules.columnComponent}><${layoutRules.columnComponent}>column 2</${layoutRules.columnComponent}></${layoutRules.multiColumnWrapper}>`);
    instructions.push(`- Use component library styling approach (className, style props, or design tokens as appropriate)`);
    instructions.push(`- NEVER use CSS properties as props (like display="grid" or gridTemplateColumns) - these are not valid props`);
    instructions.push(`- For grid-like layouts, use Flex with wrap prop and appropriate gap, NOT CSS Grid`);
    instructions.push(`- The ${layoutRules.multiColumnWrapper} should be the main component in your story for multi-column layouts`);
    instructions.push('');
  }

  if (layoutRules.prohibitedElements && layoutRules.prohibitedElements.length > 0) {
    instructions.push(`- NEVER use plain HTML ${layoutRules.prohibitedElements.join(', ')} elements - ALWAYS use the provided design system components`);
  }

  // Generic layout instructions for all design systems
  instructions.push('GENERAL LAYOUT BEST PRACTICES:');
  instructions.push(`- Use semantic heading components from your design system instead of raw <h1>-<h6> tags`);
  instructions.push(`- Use the design system's layout components and spacing tokens instead of inline styles when available`);
  instructions.push(`- Prefer design system components over plain HTML elements for consistent styling`);
  instructions.push(`- ALWAYS test mentally: "Does this component have enough visual breathing room?" If not, add spacing.`);

  return instructions;
}

/**
 * Generates layout examples
 */
function generateExamples(config: StoryUIConfig): string[] {
  const examples: string[] = [];
  const layoutExamples = config.layoutRules.layoutExamples;

  if (layoutExamples) {
    examples.push('EXAMPLES:');
    examples.push('');

    if (layoutExamples.twoColumn) {
      examples.push('Two-column layout:');
      examples.push(layoutExamples.twoColumn);
      examples.push('');
    }

    if (layoutExamples.threeColumn) {
      examples.push('Three-column layout:');
      examples.push(layoutExamples.threeColumn);
      examples.push('');
    }

    if (layoutExamples.grid) {
      examples.push('Grid layout:');
      examples.push(layoutExamples.grid);
      examples.push('');
    }

    // Add image-specific examples
    examples.push('Image usage examples:');
    examples.push('// Always include src attribute with placeholder images:');
    examples.push('<img src="https://picsum.photos/300/200" alt="Placeholder image" />');
    examples.push('// For different random images:');
    examples.push('<img src="https://picsum.photos/400/300?random=1" alt="Random image" style={{width: "100%", height: "auto"}} />');
    examples.push('');
    
    // Add proper story structure examples
    examples.push('Proper story structure examples:');
    examples.push('');
    examples.push('// CORRECT - Layout with multiple components:');
    examples.push('const meta = {');
    examples.push('  title: "Generated/Homepage Hero",');
    examples.push('  parameters: { layout: "fullscreen" },');
    examples.push('  // NO component field for layouts!');
    examples.push('} satisfies Meta;');
    examples.push('');
    examples.push('export const Default: Story = {');
    examples.push('  render: () => (');
    examples.push('    <div>');
    examples.push('      <Banner title="Sale!" variant="success" />');
    examples.push('      <div className="hero-section">');
    examples.push('        <h1>Welcome</h1>');
    examples.push('      </div>');
    examples.push('    </div>');
    examples.push('  )');
    examples.push('};');
    examples.push('');
    examples.push('// WRONG - Never use children in args:');
    examples.push('export const Wrong: Story = {');
    examples.push('  args: {');
    examples.push('    children: ( // ❌ NEVER DO THIS');
    examples.push('      <div>content</div>');
    examples.push('    )');
    examples.push('  }');
    examples.push('};');
    examples.push('');
    examples.push('// CORRECT - Single component showcase:');
    examples.push('const meta = {');
    examples.push('  title: "Generated/Banner Variations",');
    examples.push('  component: Banner, // ✓ OK for single component');
    examples.push('} satisfies Meta<typeof Banner>;');
    examples.push('');
    examples.push('export const InfoBanner: Story = {');
    examples.push('  args: {');
    examples.push('    title: "Information",');
    examples.push('    variant: "info"');
    examples.push('  }');
    examples.push('};');
    examples.push('');
  }

  return examples;
}

/**
 * Generates import statements, using individual import paths if available
 */
function generateImportStatements(config: StoryUIConfig, components: DiscoveredComponent[], componentNames: string[]): string {
  const importMap = new Map<string, string[]>();

  // Check if individual file imports are configured (for libraries without barrel exports)
  const useIndividualImports = config.importStyle === 'individual';

  for (const componentName of componentNames) {
    // Find the component in our discovered components to get its specific import path
    const component = components.find(c => c.name === componentName);

    if (component && typeof component === 'object' && '__componentPath' in component) {
      // Use the discovered component's specific import path
      const importPath = component.__componentPath as string;
      if (!importMap.has(importPath)) {
        importMap.set(importPath, []);
      }
      importMap.get(importPath)!.push(componentName);
    } else if (useIndividualImports) {
      // Generate individual file imports for libraries without barrel exports
      // Group by base component: CardHeader, CardContent -> card.tsx
      // This pattern works for React (shadcn/ui), Vue (PrimeVue), Angular (Material), Web Components (Shoelace)
      const baseComponent = getBaseComponentName(componentName);
      const fileName = toKebabCase(baseComponent);
      const importPath = `${config.importPath}/${fileName}`;

      if (!importMap.has(importPath)) {
        importMap.set(importPath, []);
      }
      importMap.get(importPath)!.push(componentName);
    } else {
      // Use barrel import (default) - import all from single entry point
      if (!importMap.has(config.importPath)) {
        importMap.set(config.importPath, []);
      }
      importMap.get(config.importPath)!.push(componentName);
    }
  }

  // Generate import statements
  const importLines: string[] = [];
  for (const [importPath, comps] of importMap) {
    importLines.push(`import { ${comps.join(', ')} } from '${importPath}';`);
  }

  return importLines.join('\n');
}

/**
 * Generates a default sample story if none provided
 */
function generateDefaultSampleStory(config: StoryUIConfig, components: DiscoveredComponent[]): string {
  const layoutComponent = components.find(c => c.category === 'layout' && c.name && typeof c.name === 'string' && !c.name.toLowerCase().includes('section'));
  const sectionComponent = components.find(c => c.category === 'layout' && c.name && typeof c.name === 'string' && c.name.toLowerCase().includes('section'));
  const contentComponent = components.find(c => c.category === 'content');

  const mainComponent = layoutComponent?.name || contentComponent?.name || components[0]?.name || 'div';
  const imports = [mainComponent];

  if (sectionComponent) imports.push(sectionComponent.name);
  if (contentComponent && contentComponent.name !== mainComponent) imports.push(contentComponent.name);

  const importStatement = generateImportStatements(config, components, imports);

  let renderContent = '';
  if (layoutComponent && sectionComponent) {
    renderContent = `
    <${layoutComponent.name}>
      <${sectionComponent.name}>
        ${contentComponent ? `<${contentComponent.name}>Sample content</${contentComponent.name}>` : 'Sample content'}
      </${sectionComponent.name}>
    </${layoutComponent.name}>`;
  } else if (contentComponent) {
    renderContent = `<${contentComponent.name}>Sample content</${contentComponent.name}>`;
  } else {
    renderContent = '<div>Sample content</div>';
  }

  const storybookFramework = config.storybookFramework || '@storybook/react';
  
  // For layouts, don't set a component in meta
  const isLayout = layoutComponent || renderContent.includes('<div');
  
  if (isLayout) {
    return `import React from 'react';
import type { Meta, StoryObj } from '${storybookFramework}';
${importStatement}

const meta = {
  title: 'Generated/Sample Layout',
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (${renderContent}
  )
};`
  } else {
    return `import React from 'react';
import type { Meta, StoryObj } from '${storybookFramework}';
${importStatement}

const meta = {
  title: 'Generated/Sample Component',
  component: ${mainComponent},
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ${mainComponent}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    // Add component props here
  }
};`
  }
}

/**
 * Builds the complete Claude prompt
 */
export async function buildClaudePrompt(
  userPrompt: string,
  config: StoryUIConfig,
  components: DiscoveredComponent[]
): Promise<string> {
  const generated = generatePrompt(config, components);

  const promptParts = [
    generated.systemPrompt,
    '',
  ];

  // Load documentation - try new directory-based approach first
  const projectRoot = config.considerationsPath ?
    config.considerationsPath.replace(/\/story-ui-considerations\.(md|json)$/, '') :
    process.cwd();

  // Project documentation and considerations are the design system's OWN
  // rules — both sources load when present (they serve different purposes:
  // story-ui-docs/ holds reference docs, story-ui-considerations.md holds
  // generation rules), and both are marked authoritative for the model.
  const docLoader = new DocumentationLoader(projectRoot);
  let documentationAdded = false;
  let considerationsAdded = false;

  if (docLoader.hasDocumentation()) {
    const docs = await docLoader.loadDocumentation();
    if (docs.sources.length > 0) {
      const docPrompt = docLoader.formatForPrompt(docs);
      if (docPrompt) {
        promptParts.push('═══ PROJECT DOCUMENTATION (authoritative — follow these over general conventions) ═══');
        promptParts.push(docPrompt);
        promptParts.push('');
        documentationAdded = true;
      }
    }
  }

  const considerations = loadConsiderations(config.considerationsPath);
  if (considerations) {
    const considerationsPrompt = considerationsToPrompt(considerations);
    if (considerationsPrompt) {
      promptParts.push('═══ AI CONSIDERATIONS (rules for how YOU must use this design system — these OVERRIDE any conflicting general guidance) ═══');
      promptParts.push(considerationsPrompt);
      promptParts.push('');
      considerationsAdded = true;
    }
  }

  console.log(`[Story UI] Prompt context: story-ui-docs ${documentationAdded ? 'loaded' : 'not found'}, considerations file ${considerationsAdded ? 'loaded' : 'not found'}`);

  promptParts.push(
    ...generated.layoutInstructions,
    '',
    'Available components:',
    generated.componentReference,
    ...generated.examples,
  );

  // Add additional imports information if configured
  if (config.additionalImports && config.additionalImports.length > 0) {
    promptParts.push('');
    promptParts.push('ADDITIONAL IMPORT EXAMPLES - COPY THESE EXACTLY:');
    config.additionalImports.forEach(additionalImport => {
      // For each import path, show the exact syntax
      const componentExamples = additionalImport.components.map(componentName => {
        // Check if this component has specific import type information
        // Look in both components and layoutComponents arrays
        let componentConfig = config.components?.find(c => c.name === componentName);
        if (!componentConfig) {
          componentConfig = config.layoutComponents?.find(c => c.name === componentName);
        }
        
        // Use runtime check for importType since it may not be in TypeScript interface
        if (componentConfig && (componentConfig as any).importType === 'default') {
          return `import ${componentName} from '${additionalImport.path}';`;
        } else {
          return `import { ${componentName} } from '${additionalImport.path}';`;
        }
      });
      
      componentExamples.forEach(example => {
        promptParts.push(`- ${example}`);
      });
    });
  }

  // Smart icon handling - detect installed icon packages or fall back to design system icons
  const iconInstructions = generateIconInstructions(components);
  promptParts.push(...iconInstructions);

  // Reinforce NO children in args rule
  promptParts.push(
    '',
    '🔴 CRITICAL REMINDER: NEVER use children in args 🔴',
    'Always use render functions for any layout or component composition.',
    ''
  );

  // Determine framework from config for rules section
  const framework = config.componentFramework || config.framework || 'react';
  const isReactFramework = framework === 'react' || framework.includes('react');

  // Build framework-specific first line rules
  let frameworkFirstLineRules = '';
  if (isReactFramework) {
    frameworkFirstLineRules = `🚨 FINAL CRITICAL REMINDERS 🚨
🔴 FIRST LINE MUST BE: import React from 'react';
🔴 WITHOUT THIS IMPORT, THE STORY WILL BREAK!`;
  } else if (framework === 'vue') {
    frameworkFirstLineRules = `🚨 FINAL CRITICAL REMINDERS FOR VUE 🚨
🔴 DO NOT import React - this is a Vue project!
🔴 First line should be: import type { Meta, StoryObj } from '@storybook/vue3';`;
  } else if (framework === 'angular') {
    frameworkFirstLineRules = `🚨 FINAL CRITICAL REMINDERS FOR ANGULAR 🚨
🔴 DO NOT import React - this is an Angular project!
🔴 First line should be: import type { Meta, StoryObj } from '@storybook/angular';`;
  } else if (framework === 'svelte') {
    frameworkFirstLineRules = `🚨 FINAL CRITICAL REMINDERS FOR SVELTE 🚨
🔴 DO NOT import React - this is a Svelte project!
🔴 First line should be: import type { Meta, StoryObj } from '@storybook/svelte';`;
  } else if (framework === 'web-components') {
    frameworkFirstLineRules = `🚨 FINAL CRITICAL REMINDERS FOR WEB COMPONENTS 🚨
🔴 DO NOT import React - this is a Web Components project!
🔴 First line should be: import { html } from 'lit';
🔴 Use html\`\` template literals, NOT JSX!`;
  } else {
    frameworkFirstLineRules = `🚨 FINAL CRITICAL REMINDERS 🚨
Follow the framework-specific import patterns shown above.`;
  }

  // Add import style specific rules
  const importStyleRules: string[] = [];
  if (config.importStyle === 'individual') {
    importStyleRules.push(
      `- 🚫 INDIVIDUAL IMPORTS REQUIRED: Import each component from its own file (e.g., '${config.importPath}/button', NOT '${config.importPath}')`,
      `- Sub-components share files: CardHeader, CardContent → '${config.importPath}/card'`,
      '- File names use kebab-case: AlertDialog → alert-dialog, NavigationMenu → navigation-menu'
    );
  }

  promptParts.push(
    `Output a complete Storybook story file in TypeScript. Import components as shown in the sample template below. Use the following sample as a template. Respond ONLY with a single code block containing the full file, and nothing else.`,
    '',
    '<rules>',
    frameworkFirstLineRules,
    '',
    'OTHER CRITICAL RULES:',
    ...importStyleRules,
    '- FOLLOW the DESIGN SYSTEM DOCUMENTATION (what the system is) and AI CONSIDERATIONS (how you must use it) sections above — they define this design system\'s required patterns and override generic guidance',
    '- Story title MUST always start with "Generated/" (e.g., title: "Generated/Recipe Card")',
    '- Do NOT use prefixes like "Content/", "Components/", or any other section name',
    '- ONLY import components that are listed in the "Available components" section',
    '- NEVER import any other npm package (no Tailwind, no other UI kits, no utility libraries) — imports outside the component library are rejected by validation unless the AI CONSIDERATIONS file explicitly permits them',
    '- CUSTOM PROJECT COMPONENTS listed in the component reference ARE allowed — import them from the exact relative path shown next to each one',
    '- ALWAYS use the exact import path shown in parentheses after each component',
    '- NEVER use main package imports when specific subpath imports are shown',
    '- Do NOT import story exports - these are NOT real components',
    '- Check every import against the Available components list before using it',
    '- FORBIDDEN: Any component not explicitly listed in the Available components section',
    '- FORBIDDEN: Theme setup components (providers should be configured at the app level, not in individual stories)',
    '- All images MUST have a src attribute with placeholder URLs (use https://picsum.photos/)',
    '- Never create <img> tags without src attributes',
    '- MUST use ES modules syntax: "export default meta;" NOT "module.exports = meta;"',
    '- The file MUST have a default export for the meta object',
    '- Keep the story concise and focused - avoid overly complex layouts that might exceed token limits',
    '- Ensure all JSX tags are properly closed',
    '- Story must be complete and syntactically valid',
    '- CRITICAL: Never put ANY content in args.children - always use render function',
    '- Use render functions for ALL layouts and component compositions',
    '- For layouts: DO NOT set component in meta',
    '- Only set component in meta when showcasing a SINGLE component',
    '- Use appropriate styling for the component library (design tokens, className, or inline styles as needed)',
    '</rules>',
    '',
    'Sample story format:',
    generated.sampleStory,
    '',
    'User request:',
    userPrompt
  );

  return promptParts.join('\n');
}

/**
 * Generates a framework-aware prompt using the adapter system
 * This is the new multi-framework entry point
 */
export async function generateFrameworkAwarePrompt(
  config: StoryUIConfig,
  components: DiscoveredComponent[],
  options?: StoryGenerationOptions
): Promise<FrameworkAwarePrompt> {
  const registry = getAdapterRegistry();

  // Get the appropriate adapter (auto-detect or use specified framework)
  let adapter: FrameworkAdapter;
  if (options?.framework) {
    adapter = registry.getAdapter(options.framework);
  } else {
    adapter = await registry.autoDetect(process.cwd());
  }

  // Generate framework-specific prompt components
  const frameworkPrompt = await registry.generatePrompt(config, components, options);

  // Generate layout instructions (framework-agnostic)
  const layoutInstructions = generateLayoutInstructions(config);

  return {
    ...frameworkPrompt,
    layoutInstructions,
  };
}

/**
 * Builds a complete LLM prompt with framework awareness
 * This is the new multi-framework entry point for building complete prompts
 */
export async function buildFrameworkAwarePrompt(
  userPrompt: string,
  config: StoryUIConfig,
  components: DiscoveredComponent[],
  options?: StoryGenerationOptions
): Promise<string> {
  const generated = await generateFrameworkAwarePrompt(config, components, options);

  const promptParts = [
    generated.systemPrompt,
    '',
  ];

  // Load documentation - try new directory-based approach first
  const projectRoot = config.considerationsPath ?
    config.considerationsPath.replace(/\/story-ui-considerations\.(md|json)$/, '') :
    process.cwd();

  // Project documentation and considerations are the design system's OWN
  // rules — both sources load when present (they serve different purposes:
  // story-ui-docs/ holds reference docs, story-ui-considerations.md holds
  // generation rules), and both are marked authoritative for the model.
  const docLoader = new DocumentationLoader(projectRoot);
  let documentationAdded = false;
  let considerationsAdded = false;

  if (docLoader.hasDocumentation()) {
    const docs = await docLoader.loadDocumentation();
    if (docs.sources.length > 0) {
      const docPrompt = docLoader.formatForPrompt(docs);
      if (docPrompt) {
        promptParts.push('═══ PROJECT DOCUMENTATION (authoritative — follow these over general conventions) ═══');
        promptParts.push(docPrompt);
        promptParts.push('');
        documentationAdded = true;
      }
    }
  }

  // Considerations (the project's generation RULES) are injected LATE in the
  // prompt — see below, right before the <rules> block — because instructions
  // near the end of a long prompt are followed far more reliably than ones
  // buried early. Load them here so the log line reports both sources together.
  const considerations = loadConsiderations(config.considerationsPath);
  const considerationsPrompt = considerations ? considerationsToPrompt(considerations) : '';
  considerationsAdded = !!considerationsPrompt;

  console.log(`[Story UI] Prompt context: story-ui-docs ${documentationAdded ? 'loaded' : 'not found'}, considerations file ${considerationsAdded ? 'loaded' : 'not found'}`);

  promptParts.push(
    ...generated.layoutInstructions,
    '',
    'Available components:',
    generated.componentReference,
    '',
    generated.examples,
  );

  // Add additional imports information if configured
  if (config.additionalImports && config.additionalImports.length > 0) {
    promptParts.push('');
    promptParts.push('ADDITIONAL IMPORT EXAMPLES - COPY THESE EXACTLY:');
    config.additionalImports.forEach(additionalImport => {
      const componentExamples = additionalImport.components.map(componentName => {
        let componentConfig = config.components?.find(c => c.name === componentName);
        if (!componentConfig) {
          componentConfig = config.layoutComponents?.find(c => c.name === componentName);
        }

        if (componentConfig && (componentConfig as any).importType === 'default') {
          return `import ${componentName} from '${additionalImport.path}';`;
        } else {
          return `import { ${componentName} } from '${additionalImport.path}';`;
        }
      });

      componentExamples.forEach(example => {
        promptParts.push(`- ${example}`);
      });
    });
  }

  // Smart icon handling - detect installed icon packages or fall back to design system icons
  const iconInstructions2 = generateIconInstructions(components);
  promptParts.push(...iconInstructions2);

  // Add framework-specific rules
  const frameworkType = generated.framework.componentFramework;
  const frameworkRules = getFrameworkSpecificRules(frameworkType);
  if (frameworkRules.length > 0) {
    promptParts.push('');
    promptParts.push(`${frameworkType.toUpperCase()} SPECIFIC RULES:`);
    promptParts.push(...frameworkRules);
  }

  // Add import style specific rules for framework-aware prompts
  const importStyleRulesFramework: string[] = [];
  if (config.importStyle === 'individual') {
    importStyleRulesFramework.push(
      `- 🚫 INDIVIDUAL IMPORTS REQUIRED: Import each component from its own file (e.g., '${config.importPath}/button', NOT '${config.importPath}')`,
      `- Sub-components share files: CardHeader, CardContent → '${config.importPath}/card'`,
      '- File names use kebab-case: AlertDialog → alert-dialog, NavigationMenu → navigation-menu'
    );
  }

  // Project rules land here — late in the prompt, adjacent to the final
  // instructions — where the model follows them most reliably.
  if (considerationsPrompt) {
    promptParts.push(
      '',
      '═══ AI CONSIDERATIONS (rules for how YOU must use this design system — these OVERRIDE any conflicting general guidance above) ═══',
      considerationsPrompt,
    );
  }

  promptParts.push(
    '',
    `Output a complete Storybook story file in TypeScript. Import components as shown in the sample template below. Use the following sample as a template. Respond ONLY with a single code block containing the full file, and nothing else.`,
    '',
    '<rules>',
    'CRITICAL REMINDERS:',
    ...importStyleRulesFramework,
    '- FOLLOW the DESIGN SYSTEM DOCUMENTATION (what the system is) and AI CONSIDERATIONS (how you must use it) sections — they define this design system\'s required patterns and override generic guidance',
    '- Story title MUST always start with "Generated/" (e.g., title: "Generated/Recipe Card")',
    '- ONLY import components that are listed in the "Available components" section',
    '- NEVER import any other npm package (no Tailwind, no other UI kits, no utility libraries) — imports outside the component library are rejected by validation unless the AI CONSIDERATIONS file explicitly permits them',
    '- CUSTOM PROJECT COMPONENTS listed in the component reference ARE allowed — import them from the exact relative path shown next to each one',
    '- ALWAYS use the exact import path shown in parentheses after each component',
    '- NEVER use main package imports when specific subpath imports are shown',
    '- Do NOT import story exports - these are NOT real components',
    '- All images MUST have a src attribute with placeholder URLs (use https://picsum.photos/)',
    '- MUST use ES modules syntax: "export default meta;" NOT "module.exports = meta;"',
    '- The file MUST have a default export for the meta object',
    '- Keep the story concise and focused - avoid overly complex layouts',
    '- Ensure all tags are properly closed and syntax is valid',
    '- Story must be complete and syntactically valid',
    '</rules>',
    '',
    'Sample story format:',
    generated.sampleStory,
    '',
    'User request:',
    userPrompt
  );

  return promptParts.join('\n');
}

/**
 * Get framework-specific rules to include in the prompt
 */
function getFrameworkSpecificRules(framework: FrameworkType): string[] {
  const rules: string[] = [];

  switch (framework) {
    case 'react':
      rules.push("- FIRST LINE MUST BE: import React from 'react';");
      rules.push('- Use JSX syntax for templates');
      rules.push('- NEVER pass children through args - use render functions');
      rules.push('- For layouts with multiple components, DO NOT set component in meta');
      rules.push('- 🚫 NEVER use Angular Material (MatCardModule, MatButtonModule, etc.)');
      rules.push('- 🚫 NEVER use Vue components (VCard, VBtn, etc.)');
      rules.push('- ✅ ONLY use React components from the configured import path');
      break;

    case 'vue':
      rules.push("- Import from '@storybook/vue3'");
      rules.push('- Use Vue 3 Composition API style');
      rules.push('- Use render functions with template for complex content');
      rules.push('- Event bindings use @event or v-on:event syntax');
      rules.push('- Slots use v-slot directive or # shorthand');
      rules.push("- 🚫 NEVER import React from 'react' - this is Vue, NOT React!");
      rules.push('- 🚫 NEVER use Angular Material (MatCardModule, MatButtonModule, etc.)');
      rules.push('- 🚫 NEVER use @angular/material or moduleMetadata');
      rules.push('- ✅ ONLY use Vue components from the configured import path');
      rules.push('- ✅ Use KEBAB-CASE in templates: <v-btn>, <v-card>, NOT <VBtn>, <VCard>');
      rules.push('- ✅ Vuetify components: v-btn, v-card, v-text-field, v-row, v-col, etc.');
      rules.push('- ✅ Import with PascalCase: import { VBtn } from "vuetify/components"');
      rules.push('- ✅ Use kebab-case in template: <v-btn v-bind="args">Click</v-btn>');
      break;

    case 'angular':
      rules.push("- Import from '@storybook/angular'");
      rules.push('- Use moduleMetadata or applicationConfig decorators');
      rules.push('- Property binding: [property]="value"');
      rules.push('- Event binding: (event)="handler($event)"');
      rules.push('- Use Angular template syntax in render functions');
      rules.push("- 🚫 NEVER import React from 'react' - this is Angular, NOT React!");
      rules.push('- 🚫 NEVER use Vue components (VCard, VBtn, etc.)');
      rules.push('- ✅ ONLY use Angular Material or configured library components');
      break;

    case 'svelte':
      rules.push("- Import from '@storybook/svelte'");
      rules.push('- Import .svelte files directly as default exports');
      rules.push('- Svelte 5 events use lowercase: onclick, onchange (NOT on:click which is Svelte 4)');
      rules.push('- Use bind: for two-way binding');
      rules.push("- 🚫 NEVER import React from 'react' - this is Svelte, NOT React!");
      rules.push('- 🚫 NEVER use Angular Material or Vue components');
      rules.push('- ✅ ONLY use Svelte components from the configured import path');
      break;

    case 'web-components':
      rules.push("- Import { html } from 'lit'");
      rules.push("- Import from '@storybook/web-components'");
      rules.push('- Use html`` template literal, NOT JSX');
      rules.push('- Use kebab-case for tag names (e.g., <my-button>)');
      rules.push('- Property binding: .property=${value}');
      rules.push('- Event binding: @event=${handler}');
      rules.push('- Boolean attributes: ?disabled=${true}');
      rules.push("- 🚫 NEVER import React from 'react' - this is Web Components, NOT React!");
      rules.push('- 🚫 NEVER use JSX syntax - use html`` template literals only');
      rules.push('- ✅ ONLY use Web Components from the configured import path');
      break;

    default:
      break;
  }

  return rules;
}

/**
 * Detect the framework for a given project
 */
export async function detectProjectFramework(projectRoot?: string): Promise<FrameworkType> {
  const registry = getAdapterRegistry();
  const adapter = await registry.autoDetect(projectRoot || process.cwd());
  return adapter.type;
}

/**
 * Get the adapter for a specific framework
 */
export function getFrameworkAdapter(framework: FrameworkType): FrameworkAdapter {
  const registry = getAdapterRegistry();
  return registry.getAdapter(framework);
}

/**
 * Get all available framework adapters
 */
export function getAvailableFrameworks(): FrameworkType[] {
  const registry = getAdapterRegistry();
  return registry.getAvailableFrameworks();
}
