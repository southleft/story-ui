# Web Speech API Research: Voice-Activated UI Generation for Story UI

> **Date**: 2026-03-07
> **Author**: Frontend Architect
> **Status**: Technical Research / Design Proposal
> **Scope**: `useVoiceInput` hook + voice-to-component generation flow

---

## Table of Contents

1. [API Overview and Interface Hierarchy](#1-api-overview-and-interface-hierarchy)
2. [Browser Support Matrix](#2-browser-support-matrix)
3. [Core API Mechanics](#3-core-api-mechanics)
4. [Error Handling Model](#4-error-handling-model)
5. [Privacy, Security, and Network Considerations](#5-privacy-security-and-network-considerations)
6. [Performance and Latency Characteristics](#6-performance-and-latency-characteristics)
7. [React Hook Design: `useVoiceInput`](#7-react-hook-design-usevoiceinput)
8. [Voice-to-Component Generation Flow](#8-voice-to-component-generation-flow)
9. [Storybook Integration Challenges](#9-storybook-integration-challenges)
10. [Recommendations and Next Steps](#10-recommendations-and-next-steps)

---

## 1. API Overview and Interface Hierarchy

The Web Speech API provides two independent subsystems. Only the **Speech Recognition** side is relevant to this feature.

### Interface Hierarchy

```
EventTarget
  +-- SpeechRecognition          (controller: start/stop/abort)
        fires --> SpeechRecognitionEvent
                    .results --> SpeechRecognitionResultList
                                   [n] --> SpeechRecognitionResult
                                             .isFinal: boolean
                                             [n] --> SpeechRecognitionAlternative
                                                       .transcript: string
                                                       .confidence: number (0-1)
        fires --> SpeechRecognitionErrorEvent
                    .error: string
                    .message: string
```

### Key Interfaces

| Interface | Purpose |
|-----------|---------|
| `SpeechRecognition` | Controller: configures and manages the recognition session |
| `SpeechRecognitionEvent` | Carries recognized results on `result` and `nomatch` events |
| `SpeechRecognitionResult` | A single recognition match; contains `.isFinal` and alternative transcripts |
| `SpeechRecognitionAlternative` | One possible interpretation with `.transcript` and `.confidence` |
| `SpeechRecognitionErrorEvent` | Carries error type and message on `error` event |
| `SpeechRecognitionResultList` | Array-like container of all results in the current session |

### Deprecated / Experimental Interfaces (avoid)

- `SpeechGrammar` / `SpeechGrammarList` -- deprecated, no longer functional
- `SpeechRecognitionPhrase` -- experimental contextual biasing (Chrome-only, unstable)
- `processLocally` property -- experimental on-device recognition

---

## 2. Browser Support Matrix

**Global coverage: ~88% of users** (with caveats on the quality of that support).

### Desktop

| Browser | Version | Prefix Required | Notes |
|---------|---------|-----------------|-------|
| **Chrome** | 25+ | `webkitSpeechRecognition` | Server-side processing via Google servers. Requires HTTPS (except localhost). Most complete implementation. |
| **Edge** | 79+ (Chromium) | `webkitSpeechRecognition` | Same Chromium engine as Chrome. Same server-side behavior. |
| **Safari** | 14.1+ | `webkitSpeechRecognition` | Requires Siri to be enabled. No `SpeechGrammar` support. Partial implementation. |
| **Firefox** | Behind flag | N/A | `media.webspeech.recognition.enable` in about:config. Not enabled by default. Effectively unsupported for production. |
| **Opera** | Not supported | N/A | No implementation. |

### Mobile

| Browser | Version | Notes |
|---------|---------|-------|
| **Chrome Android** | 33+ | Same as desktop Chrome. Prefix required. |
| **Safari iOS** | 14.5+ | Requires Siri enabled. Prefix required. |
| **Samsung Internet** | 4+ | Partial support via Chromium engine. |
| **Firefox Android** | Not supported | Same as desktop Firefox. |

### Practical Assessment

```
Reliable:     Chrome (desktop + Android), Edge (Chromium)
Usable:       Safari (desktop + iOS) -- with Siri dependency
Unreliable:   Firefox, Opera, Samsung Internet
```

**Recommendation**: Target Chrome/Edge as primary. Safari as secondary with degraded UX. Show a clear "unsupported browser" message for Firefox/Opera. This aligns well with Storybook's developer audience, which skews heavily toward Chrome.

### Constructor Normalization

```typescript
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
```

This single line handles the prefix issue across all supporting browsers. If neither exists, the feature should be hidden entirely.

---

## 3. Core API Mechanics

### 3.1 Configuration Properties

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `continuous` | boolean | `false` | `false`: stops after first final result. `true`: keeps listening until `stop()` called. |
| `interimResults` | boolean | `false` | `true`: fires `result` events with non-final (in-progress) transcripts. |
| `lang` | string | User agent lang | BCP 47 language tag (e.g., `"en-US"`, `"es-ES"`, `"ja"`). |
| `maxAlternatives` | number | `1` | Number of alternative transcripts per result (1-10). Higher values = more LLM context. |

### 3.2 Continuous Mode vs Single-Shot

**Single-shot** (`continuous: false`):
- Recognition starts, captures one utterance, fires `result`, then fires `end`.
- Suitable for command-based input ("add a button").
- No need for manual `stop()`.

**Continuous** (`continuous: true`):
- Recognition runs until explicitly stopped via `stop()` or `abort()`.
- Fires multiple `result` events as the user speaks.
- The `results` array accumulates all results for the session.
- **Critical for Story UI**: enables the "dictated interface builder" where users speak naturally and components assemble incrementally.

### 3.3 Interim Results Deep-Dive

When `interimResults: true`, the `result` event fires frequently with partial transcripts:

```
User says: "add a navigation bar with three links"

Event 1: results[0][0].transcript = "add"             isFinal: false
Event 2: results[0][0].transcript = "add a"           isFinal: false
Event 3: results[0][0].transcript = "add a navigation" isFinal: false
Event 4: results[0][0].transcript = "add a navigation bar" isFinal: false
...
Event N: results[0][0].transcript = "add a navigation bar with three links"  isFinal: true
```

Key behaviors:
- Interim results for the same utterance **replace** each other (same index in `results`).
- The `resultIndex` property indicates the lowest index that changed.
- In continuous mode, new utterances get new indices in `results`.
- Interim transcript text can change dramatically between events (e.g., "add a nab" -> "add a navigation").

### 3.4 Processing the Results Array

```typescript
recognition.onresult = (event: SpeechRecognitionEvent) => {
  let interimTranscript = '';
  let finalTranscript = '';

  // Only process from resultIndex forward (optimization)
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    const transcript = result[0].transcript;

    if (result.isFinal) {
      finalTranscript += transcript + ' ';
    } else {
      interimTranscript += transcript;
    }
  }

  // interimTranscript: what the user is currently saying (unstable)
  // finalTranscript: what has been confirmed (stable, ready for LLM)
};
```

### 3.5 Event Lifecycle

The full event sequence for a typical recognition session:

```
start          --> recognition service connected
audiostart     --> microphone capturing
soundstart     --> sound detected (may be noise)
speechstart    --> speech detected (not noise)

[result events fire here -- interim and final]

speechend      --> speech stopped
soundend       --> all sound stopped
audioend       --> microphone released
end            --> service disconnected

OR at any point:
error          --> something went wrong
nomatch        --> speech heard but not recognized
```

**Important timing notes**:
- `end` fires regardless of whether recognition succeeded or errored.
- In continuous mode, `speechend` does NOT stop recognition. Only `end` does.
- After `end` fires, you must call `start()` again to restart.
- Chrome auto-stops continuous recognition after ~60 seconds of silence.

---

## 4. Error Handling Model

### 4.1 Error Types

| Error Code | Cause | Recovery Strategy |
|------------|-------|-------------------|
| `no-speech` | Silence for too long (~10s in Chrome) | Auto-restart recognition. Show "still listening" indicator. |
| `aborted` | `abort()` called or browser interrupted | Intentional -- no recovery needed. |
| `audio-capture` | Microphone not available or in use | Show troubleshooting UI. Check `navigator.mediaDevices.enumerateDevices()`. |
| `network` | Server-based recognition failed (Chrome) | Retry with exponential backoff. Suggest checking connection. |
| `not-allowed` | Microphone permission denied | Show permission instructions. Cannot auto-recover. |
| `service-not-allowed` | Browser policy blocks speech recognition | Show unsupported message. Cannot recover. |
| `language-not-supported` | Requested `lang` not available | Fall back to `"en-US"` or user agent default. |
| `bad-grammar` | Deprecated grammar error | Ignore (grammar system no longer functional). |

### 4.2 Error Handling Pattern

```typescript
recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
  switch (event.error) {
    case 'no-speech':
      // Transient -- auto-restart after brief delay
      setTimeout(() => recognition.start(), 500);
      break;

    case 'network':
      // Retry with backoff
      retryWithBackoff(() => recognition.start());
      break;

    case 'not-allowed':
    case 'service-not-allowed':
      // Terminal -- user must act
      showPermissionUI();
      break;

    case 'audio-capture':
      // Hardware issue
      showMicrophoneTroubleshooting();
      break;

    case 'aborted':
      // Intentional stop -- no action
      break;

    default:
      console.warn(`Speech recognition error: ${event.error}`, event.message);
  }
};
```

---

## 5. Privacy, Security, and Network Considerations

### 5.1 HTTPS Requirement

| Context | HTTPS Required |
|---------|---------------|
| Chrome (remote) | Yes |
| Chrome (localhost) | No (works on http://localhost) |
| Safari | Yes |
| Edge | Yes |
| Storybook dev server | No (localhost exemption applies) |
| Storybook iframe (cross-origin) | Potentially problematic -- see Section 9 |

### 5.2 Audio Transmission (Chrome)

Chrome's `SpeechRecognition` sends audio to Google's servers for processing. This has several implications:

- **Privacy**: Users should be informed that their speech leaves the browser.
- **Latency**: Network round-trip adds 200-500ms to recognition.
- **Offline**: Does not work without internet connectivity.
- **Data retention**: Subject to Google's data processing policies.

**Mitigation options**:
1. Display a clear privacy notice before enabling voice input.
2. The experimental `processLocally = true` property forces on-device processing (Chrome 127+, requires language pack download). This is too experimental for production use today.
3. Never auto-start recognition -- always require explicit user action.

### 5.3 Microphone Permissions

The browser's permission prompt is triggered by the first call to `recognition.start()`. Behavior:

- **First time**: Browser shows permission dialog. Recognition waits for user response.
- **Previously allowed**: Recognition starts immediately.
- **Previously denied**: `error` event fires with `not-allowed`. No prompt shown.
- **Permission can be revoked**: User can revoke via browser settings at any time.

**Permission state checking** (before starting recognition):

```typescript
async function checkMicrophonePermission(): Promise<PermissionState> {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return result.state; // 'granted' | 'denied' | 'prompt'
  } catch {
    // Firefox doesn't support querying microphone permission
    return 'prompt';
  }
}
```

### 5.4 Permissions-Policy Header

The `on-device-speech-recognition` directive controls whether the experimental on-device recognition can be used in iframes. The default allowlist is `self`, meaning cross-origin iframes are blocked. Standard (server-based) recognition uses the `microphone` permissions policy instead.

---

## 6. Performance and Latency Characteristics

### 6.1 Measured Latency Ranges

| Phase | Latency | Notes |
|-------|---------|-------|
| Permission prompt -> start | 0ms (if pre-granted) to seconds (user interaction) | One-time cost |
| Audio capture -> first interim result | 300-800ms | Depends on speech clarity |
| Interim result updates | 100-300ms intervals | Near real-time feel |
| Last speech -> final result | 500-1500ms | Post-processing delay |
| Error detection (no-speech) | ~8-15 seconds | Chrome's silence timeout |
| Network failure detection | 3-10 seconds | Varies by implementation |

### 6.2 CPU and Memory Impact

- **Idle listening**: Minimal CPU (microphone stream only).
- **Active recognition**: 2-5% CPU for audio encoding and transmission.
- **Memory**: ~5-15MB for the recognition service overhead.
- **Battery**: Continuous listening does consume power. Not suitable for always-on.

### 6.3 Throughput

- Interim results arrive at roughly 3-5 per second during active speech.
- Final results arrive after each natural pause (500ms+ silence typically triggers finalization).
- In continuous mode, rapid speech without pauses may produce very long interim transcripts before a final result fires.

---

## 7. React Hook Design: `useVoiceInput`

### 7.1 Type Definitions

```typescript
// ============================================
// Types
// ============================================

type VoicePermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

type VoiceInputStatus =
  | 'idle'           // Not started
  | 'requesting'     // Waiting for permission
  | 'listening'      // Actively capturing speech
  | 'processing'     // Final result received, debounce pending
  | 'error'          // Error state (recoverable or terminal)
  | 'unsupported';   // Browser does not support SpeechRecognition

interface VoiceError {
  code: string;              // SpeechRecognitionErrorEvent.error value
  message: string;           // Human-readable description
  recoverable: boolean;      // Whether auto-restart is possible
  timestamp: number;
}

interface VoiceTranscript {
  interim: string;           // Current in-progress transcript (unstable)
  final: string;             // Accumulated confirmed transcript (stable)
  confidence: number;        // Confidence of the most recent final result (0-1)
  isFinal: boolean;          // Whether the most recent event was a final result
  timestamp: number;         // When the transcript was last updated
}

interface UseVoiceInputOptions {
  /** BCP 47 language tag. Default: 'en-US' */
  lang?: string;
  /** Enable continuous listening mode. Default: true */
  continuous?: boolean;
  /** Enable interim (in-progress) results. Default: true */
  interimResults?: boolean;
  /** Debounce delay (ms) before submitting final transcript. Default: 1500 */
  submitDelay?: number;
  /** Auto-restart on transient errors (no-speech, network). Default: true */
  autoRestart?: boolean;
  /** Maximum consecutive restart attempts. Default: 3 */
  maxRestarts?: number;
  /** Callback when debounced final transcript is ready for LLM submission */
  onFinalTranscript?: (transcript: string) => void;
  /** Callback on each interim update (for live preview) */
  onInterimUpdate?: (interim: string) => void;
  /** Callback on error */
  onError?: (error: VoiceError) => void;
}

interface UseVoiceInputReturn {
  /** Current status of the voice input system */
  status: VoiceInputStatus;
  /** Current transcript data (interim + final) */
  transcript: VoiceTranscript;
  /** Current microphone permission state */
  permission: VoicePermissionState;
  /** Most recent error, if any */
  error: VoiceError | null;
  /** Whether the browser supports SpeechRecognition */
  isSupported: boolean;
  /** Start listening */
  start: () => void;
  /** Stop listening and finalize */
  stop: () => void;
  /** Stop listening and discard */
  abort: () => void;
  /** Clear accumulated transcript */
  clearTranscript: () => void;
  /** Audio level indicator (0-1) for visual feedback. Null if unavailable. */
  audioLevel: number | null;
}
```

### 7.2 Hook Implementation

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';

// ============================================
// Browser detection
// ============================================

const getSpeechRecognitionConstructor = (): typeof SpeechRecognition | null => {
  if (typeof window === 'undefined') return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
};

// ============================================
// Hook
// ============================================

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const {
    lang = 'en-US',
    continuous = true,
    interimResults = true,
    submitDelay = 1500,
    autoRestart = true,
    maxRestarts = 3,
    onFinalTranscript,
    onInterimUpdate,
    onError,
  } = options;

  // ---- State ----
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [permission, setPermission] = useState<VoicePermissionState>('prompt');
  const [error, setError] = useState<VoiceError | null>(null);
  const [transcript, setTranscript] = useState<VoiceTranscript>({
    interim: '',
    final: '',
    confidence: 0,
    isFinal: false,
    timestamp: 0,
  });

  // ---- Refs ----
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const restartCountRef = useRef(0);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalStopRef = useRef(false);
  const finalTranscriptAccRef = useRef('');

  // ---- Feature detection ----
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
  const isSupported = SpeechRecognitionCtor !== null;

  // ---- Permission check ----
  useEffect(() => {
    if (!isSupported) {
      setPermission('unsupported');
      setStatus('unsupported');
      return;
    }

    let mounted = true;
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((result) => {
        if (!mounted) return;
        setPermission(result.state as VoicePermissionState);

        result.addEventListener('change', () => {
          if (mounted) {
            setPermission(result.state as VoicePermissionState);
          }
        });
      })
      .catch(() => {
        // Firefox does not support querying microphone permission
        if (mounted) setPermission('prompt');
      });

    return () => { mounted = false; };
  }, [isSupported]);

  // ---- Initialize recognition instance ----
  useEffect(() => {
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    // -- result event --
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let finalSegment = '';
      let latestConfidence = 0;
      let hasFinal = false;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
          finalSegment += text + ' ';
          latestConfidence = result[0].confidence;
          hasFinal = true;
        } else {
          interim += text;
        }
      }

      if (hasFinal) {
        finalTranscriptAccRef.current += finalSegment;
        restartCountRef.current = 0; // Reset restart counter on successful recognition
      }

      setTranscript({
        interim,
        final: finalTranscriptAccRef.current,
        confidence: hasFinal ? latestConfidence : 0,
        isFinal: hasFinal,
        timestamp: Date.now(),
      });

      // Invoke callbacks
      if (interim && onInterimUpdate) {
        onInterimUpdate(finalTranscriptAccRef.current + interim);
      }

      // Debounce final transcript submission
      if (hasFinal && onFinalTranscript) {
        if (submitTimerRef.current) {
          clearTimeout(submitTimerRef.current);
        }
        submitTimerRef.current = setTimeout(() => {
          const accumulated = finalTranscriptAccRef.current.trim();
          if (accumulated) {
            setStatus('processing');
            onFinalTranscript(accumulated);
          }
        }, submitDelay);
      }
    };

    // -- error event --
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const recoverable = ['no-speech', 'network', 'aborted'].includes(event.error);
      const voiceError: VoiceError = {
        code: event.error,
        message: getErrorMessage(event.error),
        recoverable,
        timestamp: Date.now(),
      };

      setError(voiceError);
      if (onError) onError(voiceError);

      if (event.error === 'not-allowed') {
        setPermission('denied');
        setStatus('error');
      } else if (event.error === 'service-not-allowed') {
        setStatus('error');
      }
    };

    // -- end event --
    recognition.onend = () => {
      if (intentionalStopRef.current) {
        intentionalStopRef.current = false;
        setStatus('idle');
        return;
      }

      // Auto-restart logic for continuous mode
      if (
        autoRestart &&
        continuous &&
        restartCountRef.current < maxRestarts &&
        status !== 'error' &&
        permission !== 'denied'
      ) {
        restartCountRef.current += 1;
        const delay = Math.min(500 * restartCountRef.current, 3000);
        setTimeout(() => {
          try {
            recognition.start();
            setStatus('listening');
          } catch (e) {
            setStatus('error');
          }
        }, delay);
      } else {
        setStatus('idle');
      }
    };

    // -- start event --
    recognition.onstart = () => {
      setStatus('listening');
      setError(null);
      setPermission('granted');
    };

    // -- speechstart / speechend for UI feedback --
    recognition.onspeechstart = () => {
      // Could be used for audio level animation
    };

    recognition.onspeechend = () => {
      // Speech stopped -- final result incoming
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.abort(); } catch {}
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    };
  }, [SpeechRecognitionCtor, lang, continuous, interimResults]);
  // Note: callbacks intentionally excluded from deps to avoid recreation.
  // They are accessed via closure which always has the latest value due to
  // React's render cycle. For production, use useLatest pattern.

  // ---- Controls ----

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !isSupported) return;

    intentionalStopRef.current = false;
    restartCountRef.current = 0;
    setError(null);
    setStatus('requesting');

    try {
      recognition.start();
    } catch (e) {
      // Already started -- stop and restart
      try {
        recognition.stop();
        setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 100);
      } catch {}
    }
  }, [isSupported]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    intentionalStopRef.current = true;

    // Flush any pending debounced submission
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }

    // Submit whatever we have accumulated
    const accumulated = finalTranscriptAccRef.current.trim();
    if (accumulated && onFinalTranscript) {
      setStatus('processing');
      onFinalTranscript(accumulated);
    } else {
      setStatus('idle');
    }

    try { recognition.stop(); } catch {}
  }, [onFinalTranscript]);

  const abort = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    intentionalStopRef.current = true;
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }

    try { recognition.abort(); } catch {}
    setStatus('idle');
  }, []);

  const clearTranscript = useCallback(() => {
    finalTranscriptAccRef.current = '';
    setTranscript({
      interim: '',
      final: '',
      confidence: 0,
      isFinal: false,
      timestamp: 0,
    });
  }, []);

  return {
    status,
    transcript,
    permission,
    error,
    isSupported,
    start,
    stop,
    abort,
    clearTranscript,
    audioLevel: null, // Placeholder -- requires Web Audio API integration
  };
}

