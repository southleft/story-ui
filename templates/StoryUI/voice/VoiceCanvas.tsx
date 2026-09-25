/**
 * VoiceCanvas v6 — Jev decisions first, LLM generation when needed
 *
 * Architecture:
 *   - Every request goes to /mcp/canvas-voice first. Jev (TypeSafe's System
 *     One model) decides the action, element, prop and value from closed sets
 *     in ~0.5s and the server applies the edit to the canvas code as an AST
 *     splice. Commands (undo, save, …) are decided the same way.
 *   - When Jev is not configured, not confident, or the request needs new
 *     structure, the server says `fallback` and the request goes to
 *     /mcp/canvas-generate — the LLM path — exactly as before.
 *   - Either way the result is a JSX code string
 *   - Server writes a STATIC react-live story template ONCE on first use
 *     (voice-canvas.stories.tsx never changes after creation — no HMR cascade)
 *   - Preview renders in a Storybook iframe (full decorator chain = correct theme)
 *   - Code updates on generate / undo / redo are delivered via:
 *       1. localStorage (persists across iframe reloads)
 *       2. window.postMessage (instant in-place update, no iframe reload needed)
 *
 * This means undo/redo has ZERO file I/O and ZERO HMR, so the outer
 * StoryUIPanel is never accidentally reset.
 */
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { parseVoiceCommand } from './voiceCommands';

// ── Constants ─────────────────────────────────────────────────

const STORY_ID = 'generated-voice-canvas--default';
const LS_KEY = '__voice_canvas_code__';
const LS_PROMPT_KEY = '__voice_canvas_prompt__';
const IFRAME_ORIGIN = window.location.origin;

// ── Types ─────────────────────────────────────────────────────

interface DecisionStep {
  step: string;
  value: string;
  by: 'jev' | 'code';
  confidence?: number;
}

/** One request as the Decisions panel shows it. */
interface DecisionRecord {
  id: number;
  request: string;
  kind: 'deciding' | 'applied' | 'command' | 'setting' | 'waiting' | 'fallback' | 'ignored' | 'generated' | 'failed';
  detail: string;
  steps: DecisionStep[];
  stats?: { ms: number; calls: number; questions: number; usd: number; model?: string };
}

type VoiceOutcome =
  | { kind: 'applied'; canvasCode: string; summary: string; touched?: string | null; steps: DecisionStep[]; stats: DecisionRecord['stats'] }
  | { kind: 'command'; command: 'undo' | 'redo' | 'clear' | 'save' | 'stop'; steps: DecisionStep[]; stats: DecisionRecord['stats'] }
  | { kind: 'setting'; globals: Record<string, string>; summary: string; steps: DecisionStep[]; stats: DecisionRecord['stats'] }
  | { kind: 'fallback' | 'ignored' | 'incomplete'; reason: string; jevUnavailable?: string; steps: DecisionStep[]; stats: DecisionRecord['stats'] };

const DECISION_LABEL: Record<DecisionRecord['kind'], string> = {
  deciding: 'Deciding',
  applied: 'Applied',
  command: 'Command',
  setting: 'Setting',
  waiting: 'Waiting',
  fallback: 'To model',
  ignored: 'Ignored',
  generated: 'Generated',
  failed: 'Failed',
};

/** Silence after the last final result before a spoken request is applied. */
const PAUSE_TO_APPLY_MS = 1200;
/** The LLM path costs seconds and money, so it waits for a longer pause. */
const PAUSE_TO_GENERATE_MS = 3000;
/**
 * After Jev says a request stops mid-sentence, how long to wait for the rest
 * before deciding on what was said.
 */
const PAUSE_TO_FINISH_MS = 2000;

export interface VoiceCanvasProps {
  apiBase: string;
  provider?: string;
  /** LLM model — respects user's selection from the panel dropdown */
  model?: string;
  /** Called when the user saves the canvas as a named .stories.tsx file */
  onSave?: (result: { fileName: string; code: string; title: string }) => void;
  onError?: (error: string) => void;
}

/** Imperative handle exposed to parent via ref — used by "New Chat" button */
export interface VoiceCanvasHandle {
  /** Clear the canvas: abort generation, reset all state, blank the iframe */
  clear: () => void;
}

// ── Component ─────────────────────────────────────────────────

