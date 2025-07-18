import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';

export interface DesignSystemInfo {
  name: string;
  type: 'material-ui' | 'chakra-ui' | 'antd' | 'atlaskit' | 'mantine' | 'nextui' | 'generic';
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
    this.checkForMaterialUI(allDeps);
    this.checkForChakraUI(allDeps);
    this.checkForAntDesign(allDeps);
    this.checkForAtlassian(allDeps);
    this.checkForMantine(allDeps);
    this.checkForNextUI(allDeps);
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
      case 'material-ui':
        return this.getMaterialUIConfig();
      case 'chakra-ui':
        return this.getChakraUIConfig();
      case 'antd':
        return this.getAntDesignConfig();
      case 'atlaskit':
        return this.getAtlassianConfig();
      case 'mantine':
        return this.getMantineConfig();
      case 'nextui':
        return this.getNextUIConfig();
      default:
        return this.getGenericReactConfig();
    }
  }

  // Design system detection methods
  private checkForMaterialUI(deps: Record<string, string>): void {
    if (deps['@mui/material'] || deps['@material-ui/core']) {
      this.detectedSystems.push({
        name: 'Material-UI',
        type: 'material-ui',
        scope: '@mui',
        primaryPackage: '@mui/material',
        commonComponents: ['Box', 'Container', 'Grid', 'Stack', 'Typography', 'Button', 'TextField'],
        layoutComponents: ['Box', 'Container', 'Grid', 'Stack'],
        formComponents: ['TextField', 'Button', 'Select', 'Checkbox', 'RadioGroup'],
        importPatterns: {
          default: [],
          named: ['Box', 'Container', 'Grid', 'Stack', 'Typography', 'Button', 'TextField']
        }
      });
    }
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

  private checkForAtlassian(deps: Record<string, string>): void {
    const atlaskitPackages = Object.keys(deps).filter(pkg => pkg.startsWith('@atlaskit/'));
    
    if (atlaskitPackages.length > 0) {
      this.detectedSystems.push({
        name: 'Atlassian Design System',
        type: 'atlaskit',
        scope: '@atlaskit',
        primaryPackage: '@atlaskit/primitives',
        commonComponents: ['Box', 'Flex', 'Grid', 'Text', 'Heading', 'Button', 'Textfield'],
        layoutComponents: ['Box', 'Flex', 'Grid', 'Stack'],
        formComponents: ['Textfield', 'Button', 'Select', 'Checkbox', 'Radio', 'Toggle'],
        importPatterns: {
          default: ['Button', 'Textfield', 'Heading'],
          named: ['Box', 'Flex', 'Grid', 'Text']
        },
        designTokens: {
          spacing: 'space.*',
          colors: 'color.*'
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

  private checkForNextUI(deps: Record<string, string>): void {
    if (deps['@nextui-org/react']) {
      this.detectedSystems.push({
        name: 'NextUI',
        type: 'nextui',
        scope: '@nextui-org',
        primaryPackage: '@nextui-org/react',
        commonComponents: ['Card', 'Button', 'Input', 'Link', 'Text', 'Spacer'],
        layoutComponents: ['Card', 'Container', 'Grid', 'Spacer'],
        formComponents: ['Input', 'Button', 'Select', 'Checkbox', 'Radio'],
        importPatterns: {
          default: [],
          named: ['Card', 'Button', 'Input', 'Link', 'Text', 'Spacer']
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
    const priorities = ['atlaskit', 'material-ui', 'chakra-ui', 'antd', 'mantine', 'nextui', 'generic'];
    
    for (const priority of priorities) {
      const system = this.detectedSystems.find(ds => ds.type === priority);
      if (system) return system;
    }
    
    return this.detectedSystems[0] || null;
  }

  private getAtlassianConfig(): Partial<StoryUIConfig> {
    return {
      designSystemGuidelines: {
        name: "Atlassian Design System",
        preferredComponents: {
          layout: "@atlaskit/primitives",
          buttons: "@atlaskit/button/new",
          forms: "@atlaskit/textfield"
        },
        spacingTokens: {
          prefix: "space.",
          values: ["025", "050", "075", "100", "150", "200", "300", "400", "500", "600", "800", "1000"]
        },
        colorTokens: {
          prefix: "color.",
          categories: ["text", "background", "border", "accent"]
        }
      },
      layoutRules: {
        multiColumnWrapper: "Grid",
        columnComponent: "Box",
        containerComponent: "Box",
        prohibitedElements: ["div", "span"]
      }
    };
  }

  private getMaterialUIConfig(): Partial<StoryUIConfig> {
    return {
      designSystemGuidelines: {
        name: "Material-UI",
        preferredComponents: {
          layout: "@mui/material",
          buttons: "@mui/material",
          forms: "@mui/material"
        }
      },
      layoutRules: {
        multiColumnWrapper: "Grid",
        columnComponent: "Grid",
        containerComponent: "Container"
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

  private getNextUIConfig(): Partial<StoryUIConfig> {
    return {
      designSystemGuidelines: {
        name: "NextUI",
        preferredComponents: {
          layout: "@nextui-org/react",
          buttons: "@nextui-org/react",
          forms: "@nextui-org/react"
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