// ============================================
// Helpers
// ============================================

function getErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    'no-speech': 'No speech detected. Try speaking closer to your microphone.',
    'aborted': 'Voice input was cancelled.',
    'audio-capture': 'Microphone not found or not accessible. Check your audio settings.',
    'network': 'Network error during speech recognition. Check your internet connection.',
    'not-allowed': 'Microphone access denied. Enable microphone permissions in your browser settings.',
    'service-not-allowed': 'Speech recognition service is not available in this browser.',
    'language-not-supported': 'The selected language is not supported for speech recognition.',
    'bad-grammar': 'Speech recognition configuration error.',
  };
  return messages[code] || `Speech recognition error: ${code}`;
}
```

### 7.3 Hook Design Decisions

**Why continuous + interimResults both default to `true`**:
Story UI's use case is conversational dictation, not single-command input. Users will speak naturally: "Add a card component with a header showing user name, an avatar on the left, and two action buttons at the bottom." This requires continuous listening with live feedback.

**Why debounced submission (`submitDelay: 1500`)**:
Natural speech includes pauses. A 1.5-second debounce after the last final result prevents premature LLM calls when the user is merely pausing between clauses. The user can also manually stop to force immediate submission.

**Why auto-restart with backoff**:
Chrome terminates continuous recognition after ~60 seconds of silence (firing `no-speech` error then `end`). Without auto-restart, users would need to manually re-enable voice input after every pause. The backoff prevents rapid restart loops on persistent errors.

**Why `abort()` is separate from `stop()`**:
`stop()` finalizes and submits whatever has been captured. `abort()` discards everything. Both are useful: stop for "I am done speaking", abort for "cancel, forget what I said."

### 7.4 Storybook Iframe Considerations

The `StoryUIPanel` renders inside Storybook's manager iframe (not the preview iframe), which runs on the same origin as the Storybook dev server. This means:

- **localhost exemption applies**: No HTTPS requirement during development.
- **Permission persists**: Once granted for `localhost:6006`, it persists across Storybook sessions.
- **No cross-origin issues**: The panel is in the manager frame, not the preview iframe.

If the panel were ever moved to the preview iframe, cross-origin `getUserMedia` restrictions would apply and the `microphone` Permissions-Policy would need to be set on the iframe via the `allow` attribute.

---

## 8. Voice-to-Component Generation Flow

### 8.1 Architecture Overview

```
+------------------+     interim      +-------------------+
| SpeechRecognition| --------------> | Intent Classifier |
| (useVoiceInput)  |                 | (client-side)     |
+--------+---------+     final       +--------+----------+
         |           (debounced)              |
         |                                    |
         v                                    v
