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
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Select,
  Separator,
  Text,
  TextArea,
  Theme,
} from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import './workspace.css';
import { PreviewCanvas } from './PreviewCanvas';
import { HandoffDialog } from './HandoffDialog';
import {
  useGeneration,
  waitForStory,
  readPendingGeneration,
  clearPendingGeneration,
  type Verification,
} from './useGeneration';
import {
  useSessions,
  takeEditRequest,
  cleanReply,
  pollForCompletedEntry,
  summarizeVerification,
  verificationFromCompletion,
  type SessionSummary,
  type ManifestEntry,
  type VerificationSummary,
} from './useSessions';
import { processImageFiles, MAX_IMAGES, type AttachedImage } from './imageAttachments';
import { useVoiceInput } from './useVoiceInput';
import { describeTarget, targetLabel, type ElementTarget } from './elementTargeting';
import { PropertyPanel } from './PropertyPanel';
import { VersionHistory, type StoryVersionSummary } from './VersionHistory';

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
  storyId?: string;
  fileName?: string;
  title?: string;
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

export const Workspace: React.FC<WorkspaceProps> = ({ apiBase, onOpenStory, onHandoff }) => {
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
  const { generate, cancel, steps, busy, error, notice } = useGeneration(apiBase);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${apiBase}/mcp/providers`);
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            setProviders(data.providers?.filter((p: any) => p.configured) ?? []);
            setProvider(data.current?.provider?.toLowerCase?.() ?? '');
            setModel(data.current?.model ?? '');
            setConnected(true);
          } else {
            // A reachable server that answers 500 is not "connected", and
            // leaving this null would sit on "Checking…" indefinitely.
            setConnected(false);
          }
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
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
    setReloadToken(t => t + 1);
  }, []);

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
    if (!request) return;
    const session = byStoryId(request.componentId);
    if (session) openSession(session);
  }, [sessionsLoaded, recovering, byStoryId, openSession]);

  /* ---- autoscroll ----------------------------------------------------- */

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, steps]);

  /* ---- send ----------------------------------------------------------- */

  const send = useCallback(async (text?: string) => {
    const prompt = (text ?? input).trim();
    // `recovering` counts as busy here: a turn sent while recovery polls
    // would be replaced when the recovered conversation lands, and its reply
    // would append to the wrong thread. The reconnecting row already says
    // why the composer is waiting.
    if (!prompt || busy || recovering) return;

    if (voice.isListening) voice.stop();
    committedInputRef.current = '';
    setInput('');
    const sentImages = images;
    setImages([]);
    setImageError(null);
    // Shown on the turn so the transcript records what the instruction was
    // pointed at — six months later "make it bigger" means nothing on its own.
    const userTurn: Turn = {
      id: uid(), role: 'user', text: prompt,
      // The label the chip showed — the resolved name when the lookup answered.
      target: labeledSelection ? targetLabel(labeledSelection) : undefined,
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
      selection: selection ? describeTarget(selection) : undefined,
      // When this updates an existing entry, record how fresh that entry is
      // right now — recovery then demands a STRICTLY newer one, so resending
      // an identical prompt can never re-match the previous completion.
      knownUpdatedAt: activeFile ? byFileName(activeFile.fileName)?.entry.updatedAt : undefined,
    }, async (preview) => {
      if (!preview.storybookId) return;
      const resolved = await waitForStory(preview.storybookId, preview.title);
      if (!resolved) return;
      setActiveStory({ id: resolved, title: preview.title || 'Untitled' });
      setReloadToken(t => t + 1);
      setNotIndexed(null);
      previewShown = true;
    });

    if (!result) return;

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
    } else if (result.success) {
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
          result.chatSummary || (result.success ? `Created ${result.title}.` : 'That generation did not succeed.'),
          result.pins?.applied?.length ? `Kept your hand-set props: ${result.pins.applied.join(', ')}.` : '',
          result.notice || '',
        ].filter(Boolean).join('\n\n'),
        elapsedMs: result.elapsedMs,
        suggestions: result.suggestions,
        verification: summarizeVerification(result.verification),
        storyId,
        fileName: result.fileName,
        title: result.title,
      },
    ]);
    // Only adopt a story that actually succeeded. A failed generation used to
    // become the file every subsequent edit was applied to.
    if (result.fileName && result.success) {
      setActiveFile({ fileName: result.fileName, title: result.title || 'Story' });
    }
    reloadSessions();
  }, [input, busy, recovering, turns, provider, model, considerations, activeFile, selection, resolvedName, images, voice, generate, reloadSessions, byFileName]);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

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
                  onApplied={() => setReloadToken(t => t + 1)}
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
              disabled={!input.trim() || recovering}
              className="suiw-btn-build"
              style={{ flexShrink: 0 }}
            >
              Build
            </Button>
          )}
        </Flex>
      </Card>
    </Box>
  );

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
          <Text size="2" color="gray" className="suiw-ellipsis">
            {activeStory?.title ?? 'Untitled'}
          </Text>
        </>
      )}

      <Box flexGrow="1" minWidth="0" />

      {started ? (
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() => {
            setTurns([]);
            setActiveStory(null);
            setActiveFile(null);
            setNotIndexed(null);
            // Left behind before, which is how you could end up on the home
            // screen with a live selection chip and an open property panel
            // pointing at a story that is no longer active — where every
            // control silently did nothing.
            setSelection(null);
            setShowProperties(false);
            setImages([]);
            setInput('');
            reloadSessions();
          }}
        >
          New
        </Button>
      ) : (
        // Three states, not two. `connected` starts null and is only set true
        // on a successful probe — so a 500, or a probe that had not returned
        // yet, used to render a green "Connected" badge for a server we had
        // heard nothing from.
        <Badge
          color={connected === false ? 'red' : connected === true ? 'green' : 'gray'}
          variant="soft"
        >
          {connected === false ? 'Server unreachable' : connected === true ? 'Connected' : 'Checking…'}
        </Badge>
      )}
    </Flex>
  );

  /* ---- home ------------------------------------------------------------ */

  if (!started) {
    return (
      <div className="suiw-root suiw sb-unstyled">
        <Theme appearance="dark" accentColor="jade" radius="medium">
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
                  <Button key={s} size="1" variant="surface" color="gray" onClick={() => send(s)}>
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
      <Theme appearance="dark" accentColor="jade" radius="medium">
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
                      <Text as="div" size="2" color="gray" className="suiw-turn-body">{turn.text}</Text>
                    )}

                    {turn.verification && (
                      <Flex direction="column" gap="1" className="suiw-verify">
                        <Flex align="center" gap="2">
                          <Badge color={VERIFY_TONE[turn.verification.outcome]} variant="soft">
                            {turn.verification.outcome === 'verified' && 'Verified in browser'}
                            {turn.verification.outcome === 'issues' &&
                              `${turn.verification.blockers} issue(s) found`}
                            {turn.verification.outcome === 'not_verified' && 'Not verified'}
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
                              : s.state === 'failed' ? 'var(--red-9)' : 'var(--gray-a7)',
                            flex: '0 0 auto',
                          }}
                        />
                        <Text
                          size="1"
                          color={s.state === 'active' ? undefined : s.state === 'failed' ? 'red' : 'gray'}
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
                    <Callout.Text>{error}</Callout.Text>
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
            historySlot={
              <VersionHistory
                apiBase={apiBase}
                fileName={activeFile?.fileName}
                refreshToken={reloadToken}
                disabled={busy || recovering}
                onRestored={(v: StoryVersionSummary) => {
                  // The file on disk changed underneath the canvas, so force a
                  // reload and note it in the thread — a preview that silently
                  // becomes a different composition is disorienting.
                  setReloadToken(t => t + 1);
                  setTurns(prev => [...prev, {
                    id: uid(), role: 'assistant',
                    // Name what is now on disk. The server writes the CLICKED
                    // version's content, and that version CONTAINS the edit its
                    // prompt describes — "from before" named the wrong boundary,
                    // in both directions. Ordinal plus prompt is exactly the row
                    // the user clicked in the history list.
                    text: `Restored version ${v.ordinal}: "${v.prompt}".`,
                    fileName: activeFile?.fileName, title: activeFile?.title,
                  }]);
                  reloadSessions();
                }}
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
            onOpenInStorybook={() => activeStory && onOpenStory?.(activeStory.id)}
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
      </Theme>
    </div>
  );
};

export default Workspace;
