import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';
import { logger } from './logger.js';
export interface DesignSystemInfo {
  name: string;
  type: 'chakra-ui' | 'antd' | 'mantine' | 'shadcn' | 'generic';
  scope?: string;
  primaryPackage: string;
  commonComponents: string[];
  layoutComponents: string[];
  formComponents: string[];
  importPatterns: {
    default: string[];
    named: string[];
  };
  designTokens?: {
    spacing?: string;
    colors?: string;
    typography?: string;
  };
  /** For shadcn/ui: parsed components.json configuration */
  shadcnConfig?: {
    style?: string;
    aliases?: {
      components?: string;
      utils?: string;
      ui?: string;
    };
    tailwind?: {
      cssVariables?: boolean;
      baseColor?: string;
    };
  };
}

/**
 * Universal adapter to make Story UI work with any React design system
 */
export class UniversalDesignSystemAdapter {
  private projectRoot: string;
  private detectedSystems: DesignSystemInfo[] = [];

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Auto-detect which design systems are available in the project
   */
  async detectDesignSystems(): Promise<DesignSystemInfo[]> {
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
      logger.log('📦 No package.json found for design system detection');
      return [];
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies
    };

    this.detectedSystems = [];

    // Check for known design systems
    this.checkForShadcn(allDeps);
    this.checkForChakraUI(allDeps);
    this.checkForAntDesign(allDeps);
    this.checkForMantine(allDeps);
    this.checkForGenericReactComponents(allDeps);

    logger.log(`🎨 Detected ${this.detectedSystems.length} design systems:`, 
                this.detectedSystems.map(ds => ds.name));

