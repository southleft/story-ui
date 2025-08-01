import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getInMemoryStoryService } from '../../story-generator/inMemoryStoryService.js';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { setupProductionGitignore } from '../../story-generator/productionGitignoreManager.js';

/**
 * Get all stories from both memory and file system
 */
export function getAllStories(req: Request, res: Response) {
  try {
    const config = loadUserConfig();
    const gitignoreManager = setupProductionGitignore(config);
    const storyService = getInMemoryStoryService(config);
    
    let allStories: any[] = [];
    
    // Get stories from memory
    const memoryStories = storyService.getStoryMetadata();
    allStories = [...memoryStories];
    
    // In development mode, also check file system
    if (!gitignoreManager.isProductionMode() && config.generatedStoriesPath) {
      try {
        if (fs.existsSync(config.generatedStoriesPath)) {
          const files = fs.readdirSync(config.generatedStoriesPath);
          const fileStories = files
            .filter(file => file.endsWith('.stories.tsx'))
            .map(file => {
              const fileName = file;
              const hash = file.match(/-([a-f0-9]{8})\.stories\.tsx$/)?.[1] || '';
              const storyId = hash ? `story-${hash}` : file.replace('.stories.tsx', '');
              
              // Try to read the file to get the title
              let title = file.replace('.stories.tsx', '').replace(/-/g, ' ');
              try {
                const filePath = path.join(config.generatedStoriesPath, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
                if (titleMatch) {
                  title = titleMatch[1].replace('Generated/', '');
                }
              } catch (e) {
                // Use filename as fallback
              }
              
              return {
                id: storyId,
                fileName,
                title,
                createdAt: fs.statSync(path.join(config.generatedStoriesPath, file)).birthtime,
                storage: 'file-system'
              };
            });
          
          // Merge, avoiding duplicates
          const memoryIds = new Set(memoryStories.map(s => s.id));
          const uniqueFileStories = fileStories.filter(s => !memoryIds.has(s.id));
          allStories = [...allStories, ...uniqueFileStories];
        }
      } catch (error) {
        console.error('Error reading file system stories:', error);
      }
    }
    
    res.json(allStories);
  } catch (error) {
    console.error('Error in getAllStories:', error);
    res.status(500).json({ error: 'Failed to retrieve stories' });
  }
}

/**
 * Get a specific story by ID from memory or file system
 */
export function getStoryById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const gitignoreManager = setupProductionGitignore(config);
    const storyService = getInMemoryStoryService(config);
    
    // First try memory
    const memoryStory = storyService.getStory(id);
    if (memoryStory) {
      return res.json(memoryStory);
    }
    
    // In development, try file system
    if (!gitignoreManager.isProductionMode() && config.generatedStoriesPath) {
      // Try to find by story ID pattern
      const files = fs.readdirSync(config.generatedStoriesPath);
      
      // Extract hash from story ID (e.g., "story-abc123" -> "abc123")
      const hashMatch = id.match(/^story-([a-f0-9]{8})$/);
      const hash = hashMatch ? hashMatch[1] : null;
      
      // Find file by hash or exact match
      const matchingFile = files.find(file => {
        if (hash && file.includes(`-${hash}.stories.tsx`)) return true;
        if (file === `${id}.stories.tsx`) return true;
        if (file === id) return true;
        return false;
      });
      
      if (matchingFile) {
        const filePath = path.join(config.generatedStoriesPath, matchingFile);
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        
        // Extract title from content
        let title = matchingFile.replace('.stories.tsx', '').replace(/-/g, ' ');
        const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
        if (titleMatch) {
          title = titleMatch[1].replace('Generated/', '');
        }
        
        return res.json({
          id,
          fileName: matchingFile,
          title,
          content,
          createdAt: stats.birthtime,
          storage: 'file-system'
        });
      }
    }
    
    res.status(404).json({ error: 'Story not found' });
  } catch (error) {
    console.error('Error in getStoryById:', error);
    res.status(500).json({ error: 'Failed to retrieve story' });
  }
}

/**
 * Get story content by ID
 */
export function getStoryContent(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const gitignoreManager = setupProductionGitignore(config);
    const storyService = getInMemoryStoryService(config);
    
    // First try memory
    const content = storyService.getStoryContent(id);
    if (content) {
      res.setHeader('Content-Type', 'text/plain');
      return res.send(content);
    }
    
    // In development, try file system
    if (!gitignoreManager.isProductionMode() && config.generatedStoriesPath) {
      const files = fs.readdirSync(config.generatedStoriesPath);
      
      // Extract hash from story ID
      const hashMatch = id.match(/^story-([a-f0-9]{8})$/);
      const hash = hashMatch ? hashMatch[1] : null;
      
      const matchingFile = files.find(file => {
        if (hash && file.includes(`-${hash}.stories.tsx`)) return true;
        if (file === `${id}.stories.tsx`) return true;
        if (file === id) return true;
        return false;
      });
      
      if (matchingFile) {
        const filePath = path.join(config.generatedStoriesPath, matchingFile);
        const content = fs.readFileSync(filePath, 'utf-8');
        res.setHeader('Content-Type', 'text/plain');
        return res.send(content);
      }
    }
    
    res.status(404).json({ error: 'Story content not found' });
  } catch (error) {
    console.error('Error in getStoryContent:', error);
    res.status(500).json({ error: 'Failed to retrieve story content' });
  }
}

/**
 * Delete a story by ID
 */
export function deleteStory(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const config = loadUserConfig();
    const gitignoreManager = setupProductionGitignore(config);
    const storyService = getInMemoryStoryService(config);
    
    console.log(`🗑️ Attempting to delete story: ${id}`);
    
    // First try memory
    const memoryDeleted = storyService.deleteStory(id);
    if (memoryDeleted) {
      console.log(`✅ Deleted story from memory: ${id}`);
      return res.json({ success: true, message: 'Story deleted from memory' });
    }
    
    // In development, try file system
    if (!gitignoreManager.isProductionMode() && config.generatedStoriesPath) {
      const files = fs.readdirSync(config.generatedStoriesPath);
      
      // Extract hash from story ID
      const hashMatch = id.match(/^story-([a-f0-9]{8})$/);
      const hash = hashMatch ? hashMatch[1] : null;
      
      const matchingFile = files.find(file => {
        if (hash && file.includes(`-${hash}.stories.tsx`)) return true;
        if (file === `${id}.stories.tsx`) return true;
        if (file === id) return true;
        return false;
      });
      
      if (matchingFile) {
        const filePath = path.join(config.generatedStoriesPath, matchingFile);
        fs.unlinkSync(filePath);
        console.log(`✅ Deleted story file: ${filePath}`);
        return res.json({ success: true, message: 'Story deleted from file system' });
      }
    }
    
    console.log(`❌ Story not found: ${id}`);
    res.status(404).json({ error: 'Story not found' });
  } catch (error) {
    console.error('Error in deleteStory:', error);
    res.status(500).json({ error: 'Failed to delete story' });
  }
}