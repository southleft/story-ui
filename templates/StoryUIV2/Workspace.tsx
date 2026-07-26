/**
 * Story UI V2 — the workspace.
 *
 * Two states, one surface:
 *   HOME       "What should we build?" with the project's own design system
 *              named, suggestion chips, and recent work as live thumbnails.
 *   WORKSPACE  conversation rail on the left, the real Storybook preview on the
 *              right, the way every tool in this category works.
 *
 * The shell stays thin on purpose. Transport lives in useGeneration, the canvas
 * owns its own viewport state, and this file only decides what is on screen.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './workspace.css';
import { PreviewCanvas } from './PreviewCanvas';
import { useGeneration, waitForStory, type Verification } from './useGeneration';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thumbnails?: string[];
  elapsedMs?: number;
  suggestions?: string[];
  verification?: Verification;
  storyId?: string;
  fileName?: string;
  title?: string;
}

interface RecentStory {
  id: string;
  title: string;
  name: string;
}

interface WorkspaceProps {
  apiBase: string;
  onOpenStory?: (storyId: string) => void;
  onHandoff?: (fileName: string, title: string) => void;
}

const SUGGESTIONS = [
  'A pricing table with three tiers and a highlighted plan',
  'A data table with filters, sorting and row actions',
  'A settings page with tabbed sections',
  'A dashboard with stat tiles and a recent activity feed',
];

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * A recent-work thumbnail is a real story, which means a real Storybook runtime.
 * Mounting eight at once boots eight of them and stalls the home screen, so the
 * frame is only created once the card is actually scrolled into view.
 */
const LazyThumb: React.FC<{ storyId: string; title: string }> = ({ storyId, title }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <span ref={ref} className={`suiw-recent-thumb${visible ? '' : ' suiw-recent-thumb--idle'}`}>
      {visible ? (
        <iframe
          src={`/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`}
          title={title}
          loading="lazy"
          tabIndex={-1}
        />
      ) : null}
    </span>
  );
};

