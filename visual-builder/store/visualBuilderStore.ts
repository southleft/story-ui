import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ComponentDefinition, SelectedComponent, BuilderState } from '../types/index';
import { 
  removeComponentFromTree, 
  insertComponentInTree, 
  findComponentWithParent,
  isDescendant 
} from '../utils/componentTreeUtils';
import { saveStory, loadStory, type SavedStory, scheduleAutoSave, cancelAutoSave } from '../utils/storyPersistence';

interface VisualBuilderStore extends BuilderState {
  // Additional state
  isImportedFromStory: boolean; // Track if components came from story parsing
  // Story management state
  currentStoryId: string | null;
  currentStoryName: string;
  isDirty: boolean;
  // Actions
  addComponent: (component: ComponentDefinition, targetId?: string, insertIndex?: number) => void;
  removeComponent: (id: string) => void;
  updateComponent: (id: string, updates: Partial<ComponentDefinition>) => void;
  selectComponent: (component: SelectedComponent | null) => void;
  setDraggedComponent: (component: ComponentDefinition | null) => void;
  openCodeModal: () => void;
  closeCodeModal: () => void;
  clearCanvas: () => void;
  moveComponent: (activeId: string, overId: string, insertIndex?: number, insertPosition?: 'before' | 'after') => void;
  moveComponentBetweenContainers: (activeId: string, fromParentId: string | null, toParentId: string | null, insertIndex?: number) => void;
  loadFromAI: (components: ComponentDefinition[]) => void;
  loadFromCode: (code: string) => Promise<{ success: boolean; errors: string[]; warnings: string[] }>;
  importFromStoryUI: (storyCode: string) => Promise<{ success: boolean; errors: string[]; warnings: string[] }>;
  // Story management actions
  saveCurrentStory: (name?: string) => SavedStory;
  loadStoryById: (id: string) => boolean;
  markDirty: () => void;
  markClean: () => void;
  setCurrentStoryName: (name: string) => void;
  newStory: () => void;
}

