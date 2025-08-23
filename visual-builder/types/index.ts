export interface ComponentDefinition {
  id: string;
  type: string;
  displayName: string;
  category: string;
  props: Record<string, any>;
  children?: ComponentDefinition[];
}

export interface SelectedComponent {
  id: string;
  type: string;
  props: Record<string, any>;
}

export interface BuilderState {
  components: ComponentDefinition[];
  selectedComponent: SelectedComponent | null;
  draggedComponent: ComponentDefinition | null;
  isCodeModalOpen: boolean;
  isImportedFromStory?: boolean;
}

export interface PropertyDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'select' | 'spacing';
  defaultValue?: any;
  options?: string[]; // for select type
  description?: string;
  category?: 'spacing' | 'appearance' | 'behavior' | 'content';
}

export interface VisualBuilderComponentConfig {
  type: string;
  displayName: string;
  category: string;
  defaultProps: Record<string, any>;
  properties: PropertyDefinition[];
}