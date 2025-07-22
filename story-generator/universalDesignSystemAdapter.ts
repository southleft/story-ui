import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';

export interface DesignSystemInfo {
  name: string;
  type: 'chakra-ui' | 'antd' | 'mantine' | 'generic';
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
      console.log('📦 No package.json found for design system detection');
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
    this.checkForChakraUI(allDeps);
    this.checkForAntDesign(allDeps);
    this.checkForMantine(allDeps);
    this.checkForGenericReactComponents(allDeps);

    console.log(`🎨 Detected ${this.detectedSystems.length} design systems:`, 
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
    const priorities = ['chakra-ui', 'antd', 'mantine', 'generic'];
    
    for (const priority of priorities) {
      const system = this.detectedSystems.find(ds => ds.type === priority);
      if (system) return system;
    }
    
    return this.detectedSystems[0] || null;
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