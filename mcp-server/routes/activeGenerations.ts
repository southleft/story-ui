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

import type { Request, Response } from 'express';

export interface ActiveGeneration {
  /** The user's prompt, verbatim — the poller matches on it. */
  prompt: string;
  /** Target fileName when the request named one (updates); null for new stories. */
  fileName: string | null;
  /** Pipeline start, epoch ms — the same timestamp the pipeline itself uses. */
  startedAt: number;
}

const active = new Map<symbol, ActiveGeneration>();

/** Register at pipeline start. Returns the key for the matching unregister. */
export function registerActiveGeneration(entry: ActiveGeneration): symbol {
  const key = Symbol('story-ui-generation');
  active.set(key, entry);
  return key;
}

/** Remove in a finally — success, fallback and throw must all end here. */
export function unregisterActiveGeneration(key: symbol): void {
  active.delete(key);
}

export function listActiveGenerations(): ActiveGeneration[] {
  return [...active.values()];
}

/** GET /story-ui/active-generations */
export function activeGenerationsHandler(_req: Request, res: Response): void {
  res.json({ active: listActiveGenerations() });
}
