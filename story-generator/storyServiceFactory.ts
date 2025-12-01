import type { IStoryService, GeneratedStory, StoryMetadata, StorageStats } from './storyServiceInterface.js';
import { InMemoryStoryService, getInMemoryStoryService } from './inMemoryStoryService.js';
import { PostgresStoryService } from './postgresStoryService.js';
import { StoryUIConfig } from '../story-ui.config.js';

/**
 * Async wrapper for InMemoryStoryService
 * Makes the synchronous in-memory service conform to the async IStoryService interface
 */
class AsyncInMemoryStoryService implements IStoryService {
  private innerService: InMemoryStoryService;

  constructor(config: StoryUIConfig) {
    this.innerService = getInMemoryStoryService(config);
  }

  async initialize(): Promise<void> {
    // No-op for in-memory
  }

  async storeStory(story: GeneratedStory): Promise<void> {
    this.innerService.storeStory(story as any);
  }

  async getStory(id: string): Promise<GeneratedStory | null> {
    return this.innerService.getStory(id) as GeneratedStory | null;
  }

  async getAllStories(): Promise<GeneratedStory[]> {
    return this.innerService.getAllStories() as GeneratedStory[];
  }

  async deleteStory(id: string): Promise<boolean> {
    return this.innerService.deleteStory(id);
  }

  async clearAllStories(): Promise<void> {
    this.innerService.clearAllStories();
  }

  async getStoryContent(id: string): Promise<string | null> {
    return this.innerService.getStoryContent(id);
  }

  async getStoryMetadata(): Promise<StoryMetadata[]> {
    return this.innerService.getStoryMetadata() as StoryMetadata[];
  }

  async getStorageStats(): Promise<StorageStats> {
    const stats = this.innerService.getMemoryStats();
    return {
      storyCount: stats.storyCount,
      totalSizeBytes: stats.totalSizeBytes,
      averageSizeBytes: stats.averageSizeBytes,
      oldestStory: stats.oldestStory,
      newestStory: stats.newestStory
    };
  }

  async close(): Promise<void> {
    // No-op for in-memory
  }
}

/**
 * Global story service instance
 */
let globalStoryService: IStoryService | null = null;

/**
 * Get or create the story service based on environment configuration
 *
 * - If DATABASE_URL is set, uses PostgreSQL for persistent storage
 * - Otherwise, falls back to in-memory storage
 */
export async function getStoryService(config: StoryUIConfig): Promise<IStoryService> {
  if (globalStoryService) {
    return globalStoryService;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    console.log('🗄️  Using PostgreSQL for story persistence');
    const pgService = new PostgresStoryService(databaseUrl);
    await pgService.initialize();
    globalStoryService = pgService;
  } else {
    console.log('💾 Using in-memory storage (no DATABASE_URL configured)');
    globalStoryService = new AsyncInMemoryStoryService(config);
    await globalStoryService.initialize();
  }

  return globalStoryService;
}

/**
 * Check if PostgreSQL storage is configured
 */
export function isPostgresConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Get storage type description
 */
export function getStorageType(): 'postgresql' | 'memory' {
  return process.env.DATABASE_URL ? 'postgresql' : 'memory';
}

/**
 * Reset the global service (for testing)
 */
export async function resetStoryService(): Promise<void> {
  if (globalStoryService) {
    await globalStoryService.close();
    globalStoryService = null;
  }
}
