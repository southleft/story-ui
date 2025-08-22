import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { ComponentDefinition, SelectedComponent, BuilderState } from '../types';

interface VisualBuilderStore extends BuilderState {
  // Actions
  addComponent: (component: ComponentDefinition, targetId?: string) => void;
  removeComponent: (id: string) => void;
  updateComponent: (id: string, updates: Partial<ComponentDefinition>) => void;
  selectComponent: (component: SelectedComponent | null) => void;
  setDraggedComponent: (component: ComponentDefinition | null) => void;
  openCodeModal: () => void;
  closeCodeModal: () => void;
  clearCanvas: () => void;
  moveComponent: (activeId: string, overId: string) => void;
  loadFromAI: (components: ComponentDefinition[]) => void;
  loadFromCode: (code: string) => Promise<{ success: boolean; errors: string[]; warnings: string[] }>;
}

export const useVisualBuilderStore = create<VisualBuilderStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      components: [],
      selectedComponent: null,
      draggedComponent: null,
      isCodeModalOpen: false,

      // Actions
      addComponent: (component, targetId) => {
        set((state) => {
          const newComponent = { ...component, id: `${component.type}-${Date.now()}` };
          
          if (targetId) {
            // Add as child to target component
            const updateComponents = (components: ComponentDefinition[]): ComponentDefinition[] => {
              return components.map(comp => {
                if (comp.id === targetId) {
                  return {
                    ...comp,
                    children: [...(comp.children || []), newComponent]
                  };
                }
                if (comp.children) {
                  return {
                    ...comp,
                    children: updateComponents(comp.children)
                  };
                }
                return comp;
              });
            };
            return { components: updateComponents(state.components) };
          } else {
            // Add to root level
            return { components: [...state.components, newComponent] };
          }
        });
      },

      removeComponent: (id) => {
        set((state) => {
          const removeFromComponents = (components: ComponentDefinition[]): ComponentDefinition[] => {
            return components
              .filter(comp => comp.id !== id)
              .map(comp => ({
                ...comp,
                children: comp.children ? removeFromComponents(comp.children) : undefined
              }));
          };
          
          return {
            components: removeFromComponents(state.components),
            selectedComponent: state.selectedComponent?.id === id ? null : state.selectedComponent
          };
        });
      },

      updateComponent: (id, updates) => {
        set((state) => {
          const updateComponents = (components: ComponentDefinition[]): ComponentDefinition[] => {
            return components.map(comp => {
              if (comp.id === id) {
                return { ...comp, ...updates };
              }
              if (comp.children) {
                return {
                  ...comp,
                  children: updateComponents(comp.children)
                };
              }
              return comp;
            });
          };
          
          return { components: updateComponents(state.components) };
        });
      },

      selectComponent: (component) => {
        set({ selectedComponent: component });
      },

      setDraggedComponent: (component) => {
        set({ draggedComponent: component });
      },

      openCodeModal: () => {
        set({ isCodeModalOpen: true });
      },

      closeCodeModal: () => {
        set({ isCodeModalOpen: false });
      },

      clearCanvas: () => {
        set({ 
          components: [], 
          selectedComponent: null 
        });
      },

      moveComponent: (activeId, overId) => {
        set((state) => {
          const components = [...state.components];
          const activeIndex = components.findIndex(comp => comp.id === activeId);
          const overIndex = components.findIndex(comp => comp.id === overId);
          
          if (activeIndex !== -1 && overIndex !== -1) {
            const [removed] = components.splice(activeIndex, 1);
            components.splice(overIndex, 0, removed);
          }
          
          return { components };
        });
      },

      loadFromAI: (components) => {
        set({ 
          components, 
          selectedComponent: null 
        });
      },

      loadFromCode: async (code) => {
        try {
          const { parseAIGeneratedCode } = await import('../utils/aiParser');
          const result = parseAIGeneratedCode(code);
          
          if (result.errors.length === 0) {
            set({ 
              components: result.components, 
              selectedComponent: null 
            });
          }
          
          return {
            success: result.errors.length === 0,
            errors: result.errors,
            warnings: result.warnings
          };
        } catch (error) {
          return {
            success: false,
            errors: [`Failed to load parser: ${error instanceof Error ? error.message : 'Unknown error'}`],
            warnings: []
          };
        }
      }
    }),
    { name: 'visual-builder-store' }
  )
);