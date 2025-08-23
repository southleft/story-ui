import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { ComponentDefinition, SelectedComponent, BuilderState } from '../types';
import { 
  SavedStory, 
  saveStory as saveStoryToPersistence, 
  loadStory as loadStoryFromPersistence,
  AutoSave 
} from '../utils/storyPersistence';

interface VisualBuilderStore extends BuilderState {
  // Story state
  currentStoryId: string | null;
  currentStoryName: string;
  isDirty: boolean;
  autoSave: AutoSave | null;
  
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
  
  // Story persistence actions
  saveStory: (name?: string, description?: string) => SavedStory | null;
  saveAsNewStory: (name: string, description?: string) => SavedStory | null;
  newStory: () => void;
  setStoryName: (name: string) => void;
  markDirty: () => void;
  markClean: () => void;
  initAutoSave: () => void;
  destroyAutoSave: () => void;
}

export const useVisualBuilderStore = create<VisualBuilderStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      components: [],
      selectedComponent: null,
      draggedComponent: null,
      isCodeModalOpen: false,
      
      // Story state
      currentStoryId: null,
      currentStoryName: 'Untitled Story',
      isDirty: false,
      autoSave: null,

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
            return { components: updateComponents(state.components), isDirty: true };
          } else {
            // Add to root level
            return { components: [...state.components, newComponent], isDirty: true };
          }
        });
        
        // Trigger auto-save
        const { autoSave } = get();
        autoSave?.trigger();
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
            selectedComponent: state.selectedComponent?.id === id ? null : state.selectedComponent,
            isDirty: true
          };
        });
        
        // Trigger auto-save
        const { autoSave } = get();
        autoSave?.trigger();
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
          
          return { components: updateComponents(state.components), isDirty: true };
        });
        
        // Trigger auto-save
        const { autoSave } = get();
        autoSave?.trigger();
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
          selectedComponent: null,
          isDirty: true
        });
        
        // Trigger auto-save
        const { autoSave } = get();
        autoSave?.trigger();
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
              selectedComponent: null,
              isDirty: true
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
      },
      
      // Story persistence methods
      saveStory: (name, description) => {
        const state = get();
        
        // If it's an existing story (has currentStoryId), save directly without prompts
        if (state.currentStoryId) {
          const storyName = state.currentStoryName || 'Untitled Story';
          
          try {
            const savedStory = saveStoryToPersistence(
              storyName,
              state.components,
              description || undefined,
              state.currentStoryId
            );
            
            set({
              currentStoryId: savedStory.id,
              currentStoryName: savedStory.name,
              isDirty: false
            });
            
            return savedStory;
          } catch (error) {
            console.error('Failed to save story:', error);
            return null;
          }
        }
        
        // For new stories, use provided name or current name
        const storyName = name || state.currentStoryName || 'Untitled Story';
        
        try {
          const savedStory = saveStoryToPersistence(
            storyName,
            state.components,
            description
          );
          
          set({
            currentStoryId: savedStory.id,
            currentStoryName: savedStory.name,
            isDirty: false
          });
          
          return savedStory;
        } catch (error) {
          console.error('Failed to save story:', error);
          return null;
        }
      },
      
      saveAsNewStory: (name, description) => {
        const state = get();
        
        try {
          const savedStory = saveStoryToPersistence(
            name,
            state.components,
            description
          );
          
          set({
            currentStoryId: savedStory.id,
            currentStoryName: savedStory.name,
            isDirty: false
          });
          
          return savedStory;
        } catch (error) {
          console.error('Failed to save story:', error);
          return null;
        }
      },
      
      newStory: () => {
        set({
          components: [],
          currentStoryId: null,
          currentStoryName: 'Untitled Story',
          selectedComponent: null,
          isDirty: false
        });
      },
      
      setStoryName: (name) => {
        set({ 
          currentStoryName: name,
          isDirty: true
        });
        
        // Trigger auto-save
        const { autoSave } = get();
        autoSave?.trigger();
      },
      
      markDirty: () => {
        set({ isDirty: true });
      },
      
      markClean: () => {
        set({ isDirty: false });
      },
      
      initAutoSave: () => {
        const state = get();
        
        // Clean up existing auto-save if any
        state.autoSave?.cancel();
        
        const autoSave = new AutoSave(() => {
          const currentState = get();
          if (currentState.isDirty && currentState.components.length > 0) {
            currentState.saveStory();
          }
        }, 3000); // Auto-save after 3 seconds of inactivity
        
        set({ autoSave });
      },
      
      destroyAutoSave: () => {
        const state = get();
        state.autoSave?.cancel();
        set({ autoSave: null });
      }
    }),
    { name: 'visual-builder-store' }
  )
);