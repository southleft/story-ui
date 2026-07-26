import { StoryUIConfig } from '../story-ui.config.js';
import { DiscoveredComponent } from './componentDiscovery.js';
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
    // Previously: "Keep the story concise and focused - avoid overly complex
    // layouts". That rule sat in the highest-adherence position in the prompt and
    // rewarded stopping at the visual shape — a real nav bar with state, menus and
    // a search field IS the "complex layout" it forbade. Measured result: stories
    // with zero inputs, zero links and no interactive states.
    '- The story MUST be operable, not a mockup: anything a user would click, type into, toggle or select MUST be the real interactive component from the design system, with real state and real handlers',
    '- NEVER render a visual stand-in for an interactive element (no text styled to look like an input, no bare icon standing in for a button, no static row standing in for tabs or a menu)',
    '- Prefer completeness of behavior over brevity — these stories are lifted directly into product code',
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
