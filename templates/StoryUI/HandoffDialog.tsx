/**
 * Handoff dialog — take a finished story to a branch, and optionally a PR.
 *
 * This is the end of the workflow: the designer stops iterating and hands a link
 * to a product engineer. Because the story was generated against the design
 * system installed in this very repo, what the engineer receives is real
 * components and real styling rather than a spec to reimplement.
 *
 * The dialog is deliberately explicit about what will happen to the user's
 * repository before it happens. Pushing publishes work outside their machine,
 * so it is opt-in, off by default, and described in plain language.
 */

import React, { useEffect, useState } from 'react';

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
}

interface Props {
  apiBase: string;
  status: HandoffStatus;
  fileName: string;
  title: string;
  onClose: () => void;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'story';

export const HandoffDialog: React.FC<Props> = ({ apiBase, status, fileName, title, onClose }) => {
  const [branch, setBranch] = useState(`story-ui/${slug(title)}`);
  const [push, setPush] = useState(false);
  const [openPr, setOpenPr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HandoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Opening a PR requires pushing first; keep the two checkboxes coherent.
  useEffect(() => { if (!push) setOpenPr(false); }, [push]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/story-ui/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, title, branch, push, openPr }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError([data.error, data.detail].filter(Boolean).join(' — '));
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sui-handoff-backdrop" role="dialog" aria-modal="true" aria-label="Hand off story">
      <div className="sui-handoff">
        {!result ? (
          <>
            <h2 className="sui-handoff-title">Hand off “{title}”</h2>
            <p className="sui-handoff-sub">
              Commits this story to a new branch so a product engineer can integrate it.
              It already uses the components and styling from this repo’s design system.
            </p>

            <label className="sui-handoff-field">
              <span>Branch name</span>
              <input
                className="sui-handoff-input"
                value={branch}
                onChange={e => setBranch(e.target.value)}
                spellCheck={false}
              />
            </label>

            <label className="sui-handoff-check">
              <input
                type="checkbox"
                checked={push}
                disabled={!status.canPush}
                onChange={e => setPush(e.target.checked)}
              />
              <span>
                Push to <code>{status.remote || 'origin'}</code>
                {!status.canPush && <em> — no remote configured</em>}
              </span>
            </label>

            <label className="sui-handoff-check">
              <input
                type="checkbox"
                checked={openPr}
                disabled={!push || !status.canOpenPr}
                onChange={e => setOpenPr(e.target.checked)}
              />
              <span>
                Open a pull request
                {!status.canOpenPr && status.prUnavailableReason && <em> — {status.prUnavailableReason}</em>}
              </span>
            </label>

            <p className="sui-handoff-note">
              {push
                ? 'This will publish the branch to the remote, where others can see it.'
                : `Nothing leaves this machine. Only ${fileName} is committed — other changes in your working tree are left alone.`}
            </p>

            {error && <div className="sui-handoff-error" role="alert">{error}</div>}

            <div className="sui-handoff-actions">
              <button type="button" className="sui-chip" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="sui-context-primary" onClick={submit} disabled={busy || !branch.trim()}>
                {busy ? 'Working…' : push ? (openPr ? 'Commit, push & open PR' : 'Commit & push') : 'Commit to branch'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="sui-handoff-title">Handed off</h2>
            <dl className="sui-handoff-result">
              <dt>Branch</dt><dd><code>{result.branch}</code></dd>
              <dt>Commit</dt><dd><code>{result.commit}</code></dd>
              <dt>File</dt><dd><code>{result.file}</code></dd>
            </dl>
            {result.prUrl ? (
              <p className="sui-handoff-note">
                Pull request opened — send this to your engineer:{' '}
                <a href={result.prUrl} target="_blank" rel="noreferrer">{result.prUrl}</a>
              </p>
            ) : result.pushed ? (
              <p className="sui-handoff-note">Branch pushed. Open a PR from it when you’re ready.</p>
            ) : (
              <p className="sui-handoff-note">
                Committed locally on <code>{result.branch}</code>. You were on <code>{result.startedOn}</code> before this.
              </p>
            )}
            <div className="sui-handoff-actions">
              <button type="button" className="sui-context-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default HandoffDialog;
