import fs from 'fs';
import path from 'path';
import { DiscoveredComponent } from './componentDiscovery.js';
import { StoryUIConfig } from '../story-ui.config.js';
import { DynamicPackageDiscovery } from './dynamicPackageDiscovery.js';

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

  constructor(config: StoryUIConfig) {
    this.config = config;
  }

  /**
   * Discover components from all available sources
   * Priority: 1. Dynamic Discovery 2. Static Lists 3. Manual Config
   */
  async discoverAll(): Promise<EnhancedComponent[]> {
    // PRIORITY 1: Dynamic Discovery (when no manual components configured)
    const sources = this.identifySources();
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

    // PRIORITY 3 & 4: Apply manual configurations as final fallback
    this.applyManualConfigurations();

    return Array.from(this.discoveredComponents.values());
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

    // Check for npm packages
    // Skip dynamic discovery if components are manually configured
    if (this.config.importPath && !this.config.importPath.startsWith('.') &&
        (!this.config.components || this.config.components.length === 0)) {
      sources.push({
        type: 'npm',
        path: this.config.importPath
      });
    }

    // Check for local component directories
    if (this.config.componentsPath && fs.existsSync(this.config.componentsPath)) {
      sources.push({
        type: 'local',
        path: this.config.componentsPath,
        patterns: ['*.tsx', '*.jsx', '*.ts', '*.js']
      });
    }

    // Check for TypeScript definitions
    const projectRoot = this.getProjectRoot();
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
   * Discover components from npm packages using dynamic runtime discovery
   */
  private async discoverFromNpmPackage(source: ComponentSource): Promise<void> {
    // Determine the project root from the generated stories path
    const projectRoot = this.getProjectRoot();
    const packagePath = path.join(projectRoot, 'node_modules', source.path);

    if (!fs.existsSync(packagePath)) {
      console.warn(`Package ${source.path} not found in node_modules at ${packagePath}`);
      return;
    }

    console.log(`🔍 Dynamically discovering components from ${source.path}...`);

    // Use dynamic discovery to get real exports
    const dynamicDiscovery = new DynamicPackageDiscovery(source.path, projectRoot);
    const packageExports = await dynamicDiscovery.getRealPackageExports();

    if (!packageExports) {
      console.warn(`❌ Could not discover components from ${source.path}, falling back to predefined list`);
      // Fallback to predefined components if dynamic discovery fails
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
      }
      return;
    }

    // Process the real components found in the package
    const realComponents = packageExports.components.filter(comp => comp.isComponent);
    console.log(`✅ Found ${realComponents.length} real components in ${source.path} v${packageExports.packageVersion}`);
    console.log(`📦 Available components: ${realComponents.map(c => c.name).join(', ')}`);

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
        examples: knownComp?.examples || []
      } as EnhancedComponent);
    }

    // Store the component names for validation
    this.validateAvailableComponents = new Set(realComponents.map(c => c.name));
  }


  /**
   * Get known components for popular design systems
   */
  private getKnownDesignSystemComponents(packageName: string): Partial<EnhancedComponent>[] {
    const components: Partial<EnhancedComponent>[] = [];

    switch (packageName) {
      case 'antd':
      case 'ant-design':
        return [
          // Layout
          { name: 'Layout', category: 'layout', description: 'Main layout wrapper' },
          { name: 'Row', category: 'layout', description: 'Grid row for layouts' },
          { name: 'Col', category: 'layout', description: 'Grid column for layouts' },
          { name: 'Grid', category: 'layout', description: 'Grid layout component' },
          { name: 'Space', category: 'layout', description: 'Spacing component' },
          { name: 'Divider', category: 'layout', description: 'Divider line' },

          // Data Display
          { name: 'Table', category: 'content', description: 'Data table', props: ['dataSource', 'columns', 'pagination', 'loading'] },
          { name: 'Card', category: 'content', description: 'Card container', props: ['title', 'extra', 'loading', 'bordered'] },
          { name: 'Statistic', category: 'content', description: 'Statistical display', props: ['title', 'value', 'prefix', 'suffix'] },
          { name: 'List', category: 'content', description: 'List display', props: ['dataSource', 'renderItem', 'loading'] },
          { name: 'Badge', category: 'content', description: 'Badge for status', props: ['count', 'dot', 'status'] },
          { name: 'Tag', category: 'content', description: 'Tag label', props: ['color', 'closable', 'icon'] },
          { name: 'Avatar', category: 'content', description: 'User avatar', props: ['src', 'size', 'shape', 'icon'] },
          { name: 'Progress', category: 'content', description: 'Progress bar', props: ['percent', 'status', 'type'] },

          // Form
          { name: 'Form', category: 'form', description: 'Form container', props: ['layout', 'onFinish', 'initialValues'] },
          { name: 'Input', category: 'form', description: 'Text input', props: ['placeholder', 'value', 'onChange', 'size'] },
          { name: 'Select', category: 'form', description: 'Select dropdown', props: ['options', 'value', 'onChange', 'placeholder'] },
          { name: 'Button', category: 'form', description: 'Button', props: ['type', 'size', 'loading', 'icon', 'onClick'] },
          { name: 'Switch', category: 'form', description: 'Toggle switch', props: ['checked', 'onChange', 'size'] },
          { name: 'DatePicker', category: 'form', description: 'Date picker', props: ['value', 'onChange', 'format'] },

          // Feedback
          { name: 'Alert', category: 'feedback', description: 'Alert message', props: ['message', 'type', 'showIcon', 'closable'] },
          { name: 'Modal', category: 'feedback', description: 'Modal dialog', props: ['title', 'visible', 'onOk', 'onCancel'] },
          { name: 'Tooltip', category: 'feedback', description: 'Tooltip', props: ['title', 'placement'] },
          { name: 'Dropdown', category: 'feedback', description: 'Dropdown menu', props: ['menu', 'placement', 'trigger'] },

          // Navigation
          { name: 'Menu', category: 'navigation', description: 'Navigation menu', props: ['items', 'mode', 'selectedKeys'] },
          { name: 'Tabs', category: 'navigation', description: 'Tabbed navigation', props: ['items', 'activeKey', 'onChange'] },
          { name: 'Breadcrumb', category: 'navigation', description: 'Breadcrumb navigation', props: ['items'] },
          { name: 'Pagination', category: 'navigation', description: 'Pagination', props: ['current', 'total', 'pageSize', 'onChange'] }
        ];

      case '@mui/material':
        return [
          // Layout
          { name: 'Box', category: 'layout', description: 'Basic layout box' },
          { name: 'Container', category: 'layout', description: 'Responsive container' },
          { name: 'Grid', category: 'layout', description: 'Grid layout', props: ['container', 'item', 'xs', 'sm', 'md', 'lg', 'xl'] },
          { name: 'Stack', category: 'layout', description: 'Stack layout' },

          // Surfaces
          { name: 'Card', category: 'content', description: 'Card surface' },
          { name: 'CardContent', category: 'content', description: 'Card content area' },
          { name: 'Paper', category: 'content', description: 'Paper surface' },

          // Data Display
          { name: 'Typography', category: 'content', description: 'Text typography', props: ['variant', 'component'] },
          { name: 'Table', category: 'content', description: 'Data table' },
          { name: 'Chip', category: 'content', description: 'Chip component' },

          // Inputs
          { name: 'Button', category: 'form', description: 'Button', props: ['variant', 'color', 'size'] },
          { name: 'TextField', category: 'form', description: 'Text input', props: ['label', 'variant', 'value', 'onChange'] },
          { name: 'Select', category: 'form', description: 'Select dropdown' },
          { name: 'Switch', category: 'form', description: 'Toggle switch' }
        ];

      case '@chakra-ui/react':
        return [
          // Layout
          { name: 'Box', category: 'layout', description: 'Basic layout box' },
          { name: 'Flex', category: 'layout', description: 'Flexbox layout' },
          { name: 'Grid', category: 'layout', description: 'CSS Grid layout' },
          { name: 'SimpleGrid', category: 'layout', description: 'Simple grid layout', props: ['columns', 'spacing'] },
          { name: 'Stack', category: 'layout', description: 'Stack layout', props: ['direction', 'spacing'] },
          { name: 'HStack', category: 'layout', description: 'Horizontal stack' },
          { name: 'VStack', category: 'layout', description: 'Vertical stack' },

          // Content
          { name: 'Card', category: 'content', description: 'Card container' },
          { name: 'Text', category: 'content', description: 'Text component' },
          { name: 'Heading', category: 'content', description: 'Heading text' },
          { name: 'Badge', category: 'content', description: 'Badge component' },

          // Form
          { name: 'Button', category: 'form', description: 'Button', props: ['colorScheme', 'size', 'variant'] },
          { name: 'Input', category: 'form', description: 'Text input' },
          { name: 'Select', category: 'form', description: 'Select dropdown' }
        ];

      case '@shopify/polaris':
      case 'polaris':
        return [
          // Layout
          { name: 'Box', category: 'layout', description: 'Layout box with padding and spacing control', props: ['padding', 'paddingInline', 'paddingBlock'] },
          { name: 'BlockStack', category: 'layout', description: 'Vertical stack layout', props: ['gap', 'align', 'inlineAlign'] },
          { name: 'InlineStack', category: 'layout', description: 'Horizontal stack layout', props: ['gap', 'align', 'blockAlign', 'wrap'] },
          { name: 'InlineGrid', category: 'layout', description: 'Grid layout component', props: ['columns', 'gap'] },
          { name: 'Grid', category: 'layout', description: 'CSS Grid layout', props: ['columns', 'gap'] },
          { name: 'Layout', category: 'layout', description: 'Page layout component', props: ['sectioned'] },
          { name: 'Divider', category: 'layout', description: 'Visual divider', props: ['borderColor'] },
          { name: 'Bleed', category: 'layout', description: 'Negative margin component', props: ['marginInline', 'marginBlock'] },

          // Surfaces
          { name: 'Card', category: 'content', description: 'Card container', props: ['sectioned', 'subdued', 'actions', 'primaryFooterAction', 'secondaryFooterActions'] },
          { name: 'LegacyCard', category: 'content', description: 'Legacy card component', props: ['title', 'sectioned', 'actions'] },
          { name: 'CalloutCard', category: 'content', description: 'Callout card for important information', props: ['title', 'illustration', 'primaryAction'] },
          { name: 'MediaCard', category: 'content', description: 'Card with media content', props: ['title', 'primaryAction', 'description', 'size'] },

          // Navigation
          { name: 'Breadcrumbs', category: 'navigation', description: 'Breadcrumb navigation', props: ['breadcrumbs'] },
          { name: 'Link', category: 'navigation', description: 'Navigation link', props: ['url', 'external', 'monochrome'] },
          { name: 'Pagination', category: 'navigation', description: 'Page navigation', props: ['hasPrevious', 'hasNext', 'onPrevious', 'onNext'] },
          { name: 'LegacyTabs', category: 'navigation', description: 'Tabbed navigation', props: ['tabs', 'selected', 'onSelect'] },

          // Actions
          { name: 'Button', category: 'form', description: 'Action button', props: ['variant', 'tone', 'size', 'textAlign', 'fullWidth', 'loading', 'disabled', 'onClick'] },
          { name: 'ButtonGroup', category: 'form', description: 'Group of buttons', props: ['segmented', 'fullWidth', 'variant'] },

          // Form
          { name: 'TextField', category: 'form', description: 'Text input field', props: ['label', 'value', 'onChange', 'error', 'helpText', 'placeholder', 'disabled', 'readOnly'] },
          { name: 'Select', category: 'form', description: 'Select dropdown', props: ['label', 'options', 'value', 'onChange', 'error', 'helpText', 'placeholder', 'disabled'] },
          { name: 'Checkbox', category: 'form', description: 'Checkbox input', props: ['label', 'checked', 'onChange', 'error', 'helpText', 'disabled'] },
          { name: 'RadioButton', category: 'form', description: 'Radio button input', props: ['label', 'checked', 'onChange', 'disabled'] },
          { name: 'ChoiceList', category: 'form', description: 'List of choices', props: ['title', 'choices', 'selected', 'onChange', 'allowMultiple'] },
          { name: 'Form', category: 'form', description: 'Form container', props: ['onSubmit', 'noValidate'] },
          { name: 'FormLayout', category: 'form', description: 'Form layout helper', props: ['children'] },

          // Data Display
          { name: 'Text', category: 'content', description: 'Text component', props: ['variant', 'as', 'alignment', 'tone', 'textDecorationLine'] },
          { name: 'List', category: 'content', description: 'List component', props: ['type', 'gap'] },
          { name: 'DescriptionList', category: 'content', description: 'Description list', props: ['items', 'spacing'] },
          { name: 'DataTable', category: 'content', description: 'Data table', props: ['columnContentTypes', 'headings', 'rows', 'sortable'] },
          { name: 'IndexTable', category: 'content', description: 'Index table for resources', props: ['resourceName', 'itemCount', 'headings', 'selectable'] },
          { name: 'Badge', category: 'content', description: 'Status badge', props: ['tone', 'progress', 'size'] },
          { name: 'ProgressBar', category: 'content', description: 'Progress indicator', props: ['progress', 'size', 'tone'] },
          { name: 'Thumbnail', category: 'content', description: 'Image thumbnail', props: ['source', 'alt', 'size'] },
          { name: 'Avatar', category: 'content', description: 'User avatar', props: ['customer', 'size', 'name', 'initials', 'source'] },

          // Feedback
          { name: 'Banner', category: 'feedback', description: 'Notification banner', props: ['title', 'tone', 'onDismiss', 'action'] },
          { name: 'Modal', category: 'feedback', description: 'Modal dialog', props: ['open', 'onClose', 'title', 'primaryAction', 'secondaryActions'] },
          { name: 'Toast', category: 'feedback', description: 'Toast notification', props: ['content', 'error', 'onDismiss', 'duration'] },
          { name: 'Tooltip', category: 'feedback', description: 'Tooltip component', props: ['content', 'preferredPosition', 'active'] },
          { name: 'Popover', category: 'feedback', description: 'Popover component', props: ['active', 'activator', 'onClose', 'preferredAlignment'] },
          { name: 'Loading', category: 'feedback', description: 'Loading indicator', props: ['size'] },

          // Utilities
          { name: 'EmptyState', category: 'content', description: 'Empty state illustration', props: ['heading', 'action', 'secondaryAction', 'image'] },
          { name: 'SkeletonPage', category: 'content', description: 'Page skeleton loader', props: ['title', 'breadcrumbs', 'primaryAction'] },
          { name: 'SkeletonBodyText', category: 'content', description: 'Body text skeleton', props: ['lines'] },
          { name: 'SkeletonDisplayText', category: 'content', description: 'Display text skeleton', props: ['size'] }
        ];

    }

    return components;
  }

  /**
   * Discover components from local files
   */
  private async discoverFromLocalFiles(source: ComponentSource): Promise<void> {
    if (!fs.existsSync(source.path)) {
      return;
    }

    const files = this.findComponentFiles(source.path, source.patterns || ['*.tsx', '*.jsx']);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const componentName = this.extractComponentName(file, content);

      if (componentName && !this.discoveredComponents.has(componentName)) {
        // Skip Story UI components
        if (componentName === 'StoryUIPanel' || componentName.startsWith('StoryUI')) {
          continue;
        }

        const props = this.extractPropsFromFile(content);

        this.discoveredComponents.set(componentName, {
          name: componentName,
          filePath: file,
          props,
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
  private extractComponentName(filePath: string, content: string): string | null {
    // Try to extract from export statements
    const exportMatch = content.match(/export\s+(default\s+)?(function|const|class)\s+([A-Z][A-Za-z0-9]*)/);
    if (exportMatch) {
      return exportMatch[3];
    }

    // Try to extract from file name
    const fileName = path.basename(filePath, path.extname(filePath));
    if (fileName !== 'index' && /^[A-Z]/.test(fileName)) {
      return fileName;
    }

    return null;
  }

  /**
   * Extract props from file content
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

    return props;
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
