import fs from 'fs';
import path from 'path';
import { DiscoveredComponent, PropInfo } from './componentDiscovery.js';
import { StoryUIConfig } from '../story-ui.config.js';
import { DynamicPackageDiscovery } from './dynamicPackageDiscovery.js';
import { logger } from './logger.js';
import { BaseFrameworkAdapter } from './framework-adapters/base-adapter.js';
import { ReactAdapter } from './framework-adapters/react-adapter.js';
import { VueAdapter } from './framework-adapters/vue-adapter.js';
import { AngularAdapter } from './framework-adapters/angular-adapter.js';
import { SvelteAdapter } from './framework-adapters/svelte-adapter.js';
import { WebComponentsAdapter } from './framework-adapters/web-components-adapter.js';
import { FrameworkType } from './framework-adapters/types.js';

export interface ComponentSource {
  type: 'npm' | 'local' | 'custom-elements' | 'typescript';
  path: string;
  patterns?: string[];
}

export interface EnhancedComponent extends DiscoveredComponent {
  source: ComponentSource;
  docUrl?: string;
  examples?: string[];
  dependencies?: string[];
  isComposite?: boolean; // Component that contains other components
}

export class EnhancedComponentDiscovery {
  private config: StoryUIConfig;
  private discoveredComponents: Map<string, EnhancedComponent> = new Map();
  private validateAvailableComponents: Set<string> = new Set();
  private frameworkAdapter: BaseFrameworkAdapter;

  constructor(config: StoryUIConfig) {
    this.config = config;
    this.frameworkAdapter = this.createFrameworkAdapter();
  }

  /**
   * Create the appropriate framework adapter based on config
   */
  private createFrameworkAdapter(): BaseFrameworkAdapter {
    const framework = (this.config.componentFramework || 'react') as FrameworkType;
    
    switch (framework) {
      case 'vue':
        return new VueAdapter();
      case 'angular':
        return new AngularAdapter();
      case 'svelte':
        return new SvelteAdapter();
      case 'web-components':
        return new WebComponentsAdapter();
      case 'react':
      default:
        return new ReactAdapter();
    }
  }

  /**
   * Discover components from all available sources
   * Priority: 1. Dynamic Discovery 2. Static Lists 3. Manual Config
   */
  async discoverAll(): Promise<EnhancedComponent[]> {
    logger.log('🔍 Starting comprehensive component discovery...');

    // Step 1: Discover from all sources
    const sources = this.identifySources();
    logger.log(`📁 Found ${sources.length} discovery sources:`, sources.map(s => `${s.type}:${s.path}`));

    for (const source of sources) {
      try {
        switch (source.type) {
          case 'npm':
            await this.discoverFromNpmPackage(source);
            break;
          case 'local':
            await this.discoverFromLocalFiles(source);
            break;
          case 'custom-elements':
            await this.discoverFromCustomElements(source);
            break;
          case 'typescript':
            await this.discoverFromTypeScript(source);
            break;
        }
      } catch (error) {
        console.warn(`Failed to discover from ${source.type} at ${source.path}:`, error);
      }
    }

    // Step 2: Apply manual configurations as override/fallback
    this.applyManualConfigurations();

    // Step 3: Resolve component conflicts and apply prioritization
    this.resolveComponentConflicts();

    const finalComponents = Array.from(this.discoveredComponents.values());
    logger.log(`✅ Discovery complete: ${finalComponents.length} components found`);

    // Log summary by source type
    this.logDiscoverySummary(finalComponents);

    return finalComponents;
  }

  /**
   * Resolve naming conflicts between different sources
   * Priority: Local > Manual Config > npm packages
   */
  private resolveComponentConflicts(): void {
    const conflicts = new Map<string, EnhancedComponent[]>();

    // Group components by name to find conflicts
    for (const component of this.discoveredComponents.values()) {
      const name = component.name;
      if (!conflicts.has(name)) {
        conflicts.set(name, []);
      }
      conflicts.get(name)!.push(component);
    }

    // Resolve conflicts using priority system
    for (const [name, componentList] of conflicts) {
      if (componentList.length > 1) {
        logger.log(`⚠️  Resolving conflict for component "${name}" (${componentList.length} versions found)`);

        // Priority order: local > manual config > npm
        const prioritized = componentList.sort((a, b) => {
          const getPriority = (comp: EnhancedComponent) => {
            if (comp.source.type === 'local') return 1; // Highest priority
            if (comp.source.type === 'npm') return 2;
            return 3; // Lowest priority for others
          };

          return getPriority(a) - getPriority(b);
        });

        // Keep highest priority, remove others
        const winner = prioritized[0];
        const losers = prioritized.slice(1);

        for (const loser of losers) {
          this.discoveredComponents.delete(loser.name);
        }

        logger.log(`✅ Kept ${winner.source.type} version of "${name}" from ${winner.source.path}`);
      }
    }
  }

  /**
   * Log discovery summary for debugging
   */
  private logDiscoverySummary(components: EnhancedComponent[]): void {
    const summary = components.reduce((acc, comp) => {
      const sourceType = comp.source.type;
      if (!acc[sourceType]) acc[sourceType] = 0;
      acc[sourceType]++;
      return acc;
    }, {} as Record<string, number>);

    logger.log('📊 Component discovery summary:', summary);
  }

      /**
   * Get the project root directory from the config
   */
  private getProjectRoot(): string {
    // If generatedStoriesPath exists, use it to determine project root
    if (this.config.generatedStoriesPath) {
      // Go up from src/stories/generated to find project root
      let currentPath = path.resolve(this.config.generatedStoriesPath);

      // Keep going up until we find a package.json
      while (currentPath !== path.dirname(currentPath)) {
        if (fs.existsSync(path.join(currentPath, 'package.json'))) {
          return currentPath;
        }
        currentPath = path.dirname(currentPath);
      }
    }

    // Fallback to current working directory
    return process.cwd();
  }

  /**
   * Identify all potential component sources
   */
  private identifySources(): ComponentSource[] {
    const sources: ComponentSource[] = [];

    // Note: Auto-discovery removed - now using guided installation during init

    // Check for npm packages
    // Always run dynamic discovery for design systems
    if (this.config.importPath && !this.config.importPath.startsWith('.')) {
      sources.push({
        type: 'npm',
        path: this.config.importPath
      });
    }

    // Also discover from layout components if specified
    if (this.config.layoutComponents && this.config.layoutComponents.length > 0) {
      const layoutImportPaths = new Set<string>();
      for (const layoutComp of this.config.layoutComponents) {
        if (layoutComp.importPath && !layoutComp.importPath.startsWith('.')) {
          layoutImportPaths.add(layoutComp.importPath);
        }
      }

      for (const layoutPath of layoutImportPaths) {
        sources.push({
          type: 'npm',
          path: layoutPath
        });
      }
    }

    // Check for design system preferred components
    if (this.config.designSystemGuidelines?.preferredComponents) {
      for (const [category, packagePath] of Object.entries(this.config.designSystemGuidelines.preferredComponents)) {
        if (typeof packagePath === 'string' && !packagePath.startsWith('.')) {
          sources.push({
            type: 'npm',
            path: packagePath
          });
        }
      }
    }

    // Check for local component directories
    // 1. Manually configured componentsPath (highest priority)
    if (this.config.componentsPath && fs.existsSync(this.config.componentsPath)) {
      sources.push({
        type: 'local',
        path: this.config.componentsPath,
        patterns: ['*.tsx', '*.jsx', '*.ts', '*.js']
      });
    }

    // 2. Auto-discover common React component directories from project root
    const projectRoot = this.getProjectRoot();
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
      if (fs.existsSync(fullPath) && fullPath !== this.config.componentsPath) {
        sources.push({
          type: 'local',
          path: fullPath,
          patterns: ['*.tsx', '*.jsx', '*.ts', '*.js']
        });
      }
    }

