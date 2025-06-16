import { Request, Response } from 'express';
import { getStorySyncService } from '../../story-generator/storySync.js';
import { loadUserConfig } from '../../story-generator/configLoader.js';

/**
 * Get all synchronized stories (from both file system and memory)
 */
export async function getSyncedStories(req: Request, res: Response) {
  try {
    const config = loadUserConfig();
    const syncService = getStorySyncService(config);
    const stories = await syncService.getAllStories();

    res.json({
      success: true,
      stories: stories.map(story => ({
        id: story.id,
        title: story.title,
        fileName: story.fileName,
        description: story.description,
        createdAt: story.createdAt,
        lastAccessed: story.lastAccessed,
        source: story.source
      })),
      count: stories.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve synchronized stories'
    });
  }
}

/**
 * Delete a story from both file system and memory
 */
export async function deleteSyncedStory(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const syncService = getStorySyncService(config);
    const deleted = await syncService.deleteStory(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    res.json({
      success: true,
      message: 'Story deleted successfully from all sources'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete story'
    });
  }
}

/**
 * Clear all stories from both file system and memory
 */
export async function clearAllSyncedStories(req: Request, res: Response) {
  try {
    const config = loadUserConfig();
    const syncService = getStorySyncService(config);
    await syncService.clearAllStories();

    res.json({
      success: true,
      message: 'All stories cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear stories'
    });
  }
}

/**
 * Sync chat history with actual stories
 */
export async function syncChatHistory(req: Request, res: Response) {
  try {
    const config = loadUserConfig();
    const syncService = getStorySyncService(config);
    const syncResult = await syncService.syncChatHistory();

    res.json({
      success: true,
      ...syncResult
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to sync chat history'
    });
  }
}

/**
 * Validate that a chat session corresponds to an actual story
 */
export async function validateChatSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const syncService = getStorySyncService(config);
    const isValid = await syncService.validateChatSession(id);

    res.json({
      success: true,
      isValid,
      message: isValid ? 'Chat session is valid' : 'Chat session has no corresponding story'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to validate chat session'
    });
  }
}

/**
 * Get a specific synced story by ID
 */
export async function getSyncedStoryById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const syncService = getStorySyncService(config);
    const story = await syncService.getStory(id);

    if (!story) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    res.json({
      success: true,
      story
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve story'
    });
  }
}
