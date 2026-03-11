/**
 * ManifestManager
 *
 * Maintains a `.story-ui-manifest.json` file inside the generated stories
 * directory. This is the single source of truth linking story files on disk
 * to their chat conversation history — regardless of which client created them
 * (StoryUIPanel, Voice Canvas, or Claude Desktop via MCP).
 *
 * Design goals:
 * - Git-tracked alongside the story files so the history follows the project
 * - Every story write (from ANY source) upserts an entry
 * - Every story delete removes the entry atomically
 * - StoryUIPanel loads conversations from here instead of localStorage
 * - Reconciliation on server startup fixes any drift (manual file deletions, etc.)
 */

import fs from 'fs';
import path from 'path';
import { loadUserConfig } from './configLoader.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type ManifestSource = 'panel' | 'voice-canvas' | 'voice-save' | 'mcp-external';

export interface ManifestMessage {
  role: 'user' | 'ai';
  content: string;
}

export interface ManifestEntry {
  /** Slug-based storyId (e.g. "pricing-card-three-tiers-a1b2c3d4") */
  id: string;
  /** Filename on disk (e.g. "pricing-card-three-tiers-a1b2c3d4.stories.tsx") */
  fileName: string;
  /** Human-readable title */
  title: string;
  /** How this story was created */
  source: ManifestSource;
  /**
   * If true, this entry is never removed by reconciliation even if the file
   * temporarily disappears (e.g. voice-canvas.stories.tsx is recreated on demand).
   */
  permanent?: boolean;
  createdAt: string;
  updatedAt: string;
  /** Chat conversation — text only, max 50 messages, no base64 image data */
  conversation: ManifestMessage[];
  metadata: {
    provider?: string;
    model?: string;
    /** The original generation prompt */
    prompt?: string;
  };
}

interface Manifest {
  version: number;
  lastReconciled: string;
  /** Keyed by fileName for O(1) lookup and easy reconciliation */
  stories: Record<string, ManifestEntry>;
}