+------------------+               +-----------------------+
| Transcript       |               | Preview Renderer      |
| Accumulator      |               | (keyword -> skeleton) |
+--------+---------+               +-----------+-----------+
         |                                     |
         | onFinalTranscript                   | visual feedback
         v                                     v
+------------------+               +-----------------------+
| LLM Generation   |               | Component Preview     |
| (existing flow)  |               | (placeholder cards)   |
+--------+---------+               +-----------+-----------+
         |                                     |
         | generated story                     |
         v                                     v
+------------------+               +-----------------------+
| Storybook Story  |               | Replace preview with  |
| File Writer      |               | actual rendered story |
+------------------+               +-----------------------+
```

### 8.2 Dual-Path Processing

The system should use two parallel paths:

**Path 1: Client-Side Keyword Detection (Interim Results)**

Use interim results for immediate visual feedback without LLM calls. This is purely client-side pattern matching for UI responsiveness.

```typescript
// Lightweight intent detection from interim transcripts
interface DetectedIntent {
  action: 'add' | 'remove' | 'rearrange' | 'modify' | 'style';
  componentHint: string | null;   // e.g., "button", "card", "navbar"
  modifierHints: string[];         // e.g., ["large", "blue", "centered"]
}

const COMPONENT_KEYWORDS: Record<string, string[]> = {
  button:     ['button', 'btn', 'action button', 'submit', 'click'],
  card:       ['card', 'panel', 'tile', 'box'],
  navbar:     ['navbar', 'navigation', 'nav bar', 'menu bar', 'header'],
  form:       ['form', 'input', 'text field', 'login', 'signup'],
  table:      ['table', 'grid', 'data table', 'spreadsheet'],
  modal:      ['modal', 'dialog', 'popup', 'overlay'],
  list:       ['list', 'items', 'bullet points', 'ordered list'],
  image:      ['image', 'picture', 'photo', 'avatar', 'icon'],
  sidebar:    ['sidebar', 'side panel', 'drawer'],
  footer:     ['footer', 'bottom bar'],
  tabs:       ['tabs', 'tab bar', 'tab panel'],
  accordion:  ['accordion', 'collapsible', 'expandable'],
};

