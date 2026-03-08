import React, { useCallback, useEffect, useRef, useState } from 'react';

interface VoiceCanvasProps {
  apiBase: string;
  provider?: string;
  model?: string;
  designSystem?: string;
  onSaveAsStory?: (html: string) => void;
  onError?: (error: string) => void;
}

interface RenderMetrics {
  timeMs: number;
  model: string;
  provider: string;
}

// Base HTML shell for the canvas iframe
const IFRAME_SHELL = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    line-height: 1.6;
    color: #c9d1d9;
    background: #0d1117;
    min-height: 100vh;
  }
  img { max-width: 100%; height: auto; display: block; }
  a { color: #58a6ff; text-decoration: none; }
  #canvas-root { min-height: 100%; }
  .canvas-loading {
    display: flex; align-items: center; gap: 8px;
    color: #8b949e; font-size: 14px; padding: 16px 0;
  }
  .canvas-loading::before {
    content: ''; width: 12px; height: 12px;
    border: 2px solid #8b949e; border-top-color: transparent;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body><div id="canvas-root"></div></body>
</html>`;

export function VoiceCanvas({
  apiBase,
  provider,
  model,
  designSystem,
  onSaveAsStory,
  onError,
}: VoiceCanvasProps) {
  const [currentHtml, setCurrentHtml] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [metrics, setMetrics] = useState<RenderMetrics | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [pendingTranscript, setPendingTranscript] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [noSpeechCount, setNoSpeechCount] = useState(0);
  const [manualPrompt, setManualPrompt] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const currentHtmlRef = useRef('');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  // Voice input refs
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const autoSubmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTranscriptRef = useRef('');
  const audioCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Keep refs in sync
  useEffect(() => { currentHtmlRef.current = currentHtml; }, [currentHtml]);
  useEffect(() => { historyRef.current = history; historyIndexRef.current = historyIndex; }, [history, historyIndex]);

  // Initialize the iframe with the shell HTML
  const initIframe = useCallback(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(IFRAME_SHELL);
    doc.close();
  }, []);

  // Update just the canvas root content (not the whole document)
  const updateCanvasContent = useCallback((html: string) => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    const root = doc.getElementById('canvas-root');
    if (root) {
      root.innerHTML = html;
    }
  }, []);

  // Show loading indicator in canvas
  const showCanvasLoading = useCallback((message: string) => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    const root = doc.getElementById('canvas-root');
    if (root) {
      // Append loading indicator below existing content
      let loader = doc.getElementById('canvas-loader');
      if (!loader) {
        loader = doc.createElement('div');
        loader.id = 'canvas-loader';
        loader.className = 'canvas-loading';
        root.appendChild(loader);
      }
      loader.textContent = message;
    }
  }, []);

  const removeCanvasLoading = useCallback(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    const loader = doc.getElementById('canvas-loader');
    if (loader) loader.remove();
  }, []);

  // Init iframe on mount
  useEffect(() => {
    initIframe();
  }, [initIframe]);

  // Stream HTML from the voice-render endpoint
  const renderFromPrompt = useCallback(async (prompt: string) => {
    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    setIsRendering(true);
    setStatusMessage('');
    showCanvasLoading('Rendering...');

    const controller = new AbortController();
    abortRef.current = controller;

    const htmlBefore = currentHtmlRef.current;

    try {
      const response = await fetch(`${apiBase}/mcp/voice-render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentHtml: htmlBefore || undefined,
          designSystem,
          conversation: conversationRef.current.length > 0 ? conversationRef.current : undefined,
          provider,
          model,
          useFastModel: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedHtml = '';

      removeCanvasLoading();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (separated by double newline)
        const messages = buffer.split('\n\n');
        buffer = messages.pop() || '';

        for (const msg of messages) {
          const lines = msg.split('\n');
          let eventType = '';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6);
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === 'html_chunk' && data.content !== undefined) {
              accumulatedHtml += data.content;
              updateCanvasContent(accumulatedHtml);
            } else if (eventType === 'complete' && data.html !== undefined) {
              accumulatedHtml = data.html;
              setCurrentHtml(data.html);
              updateCanvasContent(data.html);

              // Track in conversation
              conversationRef.current.push(
                { role: 'user', content: prompt },
                { role: 'assistant', content: data.html }
              );

              // Track in undo history
              setHistory(prev => {
                const newHistory = [...prev.slice(0, historyIndexRef.current + 1), data.html];
                setHistoryIndex(newHistory.length - 1);
                return newHistory;
              });

              if (data.metrics) {
                setMetrics(data.metrics);
                setStatusMessage(`Rendered in ${(data.metrics.timeMs / 1000).toFixed(1)}s`);
              }
            } else if (eventType === 'error') {
              onError?.(data.message);
              setStatusMessage(`Error: ${data.message}`);
            }
          } catch {
            // Non-JSON data, skip
          }
        }
      }

      // If we got HTML but no complete event, still save it
      if (accumulatedHtml && !currentHtmlRef.current) {
        setCurrentHtml(accumulatedHtml);
        updateCanvasContent(accumulatedHtml);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        const msg = error instanceof Error ? error.message : String(error);
        onError?.(msg);
        setStatusMessage(`Error: ${msg}`);
      }
    } finally {
      setIsRendering(false);
      removeCanvasLoading();
      abortRef.current = null;
    }
  }, [apiBase, designSystem, provider, model, updateCanvasContent, showCanvasLoading, removeCanvasLoading, onError]);

  // Undo/Redo
  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      const newIndex = historyIndexRef.current - 1;
      setHistoryIndex(newIndex);
      const html = historyRef.current[newIndex];
      setCurrentHtml(html);
      updateCanvasContent(html);
    }
  }, [updateCanvasContent]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      const newIndex = historyIndexRef.current + 1;
      setHistoryIndex(newIndex);
      const html = historyRef.current[newIndex];
      setCurrentHtml(html);
      updateCanvasContent(html);
    }
  }, [updateCanvasContent]);

  // Clear canvas
  const clear = useCallback(() => {
    setCurrentHtml('');
    setHistory([]);
    setHistoryIndex(-1);
    setMetrics(null);
    setStatusMessage('');
    setPendingTranscript('');
    pendingTranscriptRef.current = '';
    conversationRef.current = [];
    updateCanvasContent('');
  }, [updateCanvasContent]);

  // ============================================================
  // Voice input with "generate while speaking" behavior
  // ============================================================
  // Key insight: instead of waiting for the user to fully stop talking,
  // we start generating after a short pause (800ms). If the user keeps
  // talking, we ABORT the in-flight request and re-generate with the
  // accumulated transcript. This creates the illusion of real-time
  // generation that adapts as the user speaks.
  // ============================================================

  const scheduleRender = useCallback((transcript: string) => {
    if (autoSubmitRef.current) {
      clearTimeout(autoSubmitRef.current);
    }

    // Short delay — start generating quickly while user may still be talking
    autoSubmitRef.current = setTimeout(() => {
      const prompt = transcript.trim();
      if (prompt) {
        renderFromPrompt(prompt);
      }
      autoSubmitRef.current = null;
    }, 800); // 800ms — fast enough to feel responsive, long enough to catch short pauses
  }, [renderFromPrompt]);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimText(interim);
        // User is still speaking — abort any in-flight generation
        // so we can re-generate with the fuller transcript
        if (abortRef.current && autoSubmitRef.current) {
          // Don't abort if there's no pending auto-submit (means generation already committed)
        }
        // Cancel pending auto-submit while still speaking
        if (autoSubmitRef.current) {
          clearTimeout(autoSubmitRef.current);
          autoSubmitRef.current = null;
        }
      }

      if (final) {
        setNoSpeechCount(0);
        const accumulated = pendingTranscriptRef.current + (pendingTranscriptRef.current ? ' ' : '') + final;
        pendingTranscriptRef.current = accumulated;
        setPendingTranscript(accumulated);
        setInterimText('');

        // Check for voice commands (short utterances only)
        const trimmed = final.trim().toLowerCase();
        const words = trimmed.split(/\s+/);
        if (words.length <= 3) {
          if (trimmed === 'undo' || trimmed === 'go back') {
            undo();
            pendingTranscriptRef.current = '';
            setPendingTranscript('');
            return;
          }
          if (trimmed === 'redo') {
            redo();
            pendingTranscriptRef.current = '';
            setPendingTranscript('');
            return;
          }
          if (trimmed === 'clear' || trimmed === 'start over') {
            clear();
            return;
          }
          if (trimmed === 'stop' || trimmed === 'stop listening') {
            stopListening();
            return;
          }
          if (trimmed === 'save' || trimmed === 'save this') {
            if (currentHtmlRef.current && onSaveAsStory) {
              onSaveAsStory(currentHtmlRef.current);
            }
            pendingTranscriptRef.current = '';
            setPendingTranscript('');
            return;
          }
        }

        // Schedule generation — this is where the magic happens.
        // We abort any in-flight request and start generating with the
        // accumulated transcript. If the user keeps talking, this will
        // be called again with a longer transcript.
        if (abortRef.current) {
          abortRef.current.abort();
        }
        scheduleRender(accumulated);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        setNoSpeechCount(c => {
          const count = c + 1;
          if (count >= 2) {
            setStatusMessage('No speech detected — try speaking louder or use the text input below');
          }
          return count;
        });
        return;
      }
      if (event.error === 'not-allowed') {
        setStatusMessage('Microphone access denied — use the text input below');
        isListeningRef.current = false;
        setIsListening(false);
      } else {
        setStatusMessage(`Voice error: ${event.error}`);
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
      setNoSpeechCount(0);

      // Check audio levels after 3s — detect silent/wrong mic
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
          let samples = 0;
          const check = setInterval(() => {
            analyser.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            if (avg > maxLevel) maxLevel = avg;
            samples++;
            if (samples >= 10) {
              clearInterval(check);
              stream.getTracks().forEach(t => t.stop());
              audioStreamRef.current = null;
              audioCtx.close();
              if (maxLevel < 1 && isListeningRef.current) {
                const track = stream.getAudioTracks()[0];
                const device = track?.label || 'Unknown device';
                setStatusMessage(
                  `No audio detected from "${device}" — check your mic in Chrome settings (chrome://settings/content/microphone)`
                );
              }
            }
          }, 100);
        } catch {
          // getUserMedia failed — onerror on recognition will handle it
        }
      }, 3000);
    } catch (e) {
      setStatusMessage('Could not start voice input — use text input below');
      isListeningRef.current = false;
      setIsListening(false);
    }
  }, [undo, redo, clear, onSaveAsStory, scheduleRender]);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    setInterimText('');
    if (audioCheckRef.current) { clearTimeout(audioCheckRef.current); audioCheckRef.current = null; }
    if (audioStreamRef.current) { audioStreamRef.current.getTracks().forEach(t => t.stop()); audioStreamRef.current = null; }

    // Submit any pending transcript immediately
    const pending = pendingTranscriptRef.current.trim();
    if (pending) {
      if (abortRef.current) abortRef.current.abort();
      if (autoSubmitRef.current) {
        clearTimeout(autoSubmitRef.current);
        autoSubmitRef.current = null;
      }
      renderFromPrompt(pending);
      pendingTranscriptRef.current = '';
      setPendingTranscript('');
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, [renderFromPrompt]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  // Manual text submission (fallback when voice doesn't work)
  const handleManualSubmit = useCallback(() => {
    const prompt = manualPrompt.trim();
    if (!prompt) return;
    setManualPrompt('');
    if (abortRef.current) abortRef.current.abort();
    renderFromPrompt(prompt);
  }, [manualPrompt, renderFromPrompt]);

  // Cleanup on unmount
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

  const hasContent = !!currentHtml;

  return (
    <div className="sui-canvas-container">
      {/* Canvas area */}
      <div className="sui-canvas-preview">
        {!hasContent && !isRendering && (
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
              Click the microphone and describe a UI to create it in real-time.
            </p>
            <p className="sui-canvas-empty-hint">
              Try: "Create a pricing card with three tiers"
            </p>
          </div>
        )}
        <iframe
          ref={iframeRef}
          className="sui-canvas-iframe"
          title="Voice Canvas Preview"
          sandbox="allow-same-origin"
          style={{ display: hasContent || isRendering ? 'block' : 'none' }}
        />
      </div>

      {/* Floating voice bar */}
      <div className={`sui-canvas-bar ${isListening ? 'sui-canvas-bar--active' : ''}`}>
        <div className="sui-canvas-bar-left">
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

          <div className="sui-canvas-transcript">
            {isRendering && !interimText ? (
              <span className="sui-canvas-status-rendering">Rendering UI...</span>
            ) : interimText ? (
              <span className="sui-canvas-status-interim">{pendingTranscript ? pendingTranscript + ' ' : ''}{interimText}</span>
            ) : pendingTranscript ? (
              <span className="sui-canvas-status-final">{pendingTranscript}</span>
            ) : statusMessage ? (
              <span className="sui-canvas-status-info">{statusMessage}</span>
            ) : isListening ? (
              <span className="sui-canvas-status-listening">Listening... describe a UI to create</span>
            ) : (
              <span className="sui-canvas-status-hint">Click mic or type below</span>
            )}
          </div>
        </div>

        {/* Text input fallback */}
        <div className="sui-canvas-text-input">
          <input
            type="text"
            className="sui-canvas-text-field"
            placeholder="Or type a UI description..."
            value={manualPrompt}
            onChange={(e) => setManualPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
            disabled={isRendering}
          />
          {manualPrompt.trim() && (
            <button
              type="button"
              className="sui-canvas-text-submit"
              onClick={handleManualSubmit}
              disabled={isRendering}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          )}
        </div>

        <div className="sui-canvas-bar-right">
          {hasContent && (
            <>
              <button
                type="button"
                className="sui-canvas-action"
                onClick={undo}
                disabled={historyIndex <= 0}
                title="Undo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
              </button>
              <button
                type="button"
                className="sui-canvas-action"
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                title="Redo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>
              </button>
              <button
                type="button"
                className="sui-canvas-action"
                onClick={clear}
                title="Clear canvas"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </button>
              {onSaveAsStory && (
                <button
                  type="button"
                  className="sui-canvas-save"
                  onClick={() => onSaveAsStory(currentHtml)}
                  title="Save as Storybook story"
                >
                  Save as Story
                </button>
              )}
            </>
          )}
          {metrics && (
            <span className="sui-canvas-metrics">
              {(metrics.timeMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