export interface ReconcileReport {
  added: string[];
  removed: string[];
  unchanged: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MANIFEST_FILE = '.story-ui-manifest.json';
const MAX_CONVERSATION = 50;
const FLUSH_DEBOUNCE_MS = 200;
const STORY_EXTENSIONS = ['.stories.tsx', '.stories.ts', '.stories.jsx', '.stories.js', '.stories.svelte', '.stories.vue'];

// ── Helpers ────────────────────────────────────────────────────────────────

function isStoryFile(name: string): boolean {
  return STORY_EXTENSIONS.some(ext => name.endsWith(ext)) && !name.startsWith('voice-canvas');
}

function isStoryFileIncludingCanvas(name: string): boolean {
  return STORY_EXTENSIONS.some(ext => name.endsWith(ext));
}

function truncateConversation(conv: ManifestMessage[]): ManifestMessage[] {
  return conv.slice(-MAX_CONVERSATION);
}

// ── ManifestManager ────────────────────────────────────────────────────────

export class ManifestManager {
  private readonly manifestPath: string;
  private readonly storiesDir: string;
  private manifest: Manifest;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storiesDir: string) {
    this.storiesDir = path.resolve(process.cwd(), storiesDir);
    this.manifestPath = path.join(this.storiesDir, MANIFEST_FILE);
    this.manifest = this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load(): Manifest {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const raw = fs.readFileSync(this.manifestPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && parsed.stories) {
          return parsed as Manifest;
        }
      }
    } catch (err) {
      logger.warn('[manifest] Failed to load manifest, starting fresh:', err);
    }
    return { version: 1, lastReconciled: new Date().toISOString(), stories: {} };
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
  }

  private flush(): void {
    try {
      if (!fs.existsSync(this.storiesDir)) {
        fs.mkdirSync(this.storiesDir, { recursive: true });
      }
      // Atomic write: write to .tmp then rename
      const tmp = `${this.manifestPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.manifest, null, 2), 'utf-8');
      fs.renameSync(tmp, this.manifestPath);
    } catch (err) {
      logger.error('[manifest] Flush failed:', err);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Get all entries keyed by fileName */
  getAll(): Record<string, ManifestEntry> {
    return this.manifest.stories;
  }

  /** Get a single entry by fileName */
  get(fileName: string): ManifestEntry | undefined {
    return this.manifest.stories[fileName];
  }

  /**
   * Upsert a manifest entry. If the entry exists, merges the provided fields.
   * Conversation is merged (appended unique) and truncated to MAX_CONVERSATION.
   */
  upsert(
    fileName: string,
    data: Omit<Partial<ManifestEntry>, 'fileName'> & {
      id?: string;
      title?: string;
      source?: ManifestSource;
      conversation?: ManifestMessage[];
      metadata?: ManifestEntry['metadata'];
    },
  ): ManifestEntry {
    const existing = this.manifest.stories[fileName];
    const now = new Date().toISOString();

    // Strip base64 images from any message content that accidentally got through
    const safeConversation = (data.conversation ?? existing?.conversation ?? [])
      .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
      .filter(m => m.content.length > 0);

    const entry: ManifestEntry = {
      id: data.id ?? existing?.id ?? fileName.replace(/\.stories\.[a-z]+$/, ''),
      fileName,
      title: data.title ?? existing?.title ?? fileName,
      source: data.source ?? existing?.source ?? 'mcp-external',
      permanent: data.permanent ?? existing?.permanent,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      conversation: truncateConversation(safeConversation),
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(data.metadata ?? {}),
      },
    };

    this.manifest.stories[fileName] = entry;
    this.scheduleFlush();
    return entry;
  }

  /**
   * Update just the conversation for an existing entry (panel chat updates).
   * No-op if the entry doesn't exist.
   */
  updateConversation(fileName: string, conversation: ManifestMessage[]): void {
    const existing = this.manifest.stories[fileName];
    if (!existing) return;
    existing.conversation = truncateConversation(
      conversation.map(m => ({ role: m.role, content: m.content })),
    );
    existing.updatedAt = new Date().toISOString();
    this.scheduleFlush();
  }

  /** Delete a manifest entry. Returns true if it existed. */
  delete(fileName: string): boolean {
    if (!this.manifest.stories[fileName]) return false;
    delete this.manifest.stories[fileName];
    this.scheduleFlush();
    return true;
  }

  /**
   * Reconcile manifest against files on disk.
   * - Files on disk but not in manifest → add as `mcp-external`
   * - Entries in manifest but file missing → remove (unless `permanent: true`)
   */
  reconcile(): ReconcileReport {
    const report: ReconcileReport = { added: [], removed: [], unchanged: 0 };

    if (!fs.existsSync(this.storiesDir)) {
      return report;
    }

    const diskFiles = new Set(
      fs.readdirSync(this.storiesDir).filter(isStoryFileIncludingCanvas),
    );
    const manifestKeys = new Set(Object.keys(this.manifest.stories));

    // Files on disk not in manifest → add
    for (const file of diskFiles) {
      if (!manifestKeys.has(file)) {
        const filePath = path.join(this.storiesDir, file);
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
        const rawTitle = titleMatch ? titleMatch[1] : file.replace(/\.stories\.[a-z]+$/, '');
        const title = rawTitle.replace(/^Generated\//, '').replace(/\s*\([a-f0-9]{8}\)$/i, '').trim();
        const source: ManifestSource = file === 'voice-canvas.stories.tsx' ? 'voice-canvas' : 'mcp-external';

        this.manifest.stories[file] = {
          id: file.replace(/\.stories\.[a-z]+$/, ''),
          fileName: file,
          title,
          source,
          permanent: source === 'voice-canvas',
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
          conversation: [],
          metadata: {},
        };
        report.added.push(file);
      }
    }

    // Entries in manifest but file missing → remove (unless permanent)
    for (const key of manifestKeys) {
      if (!diskFiles.has(key)) {
        if (this.manifest.stories[key]?.permanent) continue;
        delete this.manifest.stories[key];
        report.removed.push(key);
      }
    }

    report.unchanged = Object.keys(this.manifest.stories).length - report.added.length;
    this.manifest.lastReconciled = new Date().toISOString();

    if (report.added.length > 0 || report.removed.length > 0) {
      this.flush(); // flush immediately for reconcile
      logger.log(`[manifest] Reconciled: +${report.added.length} added, -${report.removed.length} removed`);
    }

    return report;
  }

  /**
   * One-time migration from `.story-mappings.json` (StoryTracker's file).
   * Runs only if the manifest is empty and the mappings file exists.
   * Preserves title/prompt/dates from StoryTracker; conversation stays empty
   * (will be populated by client-side migration from localStorage).
   */
  migrateFromStoryTracker(mappingsPath: string): void {
    if (Object.keys(this.manifest.stories).length > 0) return; // already has data

    try {
      if (!fs.existsSync(mappingsPath)) return;
      const raw = JSON.parse(fs.readFileSync(mappingsPath, 'utf-8'));
      if (!Array.isArray(raw)) return;

      let migrated = 0;
      for (const m of raw) {
        if (!m.fileName || !m.title) continue;
        const filePath = path.join(this.storiesDir, m.fileName);
        if (!fs.existsSync(filePath)) continue; // skip if file was deleted

        this.manifest.stories[m.fileName] = {
          id: m.storyId ?? m.fileName.replace(/\.stories\.[a-z]+$/, ''),
          fileName: m.fileName,
          title: m.title,
          source: 'mcp-external', // will be promoted to 'panel' by client migration
          createdAt: m.createdAt ?? new Date().toISOString(),
          updatedAt: m.updatedAt ?? new Date().toISOString(),
          conversation: [],
          metadata: { prompt: m.prompt },
        };
        migrated++;
      }

      if (migrated > 0) {
        this.flush();
        logger.log(`[manifest] Migrated ${migrated} entries from .story-mappings.json`);
      }
    } catch (err) {
      logger.warn('[manifest] Migration from story-mappings failed:', err);
    }
  }

  /** Flush any pending writes synchronously (e.g., on server shutdown). */
  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

let _instance: ManifestManager | null = null;

/**
 * Returns the shared ManifestManager instance, creating it lazily on first call.
 * All server routes should use this rather than constructing their own instance.
 */
export function getManifestManager(): ManifestManager {
  if (!_instance) {
    const config = loadUserConfig();
    const storiesDir = config.generatedStoriesPath || './src/stories/generated/';
    _instance = new ManifestManager(storiesDir);

    // One-time migration from StoryTracker on first init
    const mappingsPath = path.join(
      path.dirname(path.resolve(process.cwd(), storiesDir)),
      '.story-mappings.json',
    );
    _instance.migrateFromStoryTracker(mappingsPath);

    // Reconcile disk vs manifest
    _instance.reconcile();
  }
  return _instance;
}

/** Reset the singleton (for testing / config reload). */
export function resetManifestManager(): void {
  if (_instance) _instance.flushSync();
  _instance = null;
}