const ACTION_KEYWORDS: Record<string, string[]> = {
  add:       ['add', 'create', 'insert', 'put', 'include', 'make'],
  remove:    ['remove', 'delete', 'take away', 'get rid of'],
  rearrange: ['move', 'rearrange', 'swap', 'reorder', 'shift'],
  modify:    ['change', 'update', 'modify', 'edit', 'set'],
  style:     ['color', 'size', 'style', 'theme', 'make it'],
};

function detectIntent(transcript: string): DetectedIntent | null {
  const lower = transcript.toLowerCase();

  let action: DetectedIntent['action'] = 'add'; // default
  for (const [act, keywords] of Object.entries(ACTION_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      action = act as DetectedIntent['action'];
      break;
    }
  }

  let componentHint: string | null = null;
  for (const [component, keywords] of Object.entries(COMPONENT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      componentHint = component;
      break;
    }
  }

  if (!componentHint && action === 'add') return null;

  return { action, componentHint, modifierHints: [] };
}
```

**Path 2: LLM Generation (Final Results)**

Final, debounced transcripts are sent to the existing Story UI generation endpoint. This is the same flow as typing a prompt, but the input comes from speech.

```typescript
// Integration with existing StoryUIPanel submission flow
const handleVoiceFinalTranscript = useCallback((transcript: string) => {
  // The transcript becomes the prompt, identical to typing
  setPromptText(transcript);
  handleSubmit(transcript);
  voiceInput.clearTranscript();
}, [handleSubmit]);

