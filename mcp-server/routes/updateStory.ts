import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { logger } from '../../story-generator/logger.js';

/**
 * Update an existing story file with new content from Visual Builder
 * This uses the same file system access that Story UI already uses for generation
 */
export async function updateStoryFromVisualBuilder(req: Request, res: Response) {
  const { filePath, components, storyName, fileName, createBackup = false } = req.body;
  
  if (!fileName && !filePath) {
    return res.status(400).json({ 
      error: 'Missing required parameters',
      details: 'Either fileName or filePath must be provided' 
    });
  }

  try {
    // Load the Story UI configuration to get the stories path
    const config = loadUserConfig();
    
    // Determine the target file path - always save to main directory
    let targetPath: string;
    
    if (filePath) {
      // If full path is provided, use it (with validation)
      targetPath = path.join(config.generatedStoriesPath, path.basename(filePath));
    } else {
      // Use fileName to construct path
      const cleanFileName = fileName.includes('.stories.tsx') 
        ? fileName 
        : `${fileName}.stories.tsx`;
      targetPath = path.join(config.generatedStoriesPath, cleanFileName);
    }
    
    // Optional backup creation (only if explicitly requested)
    if (createBackup && fs.existsSync(targetPath)) {
      const backupPath = targetPath.replace('.stories.tsx', '.backup.stories.tsx');
      fs.copyFileSync(targetPath, backupPath);
      logger.log(`📦 Created backup: ${backupPath}`);
    }
    
    logger.log(`📝 Updating story file: ${targetPath}`);
    
    // Generate the new story content from components
    const { generateStoryFileContent } = await import('../../visual-builder/utils/storyFileUpdater.js');
    const newContent = generateStoryFileContent(
      components,
      storyName || 'Updated Story',
      path.basename(targetPath)
    );
    
    // Check if file exists (for updates) or create new (for saves)
    const fileExists = fs.existsSync(targetPath);
    
    // Write the file - always overwrite
    fs.writeFileSync(targetPath, newContent, 'utf-8');
    
    logger.log(`✅ Successfully ${fileExists ? 'updated' : 'created'} story file`);
    
    // Return success response
    res.json({
      success: true,
      filePath: targetPath,
      fileName: path.basename(targetPath),
      action: fileExists ? 'updated' : 'created',
      hasBackup: createBackup && fileExists,
      message: `Story ${fileExists ? 'updated' : 'created'} successfully`
    });
    
  } catch (error: any) {
    logger.log(`❌ Error updating story file: ${error.message}`);
    res.status(500).json({ 
      error: 'Failed to update story file',
      details: error.message 
    });
  }
}

/**
 * Get story content for editing in Visual Builder
 * This allows Visual Builder to load existing stories
 */
export async function getStoryForVisualBuilder(req: Request, res: Response) {
  const { fileName } = req.query;
  
  if (!fileName) {
    return res.status(400).json({ 
      error: 'Missing fileName parameter' 
    });
  }

  try {
    const config = loadUserConfig();
    const cleanFileName = String(fileName).includes('.stories.tsx') 
      ? String(fileName) 
      : `${fileName}.stories.tsx`;
    const fullPath = path.join(config.generatedStoriesPath, cleanFileName);
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ 
        error: 'Story file not found',
        fileName: cleanFileName 
      });
    }
    
    const content = fs.readFileSync(fullPath, 'utf-8');
    
    res.json({
      success: true,
      fileName: cleanFileName,
      content,
      filePath: fullPath
    });
    
  } catch (error: any) {
    res.status(500).json({ 
      error: 'Failed to read story file',
      details: error.message 
    });
  }
}