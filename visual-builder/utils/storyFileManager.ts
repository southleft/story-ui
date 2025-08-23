/**
 * Unified Story File Management System
 * 
 * This replaces the complex multi-path save logic with a simple, predictable system:
 * 1. Always save to the main /generated/ directory
 * 2. Overwrite existing files by default
 * 3. Optional backup creation (only when explicitly requested)
 * 4. No subdirectories, no versioning, no confusion
 */

import type { ComponentDefinition } from '../types/index';
import { updateStoryFile } from './storyFileUpdater';

export interface SaveOptions {
  /** Create a backup before overwriting (default: false) */
  createBackup?: boolean;
  /** Custom story name (optional) */
  storyName?: string;
}

export interface SaveResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  action: 'created' | 'updated';
  hasBackup?: boolean;
  error?: string;
}

/**
 * Save components to a story file using the new simplified architecture
 * Always saves to the main /generated/ directory, never creates subdirectories
 */
export async function saveStoryFile(
  filePath: string,
  components: ComponentDefinition[],
  options: SaveOptions = {}
): Promise<SaveResult> {
  try {
    const fileName = filePath.split('/').pop() || filePath;
    const storyName = options.storyName || 
                      fileName.replace('.stories.tsx', '').replace(/[-_]/g, ' ');

    // Use the existing updateStoryFile function with createBackup option
    const result = await updateStoryFile(filePath, components, storyName);

    if (result.success) {
      return {
        success: true,
        filePath,
        fileName,
        action: 'updated', // We don't distinguish between create/update anymore
        hasBackup: options.createBackup,
      };
    } else {
      return {
        success: false,
        action: 'updated',
        error: result.error || 'Unknown error occurred'
      };
    }
  } catch (error) {
    return {
      success: false,
      action: 'updated',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Get a clean filename for saving
 * Removes duplicate prefixes and ensures .stories.tsx extension
 */
export function getCleanFileName(originalName: string): string {
  let cleanName = originalName;
  
  // Remove duplicate "generated-" prefixes
  while (cleanName.startsWith('generated-generated-')) {
    cleanName = cleanName.replace(/^generated-/, '');
  }
  
  // Ensure .stories.tsx extension
  if (!cleanName.endsWith('.stories.tsx')) {
    cleanName = cleanName.replace(/\.tsx$/, '') + '.stories.tsx';
  }
  
  return cleanName;
}

/**
 * Convert a file path to a story name
 * Extracts a human-readable name from the file path
 */
export function filePathToStoryName(filePath: string): string {
  const fileName = filePath.split('/').pop() || filePath;
  return fileName
    .replace('.stories.tsx', '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase()); // Title case
}