/**
 * Dictation via the Web Speech API — the hook and only the types it needs.
 *
 * Copied from templates/StoryUI/voice rather than imported: only StoryUIV2 is
 * compiled into the package's dist/templates/StoryUIV2 export, so V2 must not
 * reach across template trees. Deliberately dictation only — Voice Canvas
 * (commands, undo/redo grammar) stays a V1 feature.
 *
 * The Window global is read through a cast instead of a `declare global`
 * augmentation: V1's voice/types.ts already augments Window in the same
 * compilation, and a second augmentation with types from a different module
 * would collide.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface VoiceError {
  type:
    | 'not-allowed'
    | 'no-speech'
    | 'network'
    | 'audio-capture'
    | 'aborted'
    | 'service-not-allowed'
    | 'language-not-supported'
    | 'not-supported';
  message: string;
}

export interface UseVoiceInputOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onFinalTranscript?: (transcript: string) => void;
  onInterimTranscript?: (transcript: string) => void;
  onError?: (error: VoiceError) => void;
}

export interface UseVoiceInputReturn {
  isListening: boolean;
  isSupported: boolean;
  interimTranscript: string;
  finalTranscript: string;
  confidence: number;
  error: VoiceError | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

const SpeechRecognitionCtor: SpeechRecognitionConstructor | null =
  typeof window !== 'undefined'
    ? ((((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) as
        | SpeechRecognitionConstructor
        | undefined) ?? null)
    : null;

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const {
    lang = 'en-US',
    continuous = true,
    interimResults = true,
    onFinalTranscript,
    onInterimTranscript,
    onError,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState<VoiceError | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store callbacks in refs to avoid stale closures
  const onFinalRef = useRef(onFinalTranscript);
  const onInterimRef = useRef(onInterimTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => { onFinalRef.current = onFinalTranscript; }, [onFinalTranscript]);
  useEffect(() => { onInterimRef.current = onInterimTranscript; }, [onInterimTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const isSupported = !!SpeechRecognitionCtor;

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        isListeningRef.current = false;
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
    };
  }, []);

  const createRecognition = useCallback((): SpeechRecognitionInstance | null => {
    if (!SpeechRecognitionCtor) return null;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          final += transcript;
          setConfidence(result[0].confidence);
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
        onInterimRef.current?.(interim);
      }

      if (final) {
        setFinalTranscript(final);
        setInterimTranscript('');
        onFinalRef.current?.(final);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const voiceError: VoiceError = {
        type: event.error as VoiceError['type'],
        message: event.message || getErrorMessage(event.error),
      };

      // Transient errors — don't stop listening
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      setError(voiceError);
      onErrorRef.current?.(voiceError);

      // Fatal errors — stop listening
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        isListeningRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart if we're still supposed to be listening
      // Chrome stops after ~60s of silence in continuous mode
      if (isListeningRef.current) {
        restartTimeoutRef.current = setTimeout(() => {
          if (isListeningRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {
              // Already started — ignore
            }
          }
        }, 100);
      } else {
        setIsListening(false);
      }
    };

    return recognition;
  }, [lang, continuous, interimResults]);

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor) {
      setError({ type: 'not-supported', message: 'Speech recognition is not supported in this browser' });
      return;
    }

    // Clean up any existing instance
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    setError(null);
    setInterimTranscript('');

    const recognition = createRecognition();
    if (!recognition) return;

    recognitionRef.current = recognition;
    isListeningRef.current = true;
    setIsListening(true);

    try {
      recognition.start();
    } catch {
      // InvalidStateError — already started
    }
  }, [createRecognition]);

  const stop = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    setInterimTranscript('');

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    if (isListeningRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  return {
    isListening,
    isSupported,
    interimTranscript,
    finalTranscript,
    confidence,
    error,
    start,
    stop,
    toggle,
  };
}

function getErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'not-allowed':
      return 'Microphone access denied. Please allow microphone permissions.';
    case 'no-speech':
      return 'No speech detected.';
    case 'network':
      return 'Network error during speech recognition.';
    case 'audio-capture':
      return 'No microphone found or microphone is not working.';
    case 'service-not-allowed':
      return 'Speech recognition service is not allowed.';
    case 'language-not-supported':
      return 'The selected language is not supported.';
    case 'aborted':
      return 'Speech recognition was aborted.';
    default:
      return `Speech recognition error: ${errorCode}`;
  }
}
