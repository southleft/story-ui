/**
 * Design Context editor.
 *
 * Design context is the highest-authority input to generation: files under
 * `story-ui-docs/` are read verbatim (code fences survive) and injected
 * immediately above the user's request, framed as overriding generic guidance.
 * Everything a team knows about how their design system expresses affordances,
 * composition, and state belongs here — so it gets a first-class surface rather
 * than living only as files a user has to discover.
 *
 * Deliberately edits `story-ui-docs/` and not `story-ui-considerations.md`: the
 * latter is parsed with a four-heading regex that discards code blocks and
 * several whole fields, so anything authored there loses fidelity in transit.
 */

import React, { useCallback, useEffect, useState } from 'react';

interface DocFile {
  name: string;
  chars: number;
  overBudget: boolean;
  updatedAt: string;
}

interface Budget {
  perFile: number;
  total: number;
  used: number;
  overBudget: boolean;
}

interface DesignContextPanelProps {
  /** Base URL of the Story UI MCP server. */
  apiBase: string;
  /** Configured design-system import path, used to pick a starter document. */
  importPath?: string;
  /** Called after any change that alters what the generator will receive. */
  onContextChanged?: () => void;
}

const NEW_DOC_TEMPLATE = `# New context document

<!--
  Anything written here is read verbatim by the generator on every generation
  and treated as overriding generic guidance. Code examples are the most
  effective content you can put here — models imitate concrete code far more
  reliably than they follow prose.
-->

`;

