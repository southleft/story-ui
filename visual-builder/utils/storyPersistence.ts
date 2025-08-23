import { ComponentDefinition } from '../types';

export interface SavedStory {
  id: string;
  name: string;
  description?: string;
  components: ComponentDefinition[];
  createdAt: string;
  updatedAt: string;
  version: string;
}

export interface StoryMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  version: string;
}

const STORAGE_KEY = 'visual-builder-stories';
const CURRENT_VERSION = '1.0.0';

/**
 * Generate a unique ID for stories
 */
export function generateStoryId(): string {
  return `story-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Save a story to local storage
 */
export function saveStory(
  name: string,
  components: ComponentDefinition[],
  description?: string,
  id?: string
): SavedStory {
  const stories = loadAllStories();
  const now = new Date().toISOString();
  
  const storyId = id || generateStoryId();
  const existingStoryIndex = stories.findIndex(s => s.id === storyId);
  
  const story: SavedStory = {
    id: storyId,
    name,
    description,
    components,
    createdAt: existingStoryIndex >= 0 ? stories[existingStoryIndex].createdAt : now,
    updatedAt: now,
    version: CURRENT_VERSION
  };
  
  if (existingStoryIndex >= 0) {
    stories[existingStoryIndex] = story;
  } else {
    stories.push(story);
  }
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
    return story;
  } catch (error) {
    console.error('Failed to save story:', error);
    throw new Error('Failed to save story to local storage');
  }
}

/**
 * Load all saved stories from local storage
 */
export function loadAllStories(): SavedStory[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const stories = JSON.parse(stored);
    return Array.isArray(stories) ? stories : [];
  } catch (error) {
    console.error('Failed to load stories:', error);
    return [];
  }
}

/**
 * Load a specific story by ID
 */
export function loadStory(id: string): SavedStory | null {
  const stories = loadAllStories();
  return stories.find(s => s.id === id) || null;
}

/**
 * Delete a story by ID
 */
export function deleteStory(id: string): boolean {
  try {
    const stories = loadAllStories();
    const filtered = stories.filter(s => s.id !== id);
    
    if (filtered.length === stories.length) {
      return false; // Story not found
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Failed to delete story:', error);
    return false;
  }
}

/**
 * Get all story metadata (without component data for performance)
 */
export function getAllStoryMetadata(): StoryMetadata[] {
  const stories = loadAllStories();
  return stories.map(({ components, ...metadata }) => metadata);
}

/**
 * Export a story to a shareable format (base64 encoded)
 */
export function exportStoryToShareableFormat(story: SavedStory): string {
  const storyData = {
    name: story.name,
    description: story.description,
    components: story.components,
    version: story.version
  };
  
  const jsonString = JSON.stringify(storyData);
  return btoa(encodeURIComponent(jsonString));
}

/**
 * Import a story from shareable format
 */
export function importStoryFromShareableFormat(encoded: string): Partial<SavedStory> | null {
  try {
    const jsonString = decodeURIComponent(atob(encoded));
    const storyData = JSON.parse(jsonString);
    
    return {
      name: storyData.name || 'Imported Story',
      description: storyData.description,
      components: storyData.components || [],
      version: storyData.version || '1.0.0'
    };
  } catch (error) {
    console.error('Failed to import story:', error);
    return null;
  }
}

/**
 * Create a shareable URL for a story
 */
export function createShareableUrl(storyId: string, baseUrl?: string): string {
  const base = baseUrl || window.location.origin;
  return `${base}/visual-builder?story=${storyId}`;
}

/**
 * Create a direct link with embedded story data
 */
export function createEmbeddedUrl(story: SavedStory, baseUrl?: string): string {
  const base = baseUrl || window.location.origin;
  const encoded = exportStoryToShareableFormat(story);
  
  // For very large stories, we might need to use a different approach
  if (encoded.length > 2000) {
    // Fall back to ID-based URL
    return createShareableUrl(story.id, baseUrl);
  }
  
  return `${base}/visual-builder?data=${encoded}`;
}

/**
 * Parse story from URL parameters
 */
export function parseStoryFromUrl(urlParams: URLSearchParams): {
  type: 'id' | 'data' | null;
  value: string | null;
} {
  const storyId = urlParams.get('story');
  const storyData = urlParams.get('data');
  
  if (storyId) {
    return { type: 'id', value: storyId };
  }
  
  if (storyData) {
    return { type: 'data', value: storyData };
  }
  
  return { type: null, value: null };
}

/**
 * Check if local storage is available and has space
 */
export function isStorageAvailable(): boolean {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get storage usage information
 */
export function getStorageInfo(): {
  used: number;
  available: boolean;
  storyCount: number;
} {
  const stories = loadAllStories();
  const storageString = JSON.stringify(stories);
  
  return {
    used: storageString.length,
    available: isStorageAvailable(),
    storyCount: stories.length
  };
}

/**
 * Clear all saved stories (with confirmation)
 */
export function clearAllStories(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear stories:', error);
    return false;
  }
}

/**
 * Auto-save functionality with debouncing
 */
export class AutoSave {
  private timeoutId: NodeJS.Timeout | null = null;
  private lastSaved: string | null = null;
  
  constructor(
    private saveFunction: () => void,
    private delay: number = 2000
  ) {}
  
  trigger() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    
    this.timeoutId = setTimeout(() => {
      this.saveFunction();
      this.lastSaved = new Date().toISOString();
    }, this.delay);
  }
  
  cancel() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
  
  getLastSaved(): string | null {
    return this.lastSaved;
  }
}