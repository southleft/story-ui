// Visual Builder exports
export { VisualBuilder } from './components/VisualBuilder';
export { EmbeddedVisualBuilder } from './components/EmbeddedVisualBuilder';
export { useVisualBuilderStore } from './store/visualBuilderStore';
export { getComponentConfig, getComponentsByCategory, MANTINE_COMPONENTS } from './config/componentRegistry';
export { parseAIGeneratedCode, createBasicLayout } from './utils/aiParser';
export type { 
  ComponentDefinition, 
  BuilderState, 
  SelectedComponent,
  PropertyDefinition,
  VisualBuilderComponentConfig
} from './types';
export type { ParseResult } from './utils/aiParser';