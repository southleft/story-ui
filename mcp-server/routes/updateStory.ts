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
    
    // Determine the target file path - save edited stories to edited/ subdirectory
    let targetPath: string;
    let cleanFileName: string;
    
    if (filePath) {
      // If full path is provided, extract the filename
      cleanFileName = path.basename(filePath);
    } else {
      // Use fileName to construct path
      cleanFileName = fileName.includes('.stories.tsx') 
        ? fileName 
        : `${fileName}.stories.tsx`;
    }
    
    // Ensure the filename has the .stories.tsx extension
    if (!cleanFileName.endsWith('.stories.tsx')) {
      cleanFileName = cleanFileName + '.stories.tsx';
    }
    
    // Check if this is an edited story (filename starts with 'edited-' or was previously in generated/)
    const isEditedStory = cleanFileName.startsWith('edited-') || 
                         cleanFileName.startsWith('generated-') ||
                         req.body.isEdited === true;
    
    if (isEditedStory) {
      // Save edited stories to the edited/ subdirectory
      const editedPath = path.join(config.generatedStoriesPath, '..', 'edited');
      
      // Ensure the edited directory exists
      if (!fs.existsSync(editedPath)) {
        fs.mkdirSync(editedPath, { recursive: true });
      }
      
      // Replace 'generated-' prefix with 'edited-' if present
      if (cleanFileName.startsWith('generated-')) {
        cleanFileName = cleanFileName.replace(/^generated-/, 'edited-');
      }
      
      targetPath = path.join(editedPath, cleanFileName);
    } else {
      // Save generated stories to the main generated directory
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
    
    // First, try to find the file in the generated directory
    let fullPath = path.join(config.generatedStoriesPath, cleanFileName);
    
    // If not found and it's an edited file, check the edited directory
    if (!fs.existsSync(fullPath)) {
      const editedPath = path.join(config.generatedStoriesPath, '..', 'edited', cleanFileName);
      if (fs.existsSync(editedPath)) {
        fullPath = editedPath;
      } else {
        // Also try to find files with a hash suffix (e.g., basic-card-781ccd01.stories.tsx)
        const baseFileName = cleanFileName.replace('.stories.tsx', '');
        const generatedDir = config.generatedStoriesPath;
        
        // Check if there's a file that starts with the base name
        if (fs.existsSync(generatedDir)) {
          const files = fs.readdirSync(generatedDir);
          const matchingFile = files.find(file => 
            file.startsWith(baseFileName) && file.endsWith('.stories.tsx')
          );
          
          if (matchingFile) {
            fullPath = path.join(generatedDir, matchingFile);
          } else {
            return res.status(404).json({ 
              error: 'Story file not found',
              fileName: cleanFileName,
              searched: [fullPath, editedPath],
              baseFileName
            });
          }
        }
      }
    }
    
    const content = fs.readFileSync(fullPath, 'utf-8');
    
    res.json({
      success: true,
      fileName: path.basename(fullPath),
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