export const VoiceCanvas = React.forwardRef<VoiceCanvasHandle, VoiceCanvasProps>(
function VoiceCanvas({
  apiBase,
  provider,
  model,
  onSave,
  onError,
}: VoiceCanvasProps, ref) {
  // ── Code + history ───────────────────────────────────────────
  const [currentCode, setCurrentCode] = useState('');
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  // ── Preview state ────────────────────────────────────────────
  const [storyReady, setStoryReady] = useState(false);
  const storyReadyRef = useRef(false);
  const [iframeKey, setIframeKey] = useState(0);

  // ── Generation state ─────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState('');
  // Live LLM output shown while generating — the "watch it being written" feed.
  const [streamingCode, setStreamingCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');

  // ── Jev decisions ────────────────────────────────────────────
  // Whether the server can decide edits with Jev (TYPESAFE_API_KEY set).
  const [voiceDecisions, setVoiceDecisions] = useState(false);
  const voiceDecisionsRef = useRef(false);
  voiceDecisionsRef.current = voiceDecisions;
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [showDecisions, setShowDecisions] = useState(true);
  // Why fast decisions are off right now (no TypeSafe credits, bad key), or ''.
  const [jevNotice, setJevNotice] = useState('');
  const decisionIdRef = useRef(0);
  const healPendingRef = useRef<{ transcript: string; decisionId?: number; lastGood: string } | null>(null);
  // The element id the last applied request added or changed, valid only for
  // the code it came back with — "update the text" right after "add a
  // checkbox" means that checkbox. Anything else that changes the code clears it.
  const recentRef = useRef<string | null>(null);
  // Preview settings (Storybook globals) chosen by voice, e.g. { theme: 'dark' }.
  const [previewGlobals, setPreviewGlobals] = useState<Record<string, string>>({});
  // Fires the unfinished request as-is if the person never finishes it.
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Prompt tracking ─────────────────────────────────────────
  // firstPromptRef captures the initial creation prompt — used for auto-title
  // on save because it best describes the component (not the last edit command).
  // lastPromptRef tracks the most recent prompt for display purposes.
  const firstPromptRef = useRef('');
  const lastPromptRef = useRef('');

  // ── Voice input ──────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [pendingTranscript, setPendingTranscript] = useState('');

  // ── Text input ──────────────────────────────────────────────
  const [textInput, setTextInput] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);

  // ── Refs ──────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<Array<{ role: string; content: string }>>([]);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const autoSubmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTranscriptRef = useRef('');
  const audioCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const stopListeningRef = useRef<() => void>(() => {});
  const startListeningRef = useRef<() => void>(() => {});
  const currentCodeRef = useRef(currentCode);
  currentCodeRef.current = currentCode;
  // Incremented on every new generation to prevent stale finally blocks from
  // clobbering the state of a newer in-flight request.
  const generationCounterRef = useRef(0);
  // Ref to the preview iframe element
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // True after the iframe fires its onLoad event
  const iframeLoadedRef = useRef(false);

  // ── Code → iframe bridge ─────────────────────────────────────

  /**
   * Push code to the story preview iframe.
   * Uses both localStorage (for initial load before message listener is ready)
   * and postMessage (for instant updates once the iframe is running).
   */
  const sendCodeToIframe = useCallback((code: string) => {
    // Write to localStorage so the iframe can read it on initial mount —
    // postMessage alone doesn't work for the first generation because the
    // iframe's React component hasn't attached its message listener yet.
    try { localStorage.setItem(LS_KEY, code); } catch {}
    if (iframeRef.current?.contentWindow && iframeLoadedRef.current) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'VOICE_CANVAS_UPDATE', code },
        IFRAME_ORIGIN,
      );
    }
  }, []);

  // ── Generate / Edit ───────────────────────────────────────────

  /** Record a change to the canvas code: undo history, preview, conversation. */
  const commitCode = useCallback((newCode: string, transcript: string) => {
    const previous = currentCodeRef.current;
    if (previous.trim()) {
      setUndoStack(prev => [...prev.slice(-19), previous]);
      setRedoStack([]);
    }
    currentCodeRef.current = newCode;
    setCurrentCode(newCode);

    // First change — mount the iframe. Write to localStorage BEFORE mounting
    // so the iframe reads the code on initial render. Later changes go by
    // postMessage.
    if (!storyReadyRef.current) {
      try { localStorage.setItem(LS_KEY, newCode); } catch {}
      storyReadyRef.current = true;
      setStoryReady(true);
      setIframeKey(k => k + 1);
    } else {
      sendCodeToIframe(newCode);
    }

    // The first prompt titles the save (it describes the component); the
    // last is shown in the status bar.
    if (!firstPromptRef.current) firstPromptRef.current = transcript;
    lastPromptRef.current = transcript;
    setLastPrompt(transcript);
    // A real record of the code after each turn, so a later LLM edit sees
    // what Jev's edits did too.
    conversationRef.current.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: newCode.slice(0, 4000) },
    );
    if (conversationRef.current.length > 40) {
      conversationRef.current = conversationRef.current.slice(-40);
    }
  }, [sendCodeToIframe]);

  /**
   * Did the code actually render? The preview answers every code change with
   * VOICE_CANVAS_RENDERED; this waits for the answer about THIS code.
   * Resolves null when the preview never answers (not mounted yet, older
   * story template) — unknown, which is treated as fine, not as broken.
   */
  const renderWaitersRef = useRef<Array<{ code: string; resolve: (r: { error: string | null; empty: boolean } | null) => void }>>([]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== IFRAME_ORIGIN || e.data?.type !== 'VOICE_CANVAS_RENDERED') return;
      const hit = renderWaitersRef.current.filter(w => w.code === e.data.code);
      renderWaitersRef.current = renderWaitersRef.current.filter(w => w.code !== e.data.code);
      hit.forEach(w => w.resolve({ error: e.data.error ?? null, empty: !!e.data.empty }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const awaitRender = useCallback((code: string, ms = 5000) => new Promise<{ error: string | null; empty: boolean } | null>(resolve => {
    const waiter = { code, resolve };
    renderWaitersRef.current.push(waiter);
    setTimeout(() => {
      if (renderWaitersRef.current.includes(waiter)) {
        renderWaitersRef.current = renderWaitersRef.current.filter(w => w !== waiter);
        resolve(null);
      }
    }, ms);
  }), []);

  /** Put back the code that was there before the last commit — no new undo entry. */
  const revertLastCommit = useCallback((to: string) => {
    setUndoStack(prev => prev.slice(0, -1));
    currentCodeRef.current = to;
    setCurrentCode(to);
    recentRef.current = null;
    if (to) sendCodeToIframe(to);
    conversationRef.current = conversationRef.current.slice(0, -2);
  }, [sendCodeToIframe]);

  const updateDecision = useCallback((id: number, patch: Partial<DecisionRecord>) => {
    setDecisions(list => list.map(d => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const generateWithModel = useCallback(async (transcript: string, decisionId?: number, opts: { repairOf?: string; lastGood?: string; after?: string } = {}) => {
    // Reject prompts that are too short to produce useful output.
    // Fragments like "create a" or "please" result in broken code.
    const wordCount = transcript.trim().split(/\s+/).length;
    if (wordCount < 3) {
      setErrorMessage('Say a bit more — describe what you want to build.');
      if (decisionId !== undefined) updateDecision(decisionId, { kind: 'failed', detail: 'Too short for the generative model' });
      return;
    }

    if (abortRef.current) abortRef.current.abort();

    // Stamp this generation so stale finally blocks from aborted requests
    // don't clobber the state of a newer in-flight request.
    const genId = ++generationCounterRef.current;

    // Pause voice recognition while the LLM is thinking so the user can
    // talk freely without triggering new requests or aborting this one.
    // The mic resumes automatically when generation completes.
    const wasListening = isListeningRef.current;
    if (wasListening && recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
      // Keep isListeningRef.current = true so we know to resume later
    }

    setIsGenerating(true);
    setStatusText('Thinking...');
    setErrorMessage('');

    const controller = new AbortController();
    abortRef.current = controller;

    // 120-second safety timeout — prevents infinite "Thinking…" when the
    // MCP server accepts the connection but the LLM takes too long.
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);

    try {
      const currentCode = currentCodeRef.current;
      const isEdit = currentCode.trim().length > 0;

      const response = await fetch(`${apiBase}/mcp/canvas-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: transcript,
          canvasCode: isEdit ? currentCode : undefined,
          provider: provider || 'claude',
          model: model || undefined,
          conversationHistory: conversationRef.current,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Server error ${response.status}: ${err}`);
      }

      setStatusText('Building…');

      // Consume the SSE stream: `chunk` events carry raw LLM text deltas that
      // drive the live "writing code" overlay; the final `complete` event
      // carries the extracted + sanitized code that actually renders.
      let newCode = '';
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';
        let streamError: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const payload = JSON.parse(line.slice(6));
                if (currentEvent === 'chunk' && payload.delta) {
                  if (generationCounterRef.current === genId) {
                    setStreamingCode(prev => (prev + payload.delta).slice(-6000));
                  }
                } else if (currentEvent === 'complete') {
                  newCode = payload.canvasCode ?? '';
                } else if (currentEvent === 'error') {
                  streamError = payload.error || 'Generation stream failed';
                }
              } catch { /* malformed SSE line */ }
            }
          }
        }
        if (streamError) throw new Error(streamError);
      } else {
        // Legacy non-streaming server
        const data = await response.json();
        newCode = data.canvasCode ?? '';
      }
      if (generationCounterRef.current === genId) {
        setStreamingCode('');
      }

      if (newCode.trim()) {
        if (generationCounterRef.current === genId) {
          const before = currentCodeRef.current;
          commitCode(newCode, transcript);
          // A model rewrite can move anything; there is no single element it touched.
          recentRef.current = null;
          if (decisionId !== undefined) updateDecision(decisionId, { kind: 'generated', detail: opts.repairOf ? 'Repaired by the model' : opts.after ? `Generated by the model (${opts.after})` : 'Generated by the model' });
          // Self-healing: code that does not render gets ONE repair attempt,
          // then the canvas goes back to the last version that worked.
          const rendered = await awaitRender(newCode);
          if (rendered?.error && generationCounterRef.current === genId) {
            if (!opts.repairOf) {
              if (decisionId !== undefined) updateDecision(decisionId, { kind: 'deciding', detail: `Did not render (${rendered.error.slice(0, 80)}) — repairing…` });
              healPendingRef.current = { transcript: `The canvas code throws this error when it renders: ${rendered.error.slice(0, 500)}\nFix the code so it renders. Keep the same design and content. The original request was: ${transcript}`, decisionId, lastGood: before };
            } else {
              revertLastCommit(opts.lastGood ?? before);
              setErrorMessage(`The model's code did not render (${rendered.error.slice(0, 120)}). Kept the last version that worked.`);
              if (decisionId !== undefined) updateDecision(decisionId, { kind: 'failed', detail: `Still did not render after a repair: ${rendered.error.slice(0, 120)}` });
            }
          }
        }
      } else {
        setErrorMessage('No component was generated. Try a different prompt.');
        if (decisionId !== undefined) updateDecision(decisionId, { kind: 'failed', detail: 'The model returned no code' });
      }

      setStatusText('');
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Only surface a timeout error if this is still the active generation.
        if (timedOut && generationCounterRef.current === genId) {
          setErrorMessage('Request timed out — the LLM took too long. Please try again.');
          setStatusText('');
        }
        return;
      }
      if (generationCounterRef.current === genId) {
        const msg = error instanceof Error ? error.message : String(error);
        setErrorMessage(msg);
        setStatusText('');
        onError?.(msg);
        if (decisionId !== undefined) updateDecision(decisionId, { kind: 'failed', detail: msg });
      }
    } finally {
      clearTimeout(timeoutId);
      // Only reset shared state if no newer generation has started since we began.
      if (generationCounterRef.current === genId) {
        setIsGenerating(false);
        setStreamingCode('');
        abortRef.current = null;

        // A pending repair runs as soon as this generation has fully finished.
        const heal = healPendingRef.current;
        healPendingRef.current = null;
        if (heal) {
          setTimeout(() => generateWithModelRef.current(heal.transcript, heal.decisionId, { repairOf: transcript, lastGood: heal.lastGood }), 0);
          return;
        }
        // Resume voice recognition if it was active before generation started.
        // This lets the user keep talking hands-free across multiple edits.
        if (wasListening && isListeningRef.current) {
          setTimeout(() => {
            if (isListeningRef.current && !recognitionRef.current) {
              startListeningRef.current();
            }
          }, 300);
        }
      }
    }
  }, [apiBase, provider, model, commitCode, updateDecision, onError, awaitRender, revertLastCommit]);
  const generateWithModelRef = useRef(generateWithModel);
  generateWithModelRef.current = generateWithModel;

  /**
   * The canvas's front door: Jev decides, the server applies; anything Jev
   * hands back goes to the model.
   */
  const commandsRef = useRef<Record<string, () => void>>({});
  const sendCanvasRequest = useCallback(async (transcript: string, opts: { final?: boolean } = {}) => {
    const request = transcript.trim();
    if (!request) return;
    if (finishTimerRef.current) { clearTimeout(finishTimerRef.current); finishTimerRef.current = null; }
    if (!voiceDecisionsRef.current) return generateWithModel(request);

    const id = ++decisionIdRef.current;
    setDecisions(list => [{ id, request, kind: 'deciding' as const, detail: 'Evaluating this request…', steps: [] }, ...list].slice(0, 30));
    setErrorMessage('');

    let outcome: VoiceOutcome | null = null;
    try {
      const response = await fetch(`${apiBase}/mcp/canvas-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: request,
          canvasCode: currentCodeRef.current || undefined,
          recent: recentRef.current,
          final: opts.final === true,
        }),
      });
      if (response.ok) outcome = await response.json();
    } catch { /* the model path still works */ }

    if (!outcome) {
      updateDecision(id, { kind: 'fallback', detail: 'The decision service did not answer — using the model' });
      return generateWithModel(request, id);
    }
    const base = { steps: outcome.steps ?? [], stats: outcome.stats };
    setJevNotice(outcome.kind === 'fallback' && outcome.jevUnavailable ? outcome.jevUnavailable : '');
    if (outcome.kind === 'applied') {
      const before = currentCodeRef.current;
      commitCode(outcome.canvasCode, request);
      recentRef.current = outcome.touched || null;
      updateDecision(id, { ...base, kind: 'applied', detail: outcome.summary });
      const rendered = await awaitRender(outcome.canvasCode);
      if (rendered?.error && currentCodeRef.current === outcome.canvasCode) {
        // The edit was well-formed but the component throws when used this
        // way (a <Form> with no form state). Undo it and let the model build
        // it properly — the person asked for something reasonable.
        revertLastCommit(before);
        updateDecision(id, { kind: 'fallback', detail: `${outcome.summary} did not render (${rendered.error.slice(0, 80)}) — undone, using the model` });
        return generateWithModel(request, id, { lastGood: before, after: `${outcome.summary} did not render, so it was undone` });
      }
      return;
    }
    if (outcome.kind === 'command') {
      updateDecision(id, { ...base, kind: 'command', detail: outcome.command });
      commandsRef.current[outcome.command]?.();
      return;
    }
    if (outcome.kind === 'setting') {
      updateDecision(id, { ...base, kind: 'setting', detail: outcome.summary });
      iframeLoadedRef.current = false;
      setPreviewGlobals(g => ({ ...g, ...outcome!.globals as Record<string, string> }));
      return;
    }
    if (outcome.kind === 'incomplete') {
      // Put the words back and wait for the rest of the sentence; if none
      // comes, decide on what was said.
      updateDecision(id, { ...base, kind: 'waiting', detail: 'Waiting for the rest of the sentence…' });
      const rest = pendingTranscriptRef.current.trim();
      pendingTranscriptRef.current = rest ? `${request} ${rest}` : request;
      setPendingTranscript(pendingTranscriptRef.current);
      finishTimerRef.current = setTimeout(() => {
        finishTimerRef.current = null;
        const held = pendingTranscriptRef.current.trim();
        if (!held) return;
        pendingTranscriptRef.current = '';
        setPendingTranscript('');
        sendCanvasRequestRef.current(held, { final: true });
      }, PAUSE_TO_FINISH_MS);
      return;
    }
    if (outcome.kind === 'ignored') {
      updateDecision(id, { ...base, kind: 'ignored', detail: outcome.reason });
      return;
    }
    updateDecision(id, { ...base, kind: 'fallback', detail: `${outcome.reason} — using the model` });
    return generateWithModel(request, id);
  }, [apiBase, generateWithModel, commitCode, updateDecision, awaitRender, revertLastCommit]);
  const sendCanvasRequestRef = useRef(sendCanvasRequest);
  sendCanvasRequestRef.current = sendCanvasRequest;

  // Ask once whether the server can decide with Jev.
  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/mcp/canvas-config`)
      .then(r => (r.ok ? r.json() : null))
      .then(cfg => {
        if (cancelled) return;
        setVoiceDecisions(!!cfg?.voiceDecisions);
        if (cfg?.voiceDecisionsPaused) setJevNotice(cfg.voiceDecisionsPaused);
      })
      .catch(() => { /* no config, no fast path */ });
    return () => { cancelled = true; };
  }, [apiBase]);

  // ── Text input submit ────────────────────────────────────────

  const handleTextSubmit = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const value = textInput.trim();
    if (!value || isGenerating) return;
    setTextInput('');
    sendCanvasRequest(value, { final: true });
  }, [textInput, isGenerating, sendCanvasRequest]);

  // ── Undo ──────────────────────────────────────────────────────
  // No file I/O — just update code and postMessage to the already-loaded iframe

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, currentCodeRef.current]);
    setUndoStack(u => u.slice(0, -1));
    recentRef.current = null;
    currentCodeRef.current = prev;
    setCurrentCode(prev);
    sendCodeToIframe(prev);
  }, [undoStack, sendCodeToIframe]);

  // ── Redo ──────────────────────────────────────────────────────

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, currentCodeRef.current]);
    setRedoStack(r => r.slice(0, -1));
    recentRef.current = null;
    currentCodeRef.current = next;
    setCurrentCode(next);
    sendCodeToIframe(next);
  }, [redoStack, sendCodeToIframe]);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  // ── Clear ─────────────────────────────────────────────────────

  const clear = useCallback(() => {
    // Abort any in-flight generation so it doesn't land after the reset
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    generationCounterRef.current += 1; // invalidate any pending finally-block

    const current = currentCodeRef.current;
    if (current.trim()) {
      setUndoStack(prev => [...prev.slice(-19), current]);
      setRedoStack([]);
    }
    setCurrentCode('');
    currentCodeRef.current = '';
    storyReadyRef.current = false;
    setStoryReady(false);
    iframeLoadedRef.current = false;
    conversationRef.current = [];
    recentRef.current = null;
    setErrorMessage('');
    setIsGenerating(false);
    setStatusText('');
    setPendingTranscript('');
    pendingTranscriptRef.current = '';
    setLastPrompt('');
    firstPromptRef.current = '';
    lastPromptRef.current = '';
    try { localStorage.removeItem(LS_KEY); } catch {}
    try { localStorage.removeItem(LS_PROMPT_KEY); } catch {}
    // Force the iframe to remount — it will read empty localStorage and show the placeholder
    setIframeKey(k => k + 1);
  }, []);

  // ── Save ───────────────────────────────────────────────────────
  // No dialog — saves immediately using the last voice/text prompt as the title.

  const saveStory = useCallback(async () => {
    const code = currentCodeRef.current;
    if (!code.trim()) return;

    try {
      const response = await fetch(`${apiBase}/mcp/canvas-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsxCode: code,
          lastPrompt: firstPromptRef.current || lastPromptRef.current,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Save failed: ${err}`);
      }

      const result = await response.json();
      onSave?.(result);
      // Show a transient "Saved!" confirmation — keep the canvas alive so the
      // user can keep editing without losing their session.
      setSavedMessage(result.title || 'Saved!');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(msg);
      onError?.(msg);
    }
  }, [apiBase, onSave, onError, clear]);

  // ── Iframe load handler ────────────────────────────────────────

  const handleIframeLoad = useCallback(() => {
    iframeLoadedRef.current = true;
    // Deliver any pending code the iframe missed before it was ready
    const code = currentCodeRef.current;
    if (code) sendCodeToIframe(code);
  }, [sendCodeToIframe]);

  // ── Voice: schedule auto-submit ────────────────────────────────

  const scheduleIntent = useCallback((transcript: string) => {
    if (autoSubmitRef.current) clearTimeout(autoSubmitRef.current);
    autoSubmitRef.current = setTimeout(() => {
      const prompt = transcript.trim();
      // Require at least 3 words to avoid sending fragments like "create a"
      // or "please" that produce bad LLM output. Short pauses mid-thought
      // are common in natural speech — the longer delay (3s) gives the user
      // time to continue before auto-submitting.
      const wordCount = prompt.split(/\s+/).length;
      if (prompt && (voiceDecisionsRef.current || wordCount >= 3)) {
        pendingTranscriptRef.current = '';
        setPendingTranscript('');
        sendCanvasRequest(prompt);
      }
      autoSubmitRef.current = null;
    }, voiceDecisionsRef.current ? PAUSE_TO_APPLY_MS : PAUSE_TO_GENERATE_MS);
  }, [sendCanvasRequest]);

  // ── Voice: start ───────────────────────────────────────────────

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) recognitionRef.current.abort();

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }

      if (interim) {
        setInterimText(interim);
        if (finishTimerRef.current) { clearTimeout(finishTimerRef.current); finishTimerRef.current = null; }
        if (autoSubmitRef.current) {
          clearTimeout(autoSubmitRef.current);
          autoSubmitRef.current = null;
        }
      }

      if (final) {
        const accumulated = pendingTranscriptRef.current
          + (pendingTranscriptRef.current ? ' ' : '') + final;
        pendingTranscriptRef.current = accumulated;
        setPendingTranscript(accumulated);
        setInterimText('');

        const command = parseVoiceCommand(final);
        if (command) {
          if (command.type === 'clear') {
            clear(); pendingTranscriptRef.current = ''; setPendingTranscript(''); return;
          }
          if (command.type === 'undo') {
            undo(); pendingTranscriptRef.current = ''; setPendingTranscript(''); return;
          }
          if (command.type === 'redo') {
            redo(); pendingTranscriptRef.current = ''; setPendingTranscript(''); return;
          }
          if (command.type === 'stop') {
            stopListeningRef.current(); return;
          }
          if (command.type === 'save') {
            saveStory(); pendingTranscriptRef.current = ''; setPendingTranscript(''); return;
          }
          if (command.type === 'new-chat') {
            clear(); pendingTranscriptRef.current = ''; setPendingTranscript(''); return;
          }
          // 'submit' falls through to schedule an LLM generation below
        }

        if (abortRef.current) abortRef.current.abort();
        scheduleIntent(accumulated);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setErrorMessage('Microphone access denied');
        isListeningRef.current = false;
        setIsListening(false);
        return;
      }
      if (event.error === 'network') {
        // The browser's cloud speech service is unreachable — stop the
        // restart loop and tell the user instead of failing silently.
        setErrorMessage('Speech recognition is unavailable (network error). You can keep typing commands instead.');
        isListeningRef.current = false;
        setIsListening(false);
        return;
      }
      setErrorMessage(`Speech recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      if (isListeningRef.current) {
        setTimeout(() => {
          if (isListeningRef.current && recognitionRef.current) {
            try { recognitionRef.current.start(); } catch { /* ignore */ }
          }
        }, 100);
      }
    };

    recognitionRef.current = recognition;
    isListeningRef.current = true;
    setIsListening(true);
    pendingTranscriptRef.current = '';
    setPendingTranscript('');

    try {
      recognition.start();

      if (audioCheckRef.current) clearTimeout(audioCheckRef.current);
      audioCheckRef.current = setTimeout(async () => {
        if (!isListeningRef.current) return;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioStreamRef.current = stream;
          const audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);

          let maxLevel = 0;
          await new Promise<void>(resolve => {
            let samples = 0;
            const id = setInterval(() => {
              analyser.getByteFrequencyData(data);
              const avg = data.reduce((a, b) => a + b, 0) / data.length;
              if (avg > maxLevel) maxLevel = avg;
              if (++samples >= 10) { clearInterval(id); resolve(); }
            }, 100);
          });

          stream.getTracks().forEach(t => t.stop());
          audioStreamRef.current = null;
          audioCtx.close();

          if (maxLevel < 1 && isListeningRef.current) {
            setErrorMessage('No audio detected — check your microphone');
          }
        } catch { /* getUserMedia failed */ }
      }, 3000);
    } catch {
      setErrorMessage('Could not start voice input');
      isListeningRef.current = false;
      setIsListening(false);
    }
  }, [clear, undo, redo, scheduleIntent, saveStory]);

  startListeningRef.current = startListening;

  // ── Voice: stop ────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    setInterimText('');
    if (audioCheckRef.current) { clearTimeout(audioCheckRef.current); audioCheckRef.current = null; }
    if (audioStreamRef.current) { audioStreamRef.current.getTracks().forEach(t => t.stop()); audioStreamRef.current = null; }

    const pending = pendingTranscriptRef.current.trim();
    if (pending) {
      if (abortRef.current) abortRef.current.abort();
      if (autoSubmitRef.current) { clearTimeout(autoSubmitRef.current); autoSubmitRef.current = null; }
      sendCanvasRequest(pending, { final: true });
      pendingTranscriptRef.current = '';
      setPendingTranscript('');
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, [sendCanvasRequest]);

  stopListeningRef.current = stopListening;
  // What a spoken command decided by Jev runs.
  commandsRef.current = { undo, redo, clear, save: saveStory, stop: () => stopListeningRef.current() };

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) stopListening();
    else startListening();
  }, [startListening, stopListening]);

  // ── Keyboard shortcuts ─────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // ── Restore state after Storybook reload ──────────────────────
  // Storybook reloads the page when a new .stories.tsx file is saved.
  // Code is already persisted to localStorage by sendCodeToIframe,
  // so we just need to read it back and restore storyReady on mount.

  // Voice Canvas always starts with a clean slate — no session restore.
  // Each time the user switches to the Canvas tab or reloads, they see
  // the empty "describe what you want to build" state, same as Chat.
  // localStorage is still used for postMessage bridging within a single
  // generation session, but we clear it on mount so stale code from a
  // previous session never auto-loads.
  useEffect(() => {
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_PROMPT_KEY);
    } catch { /* localStorage unavailable */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (recognitionRef.current) {
        isListeningRef.current = false;
        recognitionRef.current.abort();
      }
      if (autoSubmitRef.current) clearTimeout(autoSubmitRef.current);
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      if (audioCheckRef.current) clearTimeout(audioCheckRef.current);
      if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const hasContent = currentCode.trim().length > 0;
  const globalsParam = Object.entries(previewGlobals).map(([k, v]) => `${k}:${v}`).join(';');
  const iframeSrc = `/iframe.html?id=${STORY_ID}&viewMode=story&singleStory=true${globalsParam ? `&globals=${encodeURIComponent(globalsParam)}` : ''}`;
  const speechSupported = !!(
    typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  );

  // ── Imperative handle (for parent "New Canvas" button) ──────────

  useImperativeHandle(ref, () => ({ clear }), [clear]);

  // ── Focus text input when not listening ──────────────────────
  useEffect(() => {
    if (!isListening && !isGenerating && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [isListening, isGenerating]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="sui-canvas-container">

      {/* ── Preview area ──────────────────────────────────────── */}
      <div className={`sui-canvas-preview${voiceDecisions && showDecisions && decisions.length > 0 ? ' sui-canvas-preview--decisions' : ''}`}>

        {/* Empty state */}
        {!storyReady && !isGenerating && (
          <div className="sui-canvas-empty">
            <div className="sui-canvas-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
            <h2 className="sui-canvas-empty-title">Voice Canvas</h2>
            <p className="sui-canvas-empty-desc">
              {speechSupported
                ? 'Speak or type to build interfaces live with your design system components.'
                : 'Type a prompt to build interfaces live with your design system components.'}
            </p>
            <p className="sui-canvas-empty-hint">
              Try: "Create a product card with an image, title, price, and buy button"
            </p>
            <p className="sui-canvas-empty-hint sui-canvas-empty-hint--save">
              Keep talking to change it: "make the button green", "add a checkbox".
              When you're happy, say <strong>"save it"</strong> (or press the save button) to keep it as a story.
            </p>
          </div>
        )}

        {/* First generation — live code stream while the model writes */}
        {!storyReady && isGenerating && (
          <div className="sui-canvas-progress">
            <div className="sui-canvas-progress-spinner" />
            <span className="sui-canvas-progress-text">{statusText || 'Building…'}</span>
            {streamingCode && (
              <pre className="sui-canvas-stream" aria-hidden="true"><code>{streamingCode.slice(-2200)}</code></pre>
            )}
          </div>
        )}

        {/* Storybook iframe — renders with full decorator chain */}
        {storyReady && (
          <div className="sui-canvas-live-wrapper">
            {/* Re-generation overlay with live code stream */}
            {isGenerating && (
              <div className="sui-canvas-regen-overlay">
                <div className="sui-canvas-regen-status">
                  <div className="sui-canvas-progress-spinner sui-canvas-progress-spinner--sm" />
                  <span>{statusText || 'Regenerating…'}</span>
                </div>
                {streamingCode && (
                  <pre className="sui-canvas-stream sui-canvas-stream--overlay" aria-hidden="true"><code>{streamingCode.slice(-1200)}</code></pre>
                )}
              </div>
            )}

            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={iframeSrc}
              title="Voice Canvas Preview"
              className="sui-canvas-iframe"
              onLoad={handleIframeLoad}
            />
          </div>
        )}

        {/* Fast decisions are off: say so where it cannot be missed */}
        {voiceDecisions && jevNotice && (
          <div className="sui-canvas-jev-notice" role="status">
            <strong>Fast decisions are paused.</strong> {jevNotice}. Requests are going to the model, which is slower.
          </div>
        )}

        {/* Decisions — what Jev decided for each request, and how sure it was */}
        {voiceDecisions && showDecisions && decisions.length > 0 && (
          <aside className="sui-canvas-decisions" aria-label="Decisions">
            <div className="sui-canvas-decisions-head">
              <span>Decisions</span>
              <button type="button" className="sui-canvas-decisions-close" onClick={() => setShowDecisions(false)} aria-label="Hide decisions">×</button>
            </div>
            <ol className="sui-canvas-decisions-list">
              {decisions.map(d => (
                <li key={d.id} className={`sui-canvas-decision sui-canvas-decision--${d.kind}`}>
                  <div className="sui-canvas-decision-top">
                    <span className="sui-canvas-decision-request">{d.request}</span>
                    <span className="sui-canvas-decision-kind">{DECISION_LABEL[d.kind]}</span>
                  </div>
                  <div className="sui-canvas-decision-detail">{d.detail}</div>
                  {d.steps.length > 0 && (
                    <ul className="sui-canvas-decision-steps">
                      {d.steps.map((s, i) => (
                        <li key={i}>
                          <span className="sui-canvas-decision-step">{s.step}</span>
                          <span className="sui-canvas-decision-value">{s.value}</span>
                          <span className="sui-canvas-decision-by">
                            {s.by === 'jev' ? `Jev${s.confidence !== undefined ? ` ${Math.round(s.confidence * 100)}%` : ''}` : 'code'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.stats && d.stats.calls > 0 && (
                    <div className="sui-canvas-decision-stats">
                      {d.stats.ms} ms · {d.stats.questions} questions · ${d.stats.usd.toFixed(6)}{d.stats.model ? ` · ${d.stats.model}` : ''}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </aside>
        )}

        {/* API / network errors */}
        {!isGenerating && errorMessage && (
          <div className="sui-canvas-error">
            <span>{errorMessage}</span>
            <button
              type="button"
              className="sui-canvas-error-dismiss"
              onClick={() => setErrorMessage('')}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {/* Save confirmation toast */}
        {savedMessage && (
          <div className="sui-canvas-saved-toast">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Saved: {savedMessage}</span>
          </div>
        )}
      </div>

      {/* ── Status bar ────────────────────────────────────────── */}
      {statusText && !isGenerating && (
        <div className="sui-canvas-status-bar">
          <span className="sui-canvas-explanation">{statusText}</span>
        </div>
      )}


      {/* ── Floating voice bar ─────────────────────────────────── */}
      <div className={`sui-canvas-bar ${isListening ? 'sui-canvas-bar--active' : ''}`}>
        <div className="sui-canvas-bar-left">

          {/* Mic button — hidden when speech API is unavailable */}
          {speechSupported && (
            <button
              type="button"
              className={`sui-canvas-mic ${isListening && !isGenerating ? 'sui-canvas-mic--active' : ''}`}
              onClick={toggleListening}
              disabled={isGenerating}
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
              {isListening && !isGenerating && <span className="sui-canvas-mic-pulse" />}
            </button>
          )}

          {/* Transcript display — shown while listening or generating */}
          {(isListening || isGenerating) && (
            <div className="sui-canvas-transcript">
              {isGenerating ? (
                <span className="sui-canvas-status-rendering">{statusText || 'Building interface...'}</span>
              ) : interimText ? (
                <span className="sui-canvas-status-interim">
                  {pendingTranscript ? pendingTranscript + ' ' : ''}{interimText}
                </span>
              ) : pendingTranscript ? (
                <span className="sui-canvas-status-final">{pendingTranscript}</span>
              ) : (
                <span className="sui-canvas-status-listening">
                  {hasContent
                    ? 'Listening… speak a change, or say "save it" when you\'re done'
                    : voiceDecisions ? 'Listening… speak a change, pause to apply' : 'Listening... describe what you want to build'}
                </span>
              )}
            </div>
          )}

          {/* Text input — shown when not listening and not generating */}
          {!isListening && !isGenerating && (
            <input
              ref={textInputRef}
              type="text"
              className="sui-canvas-text-input"
              placeholder={hasContent ? 'Type a change, or "save it" when you\'re done…' : 'Type what to build...'}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleTextSubmit}
              disabled={isGenerating}
            />
          )}
        </div>

        {/* Action buttons */}
        <div className="sui-canvas-bar-right">
          {voiceDecisions && decisions.length > 0 && (
            <button
              type="button"
              className={`sui-canvas-action ${showDecisions ? 'sui-canvas-action--on' : ''}`}
              onClick={() => setShowDecisions(v => !v)}
              aria-pressed={showDecisions}
              title="Show what Jev decided"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>
              </svg>
            </button>
          )}
          {canUndo && (
            <button type="button" className="sui-canvas-action" onClick={undo} title="Undo (Cmd+Z)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            </button>
          )}
          {canRedo && (
            <button type="button" className="sui-canvas-action" onClick={redo} title="Redo (Cmd+Shift+Z)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
              </svg>
            </button>
          )}
          {hasContent && (
            <button
              type="button"
              className="sui-canvas-action"
              onClick={saveStory}
              title="Save as story"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </button>
          )}
          {hasContent && (
            <button
              type="button"
              className="sui-canvas-action"
              onClick={clear}
              title="Clear canvas"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

