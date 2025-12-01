import { Request, Response } from 'express';
import { getStoryService, getStorageType } from '../../story-generator/storyServiceFactory.js';
import { loadUserConfig } from '../../story-generator/configLoader.js';

/**
 * Get all stories metadata
 */
export async function getStoriesMetadata(req: Request, res: Response) {
  try {
    const config = loadUserConfig();
    const storyService = await getStoryService(config);
    const metadata = await storyService.getStoryMetadata();

    res.json({
      success: true,
      stories: metadata,
      count: metadata.length,
      storage: getStorageType()
    });
  } catch (error) {
    console.error('Error in getStoriesMetadata:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve stories metadata'
    });
  }
}

/**
 * Get a specific story by ID
 */
export async function getStoryById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const storyService = await getStoryService(config);
    const story = await storyService.getStory(id);

    if (!story) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    res.json({
      success: true,
      story,
      storage: getStorageType()
    });
  } catch (error) {
    console.error('Error in getStoryById:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve story'
    });
  }
}

/**
 * Get story content for Storybook integration
 */
export async function getStoryContent(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const storyService = await getStoryService(config);
    const content = await storyService.getStoryContent(id);

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
    console.error('Error in getStoryContent:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve story content'
    });
  }
}

/**
 * Delete a story by ID
 */
export async function deleteStory(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const storyService = await getStoryService(config);
    const deleted = await storyService.deleteStory(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    res.json({
      success: true,
      message: 'Story deleted successfully',
      storage: getStorageType()
    });
  } catch (error) {
    console.error('Error in deleteStory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete story'
    });
  }
}

/**
 * Clear all stories
 */
export async function clearAllStories(req: Request, res: Response) {
  try {
    const config = loadUserConfig();
    const storyService = await getStoryService(config);
    await storyService.clearAllStories();

    res.json({
      success: true,
      message: 'All stories cleared successfully',
      storage: getStorageType()
    });
  } catch (error) {
    console.error('Error in clearAllStories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear stories'
    });
  }
}

/**
 * Get storage usage statistics
 */
export async function getMemoryStats(req: Request, res: Response) {
  try {
    const config = loadUserConfig();
    const storyService = await getStoryService(config);
    const stats = await storyService.getStorageStats();

    res.json({
      success: true,
      stats: {
        ...stats,
        totalSizeMB: Math.round(stats.totalSizeBytes / 1024 / 1024 * 100) / 100,
        averageSizeKB: Math.round(stats.averageSizeBytes / 1024 * 100) / 100
      },
      storage: getStorageType()
    });
  } catch (error) {
    console.error('Error in getMemoryStats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve storage statistics'
    });
  }
}
