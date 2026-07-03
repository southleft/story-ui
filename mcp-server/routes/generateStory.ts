/**
 * Story Generation (JSON transport)
 *
 * Thin wrapper over the shared pipeline in generationCore.ts. This route runs
 * the exact same pipeline as the SSE route — including self-healing, runtime
 * validation, and post-processing re-validation — and returns a single JSON
 * response instead of streaming progress events.
 */

import { Request, Response } from 'express';
import { runStoryGeneration, GenerationError } from './generationCore.js';
import { logger } from '../../story-generator/logger.js';

export async function generateStoryFromPrompt(req: Request, res: Response) {
  const {
    prompt,
    fileName,
    conversation,
    isUpdate,
    originalTitle,
    storyId,
    framework,
    autoDetectFramework,
    images,
    visionMode,
    designSystem,
    considerations,
    provider,
    model,
    useStorybookMcp,
    storybookUrl,
    voiceMode,
  } = req.body;

  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const outcome = await runStoryGeneration({
      prompt,
      fileName,
      conversation,
      isUpdate,
      originalTitle,
      storyId,
      framework,
      autoDetectFramework,
      images,
      visionMode,
      designSystem,
      considerations,
      provider,
      model,
      useStorybookMcp,
      storybookUrl,
      voiceMode,
    });

    res.json({
      // IMPORTANT: success is FALSE when we had to create a fallback error story
      success: outcome.success,
      isFallback: outcome.isFallbackStory,
      fileName: outcome.fileName,
      storyId: outcome.storyId,
      outPath: outcome.outPath,
      title: outcome.title,
      story: outcome.code,
      storage: 'file-system',
      isUpdate: outcome.isUpdate,
      chatSummary: outcome.chatSummary,
      suggestions: outcome.suggestions,
      validation: {
        hasWarnings: outcome.validation.hasWarnings,
        errors: outcome.validation.errors,
        warnings: outcome.validation.warnings,
        selfHealingUsed: outcome.validation.selfHealingUsed,
        attempts: outcome.validation.attempts,
        isFallback: outcome.isFallbackStory,
      },
      runtimeValidation: {
        enabled: outcome.runtimeValidation.enabled,
        success: outcome.runtimeValidation.success,
        storyExists: outcome.runtimeValidation.storyExists,
        error: outcome.runtimeValidation.error,
        errorType: outcome.runtimeValidation.errorType,
        details: outcome.runtimeValidation.details,
        healedByRetry: outcome.runtimeValidation.healedByRetry,
      },
    });
  } catch (err: any) {
    if (err instanceof GenerationError) {
      logger.warn(`Generation failed: ${err.code} - ${err.message}`);
      return res.status(err.options.httpStatus || 500).json({
        error: err.message,
        code: err.code,
        details: err.options.details,
        suggestion: err.options.suggestion,
      });
    }
    logger.error('Story generation failed', { error: err?.message });
    res.status(500).json({ error: err.message || 'Story generation failed' });
  }
}
