import fs from 'fs';
import path from 'path';
import { DiscoveredComponent } from './componentDiscovery.js';
import { StoryUIConfig } from '../story-ui.config.js';

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

  constructor(config: StoryUIConfig) {
    this.config = config;
  }

  /**
   * Discover components from all available sources
   */
  async discoverAll(): Promise<EnhancedComponent[]> {
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

    // Apply any manual configurations
    this.applyManualConfigurations();

    return Array.from(this.discoveredComponents.values());
  }

  /**
   * Identify all potential component sources
   */
  private identifySources(): ComponentSource[] {
    const sources: ComponentSource[] = [];

    // Check for npm packages
    if (this.config.importPath && !this.config.importPath.startsWith('.')) {
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
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
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
   * Discover components from npm packages
   */
  private async discoverFromNpmPackage(source: ComponentSource): Promise<void> {
    const packagePath = path.join(process.cwd(), 'node_modules', source.path);

    if (!fs.existsSync(packagePath)) {
      return;
    }

    // Read package.json to find entry points
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      // Try to find component exports
      const possiblePaths = [
        packageJson.main,
        packageJson.module,
        packageJson.exports?.['.'],
        'index.js',
        'index.ts',
        'lib/index.js',
        'dist/index.js',
        'es/index.js'
      ].filter(Boolean);

      // For known design systems, use predefined component lists
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
        return;
      }

      // Try dynamic import for modern packages
      for (const entryPath of possiblePaths) {
        const fullPath = path.join(packagePath, entryPath);
        if (fs.existsSync(fullPath)) {
          try {
            // This is where we'd ideally do dynamic import, but for safety
            // we'll rely on known patterns and TypeScript definitions
            console.log(`Found entry point: ${fullPath}`);
          } catch (error) {
            // Silent fail - will try other methods
          }
        }
      }
    }
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
}
