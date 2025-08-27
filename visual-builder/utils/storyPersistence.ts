import type { ComponentDefinition } from '../types/index';

export interface SavedStory {
  id: string;
  name: string;
  components: ComponentDefinition[];
  createdAt: string;
  updatedAt: string;
  isImportedFromStory?: boolean; // Track if this was originally imported from a story
}

const STORAGE_KEY = 'visual-builder-stories';

/**
 * Get all saved stories from localStorage
 */
export function getSavedStories(): SavedStory[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load saved stories:', error);
    return [];
  }
}

/**
 * Save a story to localStorage
 */
export function saveStory(name: string, components: ComponentDefinition[], existingId?: string, isImportedFromStory?: boolean): SavedStory {
  const stories = getSavedStories();
  const now = new Date().toISOString();
  
  if (existingId) {
    // Update existing story
    const existingIndex = stories.findIndex(story => story.id === existingId);
    if (existingIndex >= 0) {
      const updatedStory: SavedStory = {
        ...stories[existingIndex],
        name,
        components,
        updatedAt: now,
        isImportedFromStory: isImportedFromStory !== undefined ? isImportedFromStory : stories[existingIndex].isImportedFromStory
      };
      stories[existingIndex] = updatedStory;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
      return updatedStory;
    }
  }
  
  // Create new story
  const newStory: SavedStory = {
    id: `story-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    components,
    createdAt: now,
    updatedAt: now,
    isImportedFromStory: isImportedFromStory || false
  };
  
  stories.push(newStory);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
  return newStory;
}

/**
 * Load a story by ID
 */
export function loadStory(id: string): SavedStory | null {
  const stories = getSavedStories();
  return stories.find(story => story.id === id) || null;
}

/**
 * Delete a story by ID
 */
export function deleteStory(id: string): boolean {
  try {
    const stories = getSavedStories();
    const filteredStories = stories.filter(story => story.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredStories));
    return true;
  } catch (error) {
    console.error('Failed to delete story:', error);
    return false;
  }
}

/**
 * Generate a URL with story parameters
 */
export function generateStoryURL(storyId: string, baseURL?: string): string {
  const url = new URL(baseURL || window.location.href);
  url.searchParams.set('story', storyId);
  return url.toString();
}

/**
 * Get story ID from URL parameters
 */
export function getStoryIdFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('story');
}

/**
 * Auto-save functionality
 */
let autoSaveTimer: NodeJS.Timeout | null = null;

export function scheduleAutoSave(
  name: string, 
  components: ComponentDefinition[], 
  storyId?: string,
  isImportedFromStory?: boolean,
  delay: number = 2000
): void {
  // Clear existing timer
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  
  // Schedule new save
  autoSaveTimer = setTimeout(() => {
    try {
      saveStory(name, components, storyId, isImportedFromStory);
      console.debug('Auto-saved story:', name);
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }, delay);
}

/**
 * Cancel scheduled auto-save
 */
export function cancelAutoSave(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

/**
 * Save draft to localStorage (for recovery on refresh)
 */
export function saveDraft(storyId: string, components: ComponentDefinition[], isImportedFromStory: boolean = false, storyName?: string, sourceFile?: string): void {
  const draftKey = `visual-builder-draft-${storyId}`;
  const draft = {
    components,
    timestamp: Date.now(),
    storyId,
    isImportedFromStory,
    storyName,
    sourceFile
  };
  try {
    localStorage.setItem(draftKey, JSON.stringify(draft));
  } catch (error) {
    console.error('Failed to save draft:', error);
  }
}

/**
 * Restore draft from localStorage
 */
export function restoreDraft(storyId: string): { components: ComponentDefinition[], isImportedFromStory: boolean, storyName?: string, sourceFile?: string } | null {
  const draftKey = `visual-builder-draft-${storyId}`;
  try {
    const stored = localStorage.getItem(draftKey);
    if (stored) {
      const draft = JSON.parse(stored);
      // Check if draft is recent (within last 24 hours)
      const ageInHours = (Date.now() - draft.timestamp) / (1000 * 60 * 60);
      if (ageInHours < 24) {
        return {
          components: draft.components,
          isImportedFromStory: draft.isImportedFromStory || false,
          storyName: draft.storyName,
          sourceFile: draft.sourceFile
        };
      }
      // Clean up old draft
      localStorage.removeItem(draftKey);
    }
  } catch (error) {
    console.error('Failed to restore draft:', error);
  }
  return null;
}

/**
 * Clear draft from localStorage
 */
export function clearDraft(storyId: string): void {
  const draftKey = `visual-builder-draft-${storyId}`;
  try {
    localStorage.removeItem(draftKey);
  } catch (error) {
    console.error('Failed to clear draft:', error);
  }
}

/**
 * Get Visual Builder edit URL
 */
export function getVisualBuilderEditURL(storyId: string): string {
  const baseURL = window.location.origin + window.location.pathname;
  return `${baseURL}?path=/visual-builder&edit=${storyId}`;
}