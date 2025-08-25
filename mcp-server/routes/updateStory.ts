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
      // Use fileName to construct path and ensure proper extension
      cleanFileName = fileName;
    }
    
    // Smart extension handling to prevent double .stories extensions
    // First, remove any existing .stories.tsx or .stories.stories.tsx patterns
    cleanFileName = cleanFileName
      .replace(/\.stories\.stories\.tsx$/, '') // Remove double extension if present
      .replace(/\.stories\.tsx$/, '') // Remove single extension if present
      .replace(/\.stories$/, ''); // Remove partial extension if present
    
    // Now add the correct extension
    cleanFileName = cleanFileName + '.stories.tsx';
    
    // Determine if this should be saved as an edited story
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
      
      // Smart file name handling to prevent duplicate prefixes
      let finalFileName = cleanFileName;
      
      // If it's a generated story being edited for the first time, convert the prefix
      if (cleanFileName.startsWith('generated-')) {
        finalFileName = cleanFileName.replace(/^generated-/, 'edited-');
      }
      // If it doesn't start with 'edited-', add the prefix (for new stories)
      else if (!cleanFileName.startsWith('edited-')) {
        finalFileName = `edited-${cleanFileName}`;
      }
      // If it already starts with 'edited-', keep it as is (re-editing existing edited story)
      
      // Check if this file already exists in the edited directory
      // This is critical for re-editing scenarios to prevent duplicates
      const existingEditedPath = path.join(editedPath, finalFileName);
      if (fs.existsSync(existingEditedPath)) {
        // Update the existing edited file with the same name
        logger.log(`🔄 Updating existing edited story: ${finalFileName}`);
        targetPath = existingEditedPath;
      } else {
        // Check if there's an edited version with a different naming pattern
        // This handles edge cases where the file might exist with/without hash
        if (fs.existsSync(editedPath)) {
          const editedFiles = fs.readdirSync(editedPath);
          const baseNameWithoutHash = cleanFileName.replace(/-[a-f0-9]{8}/, '');
          
          // Find any existing file that matches the base name
          const existingFile = editedFiles.find(file => {
            const fileBase = file.replace(/-[a-f0-9]{8}/, '');
            return fileBase.includes(baseNameWithoutHash) || baseNameWithoutHash.includes(fileBase);
          });
          
          if (existingFile) {
            // Use the existing file name to prevent duplicates
            finalFileName = existingFile;
            logger.log(`🔄 Found existing edited story with different pattern: ${existingFile}`);
          }
        }
        
        targetPath = path.join(editedPath, finalFileName);
      }
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
    logger.log(`🔍 File name resolution: ${fileName} → ${cleanFileName} → ${path.basename(targetPath)}`);
    
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
  const { fileName, isEdited } = req.query;
  
  if (!fileName) {
    return res.status(400).json({ 
      error: 'Missing fileName parameter' 
    });
  }

  try {
    const config = loadUserConfig();
    
    // Clean the filename - remove any double extensions first
    let cleanFileName = String(fileName)
      .replace(/\.stories\.stories\.tsx$/, '.stories.tsx') // Fix double extension
      .replace(/\.stories\.tsx$/, '.stories.tsx'); // Keep single extension
    
    // If no extension, add it
    if (!cleanFileName.endsWith('.stories.tsx')) {
      if (cleanFileName.endsWith('.stories')) {
        cleanFileName = cleanFileName + '.tsx';
      } else {
        cleanFileName = cleanFileName + '.stories.tsx';
      }
    }
    
    const isEditedStory = isEdited === 'true' || String(fileName).startsWith('edited-');
    
    let fullPath: string | undefined;
    
    // Priority-based lookup: edited stories get priority in edited/ directory  
    if (isEditedStory) {
      // For edited stories, check edited/ directory first
      const editedDir = path.join(config.generatedStoriesPath, '..', 'edited');
      
      // Try multiple filename patterns to handle existing double-extension files
      const filenamesToTry = [
        cleanFileName, // Correct format: filename.stories.tsx
        cleanFileName.replace('.stories.tsx', '.stories.stories.tsx'), // Double extension format
      ];
      
      // Check edited directory with all possible filenames
      for (const tryFileName of filenamesToTry) {
        const editedPath = path.join(editedDir, tryFileName);
        if (fs.existsSync(editedPath)) {
          fullPath = editedPath;
          console.log(`✅ Found edited story at: ${editedPath}`);
          break;
        }
      }
      
      // If not found in edited, try generated directory
      if (!fullPath) {
        const generatedPath = path.join(config.generatedStoriesPath, cleanFileName);
        if (fs.existsSync(generatedPath)) {
          fullPath = generatedPath;
          console.log(`⚠️ Edited story not found, falling back to generated: ${generatedPath}`);
        }
      }
      
      // If still not found, try pattern matching
      if (!fullPath) {
        const baseFileName = cleanFileName.replace('.stories.tsx', '');
        
        // Check edited directory first with pattern matching
        if (fs.existsSync(editedDir)) {
          const editedFiles = fs.readdirSync(editedDir);
          const matchingEditedFile = editedFiles.find(file => 
            file.startsWith(baseFileName) && (file.endsWith('.stories.tsx') || file.endsWith('.stories.stories.tsx'))
          );
          if (matchingEditedFile) {
            fullPath = path.join(editedDir, matchingEditedFile);
            console.log(`✅ Found edited story by pattern: ${fullPath}`);
          }
        }
        
        // If still not found, check generated directory
        if (!fullPath) {
          const generatedDir = config.generatedStoriesPath;
          if (fs.existsSync(generatedDir)) {
            const generatedFiles = fs.readdirSync(generatedDir);
            const matchingGeneratedFile = generatedFiles.find(file => 
              file.startsWith(baseFileName) && file.endsWith('.stories.tsx')
            );
            if (matchingGeneratedFile) {
              fullPath = path.join(generatedDir, matchingGeneratedFile);
            }
          }
        }
        
        if (!fullPath) {
          return res.status(404).json({ 
            error: 'Story file not found',
            fileName: cleanFileName,
            searched: ['edited/', 'generated/'],
            baseFileName
          });
        }
      }
    } else {
      // For generated stories, check generated/ directory first
      fullPath = path.join(config.generatedStoriesPath, cleanFileName);
      
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
                searched: ['generated/', 'edited/'],
                baseFileName
              });
            }
          }
        }
      }
    }
    
    if (!fullPath) {
      return res.status(404).json({ 
        error: 'Story file not found',
        fileName: cleanFileName
      });
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