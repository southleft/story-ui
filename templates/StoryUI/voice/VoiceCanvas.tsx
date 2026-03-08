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
  const [streamingHtml, setStreamingHtml] = useState('');
  const [metrics, setMetrics] = useState<RenderMetrics | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const autoSubmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice input refs
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const finalTranscriptRef = useRef('');

  // Update the iframe content
  const updateIframe = useCallback((html: string) => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(`<!DOCTYPE html>
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
  a { color: #58a6ff; }
</style>
</head>
<body>${html}</body>
</html>`);
    doc.close();
  }, []);

  // Stream HTML from the voice-render endpoint
  const renderFromPrompt = useCallback(async (prompt: string) => {
    if (isRendering) {
      abortRef.current?.abort();
    }

    setIsRendering(true);
    setStreamingHtml('');
    setStatusMessage('AI is rendering...');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${apiBase}/mcp/voice-render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentHtml: currentHtml || undefined,
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            // Event type line — next data line has the payload
            continue;
          }
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.content !== undefined) {
                // html_chunk event
                accumulatedHtml += data.content;
                setStreamingHtml(accumulatedHtml);
                updateIframe(accumulatedHtml);
              } else if (data.html !== undefined) {
                // complete event
                accumulatedHtml = data.html;
                setCurrentHtml(data.html);
                setStreamingHtml('');
                updateIframe(data.html);

                // Track in conversation
                conversationRef.current.push(
                  { role: 'user', content: prompt },
                  { role: 'assistant', content: data.html }
                );

                // Track in undo history
                setHistory(prev => {
                  const newHistory = [...prev.slice(0, historyIndex + 1), data.html];
                  setHistoryIndex(newHistory.length - 1);
                  return newHistory;
                });

                if (data.metrics) {
                  setMetrics(data.metrics);
                  setStatusMessage(`Rendered in ${(data.metrics.timeMs / 1000).toFixed(1)}s`);
                }
              } else if (data.phase !== undefined) {
                // status event
                setStatusMessage(data.message || '');
              } else if (data.message !== undefined && !data.content && !data.html) {
                // error event
                onError?.(data.message);
                setStatusMessage(`Error: ${data.message}`);
              }
            } catch {
              // Non-JSON line, skip
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        const msg = error instanceof Error ? error.message : String(error);
        onError?.(msg);
        setStatusMessage(`Error: ${msg}`);
      }
    } finally {
      setIsRendering(false);
      abortRef.current = null;
    }
  }, [apiBase, currentHtml, designSystem, provider, model, historyIndex, updateIframe, onError, isRendering]);

  // Undo/Redo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const html = history[newIndex];
      setCurrentHtml(html);
      updateIframe(html);
    }
  }, [historyIndex, history, updateIframe]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const html = history[newIndex];
      setCurrentHtml(html);
      updateIframe(html);
    }
  }, [historyIndex, history, updateIframe]);

  // Clear canvas
  const clear = useCallback(() => {
    setCurrentHtml('');
    setStreamingHtml('');
    setHistory([]);
    setHistoryIndex(-1);
    setMetrics(null);
    setStatusMessage('');
    conversationRef.current = [];
    if (iframeRef.current?.contentDocument) {
      iframeRef.current.contentDocument.open();
      iframeRef.current.contentDocument.write('');
      iframeRef.current.contentDocument.close();
    }
  }, []);

  // Voice input setup
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
        // Cancel pending auto-submit while still speaking
        if (autoSubmitRef.current) {
          clearTimeout(autoSubmitRef.current);
          autoSubmitRef.current = null;
        }
      }

      if (final) {
        finalTranscriptRef.current += (finalTranscriptRef.current ? ' ' : '') + final;
        setInterimText('');

        // Check for voice commands
        const trimmed = final.trim().toLowerCase();
        if (trimmed === 'undo' || trimmed === 'go back') {
          undo();
          finalTranscriptRef.current = '';
          return;
        }
        if (trimmed === 'redo') {
          redo();
          finalTranscriptRef.current = '';
          return;
        }
        if (trimmed === 'clear' || trimmed === 'start over') {
          clear();
          finalTranscriptRef.current = '';
          return;
        }
        if (trimmed === 'stop' || trimmed === 'stop listening') {
          stopListening();
          return;
        }
        if (trimmed === 'save' || trimmed === 'save this') {
          if (currentHtml && onSaveAsStory) {
            onSaveAsStory(currentHtml);
          }
          finalTranscriptRef.current = '';
          return;
        }

        // Auto-submit after 2s pause
        if (autoSubmitRef.current) {
          clearTimeout(autoSubmitRef.current);
        }
        autoSubmitRef.current = setTimeout(() => {
          const prompt = finalTranscriptRef.current.trim();
          if (prompt) {
            renderFromPrompt(prompt);
            finalTranscriptRef.current = '';
          }
          autoSubmitRef.current = null;
        }, 2000);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed') {
        setStatusMessage('Microphone access denied');
        isListeningRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
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
    finalTranscriptRef.current = '';

    try { recognition.start(); } catch { /* ignore */ }
  }, [undo, redo, clear, currentHtml, onSaveAsStory, renderFromPrompt]);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    setInterimText('');

    // Submit any pending transcript
    const pending = finalTranscriptRef.current.trim();
    if (pending) {
      renderFromPrompt(pending);
      finalTranscriptRef.current = '';
    }

    if (autoSubmitRef.current) {
      clearTimeout(autoSubmitRef.current);
      autoSubmitRef.current = null;
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (recognitionRef.current) {
        isListeningRef.current = false;
        recognitionRef.current.abort();
      }
      if (autoSubmitRef.current) {
        clearTimeout(autoSubmitRef.current);
      }
    };
  }, []);

  const hasContent = !!(currentHtml || streamingHtml);

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
            {isRendering ? (
              <span className="sui-canvas-status-rendering">Rendering...</span>
            ) : interimText ? (
              <span className="sui-canvas-status-interim">{interimText}</span>
            ) : finalTranscriptRef.current ? (
              <span className="sui-canvas-status-final">{finalTranscriptRef.current}</span>
            ) : isListening ? (
              <span className="sui-canvas-status-listening">Listening... speak a UI description</span>
            ) : statusMessage ? (
              <span className="sui-canvas-status-info">{statusMessage}</span>
            ) : (
              <span className="sui-canvas-status-hint">Click mic to start voice canvas</span>
            )}
          </div>
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
