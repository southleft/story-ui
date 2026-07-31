/**
 * History keying — strictly per story FILE.
 *
 * The id used to strip the content hash from the filename, so
 * `pricing-cards-2b036bdd.stories.tsx` and `pricing-cards-52a2a33e.stories.tsx`
 * — two DIFFERENT stories, generated minutes apart from similar prompts —
 * shared one history record, and each run's version list contained the other
 * run's generations. Observed live: run 2's GET /story-ui/versions listed
 * run 1's initial generation among its own versions.
 *
 * The hash is exactly the part that tells the files apart; only the extension
 * may be stripped. Legacy records written under the collided key are split by
 * the fileName each version carries, so upgrading does not orphan them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { StoryHistoryManager, type StoryHistory } from '../story-generator/storyHistory.js';
import { makeListVersions, makeRestoreVersion } from '../mcp-server/routes/storyVersions.js';

const FILE_A = 'pricing-cards-2b036bdd.stories.tsx';
const FILE_B = 'pricing-cards-52a2a33e.stories.tsx';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-history-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Minimal Express response double for calling route handlers directly. */
function mockRouteRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
}

describe('story history keying', () => {
  it('keeps histories separate for two files whose prompt-derived stems match', () => {
    // Same prompt, same title stem — only the content hash differs, exactly
    // the collision observed live.
    new StoryHistoryManager(root).addVersion(FILE_A, 'Create pricing cards', 'code-run-1');
    new StoryHistoryManager(root).addVersion(FILE_B, 'Create pricing cards', 'code-run-2');

    const manager = new StoryHistoryManager(root);
    const historyA = manager.getHistory(FILE_A);
    const historyB = manager.getHistory(FILE_B);

    expect(historyA!.versions.map(v => v.fileName)).toEqual([FILE_A]);
    expect(historyB!.versions.map(v => v.fileName)).toEqual([FILE_B]);
    expect(historyA!.versions[0].code).toBe('code-run-1');
    expect(historyB!.versions[0].code).toBe('code-run-2');
    expect(historyA!.storyId).not.toBe(historyB!.storyId);
  });

  it('getCurrentVersion never answers with another file\'s code', () => {
    const manager = new StoryHistoryManager(root);
    manager.addVersion(FILE_A, 'Create pricing cards', 'code-run-1');
    manager.addVersion(FILE_B, 'Create pricing cards', 'code-run-2');
    // A later edit to B must not become A's current version.
    manager.addVersion(FILE_B, 'Make the button red', 'code-run-2-edited');

    expect(manager.getCurrentVersion(FILE_A)!.code).toBe('code-run-1');
    expect(manager.getCurrentVersion(FILE_B)!.code).toBe('code-run-2-edited');
  });

  it('splits a legacy shared record by fileName instead of orphaning it', () => {
    // A record written by the OLD keying: both files' versions under the
    // hash-stripped stem, current pointing at B's version.
    const legacy: StoryHistory = {
      storyId: 'pricing-cards',
      title: 'Pricing Cards',
      versions: [
        { id: 'va', timestamp: 1000, prompt: 'Create pricing cards', code: 'code-A', fileName: FILE_A },
        { id: 'vb', timestamp: 2000, prompt: 'Create pricing cards', code: 'code-B', fileName: FILE_B },
      ],
      currentVersionId: 'vb',
    };
    const dir = path.join(root, '.story-ui-history');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pricing-cards.json'), JSON.stringify(legacy));

    const manager = new StoryHistoryManager(root);

    // Each file sees only its own versions out of the shared record.
    expect(manager.getHistory(FILE_A)!.versions.map(v => v.id)).toEqual(['va']);
    expect(manager.getHistory(FILE_B)!.versions.map(v => v.id)).toEqual(['vb']);
    // The shared current pointer named B's version; A's current is A's newest.
    expect(manager.getCurrentVersion(FILE_A)!.id).toBe('va');
    expect(manager.getCurrentVersion(FILE_B)!.id).toBe('vb');
  });

  it('adopts a file\'s legacy versions on the next write, leaving the sibling\'s intact', () => {
    const legacy: StoryHistory = {
      storyId: 'pricing-cards',
      title: 'Pricing Cards',
      versions: [
        { id: 'va', timestamp: 1000, prompt: 'Create pricing cards', code: 'code-A', fileName: FILE_A },
        { id: 'vb', timestamp: 2000, prompt: 'Create pricing cards', code: 'code-B', fileName: FILE_B },
      ],
      currentVersionId: 'vb',
    };
    const dir = path.join(root, '.story-ui-history');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pricing-cards.json'), JSON.stringify(legacy));

    const manager = new StoryHistoryManager(root);
    manager.addVersion(FILE_A, 'Add a subtitle', 'code-A2', manager.getCurrentVersion(FILE_A)!.id);

    // A fresh manager (a later request) sees A's continued thread under the
    // new key, with the legacy version adopted…
    const reloaded = new StoryHistoryManager(root);
    const historyA = reloaded.getHistory(FILE_A);
    expect(historyA!.versions.map(v => v.code)).toEqual(['code-A', 'code-A2']);
    expect(reloaded.getCurrentVersion(FILE_A)!.code).toBe('code-A2');

    // …and B's history is untouched by A's write.
    expect(reloaded.getHistory(FILE_B)!.versions.map(v => v.code)).toEqual(['code-B']);
  });

  it('flags the restored version current with its "Restored:" label after a restore', () => {
    /**
     * Restore writes two versions back to back: a snapshot of the rejected
     * edit ("Superseded by restoring an earlier version"), then the restored
     * content ("Restored: …"). Both call Date.now(), and on a fast machine
     * they land in the SAME millisecond — a stable timestamp sort then left
     * the snapshot on top, flagged current with the wrong label, while the
     * "Restored:" label sat one ordinal below. Observed live; the disk was
     * right both directions, only the listing swapped them.
     */
    const FILE = 'campus-events-fb39f0a6.stories.tsx';
    const generatedRel = path.join('stories', 'generated');
    const genDir = path.join(root, generatedRel);
    fs.mkdirSync(genDir, { recursive: true });

    const manager = new StoryHistoryManager(root);
    const v1 = manager.addVersion(FILE, 'Create a campus events page', 'code-v1');
    const v2 = manager.addVersion(FILE, 'Make the button red', 'code-v2', v1.id);
    fs.writeFileSync(path.join(genDir, FILE), 'code-v2');

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      // Force the observed tie: snapshot and restored share one millisecond.
      vi.spyOn(Date, 'now').mockReturnValue(v2.timestamp + 1000);

      const restoreRes = mockRouteRes();
      makeRestoreVersion({ generatedStoriesPath: generatedRel })(
        { params: { fileName: FILE }, body: { versionId: v1.id } } as any,
        restoreRes as any,
      );
      expect(restoreRes.statusCode).toBe(200);
      // Disk got the restored content.
      expect(fs.readFileSync(path.join(genDir, FILE), 'utf8')).toBe('code-v1');

      const listRes = mockRouteRes();
      makeListVersions({ generatedStoriesPath: generatedRel })(
        { params: { fileName: FILE } } as any,
        listRes as any,
      );
      expect(listRes.statusCode).toBe(200);
      const versions = listRes.body.versions as Array<{ id: string; prompt: string; current: boolean; ordinal: number }>;
      expect(versions).toHaveLength(4);

      // Exactly one current, and it is the version whose content is on disk,
      // carrying the "Restored:" label — not the snapshot beneath it.
      const current = versions.filter(v => v.current);
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(restoreRes.body.currentVersionId);
      expect(current[0].prompt).toBe('Restored: Create a campus events page');

      // Newest-first: the restored version tops the list; the snapshot of the
      // rejected edit sits one ordinal below with its own label.
      expect(versions[0].id).toBe(current[0].id);
      expect(versions[1].prompt).toBe('Superseded by restoring an earlier version');
      expect(versions[0].ordinal).toBe(4);

      // History's current pointer agrees with the disk byte-for-byte.
      expect(new StoryHistoryManager(root).getCurrentVersion(FILE)!.code).toBe('code-v1');
    } finally {
      process.chdir(originalCwd);
      vi.restoreAllMocks();
    }
  });

  it('restoring a version that was itself a restore does not stack the label', () => {
    /**
     * Restore labels the new current version "Restored: <source prompt>". When
     * the source is itself a restore, its prompt already starts with
     * "Restored: " — naively prefixing again produced
     * "Restored: Restored: Create a campus events page", one level deeper per
     * round trip. The label should say what the version IS, once.
     */
    const FILE = 'campus-events-11aa22bb.stories.tsx';
    const generatedRel = path.join('stories', 'generated');
    const genDir = path.join(root, generatedRel);
    fs.mkdirSync(genDir, { recursive: true });

    const manager = new StoryHistoryManager(root);
    const v1 = manager.addVersion(FILE, 'Create a campus events page', 'code-v1');
    manager.addVersion(FILE, 'Make the button red', 'code-v2', v1.id);
    fs.writeFileSync(path.join(genDir, FILE), 'code-v2');

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const restore = makeRestoreVersion({ generatedStoriesPath: generatedRel });

      // First restore: back to v1. Its label carries one prefix.
      const first = mockRouteRes();
      restore({ params: { fileName: FILE }, body: { versionId: v1.id } } as any, first as any);
      expect(first.statusCode).toBe(200);
      const restoredOnce = new StoryHistoryManager(root).getHistory(FILE)!
        .versions.find(v => v.id === first.body.currentVersionId)!;
      expect(restoredOnce.prompt).toBe('Restored: Create a campus events page');

      // Move the disk elsewhere so the second restore has something to change.
      fs.writeFileSync(path.join(genDir, FILE), 'code-v2');

      // Second restore: restore the restore.
      const second = mockRouteRes();
      restore({ params: { fileName: FILE }, body: { versionId: restoredOnce.id } } as any, second as any);
      expect(second.statusCode).toBe(200);
      const restoredTwice = new StoryHistoryManager(root).getHistory(FILE)!
        .versions.find(v => v.id === second.body.currentVersionId)!;

      // Still one prefix, and the right content on disk.
      expect(restoredTwice.prompt).toBe('Restored: Create a campus events page');
      expect(fs.readFileSync(path.join(genDir, FILE), 'utf8')).toBe('code-v1');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('still finds a plain filename recorded under the old full-filename key', () => {
    // Files without a hash (voice-canvas.stories.tsx) were keyed by their FULL
    // name under the old scheme; the legacy fallback must still reach them.
    const legacy: StoryHistory = {
      storyId: 'voice-canvas.stories.tsx',
      title: 'Voice Canvas',
      versions: [
        { id: 'v1', timestamp: 1000, prompt: 'Canvas', code: 'canvas-code', fileName: 'voice-canvas.stories.tsx' },
      ],
      currentVersionId: 'v1',
    };
    const dir = path.join(root, '.story-ui-history');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'voice-canvas.stories.tsx.json'), JSON.stringify(legacy));

    const manager = new StoryHistoryManager(root);
    expect(manager.getCurrentVersion('voice-canvas.stories.tsx')!.code).toBe('canvas-code');
  });
});
