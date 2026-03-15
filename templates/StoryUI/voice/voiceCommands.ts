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

  // Save — short exact phrases
  'save': 'save',
  'save this': 'save',
  'save it': 'save',
  'save story': 'save',
  'save the story': 'save',
  'looks good': 'save',
  'that looks good': 'save',
  'this looks good': 'save',
  'this is good': 'save',
  'all good': 'save',
  'all done': 'save',
  'go ahead and save': 'save',
  'save and stop': 'save',
};

// Save-intent phrases detected anywhere in a longer utterance.
// Lets natural speech like "this is good, save it, stop listening" trigger a
// save without the user needing to say an exact short phrase.
const SAVE_INTENT_PHRASES = [
  'save it',
  'save this',
  'save the story',
  'go ahead and save',
  'save and stop',
];

/**
 * Checks if a transcript matches a known voice command.
 * Returns the command if matched, null otherwise.
 *
 * Short utterances (≤4 words) use exact matching against COMMAND_MAP.
 * Any-length utterances are also checked for save-intent substrings so natural
 * phrases like "this is good, save it, stop listening" still trigger a save.
 */
export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const normalized = transcript.trim().toLowerCase().replace(/[.,!?]/g, '');

  // Short exact-match commands (1-4 words)
  if (normalized.split(/\s+/).length <= 4) {
    const commandType = COMMAND_MAP[normalized];
    if (commandType) {
      return { type: commandType, raw: transcript };
    }
  }

  // Save-intent phrases can appear anywhere in a longer utterance
  for (const phrase of SAVE_INTENT_PHRASES) {
    if (normalized.includes(phrase)) {
      return { type: 'save', raw: transcript };
    }
  }

  return null;
}
