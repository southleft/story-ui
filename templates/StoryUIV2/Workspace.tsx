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
import { useGeneration, waitForStory, type Verification } from './useGeneration';
import { useSessions, takeEditRequest, cleanReply, type SessionSummary } from './useSessions';
import { describeTarget, targetLabel, type ElementTarget } from './elementTargeting';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thumbnails?: string[];
  elapsedMs?: number;
  suggestions?: string[];
  /** What this instruction was pointed at, when the user selected an element. */
  target?: string;
  verification?: Verification;
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
  const { sessions, loaded: sessionsLoaded, reload: reloadSessions, byStoryId } = useSessions(apiBase);
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
    const restored: Turn[] = (session.entry.conversation ?? []).map((m, i, all) => ({
      id: `${session.fileName}-${i}`,
      role: m.role === 'user' ? 'user' : 'assistant',
      text: m.role === 'ai' ? cleanReply(m.content) : m.content,
      thumbnails: m.thumbnails,
      // The last assistant turn carries the file, so handoff and follow-up
      // edits act on this story rather than starting a new one.
      ...(m.role === 'ai' && i === all.length - 1
        ? { fileName: session.fileName, title: session.title, storyId: session.storyId ?? undefined }
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
   * The "Edit in Story UI" toolbar button hands us a story id and expects its
   * conversation to open. Runs once sessions are loaded, since resolving the id
   * to a session needs the manifest.
   */
  const editRequestHandled = useRef(false);
  useEffect(() => {
    if (!sessionsLoaded || editRequestHandled.current) return;
    editRequestHandled.current = true;
    const request = takeEditRequest();
    if (!request) return;
    const session = byStoryId(request.componentId);
    if (session) openSession(session);
  }, [sessionsLoaded, byStoryId, openSession]);

  /* ---- autoscroll ----------------------------------------------------- */

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, steps]);

  /* ---- send ----------------------------------------------------------- */

  const send = useCallback(async (text?: string) => {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;

    setInput('');
    // Shown on the turn so the transcript records what the instruction was
    // pointed at — six months later "make it bigger" means nothing on its own.
    const userTurn: Turn = {
      id: uid(), role: 'user', text: prompt,
      target: selection ? targetLabel(selection) : undefined,
    };
    setSelection(null);
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
      // Edit the story in front of us rather than spawning a sibling. Without
      // these two the server treated every follow-up as a brand new story.
      fileName: activeFile?.fileName,
      isUpdate: !!activeFile,
      originalTitle: activeFile?.title,
      selection: selection ? describeTarget(selection) : undefined,
    });

    if (!result) return;

    // The file is written before Storybook has indexed it, so resolve the real
    // story id before pointing the canvas at it.
    let storyId = result.storybookId;
    if (storyId) {
      // Pass the title too: the id Storybook assigns may be derived from it
      // rather than from the filename slug the server reports.
      const resolved = await waitForStory(storyId, result.title);
      if (resolved) {
        setActiveStory({ id: resolved, title: result.title || 'Untitled' });
        setReloadToken(t => t + 1);
        setNotIndexed(null);
        storyId = resolved;
      } else {
        // The file is on disk; Storybook simply has not noticed it.
        setNotIndexed({ fileName: result.fileName, title: result.title });
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
    if (result.fileName) setActiveFile({ fileName: result.fileName, title: result.title || 'Story' });
    reloadSessions();
  }, [input, busy, turns, provider, model, considerations, activeFile, selection, generate, reloadSessions]);

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
    <Box p="3" className="suiw-composer">
      <Card size="1">
        <TextArea
          size="2"
          variant="soft"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            selection
              ? `Describe a change to that ${selection.component || 'element'}`
              : started
                ? 'Describe a change, or ask for something new'
                : 'Describe the interface you want to build'
          }
          aria-label="Describe what to build"
          rows={started ? 2 : 3}
          style={{ background: 'transparent', boxShadow: 'none' }}
        />

        {/* The chip is the contract: whatever it names is what the next
            instruction applies to. Without it the user cannot tell whether a
            selection is still armed. */}
        {selection && (
          <Flex align="center" gap="2" mb="2">
            <Badge color="jade" variant="soft" className="suiw-ellipsis">
              {targetLabel(selection)}
            </Badge>
            <Button
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => setSelection(null)}
              title="Apply the next instruction to the whole story instead"
            >
              Clear
            </Button>
          </Flex>
        )}

        <Flex align="center" gap="2" mt="2" wrap="nowrap">
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
              <Select.Root value={provider} onValueChange={setProvider} size="1">
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
              disabled={!input.trim()}
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
            reloadSessions();
          }}
        >
          New
        </Button>
      ) : (
        <Badge color={connected === false ? 'red' : 'green'} variant="soft">
          {connected === false ? 'Server unreachable' : 'Connected'}
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
                    <Text size="1" color="gray">{sessions.length} in this project</Text>
                  </Flex>

                  <div className="suiw-recent-grid">
                    {sessions.slice(0, 12).map(session => (
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
    <div className="suiw-root suiw">
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
                              `${turn.verification.findings.filter(f => f.severity === 'blocker').length} issue(s) found`}
                            {turn.verification.outcome === 'not_verified' && 'Not verified'}
                          </Badge>
                          {typeof turn.verification.metrics?.focusables === 'number' && (
                            <Text size="1" color="gray">
                              {turn.verification.metrics.focusables} focusable
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
                          <Button key={s} size="1" variant="surface" color="gray" onClick={() => send(s)}>
                            {s}
                          </Button>
                        ))}
                      </Flex>
                    )}
                  </Flex>
                ))}

                {steps.length > 0 && busy && (
                  <Flex direction="column" gap="1" className="suiw-steps">
                    {steps.map(s => (
                      <Flex key={s.id} align="center" gap="2" className={`suiw-step suiw-step--${s.state}`}>
                        <Box
                          width="6px"
                          height="6px"
                          className={s.state === 'active' ? 'suiw-pulse' : undefined}
                          style={{
                            borderRadius: '50%',
                            background: s.state === 'active' ? 'var(--accent-9)' : 'var(--gray-a7)',
                            flex: '0 0 auto',
                          }}
                        />
                        <Text
                          size="1"
                          color={s.state === 'active' ? undefined : 'gray'}
                          className="suiw-step-label"
                        >
                          {s.label}
                        </Text>
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
              </Flex>
            </Box>

            {composer}
          </div>

          <PreviewCanvas
            onSelectElement={setSelection}
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