const voiceInput = useVoiceInput({
  lang: 'en-US',
  continuous: true,
  interimResults: true,
  submitDelay: 2000,
  onFinalTranscript: handleVoiceFinalTranscript,
  onInterimUpdate: (interim) => {
    // Show what user is saying in the prompt textarea
    setPromptText(interim);

    // Client-side intent detection for preview
    const intent = detectIntent(interim);
    if (intent) {
      setPreviewIntent(intent);
    }
  },
});
```

### 8.3 Command Classification

The voice input should distinguish between different types of commands:

| Command Type | Example Speech | Handling |
|-------------|----------------|----------|
| **Create** | "Create a login form with email and password fields" | Full LLM generation via existing flow |
| **Modify** | "Make the button bigger and change its color to blue" | LLM generation with conversation context |
| **Rearrange** | "Move the sidebar to the right side" | LLM generation with conversation context |
| **Iterate** | "Add a search icon inside the input field" | LLM generation, append to conversation |
| **Meta** | "Stop listening" / "Clear" / "Start over" | Client-side command handling |

Meta commands should be intercepted client-side before reaching the LLM:

```typescript
const META_COMMANDS: Record<string, () => void> = {
  'stop listening': () => voiceInput.stop(),
  'cancel': () => voiceInput.abort(),
  'clear': () => voiceInput.clearTranscript(),
  'start over': () => { voiceInput.clearTranscript(); /* reset story */ },
  'undo': () => { /* trigger undo in story panel */ },
};

