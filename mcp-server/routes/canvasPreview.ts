/**
 * Canvas Preview Endpoint
 *
 * Writes a JSX code string to voice-canvas.stories.tsx so the Storybook
 * iframe preview updates via Vite HMR. Used for undo/redo operations —
 * no LLM call needed, just update the story file on disk.
 *
 * POST /mcp/canvas-preview
 * Body: { jsxCode: string }
 * Returns: { storyId: string }
 */

import { Request, Response } from 'express';
import { logger } from '../../story-generator/logger.js';
import { VOICE_CANVAS_STORY_ID } from './canvasGenerate.js';

export async function canvasPreviewHandler(req: Request, res: Response) {
  // This endpoint is no longer used — undo/redo now uses postMessage + localStorage.
  // Kept for backwards compatibility; simply returns the static story ID.
  try {
    return res.json({ storyId: VOICE_CANVAS_STORY_ID });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[canvas-preview] Error', { error: message });
    return res.status(500).json({ error: message });
  }
}
