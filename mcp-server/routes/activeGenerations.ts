/**
 * In-flight generation registry — the "server is still working" signal.
 *
 * A generation can legitimately outlive a client's recovery window (the panel
 * reloads when the new story file lands, then polls to recover the thread).
 * Before this existed the manifest entry appeared only at COMPLETION, so a
 * poller had no way to distinguish "the server is mid-pipeline" from "the
 * generation was lost" — observed live: a 4-minute recovery window expired 13
 * minutes before a legitimate completion landed, and the client gave up on
 * work that was still happening.
 *
 * An in-memory module map is sufficient: the MCP server is a single process,
 * and an entry that dies with the process describes a generation that died
 * with it.
 *
 * CONTRACT (the panel implements against exactly this):
 *   GET /story-ui/active-generations
 *   → { "active": [ { "prompt": string, "fileName": string | null, "startedAt": number } ] }
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';

export interface ActiveGeneration {
  /** Stable id, so a client can name this run when it wants to cancel it. */
  id: string;
  /** The user's prompt, verbatim — the poller matches on it. */
  prompt: string;
  /** Target fileName when the request named one (updates); null for new stories. */
  fileName: string | null;
  /** Pipeline start, epoch ms — the same timestamp the pipeline itself uses. */
  startedAt: number;
  /** Set by DELETE; the pipeline checks it between phases and stands down. */
  cancelled?: boolean;
  /**
   * Aborts the in-flight model call the moment Stop arrives. The phase-
   * boundary flag alone let a stopped run finish a 26s, 2.4k-token call,
   * validate it, reserve a title and re-run discovery before standing down.
   */
  controller: AbortController;
}

const active = new Map<string, ActiveGeneration>();

/**
 * Register at pipeline start. Returns the id, which is also sent to the client
 * so Stop can address this specific run.
 *
 * Keyed by a string rather than a Symbol because the id has to survive a trip
 * over HTTP — a Symbol cannot be named by the client that wants to cancel.
 */
export function registerActiveGeneration(entry: Omit<ActiveGeneration, 'id' | 'controller'>): string {
  const id = crypto.randomUUID();
  active.set(id, { ...entry, id, controller: new AbortController() });
  return id;
}

/** The signal a run's model calls should carry, so Stop cuts them off. */
export function cancellationSignal(id: string | undefined): AbortSignal | undefined {
  return id ? active.get(id)?.controller.signal : undefined;
}

/** Remove in a finally — success, fallback and throw must all end here. */
export function unregisterActiveGeneration(id: string): void {
  active.delete(id);
}

export function listActiveGenerations(): ActiveGeneration[] {
  return [...active.values()];
}

/**
 * Ask a running generation to stand down.
 *
 * Cooperative rather than forceful: there is no safe way to kill a pipeline
 * mid-write, so this sets a flag the pipeline reads at phase boundaries. An
 * unknown id is not an error — the run most likely just finished.
 */
export function cancelActiveGeneration(id: string): boolean {
  const entry = active.get(id);
  if (!entry) return false;
  entry.cancelled = true;
  entry.controller.abort(new Error('Generation stopped by the user'));
  return true;
}

/** Has this run been asked to stop? False for an id that is already gone. */
export function isGenerationCancelled(id: string | undefined): boolean {
  return !!(id && active.get(id)?.cancelled);
}

/** GET /story-ui/active-generations */
export function activeGenerationsHandler(_req: Request, res: Response): void {
  res.json({ active: listActiveGenerations() });
}

/** DELETE /story-ui/active-generations/:id */
export function cancelGenerationHandler(req: Request, res: Response): void {
  const id = String(req.params.id || '');
  const found = cancelActiveGeneration(id);
  // 200 either way: "already finished" is a perfectly good outcome for a
  // cancel request, and a 404 would make the client report a failure for it.
  res.json({ cancelled: found, reason: found ? 'asked to stand down' : 'no such generation in flight' });
}
