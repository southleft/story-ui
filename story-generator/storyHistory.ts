import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface StoryVersion {
  id: string;
  timestamp: number;
  prompt: string;
  code: string;
  fileName: string;
  parentId?: string; // Links to previous version for iterations
}

export interface StoryHistory {
  storyId: string;
  title: string;
  versions: StoryVersion[];
  currentVersionId: string;
}

export class StoryHistoryManager {
  private historyDir: string;
  private histories: Map<string, StoryHistory> = new Map();

  constructor(projectRoot: string) {
    this.historyDir = path.join(projectRoot, '.story-ui-history');
    this.ensureHistoryDir();
    this.loadHistories();
  }

  private ensureHistoryDir() {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  private loadHistories() {
    if (!fs.existsSync(this.historyDir)) return;

    const files = fs.readdirSync(this.historyDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(this.historyDir, file), 'utf-8');
          const history = JSON.parse(content) as StoryHistory;
          this.histories.set(history.storyId, history);
        } catch (e) {
          console.warn(`Failed to load history file ${file}:`, e);
        }
      }
    }
  }

  private saveHistory(history: StoryHistory) {
    const filePath = path.join(this.historyDir, `${history.storyId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
    this.histories.set(history.storyId, history);
  }

  /**
   * Create a new story history or add a version to existing history
   */
  addVersion(
    fileName: string,
    prompt: string,
    code: string,
    parentVersionId?: string
  ): StoryVersion {
    // Extract story ID from filename (remove hash and extension)
    const storyId = fileName.replace(/-[a-f0-9]+\.stories\.tsx$/, '');
    
    let history = this.histories.get(storyId);
    
    const newVersion: StoryVersion = {
      id: crypto.randomBytes(8).toString('hex'),
      timestamp: Date.now(),
      prompt,
      code,
      fileName,
      parentId: parentVersionId
    };

    if (!history) {
      // Create new history
      history = {
        storyId,
        title: this.titleFromFileName(fileName),
        versions: [newVersion],
        currentVersionId: newVersion.id
      };
    } else {
      // Add version to existing history
      history.versions.push(newVersion);
      history.currentVersionId = newVersion.id;
    }

    this.saveHistory(history);
    return newVersion;
  }

  /**
   * Get the current version of a story by filename
   */
  getCurrentVersion(fileName: string): StoryVersion | null {
    const storyId = fileName.replace(/-[a-f0-9]+\.stories\.tsx$/, '');
    const history = this.histories.get(storyId);
    
    if (!history) return null;
    
    return history.versions.find(v => v.id === history.currentVersionId) || null;
  }

  /**
   * Get all versions for a story
   */
  getHistory(fileName: string): StoryHistory | null {
    const storyId = fileName.replace(/-[a-f0-9]+\.stories\.tsx$/, '');
    return this.histories.get(storyId) || null;
  }

  /**
   * Find a story by partial filename match
   */
  findStoryByPartialName(partialName: string): StoryHistory | null {
    for (const history of this.histories.values()) {
      if (history.title.toLowerCase().includes(partialName.toLowerCase()) ||
          history.storyId.toLowerCase().includes(partialName.toLowerCase())) {
        return history;
      }
    }
    return null;
  }

  private titleFromFileName(fileName: string): string {
    return fileName
      .replace(/-[a-f0-9]+\.stories\.tsx$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Clean up old versions, keeping only the last N versions
   */
  pruneHistory(maxVersionsPerStory: number = 10) {
    for (const history of this.histories.values()) {
      if (history.versions.length > maxVersionsPerStory) {
        // Sort by timestamp and keep only the latest versions
        history.versions.sort((a, b) => b.timestamp - a.timestamp);
        history.versions = history.versions.slice(0, maxVersionsPerStory);
        this.saveHistory(history);
      }
    }
  }
}
