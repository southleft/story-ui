/**
 * Story UI V2 — the workspace.
 *
 * Two states, one surface:
 *   HOME       "What should we build?" with the project's own design system
 *              named, suggestion chips, and recent work as live thumbnails.
 *   WORKSPACE  conversation rail on the left, the real Storybook preview on the
 *              right, the way every tool in this category works.
 *
 * Everything visual is Radix Themes. The hand-rolled layer this replaced kept
 * producing the same class of defect — a reset that outranked its own button
 * classes, a 3.90:1 primary CTA, a composer row that clipped its own Build
 * button — none of which are problems worth solving twice. Radix owns surfaces,
 * type scale, spacing, focus rings and contrast; workspace.css owns only the
 * two-pane frame and the preview stage, which Radix has no opinion about.
 *
 * The `suiw-*` class names that remain are layout hooks and test selectors, not
 * styling.
 */

import { apiFetch } from './api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  DropdownMenu,
  Flex,
  Heading,
  IconButton,
  Kbd,
  Select,
  Separator,
  Text,
  TextArea,
  Theme,
  Tooltip,
} from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import './workspace.css';
import { PreviewCanvas, type PreviewCanvasHandle, type PreviewFailure } from './PreviewCanvas';
import { HandoffDialog } from './HandoffDialog';
import { ComponentsDrawer } from './ComponentsDrawer';
import { useAppearance, type AppearanceSetting } from './useAppearance';
import {
  useGeneration,
  waitForStory,
  readPendingGeneration,
  clearPendingGeneration,
  type Verification,
  type VerificationFinding,
} from './useGeneration';
import {
  useSessions,
  takeEditRequest,
  cleanReply,
  pollForCompletedEntry,
  summarizeVerification,
  verificationFromCompletion,
  isPartialVerification,
  deleteStory,
  type SessionSummary,
  type ManifestEntry,
  type VerificationSummary,
} from './useSessions';
import { processImageFiles, MAX_IMAGES, type AttachedImage } from './imageAttachments';
import { useVoiceInput } from './useVoiceInput';
import { describeTarget, targetLabel, type ElementTarget } from './elementTargeting';
import { PropertyPanel } from './PropertyPanel';
import {
  VersionHistory,
  fetchVersions,
  restoreVersion,
  previousVersion,
  type StoryVersionSummary,
} from './VersionHistory';

/** sessionStorage key for the story the workspace had open. */
const ACTIVE_KEY = 'story-ui-v2-active';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thumbnails?: string[];
  elapsedMs?: number;
  suggestions?: string[];
  /** What this instruction was pointed at, when the user selected an element. */
  target?: string;
  /**
   * Badge-ready summary rather than the full report, so a turn restored from
   * the manifest (which persists only the summary) and a live turn draw the
   * same badge from the same fields.
   */
  verification?: VerificationSummary;
  /**
   * The full findings, live turns only. The manifest persists just the
   * summary, so a restored turn has the badge and not the list — which is
   * honest: the list describes a render that happened in THIS session.
   */
  findings?: VerificationFinding[];
  /** Advice attached to the reply — read, never clicked. */
  notice?: string;
  /** The generation behind this reply did not produce a working story. */
  failed?: boolean;
  storyId?: string;
  fileName?: string;
  title?: string;
}

interface WorkspaceProps {
  apiBase: string;
  /**
   * Called with the story id when the user opens the story in Storybook.
   * When absent the workspace opens it in a new tab itself; a host that
   * passes this REPLACES that behaviour, so it should not navigate the
   * current window away from the workspace.
   */
  onOpenStory?: (storyId: string) => void;
  onHandoff?: (fileName: string, title: string) => void;
  /** 'auto' follows the host page (Storybook's theme, else the OS). */
  appearance?: AppearanceSetting;
}

/** What a send needs, kept so Retry can send exactly the same thing again. */
interface SendRequest {
  prompt: string;
  images: AttachedImage[];
  selection: ElementTarget | null;
}

/** True when the keyboard event came from somewhere text is being edited. */
const inTextField = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
};

/**
 * The manager URL for a story, for opening in a new tab.
 *
 * The workspace lives in the preview iframe; the manager is `window.top`,
 * same origin. Built from its pathname because Storybook can be served from
 * a sub-path. Falls back to this window when the top is not reachable.
 */
const storybookUrlFor = (storyId: string): string => {
  let base: Location = window.location;
  try {
    if (window.top && window.top.location.href) base = window.top.location;
  } catch { /* cross-origin top */ }
  return `${base.origin}${base.pathname}?path=/story/${encodeURIComponent(storyId)}`;
};

const SUGGESTIONS = [
  'A pricing table with three tiers and a highlighted plan',
  'A data table with filters, sorting and row actions',
  'A settings page with tabbed sections',
  'A dashboard with stat tiles and a recent activity feed',
];

/** "3 minutes ago" beats an ISO string when you are looking for where you left off. */
const relativeTime = (iso: string): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(then).toLocaleDateString();
};

const uid = () => Math.random().toString(36).slice(2, 10);

/** Append a spoken fragment to what is already typed, with exactly one space. */
const joinDictation = (base: string, spoken: string) => {
  const t = spoken.trim();
  if (!t) return base;
  return base ? `${base.replace(/\s+$/, '')} ${t}` : t;
};

/**
 * Elapsed time on the step that is currently running.
 *
 * The writing phase takes ~20-30s and, without this, nothing on screen changed
 * for that whole stretch — the difference between "working" and "hung" was
 * invisible. A counter is honest: it claims only that time is passing, which is
 * the one thing we actually know. Real token progress needs the provider to
 * surface stop_reason first (see callLLMStreaming in generationCore).
 */
const StepClock: React.FC<{ since: number }> = ({ since }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  if (secs < 2) return null; // no clock on steps that flash past
  const m = Math.floor(secs / 60);
  return (
    <Text size="1" color="gray" className="suiw-step-meta">
      {m ? `${m}:${String(secs % 60).padStart(2, '0')}` : `${secs}s`}
    </Text>
  );
};

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
    <span ref={ref} className={`suiw-thumb${visible ? '' : ' suiw-thumb--idle'}`}>
      {visible ? (
        <iframe
          src={`/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`}
          title={title}
          loading="lazy"
          tabIndex={-1}
        />
      ) : (
        <Text size="1" color="gray">Preview</Text>
      )}
    </span>
  );
};

const VERIFY_TONE: Record<Verification['outcome'], 'green' | 'amber' | 'gray'> = {
  verified: 'green',
  issues: 'amber',
  not_verified: 'gray',
};

const SEVERITY_TONE: Record<VerificationFinding['severity'], 'red' | 'amber' | 'gray'> = {
  blocker: 'red',
  warning: 'amber',
  info: 'gray',
};

