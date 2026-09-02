/**
 * Version history — undo for a tool that rewrites whole files.
 *
 * Every follow-up regenerates the entire story, so a request to fix one small
 * thing can damage a composition that was already right. Without a way back,
 * the rational response is to stop asking for changes — which defeats the point
 * of an iteration tool. Lovable's most-cited safety feature is exactly this.
 *
 * The versions have existed all along: StoryHistoryManager has recorded prompt
 * and full code for every generation since before V2, and the pipeline already
 * reads them to feed `previousCode` into updates. Nothing could ever list them
 * or put one back. This is that missing surface.
 */

import { apiFetch } from './api';
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Callout, Flex, Popover, ScrollArea, Text } from '@radix-ui/themes';
import { ClockIcon } from './icons';
import { humanizePropPath } from './copy';

export interface StoryVersionSummary {
  id: string;
  timestamp: number;
  prompt: string;
  size: number;
  current: boolean;
  ordinal: number;
}

interface VersionHistoryProps {
  apiBase: string;
  /** The story whose history to show. Null disables the control. */
  fileName?: string;
  /** Bumped by the caller after a generation, so the list stays truthful. */
  refreshToken?: number;
  onRestored?: (version: StoryVersionSummary) => void;
  disabled?: boolean;
}

/** List a story's versions, newest first as the server orders them. */
export async function fetchVersions(apiBase: string, fileName: string): Promise<StoryVersionSummary[]> {
  const res = await apiFetch(`${apiBase}/story-ui/versions/${encodeURIComponent(fileName)}`);
  if (!res.ok) throw new Error(`Could not load history (${res.status})`);
  return (await res.json())?.versions ?? [];
}

/** Put one version's content back on disk. Throws with the server's reason. */
export async function restoreVersion(apiBase: string, fileName: string, versionId: string): Promise<void> {
  const res = await apiFetch(`${apiBase}/story-ui/versions/${encodeURIComponent(fileName)}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Restore failed (${res.status})`);
}

/**
 * The version before the current one, or null when there is nothing to go
 * back to. What Cmd/Ctrl+Z restores — the same row the History popover would
 * list directly under "current".
 */
export function previousVersion(versions: StoryVersionSummary[]): StoryVersionSummary | null {
  const current = versions.find(v => v.current);
  const candidates = versions.filter(v => !v.current && (!current || v.ordinal < current.ordinal));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, v) => (v.ordinal > best.ordinal ? v : best));
}

const when = (ts: number): string => {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
};

export const VersionHistory: React.FC<VersionHistoryProps> = ({
  apiBase,
  fileName,
  refreshToken = 0,
  onRestored,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<StoryVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!fileName) return;
    setLoading(true);
    setError(null);
    try {
      setVersions(await fetchVersions(apiBase, fileName));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBase, fileName]);

  // Only fetch when the popover is actually open, and again after a generation
  // while it is open — a stale list here would offer to restore a version that
  // is no longer what the user thinks it is.
  useEffect(() => { if (open) load(); }, [open, refreshToken, load]);

  const restore = useCallback(async (version: StoryVersionSummary) => {
    if (!fileName) return;
    setBusyId(version.id);
    setError(null);
    try {
      await restoreVersion(apiBase, fileName, version.id);
      setOpen(false);
      onRestored?.(version);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  }, [apiBase, fileName, onRestored]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button
          size="1"
          variant="ghost"
          color="gray"
          disabled={!fileName || disabled}
          title={fileName ? 'Earlier versions of this story' : 'Generate a story to see its history'}
          className="suiw-history-trigger"
        >
          <ClockIcon />
          History
        </Button>
      </Popover.Trigger>

      <Popover.Content width="380px" maxHeight="440px">
        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">Earlier versions</Text>

          {loading && <Text size="1" color="gray">Loading…</Text>}

          {error && (
            <Callout.Root color="red" size="1">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}

          {!loading && !error && versions.length <= 1 && (
            <Text size="1" color="gray">
              This story has not been changed yet, so there is nothing to go back to.
            </Text>
          )}

          {versions.length > 1 && (
            <ScrollArea style={{ maxHeight: 340 }}>
              <Flex direction="column" gap="1" pr="2">
                {versions.map(v => (
                  <Flex
                    key={v.id}
                    align="start"
                    justify="between"
                    gap="2"
                    py="2"
                    style={{ borderBottom: '1px solid var(--gray-a4)' }}
                  >
                    <Flex direction="column" gap="1" minWidth="0">
                      <Flex align="center" gap="2">
                        <Text size="1" color="gray">v{v.ordinal}</Text>
                        {v.current && <Badge size="1" color="jade" variant="soft">current</Badge>}
                        <Text size="1" color="gray">{when(v.timestamp)}</Text>
                      </Flex>
                      {/* The prompt is what makes a version recognisable — a
                          timestamp alone tells the user nothing about which one
                          they want back. */}
                      <Text size="1" style={{ wordBreak: 'break-word' }}>{humanizePropPath(v.prompt)}</Text>
                    </Flex>

                    {!v.current && (
                      <Button
                        size="1"
                        variant="soft"
                        color="gray"
                        loading={busyId === v.id}
                        onClick={() => restore(v)}
                        style={{ flexShrink: 0 }}
                      >
                        Restore
                      </Button>
                    )}
                  </Flex>
                ))}
              </Flex>
            </ScrollArea>
          )}

          {versions.length > 1 && (
            // Said plainly because "restore" sounds destructive, and the fear of
            // losing current work is the reason people avoid undo.
            <Text size="1" color="gray">
              Restoring keeps your current version in the list, so this is reversible.
            </Text>
          )}
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
};

export default VersionHistory;
