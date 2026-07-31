/**
 * Conversation continuity, backed by the manifest that already exists.
 *
 * `.story-ui-manifest.json` lives inside the generated stories directory and
 * has always recorded the chat behind every story — written by the server on
 * every generation, from any client. It is git-tracked, so the reasoning
 * travels with the code: when a story is handed off, the engineer receives the
 * conversation that produced it, not just the output.
 *
 * V1 read it. V2 did not, which is why reopening a story showed an empty chat
 * and there was no way to pick up where you left off. Nothing new is stored
 * here — this is the missing reader.
 *
 * Deliberately not localStorage: that is per-browser, lost on clear, and never
 * reaches the person you hand the work to.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchStoryIndex,
  resolveIndexedStoryId,
  RECOVERY_WINDOW_MS,
  RECOVERY_HARD_CEILING_MS,
  type PendingGeneration,
  type Verification,
} from './useGeneration';

export interface ManifestMessage {
  role: 'user' | 'ai';
  content: string;
  thumbnails?: string[];
}

/**
 * Compact verification summary the server persists with a completion.
 *
 * The live SSE result carries the full report — findings, evidence, selectors.
 * The manifest keeps only what the thread badge shows, because that is all a
 * restored conversation renders: the outcome, the reason when it could not
 * run, and the two counts. Absent on entries written before the field existed,
 * and absent MUST render as nothing — an old entry did not pass verification,
 * it predates it.
 */
export interface CompletionVerification {
  outcome: 'verified' | 'issues' | 'not_verified';
  reason?: string;
  /** Number of blocker-severity findings — what the "issues" badge counts. */
  blockers?: number;
  /** The census's focusable-element count, shown beside the badge. */
  focusables?: number;
}

export interface LastCompletion {
  code?: string;
  suggestions?: string[];
  generationTimeMs?: number;
  storybookId?: string;
  verification?: CompletionVerification;
}

export interface ManifestEntry {
  id: string;
  fileName: string;
  title: string;
  source: string;
  permanent?: boolean;
  createdAt: string;
  updatedAt: string;
  conversation: ManifestMessage[];
  metadata?: {
    prompt?: string;
    lastCompletion?: LastCompletion;
  } & Record<string, any>;
}

/**
 * What a thread turn needs to draw the verification badge — the same fields
 * whether they came from a live generation or a restored manifest entry.
 */
export interface VerificationSummary {
  outcome: Verification['outcome'];
  reason?: string;
  blockers: number;
  focusables?: number;
}

/** Collapse a live verification report to what the badge shows. */
export function summarizeVerification(v: Verification | undefined | null): VerificationSummary | undefined {
  if (!v) return undefined;
  return {
    outcome: v.outcome,
    reason: v.reason,
    blockers: (v.findings ?? []).filter(f => f.severity === 'blocker').length,
    focusables: typeof v.metrics?.focusables === 'number' ? v.metrics.focusables : undefined,
  };
}

/**
 * Read the persisted summary back off a manifest entry.
 *
 * Strict about the outcome: anything other than the three known values —
 * including the field simply not being there, on entries written by an older
 * server — returns undefined, and undefined renders no badge. Defaulting a
 * missing outcome to anything would claim a verification that never ran.
 */
export function verificationFromCompletion(
  completion: LastCompletion | undefined | null,
): VerificationSummary | undefined {
  const v = completion?.verification;
  if (!v) return undefined;
  if (v.outcome !== 'verified' && v.outcome !== 'issues' && v.outcome !== 'not_verified') return undefined;
  return {
    outcome: v.outcome,
    reason: typeof v.reason === 'string' ? v.reason : undefined,
    blockers: typeof v.blockers === 'number' ? v.blockers : 0,
    focusables: typeof v.focusables === 'number' ? v.focusables : undefined,
  };
}

/** A past piece of work, joined to the id Storybook actually indexed it under. */
export interface SessionSummary {
  fileName: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  /** Null when the story is in the manifest but not in Storybook's index. */
  storyId: string | null;
  entry: ManifestEntry;
}

/**
 * Strip V1's status header from a stored reply.
 *
 * The manifest is shared with the V1 panel, which renders replies that begin
 * `[SUCCESS] **Created: "Title"**`. V2 shows the model's prose directly, so a
 * restored conversation was the only place that marker surfaced — the same
 * sentence read one way when generated and another way when reopened.
 *
 * Rewriting the stored format would break V1, so this is presentation-only.
 * Failure text is preserved: only the bracket token goes, never the message.
 */
