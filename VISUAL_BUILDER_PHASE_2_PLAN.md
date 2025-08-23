# Visual Builder Phase 2: Design System Agnostic Architecture

## Executive Summary

This document outlines the comprehensive plan for evolving Story UI's Visual Builder from a Mantine-specific implementation to a design system agnostic tool that works with any component library. The plan leverages existing Story UI MCP discovery functionality rather than recreating component discovery from scratch.

**Key Decision**: Leverage existing MCP discovery endpoints (`/mcp/components` and `/mcp/props`) instead of building new discovery mechanisms.

**Current State**: Visual Builder UI built with Mantine, generates Mantine-specific code.

**Target State**: Visual Builder UI remains consistent (Mantine), but generates code for any design system.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Implementation Phases](#implementation-phases)
3. [Technical Architecture](#technical-architecture)
4. [UX/UI Enhancements](#uxui-enhancements)
5. [Migration Strategy](#migration-strategy)
6. [Risk Assessment](#risk-assessment)
7. [Success Metrics](#success-metrics)
8. [Appendix](#appendix)

## Architecture Overview

### Core Architectural Principles

1. **Separation of Concerns**: Visual Builder UI (Mantine) completely separate from target design system
2. **Discovery over Configuration**: Use MCP discovery instead of hardcoded component lists
3. **Progressive Enhancement**: Start with MVP, enhance iteratively
4. **Consistency**: Visual Builder looks and works the same regardless of target design system

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Visual Builder (UI Layer)                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │   Component     │  │   Property      │  │   Canvas    │ │
│  │   Palette       │  │   Editor        │  │             │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Component Abstraction Layer                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │  UI Components  │  │   Discovery     │  │  Code Gen   │ │
│  │  (Mantine)      │  │   Service       │  │  Service    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                MCP Discovery Layer                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ /mcp/components │  │   /mcp/props    │  │   Config    │ │
│  │                 │  │                 │  │   Loader    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Target Design System                           │
│        (Mantine, Material UI, Chakra UI, etc.)             │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
**Goal**: Create abstraction layer and discovery interfaces

#### Tasks:
- [ ] Create `ComponentDiscoveryService` interface
- [ ] Implement `useComponentDiscovery` hook
- [ ] Create design system adapter pattern
- [ ] Set up caching mechanism for discovered components
- [ ] Create abstraction between Visual Builder UI and generated code

#### Deliverables:
- Component discovery TypeScript interfaces
- Basic MCP client in Visual Builder
- Abstraction layer documentation

### Phase 2: MCP Enhancement (Weeks 3-4)
**Goal**: Enhance existing MCP endpoints for Visual Builder needs

#### Tasks:
- [ ] Enhance `/mcp/components` endpoint with Visual Builder metadata
- [ ] Enhance `/mcp/props` endpoint with property type information
- [ ] Add design token discovery (colors, spacing, typography)
- [ ] Implement component category detection
- [ ] Add caching layer for performance

#### Deliverables:
- Enhanced MCP endpoints
- Component metadata format specification
- Performance benchmarks

### Phase 3: Dynamic Discovery (Weeks 5-6)
**Goal**: Replace hardcoded components with dynamic discovery

#### Tasks:
- [ ] Replace static `MANTINE_COMPONENTS` registry
- [ ] Implement dynamic component palette population
- [ ] Create property editor that adapts to discovered props
- [ ] Add component search and filtering
- [ ] Implement fallback for undiscovered components

#### Deliverables:
- Dynamic component palette
- Adaptive property editor
- Component discovery documentation

### Phase 4: Code Generation (Weeks 7-8)
**Goal**: Generate correct code for any design system

#### Tasks:
- [ ] Update import generation to use `story-ui.config.js`
- [ ] Create design system specific code patterns
- [ ] Handle component prop mapping between systems
- [ ] Add validation for generated code
- [ ] Implement preview mode for generated code

#### Deliverables:
- Design system agnostic code generator
- Code validation system
- Generated code examples for multiple design systems

### Phase 5: UI/UX Polish (Weeks 9-10)
**Goal**: Professional user experience enhancements

#### Tasks:
- [ ] Implement smart component suggestions
- [ ] Add keyboard shortcuts and power user features
- [ ] Create onboarding tutorial system
- [ ] Add template library
- [ ] Implement undo/redo with visual timeline

#### Deliverables:
- Enhanced Visual Builder UI
- User onboarding flow
- Template library system

### Phase 6: Testing & Documentation (Weeks 11-12)
**Goal**: Comprehensive testing and documentation

#### Tasks:
- [ ] Test with multiple design systems (Material UI, Chakra, Ant Design)
- [ ] Create migration guide for existing users
- [ ] Write API documentation
- [ ] Create video tutorials
- [ ] Performance optimization and testing

#### Deliverables:
- Test suite for multiple design systems
- Complete documentation
- Performance benchmarks
- Tutorial videos

## Technical Architecture

### Component Discovery Service

```typescript
// visual-builder/services/ComponentDiscoveryService.ts
export interface ComponentDiscoveryService {
  // Discover all available components from target design system
  discoverComponents(): Promise<DiscoveredComponent[]>;
  
  // Get properties for a specific component
  discoverProperties(componentName: string): Promise<PropertyDefinition[]>;
  
  // Get design tokens (colors, spacing, etc.)
  getDesignTokens(): Promise<DesignTokens>;
  
  // Get component categories
  getCategories(): Promise<ComponentCategory[]>;
}

// visual-builder/types/DiscoveredComponent.ts
export interface DiscoveredComponent {
  name: string;                    // Component name in design system
  displayName: string;              // Human-readable name
  category: ComponentCategory;      // Layout, Input, Display, etc.
  importPath: string;              // Where to import from
  properties: PropertyDefinition[]; // Available props
  defaultProps: Record<string, any>; // Default prop values
  description?: string;            // Component description
  examples?: ComponentExample[];   // Usage examples
}

// visual-builder/types/PropertyDefinition.ts
export interface PropertyDefinition {
  name: string;                    // Prop name
  type: PropertyType;              // string, number, boolean, enum, etc.
  required: boolean;               // Is prop required?
  defaultValue?: any;              // Default value
  options?: any[];                 // For enum types
  description?: string;            // Prop description
  category?: string;               // Appearance, Behavior, Layout
}
```

### Code Generation Service

```typescript
// visual-builder/services/CodeGenerationService.ts
export class CodeGenerationService {
  private config: StoryUIConfig;
  
  constructor(config: StoryUIConfig) {
    this.config = config;
  }
  
  // Generate import statements for used components
  generateImports(components: VBComponent[]): string {
    const uniqueComponents = this.extractUniqueComponents(components);
    const { importPath, namedImports } = this.getImportConfig();
    
    if (namedImports) {
      return `import { ${uniqueComponents.join(', ')} } from '${importPath}';`;
    } else {
      // Handle default imports or namespace imports
      return this.generateNamespaceImports(uniqueComponents, importPath);
    }
  }
  
  // Generate JSX code for components
  generateJSX(components: VBComponent[]): string {
    return components.map(component => 
      this.generateComponentJSX(component)
    ).join('\n');
  }
  
  // Transform Visual Builder component to target design system JSX
  private generateComponentJSX(component: VBComponent): string {
    const { name, props, children } = component;
    const mappedName = this.mapComponentName(name);
    const mappedProps = this.mapComponentProps(name, props);
    
    if (children && children.length > 0) {
      return `<${mappedName}${this.propsToString(mappedProps)}>
        ${this.generateJSX(children)}
      </${mappedName}>`;
    } else {
      return `<${mappedName}${this.propsToString(mappedProps)} />`;
    }
  }
}
```

### MCP Integration

```typescript
// visual-builder/hooks/useComponentDiscovery.ts
export function useComponentDiscovery() {
  const [components, setComponents] = useState<DiscoveredComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    const discover = async () => {
      try {
        // Use existing MCP discovery endpoint
        const response = await fetch('http://localhost:4001/mcp/components');
        const data = await response.json();
        
        // Transform MCP format to Visual Builder format
        const vbComponents = data.components.map(transformToVBFormat);
        setComponents(vbComponents);
      } catch (err) {
        setError(err as Error);
        // Fallback to default components if discovery fails
        setComponents(getDefaultComponents());
      } finally {
        setLoading(false);
      }
    };
    
    discover();
  }, []);
  
  return { components, loading, error };
}

// visual-builder/hooks/useComponentProperties.ts
export function useComponentProperties(componentName: string) {
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    if (!componentName) return;
    
    const fetchProperties = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `http://localhost:4001/mcp/props?component=${componentName}`
        );
        const data = await response.json();
        setProperties(data.properties);
      } catch (err) {
        console.error('Failed to fetch properties:', err);
        setProperties(getDefaultProperties(componentName));
      } finally {
        setLoading(false);
      }
    };
    
    fetchProperties();
  }, [componentName]);
  
  return { properties, loading };
}
```

## UX/UI Enhancements

### Component Palette Improvements

```typescript
interface EnhancedComponentPalette {
  // Smart categorization
  categories: {
    frequently_used: Component[];     // Based on usage analytics
    recently_added: Component[];      // New to the design system
    recommended: Component[];         // Context-aware suggestions
    all: ComponentsByCategory;       // Full categorized list
  };
  
  // Advanced search
  search: {
    query: string;
    filters: {
      category?: string;
      complexity?: 'simple' | 'moderate' | 'complex';
      hasChildren?: boolean;
      responsive?: boolean;
    };
    fuzzyMatch: boolean;             // Enable fuzzy search
    searchInDescription: boolean;    // Search component descriptions
  };
  
  // Visual enhancements
  display: {
    view: 'grid' | 'list' | 'compact';
    showPreview: boolean;            // Show component preview on hover
    showDescription: boolean;        // Show component description
    groupByCategory: boolean;        // Group by category
  };
}
```

### Canvas Enhancements

```typescript
interface EnhancedCanvas {
  // Layout assistance
  layout: {
    gridSize: number;                // Snap grid size
    showGrid: boolean;               // Display grid
    smartGuides: boolean;            // Show alignment guides
    magneticSnap: boolean;           // Magnetic alignment
  };
  
  // Interaction modes
  modes: {
    design: CanvasMode;              // Normal design mode
    preview: CanvasMode;             // Preview generated code
    responsive: CanvasMode;          // Test responsive behavior
    accessibility: CanvasMode;       // Check accessibility
  };
  
  // Visual feedback
  feedback: {
    dropZones: boolean;              // Highlight valid drop zones
    componentOutlines: boolean;      // Show component boundaries
    paddingVisualization: boolean;   // Visualize padding/margins
    performanceHints: boolean;       // Show performance warnings
  };
}
```

### Property Editor Enhancements

```typescript
interface EnhancedPropertyEditor {
  // Property organization
  organization: {
    mode: 'categories' | 'alphabetical' | 'frequency' | 'custom';
    categories: PropertyCategory[];
    pinnedProperties: string[];      // Always show these first
    collapsedSections: string[];     // Remember collapsed state
  };
  
  // Property controls
  controls: {
    colorPicker: EnhancedColorPicker;
    spacingControls: SpacingControls;
    typographyControls: TypographyControls;
    responsive: ResponsiveControls;
  };
  
  // Validation and help
  assistance: {
    validation: PropertyValidation[];
    suggestions: PropertySuggestion[];
    documentation: PropertyDocumentation;
    examples: PropertyExample[];
  };
}
```

## Migration Strategy

### For Existing Users

1. **Backward Compatibility**: Keep existing Mantine-specific features working
2. **Gradual Migration**: Allow users to opt-in to new discovery system
3. **Migration Tools**: Provide tools to convert existing Visual Builder saves
4. **Documentation**: Clear migration guide with examples

### Migration Steps

```bash
# Step 1: Update Story UI
npm update @tpitre/story-ui@next

# Step 2: Run migration script
npx story-ui migrate-visual-builder

# Step 3: Update configuration
npx story-ui config --enable-discovery

# Step 4: Test with existing stories
npm run test:visual-builder
```

### Configuration Changes

```javascript
// story-ui.config.js - Before
export default {
  importPath: '@mantine/core',
  componentsPath: './src/components',
  generatedStoriesPath: './src/stories/generated',
};

// story-ui.config.js - After
export default {
  importPath: '@mantine/core',
  componentsPath: './src/components',
  generatedStoriesPath: './src/stories/generated',
  
  // New Visual Builder configuration
  visualBuilder: {
    discovery: {
      enabled: true,                  // Enable MCP discovery
      strategy: 'dynamic',            // 'static' | 'dynamic' | 'hybrid'
      cacheTimeout: 300000,          // 5 minutes
    },
    
    // Component mapping for design system
    componentMapping: {
      // Map generic names to design system specific
      'Button': 'Button',
      'Card': 'Card',
      'Input': 'TextInput',          // Mantine-specific mapping
    },
    
    // Design tokens
    tokens: {
      useSystemTokens: true,         // Use design system tokens
      customTokens: {},              // Override with custom tokens
    },
  },
};
```

## Risk Assessment

### Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| MCP discovery fails | High | Low | Fallback to static components |
| Performance degradation | Medium | Medium | Implement caching layer |
| Breaking changes | High | Low | Comprehensive test suite |
| Browser compatibility | Medium | Low | Progressive enhancement |

### Business Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| User adoption | High | Medium | Clear documentation and tutorials |
| Support burden | Medium | Medium | Comprehensive FAQ and examples |
| Competitor features | Low | Low | Focus on unique MCP integration |

### Mitigation Strategies

1. **Phased Rollout**: Release to beta users first
2. **Feature Flags**: Allow enabling/disabling new features
3. **Monitoring**: Track usage and error rates
4. **Rollback Plan**: Keep previous version available

## Success Metrics

### Technical Metrics

- **Discovery Performance**: < 500ms to discover all components
- **Code Generation Accuracy**: > 95% valid generated code
- **Browser Compatibility**: Works in Chrome, Firefox, Safari, Edge
- **Bundle Size Impact**: < 200KB additional for Visual Builder

### User Metrics

- **Adoption Rate**: > 50% of Story UI users try Visual Builder
- **Retention Rate**: > 30% use Visual Builder weekly
- **Error Rate**: < 1% of sessions encounter errors
- **Support Tickets**: < 5% increase in support burden

### Business Metrics

- **Feature Completion**: 100% of planned features delivered
- **Timeline Adherence**: Delivered within 12-week timeline
- **Budget Compliance**: Within 10% of estimated budget
- **User Satisfaction**: > 4.0/5.0 rating

## Appendix

### A. Design System Support Matrix

| Design System | Version | Support Level | Notes |
|--------------|---------|---------------|-------|
| Mantine | 7.x | Full | Native support |
| Material UI | 5.x | Full | Planned for Phase 4 |
| Chakra UI | 2.x | Full | Planned for Phase 4 |
| Ant Design | 5.x | Partial | Basic components only |
| Tailwind UI | - | Experimental | Requires custom adapter |

### B. Component Mapping Examples

```typescript
// Mantine to Material UI mapping
const mantineToMUI = {
  'TextInput': 'TextField',
  'Select': 'Select',
  'Button': 'Button',
  'Card': 'Card',
  'Stack': 'Stack',
  'Group': 'Box', // with display: flex
  'Text': 'Typography',
  'Title': 'Typography', // with variant
};

// Mantine to Chakra UI mapping
const mantineToChakra = {
  'TextInput': 'Input',
  'Select': 'Select',
  'Button': 'Button',
  'Card': 'Box', // with styling
  'Stack': 'VStack',
  'Group': 'HStack',
  'Text': 'Text',
  'Title': 'Heading',
};
```

### C. API Endpoints

```typescript
// Enhanced MCP endpoints for Visual Builder
interface MCPEndpoints {
  // Component discovery
  'GET /mcp/components': {
    response: {
      components: DiscoveredComponent[];
      categories: ComponentCategory[];
      total: number;
    };
  };
  
  // Property discovery
  'GET /mcp/props': {
    params: {
      component: string;
    };
    response: {
      properties: PropertyDefinition[];
      required: string[];
      defaults: Record<string, any>;
    };
  };
  
  // Design tokens
  'GET /mcp/tokens': {
    response: {
      colors: ColorToken[];
      spacing: SpacingToken[];
      typography: TypographyToken[];
      shadows: ShadowToken[];
    };
  };
  
  // Component preview
  'POST /mcp/preview': {
    body: {
      component: VBComponent;
      theme?: ThemeConfig;
    };
    response: {
      html: string;
      css: string;
      assets: Asset[];
    };
  };
}
```

### D. References

- [Story UI Documentation](https://story-ui.dev)
- [MCP Protocol Specification](https://mcp.dev)
- [Visual Builder Design Patterns](https://patterns.story-ui.dev)
- [Component Discovery Best Practices](https://discovery.story-ui.dev)

---

## Next Steps

1. **Review and Approval**: Review this plan with stakeholders
2. **Resource Allocation**: Assign team members to phases
3. **Environment Setup**: Prepare development environments
4. **Kickoff Meeting**: Align team on goals and timeline
5. **Phase 1 Start**: Begin foundation work

## Document Version

- **Version**: 1.0.0
- **Date**: November 23, 2024
- **Authors**: Story UI Team + Claude
- **Status**: Draft - Pending Review

## Contact

For questions or clarifications about this plan:
- **GitHub Issues**: https://github.com/story-ui/visual-builder
- **Discord**: https://discord.gg/story-ui
- **Email**: visual-builder@story-ui.dev

---

*This document represents the current understanding and plan for Visual Builder Phase 2. It will be updated as development progresses and new insights are gained.*