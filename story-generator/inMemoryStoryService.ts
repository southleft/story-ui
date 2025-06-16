import { StoryUIConfig } from '../story-ui.config.js';

/**
 * In-memory story service for production environments
 * Stores generated stories in memory and serves them via API
 */
export class InMemoryStoryService {
  private stories: Map<string, GeneratedStory> = new Map();
  private config: StoryUIConfig;

  constructor(config: StoryUIConfig) {
    this.config = config;
  }

  /**
   * Stores a generated story in memory
   */
  storeStory(story: GeneratedStory): void {
    this.stories.set(story.id, {
      ...story,
      createdAt: new Date(),
      lastAccessed: new Date()
    });

    // Clean up old stories to prevent memory leaks
    this.cleanupOldStories();
  }

  /**
   * Retrieves a story by ID
   */
  getStory(id: string): GeneratedStory | null {
    const story = this.stories.get(id);
    if (story) {
      story.lastAccessed = new Date();
      return story;
    }
    return null;
  }

  /**
   * Gets all stored stories
   */
  getAllStories(): GeneratedStory[] {
    return Array.from(this.stories.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * Deletes a story by ID
   */
  deleteStory(id: string): boolean {
    return this.stories.delete(id);
  }

  /**
   * Clears all stories
   */
  clearAllStories(): void {
    this.stories.clear();
  }

  /**
   * Gets story content for Storybook integration
   */
  getStoryContent(id: string): string | null {
    const story = this.stories.get(id);
    return story ? story.content : null;
  }

  /**
   * Gets story metadata for listing
   */
  getStoryMetadata(): StoryMetadata[] {
    return Array.from(this.stories.values()).map(story => ({
      id: story.id,
      title: story.title,
      description: story.description,
      createdAt: story.createdAt,
      lastAccessed: story.lastAccessed,
      componentCount: this.countComponents(story.content)
    }));
  }

  /**
   * Cleans up old stories to prevent memory leaks
   */
  private cleanupOldStories(): void {
    const maxStories = 50; // Keep maximum 50 stories in memory
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    // Remove stories older than maxAge
    for (const [id, story] of this.stories.entries()) {
      if (now - story.lastAccessed.getTime() > maxAge) {
        this.stories.delete(id);
      }
    }

    // If still too many stories, remove oldest ones
    if (this.stories.size > maxStories) {
      const sortedStories = Array.from(this.stories.entries())
        .sort(([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

      const toRemove = sortedStories.slice(0, this.stories.size - maxStories);
      for (const [id] of toRemove) {
        this.stories.delete(id);
      }
    }
  }

  /**
   * Counts components used in a story
   */
  private countComponents(content: string): number {
    const componentMatches = content.match(/<[A-Z][A-Za-z0-9]*\s/g);
    return componentMatches ? new Set(componentMatches).size : 0;
  }

  /**
   * Gets memory usage statistics
   */
  getMemoryStats(): MemoryStats {
    const stories = Array.from(this.stories.values());
    const totalSize = stories.reduce((sum, story) => sum + story.content.length, 0);

    return {
      storyCount: this.stories.size,
      totalSizeBytes: totalSize,
      averageSizeBytes: stories.length > 0 ? Math.round(totalSize / stories.length) : 0,
      oldestStory: stories.reduce((oldest, story) =>
        !oldest || story.createdAt < oldest.createdAt ? story : oldest, null as GeneratedStory | null
      )?.createdAt || null,
      newestStory: stories.reduce((newest, story) =>
        !newest || story.createdAt > newest.createdAt ? story : newest, null as GeneratedStory | null
      )?.createdAt || null
    };
  }
}

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
 * Memory usage statistics
 */
export interface MemoryStats {
  storyCount: number;
  totalSizeBytes: number;
  averageSizeBytes: number;
  oldestStory: Date | null;
  newestStory: Date | null;
}

/**
 * Global in-memory story service instance
 */
let globalStoryService: InMemoryStoryService | null = null;

/**
 * Gets or creates the global story service instance
 */
export function getInMemoryStoryService(config: StoryUIConfig): InMemoryStoryService {
  if (!globalStoryService) {
    globalStoryService = new InMemoryStoryService(config);
  }
  return globalStoryService;
}
