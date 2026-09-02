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
   * History is keyed by the story FILE, not by its prompt-derived stem.
   *
   * The id used to strip the content hash — `pricing-cards-2b036bdd.stories.tsx`
   * and `pricing-cards-52a2a33e.stories.tsx` both became `pricing-cards` — so
   * two DIFFERENT stories generated from similar prompts shared one history
   * record, and each listed the other's versions as its own. The hash is
   * exactly the part that distinguishes them; only the extension goes.
   */
  private storyIdFor(fileName: string): string {
    return fileName.replace(/\.stories\.\w+$/, '');
  }

  /** The pre-fix key, so records written before the keying change stay reachable. */
  private legacyStoryIdFor(fileName: string): string {
    return fileName.replace(/-[a-f0-9]+\.stories\.tsx$/, '');
  }

  /**
   * This file's versions, read out of a possibly-shared record.
   *
   * A legacy history may hold several stories' versions under one collided
   * key. Each version records the fileName it was written for, so the record
   * can be split honestly: return only THIS file's versions, under the
   * per-file id. Returning a shared record whole is the bug the keying change
   * fixes; discarding it entirely would orphan every history written before
   * the change.
   */
  private fileView(record: StoryHistory | undefined, fileName: string): StoryHistory | null {
    if (!record) return null;

    const versions = record.versions.filter(v => v.fileName === fileName);
    if (versions.length === 0) return null;

    // Already strictly this file's record — hand back the live object so a
    // subsequent addVersion appends in place, exactly as before.
    if (versions.length === record.versions.length && record.storyId === this.storyIdFor(fileName)) {
      return record;
    }

    // The shared record's current pointer may name another file's version;
    // fall back to this file's newest.
    const current = versions.find(v => v.id === record.currentVersionId)
      ?? versions.reduce((a, b) => (b.timestamp >= a.timestamp ? b : a));

    return {
      storyId: this.storyIdFor(fileName),
      title: record.title,
      versions,
      currentVersionId: current.id,
    };
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
    const storyId = this.storyIdFor(fileName);

    // Adopt this file's versions from a shared legacy record on first write,
    // so upgrading the keying does not orphan what was already recorded. The
    // legacy file is left as it is — other stories' versions still live there.
    let history = this.getHistory(fileName) ?? undefined;

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
    const history = this.getHistory(fileName);

    if (!history) return null;

    return history.versions.find(v => v.id === history.currentVersionId) || null;
  }

  /**
   * Get all versions for a story — strictly this file's, never a sibling's
   * that happened to share a prompt-derived stem.
   */
  getHistory(fileName: string): StoryHistory | null {
    return this.fileView(this.histories.get(this.storyIdFor(fileName)), fileName)
      ?? this.fileView(this.histories.get(this.legacyStoryIdFor(fileName)), fileName);
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
    // The hash stays in the KEY (it is what tells two stories apart) but has
    // no place in a human-readable title.
    return fileName
      .replace(/-[a-f0-9]+\.stories\.\w+$/, '')
      .replace(/\.stories\.\w+$/, '')
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
