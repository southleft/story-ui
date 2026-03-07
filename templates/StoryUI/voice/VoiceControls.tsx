import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useVoiceInput } from './useVoiceInput.js';
import { parseVoiceCommand } from './voiceCommands.js';
import type { VoiceCommand } from './types.js';

interface VoiceControlsProps {
  onTranscript: (text: string) => void;
  onCommand: (command: VoiceCommand) => void;
  onSubmit: () => void;
  onListeningChange?: (isListening: boolean) => void;
  disabled?: boolean;
  autoSubmitDelay?: number;
}

export function VoiceControls({
  onTranscript,
  onCommand,
  onSubmit,
  onListeningChange,
  disabled = false,
  autoSubmitDelay = 2500,
}: VoiceControlsProps) {
  const autoSubmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState(false);
  const hasAcceptedPrivacy = useRef(
    typeof window !== 'undefined' && localStorage.getItem('story-ui-voice-privacy') === 'accepted'
  );
  const stopRef = useRef<() => void>(() => {});

  const clearAutoSubmit = useCallback(() => {
    if (autoSubmitRef.current) {
      clearTimeout(autoSubmitRef.current);
      autoSubmitRef.current = null;
    }
  }, []);

  const handleFinalTranscript = useCallback((transcript: string) => {
    // Check for voice commands first
    const command = parseVoiceCommand(transcript);
    if (command) {
      clearAutoSubmit();
      if (command.type === 'stop') {
        // Handle stop internally — stop listening
        stopRef.current();
      }
      onCommand(command);
      return;
    }

    // It's a description — send to textarea
    onTranscript(transcript);

    // Schedule auto-submit after pause in speech
    clearAutoSubmit();
    autoSubmitRef.current = setTimeout(() => {
      onSubmit();
    }, autoSubmitDelay);
  }, [onTranscript, onCommand, onSubmit, autoSubmitDelay, clearAutoSubmit]);

  const handleInterimTranscript = useCallback(() => {
    // User is still speaking — cancel any pending auto-submit
    clearAutoSubmit();
  }, [clearAutoSubmit]);

  const {
    isListening,
    isSupported,
    interimTranscript,
    error,
    toggle,
    stop,
  } = useVoiceInput({
    onFinalTranscript: handleFinalTranscript,
    onInterimTranscript: handleInterimTranscript,
  });

  // Keep stopRef current
  stopRef.current = stop;

  // Clean up auto-submit on unmount
  useEffect(() => {
    return () => clearAutoSubmit();
  }, [clearAutoSubmit]);

  // Notify parent of listening state changes
  useEffect(() => {
    onListeningChange?.(isListening);
  }, [isListening, onListeningChange]);

  const handleToggle = useCallback(() => {
    if (!isListening && !hasAcceptedPrivacy.current) {
      setShowPrivacyNotice(true);
      return;
    }
    toggle();
  }, [isListening, toggle]);

  const handleAcceptPrivacy = useCallback(() => {
    hasAcceptedPrivacy.current = true;
    localStorage.setItem('story-ui-voice-privacy', 'accepted');
    setShowPrivacyNotice(false);
    toggle();
  }, [toggle]);

  const handleDismissPrivacy = useCallback(() => {
    setShowPrivacyNotice(false);
  }, []);

  if (!isSupported) return null;

  return (
    <div className="sui-voice-wrap">
      <button
        type="button"
        className={`sui-voice-toggle ${isListening ? 'sui-voice-toggle--active' : ''}`}
        onClick={handleToggle}
        disabled={disabled}
        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
        title={isListening ? 'Stop voice input' : 'Start voice input'}
      >
        {isListening ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        )}
        {isListening && <span className="sui-voice-pulse" />}
      </button>

      {isListening && (interimTranscript || error) && (
        <div className="sui-voice-status">
          {error ? (
            <span className="sui-voice-status-error">{error.message}</span>
          ) : interimTranscript ? (
            <span className="sui-voice-status-interim">{interimTranscript}</span>
          ) : (
            <span className="sui-voice-status-listening">Listening...</span>
          )}
        </div>
      )}

      {showPrivacyNotice && (
        <div className="sui-voice-privacy-overlay">
          <div className="sui-voice-privacy-dialog">
            <p className="sui-voice-privacy-title">Voice Input</p>
            <p className="sui-voice-privacy-text">
              Voice input uses your browser's speech recognition service.
              Audio may be sent to cloud servers (e.g., Google for Chrome) for processing.
              No audio is stored by Story UI.
            </p>
            <div className="sui-voice-privacy-actions">
              <button className="sui-voice-privacy-cancel" onClick={handleDismissPrivacy}>Cancel</button>
              <button className="sui-voice-privacy-accept" onClick={handleAcceptPrivacy}>Enable Voice</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