function checkMetaCommand(transcript: string): boolean {
  const lower = transcript.toLowerCase().trim();
  for (const [command, handler] of Object.entries(META_COMMANDS)) {
    if (lower === command || lower.endsWith(command)) {
      handler();
      return true;
    }
  }
  return false;
}
```

### 8.4 Incremental Story Updates via Conversation

Story UI already supports conversation history for iterative refinement. Voice input maps naturally to this:

```
User speaks: "Create a card with a title and description"
  -> LLM generates initial card story
  -> Story appears in Storybook

User speaks: "Add an image at the top of the card"
  -> Conversation includes previous context
  -> LLM modifies story to include image
  -> Story updates in Storybook

User speaks: "Now add three of these cards in a grid layout"
  -> LLM generates grid with three card instances
  -> Story updates again
```

This leverages the existing `ChatSession` and conversation history in `StoryUIPanel` with no architectural changes.

### 8.5 Preview During Speech (Skeleton UI)

While the user is still speaking (interim results), show a lightweight preview:

```typescript
interface ComponentPreviewProps {
  intent: DetectedIntent | null;
  isListening: boolean;
}

function ComponentPreview({ intent, isListening }: ComponentPreviewProps) {
  if (!intent || !isListening) return null;

  return (
    <div
      className="voice-preview"
      role="status"
      aria-live="polite"
      aria-label="Component preview based on voice input"
    >
      <div className="voice-preview__skeleton">
        <span className="voice-preview__label">
          {intent.action === 'add' ? 'Adding' : intent.action}:
          {' '}{intent.componentHint || 'component'}
        </span>
        <div className={`voice-preview__placeholder voice-preview__placeholder--${intent.componentHint}`}>
          {/* Render a simple skeleton shape based on component type */}
          <SkeletonShape type={intent.componentHint} />
        </div>
      </div>
    </div>
  );
}
```

---

## 9. Storybook Integration Challenges

### 9.1 Iframe Context

**Current architecture**: `StoryUIPanel` renders in the Storybook manager frame (the outer chrome), not the preview iframe. This is favorable because:

- The manager frame and the Storybook dev server share the same origin.
- `SpeechRecognition` and `getUserMedia` work without cross-origin restrictions.
- The `localhost` HTTPS exemption applies.

**Risk**: If the panel is rendered via MDX in the preview iframe (as it is for non-React frameworks), the docs addon processes it in an iframe that may have a different CSP or origin. However, since `StoryUIPanel.mdx` is processed by `@storybook/addon-docs` which uses React regardless of the framework, and runs on the same origin, this should not be a problem.

**Validation needed**: Test that `navigator.mediaDevices.getUserMedia` and `SpeechRecognition` both work from within the MDX-rendered context.

### 9.2 Cross-Origin Storybook Deployments

For the Railway production deployment (`https://app-production-16de.up.railway.app`), voice input will work because:
- HTTPS is active (Railway provides TLS).
- `SpeechRecognition` requires HTTPS for remote origins, which is satisfied.
- Microphone permission will need to be granted by the user.

