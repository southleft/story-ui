/**
 * Version history — the reader that was never built.
 *
 * StoryHistoryManager has recorded every version of every story since long
 * before V2: prompt, full code, and parent link, in `.story-ui-history/`. The
 * generation pipeline already reads it to feed `previousCode` into an update.
 * Nothing has ever been able to LIST those versions or put one back.
 *
 * That matters because every follow-up rewrites the whole story file, so a
 * request to fix one small thing can damage a composition that was already
 * right — observed in testing, where an untargeted edit introduced a
 * verification blocker into a dashboard that had none. Without restore, the
 * rational response is to stop asking for changes, which is the opposite of
 * what an iteration tool is for.
 *
 * Restore writes a file the user already had, in a directory Story UI owns, and
 * takes a snapshot of the current contents first so that restoring is itself
 * undoable. It deliberately does NOT touch git: cutting a commit per edit would
 * write to a repository the user never agreed to. Version control stays an
 * explicit act, at handoff.
 */

import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { StoryHistoryManager } from '../../story-generator/storyHistory.js';
import { getManifestManager } from '../../story-generator/manifestManager.js';
import { logger } from '../../story-generator/logger.js';

export interface StoryVersionDeps {
  generatedStoriesPath: string;
}

/** Refuse anything that is not a plain story filename inside the generated dir. */
function resolveStoryPath(generatedDir: string, fileName: string): string | null {
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return null;
  }
  const dir = path.resolve(process.cwd(), generatedDir);
  const full = path.resolve(dir, fileName);
  // Belt and braces: even with the checks above, never write outside the dir.
  if (!full.startsWith(dir + path.sep)) return null;
  return full;
}

/**
 * GET /story-ui/versions/:fileName
 *
 * Code is omitted from the list on purpose — a dozen versions of a 350-line
 * dashboard is a megabyte of JSON to render a sidebar.
 */
export function makeListVersions(deps: StoryVersionDeps) {
  return function listVersions(req: Request, res: Response): void {
    try {
      const { fileName } = req.params;
      if (!resolveStoryPath(deps.generatedStoriesPath, fileName)) {
        res.status(400).json({ error: 'Invalid story file name' });
        return;
      }

      const history = new StoryHistoryManager(process.cwd()).getHistory(fileName);
      if (!history) {
        // Not an error: a story generated once has no prior version, and the
        // panel should show "no earlier versions" rather than a failure.
        res.json({ fileName, versions: [] });
        return;
      }

      /**
       * Order: newest first, with same-millisecond ties broken by INSERTION
       * order — later write on top.
       *
       * Restore writes two versions back to back: the snapshot of what was on
       * disk ("Superseded by restoring an earlier version"), then the restored
       * content ("Restored: …"). Both call Date.now(), and on a fast machine
       * they land in the same millisecond; a stable sort on timestamp alone
       * then leaves the SNAPSHOT on top. The listing flagged it current and
       * put the "Restored:" label one ordinal below — labels and flag looked
       * swapped while the disk was right both directions.
       *
       * The `current` flag itself comes from the history's own pointer rather
       * than from sort position: addVersion maintains currentVersionId as the
       * version whose content is on disk, so deriving "current" from ordering
       * was re-inferring a fact the record already states.
       */
      const ordered = history.versions
        .map((v, insertion) => ({ v, insertion }))
        .sort((a, b) => (b.v.timestamp - a.v.timestamp) || (b.insertion - a.insertion));
      const currentId = ordered.some(({ v }) => v.id === history.currentVersionId)
        ? history.currentVersionId
        : ordered[0]?.v.id;
      const versions = ordered.map(({ v }, i, all) => ({
        id: v.id,
        timestamp: v.timestamp,
        prompt: v.prompt,
        size: v.code?.length ?? 0,
        current: v.id === currentId,
        ordinal: all.length - i,
      }));

      res.json({ fileName, versions });
    } catch (error) {
      logger.error('listVersions failed', { error });
      res.status(500).json({ error: 'Could not read version history' });
    }
  };
}

/**
 * POST /story-ui/versions/:fileName/restore  body: { versionId }
 *
 * Snapshots the current contents as a new version first, so a user who reverts
 * too far is not stranded — which is exactly when they are least able to
 * reconstruct what they lost.
 */
export function makeRestoreVersion(deps: StoryVersionDeps) {
  return function restoreVersion(req: Request, res: Response): void {
    try {
      const { fileName } = req.params;
      const { versionId } = req.body || {};
      const target = resolveStoryPath(deps.generatedStoriesPath, fileName);
      if (!target) {
        res.status(400).json({ error: 'Invalid story file name' });
        return;
      }
      if (!versionId) {
        res.status(400).json({ error: 'versionId is required' });
        return;
      }

      const manager = new StoryHistoryManager(process.cwd());
      const history = manager.getHistory(fileName);
      const version = history?.versions.find(v => v.id === versionId);
      if (!version) {
        res.status(404).json({ error: 'That version is no longer available' });
        return;
      }
      if (!version.code) {
        res.status(422).json({ error: 'That version has no code recorded' });
        return;
      }

      // Record where we are before leaving it, so Restore is undoable.
      if (fs.existsSync(target)) {
        const current = fs.readFileSync(target, 'utf8');
        if (current !== version.code) {
          manager.addVersion(fileName, `Superseded by restoring an earlier version`, current);
        }
      }

      fs.writeFileSync(target, version.code, 'utf8');

      // The restored code becomes the current version, so the next update
      // builds on what the user is now looking at rather than on the edit they
      // just rejected.
      const restored = manager.addVersion(fileName, `Restored: ${version.prompt}`, version.code, version.id);

      // Keep the conversation in step: the manifest is what the workspace reads
      // to rebuild a thread, and leaving it describing the rejected edit would
      // make the chat disagree with the canvas.
      try {
        getManifestManager().upsert(fileName, {
          source: 'panel',
          metadata: { prompt: `Restored an earlier version: ${version.prompt}` },
        });
      } catch (manifestError) {
        logger.warn('[versions] manifest update after restore failed (non-fatal):', manifestError);
      }

      logger.log(`↩️  Restored ${fileName} to the version from ${new Date(version.timestamp).toISOString()}`);
      res.json({
        success: true,
        fileName,
        restoredFrom: { id: version.id, timestamp: version.timestamp, prompt: version.prompt },
        currentVersionId: restored.id,
      });
    } catch (error) {
      logger.error('restoreVersion failed', { error });
      res.status(500).json({ error: 'Could not restore that version' });
    }
  };
}