export const DesignContextPanel: React.FC<DesignContextPanelProps> = ({
  apiBase,
  importPath,
  onContextChanged,
}) => {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [exists, setExists] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const api = (p = '') => `${apiBase}/story-ui/design-context${p}`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api());
      if (!res.ok) throw new Error(`Failed to load design context (${res.status})`);
      const data = await res.json();
      setFiles(data.files || []);
      setBudget(data.budget || null);
      setExists(!!data.exists);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [apiBase]);

  useEffect(() => { refresh(); }, [refresh]);

  const openDoc = useCallback(async (name: string) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setError(null);
    try {
      const res = await fetch(api(`/${encodeURIComponent(name)}`));
      if (!res.ok) throw new Error(`Could not open ${name}`);
      const data = await res.json();
      setSelected(name);
      setContent(data.content || '');
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase, dirty]);

  const save = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api(`/${encodeURIComponent(selected)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const data = await res.json();
      setDirty(false);
      setStatus(
        data.overBudget
          ? `Saved — but this file is over the ${budget ? Math.round(budget.perFile / 1000) : 8}k limit and will be truncated.`
          : 'Saved. It applies to your next generation.',
      );
      await refresh();
      onContextChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), 4000);
    }
  }, [selected, content, budget, refresh, onContextChanged]);

  const scaffold = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api('/scaffold'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importPath }),
      });
      if (!res.ok) throw new Error(`Scaffold failed (${res.status})`);
      const data = await res.json();
      setStatus(
        data.created.length
          ? `Added ${data.created.join(', ')}.`
          : 'Starter documents already present — nothing overwritten.',
      );
      const fresh = await refresh();
      const first = data.created[0] || fresh?.files?.[0]?.name;
      if (first) await openDoc(first);
      onContextChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), 4000);
    }
  }, [importPath, refresh, openDoc, onContextChanged]);

  const createDoc = useCallback(async () => {
    const raw = window.prompt('New document name', 'my-patterns.md');
    if (!raw) return;
    const name = raw.endsWith('.md') ? raw : `${raw}.md`;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api(`/${encodeURIComponent(name)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: NEW_DOC_TEMPLATE }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Could not create ${name}`);
      }
      await refresh();
      await openDoc(name);
      onContextChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh, openDoc, onContextChanged]);

  const removeDoc = useCallback(async (name: string) => {
    if (!window.confirm(`Delete ${name}? The generator will stop seeing its rules.`)) return;
    setBusy(true);
    try {
      await fetch(api(`/${encodeURIComponent(name)}`), { method: 'DELETE' });
      if (selected === name) { setSelected(null); setContent(''); setDirty(false); }
      await refresh();
      onContextChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [selected, refresh, onContextChanged]);

  const pct = budget && budget.total > 0 ? Math.min(100, Math.round((budget.used / budget.total) * 100)) : 0;

  return (
    <div className="sui-context">
      <div className="sui-context-intro">
        <h2 className="sui-context-title">Design Context</h2>
        <p className="sui-context-sub">
          Teach the generator how your design system works. These documents are read
          verbatim on every generation and override generic guidance — the most reliable
          way to raise output fidelity. Code examples work better than prose.
        </p>
      </div>

      {error && <div className="sui-context-error" role="alert">{error}</div>}
      {status && <div className="sui-context-status" role="status">{status}</div>}

      {!exists || files.length === 0 ? (
        <div className="sui-context-empty">
          <p className="sui-context-empty-title">No design context yet</p>
          <p className="sui-context-empty-body">
            Right now the generator only knows your component names. Adding context is the
            single biggest lever on output quality — it is how you stop it substituting a
            styled box for a real input, or a bare icon for a button.
          </p>
          <button type="button" className="sui-context-primary" onClick={scaffold} disabled={busy}>
            {busy ? 'Creating…' : 'Create starter documents'}
          </button>
        </div>
      ) : (
        <div className="sui-context-body">
          <aside className="sui-context-list" aria-label="Context documents">
            <div className="sui-context-list-head">
              <span>Documents</span>
              <button type="button" onClick={createDoc} disabled={busy} title="New document">+</button>
            </div>
            {files.map(f => (
              <div
                key={f.name}
                className={`sui-context-item ${selected === f.name ? 'sui-context-item--active' : ''}`}
              >
                <button type="button" className="sui-context-item-open" onClick={() => openDoc(f.name)}>
                  <span className="sui-context-item-name">{f.name}</span>
                  <span className={`sui-context-item-size ${f.overBudget ? 'sui-context-item-size--over' : ''}`}>
                    {(f.chars / 1000).toFixed(1)}k
                  </span>
                </button>
                <button
                  type="button"
                  className="sui-context-item-delete"
                  onClick={() => removeDoc(f.name)}
                  aria-label={`Delete ${f.name}`}
                >×</button>
              </div>
            ))}

            {budget && (
              <div className="sui-context-budget">
                <div className="sui-context-budget-bar">
                  <div
                    className={`sui-context-budget-fill ${budget.overBudget ? 'sui-context-budget-fill--over' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="sui-context-budget-label">
                  {(budget.used / 1000).toFixed(1)}k / {(budget.total / 1000).toFixed(0)}k used
                  {budget.overBudget ? ' — over budget, content will be truncated' : ''}
                </span>
              </div>
            )}
          </aside>

          <section className="sui-context-editor">
            {selected ? (
              <>
                <div className="sui-context-editor-head">
                  <span className="sui-context-editor-name">{selected}</span>
                  <div className="sui-context-editor-actions">
                    {dirty && <span className="sui-context-dirty">Unsaved</span>}
                    <button
                      type="button"
                      className="sui-context-primary"
                      onClick={save}
                      disabled={busy || !dirty}
                    >{busy ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
                <textarea
                  className="sui-context-textarea"
                  value={content}
                  spellCheck={false}
                  onChange={e => { setContent(e.target.value); setDirty(true); }}
                  aria-label={`Contents of ${selected}`}
                />
                <div className="sui-context-editor-foot">
                  {(content.length / 1000).toFixed(1)}k characters
                  {budget && content.length > budget.perFile
                    ? ` — over the ${(budget.perFile / 1000).toFixed(0)}k per-file limit, the end will be truncated`
                    : ''}
                </div>
              </>
            ) : (
              <div className="sui-context-placeholder">Select a document to edit.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default DesignContextPanel;
