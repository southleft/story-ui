/**
 * Handoff — the end of the workflow.
 *
 * A designer iterates until the composition is right, then hands a link to a
 * product engineer. Because the story was generated from the design system
 * actually installed in this project, what the engineer receives is real
 * components and real styling rather than a redline.
 *
 * This is the only surface in Story UI that writes to version control and can
 * publish outside the user's machine, so nothing here happens implicitly:
 * opening the dialog only READS repository status, push and pull-request are
 * opt-in and default off, and the server refuses to commit on the current
 * branch or to stage anything but the one named story file.
 */

import { apiFetch } from './api';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  Flex,
  Link,
  Text,
  TextField,
} from '@radix-ui/themes';

interface HandoffStatus {
  available: boolean;
  reason?: string;
  branch?: string;
  remote?: string | null;
  canPush?: boolean;
  canOpenPr?: boolean;
  prUnavailableReason?: string;
}

interface HandoffResult {
  success: boolean;
  branch: string;
  startedOn: string;
  commit: string;
  file: string;
  pushed: boolean;
  prUrl?: string;
  /** The branch we actually returned to, absent if the checkout back failed. */
  returnedTo?: string;
}

interface HandoffDialogProps {
  apiBase: string;
  /** The story to hand off. Null closes the dialog. */
  target: { fileName: string; title: string } | null;
  onClose: () => void;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'story';

export const HandoffDialog: React.FC<HandoffDialogProps> = ({ apiBase, target, onClose }) => {
  const [status, setStatus] = useState<HandoffStatus | null>(null);
  const [branch, setBranch] = useState('');
  const [push, setPush] = useState(false);
  const [openPr, setOpenPr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HandoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset per target so a second handoff never shows the first one's result.
  useEffect(() => {
    if (!target) return;
    setStatus(null);
    setResult(null);
    setError(null);
    setPush(false);
    setOpenPr(false);
    setBranch(`story-ui/${slug(target.title)}`);

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${apiBase}/story-ui/handoff/status`);
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) {
          setStatus({ available: false, reason: 'Could not reach the Story UI server' });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [target, apiBase]);

  const submit = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`${apiBase}/story-ui/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: target.fileName,
          title: target.title,
          branch: branch.trim() || undefined,
          push,
          // A pull request implies a push; asking for one without the other
          // would fail server-side for a reason the user never chose.
          openPr: openPr && push,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || `Handoff failed (${res.status})`);
      setResult(data);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [apiBase, target, branch, push, openPr]);

  const canSubmit = !!status?.available && !busy && !!branch.trim();

  return (
    <Dialog.Root open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Content maxWidth="480px" className="suiw-handoff">
        <Dialog.Title>Hand off this story</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          {target
            ? `Commits ${target.fileName} to a new branch so an engineer can pick it up.`
            : ''}
        </Dialog.Description>

        {!status && !result && (
          <Text size="2" color="gray">Checking the repository…</Text>
        )}

        {status && !status.available && !result && (
          <Callout.Root color="amber" size="1">
            <Callout.Text>{status.reason || 'Handoff is not available in this project.'}</Callout.Text>
          </Callout.Root>
        )}

        {status?.available && !result && (
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" mb="1" weight="medium">New branch</Text>
              <TextField.Root
                value={branch}
                onChange={e => setBranch(e.target.value)}
                placeholder="story-ui/my-story"
              />
              <Text as="div" size="1" color="gray" mt="1">
                Cut from <Badge color="gray" variant="soft">{status.branch}</Badge>, which is left untouched.
              </Text>
            </label>

            <label>
              <Flex gap="2" align="center">
                <Checkbox
                  checked={push}
                  disabled={!status.canPush}
                  onCheckedChange={v => {
                    const next = v === true;
                    setPush(next);
                    if (!next) setOpenPr(false);
                  }}
                />
                <Text size="2">Push the branch to {status.remote || 'the remote'}</Text>
              </Flex>
            </label>

            <label>
              <Flex gap="2" align="center">
                <Checkbox
                  checked={openPr}
                  disabled={!status.canOpenPr || !push}
                  onCheckedChange={v => setOpenPr(v === true)}
                />
                <Text size="2">Open a pull request</Text>
              </Flex>
            </label>

            {/* Explaining why beats hiding the control — "no remote" and "gh not
                authenticated" are both things the user can act on. */}
            {status.prUnavailableReason && (
              <Text size="1" color="gray">{status.prUnavailableReason}</Text>
            )}

            {error && (
              <Callout.Root color="red" size="1">
                <Callout.Text>{error}</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
        )}

        {result && (
          <Flex direction="column" gap="2">
            <Callout.Root color="green" size="1">
              <Callout.Text>
                Committed <strong>{result.file}</strong> to <strong>{result.branch}</strong> as{' '}
                {result.commit}.{result.pushed ? ' Pushed.' : ''}
              </Callout.Text>
            </Callout.Root>
            {result.prUrl && (
              <Text size="2">
                Pull request: <Link href={result.prUrl} target="_blank" rel="noreferrer">{result.prUrl}</Link>
              </Text>
            )}
            {/* Say what is true. Claiming "you are back on main" while the
                working tree sits on the handoff branch is worse than saying
                nothing — the user acts on it. */}
            <Text size="1" color="gray">
              {result.returnedTo
                ? `You are back on ${result.returnedTo}.`
                : `Your working tree is on ${result.branch} — switch back with: git checkout ${result.startedOn}`}
            </Text>
          </Flex>
        )}

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">{result ? 'Done' : 'Cancel'}</Button>
          </Dialog.Close>
          {!result && (
            <Button highContrast disabled={!canSubmit} onClick={submit} loading={busy}>
              {push ? (openPr ? 'Commit, push and open PR' : 'Commit and push') : 'Commit to branch'}
            </Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default HandoffDialog;
