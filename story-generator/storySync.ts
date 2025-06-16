import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';
import { getInMemoryStoryService, GeneratedStory } from './inMemoryStoryService.js';
import { setupProductionGitignore } from './productionGitignoreManager.js';

/**
 * Story synchronization service that keeps chat interface, file system, and memory in sync
 */
export class StorySyncService {
  private config: StoryUIConfig;
  private isProduction: boolean;

  constructor(config: StoryUIConfig) {
    this.config = config;
    const gitignoreManager = setupProductionGitignore(config);
    this.isProduction = gitignoreManager.isProductionMode();
  }

  /**
   * Gets all available stories from both file system and memory
   */
  async getAllStories(): Promise<SyncedStory[]> {
    const stories: SyncedStory[] = [];

    if (this.isProduction) {
      // Production: Get from memory
      const memoryService = getInMemoryStoryService(this.config);
      const memoryStories = memoryService.getAllStories();

      stories.push(...memoryStories.map(story => ({
        id: story.id,
        title: story.title,
        fileName: `${story.id}.stories.tsx`,
        description: story.description,
        createdAt: story.createdAt,
        lastAccessed: story.lastAccessed,
        source: 'memory' as const,
        content: story.content,
        prompt: story.prompt
      })));
    } else {
      // Development: Get from file system
      const fileSystemStories = await this.getFileSystemStories();
      stories.push(...fileSystemStories);

      // Also include any memory stories (for hybrid scenarios)
      const memoryService = getInMemoryStoryService(this.config);
      const memoryStories = memoryService.getAllStories();
      stories.push(...memoryStories.map(story => ({
        id: story.id,
        title: story.title,
        fileName: `${story.id}.stories.tsx`,
        description: story.description,
        createdAt: story.createdAt,
        lastAccessed: story.lastAccessed,
        source: 'memory' as const,
        content: story.content,
        prompt: story.prompt
      })));
    }

    // Sort by creation date (newest first)
    return stories.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Gets stories from the file system
   */
  private async getFileSystemStories(): Promise<SyncedStory[]> {
    const stories: SyncedStory[] = [];

    if (!fs.existsSync(this.config.generatedStoriesPath)) {
      return stories;
    }

    const files = fs.readdirSync(this.config.generatedStoriesPath);
    const storyFiles = files.filter(file => file.endsWith('.stories.tsx'));

    for (const file of storyFiles) {
      try {
        const filePath = path.join(this.config.generatedStoriesPath, file);
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');

                                // Extract title from file content - handle escaped quotes more robustly
        let title = file.replace('.stories.tsx', ''); // fallback

        // Find the title line - look for the pattern and extract until the closing quote + comma
        const titleStart = content.indexOf("title: '");
        if (titleStart !== -1) {
          const startPos = titleStart + "title: '".length;
          const endPos = content.indexOf("',", startPos);
          if (endPos !== -1) {
            title = content.substring(startPos, endPos);
          }
        }

        // Remove the story prefix and unescape characters
        title = title
          .replace(this.config.storyPrefix, '')
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '\\');

        // Generate ID from filename
        const id = file.replace('.stories.tsx', '');

        stories.push({
          id,
          title,
          fileName: file,
          description: `Generated story: ${title}`,
          createdAt: stats.birthtime,
          lastAccessed: stats.atime,
          source: 'filesystem',
          content,
          prompt: undefined
        });
      } catch (error) {
        console.warn(`Failed to read story file ${file}:`, error);
      }
    }

    return stories;
  }

  /**
   * Deletes a story from both file system and memory
   */
  async deleteStory(storyId: string): Promise<boolean> {
    let deleted = false;

    // Delete from memory
    const memoryService = getInMemoryStoryService(this.config);
    if (memoryService.deleteStory(storyId)) {
      deleted = true;
    }

    // Delete from file system (if not production)
    if (!this.isProduction) {
      const files = fs.readdirSync(this.config.generatedStoriesPath);
      const matchingFiles = files.filter(file =>
        file.includes(storyId) || file.startsWith(storyId)
      );

      for (const file of matchingFiles) {
        try {
          const filePath = path.join(this.config.generatedStoriesPath, file);
          fs.unlinkSync(filePath);
          deleted = true;
        } catch (error) {
          console.warn(`Failed to delete story file ${file}:`, error);
        }
      }
    }

    return deleted;
  }

  /**
   * Gets a specific story by ID
   */
  async getStory(storyId: string): Promise<SyncedStory | null> {
    const allStories = await this.getAllStories();
    return allStories.find(story => story.id === storyId) || null;
  }

  /**
   * Clears all stories
   */
  async clearAllStories(): Promise<void> {
    // Clear memory
    const memoryService = getInMemoryStoryService(this.config);
    memoryService.clearAllStories();

    // Clear file system (if not production)
    if (!this.isProduction && fs.existsSync(this.config.generatedStoriesPath)) {
      const files = fs.readdirSync(this.config.generatedStoriesPath);
      const storyFiles = files.filter(file => file.endsWith('.stories.tsx'));

      for (const file of storyFiles) {
        try {
          const filePath = path.join(this.config.generatedStoriesPath, file);
          fs.unlinkSync(filePath);
        } catch (error) {
          console.warn(`Failed to delete story file ${file}:`, error);
        }
      }
    }
  }

  /**
   * Syncs localStorage chat history with actual stories
   */
  async syncChatHistory(): Promise<ChatSyncResult> {
    const actualStories = await this.getAllStories();

    // This would be called from the frontend to sync localStorage
    return {
      actualStories: actualStories.map(story => ({
        id: story.id,
        title: story.title,
        fileName: story.fileName,
        lastUpdated: story.createdAt.getTime()
      })),
      shouldClearOrphanedChats: true
    };
  }

  /**
   * Validates that a chat session corresponds to an actual story
   */
  async validateChatSession(chatId: string): Promise<boolean> {
    const story = await this.getStory(chatId);
    return story !== null;
  }
}

/**
 * Synced story interface that combines file system and memory stories
 */
export interface SyncedStory {
  id: string;
  title: string;
  fileName: string;
  description: string;
  createdAt: Date;
  lastAccessed: Date;
  source: 'filesystem' | 'memory';
  content: string;
  prompt?: string;
}

/**
 * Chat synchronization result
 */
export interface ChatSyncResult {
  actualStories: {
    id: string;
    title: string;
    fileName: string;
    lastUpdated: number;
  }[];
  shouldClearOrphanedChats: boolean;
}

/**
 * Global story sync service instance
 */
let globalStorySyncService: StorySyncService | null = null;

/**
 * Gets or creates the global story sync service
 */
export function getStorySyncService(config: StoryUIConfig): StorySyncService {
  if (!globalStorySyncService) {
    globalStorySyncService = new StorySyncService(config);
  }
  return globalStorySyncService;
}
