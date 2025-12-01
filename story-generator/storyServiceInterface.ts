/**
 * Story Service Interface
 * Common interface for both in-memory and PostgreSQL story storage
 */

/**
 * Generated story interface
 */
export interface GeneratedStory {
  id: string;
  title: string;
  description: string;
  content: string;
  createdAt: Date;
  lastAccessed: Date;
  prompt?: string;
  components?: string[];
}

/**
 * Story metadata for listing
 */
export interface StoryMetadata {
  id: string;
  title: string;
  description: string;
  createdAt: Date;
  lastAccessed: Date;
  componentCount: number;
}

/**
 * Memory/storage usage statistics
 */
export interface StorageStats {
  storyCount: number;
  totalSizeBytes: number;
  averageSizeBytes: number;
  oldestStory: Date | null;
  newestStory: Date | null;
}

/**
 * Story Service Interface
 * All methods are async to support both in-memory and database backends
 */
export interface IStoryService {
  /**
   * Initialize the service (create tables, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Store a generated story
   */
  storeStory(story: GeneratedStory): Promise<void>;

  /**
   * Retrieve a story by ID
   */
  getStory(id: string): Promise<GeneratedStory | null>;

  /**
   * Get all stored stories
   */
  getAllStories(): Promise<GeneratedStory[]>;

  /**
   * Delete a story by ID
   */
  deleteStory(id: string): Promise<boolean>;

  /**
   * Clear all stories
   */
  clearAllStories(): Promise<void>;

  /**
   * Get story content for Storybook integration
   */
  getStoryContent(id: string): Promise<string | null>;

  /**
   * Get story metadata for listing
   */
  getStoryMetadata(): Promise<StoryMetadata[]>;

  /**
   * Get storage usage statistics
   */
  getStorageStats(): Promise<StorageStats>;

  /**
   * Close any connections (for cleanup)
   */
  close(): Promise<void>;
}