export function cleanReply(content: string): string {
  return content
    .replace(/^\[SUCCESS\]\s*\*\*(?:Created|Updated)[^*]*\*\*\s*\n+/, '')
    .replace(/^\[(?:ERROR|FAILED)\]\s*/, '')
    .trim();
}

/**
 * Wait for the reply of a generation whose SSE died with the preview iframe.
 *
 * The server finishes the generation regardless of the dead socket and
 * persists the whole conversation — reply appended — to the manifest, with
 * the prompt it answered in `metadata.prompt`. So the finished entry is the
 * one whose stored prompt matches the stash (and whose fileName matches, when
 * the stash was an update to a known file) and whose conversation ends with
 * the assistant. Matching on fileName alone is not enough: an update's entry
 * already existed, already ended with an older 'ai' turn, and would satisfy a
 * looser test before the new reply ever landed.
 *
 * The freshness tests matter as much as the identity tests. Matching on
 * prompt + fileName alone meant that resending an IDENTICAL prompt to the
 * same file within the skew window matched the previous run's entry — same
 * stored prompt, conversation already ending 'ai' — and restored a stale
 * conversation as if it were the answer. So a candidate must also be newer
 * than the stash's `startedAt` (minus a small skew — panel and server run on
 * the same machine, so 2s covers stamping slop without reopening the stale
 * window), and, when the stash recorded the entry's `updatedAt` at send time,
 * STRICTLY newer than that baseline.
 *
 * Resolves null when the window closes without the reply appearing — the
 * caller says so honestly rather than pretending nothing was in flight.
 *
 * The window is not fixed. A verification-repair pass legitimately runs far
 * past the base window, and giving up at four minutes showed the gave-up
 * message for a generation that later completed fine. So each cycle also
 * asks `/story-ui/active-generations` whether the server still claims this
 * generation (prompt equality, plus fileName when the stash has one) and,
 * while it does, keeps polling past the base window — the server is provably
 * still working. The decision table:
 *
 *   - before the base window elapses: keep polling (exactly as before).
 *   - past the base window, active entry still matches: keep polling.
 *   - past the base window, active entry gone: keep polling for a short
 *     grace (the manifest write lands just before the entry is removed in
 *     the server's `finally`, so the next poll or two needs to see it),
 *     then give up.
 *   - past the base window, no active entry ever seen: give up — the base
 *     window alone decides, exactly the old behaviour.
 *   - endpoint 404s (older server): feature off for the rest of the poll;
 *     base window alone decides, exactly the old behaviour.
 *   - the hard ceiling elapses: give up regardless. Never poll forever.
 */
const CLOCK_SKEW_MS = 2_000;

/** How long past the last active-generations sighting the poller keeps
 *  waiting for the manifest write to land. */
export const ACTIVE_GRACE_MS = 15_000;

interface ActiveGeneration {
  prompt: string;
  fileName: string | null;
  startedAt: number;
}