    // 3. Scan alongside stories in src/stories directory (co-located components)
    const storiesDir = path.join(projectRoot, 'src/stories');
    if (fs.existsSync(storiesDir)) {
      sources.push({
        type: 'local',
        path: storiesDir,
        patterns: ['*.tsx', '*.jsx'] // Only component files, not story files
      });
    }

    // Check for TypeScript definitions
    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    if (this.config.importPath && fs.existsSync(nodeModulesPath)) {
      const packagePath = path.join(nodeModulesPath, this.config.importPath);
      const typesPath = path.join(nodeModulesPath, '@types', this.config.importPath.replace(/^@/, '').replace('/', '__'));

      if (fs.existsSync(path.join(packagePath, 'index.d.ts'))) {
        sources.push({
          type: 'typescript',
          path: path.join(packagePath, 'index.d.ts')
        });
      } else if (fs.existsSync(typesPath)) {
        sources.push({
          type: 'typescript',
          path: typesPath
        });
      }
    }

    return sources;
  }

  /**
   * Auto-discovery removed - now handled by guided installation during init
   * This function is kept for backward compatibility but does nothing
   */
  private addDesignSystemPackages(sources: ComponentSource[]): void {
    // Functionality moved to guided installation process
  }

  /**
   * Check if a package is likely to contain React components (not utilities, types, etc.)
   */
  private isLikelyComponentPackage(packageName: string): boolean {
    const name = packageName.toLowerCase();

    // Skip obvious utility packages
    const utilityPatterns = [
      'types',
      'utils', 'util', 'utilities',
      'helpers', 'constants', 'config',
      'analytics', 'tracking', 'metrics',
      'tokens', 'theme', 'styles', 'css',
      'icons', 'icon', // Icons are usually too numerous and specific
      'editor-', // Editor plugins are usually too specific
      'smart-card', // Requires SmartCardProvider wrapper - too complex for simple stories
      '-types', '-utils', '-constants',
      'babel-', 'webpack-', 'rollup-', 'eslint-',
      'test', 'mock', 'fixture', 'storybook',
      'codemod', 'migration',
      'build', 'dev', 'cli'
    ];

    // Skip if contains utility patterns
    if (utilityPatterns.some(pattern => name.includes(pattern))) {
      return false;
    }


    return true;
  }

    /**
   * Discover components from npm packages using dynamic runtime discovery
   */
  private async discoverFromNpmPackage(source: ComponentSource): Promise<void> {
    // Determine the project root from the generated stories path
    const projectRoot = this.getProjectRoot();

    // Normalize package paths with subpath exports to their base package
    // e.g., 'vuetify/components' -> 'vuetify', '@scope/pkg/sub' -> '@scope/pkg'
    let normalizedPackageName = source.path;
    if (!source.path.startsWith('@') && source.path.includes('/')) {
      // Non-scoped package with subpath: extract base name
      normalizedPackageName = source.path.split('/')[0];
      logger.log(`🔧 Normalizing package path: ${source.path} → ${normalizedPackageName}`);
    } else if (source.path.startsWith('@')) {
      // Scoped package: keep @scope/name, strip anything after
      const parts = source.path.split('/');
      if (parts.length > 2) {
        normalizedPackageName = `${parts[0]}/${parts[1]}`;
        logger.log(`🔧 Normalizing scoped package path: ${source.path} → ${normalizedPackageName}`);
      }
    }

    const packagePath = path.join(projectRoot, 'node_modules', normalizedPackageName);

    // Helper function to load known components as fallback
    const loadFallbackComponents = () => {
      logger.log(`📋 ${source.path}: Using static component list (design system detected)`);
      const knownComponents = this.getKnownDesignSystemComponents(source.path);
      if (knownComponents.length > 0) {
        for (const comp of knownComponents) {
          this.discoveredComponents.set(comp.name!, {
            ...comp,
            source,
            filePath: '',
            category: comp.category || this.categorizeComponent(comp.name || '', comp.description || '') as any
          } as EnhancedComponent);
        }
        logger.log(`✅ Loaded ${knownComponents.length} known components for ${source.path}`);
      }
    };

    if (!fs.existsSync(packagePath)) {
      console.warn(`Package ${source.path} not found in node_modules at ${packagePath}`);
      // Use fallback component list when package is not installed (e.g., in production)
      loadFallbackComponents();
      return;
    }

          logger.log(`🔍 Dynamically discovering components from ${source.path}...`);

    // Use dynamic discovery to get real exports
    const dynamicDiscovery = new DynamicPackageDiscovery(source.path, projectRoot, this.config.componentFramework);
    const packageExports = await dynamicDiscovery.getRealPackageExports();

    if (!packageExports) {
      // Fallback to predefined components if dynamic discovery fails
      loadFallbackComponents();
      return;
    }

    // Process the real components found in the package
    const realComponents = packageExports.components.filter(comp => comp.isComponent);
    console.log(`✅ Found ${realComponents.length} real components in ${source.path} v${packageExports.packageVersion}`);
          logger.log(`📦 Available components: ${realComponents.map(c => c.name).join(', ')}`);

    // If dynamic discovery found 0 components, use fallback list
    if (realComponents.length === 0) {
      logger.log(`🔄 No components found dynamically, checking for known design system fallback...`);
      loadFallbackComponents();
      if (this.discoveredComponents.size > 0) {
        return; // Fallback loaded successfully
      }
    }

    for (const realComp of realComponents) {
      // Get enhanced metadata from predefined list if available
      const knownComponents = this.getKnownDesignSystemComponents(source.path);
      const knownComp = knownComponents.find(k => k.name === realComp.name);

      this.discoveredComponents.set(realComp.name, {
        name: realComp.name,
        source,
        filePath: '',
        // Use known metadata if available, otherwise generate basic metadata
        description: knownComp?.description || `${realComp.name} component`,
        category: knownComp?.category || this.categorizeComponent(realComp.name, '') as any,
        props: knownComp?.props || [],
        slots: knownComp?.slots || [],
        examples: knownComp?.examples || [],
        __componentPath: realComp.__componentPath
      } as EnhancedComponent);
    }

    // Store the component names for validation
    this.validateAvailableComponents = new Set(realComponents.map(c => c.name));
  }


  /**
   * Get known components for popular design systems
   * Returns a fallback list when dynamic discovery fails
   */
  private getKnownDesignSystemComponents(packageName: string): Partial<EnhancedComponent>[] {
    // Chakra UI fallback components
    if (packageName === '@chakra-ui/react') {
      const basicComponents = [
        // Layout
        'Box', 'Flex', 'Grid', 'Stack', 'HStack', 'VStack', 'Container', 'Center', 'Square', 'Circle',
        'SimpleGrid', 'Wrap', 'WrapItem', 'AspectRatio', 'Spacer', 'Divider',
        // Typography
        'Text', 'Heading', 'Badge', 'Code', 'Kbd', 'Mark',
        // Forms
        'Button', 'IconButton', 'Input', 'InputGroup', 'InputLeftElement', 'InputRightElement',
        'Textarea', 'Select', 'Checkbox', 'Radio', 'RadioGroup', 'Switch', 'Slider',
        'FormControl', 'FormLabel', 'FormHelperText', 'FormErrorMessage',
        // Feedback
        'Alert', 'AlertIcon', 'AlertTitle', 'AlertDescription', 'Progress', 'Skeleton', 'Spinner',
        'Toast', 'useToast', 'CircularProgress', 'CircularProgressLabel',
        // Data Display
        'Avatar', 'AvatarGroup', 'Card', 'CardHeader', 'CardBody', 'CardFooter',
        'Image', 'Badge', 'Stat', 'StatLabel', 'StatNumber', 'StatHelpText', 'StatArrow',
        'Table', 'Thead', 'Tbody', 'Tfoot', 'Tr', 'Th', 'Td', 'TableCaption',
        // Navigation
        'Breadcrumb', 'BreadcrumbItem', 'BreadcrumbLink', 'Link', 'LinkBox', 'LinkOverlay',
        'Tabs', 'TabList', 'TabPanels', 'Tab', 'TabPanel',
        // Overlay
        'Modal', 'ModalOverlay', 'ModalContent', 'ModalHeader', 'ModalFooter', 'ModalBody', 'ModalCloseButton',
        'Drawer', 'DrawerBody', 'DrawerFooter', 'DrawerHeader', 'DrawerOverlay', 'DrawerContent', 'DrawerCloseButton',
        'Menu', 'MenuButton', 'MenuList', 'MenuItem', 'MenuItemOption', 'MenuGroup', 'MenuOptionGroup', 'MenuDivider',
        'Popover', 'PopoverTrigger', 'PopoverContent', 'PopoverHeader', 'PopoverBody', 'PopoverFooter', 'PopoverArrow', 'PopoverCloseButton',
        'Tooltip', 'AlertDialog', 'AlertDialogBody', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogContent', 'AlertDialogOverlay',
        // Disclosure
        'Accordion', 'AccordionItem', 'AccordionButton', 'AccordionPanel', 'AccordionIcon',
        'VisuallyHidden', 'Show', 'Hide', 'Collapse',
        // Media
        'Icon', 'CloseButton'
      ];
      
      return basicComponents.map(name => ({
        name,
        description: `${name} component from Chakra UI`,
        category: this.categorizeComponent(name, '') as any
      }));
    }
    
    // Mantine fallback components
    if (packageName === '@mantine/core') {
      const mantineComponents = [
        // Layout
        'Container', 'SimpleGrid', 'Grid', 'Group', 'Stack', 'Flex', 'Center', 'Space', 'Divider',
        'AspectRatio', 'Box', 'AppShell', 'Paper',
        // Typography
        'Text', 'Title', 'Anchor', 'Blockquote', 'Code', 'Highlight', 'Mark', 'List',
        // Buttons & Actions
        'Button', 'ActionIcon', 'CopyButton', 'FileButton', 'UnstyledButton', 'CloseButton',
        // Inputs
        'TextInput', 'NumberInput', 'PasswordInput', 'Textarea', 'Select', 'MultiSelect',
        'Autocomplete', 'Checkbox', 'Switch', 'Radio', 'Slider', 'RangeSlider', 'Rating',
        'SegmentedControl', 'ColorInput', 'ColorPicker', 'FileInput', 'JsonInput', 'PinInput',
        'Chip', 'NativeSelect',
        // Navigation
        'Anchor', 'Breadcrumbs', 'Burger', 'NavLink', 'Pagination', 'Stepper', 'Tabs',
        // Data Display
        'Accordion', 'Avatar', 'Badge', 'Card', 'Image', 'BackgroundImage', 'Indicator',
        'Kbd', 'Spoiler', 'Table', 'ThemeIcon', 'Timeline', 'ColorSwatch',
        // Overlays
        'Dialog', 'Drawer', 'Modal', 'LoadingOverlay', 'Popover', 'Tooltip', 'Menu',
        'HoverCard', 'Overlay',
        // Feedback
        'Alert', 'Loader', 'Notification', 'Progress', 'RingProgress', 'Skeleton',
        // Misc
        'Portal', 'Transition', 'ScrollArea', 'FocusTrap', 'Input', 'InputWrapper'
      ];

      return mantineComponents.map(name => ({
        name,
        description: `${name} component from Mantine`,
        category: this.categorizeComponent(name, '') as any
      }));
    }

    // Material UI fallback components
    if (packageName === '@mui/material') {
      const muiComponents = [
        // Inputs
        'Autocomplete', 'Button', 'ButtonGroup', 'Checkbox', 'Fab', 'Radio', 'RadioGroup',
        'Rating', 'Select', 'Slider', 'Switch', 'TextField', 'ToggleButton', 'ToggleButtonGroup',
        // Data Display
        'Avatar', 'AvatarGroup', 'Badge', 'Chip', 'Divider', 'Icon', 'List', 'ListItem',
        'ListItemText', 'ListItemIcon', 'ListItemButton', 'Table', 'TableBody', 'TableCell',
        'TableContainer', 'TableHead', 'TableRow', 'Tooltip', 'Typography',
        // Feedback
        'Alert', 'AlertTitle', 'Backdrop', 'CircularProgress', 'Dialog', 'DialogActions',
        'DialogContent', 'DialogContentText', 'DialogTitle', 'LinearProgress', 'Skeleton', 'Snackbar',
        // Surfaces
        'Accordion', 'AccordionActions', 'AccordionDetails', 'AccordionSummary', 'AppBar',
        'Card', 'CardActions', 'CardContent', 'CardHeader', 'CardMedia', 'Paper', 'Toolbar',
        // Navigation
        'BottomNavigation', 'BottomNavigationAction', 'Breadcrumbs', 'Drawer', 'Link',
        'Menu', 'MenuItem', 'MenuList', 'Pagination', 'SpeedDial', 'SpeedDialAction',
        'SpeedDialIcon', 'Stepper', 'Step', 'StepLabel', 'Tabs', 'Tab',
        // Layout
        'Box', 'Container', 'Grid', 'Stack', 'ImageList', 'ImageListItem',
        // Utils
        'ClickAwayListener', 'Modal', 'NoSsr', 'Popover', 'Popper', 'Portal', 'Collapse', 'Fade', 'Grow', 'Slide', 'Zoom'
      ];

      return muiComponents.map(name => ({
        name,
        description: `${name} component from Material UI`,
        category: this.categorizeComponent(name, '') as any
      }));
    }

    // Ant Design fallback components
    if (packageName === 'antd') {
      const antdComponents = [
        // General
        'Button', 'FloatButton', 'Icon', 'Typography', 'Text', 'Title', 'Paragraph', 'Link',
        // Layout
        'Divider', 'Flex', 'Grid', 'Row', 'Col', 'Layout', 'Header', 'Footer', 'Sider', 'Content', 'Space',
        // Navigation
        'Anchor', 'Breadcrumb', 'Dropdown', 'Menu', 'Pagination', 'Steps',
        // Data Entry
        'AutoComplete', 'Cascader', 'Checkbox', 'ColorPicker', 'DatePicker', 'Form',
        'Input', 'InputNumber', 'Mentions', 'Radio', 'Rate', 'Select', 'Slider',
        'Switch', 'TimePicker', 'Transfer', 'TreeSelect', 'Upload',
        // Data Display
        'Avatar', 'Badge', 'Calendar', 'Card', 'Carousel', 'Collapse', 'Descriptions',
        'Empty', 'Image', 'List', 'Popover', 'QRCode', 'Segmented', 'Statistic',
        'Table', 'Tabs', 'Tag', 'Timeline', 'Tooltip', 'Tour', 'Tree',
        // Feedback
        'Alert', 'Drawer', 'Message', 'Modal', 'Notification', 'Popconfirm', 'Progress',
        'Result', 'Skeleton', 'Spin', 'Watermark'
      ];

      return antdComponents.map(name => ({
        name,
        description: `${name} component from Ant Design`,
        category: this.categorizeComponent(name, '') as any
      }));
    }

    // Vuetify fallback components (Vue 3)
    if (packageName === 'vuetify' || packageName === 'vuetify/components') {
      const vuetifyComponents = [
        // Layout
        'VApp', 'VMain', 'VContainer', 'VRow', 'VCol', 'VSpacer', 'VDivider', 'VFooter', 'VToolbar',
        'VAppBar', 'VNavigationDrawer', 'VSheet', 'VCard', 'VCardTitle', 'VCardSubtitle', 'VCardText', 'VCardActions',
        // Buttons & Actions
        'VBtn', 'VBtnToggle', 'VFab', 'VSpeedDial',
        // Inputs & Forms
        'VTextField', 'VTextarea', 'VSelect', 'VAutocomplete', 'VCombobox', 'VCheckbox', 'VRadio', 'VRadioGroup',
        'VSwitch', 'VSlider', 'VRangeSlider', 'VFileInput', 'VForm', 'VColorPicker', 'VDatePicker', 'VTimePicker',
        'VOtpInput', 'VNumberInput',
        // Data Display
        'VAvatar', 'VBadge', 'VChip', 'VChipGroup', 'VImg', 'VIcon', 'VList', 'VListItem', 'VListItemTitle',
        'VListItemSubtitle', 'VListItemAction', 'VTable', 'VDataTable', 'VDataTableServer', 'VDataTableVirtual',
        'VTimeline', 'VTimelineItem', 'VTooltip', 'VExpansionPanels', 'VExpansionPanel', 'VExpansionPanelTitle',
        'VExpansionPanelText', 'VTreeview', 'VVirtualScroll',
        // Navigation
        'VTabs', 'VTab', 'VTabsWindow', 'VTabsWindowItem', 'VMenu', 'VBreadcrumbs', 'VBreadcrumbsItem',
        'VPagination', 'VBottomNavigation', 'VStepper', 'VStepperHeader', 'VStepperItem', 'VStepperContent',
        // Feedback
        'VAlert', 'VSnackbar', 'VProgressLinear', 'VProgressCircular', 'VSkeleton', 'VSkeletonLoader',
        'VDialog', 'VBottomSheet', 'VOverlay', 'VBanner',
        // Typography
        'VSystemBar', 'VLabel',
        // Misc
        'VCarousel', 'VCarouselItem', 'VParallax', 'VRating', 'VHover', 'VLazy', 'VThemeProvider',
        'VDefaultsProvider', 'VLocaleProvider', 'VResponsive', 'VNoSsr', 'VInfiniteScroll'
      ];

      return vuetifyComponents.map(name => ({
        name,
        description: `${name} component from Vuetify`,
        category: this.categorizeComponent(name, '') as any
      }));
    }

    // Angular Material fallback components
    if (packageName === '@angular/material' || packageName.startsWith('@angular/material/')) {
      const angularMaterialComponents = [
        // Form Controls
        'MatAutocomplete', 'MatCheckbox', 'MatDatepicker', 'MatFormField', 'MatInput', 'MatRadioButton',
        'MatRadioGroup', 'MatSelect', 'MatSlider', 'MatSlideToggle',
        // Navigation
        'MatMenu', 'MatSidenav', 'MatToolbar', 'MatList', 'MatListItem', 'MatNavList', 'MatTabs',
        'MatTabGroup', 'MatStepper',
        // Layout
        'MatCard', 'MatCardHeader', 'MatCardTitle', 'MatCardContent', 'MatCardActions', 'MatDivider',
        'MatExpansionPanel', 'MatAccordion', 'MatGridList', 'MatGridTile',
        // Buttons & Indicators
        'MatButton', 'MatButtonToggle', 'MatButtonToggleGroup', 'MatBadge', 'MatChip', 'MatChipList',
        'MatChipListbox', 'MatIcon', 'MatProgressSpinner', 'MatProgressBar', 'MatRipple',
        // Popups & Modals
        'MatDialog', 'MatDialogTitle', 'MatDialogContent', 'MatDialogActions', 'MatSnackBar',
        'MatTooltip', 'MatBottomSheet',
        // Data Table
        'MatTable', 'MatSort', 'MatSortHeader', 'MatPaginator',
        // Tree
        'MatTree', 'MatTreeNode', 'MatNestedTreeNode'
      ];

      return angularMaterialComponents.map(name => ({
        name,
        description: `${name} component from Angular Material`,
        category: this.categorizeComponent(name, '') as any
      }));
    }

    // Skeleton UI fallback components (Svelte)
    if (packageName === '@skeletonlabs/skeleton' || packageName === '@skeletonlabs/skeleton-svelte') {
      const skeletonComponents = [
        // Layout
        'AppShell', 'AppBar', 'AppRail', 'AppRailTile', 'AppRailAnchor',
        // Navigation
        'TabGroup', 'Tab', 'TabAnchor', 'Stepper', 'Step', 'Pagination',
        // Surfaces
        'Card', 'Accordion', 'AccordionItem',
        // Input
        'FileButton', 'FileDropzone', 'SlideToggle', 'RadioGroup', 'RangeSlider',
        'InputChip', 'Autocomplete', 'ListBox', 'ListBoxItem', 'Ratings',
        // Feedback
        'Alert', 'Toast', 'ProgressBar', 'ProgressRadial', 'Drawer', 'Modal',
        // Visualization
        'Avatar', 'CodeBlock', 'Table', 'TableBody', 'TableHead',
        // Utility
        'Popup', 'ConicGradient', 'GradientHeading', 'LightSwitch',
        // Typography
        'Typography'
      ];

      return skeletonComponents.map(name => ({
        name,
        description: `${name} component from Skeleton UI`,
        category: this.categorizeComponent(name, '') as any
      }));
    }

    // Shoelace fallback components (Web Components)
    if (packageName === '@shoelace-style/shoelace') {
      const shoelaceComponents = [
        // Layout
        'SlCard', 'SlDivider', 'SlDrawer', 'SlDialog', 'SlDetails', 'SlPopup', 'SlCarousel',
        'SlCarouselItem', 'SlSplitPanel', 'SlResizeObserver',
        // Buttons & Actions
        'SlButton', 'SlButtonGroup', 'SlCopyButton', 'SlIconButton',
        // Form Controls
        'SlInput', 'SlSelect', 'SlOption', 'SlOptgroup', 'SlTextarea', 'SlCheckbox',
        'SlRadio', 'SlRadioButton', 'SlRadioGroup', 'SlSwitch', 'SlRange',
        'SlColorPicker', 'SlRating',
        // Data Display
        'SlAvatar', 'SlBadge', 'SlTag', 'SlIcon', 'SlImage', 'SlImageComparer',
        'SlFormatBytes', 'SlFormatDate', 'SlFormatNumber', 'SlRelativeTime', 'SlQrCode',
        'SlTree', 'SlTreeItem',
        // Navigation
        'SlBreadcrumb', 'SlBreadcrumbItem', 'SlMenu', 'SlMenuItem', 'SlMenuLabel',
        'SlTab', 'SlTabGroup', 'SlTabPanel',
        // Feedback
        'SlAlert', 'SlProgressBar', 'SlProgressRing', 'SlSpinner', 'SlSkeleton',
        'SlTooltip',
        // Typography & Misc
        'SlAnimatedImage', 'SlAnimation', 'SlInclude', 'SlMutationObserver',
        'SlVisuallyHidden'
      ];

      return shoelaceComponents.map(name => ({
        name,
        description: `${name} component from Shoelace`,
        category: this.categorizeComponent(name, '') as any
      }));
    }

    // Default: return empty array
    return [];
  }

  /**
   * Discover components from local files
   */
  private async discoverFromLocalFiles(source: ComponentSource): Promise<void> {
    if (!fs.existsSync(source.path)) {
      return;
    }

    // Use adapter's file patterns if source doesn't specify patterns
    const defaultPatterns = this.frameworkAdapter.getComponentFilePatterns()
      .map(p => p.replace('**/', '')); // Convert glob to simpler patterns
    const files = this.findComponentFiles(source.path, source.patterns || defaultPatterns);

    for (const file of files) {
      // Skip story files, test files, and other non-component files
      if (this.isNonComponentFile(file)) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf-8');
      
      // Use framework adapter for component extraction
      const componentNames = this.frameworkAdapter.extractComponentNamesFromFile(file, content);

      for (const componentName of componentNames) {
        if (this.discoveredComponents.has(componentName)) {
          continue;
        }

        // Skip Story UI components and other internal components
        if (this.shouldSkipComponent(componentName, content)) {
          continue;
        }

        let props = this.extractPropsFromFile(content);

        // Always check co-located story file for additional props (argTypes, args)
        // Story files often define props that aren't in the component source (e.g., disabled, children)
        const storyProps = this.extractPropsFromStoryFile(file);
        for (const prop of storyProps) {
          if (!props.includes(prop)) {
            props.push(prop);
          }
        }

        // Extract rich prop type information from story file argTypes
        const propTypes = this.extractRichPropsFromStoryFile(file);

        this.discoveredComponents.set(componentName, {
          name: componentName,
          filePath: file,
          props,
          propTypes: propTypes.length > 0 ? propTypes : undefined,
          source,
          description: `${componentName} component`,
          category: this.categorizeComponent(componentName, content),
          slots: this.extractSlots(content),
          examples: []
        });
      }
    }
  }

  /**
   * Check if a file should be skipped (stories, tests, etc.)
   */
  private isNonComponentFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const skipPatterns = [
      /\.stories?\.(tsx?|jsx?)$/i,    // Story files
      /\.test\.(tsx?|jsx?)$/i,        // Test files
      /\.spec\.(tsx?|jsx?)$/i,        // Spec files
      /\.d\.ts$/i,                    // Type definition files
      /index\.(tsx?|jsx?)$/i,         // Index files (usually just exports)
      /\.config\.(tsx?|jsx?)$/i,      // Config files
      /\.mock\.(tsx?|jsx?)$/i,        // Mock files
    ];

    return skipPatterns.some(pattern => pattern.test(fileName));
  }

  /**
   * Check if a component should be skipped based on name or content
   */
  private shouldSkipComponent(componentName: string, content: string): boolean {
    // Skip Story UI components
    if (componentName === 'StoryUIPanel' || componentName.startsWith('StoryUI')) {
      return true;
    }

    // Skip components that look like story exports
    if (componentName.endsWith('Story') || componentName.endsWith('Example') || componentName.endsWith('Demo')) {
      return true;
    }

    // Skip if content indicates it's not a proper component (e.g., just exports)
    if (content.includes('export default meta') || content.includes('satisfies Meta')) {
      return true;
    }

    return false;
  }

  /**
   * Find component files recursively
   */
  private findComponentFiles(dir: string, patterns: string[]): string[] {
    const files: string[] = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          files.push(...this.findComponentFiles(fullPath, patterns));
        } else if (entry.isFile()) {
          const matches = patterns.some(pattern => {
            const regex = new RegExp(pattern.replace('*', '.*'));
            return regex.test(entry.name);
          });

          if (matches) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`Error reading directory ${dir}:`, error);
    }

    return files;
  }

  /**
   * Extract component name from file
   */
  private extractComponentNames(filePath: string, content: string): string[] {
    const names: Set<string> = new Set();

    // 1. Check for inline exports: export function/const/class Name
    const inlineExportRegex = /export\s+(default\s+)?(function|const|class)\s+([A-Z][A-Za-z0-9]*)/g;
    let match;
    while ((match = inlineExportRegex.exec(content)) !== null) {
      names.add(match[3]);
    }

    // 2. Check for grouped exports: export { Name1, Name2 }
    const groupedExportRegex = /export\s*\{\s*([^}]+)\s*\}/g;
    while ((match = groupedExportRegex.exec(content)) !== null) {
      const exports = match[1].split(',');
      for (const exp of exports) {
        // Handle "Name" or "Name as Alias" - we want the original name
        const namePart = exp.trim().split(/\s+as\s+/)[0].trim();
        // Only include PascalCase names (components start with uppercase)
        if (/^[A-Z][A-Za-z0-9]*$/.test(namePart)) {
          names.add(namePart);
        }
      }
    }

    // 3. Fallback to filename if no exports found
    if (names.size === 0) {
      const fileName = path.basename(filePath, path.extname(filePath));
      if (fileName !== 'index' && /^[A-Z]/.test(fileName)) {
        names.add(fileName);
      }
    }

    return Array.from(names);
  }

  /**
   * Extract props from file content
   * Supports multiple patterns:
   * - TypeScript interfaces (interface ButtonProps { variant: ... })
   * - PropTypes (Component.propTypes = { variant: ... })
   * - Function parameter destructuring ({ className, variant, ...props }: Props)
   * - VariantProps from class-variance-authority
   */
  private extractPropsFromFile(content: string): string[] {
    const props: string[] = [];

    // Extract from TypeScript interfaces
    const interfaceMatch = content.match(/interface\s+\w*Props\s*{([^}]+)}/);
    if (interfaceMatch) {
      const propsContent = interfaceMatch[1];
      const propMatches = propsContent.matchAll(/^\s*(\w+)(\?)?:/gm);
      for (const match of propMatches) {
        props.push(match[1]);
      }
    }

    // Extract from PropTypes
    const propTypesMatch = content.match(/\.propTypes\s*=\s*{([^}]+)}/);
    if (propTypesMatch) {
      const propsContent = propTypesMatch[1];
      const propMatches = propsContent.matchAll(/(\w+):/g);
      for (const match of propMatches) {
        props.push(match[1]);
      }
    }

    // Extract from function parameter destructuring
    // Matches patterns like:
    //   function Component({ prop1, prop2, ...rest }: Props)
    //   const Component = ({ prop1, prop2 }: Props) =>
    //   export function Component({ prop1, prop2 }: React.ComponentProps<"div">)
    const destructuringProps = this.extractDestructuredProps(content);
    for (const prop of destructuringProps) {
      if (!props.includes(prop)) {
        props.push(prop);
      }
    }

    // Extract from VariantProps (class-variance-authority pattern)
    // Matches: VariantProps<typeof buttonVariants>
    const variantPropsMatch = content.match(/VariantProps<typeof\s+(\w+)>/);
    if (variantPropsMatch) {
      const variantsName = variantPropsMatch[1];
      // Look for the cva definition to extract variant names
      const cvaMatch = content.match(new RegExp(`${variantsName}\\s*=\\s*cva\\([^,]+,\\s*{\\s*variants:\\s*{([^}]+(?:{[^}]*}[^}]*)*)}`));
      if (cvaMatch) {
        const variantsContent = cvaMatch[1];
        // Extract variant property names (e.g., variant, size)
        const variantMatches = variantsContent.matchAll(/^\s*(\w+)\s*:\s*{/gm);
        for (const match of variantMatches) {
          if (!props.includes(match[1])) {
            props.push(match[1]);
          }
        }
      }
    }

    return props;
  }

  /**
   * Extract props from function parameter destructuring patterns
   * Works with React, Vue <script setup>, and other frameworks
   */
  private extractDestructuredProps(content: string): string[] {
    const props: string[] = [];

    // Pattern 1: function Component({ prop1, prop2, ...rest }: Type)
    // Pattern 2: const Component = ({ prop1, prop2 }: Type) =>
    // Pattern 3: export function Component({ prop1, prop2 }: Type)
    const functionPatterns = [
      // function Name({ destructured }: Type)
      /(?:export\s+)?(?:default\s+)?function\s+[A-Z]\w*\s*\(\s*\{\s*([^}]+)\s*\}\s*:/g,
      // const Name = ({ destructured }: Type) =>
      /(?:export\s+)?const\s+[A-Z]\w*\s*=\s*\(\s*\{\s*([^}]+)\s*\}\s*:/g,
      // const Name: FC<Props> = ({ destructured }) =>
      /(?:export\s+)?const\s+[A-Z]\w*\s*:\s*\w+(?:<[^>]+>)?\s*=\s*\(\s*\{\s*([^}]+)\s*\}\s*\)/g,
    ];

    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const destructuredContent = match[1];
        // Extract individual prop names, ignoring spread operator (...rest)
        const propMatches = destructuredContent.matchAll(/(?:^|,)\s*(?!\.\.\.)([\w]+)(?:\s*=\s*[^,}]+)?(?=\s*[,}]|$)/g);
        for (const propMatch of propMatches) {
          const propName = propMatch[1].trim();
          // Skip common internal props and rest patterns
          if (propName && !['ref', 'props', 'rest'].includes(propName) && !props.includes(propName)) {
            props.push(propName);
          }
        }
      }
    }

    return props;
  }

  /**
   * Extract props from co-located story file (e.g., Button.stories.tsx)
   * This is a fallback for components like shadcn/ui that don't use interface Props patterns
   */
  private extractPropsFromStoryFile(componentPath: string): string[] {
    const props: string[] = [];

    // Construct story file path: button.tsx -> button.stories.tsx
    const dir = path.dirname(componentPath);
    const ext = path.extname(componentPath);
    const name = path.basename(componentPath, ext);

    // Try different story file naming conventions
    const storyPaths = [
      path.join(dir, `${name}.stories.tsx`),
      path.join(dir, `${name}.stories.ts`),
      path.join(dir, `${name}.story.tsx`),
      path.join(dir, `${name}.story.ts`),
    ];

    let storyContent = '';
    for (const storyPath of storyPaths) {
      if (fs.existsSync(storyPath)) {
        try {
          storyContent = fs.readFileSync(storyPath, 'utf-8');
          break;
        } catch {
          continue;
        }
      }
    }

    if (!storyContent) {
      return props;
    }

    // Extract from argTypes: { propName: { control: ..., options: ... } }
    // Only match prop names followed by `: {` to avoid picking up nested properties like control, options
    const argTypesMatch = storyContent.match(/argTypes\s*:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/);
    if (argTypesMatch) {
      // Match prop names followed by `: {` which indicates argType config object
      const propMatches = argTypesMatch[1].matchAll(/(\w+)\s*:\s*\{/g);
      for (const match of propMatches) {
        // Skip common argTypes meta-properties that shouldn't be props
        const metaProps = ['control', 'options', 'description', 'table', 'type', 'defaultValue', 'if', 'mapping'];
        if (!metaProps.includes(match[1]) && !props.includes(match[1])) {
          props.push(match[1]);
        }
      }
    }

    // Extract from args: { propName: value }
    const argsMatches = storyContent.matchAll(/args\s*:\s*\{([^}]+)\}/g);
    for (const argsMatch of argsMatches) {
      const argContent = argsMatch[1];
      const propMatches = argContent.matchAll(/^\s*(\w+)\s*:/gm);
      for (const match of propMatches) {
        if (!props.includes(match[1])) {
          props.push(match[1]);
        }
      }
    }

    // Extract from render function parameters if they use destructuring
    // e.g., render: ({ variant, size }) => ...
    const renderMatches = storyContent.matchAll(/render\s*:\s*\(\s*\{\s*([^}]+)\s*\}\s*\)/g);
    for (const renderMatch of renderMatches) {
      const paramContent = renderMatch[1];
      const propMatches = paramContent.matchAll(/(\w+)(?:\s*,|\s*$)/g);
      for (const match of propMatches) {
        if (!props.includes(match[1])) {
          props.push(match[1]);
        }
      }
    }

    return props;
  }

  /**
   * Extract rich prop type information from story file argTypes
   * Framework-agnostic: works with any Storybook project (React, Vue, Angular, Svelte, etc.)
   */
  private extractRichPropsFromStoryFile(componentPath: string): PropInfo[] {
    const propTypes: PropInfo[] = [];

    // Construct story file path: button.tsx -> button.stories.tsx
    const dir = path.dirname(componentPath);
    const ext = path.extname(componentPath);
    const name = path.basename(componentPath, ext);

    // Try different story file naming conventions
    const storyPaths = [
      path.join(dir, `${name}.stories.tsx`),
      path.join(dir, `${name}.stories.ts`),
      path.join(dir, `${name}.story.tsx`),
      path.join(dir, `${name}.story.ts`),
    ];

    let storyContent = '';
    for (const storyPath of storyPaths) {
      if (fs.existsSync(storyPath)) {
        try {
          storyContent = fs.readFileSync(storyPath, 'utf-8');
          break;
        } catch {
          continue;
        }
      }
    }

    if (!storyContent) {
      return propTypes;
    }

    // Parse argTypes block using brace counting for reliable extraction
    // This handles nested objects properly (e.g., control: { type: 'select' })
    const argTypesContent = this.extractArgTypesBlock(storyContent);
    if (argTypesContent) {
      
      // Match each prop definition: propName: { ... }
      // This regex handles nested objects properly
      const propPattern = /(\w+)\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
      let propMatch;
      
      while ((propMatch = propPattern.exec(argTypesContent)) !== null) {
        const propName = propMatch[1];
        const propConfig = propMatch[2];
        
        // Skip meta-properties that aren't actual props
        const metaProps = ['control', 'options', 'description', 'table', 'type', 'defaultValue', 'if', 'mapping'];
        if (metaProps.includes(propName)) {
          continue;
        }

        // Extract control type
        let controlType = 'unknown';
        const controlMatch = propConfig.match(/control\s*:\s*['"]?([\w-]+)['"]?/);
        const controlObjMatch = propConfig.match(/control\s*:\s*\{\s*type\s*:\s*['"]?([\w-]+)['"]?/);
        
        if (controlObjMatch) {
          controlType = controlObjMatch[1];
        } else if (controlMatch) {
          controlType = controlMatch[1];
        }

        // Map control types to our type system
        const typeMapping: Record<string, PropInfo['type']> = {
          'select': 'select',
          'radio': 'radio',
          'inline-radio': 'radio',
          'boolean': 'boolean',
          'number': 'number',
          'range': 'number',
          'text': 'string',
          'color': 'string',
          'date': 'string',
          'object': 'object',
          'array': 'array',
          'file': 'object',
        };
        const type = typeMapping[controlType] || 'unknown';

        // Extract options array
        let options: string[] | undefined;
        const optionsMatch = propConfig.match(/options\s*:\s*\[([\s\S]*?)\]/);
        if (optionsMatch) {
          // Parse the options array, handling both quoted and unquoted values
          const optionsContent = optionsMatch[1];
          options = optionsContent
            .split(',')
            .map(opt => opt.trim().replace(/^['"]|['"]$/g, ''))
            .filter(opt => opt.length > 0);
        }

        // Extract description
        let description: string | undefined;
        const descMatch = propConfig.match(/description\s*:\s*['"`]([\s\S]*?)['"`]/);
        if (descMatch) {
          description = descMatch[1];
        }

        // Extract defaultValue
        let defaultValue: unknown;
        const defaultMatch = propConfig.match(/defaultValue\s*:\s*(['"][\s\S]*?['"]|[\w]+)/);
        if (defaultMatch) {
          const rawValue = defaultMatch[1].replace(/^['"]|['"]$/g, '');
          if (rawValue === 'true') defaultValue = true;
          else if (rawValue === 'false') defaultValue = false;
          else if (!isNaN(Number(rawValue))) defaultValue = Number(rawValue);
          else defaultValue = rawValue;
        }

        propTypes.push({
          name: propName,
          type,
          options,
          description,
          defaultValue,
          control: controlType,
        });
      }
    }

    // Also check for props in args that might not be in argTypes
    // Use smarter type inference based on value and prop name patterns
    const argsMatches = storyContent.matchAll(/args\s*:\s*\{([^}]+)\}/g);
    for (const argsMatch of argsMatches) {
      const argsContent = argsMatch[1];
      // Match prop: value pairs
      const propValueMatches = argsContent.matchAll(/(\w+)\s*:\s*([^,\n]+)/g);
      for (const match of propValueMatches) {
        const propName = match[1];
        const rawValue = match[2].trim();

        // Only add if not already in propTypes
        if (!propTypes.find(p => p.name === propName)) {
          // Infer type from value
          let inferredType: PropInfo['type'] = 'unknown';
          let description: string | undefined;

          // Check value-based inference
          if (rawValue === 'true' || rawValue === 'false') {
            inferredType = 'boolean';
          } else if (/^['"`]/.test(rawValue)) {
            inferredType = 'string';
          } else if (!isNaN(Number(rawValue)) && rawValue !== '') {
            inferredType = 'number';
          } else if (rawValue.startsWith('[')) {
            inferredType = 'array';
          } else if (rawValue.startsWith('{')) {
            inferredType = 'object';
          }

          // Check name-based inference for common patterns
          const booleanPatterns = ['disabled', 'checked', 'defaultChecked', 'open', 'defaultOpen',
            'selected', 'expanded', 'collapsed', 'visible', 'hidden', 'loading', 'error',
            'required', 'readonly', 'readOnly', 'active', 'pressed', 'indeterminate',
            'asChild', 'modal', 'loop', 'autoFocus', 'closeOnEscape', 'closeOnOutsideClick'];
          if (booleanPatterns.some(p => propName.toLowerCase().includes(p.toLowerCase()))) {
            inferredType = 'boolean';
            description = `Whether the component is ${propName.replace(/^(default|is|has)/, '').toLowerCase()}`;
          }

          // Name patterns for strings
          const stringPatterns = ['placeholder', 'label', 'title', 'description', 'name', 'id',
            'className', 'style', 'href', 'src', 'alt', 'value', 'defaultValue'];
          if (stringPatterns.some(p => propName.toLowerCase() === p.toLowerCase())) {
            if (inferredType === 'unknown') inferredType = 'string';
          }

          propTypes.push({
            name: propName,
            type: inferredType,
            description,
          });
        }
      }
    }

    // Phase 3: Scan story code for prop values to infer select types
    // This catches variants used in JSX/render functions even without argTypes
    this.inferSelectTypesFromStoryCode(storyContent, propTypes);

    // Phase 4: Generate better descriptions for common props
    this.enhancePropDescriptions(propTypes);

    return propTypes;
  }

  /**
   * Scan story code for prop usage patterns to infer select types
   * Looks for patterns like: variant="destructive", size='lg', type={value}
   */
  private inferSelectTypesFromStoryCode(storyContent: string, propTypes: PropInfo[]): void {
    // Common props that are typically selects with limited options
    const selectCandidates = ['variant', 'size', 'type', 'color', 'align', 'position',
      'orientation', 'side', 'status', 'state', 'mode', 'theme', 'intent', 'severity'];

    for (const propName of selectCandidates) {
      const existingProp = propTypes.find(p => p.name === propName);

      // Skip if already typed as select with options
      if (existingProp?.type === 'select' && existingProp.options?.length) {
        continue;
      }

      // Find all values used for this prop in JSX and args
      const values = new Set<string>();

      // Pattern 1: JSX attribute - propName="value" or propName='value'
      const jsxPattern = new RegExp(`${propName}=["']([^"']+)["']`, 'g');
      let match;
      while ((match = jsxPattern.exec(storyContent)) !== null) {
        values.add(match[1]);
      }

      // Pattern 2: args object - propName: 'value' or propName: "value"
      const argsPattern = new RegExp(`${propName}\\s*:\\s*["']([^"']+)["']`, 'g');
      while ((match = argsPattern.exec(storyContent)) !== null) {
        values.add(match[1]);
      }

      // If we found multiple unique values, it's definitely a select
      if (values.size >= 2) {
        const options = Array.from(values).sort();

        if (existingProp) {
          // Upgrade existing prop to select
          existingProp.type = 'select';
          existingProp.options = options;
        } else {
          // Add new prop as select
          propTypes.push({
            name: propName,
            type: 'select',
            options,
          });
        }
      } else if (values.size === 1) {
        // Single non-default value found - likely a select with default + this value
        const foundValue = Array.from(values)[0];
        if (foundValue !== 'default') {
          const options = ['default', foundValue];
          if (existingProp) {
            // Upgrade existing prop to select
            existingProp.type = 'select';
            existingProp.options = options;
          } else {
            propTypes.push({
              name: propName,
              type: 'select',
              options,
            });
          }
        }
      }
    }
  }

  /**
   * Generate better descriptions for common props when not provided
   */
  private enhancePropDescriptions(propTypes: PropInfo[]): void {
    const descriptionTemplates: Record<string, string> = {
      variant: 'Visual style variant of the component',
      size: 'Size of the component',
      disabled: 'Whether the component is disabled',
      checked: 'Whether the component is checked',
      defaultChecked: 'Default checked state',
      open: 'Whether the component is open',
      defaultOpen: 'Default open state',
      selected: 'Whether the item is selected',
      expanded: 'Whether the component is expanded',
      loading: 'Whether the component is in loading state',
      error: 'Whether the component is in error state',
      required: 'Whether the field is required',
      readOnly: 'Whether the component is read-only',
      placeholder: 'Placeholder text when empty',
      label: 'Label text for the component',
      title: 'Title of the component',
      description: 'Description text',
      children: 'Content to render inside the component',
      className: 'Additional CSS classes',
      asChild: 'Render as child element for composition',
      orientation: 'Layout orientation (horizontal/vertical)',
      align: 'Content alignment',
      side: 'Side where the component appears',
      position: 'Position of the component',
      type: 'Type of the component',
      color: 'Color variant',
      intent: 'Intent/purpose variant (info, success, warning, error)',
      severity: 'Severity level',
      status: 'Current status',
      state: 'Current state',
      mode: 'Operating mode',
      theme: 'Theme variant',
    };

    for (const prop of propTypes) {
      // Only enhance if description is missing or generic
      if (!prop.description || prop.description.endsWith(' property')) {
        const template = descriptionTemplates[prop.name];
        if (template) {
          prop.description = template;
        }
      }
    }
  }

  /**
   * Extract the content of the argTypes block using brace counting
   * This handles nested objects more reliably than regex
   */
  private extractArgTypesBlock(content: string): string | null {
    const startMatch = content.match(/argTypes\s*:\s*\{/);
    if (!startMatch || startMatch.index === undefined) return null;

    const startIndex = startMatch.index + startMatch[0].length;
    let braceCount = 1;
    let endIndex = startIndex;

    for (let i = startIndex; i < content.length && braceCount > 0; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      endIndex = i;
    }

    return content.substring(startIndex, endIndex);
  }

  /**
   * Extract slots from content
   */
  private extractSlots(content: string): string[] {
    const slots: string[] = [];

    // Look for children prop
    if (content.includes('children')) {
      slots.push('default');
    }

    // Look for named slots pattern
    const slotMatches = content.matchAll(/slot[A-Z]\w*/g);
    for (const match of slotMatches) {
      slots.push(match[0]);
    }

    return slots;
  }

  /**
   * Categorize component based on name and content
   */
  private categorizeComponent(name: string, content: string): 'layout' | 'content' | 'form' | 'navigation' | 'feedback' | 'other' {
    if (!name || typeof name !== 'string') {
      return 'other';
    }
    const nameLower = name.toLowerCase();

    // Layout components
    if (/^(layout|grid|row|col|column|container|box|flex|stack|section|wrapper|panel)/.test(nameLower)) {
      return 'layout';
    }

    // Form components
    if (/^(form|input|button|select|checkbox|radio|switch|toggle|field|textarea)/.test(nameLower)) {
      return 'form';
    }

    // Navigation
    if (/^(nav|menu|tab|breadcrumb|pagination|link|anchor)/.test(nameLower)) {
      return 'navigation';
    }

    // Feedback
    if (/^(alert|modal|dialog|toast|notification|message|tooltip|popover)/.test(nameLower)) {
      return 'feedback';
    }

    // Content
    if (/^(card|list|table|badge|tag|chip|avatar|image|text|heading|paragraph)/.test(nameLower)) {
      return 'content';
    }

    return 'other';
  }

  /**
   * Discover from custom elements JSON
   */
  private async discoverFromCustomElements(source: ComponentSource): Promise<void> {
    if (!fs.existsSync(source.path)) {
      return;
    }

    try {
      const customElements = JSON.parse(fs.readFileSync(source.path, 'utf-8'));

      if (customElements.modules) {
        for (const module of customElements.modules) {
          if (module.declarations) {
            for (const declaration of module.declarations) {
              if (declaration.kind === 'class' && declaration.customElement) {
                const componentName = this.config.componentPrefix + declaration.name;

                this.discoveredComponents.set(componentName, {
                  name: componentName,
                  filePath: module.path || '',
                  props: this.extractPropsFromDeclaration(declaration),
                  source,
                  description: declaration.description || `${componentName} component`,
                  category: this.categorizeComponent(componentName, declaration.description || ''),
                  slots: declaration.slots?.map((s: any) => s.name) || [],
                  examples: []
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('Error parsing custom elements:', error);
    }
  }

  /**
   * Extract props from custom element declaration
   */
  private extractPropsFromDeclaration(declaration: any): string[] {
    const props: string[] = [];

    if (declaration.members) {
      for (const member of declaration.members) {
        if (member.kind === 'field' && member.privacy !== 'private') {
          props.push(member.name);
        }
      }
    }

    return props;
  }

  /**
   * Discover from TypeScript definitions
   */
  private async discoverFromTypeScript(source: ComponentSource): Promise<void> {
    // This would require TypeScript compiler API
    // For now, we'll rely on other discovery methods
    console.log(`TypeScript discovery for ${source.path} - using fallback methods`);
  }

  /**
   * Apply manual component configurations
   */
  private applyManualConfigurations(): void {
    // Add main components from config
    if (this.config.components && Array.isArray(this.config.components)) {
      for (const comp of this.config.components) {
        const existing = this.discoveredComponents.get(comp.name);

        this.discoveredComponents.set(comp.name, {
          name: comp.name,
          filePath: '',
          props: comp.props || existing?.props || [],
          source: {
            type: 'custom-elements',
            path: 'manual-config'
          },
          description: comp.description || existing?.description || `${comp.name} component`,
          category: comp.category || existing?.category || this.categorizeComponent(comp.name, ''),
          slots: comp.slots || existing?.slots || [],
          examples: comp.examples || existing?.examples || []
        });
      }
    }

    // Add layout components from config
    if (this.config.layoutComponents && Array.isArray(this.config.layoutComponents)) {
      for (const comp of this.config.layoutComponents) {
        const existing = this.discoveredComponents.get(comp.name);

        this.discoveredComponents.set(comp.name, {
          name: comp.name,
          filePath: '',
          props: comp.props || existing?.props || [],
          source: {
            type: 'custom-elements',
            path: 'manual-config'
          },
          description: comp.description || existing?.description || `${comp.name} component`,
          category: comp.category || existing?.category || this.categorizeComponent(comp.name, ''),
          slots: comp.slots || existing?.slots || [],
          examples: comp.examples || existing?.examples || []
        });
      }
    }
  }

  /**
   * Validate that component names actually exist in the discovered package
   */
  async validateComponentNames(componentNames: string[]): Promise<{
    valid: string[];
    invalid: string[];
    suggestions: Map<string, string>;
  }> {
    // If we have real component validation data, use it
    if (this.validateAvailableComponents.size > 0) {
      const valid: string[] = [];
      const invalid: string[] = [];
      const suggestions = new Map<string, string>();

      for (const componentName of componentNames) {
        if (this.validateAvailableComponents.has(componentName)) {
          valid.push(componentName);
        } else {
          invalid.push(componentName);

          // Find a similar component
          const suggestion = this.findSimilarComponent(componentName, Array.from(this.validateAvailableComponents));
          if (suggestion) {
            suggestions.set(componentName, suggestion);
          }
        }
      }

      return { valid, invalid, suggestions };
    }

    // Fallback to discovered components if no validation set
    const discovered = Array.from(this.discoveredComponents.keys());
    const valid = componentNames.filter(name => this.discoveredComponents.has(name));
    const invalid = componentNames.filter(name => !this.discoveredComponents.has(name));
    const suggestions = new Map<string, string>();

    for (const invalidName of invalid) {
      const suggestion = this.findSimilarComponent(invalidName, discovered);
      if (suggestion) {
        suggestions.set(invalidName, suggestion);
      }
    }

    return { valid, invalid, suggestions };
  }

  /**
   * Find a similar component name
   */
  private findSimilarComponent(targetName: string, availableComponents: string[]): string | null {
    if (!targetName || typeof targetName !== 'string') {
      return null;
    }
    const targetLower = targetName.toLowerCase();

    // Direct substring matches
    for (const available of availableComponents) {
      if (!available || typeof available !== 'string') {
        continue;
      }
      const availableLower = available.toLowerCase();
      if (availableLower.includes(targetLower) || targetLower.includes(availableLower)) {
        return available;
      }
    }

    // Special case mappings for common mistakes
    const commonMappings: Record<string, string[]> = {
      'stack': ['BlockStack', 'InlineStack', 'LegacyStack'],
      'layout': ['Layout', 'Box'],
      'container': ['Box', 'Layout'],
      'grid': ['Grid', 'InlineGrid'],
      'text': ['Text'],
      'button': ['Button'],
      'card': ['Card', 'LegacyCard']
    };

    const mapping = commonMappings[targetLower];
    if (mapping) {
      for (const suggestion of mapping) {
        if (availableComponents.includes(suggestion)) {
          return suggestion;
        }
      }
    }

    return null;
  }

  /**
   * Get the available component names for validation
   */
  getAvailableComponentNames(): string[] {
    if (this.validateAvailableComponents.size > 0) {
      return Array.from(this.validateAvailableComponents).sort();
    }
    return Array.from(this.discoveredComponents.keys()).sort();
  }
}