export const useVisualBuilderStore = create<VisualBuilderStore>()(
  devtools(
    (set, _get) => ({
      // Initial state
      components: [],
      selectedComponent: null,
      draggedComponent: null,
      isCodeModalOpen: false,
      isImportedFromStory: false,
      // Story management state
      currentStoryId: null,
      currentStoryName: 'Untitled Story',
      isDirty: false,

      // Actions
      addComponent: (component, targetId, insertIndex) => {
        set((state) => {
          const newComponent = { ...component, id: `${component.type}-${Date.now()}` };
          
          let newComponents;
          if (targetId) {
            // Add as child to target component
            const updateComponents = (components: ComponentDefinition[]): ComponentDefinition[] => {
              return components.map(comp => {
                if (comp.id === targetId) {
                  const children = comp.children || [];
                  const newChildren = insertIndex !== undefined 
                    ? [...children.slice(0, insertIndex), newComponent, ...children.slice(insertIndex)]
                    : [...children, newComponent];
                  return {
                    ...comp,
                    children: newChildren
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
            newComponents = updateComponents(state.components);
          } else {
            // Add to root level
            newComponents = insertIndex !== undefined 
              ? [...state.components.slice(0, insertIndex), newComponent, ...state.components.slice(insertIndex)]
              : [...state.components, newComponent];
          }
          
          // Mark as dirty and schedule auto-save
          scheduleAutoSave(state.currentStoryName, newComponents, state.currentStoryId || undefined);
          return { components: newComponents, isDirty: true };
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
          
          const newComponents = removeFromComponents(state.components);
          
          // Mark as dirty and schedule auto-save
          scheduleAutoSave(state.currentStoryName, newComponents, state.currentStoryId || undefined);
          
          return {
            components: newComponents,
            selectedComponent: state.selectedComponent?.id === id ? null : state.selectedComponent,
            isDirty: true
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
          
          const newComponents = updateComponents(state.components);
          
          // Mark as dirty and schedule auto-save
          scheduleAutoSave(state.currentStoryName, newComponents, state.currentStoryId || undefined);
          
          return { components: newComponents, isDirty: true };
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
          selectedComponent: null,
          isImportedFromStory: false,
          isDirty: true
        });
      },

      moveComponent: (activeId, overId, insertIndex, insertPosition) => {
        set((state) => {
          // Prevent moving a component into itself or its descendants
          if (activeId === overId || isDescendant(state.components, activeId, overId)) {
            return state;
          }

          // Remove the component from its current location
          const { components: updatedComponents, removed } = removeComponentFromTree(state.components, activeId);
          
          if (!removed) {
            return state; // Component not found
          }

          // Determine insertion target and index
          let targetContainerId: string | null = null;
          let insertionIndex = insertIndex;

          if (insertIndex !== undefined) {
            // Direct insertion at specific index (root level)
            targetContainerId = null;
          } else {
            // Insert relative to another component
            const overComponent = findComponentWithParent(updatedComponents, overId);
            if (overComponent) {
              if (overComponent.parent) {
                targetContainerId = overComponent.parent.id;
                insertionIndex = overComponent.index + (insertPosition === 'after' ? 1 : 0);
              } else {
                // Insert at root level
                targetContainerId = null;
                insertionIndex = overComponent.index + (insertPosition === 'after' ? 1 : 0);
              }
            }
          }

          // Insert the component at the new location
          const finalComponents = insertComponentInTree(updatedComponents, removed, targetContainerId, insertionIndex);
          
          // Mark as dirty and schedule auto-save
          scheduleAutoSave(state.currentStoryName, finalComponents, state.currentStoryId || undefined);
          
          return { components: finalComponents, isDirty: true };
        });
      },

      moveComponentBetweenContainers: (activeId, _fromParentId, toParentId, insertIndex) => {
        set((state) => {
          // Prevent moving a component into itself or its descendants
          if (activeId === toParentId || (toParentId && isDescendant(state.components, activeId, toParentId))) {
            return state;
          }

          // Remove component from its current location
          const { components: afterRemoval, removed } = removeComponentFromTree(state.components, activeId);
          
          if (!removed) {
            return state; // Component not found
          }

          // Add component to new location
          const finalComponents = insertComponentInTree(afterRemoval, removed, toParentId, insertIndex);
          
          // Mark as dirty and schedule auto-save
          scheduleAutoSave(state.currentStoryName, finalComponents, state.currentStoryId || undefined);
          
          return { components: finalComponents, isDirty: true };
        });
      },

      loadFromAI: (components) => {
        set({ 
          components, 
          selectedComponent: null,
          isImportedFromStory: false,
          isDirty: true
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
              isImportedFromStory: false,
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

      importFromStoryUI: async (storyCode) => {
        try {
          const { parseStoryUIToBuilder, validateParsedComponents, extractStoryName } = await import('../utils/storyToBuilder');
          const parseResult = parseStoryUIToBuilder(storyCode);
          
          // Validate the parsed components
          const validationIssues = validateParsedComponents(parseResult.components);
          const allWarnings = [...parseResult.warnings, ...validationIssues];
          
          // Extract story name using the improved extraction function
          const storyName = extractStoryName(storyCode);
          // Determine if this is an existing story (has a valid extracted name)
          const isEditingExistingStory = storyName !== 'Imported Story' && storyName !== 'Untitled Story';
          
          if (parseResult.errors.length === 0) {
            // Generate or use existing story ID
            const state = _get();
            const storyId = state.currentStoryId || `story-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            set({ 
              components: parseResult.components, 
              selectedComponent: null,
              isImportedFromStory: true, // Mark as imported from story
              currentStoryName: storyName, // Set the extracted story name
              currentStoryId: storyId, // Set the story ID
              isDirty: isEditingExistingStory ? false : true // Start clean for existing stories, dirty for new imports
            });
          }
          
          return {
            success: parseResult.errors.length === 0,
            errors: parseResult.errors,
            warnings: allWarnings
          };
        } catch (error) {
          return {
            success: false,
            errors: [`Failed to import from Story UI: ${error instanceof Error ? error.message : 'Unknown error'}`],
            warnings: []
          };
        }
      },

      // Story management actions
      saveCurrentStory: (name) => {
        const state = _get();
        const storyName = name || state.currentStoryName;
        const savedStory = saveStory(storyName, state.components, state.currentStoryId || undefined);
        
        set({
          currentStoryId: savedStory.id,
          currentStoryName: savedStory.name,
          isDirty: false
        });
        
        // Update URL with story ID
        const url = new URL(window.location.href);
        url.searchParams.set('story', savedStory.id);
        window.history.replaceState({}, '', url.toString());
        
        return savedStory;
      },

      loadStoryById: (id) => {
        const story = loadStory(id);
        if (story) {
          cancelAutoSave(); // Cancel any pending auto-save
          set({
            components: story.components,
            currentStoryId: story.id,
            currentStoryName: story.name,
            isDirty: false,
            selectedComponent: null,
            isImportedFromStory: false
          });
          return true;
        }
        return false;
      },

      markDirty: () => {
        set({ isDirty: true });
      },

      markClean: () => {
        set({ isDirty: false });
      },

      setCurrentStoryName: (name) => {
        set({ currentStoryName: name, isDirty: true });
      },

      newStory: () => {
        cancelAutoSave();
        set({
          components: [],
          selectedComponent: null,
          currentStoryId: null,
          currentStoryName: 'Untitled Story',
          isDirty: false,
          isImportedFromStory: false
        });
        
        // Remove story parameter from URL
        const url = new URL(window.location.href);
        url.searchParams.delete('story');
        window.history.replaceState({}, '', url.toString());
      }
    }),
    { name: 'visual-builder-store' }
  )
);