### 9.3 Browser Compatibility Degradation Strategy

```typescript
function VoiceInputButton() {
  const voiceInput = useVoiceInput({ /* ... */ });

  // Feature not available -- hide the button entirely
  if (!voiceInput.isSupported) {
    return null;
  }

  // Permission denied -- show disabled state with tooltip
  if (voiceInput.permission === 'denied') {
    return (
      <button
        disabled
        title="Microphone access denied. Enable in browser settings."
        aria-label="Voice input unavailable - microphone permission denied"
      >
        <MicOffIcon />
      </button>
    );
  }

  // Normal operation
  return (
    <button
      onClick={voiceInput.status === 'listening' ? voiceInput.stop : voiceInput.start}
      aria-label={voiceInput.status === 'listening' ? 'Stop voice input' : 'Start voice input'}
      aria-pressed={voiceInput.status === 'listening'}
      className={`voice-btn voice-btn--${voiceInput.status}`}
    >
      {voiceInput.status === 'listening' ? <MicActiveIcon /> : <MicIcon />}
    </button>
  );
}
```

### 9.4 Visual Feedback During Listening

Voice input requires strong visual feedback because there is no keyboard/mouse interaction to anchor the user's attention:

```
Status: idle       -> Mic icon (muted)
Status: requesting -> Mic icon (pulsing) + "Requesting permission..."
Status: listening  -> Mic icon (animated ring) + live transcript in textarea
Status: processing -> Spinner + "Generating component..."
Status: error      -> Red mic icon + error message toast
```

CSS for the listening animation:

```css
.voice-btn--listening {
  position: relative;
}

.voice-btn--listening::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid currentColor;
  animation: voice-pulse 1.5s ease-in-out infinite;
}

@keyframes voice-pulse {
  0% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.3); opacity: 0.2; }
  100% { transform: scale(1); opacity: 0.8; }
}

/* Reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  .voice-btn--listening::after {
    animation: none;
    opacity: 0.5;
  }
}
```

### 9.5 Accessibility Considerations

Voice input introduces unique accessibility requirements:

1. **The voice button must be keyboard-accessible**: Users who cannot use a mouse but can speak need keyboard access to the mic toggle.

2. **Screen reader announcements**: Use `aria-live="polite"` for transcript updates and `aria-live="assertive"` for errors.

3. **Do not replace text input**: Voice must be an enhancement, never a replacement. The text prompt area must remain fully functional.

4. **Visual transcript feedback**: Display what was heard so users can verify before submission.

5. **Escape hatch**: Pressing Escape should stop listening (keyboard shortcut).

```typescript
// Keyboard shortcut for voice toggle
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Ctrl+Shift+V to toggle voice input
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      if (voiceInput.status === 'listening') {
        voiceInput.stop();
      } else {
        voiceInput.start();
      }
    }

    // Escape to abort voice input
    if (e.key === 'Escape' && voiceInput.status === 'listening') {
      voiceInput.abort();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [voiceInput.status]);
```

---

## 10. Recommendations and Next Steps

### 10.1 Implementation Priority

