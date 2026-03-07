import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  UseVoiceInputOptions,
  UseVoiceInputReturn,
  VoiceError,
  SpeechRecognitionInstance,
  SpeechRecognitionConstructor,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
} from './types.js';

const SpeechRecognitionCtor: SpeechRecognitionConstructor | null =
  typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition) ?? null
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
