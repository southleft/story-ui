/**
 * Manifest API Routes
 *
 * Exposes the story manifest (source of truth for story ↔ chat linkage) to
 * the StoryUIPanel and any other clients.
 *
 * GET  /story-ui/manifest              → full manifest
 * PATCH /story-ui/manifest/:fileName   → upsert or update an entry
 * DELETE /story-ui/manifest/:fileName  → remove an entry
 * POST /story-ui/manifest/reconcile    → scan disk and fix drift
 * GET  /story-ui/manifest/poll         → entries updated after ?since=<ISO>
 */

import { Request, Response } from 'express';
import { getManifestManager, ManifestMessage } from '../../story-generator/manifestManager.js';

// ── GET /story-ui/manifest ────────────────────────────────────────────────

export function manifestGetHandler(req: Request, res: Response): void {
  try {
    const manifest = getManifestManager();
    const stories = manifest.getAll();
    res.json({ version: 1, stories });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ── PATCH /story-ui/manifest/:fileName ───────────────────────────────────

export function manifestPatchHandler(req: Request, res: Response): void {
  try {
    const fileName = decodeURIComponent(req.params.fileName);
    if (!fileName || fileName.includes('..')) {
      res.status(400).json({ error: 'Invalid fileName' });
      return;
    }

    const {
      id, title, source, permanent,
      conversation, metadata,
    } = req.body;

    const manifest = getManifestManager();

    // If only conversation is being updated (chat progress patch), use the
    // lightweight updateConversation path to avoid overwriting other fields.
    if (
      conversation !== undefined &&
      !id && !title && !source && !permanent && !metadata
    ) {
      manifest.updateConversation(
        fileName,
        (conversation as ManifestMessage[]) ?? [],
      );
      const entry = manifest.get(fileName);
      res.json({ ok: true, entry: entry ?? null });
      return;
    }

    const entry = manifest.upsert(fileName, {
      id, title, source, permanent,
      conversation: conversation as ManifestMessage[] | undefined,
      metadata,
    });

    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ── DELETE /story-ui/manifest/:fileName ──────────────────────────────────

export function manifestDeleteHandler(req: Request, res: Response): void {
  try {
    const fileName = decodeURIComponent(req.params.fileName);
    if (!fileName || fileName.includes('..')) {
      res.status(400).json({ error: 'Invalid fileName' });
      return;
    }

    const manifest = getManifestManager();
    const existed = manifest.delete(fileName);
    res.json({ ok: true, existed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ── POST /story-ui/manifest/reconcile ────────────────────────────────────

export function manifestReconcileHandler(req: Request, res: Response): void {
  try {
    const manifest = getManifestManager();
    const report = manifest.reconcile();
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ── GET /story-ui/manifest/poll ───────────────────────────────────────────

export function manifestPollHandler(req: Request, res: Response): void {
  try {
    const { since } = req.query;
    const manifest = getManifestManager();
    const all = manifest.getAll();

    let entries = Object.values(all);

    if (since && typeof since === 'string') {
      const sinceMs = new Date(since).getTime();
      if (!isNaN(sinceMs)) {
        entries = entries.filter(
          e => new Date(e.updatedAt).getTime() > sinceMs,
        );
      }
    }

    res.json({ entries, serverTime: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