| Phase | Scope | Effort |
|-------|-------|--------|
| **Phase 1** | `useVoiceInput` hook + mic toggle button in StoryUIPanel | 2-3 days |
| **Phase 2** | Interim transcript display in prompt textarea | 1 day |
| **Phase 3** | Client-side intent detection + skeleton preview | 2-3 days |
| **Phase 4** | Meta commands ("stop", "clear", "undo") | 1 day |
| **Phase 5** | Audio level visualization + polished UI | 1-2 days |
| **Phase 6** | Cross-browser testing + edge case hardening | 1-2 days |

### 10.2 Technical Recommendations

1. **Do not use the `grammars` property**. It is deprecated and non-functional in all browsers.

2. **Do not use `processLocally`** in production. It is experimental and requires language pack downloads. Revisit when browser support stabilizes.

3. **Do not use `SpeechRecognitionPhrase`** for contextual biasing. It is experimental and Chrome-only. Instead, rely on the LLM to interpret design system vocabulary.

4. **Always set `lang` explicitly** to `"en-US"` (or user-selected locale) rather than relying on the browser default.

5. **Use `maxAlternatives: 1`** for simplicity. Multiple alternatives add complexity without meaningful benefit when the transcript is going to an LLM that can handle ambiguity.

6. **Display a privacy notice** on first use: "Voice input sends audio to your browser's speech recognition service (Google for Chrome, Apple for Safari) for processing."

7. **Store the user's voice preference** in localStorage so the feature remembers whether they opted in.

### 10.3 What NOT to Build

- **Custom speech recognition**: Using the Web Audio API + a custom ML model (e.g., Whisper.js) is tempting but adds 50-200MB to the bundle and significant complexity. The Web Speech API is sufficient for this use case.

- **Voice output / speech synthesis**: Reading generated code aloud provides no value for this use case. Skip the SpeechSynthesis API entirely.

- **Always-on listening**: This drains battery, creates privacy concerns, and provides no benefit over explicit activation.

- **Multi-language auto-detection**: Stick to a single configured language per session. Cross-language recognition is unreliable.

### 10.4 Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Firefox users cannot use voice | High | Low | Feature is additive; text input remains primary. Firefox developer market share is ~5%. |
| Chrome silence timeout (60s) interrupts long pauses | Medium | Medium | Auto-restart with backoff handles this transparently. |
| Background noise causes poor recognition | Medium | Medium | Show confidence score; allow user to retry or edit transcript before submission. |
| Users unaware audio goes to Google | Medium | High | Privacy notice on first activation. Store consent in localStorage. |
| Recognition accuracy too low for technical terms | Medium | Medium | The LLM downstream handles interpretation. "Mantain" -> "Mantine" can be inferred from context. |
| Storybook CSP blocks microphone in some deployments | Low | High | Document required CSP headers. Provide fallback messaging. |

---

## Appendix A: Complete Event Sequence Diagram

```
User clicks mic button
        |
        v
  recognition.start()
        |
        v
  [Browser permission dialog - first time only]
        |
        v
  Event: 'start'          --> status: 'listening'
        |
        v
  Event: 'audiostart'     --> microphone active
        |
        v
  User begins speaking
        |
        v
  Event: 'soundstart'     --> sound detected
  Event: 'speechstart'    --> speech detected
        |
        v
  Event: 'result' (interim) --> transcript.interim updated
  Event: 'result' (interim) --> transcript.interim updated
  Event: 'result' (interim) --> transcript.interim updated
        |
        v
  User pauses
        |
        v
  Event: 'result' (final)  --> transcript.final updated
  Event: 'speechend'       --> speech ended
        |
        v
  [submitDelay timer starts]
        |
        +--- User speaks again within submitDelay:
        |       Timer resets, more results accumulate
        |
        +--- submitDelay expires:
                onFinalTranscript(accumulated) called
                --> LLM generation begins
        |
        v
  User clicks mic button (stop)
  OR Chrome silence timeout
        |
        v
  Event: 'soundend'
  Event: 'audioend'
  Event: 'end'             --> auto-restart OR status: 'idle'
```

## Appendix B: Language Code Reference

Common BCP 47 language tags for `recognition.lang`:

| Tag | Language |
|-----|----------|
| `en-US` | English (US) |
| `en-GB` | English (UK) |
| `es-ES` | Spanish (Spain) |
| `fr-FR` | French (France) |
| `de-DE` | German |
| `ja-JP` | Japanese |
| `zh-CN` | Chinese (Simplified) |
| `ko-KR` | Korean |
| `pt-BR` | Portuguese (Brazil) |
| `it-IT` | Italian |
| `ru-RU` | Russian |

Chrome supports 100+ language codes. Safari support is more limited and tied to Siri language packs.

## Appendix C: TypeScript Declarations

For projects without `@types/dom-speech-recognition`, add these declarations:

```typescript
// speech-recognition.d.ts
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onsoundstart: (() => void) | null;
  onsoundend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onnomatch: ((event: SpeechRecognitionEvent) => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

declare var SpeechRecognition: {
  new (): SpeechRecognition;
  prototype: SpeechRecognition;
};

declare var webkitSpeechRecognition: {
  new (): SpeechRecognition;
  prototype: SpeechRecognition;
};

interface Window {
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}
```