export async function pollForCompletedEntry(
  apiBase: string,
  pending: PendingGeneration,
  isCancelled: () => boolean = () => false,
): Promise<ManifestEntry | null> {
  const earliest = pending.startedAt - CLOCK_SKEW_MS;
  const since = new Date(earliest).toISOString();
  const baseline = pending.baselineUpdatedAt ? Date.parse(pending.baselineUpdatedAt) : NaN;
  const baseDeadline = pending.startedAt + RECOVERY_WINDOW_MS;
  const hardDeadline = pending.startedAt + RECOVERY_HARD_CEILING_MS;

  // Whether this server has /story-ui/active-generations at all. A 404 turns
  // the extension off for the rest of the poll — absence of the endpoint must
  // not break recovery, it must merely not extend it.
  let activeSupported = true;
  // When the server's active list last contained this generation. 0 = never.
  let lastActiveMatchAt = 0;

  while (!isCancelled() && Date.now() < hardDeadline) {
    try {
      const res = await fetch(`${apiBase}/story-ui/manifest/poll?since=${encodeURIComponent(since)}`);
      if (res.ok) {
        const entries: ManifestEntry[] = (await res.json())?.entries ?? [];
        const entry = entries.find(e => {
          if (e.metadata?.prompt !== pending.prompt) return false;
          if (pending.fileName && e.fileName !== pending.fileName) return false;
          if (e.conversation?.[e.conversation.length - 1]?.role !== 'ai') return false;
          // Freshness: the server stamps updatedAt on every write, so an
          // entry that cannot prove it is newer than this request is not
          // this request's result.
          const updated = Date.parse(e.updatedAt || '');
          if (Number.isNaN(updated) || updated < earliest) return false;
          if (!Number.isNaN(baseline) && updated <= baseline) return false;
          return true;
        });
        if (entry) return entry;
      }
    } catch { /* server busy — keep polling */ }

    if (activeSupported && !isCancelled()) {
      try {
        const res = await fetch(`${apiBase}/story-ui/active-generations`);
        if (res.status === 404) {
          activeSupported = false;
        } else if (res.ok) {
          const active: ActiveGeneration[] = (await res.json())?.active ?? [];
          const match = active.some(a =>
            a?.prompt === pending.prompt &&
            (!pending.fileName || a.fileName === pending.fileName),
          );
          if (match) lastActiveMatchAt = Date.now();
        }
      } catch {
        // Transient failure says nothing either way — decide on what we last
        // knew. lastActiveMatchAt persists, so a blip while the server is
        // working costs at most the grace window, not the recovery.
      }
    }

    const now = Date.now();
    if (now >= baseDeadline) {
      if (!activeSupported) return null;
      const stillWorking = lastActiveMatchAt > 0 && now - lastActiveMatchAt < ACTIVE_GRACE_MS;
      if (!stillWorking) return null;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

export function useSessions(apiBase: string) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [res, index] = await Promise.all([
        fetch(`${apiBase}/story-ui/manifest`),
        fetchStoryIndex(),
      ]);
      if (!res.ok) { setLoaded(true); return; }
      const stories: Record<string, ManifestEntry> = (await res.json())?.stories ?? {};

      const list = Object.values(stories)
        // Story UI's own surfaces (Voice Canvas) are not the user's work.
        .filter(e => !e.permanent)
        // Ordered by when the conversation was last touched, which is what
        // "recent" means to someone picking work back up. Storybook's index
        // order is arbitrary.
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .map<SessionSummary>(entry => ({
          fileName: entry.fileName,
          title: entry.title,
          updatedAt: entry.updatedAt,
          messageCount: entry.conversation?.length ?? 0,
          storyId: resolveIndexedStoryId(index, entry.id, entry.title),
          entry,
        }));

      setSessions(list);
    } catch {
      /* server unreachable — the workspace still functions without history */
    } finally {
      setLoaded(true);
    }
  }, [apiBase]);

  useEffect(() => { reload(); }, [reload]);

  /** Look a session up by the file the story lives in. */
  const byFileName = useCallback(
    (fileName?: string) => (fileName ? sessions.find(s => s.fileName === fileName) ?? null : null),
    [sessions],
  );

  /**
   * Look a session up by a Storybook story id.
   *
   * Used by the "Edit in Story UI" toolbar button, which knows the story the
   * user is looking at but nothing about the file behind it.
   */
  const byStoryId = useCallback(
    (storyId?: string) => {
      if (!storyId) return null;
      const base = storyId.split('--')[0];
      return (
        sessions.find(s => s.storyId === storyId) ??
        sessions.find(s => s.storyId?.split('--')[0] === base) ??
        sessions.find(s => s.entry.id === base) ??
        null
      );
    },
    [sessions],
  );

  return { sessions, loaded, reload, byFileName, byStoryId };
}

/**
 * The manager toolbar button stashes its request here before navigating.
 *
 * sessionStorage rather than a query param because the manager and the docs
 * page are the same origin but different navigations, and a param would
 * survive a refresh and reopen a story the user had already moved on from.
 */
export const EDIT_REQUEST_KEY = 'story-ui-edit-request';

export interface EditRequest {
  componentId: string;
  title?: string;
}

export function takeEditRequest(): EditRequest | null {
  try {
    const raw = sessionStorage.getItem(EDIT_REQUEST_KEY);
    if (!raw) return null;
    // Consumed once: a refresh should not drag the user back to this story.
    sessionStorage.removeItem(EDIT_REQUEST_KEY);
    const parsed = JSON.parse(raw);
    return parsed?.componentId ? parsed : null;
  } catch {
    return null;
  }
}
