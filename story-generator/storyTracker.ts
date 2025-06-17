import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';

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
          this.mappings.set(mapping.title.toLowerCase(), mapping);
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
    // Normalize the title for comparison
    const normalizedTitle = title.toLowerCase().trim();

    // Try exact match first
    let mapping = this.mappings.get(normalizedTitle);
    if (mapping) return mapping;

    // Try fuzzy matching for similar titles
    for (const [key, value] of this.mappings) {
      // Check if the key contains the normalized title or vice versa
      if (key.includes(normalizedTitle) || normalizedTitle.includes(key)) {
        return value;
      }

      // Check for very similar titles (e.g., "dashboard" vs "inventory dashboard")
      const keywords = normalizedTitle.split(/\s+/);
      const keyKeywords = key.split(/\s+/);

      // If all keywords from the shorter title are in the longer one
      const shortKeywords = keywords.length < keyKeywords.length ? keywords : keyKeywords;
      const longKeywords = keywords.length < keyKeywords.length ? keyKeywords : keywords;

      if (shortKeywords.every(word => longKeywords.includes(word))) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Find an existing story by prompt similarity
   */
  findByPrompt(prompt: string): StoryMapping | undefined {
    const normalizedPrompt = prompt.toLowerCase().trim();

    // Remove common prefixes like "generate a", "create a", etc.
    const cleanPrompt = normalizedPrompt
      .replace(/^(generate|create|build|make|design|show|write|produce|construct|draft|compose|implement|add|render|display)\s+(a|an|the)?\s*/i, '')
      .trim();

    // Try to find by similar prompts
    for (const mapping of this.mappings.values()) {
      const mappingPrompt = mapping.prompt.toLowerCase()
        .replace(/^(generate|create|build|make|design|show|write|produce|construct|draft|compose|implement|add|render|display)\s+(a|an|the)?\s*/i, '')
        .trim();

      if (mappingPrompt === cleanPrompt) {
        return mapping;
      }
    }

    return undefined;
  }

  /**
   * Register a new or updated story
   */
  registerStory(mapping: StoryMapping): void {
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
    if (byTitle) {
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
}
