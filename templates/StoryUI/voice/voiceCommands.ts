import type { VoiceCommand, VoiceCommandType } from './types.js';

// Client-side voice commands that are intercepted before reaching the LLM
const COMMAND_MAP: Record<string, VoiceCommandType> = {
  // Undo/Redo
  'undo': 'undo',
  'undo that': 'undo',
  'go back': 'undo',
  'revert': 'undo',
  'redo': 'redo',

  // Clear/Reset
  'clear': 'clear',
  'clear everything': 'clear',
  'start over': 'clear',
  'reset': 'clear',
  'new chat': 'new-chat',
  'new conversation': 'new-chat',

  // Stop listening
  'stop listening': 'stop',
  'stop': 'stop',
  'turn off': 'stop',
  'mic off': 'stop',
  'microphone off': 'stop',

  // Submit / Generate
  'submit': 'submit',
  'send': 'submit',
  'generate': 'submit',
  'done': 'submit',
  'go': 'submit',
  'send it': 'submit',
  'generate that': 'submit',
};

/**
 * Checks if a transcript matches a known voice command.
 * Returns the command if matched, null otherwise.
 * Only matches short, exact phrases — longer utterances are descriptions.
 */
export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const normalized = transcript.trim().toLowerCase().replace(/[.,!?]/g, '');

  // Only check short utterances (commands are 1-3 words)
  if (normalized.split(/\s+/).length > 4) return null;

  const commandType = COMMAND_MAP[normalized];
  if (commandType) {
    return { type: commandType, raw: transcript };
  }

  return null;
}