export const Workspace: React.FC<WorkspaceProps> = ({ apiBase, onOpenStory, onHandoff }) => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [designSystem, setDesignSystem] = useState<string>('');
  const [providers, setProviders] = useState<Array<{ type: string; name: string; models: string[] }>>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [considerations, setConsiderations] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<RecentStory[]>([]);
  const [activeStory, setActiveStory] = useState<{ id: string; title: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const threadRef = useRef<HTMLDivElement>(null);
  const { generate, cancel, steps, busy, error } = useGeneration(apiBase);

  const started = turns.length > 0;

  /* ---- project context ------------------------------------------------ */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/mcp/providers`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setProviders(data.providers?.filter((p: any) => p.configured) ?? []);
          setProvider(data.current?.provider?.toLowerCase?.() ?? '');
          setModel(data.current?.model ?? '');
          setConnected(true);
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
      try {
        const res = await fetch(`${apiBase}/mcp/canvas-config`);
        if (res.ok && !cancelled) setDesignSystem((await res.json()).importPath || '');
      } catch { /* optional */ }
      try {
        const res = await fetch(`${apiBase}/story-ui/considerations`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.hasConsiderations) setConsiderations(data.considerations || '');
        }
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  /* ---- recent work, straight from Storybook's own index --------------- */

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch(`/index.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const entries = (await res.json())?.entries ?? {};
      const seen = new Set<string>();
      const items: RecentStory[] = [];
      for (const [id, entry] of Object.entries<any>(entries)) {
        if (!entry.title?.startsWith('Generated/')) continue;
        if (entry.type !== 'story') continue;
        const base = id.split('--')[0];
        if (seen.has(base)) continue;
        seen.add(base);
        items.push({ id, title: entry.title.replace(/^Generated\//, ''), name: entry.name });
      }
      setRecent(items.reverse().slice(0, 8));
    } catch { /* index unavailable */ }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  /* ---- autoscroll ----------------------------------------------------- */

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, steps]);

  /* ---- send ----------------------------------------------------------- */

  const send = useCallback(async (text?: string) => {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;

    setInput('');
    const userTurn: Turn = { id: uid(), role: 'user', text: prompt };
    setTurns(prev => [...prev, userTurn]);

    const conversation = [...turns, userTurn].map(t => ({
      role: t.role === 'user' ? ('user' as const) : ('ai' as const),
      content: t.text,
    }));

    const result = await generate({
      prompt,
      provider: provider || undefined,
      model: model || undefined,
      considerations: considerations || undefined,
      conversation,
    });

    if (!result) return;

    // The file is written before Storybook has indexed it, so resolve the real
    // story id before pointing the canvas at it.
    let storyId = result.storybookId;
    if (storyId) {
      const resolved = await waitForStory(storyId);
      if (resolved) {
        setActiveStory({ id: resolved, title: result.title || 'Untitled' });
        setReloadToken(t => t + 1);
        storyId = resolved;
      }
    }

    setTurns(prev => [
      ...prev,
      {
        id: uid(),
        role: 'assistant',
        text: result.chatSummary || (result.success ? `Created ${result.title}.` : 'That generation did not succeed.'),
        elapsedMs: result.elapsedMs,
        suggestions: result.suggestions,
        verification: result.verification,
        storyId,
        fileName: result.fileName,
        title: result.title,
      },
    ]);
    loadRecent();
  }, [input, busy, turns, provider, model, considerations, generate, loadRecent]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const models = useMemo(
    () => providers.find(p => p.type === provider)?.models ?? [],
    [providers, provider],
  );

  /* ---- composer, shared by both states -------------------------------- */

  const composer = (
    <div className="suiw-composer">
      <div className="suiw-composer-box">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={started ? 'Describe a change, or ask for something new' : 'Describe the interface you want to build'}
          aria-label="Describe what to build"
          rows={started ? 2 : 3}
        />
        <div className="suiw-composer-row">
          {designSystem && (
            <span className="suiw-chip" title="Generated using the design system installed in this project">
              {designSystem}
            </span>
          )}
          <span className="suiw-composer-spacer" />
          {providers.length > 0 && (
            <>
              <span className="suiw-select">
                <select value={provider} onChange={e => setProvider(e.target.value)} aria-label="Provider">
                  {providers.map(p => (
                    <option key={p.type} value={p.type}>{p.name}</option>
                  ))}
                </select>
              </span>
              <span className="suiw-select">
                <select value={model} onChange={e => setModel(e.target.value)} aria-label="Model">
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </span>
            </>
          )}
          {busy ? (
            <button type="button" className="suiw-btn suiw-btn--outline" onClick={cancel}>Stop</button>
          ) : (
            <button
              type="button"
              className="suiw-btn suiw-btn--primary"
              onClick={() => send()}
              disabled={!input.trim()}
            >
              Build
            </button>
          )}
        </div>
      </div>
    </div>
  );

  /* ---- home ------------------------------------------------------------ */

  if (!started) {
    return (
      <div className="suiw">
        <header className="suiw-top">
          <span className="suiw-brand">
            <span className="suiw-brand-mark">S</span>
            Story UI
          </span>
          <span className="suiw-top-spacer" />
          <span className={`suiw-status ${connected === false ? 'suiw-status--off' : ''}`}>
            <span className="suiw-status-dot" />
            {connected === false ? 'Server unreachable' : 'Connected'}
          </span>
        </header>

        <div className="suiw-home">
          <div className="suiw-home-inner">
            <h1>What should we build?</h1>
            <p className="suiw-home-sub">
              {designSystem
                ? `Composed from ${designSystem}, the design system installed in this project.`
                : 'Composed from the design system installed in this project.'}
            </p>

            {composer}

            <div className="suiw-home-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" className="suiw-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>

            {recent.length > 0 && (
              <section className="suiw-home-section">
                <div className="suiw-home-section-head">
                  <h2>Recent work</h2>
                  <span>{recent.length} in this project</span>
                </div>
                <div className="suiw-recent">
                  {recent.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      className="suiw-recent-card"
                      onClick={() => {
                        setActiveStory({ id: r.id, title: r.title });
                        setTurns([{ id: uid(), role: 'assistant', text: `Opened ${r.title}.`, storyId: r.id, title: r.title }]);
                      }}
                    >
                      {/* A real render, not a screenshot — the thumbnail is the
                          story itself at half scale, mounted only when seen. */}
                      <LazyThumb storyId={r.id} title={r.title} />
                      <span className="suiw-recent-meta">
                        <span className="suiw-recent-name">{r.title}</span>
                        <span className="suiw-recent-time">{r.name}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---- workspace -------------------------------------------------------- */

  return (
    <div className="suiw">
      <header className="suiw-top">
        <span className="suiw-brand">
          <span className="suiw-brand-mark">S</span>
          Story UI
        </span>
        <span className="suiw-top-title">{activeStory?.title ?? 'Untitled'}</span>
        <span className="suiw-top-spacer" />
        <button
          type="button"
          className="suiw-btn"
          onClick={() => { setTurns([]); setActiveStory(null); loadRecent(); }}
        >
          New
        </button>
      </header>

      <div className="suiw-body">
        <div className="suiw-rail">
          <div className="suiw-thread" ref={threadRef}>
            {turns.map(turn => (
              <div key={turn.id} className={`suiw-turn suiw-turn--${turn.role}`}>
                <div className="suiw-turn-body">{turn.text}</div>

                {turn.verification && (
                  <div className={`suiw-verify suiw-verify--${turn.verification.outcome}`}>
                    <span>
                      {turn.verification.outcome === 'verified' && 'Verified in browser'}
                      {turn.verification.outcome === 'issues' && `${turn.verification.findings.filter(f => f.severity === 'blocker').length} issue(s) found`}
                      {turn.verification.outcome === 'not_verified' && 'Not verified'}
                    </span>
                    {typeof turn.verification.metrics?.focusables === 'number' && (
                      <span className="suiw-verify-metrics">
                        {turn.verification.metrics.focusables} focusable
                      </span>
                    )}
                  </div>
                )}

                {turn.elapsedMs != null && (
                  <div className="suiw-turn-meta">
                    <span>{(turn.elapsedMs / 1000).toFixed(1)}s</span>
                  </div>
                )}

                {turn.suggestions && turn.suggestions.length > 0 && (
                  <div className="suiw-turn-actions">
                    {turn.suggestions.slice(0, 3).map(s => (
                      <button key={s} type="button" className="suiw-chip" onClick={() => send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {steps.length > 0 && busy && (
              <div className="suiw-steps">
                {steps.map(s => (
                  <div key={s.id} className={`suiw-step suiw-step--${s.state}`}>
                    <span className="suiw-step-dot" />
                    <span className="suiw-step-label">{s.label}</span>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="suiw-verify suiw-verify--issues" role="alert">
                <span>{error}</span>
              </div>
            )}
          </div>

          {composer}
        </div>

        <PreviewCanvas
          storyId={activeStory?.id}
          title={activeStory?.title}
          reloadToken={reloadToken}
          busy={busy}
          onOpenInStorybook={() => activeStory && onOpenStory?.(activeStory.id)}
          onHandoff={() => {
            const last = [...turns].reverse().find(t => t.fileName);
            if (last?.fileName) onHandoff?.(last.fileName, last.title || 'Story');
          }}
        />
      </div>
    </div>
  );
};

export default Workspace;
