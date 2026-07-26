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
import { fetchStoryIndex, resolveIndexedStoryId } from './useGeneration';

export interface ManifestMessage {
  role: 'user' | 'ai';
  content: string;
  thumbnails?: string[];
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
  metadata?: Record<string, any>;
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
