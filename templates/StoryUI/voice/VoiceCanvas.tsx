/**
 * VoiceCanvas v5 — Storybook iframe + postMessage
 *
 * Architecture:
 *   - LLM generates JSX code string
 *   - Server writes a STATIC react-live story template ONCE on first use
 *     (voice-canvas.stories.tsx never changes after creation — no HMR cascade)
 *   - Preview renders in a Storybook iframe (full decorator chain = correct Mantine theme)
 *   - Code updates on generate / undo / redo are delivered via:
 *       1. localStorage (persists across iframe reloads)
 *       2. window.postMessage (instant in-place update, no iframe reload needed)
 *
 * This means undo/redo has ZERO file I/O and ZERO HMR, so the outer
 * StoryUIPanel is never accidentally reset.
 */
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

// ── Constants ─────────────────────────────────────────────────

const STORY_ID = 'generated-voice-canvas--default';
const LS_KEY = '__voice_canvas_code__';
const LS_PROMPT_KEY = '__voice_canvas_prompt__';
const IFRAME_ORIGIN = window.location.origin;

// ── Types ─────────────────────────────────────────────────────

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
  const [iframeKey, setIframeKey] = useState(0);

  // ── Generation state ─────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');

  // ── Last prompt (used for auto-title on save) ─────────────────
  const lastPromptRef = useRef('');

  // ── Voice input ──────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [pendingTranscript, setPendingTranscript] = useState('');

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
   * Persist code and push it to the story preview iframe.
   * Safe to call before the iframe is loaded — the code is stored in localStorage
   * and the story reads it on mount.
   */
  const sendCodeToIframe = useCallback((code: string) => {
    try { localStorage.setItem(LS_KEY, code); } catch {}
    if (iframeRef.current?.contentWindow && iframeLoadedRef.current) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'VOICE_CANVAS_UPDATE', code },
        IFRAME_ORIGIN,
      );
    }
  }, []);

  // ── Generate / Edit ───────────────────────────────────────────

  const sendCanvasRequest = useCallback(async (transcript: string) => {
    if (abortRef.current) abortRef.current.abort();

    // Stamp this generation so stale finally blocks from aborted requests
    // don't clobber the state of a newer in-flight request.
    const genId = ++generationCounterRef.current;

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
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Server error ${response.status}: ${err}`);
      }

      setStatusText('Building...');

      const data = await response.json();
      const newCode: string = data.canvasCode ?? '';

      if (newCode.trim()) {
        if (currentCode.trim()) {
          setUndoStack(prev => [...prev.slice(-19), currentCode]);
          setRedoStack([]);
        }

        setCurrentCode(newCode);
        sendCodeToIframe(newCode);

        // First generation — mount the iframe
        if (!storyReady) {
          setStoryReady(true);
          setIframeKey(k => k + 1);
        }

        lastPromptRef.current = transcript;
        setLastPrompt(transcript);
        try { localStorage.setItem(LS_PROMPT_KEY, transcript); } catch {}
        conversationRef.current.push(
          { role: 'user', content: transcript },
          { role: 'assistant', content: '[Generated canvas component]' },
        );
        if (conversationRef.current.length > 40) {
          conversationRef.current = conversationRef.current.slice(-40);
        }
      } else {
        setErrorMessage('No component was generated. Try a different prompt.');
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
      }
    } finally {
      clearTimeout(timeoutId);
      // Only reset shared state if no newer generation has started since we began.
      if (generationCounterRef.current === genId) {
        setIsGenerating(false);
        abortRef.current = null;
      }
    }
  }, [apiBase, provider, model, storyReady, sendCodeToIframe, onError]);

  // ── Undo ──────────────────────────────────────────────────────
  // No file I/O — just update code and postMessage to the already-loaded iframe

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, currentCodeRef.current]);
    setUndoStack(u => u.slice(0, -1));
    setCurrentCode(prev);
    sendCodeToIframe(prev);
  }, [undoStack, sendCodeToIframe]);

  // ── Redo ──────────────────────────────────────────────────────

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, currentCodeRef.current]);
    setRedoStack(r => r.slice(0, -1));
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
    setStoryReady(false);
    iframeLoadedRef.current = false;
    conversationRef.current = [];
    setErrorMessage('');
    setIsGenerating(false);
    setStatusText('');
    setPendingTranscript('');
    pendingTranscriptRef.current = '';
    setLastPrompt('');
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
          lastPrompt: lastPromptRef.current,
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
      if (prompt) {
        // Clear the pending transcript BEFORE sending so that stopListening
        // (if pressed moments later) doesn't fire a duplicate request.
        pendingTranscriptRef.current = '';
        setPendingTranscript('');
        sendCanvasRequest(prompt);
      }
      autoSubmitRef.current = null;
    }, 1200);
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

        const trimmed = final.trim().toLowerCase();
        if (trimmed.split(/\s+/).length <= 3) {
          if (trimmed === 'clear' || trimmed === 'start over') {
            clear(); pendingTranscriptRef.current = ''; setPendingTranscript(''); return;
          }
          if (trimmed === 'undo') {
            undo(); pendingTranscriptRef.current = ''; setPendingTranscript(''); return;
          }
          if (trimmed === 'redo') {
            redo(); pendingTranscriptRef.current = ''; setPendingTranscript(''); return;
          }
          if (trimmed === 'stop' || trimmed === 'stop listening') {
            stopListeningRef.current(); return;
          }
        }

        if (abortRef.current) abortRef.current.abort();
        scheduleIntent(accumulated);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'not-allowed') {
        setErrorMessage('Microphone access denied');
        isListeningRef.current = false;
        setIsListening(false);
      }
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
  }, [clear, undo, redo, scheduleIntent]);

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
      sendCanvasRequest(pending);
      pendingTranscriptRef.current = '';
      setPendingTranscript('');
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, [sendCanvasRequest]);

  stopListeningRef.current = stopListening;

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

  useEffect(() => {
    try {
      const savedCode = localStorage.getItem(LS_KEY);
      if (savedCode && savedCode.trim()) {
        setCurrentCode(savedCode);
        setStoryReady(true);
      }
      const savedPrompt = localStorage.getItem(LS_PROMPT_KEY);
      if (savedPrompt) {
        lastPromptRef.current = savedPrompt;
        setLastPrompt(savedPrompt);
      }
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
      if (audioCheckRef.current) clearTimeout(audioCheckRef.current);
      if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const hasContent = currentCode.trim().length > 0;
  const iframeSrc = `/iframe.html?id=${STORY_ID}&viewMode=story&singleStory=true`;
  const speechSupported = !!(
    typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  );

  // ── Unsupported browser state ──────────────────────────────────

  if (!speechSupported) {
    return (
      <div className="sui-canvas-container">
        <div className="sui-canvas-unsupported">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
            <line x1="2" x2="22" y1="2" y2="22" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <h2 className="sui-canvas-unsupported-title">Voice not available</h2>
          <p className="sui-canvas-unsupported-desc">
            Voice Canvas requires the Web Speech API, which isn't supported in this browser.
            Try Chrome or Edge for the full experience.
          </p>
        </div>
      </div>
    );
  }

  // ── Imperative handle (for parent "New Canvas" button) ──────────

  useImperativeHandle(ref, () => ({ clear }), [clear]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="sui-canvas-container">

      {/* ── Preview area ──────────────────────────────────────── */}
      <div className="sui-canvas-preview">

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
              Speak to build interfaces live with your design system components.
            </p>
            <p className="sui-canvas-empty-hint">
              Try: "Create a product card with an image, title, price, and buy button"
            </p>
          </div>
        )}

        {/* First-generation spinner */}
        {!storyReady && isGenerating && (
          <div className="sui-canvas-progress">
            <div className="sui-canvas-progress-spinner" />
            <span className="sui-canvas-progress-text">{statusText || 'Building...'}</span>
          </div>
        )}

        {/* Storybook iframe — renders with full Mantine decorator chain */}
        {storyReady && (
          <div className="sui-canvas-live-wrapper">
            {/* Re-generation overlay */}
            {isGenerating && (
              <div className="sui-canvas-regen-overlay">
                <div className="sui-canvas-progress-spinner sui-canvas-progress-spinner--sm" />
                <span>{statusText || 'Regenerating...'}</span>
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

          {/* Mic button */}
          <button
            type="button"
            className={`sui-canvas-mic ${isListening ? 'sui-canvas-mic--active' : ''}`}
            onClick={toggleListening}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
            {isListening && <span className="sui-canvas-mic-pulse" />}
          </button>

          {/* Transcript display */}
          <div className="sui-canvas-transcript">
            {isGenerating ? (
              <span className="sui-canvas-status-rendering">{statusText || 'Building interface...'}</span>
            ) : interimText ? (
              <span className="sui-canvas-status-interim">
                {pendingTranscript ? pendingTranscript + ' ' : ''}{interimText}
              </span>
            ) : pendingTranscript ? (
              <span className="sui-canvas-status-final">{pendingTranscript}</span>
            ) : isListening ? (
              <span className="sui-canvas-status-listening">Listening... describe what you want to build</span>
            ) : lastPrompt ? (
              <span className="sui-canvas-status-hint" title={lastPrompt}>
                ✓ {lastPrompt.length > 72 ? lastPrompt.slice(0, 69) + '…' : lastPrompt}
              </span>
            ) : (
              <span className="sui-canvas-status-hint">Click the mic and describe what to build</span>
            )}
          </div>
        </div>

        {/* Text input */}
        {/* Action buttons */}
        <div className="sui-canvas-bar-right">
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