    return this.detectedSystems;
  }

  /**
   * Generate optimal Story UI config for detected design systems
   */
  generateOptimalConfig(): Partial<StoryUIConfig> {
    const primarySystem = this.getPrimaryDesignSystem();
    
    if (!primarySystem) {
      return this.getGenericReactConfig();
    }

    switch (primarySystem.type) {
      case 'shadcn':
        return this.getShadcnConfig(primarySystem);
      case 'chakra-ui':
        return this.getChakraUIConfig();
      case 'antd':
        return this.getAntDesignConfig();
      case 'mantine':
        return this.getMantineConfig();
      default:
        return this.getGenericReactConfig();
    }
  }

  // Design system detection methods

  /**
   * Detect shadcn/ui by checking for components.json config file
   * and common shadcn dependencies (class-variance-authority, tailwind-merge, etc.)
   */
  private checkForShadcn(deps: Record<string, string>): void {
    const componentsJsonPath = path.join(this.projectRoot, 'components.json');
    const hasShadcnConfig = fs.existsSync(componentsJsonPath);

    // Check for common shadcn/ui dependencies
    const shadcnIndicators = [
      'class-variance-authority',
      'tailwind-merge',
      'clsx',
      '@radix-ui/react-slot',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      'lucide-react'
    ];

    const foundIndicators = shadcnIndicators.filter(pkg => deps[pkg]);
    const hasStrongIndicators = foundIndicators.length >= 3;

    if (hasShadcnConfig || hasStrongIndicators) {
      let shadcnConfig: DesignSystemInfo['shadcnConfig'] = undefined;
      let componentPath = '@/components/ui';
      let utilsPath = '@/lib/utils';

      // Parse components.json if it exists
      if (hasShadcnConfig) {
        try {
          const configContent = fs.readFileSync(componentsJsonPath, 'utf-8');
          const config = JSON.parse(configContent);

          shadcnConfig = {
            style: config.style,
            aliases: config.aliases,
            tailwind: config.tailwind ? {
              cssVariables: config.tailwind.cssVariables,
              baseColor: config.tailwind.baseColor
            } : undefined
          };

          // Use configured paths
          componentPath = config.aliases?.ui || config.aliases?.components || '@/components/ui';
          utilsPath = config.aliases?.utils || '@/lib/utils';

          logger.log(`📦 Found shadcn/ui config: style=${config.style}, components=${componentPath}`);
        } catch (error) {
          logger.log('⚠️ Could not parse components.json, using defaults');
        }
      }

      // Scan for actual shadcn components in the project
      const discoveredComponents = this.discoverShadcnComponents();

      this.detectedSystems.push({
        name: 'shadcn/ui',
        type: 'shadcn',
        primaryPackage: componentPath,
        commonComponents: discoveredComponents.length > 0
          ? discoveredComponents
          : ['Button', 'Card', 'Input', 'Dialog', 'Select', 'Checkbox', 'Label', 'Badge'],
        layoutComponents: ['Card', 'Separator', 'Sheet', 'Tabs'],
        formComponents: ['Input', 'Button', 'Select', 'Checkbox', 'RadioGroup', 'Switch', 'Textarea', 'Label'],
        importPatterns: {
          default: [],
          named: ['cn'] // utility function
        },
        shadcnConfig
      });

      logger.log(`✨ Detected shadcn/ui with ${discoveredComponents.length || 'default'} components`);
    }
  }

  /**
   * Discover which shadcn components are actually installed in the project
   */
  private discoverShadcnComponents(): string[] {
    const components: string[] = [];

    // Common paths where shadcn components might be located
    const possiblePaths = [
      path.join(this.projectRoot, 'components', 'ui'),
      path.join(this.projectRoot, 'src', 'components', 'ui'),
      path.join(this.projectRoot, 'app', 'components', 'ui'),
    ];

    for (const uiPath of possiblePaths) {
      if (fs.existsSync(uiPath)) {
        try {
          const files = fs.readdirSync(uiPath);
          for (const file of files) {
            // Extract component name from file (button.tsx -> Button)
            const match = file.match(/^([a-z-]+)\.(tsx|ts|jsx|js)$/i);
            if (match) {
              // Convert kebab-case to PascalCase (e.g., date-picker -> DatePicker)
              const componentName = match[1]
                .split('-')
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');
              components.push(componentName);
            }
          }
          if (components.length > 0) {
            logger.log(`📁 Found ${components.length} shadcn components in ${uiPath}`);
            break;
          }
        } catch (error) {
          // Continue checking other paths
        }
      }
    }

    return components;
  }

  private checkForChakraUI(deps: Record<string, string>): void {
    if (deps['@chakra-ui/react']) {
      this.detectedSystems.push({
        name: 'Chakra UI',
        type: 'chakra-ui',
        scope: '@chakra-ui',
        primaryPackage: '@chakra-ui/react',
        commonComponents: ['Box', 'Flex', 'Grid', 'Stack', 'Text', 'Heading', 'Button', 'Input'],
        layoutComponents: ['Box', 'Flex', 'Grid', 'Stack', 'HStack', 'VStack'],
        formComponents: ['Input', 'Button', 'Select', 'Checkbox', 'Radio'],
        importPatterns: {
          default: [],
          named: ['Box', 'Flex', 'Grid', 'Stack', 'Text', 'Heading', 'Button', 'Input']
        },
        designTokens: {
          spacing: 'spacing.*',
          colors: 'colors.*'
        }
      });
    }
  }

  private checkForAntDesign(deps: Record<string, string>): void {
    if (deps['antd']) {
      this.detectedSystems.push({
        name: 'Ant Design',
        type: 'antd',
        primaryPackage: 'antd',
        commonComponents: ['Layout', 'Row', 'Col', 'Space', 'Typography', 'Button', 'Input'],
        layoutComponents: ['Layout', 'Row', 'Col', 'Space'],
        formComponents: ['Input', 'Button', 'Select', 'Checkbox', 'Radio'],
        importPatterns: {
          default: [],
          named: ['Layout', 'Row', 'Col', 'Space', 'Typography', 'Button', 'Input']
        }
      });
    }
  }


  private checkForMantine(deps: Record<string, string>): void {
    if (deps['@mantine/core']) {
      this.detectedSystems.push({
        name: 'Mantine',
        type: 'mantine',
        scope: '@mantine',
        primaryPackage: '@mantine/core',
        commonComponents: ['Box', 'Flex', 'Grid', 'Stack', 'Text', 'Title', 'Button', 'TextInput'],
        layoutComponents: ['Box', 'Flex', 'Grid', 'Stack'],
        formComponents: ['TextInput', 'Button', 'Select', 'Checkbox', 'Radio'],
        importPatterns: {
          default: [],
          named: ['Box', 'Flex', 'Grid', 'Stack', 'Text', 'Title', 'Button', 'TextInput']
        }
      });
    }
  }


  private checkForGenericReactComponents(deps: Record<string, string>): void {
    // Check for generic React component libraries
    const genericLibraries = [
      'react-bootstrap',
      'semantic-ui-react',
      'rebass',
      'theme-ui',
      'styled-components',
      '@emotion/react'
    ];

    const foundGeneric = genericLibraries.filter(lib => deps[lib]);
    
    if (foundGeneric.length > 0) {
      this.detectedSystems.push({
        name: 'Generic React Components',
        type: 'generic',
        primaryPackage: foundGeneric[0],
        commonComponents: ['div', 'span', 'button', 'input', 'form'],
        layoutComponents: ['div', 'section', 'main'],
        formComponents: ['input', 'button', 'select', 'textarea'],
        importPatterns: {
          default: [],
          named: []
        }
      });
    }
  }

  // Configuration generators
  private getPrimaryDesignSystem(): DesignSystemInfo | null {
    // Prioritize based on completeness and popularity
    // shadcn first since it's explicitly configured in the project
    const priorities = ['shadcn', 'chakra-ui', 'antd', 'mantine', 'generic'];
    
    for (const priority of priorities) {
      const system = this.detectedSystems.find(ds => ds.type === priority);
      if (system) return system;
    }
    
    return this.detectedSystems[0] || null;
  }

  private getShadcnConfig(system: DesignSystemInfo): Partial<StoryUIConfig> {
    const componentPath = system.primaryPackage || '@/components/ui';
    const utilsPath = system.shadcnConfig?.aliases?.utils || '@/lib/utils';

    return {
      designSystemGuidelines: {
        name: "shadcn/ui",
        preferredComponents: {
          layout: componentPath,
          buttons: componentPath,
          forms: componentPath
        },
        // shadcn-specific guidelines for AI generation
        additionalNotes: `
shadcn/ui components are locally installed in the project.
- Import components from "${componentPath}" (e.g., import { Button } from "${componentPath}/button")
- Use the cn() utility from "${utilsPath}" for conditional classes
- Components use Tailwind CSS for styling
- Use CSS variables for theming (--primary, --secondary, --muted, etc.)
- Prefer composition over configuration
        `.trim()
      },
      layoutRules: {
        multiColumnWrapper: "div",
        columnComponent: "div",
        containerComponent: "div"
      }
    };
  }

  private getChakraUIConfig(): Partial<StoryUIConfig> {
    return {
      designSystemGuidelines: {
        name: "Chakra UI",
        preferredComponents: {
          layout: "@chakra-ui/react",
          buttons: "@chakra-ui/react",
          forms: "@chakra-ui/react"
        }
      },
      layoutRules: {
        multiColumnWrapper: "Grid",
        columnComponent: "Box",
        containerComponent: "Container"
      }
    };
  }

  private getAntDesignConfig(): Partial<StoryUIConfig> {
    return {
      designSystemGuidelines: {
        name: "Ant Design",
        preferredComponents: {
          layout: "antd",
          buttons: "antd",
          forms: "antd"
        }
      },
      layoutRules: {
        multiColumnWrapper: "Row",
        columnComponent: "Col",
        containerComponent: "Layout"
      }
    };
  }

  private getMantineConfig(): Partial<StoryUIConfig> {
    return {
      designSystemGuidelines: {
        name: "Mantine",
        preferredComponents: {
          layout: "@mantine/core",
          buttons: "@mantine/core",
          forms: "@mantine/core"
        }
      }
    };
  }


  private getGenericReactConfig(): Partial<StoryUIConfig> {
    return {
      designSystemGuidelines: {
        name: "Generic React",
        preferredComponents: {
          layout: "react",
          buttons: "react",
          forms: "react"
        }
      },
      layoutRules: {
        multiColumnWrapper: "div",
        columnComponent: "div",
        containerComponent: "div"
      }
    };
  }
}