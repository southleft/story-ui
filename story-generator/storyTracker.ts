import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';
import { logger } from './logger.js';
export interface StoryMapping {
  title: string;
  fileName: string;
  storyId: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
  prompt: string;
}

export class StoryTracker {
  private mappingFile: string;
  private mappings: Map<string, StoryMapping>;

  constructor(config: StoryUIConfig) {
    this.mappingFile = path.join(path.dirname(config.generatedStoriesPath), '.story-mappings.json');
    this.mappings = new Map();
    this.loadMappings();
  }

  /**
   * Load existing mappings from disk
   */
  private loadMappings(): void {
    try {
      if (fs.existsSync(this.mappingFile)) {
        const data = JSON.parse(fs.readFileSync(this.mappingFile, 'utf-8'));
        for (const mapping of data) {
          if (mapping && mapping.title && typeof mapping.title === 'string') {
            this.mappings.set(mapping.title.toLowerCase(), mapping);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load story mappings:', error);
      this.mappings = new Map();
    }
  }

  /**
   * Save mappings to disk
   */
  private saveMappings(): void {
    try {
      const data = Array.from(this.mappings.values());
      fs.writeFileSync(this.mappingFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save story mappings:', error);
    }
  }

  /**
   * Find an existing story by title
   */
  findByTitle(title: string): StoryMapping | undefined {
    if (!title || typeof title !== 'string') {
      return undefined;
    }
    // Normalize the title for comparison
    const normalizedTitle = title.toLowerCase().trim();

    // Try exact match first
    let mapping = this.mappings.get(normalizedTitle);
    if (mapping) return mapping;

    // Don't do fuzzy matching for titles - only exact matches
    // This prevents "Card" from matching "Card Layouts" or "Profile Card"
    // Users expect new stories when they request variations

    return undefined;
  }

  /**
   * Find an existing story by prompt similarity
   */
  findByPrompt(prompt: string): StoryMapping | undefined {
    if (!prompt || typeof prompt !== 'string') {
      return undefined;
    }
    const normalizedPrompt = prompt.toLowerCase().trim();

    // Remove common prefixes like "generate a", "create a", etc.
    const cleanPrompt = normalizedPrompt
      .replace(/^(generate|create|build|make|design|show|write|produce|construct|draft|compose|implement|add|render|display)\s+(a|an|the)?\s*/i, '')
      .trim();

    // Extract key terms from the prompt
    const promptKeywords = cleanPrompt.split(/\s+/).filter(word => word.length > 2);

    // Try to find by similar prompts
    for (const mapping of this.mappings.values()) {
      if (!mapping || !mapping.prompt || typeof mapping.prompt !== 'string') {
        continue;
      }
      const mappingPrompt = mapping.prompt.toLowerCase()
        .replace(/^(generate|create|build|make|design|show|write|produce|construct|draft|compose|implement|add|render|display)\s+(a|an|the)?\s*/i, '')
        .trim();

      // Exact match
      if (mappingPrompt === cleanPrompt) {
        return mapping;
      }

      // Fuzzy matching based on shared keywords
      const mappingKeywords = mappingPrompt.split(/\s+/).filter(word => word.length > 2);
      const sharedKeywords = promptKeywords.filter(word => mappingKeywords.includes(word));

      // Only consider it similar if 90% or more keywords match AND at least 4 keywords
      // This prevents false positives like "card" matching "card layouts" vs "card animations"
      const similarityThreshold = Math.max(4, Math.floor(promptKeywords.length * 0.9));
      if (sharedKeywords.length >= similarityThreshold && promptKeywords.length >= 4) {
        logger.log(`🔄 Found similar story: "${mapping.title}" (${sharedKeywords.length}/${promptKeywords.length} keywords match)`);
        return mapping;
      }
    }

    return undefined;
  }

  /**
   * Register a new or updated story
   */
  registerStory(mapping: StoryMapping): void {
    if (!mapping || !mapping.title || typeof mapping.title !== 'string') {
      console.warn('Invalid mapping provided to registerStory:', mapping);
      return;
    }
    const normalizedTitle = mapping.title.toLowerCase();

    // Check if we're updating an existing story
    const existing = this.findByTitle(mapping.title);

    if (existing) {
      // Update the existing mapping
      mapping.createdAt = existing.createdAt;
      mapping.updatedAt = new Date().toISOString();
    } else {
      // New story
      mapping.createdAt = new Date().toISOString();
      mapping.updatedAt = mapping.createdAt;
    }

    this.mappings.set(normalizedTitle, mapping);
    this.saveMappings();
  }

  /**
   * Remove a story mapping
   */
  removeStory(titleOrFileName: string): boolean {
    // Try to find by title first
    const byTitle = this.findByTitle(titleOrFileName);
    if (byTitle && byTitle.title && typeof byTitle.title === 'string') {
      this.mappings.delete(byTitle.title.toLowerCase());
      this.saveMappings();
      return true;
    }

    // Try to find by filename
    for (const [key, mapping] of this.mappings) {
      if (mapping.fileName === titleOrFileName) {
        this.mappings.delete(key);
        this.saveMappings();
        return true;
      }
    }

    return false;
  }

  /**
   * Get all story mappings
   */
  getAllMappings(): StoryMapping[] {
    return Array.from(this.mappings.values());
  }

  /**
   * Clean up orphaned mappings (stories that no longer exist)
   */
  cleanupOrphaned(generatedStoriesPath: string): number {
    let removed = 0;

    for (const [key, mapping] of this.mappings) {
      const filePath = path.join(generatedStoriesPath, mapping.fileName);
      if (!fs.existsSync(filePath)) {
        this.mappings.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.saveMappings();
    }

    return removed;
  }

  /**
   * Get the next available version for a title
   * If "Navigation Bar" exists, returns "Navigation Bar v2"
   * If "Navigation Bar v2" exists, returns "Navigation Bar v3", etc.
   *
   * This is only used for NEW stories (not updates to existing stories)
   */
  getNextVersionTitle(baseTitle: string): string {
    if (!baseTitle || typeof baseTitle !== 'string') {
      return baseTitle;
    }

    const normalizedBase = baseTitle.toLowerCase().trim();

    // Check if the exact title already exists
    if (!this.mappings.has(normalizedBase)) {
      return baseTitle; // No conflict, use as-is
    }

    // Find the highest existing version
    let highestVersion = 1;

    // Check for base title (v1 implicitly)
    if (this.mappings.has(normalizedBase)) {
      highestVersion = 1;
    }

    // Check for versioned titles (v2, v3, etc.)
    for (const existingTitle of this.mappings.keys()) {
      // Match patterns like "title v2", "title v3", etc.
      const versionMatch = existingTitle.match(new RegExp(`^${this.escapeRegex(normalizedBase)}\\s+v(\\d+)$`, 'i'));
      if (versionMatch) {
        const version = parseInt(versionMatch[1], 10);
        if (version > highestVersion) {
          highestVersion = version;
        }
      }
    }

    // Return the next version
    return `${baseTitle} v${highestVersion + 1}`;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
