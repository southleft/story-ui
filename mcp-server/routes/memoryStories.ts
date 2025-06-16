import { Request, Response } from 'express';
import { getInMemoryStoryService } from '../../story-generator/inMemoryStoryService.js';
import { STORY_UI_CONFIG } from '../../story-ui.config.js';

/**
 * Get all stories metadata
 */
export function getStoriesMetadata(req: Request, res: Response) {
  try {
    const storyService = getInMemoryStoryService(STORY_UI_CONFIG);
    const metadata = storyService.getStoryMetadata();

    res.json({
      success: true,
      stories: metadata,
      count: metadata.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve stories metadata'
    });
  }
}

/**
 * Get a specific story by ID
 */
export function getStoryById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const storyService = getInMemoryStoryService(STORY_UI_CONFIG);
    const story = storyService.getStory(id);

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

/**
 * Get story content for Storybook integration
 */
export function getStoryContent(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const storyService = getInMemoryStoryService(STORY_UI_CONFIG);
    const content = storyService.getStoryContent(id);

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Story content not found'
      });
    }

    // Return as TypeScript/JSX content
    res.setHeader('Content-Type', 'text/plain');
    res.send(content);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve story content'
    });
  }
}

/**
 * Delete a story by ID
 */
export function deleteStory(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const storyService = getInMemoryStoryService(STORY_UI_CONFIG);
    const deleted = storyService.deleteStory(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    res.json({
      success: true,
      message: 'Story deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete story'
    });
  }
}

/**
 * Clear all stories
 */
export function clearAllStories(req: Request, res: Response) {
  try {
    const storyService = getInMemoryStoryService(STORY_UI_CONFIG);
    storyService.clearAllStories();

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
 * Get memory usage statistics
 */
export function getMemoryStats(req: Request, res: Response) {
  try {
    const storyService = getInMemoryStoryService(STORY_UI_CONFIG);
    const stats = storyService.getMemoryStats();

    res.json({
      success: true,
      stats: {
        ...stats,
        totalSizeMB: Math.round(stats.totalSizeBytes / 1024 / 1024 * 100) / 100,
        averageSizeKB: Math.round(stats.averageSizeBytes / 1024 * 100) / 100
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve memory statistics'
    });
  }
}
