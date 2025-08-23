import type { ComponentDefinition } from '../types/index';

export interface SavedStory {
  id: string;
  name: string;
  components: ComponentDefinition[];
  createdAt: string;
  updatedAt: string;
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
export function saveStory(name: string, components: ComponentDefinition[], existingId?: string): SavedStory {
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
        updatedAt: now
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
    updatedAt: now
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
  delay: number = 2000
): void {
  // Clear existing timer
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  
  // Schedule new save
  autoSaveTimer = setTimeout(() => {
    try {
      saveStory(name, components, storyId);
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