/** The badge's label. "Verified" alone is only claimed when every check ran. */
const verificationLabel = (v: VerificationSummary): string => {
  if (v.outcome === 'issues') return `${v.blockers} issue(s) found`;
  if (v.outcome === 'not_verified') return 'Not verified';
  if (v.checksRun !== undefined && v.checksTotal !== undefined) {
    return `Verified · ${v.checksRun}/${v.checksTotal} checks`;
  }
  return 'Verified in browser';
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD = isMac ? '⌘' : 'Ctrl';

export const Workspace: React.FC<WorkspaceProps> = ({ apiBase, onOpenStory, onHandoff, appearance: appearanceSetting = 'auto' }) => {
  const appearance = useAppearance(appearanceSetting);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [designSystem, setDesignSystem] = useState<string>('');
  const [providers, setProviders] = useState<Array<{ type: string; name: string; models: string[] }>>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [considerations, setConsiderations] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const { sessions, loaded: sessionsLoaded, reload: reloadSessions, byStoryId, byFileName } = useSessions(apiBase);
  const [activeStory, setActiveStory] = useState<{ id: string; title: string } | null>(null);
  /**
   * Set when a story was written to disk but Storybook never indexed it.
   * Storybook's dev-server watcher stops delivering events after a while, and
   * when that happens the generation succeeded — saying nothing made it look
   * like the tool had failed.
   */
  const [notIndexed, setNotIndexed] = useState<{ fileName?: string; title?: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /**
   * The story the conversation is currently editing.
   *
   * Without this every follow-up produced a NEW story — the sidebar filled with
   * "… v2", "… v3", "… v4" clones of one idea, and "adjust the icons" could not
   * mean "in the thing we are looking at". Set whenever a story is generated or
   * reopened, cleared by New.
   */
  const [activeFile, setActiveFile] = useState<{ fileName: string; title: string } | null>(null);
  /**
   * The element the next instruction applies to.
   *
   * Without this the user has to describe WHICH thing they mean in prose, and
   * the model guesses — then rewrites the whole composition to be safe, which
   * is how a good dashboard picks up new problems while fixing a small one.
   */
  const [selection, setSelection] = useState<ElementTarget | null>(null);
  const [showProperties, setShowProperties] = useState(false);
  /**
   * The FILE's name for the selected element, resolved by the server.
   *
   * The click lands on whatever fiber rendered the pixel, which is often a
   * library internal — a Mantine Button reports "UnstyledButton". The property
   * lookup resolves the candidate chain against the story file and reports the
   * name the file contains; the chip and placeholder must say THAT name, or
   * the panel reads "Button" while the chip reads "UnstyledButton" and one of
   * them looks wrong. Null until resolved, and reset on every new pick so a
   * stale resolution can never label a different element.
   */
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  /** What the chip, placeholder and transcript call the selection. */
  const labeledSelection = selection
    ? (resolvedName && resolvedName !== selection.component
        ? { ...selection, component: resolvedName }
        : selection)
    : null;
  /**
   * The story the handoff dialog is acting on.
   *
   * Owned here rather than driven by the `onHandoff` prop, because that prop was
   * never wired in StoryUIV2.mdx — the button that ends the whole workflow
   * silently did nothing. A surface this important should not depend on a
   * template remembering to connect it. The prop is still called, so a host can
   * observe the handoff.
   */
  const [handoffTarget, setHandoffTarget] = useState<{ fileName: string; title: string } | null>(null);
  /**
   * The active story's source, for the Code view. From the completion for a
   * live turn, from the file for a reopened one, from the edit response after
   * a prop change. Null when there is nothing to show.
   */
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  /** A generation that ended without a working story, until the next send. */
  const [failure, setFailure] = useState<PreviewFailure | null>(null);
  /** The last request sent, so Retry after a transport error resends it. */
  const [retryRequest, setRetryRequest] = useState<SendRequest | null>(null);
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Per-finding outcome of "Select": the element was not found, and when. */
  const [findingNotes, setFindingNotes] = useState<Record<string, string>>({});
  const canvasRef = useRef<PreviewCanvasHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Images staged for the next message, already encoded for upload. */
  const [images, setImages] = useState<AttachedImage[]>([]);
  /**
   * How many recent-work cards to render.
   *
   * The header printed the full count while the grid rendered twelve, so on a
   * project with forty stories twenty-eight were unreachable from the UI. Each
   * card mounts a live Storybook iframe, so they are still revealed in batches
   * rather than all at once.
   */
  const RECENT_PAGE = 12;
  const [shownRecent, setShownRecent] = useState(RECENT_PAGE);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * True while polling the manifest for a generation whose SSE the iframe
   * reload killed. The server finishes regardless; this is the wait for its
   * persisted reply.
   */
  const [recovering, setRecovering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const threadRef = useRef<HTMLDivElement>(null);
  const { generate, cancel, steps, busy, error, errorInfo, notice } = useGeneration(apiBase);

  /**
   * Dictation. Interim results are shown in the textarea so speech feels live,
   * but only final results are committed — the committed text is tracked in a
   * ref so an interim fragment never contaminates what typing or the next
   * final fragment builds on.
   */
  const committedInputRef = useRef('');
  const voice = useVoiceInput({
    onInterimTranscript: t => setInput(joinDictation(committedInputRef.current, t)),
    onFinalTranscript: t => {
      committedInputRef.current = joinDictation(committedInputRef.current, t);
      setInput(committedInputRef.current);
    },
  });

  const started = turns.length > 0;

  /* ---- project context ------------------------------------------------ */

  /**
   * Probe the server and read its providers.
   *
   * Run once on mount, and again whenever a send fails at the transport —
   * the badge was checked exactly once, so a server that died after the
   * home screen loaded kept reading "Connected" beside a red error.
   */
  const checkConnection = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const res = await apiFetch(`${apiBase}/mcp/providers`);
      if (isCancelled()) return;
      if (res.ok) {
        const data = await res.json();
        if (isCancelled()) return;
        setProviders(data.providers?.filter((p: any) => p.configured) ?? []);
        // Keep a choice the user already made; only fill in the default when
        // nothing is selected yet (first probe, or the server came back).
        setProvider(prev => prev || (data.current?.provider?.toLowerCase?.() ?? ''));
        setModel(prev => prev || (data.current?.model ?? ''));
        setConnected(true);
      } else {
        // A reachable server that answers 500 is not "connected", and
        // leaving this null would sit on "Checking…" indefinitely.
        setConnected(false);
      }
    } catch {
      if (!isCancelled()) setConnected(false);
    }
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await checkConnection(() => cancelled);
      try {
        const res = await apiFetch(`${apiBase}/mcp/canvas-config`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          // The design system's own name ("Mantine") when the config declares
          // one, the import path ("@mantine/core") when it does not — an import
          // specifier is a fact, not a name, and the home subtitle reads it to
          // people. Older servers don't send designSystemName; the fallback
          // keeps them working.
          setDesignSystem(data.designSystemName || data.importPath || '');
        }
      } catch { /* optional */ }
      try {
        const res = await apiFetch(`${apiBase}/story-ui/considerations`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.hasConsiderations) setConsiderations(data.considerations || '');
        }
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [apiBase, checkConnection]);

  // A request that never reached a server means the badge is now wrong.
  useEffect(() => {
    if (errorInfo?.network) void checkConnection();
  }, [errorInfo, checkConnection]);

  /**
   * Read the story file for the Code view.
   *
   * The content route matches the file name directly, so no id derivation
   * is needed. Failures leave whatever was shown: the code view says "no
   * source" rather than the workspace raising an error over a view the user
   * may not even have open.
   */
  const loadCode = useCallback(async (fileName: string) => {
    setCodeLoading(true);
    try {
      const res = await apiFetch(`${apiBase}/mcp/stories/${encodeURIComponent(fileName)}/content`);
      if (res.ok) setCode(await res.text());
    } catch { /* leave the previous code */ } finally {
      setCodeLoading(false);
    }
  }, [apiBase]);

  /* ---- past work, from the manifest ----------------------------------- */

  /**
   * Restore a past conversation.
   *
   * The manifest has always held the chat behind every story; V2 just never
   * read it, so reopening work showed a single "Opened X." line and there was
   * no way to continue. Rebuilding the turns from it means a story can be
   * picked back up days later — which is the whole point of the workspace.
   */
  const openSession = useCallback((session: SessionSummary) => {
    const completion = session.entry.metadata?.lastCompletion;
    const restored: Turn[] = (session.entry.conversation ?? []).map((m, i, all) => ({
      id: `${session.fileName}-${i}`,
      role: m.role === 'user' ? 'user' : 'assistant',
      text: m.role === 'ai' ? cleanReply(m.content) : m.content,
      thumbnails: m.thumbnails,
      // The last assistant turn carries the file, so handoff and follow-up
      // edits act on this story rather than starting a new one. It also gets
      // the persisted completion back — timing, suggestion chips, and the
      // verification badge, which a reopened thread used to silently drop.
      // An entry without the summary (older server) gets no badge: absent
      // must not read as verified.
      ...(m.role === 'ai' && i === all.length - 1
        ? {
            fileName: session.fileName,
            title: session.title,
            storyId: session.storyId ?? undefined,
            suggestions: completion?.suggestions?.length ? completion.suggestions : undefined,
            elapsedMs: completion?.generationTimeMs,
            verification: verificationFromCompletion(completion),
          }
        : {}),
    }));

    setTurns(
      restored.length
        ? restored
        : [{ id: uid(), role: 'assistant', text: `Opened ${session.title}.`, fileName: session.fileName, title: session.title }],
    );
    setActiveStory(session.storyId ? { id: session.storyId, title: session.title } : null);
    setActiveFile({ fileName: session.fileName, title: session.title });
    setNotIndexed(session.storyId ? null : { fileName: session.fileName, title: session.title });
    setFailure(null);
    setSelection(null);
    setResolvedName(null);
    setFindingNotes({});
    setReloadToken(t => t + 1);
    // The persisted code is a fine first frame; the file is authoritative.
    setCode(completion?.code ?? null);
    void loadCode(session.fileName);
  }, [loadCode]);

  /**
   * Recover a generation the iframe reload cut off.
   *
   * Writing the story file makes Vite reload this very page, killing the SSE
   * stream — but the server finishes anyway and persists the reply to the
   * manifest. On remount: redraw the user's turn from the stash immediately,
   * poll for the finished entry, and rebuild the conversation from it exactly
   * as openSession does. The stash is cleared on success and on giving up;
   * giving up says so in the thread rather than leaving an empty chat.
   */
  const recoveryStarted = useRef(false);
  // When the recovered generation actually started, so the reconnecting row
  // can show elapsed time. Recovery now waits out long verification-repair
  // passes (the server proves it is still working via active-generations),
  // and a row that sits unchanged for ten minutes reads as frozen.
  const recoveringSince = useRef(0);
  useEffect(() => {
    if (recoveryStarted.current) return;
    recoveryStarted.current = true;
    const pending = readPendingGeneration();
    if (!pending) return;
    let cancelled = false;

    setTurns([{ id: uid(), role: 'user', text: pending.prompt }]);
    recoveringSince.current = pending.startedAt;
    setRecovering(true);
    if (pending.fileName) {
      setActiveFile({ fileName: pending.fileName, title: pending.title || 'Story' });
      // The story being updated is already on disk and indexed, so show it in
      // the canvas now — "Nothing to preview yet" beside "Reconnecting…" read
      // as a broken tool when the story was sitting one lookup away. Resolved
      // by title because the stash carries no story id; when nothing resolves
      // (or for a brand-new story with no fileName) the empty state stays —
      // never fabricate a preview. `prev ??` keeps a later, authoritative id
      // from the completed poll from being clobbered by this slower lookup.
      const title = pending.title;
      if (title) {
        void (async () => {
          const known = await waitForStory('', title, 8000);
          if (!cancelled && known) {
            setActiveStory(prev => prev ?? { id: known, title });
          }
        })();
      }
    }

    (async () => {
      const entry: ManifestEntry | null = await pollForCompletedEntry(apiBase, pending, () => cancelled);
      if (cancelled) return;
      clearPendingGeneration();
      setRecovering(false);

      if (!entry) {
        setTurns(prev => [...prev, {
          id: uid(),
          role: 'assistant',
          text: 'The preview reloaded during that generation and the finished result never appeared. It may still be completing on the server — check Recent work in a moment, or ask again.',
        }]);
        return;
      }

      const completion = entry.metadata?.lastCompletion;
      const restored: Turn[] = (entry.conversation ?? []).map((m, i, all) => ({
        id: `${entry.fileName}-${i}`,
        role: m.role === 'user' ? 'user' : 'assistant',
        text: m.role === 'ai' ? cleanReply(m.content) : m.content,
        thumbnails: m.thumbnails,
        ...(m.role === 'ai' && i === all.length - 1
          ? {
              fileName: entry.fileName,
              title: entry.title,
              suggestions: completion?.suggestions?.length ? completion.suggestions : undefined,
              elapsedMs: completion?.generationTimeMs,
              storyId: completion?.storybookId,
              // The badge the live path would have shown, rebuilt from the
              // persisted summary. Undefined when the entry predates the
              // field — no badge, never a claimed pass.
              verification: verificationFromCompletion(completion),
            }
          : {}),
      }));
      // Invariant: recovery must never erase a turn the user added after it
      // started. This effect seeded exactly one turn (the stashed prompt), so
      // anything beyond that is new work — in that case keep the thread as it
      // is and append only the recovered assistant reply, rather than
      // replacing the whole thread with the manifest's version.
      setTurns(prev => {
        if (prev.length <= 1) return restored;
        const lastAssistant = [...restored].reverse().find(t => t.role === 'assistant');
        return lastAssistant ? [...prev, lastAssistant] : prev;
      });
      setActiveFile({ fileName: entry.fileName, title: entry.title });
      setCode(completion?.code ?? null);
      void loadCode(entry.fileName);
      reloadSessions();

      const resolved = await waitForStory(completion?.storybookId || entry.id, entry.title);
      if (cancelled) return;
      if (resolved) {
        setActiveStory({ id: resolved, title: entry.title });
        setNotIndexed(null);
        setReloadToken(t => t + 1);
      } else {
        setNotIndexed({ fileName: entry.fileName, title: entry.title });
      }
    })();

    return () => {
      // Two jobs, and both matter. `cancelled` stops THIS run from touching
      // state after cleanup — including clearPendingGeneration, so the stash
      // survives for whoever takes over. Releasing the guard lets the next
      // run take over: under StrictMode the effect runs, is cleaned up, and
      // runs again, and without the release the second run bailed on the
      // guard while the first run's poll exited on `cancelled` before ever
      // reaching setRecovering(false) — leaving the spinner stuck true and
      // the edit-request effect blocked forever. On a genuine unmount the
      // release is moot: the ref dies with the instance.
      cancelled = true;
      recoveryStarted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The "Edit in Story UI" toolbar button hands us a story id and expects its
   * conversation to open. Runs once sessions are loaded, since resolving the id
   * to a session needs the manifest. Waits out a recovery in progress — the
   * recovered conversation must not be clobbered by an older stashed request.
   */
  const editRequestHandled = useRef(false);
  useEffect(() => {
    if (!sessionsLoaded || recovering || editRequestHandled.current) return;
    editRequestHandled.current = true;
    const request = takeEditRequest();
    if (request) {
      const session = byStoryId(request.componentId);
      if (session) openSession(session);
      return;
    }
    /**
     * Reopen the story that was active before the frame reloaded.
     *
     * The workspace lives in Storybook's preview iframe, and Storybook
     * reloads that frame when a story file changes — which the pipeline does
     * again AFTER the completion arrives (a repair pass writing, or restoring
     * the original). Mid-generation reloads were recovered from the pending
     * stash; a reload right after a finished run had nothing to recover from
     * and landed on Home, with the finished conversation one click away.
     */
    if (readPendingGeneration()) return;
    let active: string | null = null;
    try { active = sessionStorage.getItem(ACTIVE_KEY); } catch { /* private mode */ }
    if (!active) return;
    const session = byFileName(active);
    if (session) openSession(session);
  }, [sessionsLoaded, recovering, byStoryId, byFileName, openSession]);

  // Remember the active story across a preview-frame reload.
  useEffect(() => {
    try {
      if (activeFile?.fileName) sessionStorage.setItem(ACTIVE_KEY, activeFile.fileName);
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch { /* private mode */ }
  }, [activeFile]);

  /* ---- autoscroll ----------------------------------------------------- */

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, steps]);

  /* ---- send ----------------------------------------------------------- */

  /**
   * Whether a send can leave this machine at all.
   *
   * `connected` starts null (checking) and the providers list starts empty,
   * so the Build button is held until the probe answers; the card under the
   * composer says which of the two is missing and what to do about it.
   */
  const blocked: 'checking' | 'unreachable' | 'no-providers' | null =
    connected === null ? 'checking'
      : connected === false ? 'unreachable'
        : providers.length === 0 ? 'no-providers'
          : null;
  const canSend = blocked === null;

  const send = useCallback(async (text?: string, opts?: { images?: AttachedImage[]; selection?: ElementTarget | null }) => {
    const prompt = (text ?? input).trim();
    // `recovering` counts as busy here: a turn sent while recovery polls
    // would be replaced when the recovered conversation lands, and its reply
    // would append to the wrong thread. The reconnecting row already says
    // why the composer is waiting.
    if (!prompt || busy || recovering) return;

    if (voice.isListening) voice.stop();
    committedInputRef.current = '';
    setInput('');
    const sentImages = opts?.images ?? images;
    const sentSelection = opts?.selection !== undefined ? opts.selection : selection;
    const sentLabeled = sentSelection
      ? (sentSelection === selection ? labeledSelection : sentSelection)
      : null;
    setImages([]);
    setImageError(null);
    setFailure(null);
    setFindingNotes({});
    setRetryRequest({ prompt, images: sentImages, selection: sentSelection });
    // What the canvas showed before this send, restored if the send fails —
    // a fallback error story must never replace the composition the user
    // was iterating on.
    const before = { story: activeStory, code };
    // Shown on the turn so the transcript records what the instruction was
    // pointed at — six months later "make it bigger" means nothing on its own.
    const userTurn: Turn = {
      id: uid(), role: 'user', text: prompt,
      // The label the chip showed — the resolved name when the lookup answered.
      target: sentLabeled ? targetLabel(sentLabeled) : undefined,
      thumbnails: sentImages.length ? sentImages.map(i => i.preview) : undefined,
    };
    setSelection(null);
    setResolvedName(null);
    setTurns(prev => [...prev, userTurn]);

    const conversation = [...turns, userTurn].map(t => ({
      role: t.role === 'user' ? ('user' as const) : ('ai' as const),
      content: t.text,
      // The small composer previews, not the full-size upload payload. The
      // manifest keeps these on the message, and recovery/openSession read
      // them back — omitting them here stripped the reference image from the
      // turn on the very first iframe reload.
      thumbnails: t.thumbnails,
    }));

    // The server fires preview_ready the moment the file is written. Point the
    // canvas at it then; verification and repair narrate in the rail meanwhile.
    let previewShown = false;
    const result = await generate({
      prompt,
      // mediaType must describe the bytes we actually encoded — after
      // downscaling that can differ from the original file's type.
      images: sentImages.length
        ? sentImages.map(img => ({ type: 'base64' as const, data: img.base64, mediaType: img.mediaType }))
        : undefined,
      provider: provider || undefined,
      model: model || undefined,
      considerations: considerations || undefined,
      conversation,
      // Edit the story in front of us rather than spawning a sibling. Without
      // these two the server treated every follow-up as a brand new story.
      fileName: activeFile?.fileName,
      isUpdate: !!activeFile,
      originalTitle: activeFile?.title,
      selection: sentSelection ? describeTarget(sentSelection) : undefined,
      // When this updates an existing entry, record how fresh that entry is
      // right now — recovery then demands a STRICTLY newer one, so resending
      // an identical prompt can never re-match the previous completion.
      knownUpdatedAt: activeFile ? byFileName(activeFile.fileName)?.entry.updatedAt : undefined,
    }, async (preview) => {
      if (preview.code) setCode(preview.code);
      if (!preview.storybookId) return;
      const resolved = await waitForStory(preview.storybookId, preview.title);
      if (!resolved) return;
      setActiveStory({ id: resolved, title: preview.title || 'Untitled' });
      setReloadToken(t => t + 1);
      setNotIndexed(null);
      previewShown = true;
    });

    if (!result) {
      // The run died (transport error) or was stopped. Either way the prompt
      // goes back where it was typed — retyping it was the whole cost of a
      // dropped connection, and the error callout offers Retry as well.
      setInput(prev => prev || prompt);
      committedInputRef.current = committedInputRef.current || prompt;
      setImages(prev => (prev.length ? prev : sentImages));
      return;
    }

    if (!result.success) {
      // The server writes a fallback error story on failure so Storybook
      // stays consistent. That story is NOT the result, and must not become
      // what the canvas shows or what the next edit applies to.
      setActiveStory(before.story);
      setCode(before.code);
      if (before.story) setReloadToken(t => t + 1);
      setFailure({
        message: result.chatSummary || '',
        notice: result.notice,
        onRetry: () => { void send(prompt, { images: sentImages, selection: sentSelection }); },
        onEditPrompt: () => {
          setFailure(null);
          setInput(prompt);
          committedInputRef.current = prompt;
          setImages(sentImages);
          setSelection(sentSelection);
          textareaRef.current?.focus();
        },
      });
      setTurns(prev => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          text: 'That generation did not produce a working story.',
          notice: result.notice,
          elapsedMs: result.elapsedMs,
          verification: summarizeVerification(result.verification),
          findings: result.verification?.findings?.length ? result.verification.findings : undefined,
          failed: true,
        },
      ]);
      reloadSessions();
      return;
    }

    if (result.code) setCode(result.code);

    // The file is written before Storybook has indexed it, so resolve the real
    // story id before pointing the canvas at it.
    let storyId = result.storybookId;
    if (storyId && previewShown) {
      // Already on screen since preview_ready. A repair may have rewritten the
      // file since; one reload picks that up.
      setReloadToken(t => t + 1);
    } else if (storyId) {
      // Pass the title too: the id Storybook assigns may be derived from it
      // rather than from the filename slug the server reports.
      const resolved = await waitForStory(storyId, result.title);
      if (resolved) {
        setActiveStory({ id: resolved, title: result.title || 'Untitled' });
        setReloadToken(t => t + 1);
        setNotIndexed(null);
        storyId = resolved;
      } else {
        /**
         * The file is on disk; Storybook simply has not noticed it.
         *
         * Clearing activeStory matters as much as setting notIndexed. The
         * canvas renders `src ? iframe : busy ? … : notIndexed ? …`, so while
         * a previous story was still showing, the amber "not picked up"
         * callout was unreachable and the canvas kept displaying the OLD
         * composition — the assistant said "Updated X" over a preview that
         * had not changed, which reads as the tool ignoring the request.
         */
        setActiveStory(null);
        setNotIndexed({ fileName: result.fileName, title: result.title });
      }
    } else {
      // No storybookId came back at all: no lookup, no callout, no reload —
      // the canvas simply never changed and nothing explained why.
      setNotIndexed({ fileName: result.fileName, title: result.title });
    }

    setTurns(prev => [
      ...prev,
      {
        id: uid(),
        role: 'assistant',
        text: [
          result.chatSummary || `Created ${result.title}.`,
          (() => {
            const kept = [...(result.pins?.applied ?? []), ...(result.pins?.kept ?? [])];
            return kept.length ? `Kept your hand-set props: ${kept.join(', ')}.` : '';
          })(),
        ].filter(Boolean).join('\n\n'),
        // Advice travels beside the reply, not inside it — it is ours, not
        // the model's, and reads wrongly in the model's voice.
        notice: result.notice,
        elapsedMs: result.elapsedMs,
        suggestions: result.suggestions,
        verification: summarizeVerification(result.verification),
        findings: result.verification?.findings?.length ? result.verification.findings : undefined,
        storyId,
        fileName: result.fileName,
        title: result.title,
      },
    ]);
    // Only adopt a story that actually succeeded. A failed generation used to
    // become the file every subsequent edit was applied to.
    if (result.fileName) {
      setActiveFile({ fileName: result.fileName, title: result.title || 'Story' });
    }
    reloadSessions();
  }, [input, busy, recovering, turns, provider, model, considerations, activeFile, activeStory, code, selection, labeledSelection, images, voice, generate, reloadSessions, byFileName]);

  /* ---- attachments ----------------------------------------------------- */

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setImageError(null);
    const { images: added, errors } = await processImageFiles(files, MAX_IMAGES - images.length);
    if (added.length) setImages(prev => [...prev, ...added].slice(0, MAX_IMAGES));
    if (errors.length) setImageError(errors.join(' · '));
  }, [images.length]);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length === 0) return; // text pastes stay text pastes
    e.preventDefault();
    void addFiles(files);
  }, [addFiles]);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setDragging(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) void addFiles(files);
  }, [addFiles]);

  const recheckIndex = useCallback(async () => {
    if (!notIndexed) return;
    const found = await waitForStory('', notIndexed.title, 4000);
    if (found) {
      setActiveStory({ id: found, title: notIndexed.title || 'Untitled' });
      setReloadToken(t => t + 1);
      setNotIndexed(null);
    }
  }, [notIndexed]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; so does Cmd/Ctrl+Enter, which is what people who live in
    // chat tools reach for. Shift+Enter is a newline.
    if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canSend) send();
    }
  };

  /**
   * After a version is put back on disk: reload the canvas, note it in the
   * thread, refresh the code view. Shared by the History popover and Cmd/Ctrl+Z
   * so the two can never diverge.
   */
  const handleRestored = useCallback((v: StoryVersionSummary) => {
    // The file on disk changed underneath the canvas, so force a reload and
    // note it in the thread — a preview that silently becomes a different
    // composition is disorienting.
    setReloadToken(t => t + 1);
    setTurns(prev => [...prev, {
      id: uid(), role: 'assistant',
      // Name what is now on disk. The server writes the CLICKED version's
      // content, and that version CONTAINS the edit its prompt describes —
      // "from before" named the wrong boundary, in both directions. Ordinal
      // plus prompt is exactly the row the user clicked in the history list.
      text: `Restored version ${v.ordinal}: "${v.prompt}".`,
      fileName: activeFile?.fileName, title: activeFile?.title,
    }]);
    if (activeFile) void loadCode(activeFile.fileName);
    reloadSessions();
  }, [activeFile, loadCode, reloadSessions]);

  /** Undo: put the version before the current one back. */
  const restorePrevious = useCallback(async () => {
    if (!activeFile || busy || recovering) return;
    try {
      const prev = previousVersion(await fetchVersions(apiBase, activeFile.fileName));
      if (!prev) return;
      await restoreVersion(apiBase, activeFile.fileName, prev.id);
      handleRestored(prev);
    } catch (e: any) {
      setTurns(prevTurns => [...prevTurns, {
        id: uid(), role: 'assistant',
        text: `Could not restore the previous version: ${e?.message || String(e)}`,
      }]);
    }
  }, [activeFile, busy, recovering, apiBase, handleRestored]);

  // Cmd/Ctrl+Z outside a text field is undo for the story, not the textarea.
  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (inTextField(e.target)) return;
      e.preventDefault();
      void restorePrevious();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, restorePrevious]);

  /** Put a component name into the prompt, as "using X". */
  const insertComponent = useCallback((name: string) => {
    setInput(prev => {
      const base = prev.replace(/\s+$/, '');
      const next = base ? `${base} using ${name}` : `using ${name}`;
      committedInputRef.current = next;
      return next;
    });
    setComponentsOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  /** Back to Home. Shared by New and by Delete. */
  const goHome = useCallback(() => {
    setTurns([]);
    setActiveStory(null);
    setActiveFile(null);
    setNotIndexed(null);
    // Left behind before, which is how you could end up on the home screen
    // with a live selection chip and an open property panel pointing at a
    // story that is no longer active — where every control silently did
    // nothing.
    setSelection(null);
    setResolvedName(null);
    setShowProperties(false);
    setImages([]);
    setInput('');
    committedInputRef.current = '';
    setCode(null);
    setFailure(null);
    setFindingNotes({});
    reloadSessions();
  }, [reloadSessions]);

  const confirmDelete = useCallback(async () => {
    if (!activeFile) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStory(apiBase, activeFile.fileName);
      setDeleteOpen(false);
      goHome();
    } catch (e: any) {
      setDeleteError(e?.message || String(e));
    } finally {
      setDeleting(false);
    }
  }, [activeFile, apiBase, goHome]);

  /**
   * "Select" on a verification finding: find the element the selector names
   * in the preview and select it exactly as a click would have.
   */
  const selectFinding = useCallback((finding: VerificationFinding) => {
    if (!finding.selector) return;
    const target = canvasRef.current?.targetBySelector(finding.selector) ?? null;
    if (!target) {
      setFindingNotes(prev => ({ ...prev, [finding.id]: 'element not on the page any more' }));
      return;
    }
    setFindingNotes(prev => {
      if (!(finding.id in prev)) return prev;
      const next = { ...prev };
      delete next[finding.id];
      return next;
    });
    setResolvedName(null);
    setSelection(target);
  }, []);

  /**
   * Only a generated turn carries a fileName. A story opened from Recent work
   * has an id and a title but no file this session is entitled to commit, so
   * handoff stays disabled rather than committing the wrong thing.
   */
  const handoffCandidate = useMemo(
    () => [...turns].reverse().find(t => t.fileName),
    [turns],
  );

  const models = useMemo(
    () => providers.find(p => p.type === provider)?.models ?? [],
    [providers, provider],
  );

  /* ---- composer, shared by both states -------------------------------- */

  const composer = (
    <Box
      p="3"
      className={`suiw-composer${dragging ? ' suiw-composer--drag' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Card size="1">
        <TextArea
          ref={textareaRef}
          size="2"
          variant="soft"
          value={input}
          onChange={e => {
            setInput(e.target.value);
            committedInputRef.current = e.target.value;
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            selection
              ? `Describe a change to that ${resolvedName || selection.component || 'element'}`
              : started
                ? 'Describe a change, or ask for something new'
                : 'Describe the interface you want to build'
          }
          aria-label="Describe what to build"
          rows={started ? 2 : 3}
          style={{ background: 'transparent', boxShadow: 'none' }}
        />

        {/* Staged attachments. Each is removable until the message is sent —
            after that the turn keeps the thumbnails as its record. */}
        {images.length > 0 && (
          <Flex gap="2" wrap="wrap" mt="2">
            {images.map(img => (
              <span key={img.id} className="suiw-attach-thumb">
                <img src={img.preview} alt={img.name} />
                <button
                  type="button"
                  aria-label={`Remove ${img.name}`}
                  onClick={() => setImages(prev => prev.filter(i => i.id !== img.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </Flex>
        )}

        {imageError && (
          <Text as="div" size="1" color="red" mt="1">{imageError}</Text>
        )}
        {voice.error && (
          <Text as="div" size="1" color="red" mt="1">{voice.error.message}</Text>
        )}

        {/* The chip is the contract: whatever it names is what the next
            instruction applies to. Without it the user cannot tell whether a
            selection is still armed. */}
        {selection && (
          <Flex direction="column" gap="2" mb="2">
            <Flex align="center" gap="2">
              <Badge color="jade" variant="soft" className="suiw-ellipsis">
                {/* The FILE's name for the element once the server resolves it
                    — "Button", not the "UnstyledButton" internal the fiber
                    reported. The raw name stands until then. */}
                {targetLabel(labeledSelection ?? selection)}
              </Badge>
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => { setSelection(null); setResolvedName(null); }}
                title="Apply the next instruction to the whole story instead"
              >
                Clear
              </Button>
              <Button
                size="1"
                variant={showProperties ? 'soft' : 'ghost'}
                color="gray"
                onClick={() => setShowProperties(v => !v)}
                title="Change a property directly, without asking the model"
              >
                Properties
              </Button>
            </Flex>

            {/* Direct manipulation for the class of change that has exactly one
                correct answer. The model stays available for anything
                structural, one button away. */}
            {showProperties && (
              <div className="suiw-properties">
                <PropertyPanel
                  apiBase={apiBase}
                  target={selection}
                  fileName={activeFile?.fileName}
                  onApplied={next => {
                    setReloadToken(t => t + 1);
                    if (typeof next === 'string') setCode(next);
                    else if (activeFile) void loadCode(activeFile.fileName);
                  }}
                  onAskInstead={() => setShowProperties(false)}
                  onResolved={setResolvedName}
                />
              </div>
            )}
          </Flex>
        )}

        <Flex align="center" gap="2" mt="2" wrap="nowrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void addFiles(files);
            }}
          />
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || recovering || images.length >= MAX_IMAGES}
            title={
              images.length >= MAX_IMAGES
                ? `Up to ${MAX_IMAGES} images per message`
                : 'Attach an image — or paste or drop one here'
            }
          >
            Attach
          </Button>
          {/* Disabled rather than hidden when the browser lacks the Web Speech
              API: a control that exists in one browser and not another reads
              as breakage, not absence. */}
          <Button
            size="1"
            variant={voice.isListening ? 'soft' : 'ghost'}
            color={voice.isListening ? 'red' : 'gray'}
            onClick={voice.toggle}
            disabled={!voice.isSupported || recovering}
            title={
              !voice.isSupported
                ? 'Dictation needs a browser with the Web Speech API (Chrome, Edge or Safari)'
                : voice.isListening
                  ? 'Stop dictating'
                  : 'Dictate into the prompt'
            }
          >
            {voice.isListening ? 'Listening…' : 'Dictate'}
          </Button>

          {/* Only on home. In the workspace the rail is 400px, and badge + two
              selects + Build does not fit — the Build button was being pushed
              clean out of the row. The header already names the active story,
              so the badge has nothing to add here. */}
          {designSystem && !started && (
            <Badge
              color="gray"
              variant="soft"
              className="suiw-ellipsis"
              title="Generated using the design system installed in this project"
            >
              {designSystem}
            </Badge>
          )}

          {/* Pushes the primary action to the trailing edge. */}
          <Box flexGrow="1" minWidth="0" />

          {providers.length > 0 && (
            <>
              {/*
                * Changing provider must move the model with it. `setProvider`
                * alone left the previous provider's model id selected — the
                * trigger rendered blank (no matching item) and `send()` posted
                * {provider:'openai', model:'claude-sonnet-5'}.
                */}
              <Select.Root
                value={provider}
                onValueChange={next => {
                  setProvider(next);
                  const models = providers.find(p => p.type === next)?.models ?? [];
                  setModel(models[0] ?? '');
                }}
                size="1"
              >
                <Select.Trigger
                  variant="soft"
                  color="gray"
                  aria-label="Provider"
                  className="suiw-ellipsis"
                  style={{ maxWidth: 108 }}
                />
                <Select.Content>
                  {providers.map(p => (
                    <Select.Item key={p.type} value={p.type}>{p.name}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>

              {/* Model ids run long (`gemini-3.1-flash-lite`), so this one is
                  capped and truncates rather than eating the row. */}
              <Select.Root value={model} onValueChange={setModel} size="1">
                <Select.Trigger
                  variant="soft"
                  color="gray"
                  aria-label="Model"
                  className="suiw-ellipsis"
                  style={{ maxWidth: 148 }}
                />
                <Select.Content>
                  {models.map(m => <Select.Item key={m} value={m}>{m}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </>
          )}

          {busy ? (
            <Button
              size="2"
              variant="soft"
              color="gray"
              onClick={cancel}
              className="suiw-btn-stop"
              style={{ flexShrink: 0 }}
            >
              Stop
            </Button>
          ) : (
            /* highContrast, because Radix's solid variant puts white text on
               accent-9 and jade-9 only reaches 3.15:1 — under AA for a 14px
               label. highContrast swaps to accent-12 on accent-1 and measures
               14.5:1. Every non-purple accent has this problem, so changing
               hue would only have hidden it. */
            <Button
              size="2"
              highContrast
              onClick={() => send()}
              // Recovering counts as busy: a turn sent mid-recovery would be
              // clobbered when the recovered conversation lands. send() also
              // guards, for the Enter key and suggestion chips.
              disabled={!input.trim() || recovering || !canSend}
              className="suiw-btn-build"
              style={{ flexShrink: 0 }}
              title={
                blocked === 'unreachable' ? 'The Story UI server is not reachable'
                  : blocked === 'no-providers' ? 'No AI provider is configured'
                    : blocked === 'checking' ? 'Checking the server…'
                      : `Build (${MOD}+Enter)`
              }
            >
              Build
            </Button>
          )}
        </Flex>
      </Card>

      {/* Why Build is held, and what to do about it. A disabled button with
          no explanation was the first thing a new install showed. */}
      {(blocked === 'unreachable' || blocked === 'no-providers') && (
        <Callout.Root color={blocked === 'unreachable' ? 'red' : 'amber'} size="1" mt="2" role="status" className="suiw-gate">
          <Callout.Text>
            {blocked === 'unreachable' ? (
              <>
                <Text weight="medium">The Story UI server is not running.</Text>
                <br />
                Start it from your project: <Kbd size="1">npm run story-ui</Kbd>
                <br />
                <Text color="gray">Tried {apiBase}</Text>
              </>
            ) : (
              <>
                <Text weight="medium">No AI provider is configured.</Text>
                <br />
                Add an API key to <Kbd size="1">.env</Kbd> (<Kbd size="1">ANTHROPIC_API_KEY</Kbd>,{' '}
                <Kbd size="1">OPENAI_API_KEY</Kbd> or <Kbd size="1">GEMINI_API_KEY</Kbd>) and restart the server.
              </>
            )}
          </Callout.Text>
          <Flex mt="2">
            <Button size="1" variant="soft" color="gray" onClick={() => { setConnected(null); void checkConnection(); }}>
              Check again
            </Button>
          </Flex>
        </Callout.Root>
      )}
    </Box>
  );

  const connectionBadge = (
    // Three states, not two. `connected` starts null and is only set true
    // on a successful probe — so a 500, or a probe that had not returned
    // yet, used to render a green "Connected" badge for a server we had
    // heard nothing from.
    <Badge
      color={connected === false ? 'red' : connected === true ? 'green' : 'gray'}
      variant="soft"
      title={connected === false ? `No answer from ${apiBase}` : apiBase}
    >
      {connected === false ? 'Server unreachable' : connected === true ? 'Connected' : 'Checking…'}
    </Badge>
  );

  const shortcutsHelp = (
    <Tooltip
      content={
        // Spans throughout: Radix renders tooltip content inside a <p>, and
        // a <div> in a <p> is invalid markup React warns about.
        <Flex as="span" direction="column" gap="1" style={{ minWidth: 220 }}>
          <Flex as="span" justify="between" gap="3"><span>Send</span><span><Kbd size="1">Enter</Kbd> / <Kbd size="1">{MOD}</Kbd>+<Kbd size="1">Enter</Kbd></span></Flex>
          <Flex as="span" justify="between" gap="3"><span>New line</span><span><Kbd size="1">Shift</Kbd>+<Kbd size="1">Enter</Kbd></span></Flex>
          <Flex as="span" justify="between" gap="3"><span>Leave pick mode</span><Kbd size="1">Esc</Kbd></Flex>
          <Flex as="span" justify="between" gap="3"><span>Restore previous version</span><span><Kbd size="1">{MOD}</Kbd>+<Kbd size="1">Z</Kbd> outside a text field</span></Flex>
        </Flex>
      }
    >
      <IconButton size="1" variant="ghost" color="gray" aria-label="Keyboard shortcuts">
        <Text size="1" weight="bold">?</Text>
      </IconButton>
    </Tooltip>
  );

  const currentSessionFile = activeFile && sessions.some(s => s.fileName === activeFile.fileName)
    ? activeFile.fileName
    : '';

  const header = (
    <Flex
      align="center"
      gap="3"
      px="3"
      py="2"
      style={{ borderBottom: '1px solid var(--gray-a5)', flex: '0 0 auto' }}
    >
      <Flex align="center" gap="2">
        {/* Soft rather than solid for the same reason as the Build button:
            `--accent-contrast` on `--accent-9` is only 3.15:1 for jade. The
            a4/11 pair is the one Radix guarantees for text. */}
        <Flex
          align="center"
          justify="center"
          width="20px"
          height="20px"
          style={{ background: 'var(--accent-a4)', borderRadius: 'var(--radius-2)' }}
        >
          <Text size="1" weight="bold" style={{ color: 'var(--accent-11)' }}>S</Text>
        </Flex>
        <Text size="2" weight="medium">Story UI</Text>
      </Flex>

      {started && (
        <>
          <Separator orientation="vertical" size="1" />
          {/* The story switcher. Changing stories used to mean New → Home →
              card; the header already named the story, so it now lists them. */}
          <Select.Root
            value={currentSessionFile}
            onValueChange={fileName => {
              const session = byFileName(fileName);
              if (session && fileName !== activeFile?.fileName) openSession(session);
            }}
            size="1"
            disabled={busy || recovering}
          >
            <Select.Trigger
              variant="ghost"
              color="gray"
              aria-label="Switch story"
              className="suiw-ellipsis"
              placeholder={activeStory?.title ?? activeFile?.title ?? 'Untitled'}
              style={{ maxWidth: 280 }}
            />
            <Select.Content position="popper">
              {sessions.map(s => (
                <Select.Item key={s.fileName} value={s.fileName}>{s.title}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>

          {activeFile && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <IconButton size="1" variant="ghost" color="gray" aria-label="Story actions" disabled={busy || recovering}>
                  <Text size="2" weight="bold" aria-hidden>⋯</Text>
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content size="1">
                <DropdownMenu.Item
                  disabled={!activeStory}
                  onSelect={() => { if (activeStory) openInStorybook(activeStory.id); }}
                >
                  Open in Storybook
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item color="red" onSelect={() => { setDeleteError(null); setDeleteOpen(true); }}>
                  Delete story…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
        </>
      )}

      <Box flexGrow="1" minWidth="0" />

      <Button
        size="1"
        variant="ghost"
        color="gray"
        onClick={() => setComponentsOpen(true)}
        disabled={connected !== true}
        title="What the server discovered in this project"
      >
        Components
      </Button>

      {shortcutsHelp}

      {connectionBadge}

      {started && (
        <Button size="1" variant="soft" color="gray" onClick={goHome}>
          New
        </Button>
      )}
    </Flex>
  );

  const openInStorybook = (storyId: string) => {
    if (onOpenStory) { onOpenStory(storyId); return; }
    // A new tab. Navigating the top window replaced the workspace — and the
    // conversation in it — with the story, which is the opposite of "open".
    window.open(storybookUrlFor(storyId), '_blank', 'noopener');
  };

  const deleteDialog = (
    <AlertDialog.Root open={deleteOpen} onOpenChange={o => { if (!deleting) setDeleteOpen(o); }}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Delete this story?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          {activeFile ? `"${activeFile.title}" (${activeFile.fileName})` : 'This story'} and its conversation
          will be removed from this project. Versions kept by the server are not touched, but nothing in the
          workspace will list them.
        </AlertDialog.Description>
        {deleteError && (
          <Callout.Root color="red" size="1" mt="3">
            <Callout.Text>{deleteError}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={deleting}>Cancel</Button>
          </AlertDialog.Cancel>
          {/* Not wrapped in AlertDialog.Action: the dialog must stay open on
              a failed delete so the reason can be read. */}
          <Button color="red" onClick={() => void confirmDelete()} loading={deleting}>
            Delete
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );

  const componentsDrawer = (
    <ComponentsDrawer
      apiBase={apiBase}
      open={componentsOpen}
      onOpenChange={setComponentsOpen}
      onInsert={insertComponent}
    />
  );

  /* ---- home ------------------------------------------------------------ */

  if (!started) {
    return (
      <div className="suiw-root suiw sb-unstyled">
        <Theme appearance={appearance} accentColor="jade" radius="medium">
          {header}

          <Box className="suiw-scroll suiw-home">
            <Box px="5" py="8" style={{ maxWidth: 820, marginInline: 'auto' }}>
              <Heading size="7" weight="medium" align="center">What should we build?</Heading>
              <Text as="p" size="2" color="gray" align="center" mt="2" className="suiw-home-sub">
                {designSystem
                  ? `Composed from ${designSystem}, the design system installed in this project.`
                  : 'Composed from the design system installed in this project.'}
              </Text>

              <Box mt="4">{composer}</Box>

              <Flex gap="2" wrap="wrap" justify="center" px="3">
                {SUGGESTIONS.map(s => (
                  <Button key={s} size="1" variant="surface" color="gray" onClick={() => send(s)} disabled={!canSend}>
                    {s}
                  </Button>
                ))}
              </Flex>

              {sessions.length > 0 && (
                <Box mt="8">
                  <Flex align="baseline" justify="between" mb="3">
                    {/* Radix Heading renders h1 unless told otherwise, which
                        gave the page two competing h1s. */}
                    <Heading as="h2" size="3" weight="medium">Recent work</Heading>
                    <Text size="1" color="gray">
                      {shownRecent >= sessions.length
                        ? `${sessions.length} in this project`
                        : `showing ${shownRecent} of ${sessions.length}`}
                    </Text>
                  </Flex>

                  <div className="suiw-recent-grid">
                    {sessions.slice(0, shownRecent).map(session => (
                      <Card key={session.fileName} asChild size="1" style={{ padding: 0, overflow: 'hidden' }}>
                        <button
                          type="button"
                          className="suiw-recent-card"
                          style={{ cursor: 'pointer', textAlign: 'left', display: 'block', width: '100%' }}
                          onClick={() => openSession(session)}
                        >
                          {/* A real render, not a screenshot — the thumbnail is
                              the story itself at half scale, mounted only when
                              scrolled into view. */}
                          {session.storyId
                            ? <LazyThumb storyId={session.storyId} title={session.title} />
                            : <span className="suiw-thumb suiw-thumb--idle">
                                <Text size="1" color="gray">Not indexed</Text>
                              </span>}
                          <Box p="2">
                            <Text as="div" size="2" weight="medium" truncate>{session.title}</Text>
                            <Text as="div" size="1" color="gray" truncate>
                              {session.messageCount > 0
                                ? `${session.messageCount} message${session.messageCount === 1 ? '' : 's'} · ${relativeTime(session.updatedAt)}`
                                : relativeTime(session.updatedAt)}
                            </Text>
                          </Box>
                        </button>
                      </Card>
                    ))}
                  </div>
                  {shownRecent < sessions.length && (
                    <Flex justify="center" mt="3">
                      <Button
                        size="1"
                        variant="soft"
                        color="gray"
                        onClick={() => setShownRecent(n => n + RECENT_PAGE)}
                      >
                        Show more ({sessions.length - shownRecent} remaining)
                      </Button>
                    </Flex>
                  )}
                </Box>
              )}
            </Box>
          </Box>
          {componentsDrawer}
        </Theme>
      </div>
    );
  }

  /* ---- workspace -------------------------------------------------------- */

  return (
    /**
     * `sb-unstyled` is not optional here.
     *
     * addon-docs injects a global typography reset scoped as
     * `:where(div, span, p, a, h1..h6, ...):not(.sb-unstyled, .sb-unstyled *)`
     * at the same specificity as Radix Themes' own size classes, and it is
     * injected LATER, so it wins every tie. Home carried the class and the
     * workspace did not — the same components rendering correctly on one
     * screen and reset on the other.
     */
    <div className="suiw-root suiw sb-unstyled">
      <Theme appearance={appearance} accentColor="jade" radius="medium">
        {header}

        <div className="suiw-body">
          <div className="suiw-rail">
            <Box className="suiw-scroll" p="3" ref={threadRef as any}>
              <Flex direction="column" gap="3">
                {turns.map(turn => (
                  <Flex
                    key={turn.id}
                    direction="column"
                    gap="2"
                    align={turn.role === 'user' ? 'end' : 'start'}
                    className={`suiw-turn suiw-turn--${turn.role}`}
                  >
                    {turn.role === 'user' ? (
                      <Card size="1" variant="surface" style={{ maxWidth: '85%' }}>
                        {turn.target && (
                          <Badge color="jade" variant="soft" mb="1" className="suiw-ellipsis">
                            {turn.target}
                          </Badge>
                        )}
                        {turn.thumbnails && turn.thumbnails.length > 0 && (
                          <Flex gap="2" wrap="wrap" mb="1" className="suiw-turn-thumbs">
                            {turn.thumbnails.map((thumb, i) => (
                              <img key={i} src={thumb} alt={`Attached image ${i + 1}`} />
                            ))}
                          </Flex>
                        )}
                        <Text as="div" size="2" className="suiw-turn-body">{turn.text}</Text>
                      </Card>
                    ) : (
                      <Text as="div" size="2" color={turn.failed ? 'red' : 'gray'} className="suiw-turn-body">{turn.text}</Text>
                    )}

                    {turn.role === 'assistant' && turn.notice && (
                      <Text as="div" size="1" className="suiw-turn-notice">{turn.notice}</Text>
                    )}

                    {turn.verification && (
                      <Flex direction="column" gap="1" className="suiw-verify">
                        <Flex align="center" gap="2">
                          {/* A pass with checks missing is amber, not green:
                              "Verified · 3/6 checks" must not look like 6/6. */}
                          <Badge
                            color={isPartialVerification(turn.verification) ? 'amber' : VERIFY_TONE[turn.verification.outcome]}
                            variant="soft"
                            title={
                              turn.verification.outcome === 'verified' && turn.verification.reason
                                ? turn.verification.reason
                                : isPartialVerification(turn.verification)
                                  ? 'Not every verification layer ran'
                                  : undefined
                            }
                          >
                            {verificationLabel(turn.verification)}
                          </Badge>
                          {typeof turn.verification.focusables === 'number' && (
                            <Text size="1" color="gray">
                              {turn.verification.focusables} focusable
                            </Text>
                          )}
                          {turn.elapsedMs != null && (
                            <Text size="1" color="gray">{(turn.elapsedMs / 1000).toFixed(1)}s</Text>
                          )}
                        </Flex>

                        {/* "Not verified" on its own reads as "your story is
                            bad", when it usually means we could not check —
                            Playwright missing, Storybook unreachable, the story
                            not indexed yet. The server always sends a reason;
                            withholding it just moved the confusion downstream. */}
                        {turn.verification.outcome === 'not_verified' && turn.verification.reason && (
                          <Text size="1" color="gray">{turn.verification.reason}</Text>
                        )}

                        {turn.findings && turn.findings.length > 0 && (
                          <FindingsList
                            findings={turn.findings}
                            notes={findingNotes}
                            canSelect={!!activeStory && !busy}
                            onSelect={selectFinding}
                          />
                        )}
                      </Flex>
                    )}

                    {turn.verification == null && turn.elapsedMs != null && (
                      <Text size="1" color="gray">{(turn.elapsedMs / 1000).toFixed(1)}s</Text>
                    )}

                    {turn.suggestions && turn.suggestions.length > 0 && (
                      <Flex gap="2" wrap="wrap" className="suiw-turn-actions">
                        {turn.suggestions.slice(0, 3).map(s => (
                          <Button
                            key={s}
                            size="1"
                            variant="surface"
                            color="gray"
                            // `send()` hard-returns while busy or recovering,
                            // so an enabled chip did nothing and read as broken.
                            disabled={busy || recovering}
                            onClick={() => send(s)}
                          >
                            {s}
                          </Button>
                        ))}
                      </Flex>
                    )}
                  </Flex>
                ))}

                {recovering && (
                  <Flex align="center" gap="2" className="suiw-steps">
                    <Box
                      width="6px"
                      height="6px"
                      className="suiw-pulse"
                      style={{ borderRadius: '50%', background: 'var(--accent-9)', flex: '0 0 auto' }}
                    />
                    <Text size="1" className="suiw-step-label">
                      Reconnecting to your in-progress generation
                    </Text>
                    <StepClock since={recoveringSince.current} />
                    {/*
                      * An exit. Recovery disables Build, Attach, Dictate and
                      * History and can hold them for up to fifteen minutes,
                      * with no way to abandon it — if the poll never resolves
                      * the workspace was simply unusable until then.
                      */}
                    <Button
                      size="1"
                      variant="ghost"
                      color="gray"
                      onClick={() => {
                        clearPendingGeneration();
                        setRecovering(false);
                      }}
                    >
                      Start over
                    </Button>
                  </Flex>
                )}

                {/*
                  * Kept after the run ends: gating on `busy` erased the whole
                  * narration the moment it finished, so nothing recorded what
                  * the pipeline did — least of all on the failure path.
                  */}
                {steps.length > 0 && (
                  <Flex direction="column" gap="1" className="suiw-steps">
                    {steps.map(s => (
                      <Flex key={s.id} align="center" gap="2" className={`suiw-step suiw-step--${s.state}`}>
                        <Box
                          width="6px"
                          height="6px"
                          className={s.state === 'active' ? 'suiw-pulse' : undefined}
                          style={{
                            borderRadius: '50%',
                            // A step that failed must not wear the same dot as
                            // one that finished.
                            background: s.state === 'active'
                              ? 'var(--accent-9)'
                              : s.state === 'failed' ? 'var(--red-9)'
                                : s.state === 'warn' ? 'var(--amber-9)' : 'var(--gray-a7)',
                            flex: '0 0 auto',
                          }}
                        />
                        <Text
                          size="1"
                          color={s.state === 'active' ? undefined : s.state === 'failed' ? 'red' : s.state === 'warn' ? 'amber' : 'gray'}
                          className="suiw-step-label"
                        >
                          {s.label}
                        </Text>
                        {s.detail && (
                          <Text size="1" color="gray" className="suiw-step-detail">
                            {s.detail}
                          </Text>
                        )}
                        {s.state === 'active' && <StepClock since={s.startedAt} />}
                      </Flex>
                    ))}
                  </Flex>
                )}

                {error && (
                  <Callout.Root color="red" size="1" role="alert">
                    <Callout.Text>
                      {error}
                      {/* What the server said to do about it. It always sends
                          one; the hook used to drop it on the floor. */}
                      {errorInfo?.suggestion && (
                        <><br /><Text size="1" color="gray">{errorInfo.suggestion}</Text></>
                      )}
                      {errorInfo?.network && (
                        <><br /><Text size="1" color="gray">The request never reached the server at {apiBase}.</Text></>
                      )}
                    </Callout.Text>
                    {retryRequest && errorInfo?.recoverable !== false && (
                      <Flex mt="2" gap="2">
                        <Button
                          size="1"
                          variant="soft"
                          color="red"
                          disabled={busy || recovering || !canSend}
                          onClick={() => {
                            const r = retryRequest;
                            setInput('');
                            committedInputRef.current = '';
                            void send(r.prompt, { images: r.images, selection: r.selection });
                          }}
                        >
                          Retry
                        </Button>
                      </Flex>
                    )}
                  </Callout.Root>
                )}

                {/* A deliberate stop is not a fault, and gets its own tone. */}
                {notice && !error && (
                  <Callout.Root color="gray" size="1" role="status">
                    <Callout.Text>{notice}</Callout.Text>
                  </Callout.Root>
                )}
              </Flex>
            </Box>

            {composer}
          </div>

          <PreviewCanvas
            ref={canvasRef}
            historySlot={
              <VersionHistory
                apiBase={apiBase}
                fileName={activeFile?.fileName}
                refreshToken={reloadToken}
                disabled={busy || recovering}
                onRestored={handleRestored}
              />
            }
            onSelectElement={t => { setResolvedName(null); setSelection(t); }}
            hasSelection={!!selection}
            storyId={activeStory?.id}
            title={activeStory?.title}
            reloadToken={reloadToken}
            busy={busy}
            notIndexed={notIndexed}
            onRecheck={recheckIndex}
            code={code}
            codeFileName={activeFile?.fileName}
            codeLoading={codeLoading}
            failure={failure}
            onOpenInStorybook={() => activeStory && openInStorybook(activeStory.id)}
            canHandoff={!!handoffCandidate}
            onHandoff={() => {
              if (!handoffCandidate?.fileName) return;
              const next = { fileName: handoffCandidate.fileName, title: handoffCandidate.title || 'Story' };
              setHandoffTarget(next);
              onHandoff?.(next.fileName, next.title);
            }}
          />
        </div>

        <HandoffDialog
          apiBase={apiBase}
          target={handoffTarget}
          onClose={() => setHandoffTarget(null)}
        />
        {deleteDialog}
        {componentsDrawer}
      </Theme>
    </div>
  );
};

/**
 * The findings behind a verification badge, folded by default.
 *
 * The badge said "2 issue(s) found" and nothing else — the findings were in
 * the completion the whole time. Each has a severity, a message, and the
 * evidence the check saw; the ones with a selector can put the element under
 * the property panel, exactly as a click would.
 */
const FindingsList: React.FC<{
  findings: VerificationFinding[];
  notes: Record<string, string>;
  canSelect: boolean;
  onSelect: (finding: VerificationFinding) => void;
}> = ({ findings, notes, canSelect, onSelect }) => {
  const [open, setOpen] = useState(false);
  return (
    <Flex direction="column" gap="1" className="suiw-findings-wrap">
      <Button
        size="1"
        variant="ghost"
        color="gray"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{ alignSelf: 'flex-start' }}
      >
        {open ? 'Hide' : 'Show'} {findings.length} issue{findings.length === 1 ? '' : 's'}
      </Button>
      {open && (
        <div className="suiw-findings" role="list">
          {findings.map(f => (
            <Flex key={f.id} direction="column" gap="1" p="2" className="suiw-finding" role="listitem">
              <Flex align="center" gap="2" wrap="wrap">
                <Badge size="1" color={SEVERITY_TONE[f.severity] ?? 'gray'} variant="soft">{f.severity}</Badge>
                <Text size="1">{f.message}</Text>
              </Flex>
              {f.evidence && <Text as="div" className="suiw-finding-evidence">{f.evidence}</Text>}
              {f.selector && (
                <Flex align="center" gap="2">
                  <Button
                    size="1"
                    variant="soft"
                    color="gray"
                    disabled={!canSelect}
                    onClick={() => onSelect(f)}
                    title={canSelect ? `Select ${f.selector} in the preview` : 'The preview is not showing this story'}
                  >
                    Select
                  </Button>
                  {notes[f.id] && <Text size="1" color="gray">{notes[f.id]}</Text>}
                </Flex>
              )}
            </Flex>
          ))}
        </div>
      )}
    </Flex>
  );
};

export default Workspace;
