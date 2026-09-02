/**
 * Streaming Story Generation with Two-Way Communication (SSE transport)
 *
 * Thin wrapper over the shared pipeline in generationCore.ts. This file only
 * translates pipeline events into SSE messages; all generation logic lives in
 * the core so the streaming and JSON routes cannot drift.
 */

import { Request, Response } from 'express';
import {
  runStoryGeneration,
  GenerationError,
  GENERATION_TOTAL_STEPS,
} from './generationCore.js';
import { logger } from '../../story-generator/logger.js';
import {
  StreamEvent,
  IntentPreview,
  ProgressUpdate,
  ValidationFeedback,
  CompletionFeedback,
  ErrorFeedback,
  PreviewReady,
  LlmText,
  formatSSE,
  createStreamEvent,
  StreamGenerateRequest,
} from './streamTypes.js';

// Helper class to manage SSE stream
class StreamWriter {
  private res: Response;
  private startTime: number;
  private llmCalls: number = 0;
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(res: Response) {
    this.res = res;
    this.startTime = Date.now();
  }

  send(event: StreamEvent): void {
    this.res.write(formatSSE(event));
  }

  /** Tell the client which run this is, so Stop can cancel it. */
  sendStarted(generationId: string): void {
    this.send(createStreamEvent('started', { generationId }));
  }

  /** The file is on disk: the client should show it now and treat the rest as background. */
  sendPreviewReady(preview: PreviewReady): void {
    this.send(createStreamEvent('preview_ready', preview));
  }

  sendLlmText(text: LlmText): void {
    this.send(createStreamEvent('llm_text', text));
  }

  /**
   * Keep the socket warm while the pipeline is silent.
   *
   * Between "AI is generating your story" and the next phase, nothing is
   * written for the whole LLM call, and verification adds a further budget of
   * browser work plus a vision call. Any proxy with an idle timeout — and most
   * have one around 60s — drops the stream in that gap, which the client can
   * only read as a failed generation for work that in fact completed.
   *
   * A comment line is the SSE-native no-op: it keeps the connection alive and
   * is ignored by every parser, including ours.
   */
  startHeartbeat(everyMs = 15000): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      try { this.res.write(': keep-alive\n\n'); } catch { this.stopHeartbeat(); }
    }, everyMs);
    // Never hold the process open for a heartbeat.
    this.heartbeat.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  sendIntent(intent: IntentPreview): void {
    this.send(createStreamEvent('intent', intent));
  }

  sendProgress(
    step: number,
    totalSteps: number,
    phase: ProgressUpdate['phase'],
    message: string,
    details?: Record<string, unknown>
  ): void {
    this.send(createStreamEvent('progress', { step, totalSteps, phase, message, details }));
  }

  sendValidation(validation: ValidationFeedback): void {
    this.send(createStreamEvent('validation', validation));
  }

  sendRetry(attempt: number, maxAttempts: number, reason: string, errors: string[]): void {
    this.send(createStreamEvent('retry', { attempt, maxAttempts, reason, errors }));
  }

  sendCompletion(completion: Omit<CompletionFeedback, 'metrics'>): void {
    const fullCompletion: CompletionFeedback = {
      ...completion,
      metrics: {
        totalTimeMs: Date.now() - this.startTime,
        llmCallsCount: this.llmCalls,
      },
    };
    this.send(createStreamEvent('completion', fullCompletion));
  }

  sendError(error: ErrorFeedback): void {
    this.send(createStreamEvent('error', error));
  }

  trackLLMCall(): void {
    this.llmCalls++;
  }
}

// Main streaming handler
export async function generateStoryFromPromptStream(req: Request, res: Response) {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  const stream = new StreamWriter(res);
  const body = req.body as StreamGenerateRequest & { voiceMode?: boolean };

  logger.debug('[stream] generate request', {
    fileName: body.fileName,
    storyId: body.storyId,
    isUpdate: body.isUpdate,
    conversationLength: body.conversation?.length || 0,
  });

  if (!body.prompt) {
    stream.sendError({
      code: 'MISSING_PROMPT',
      message: 'No prompt provided',
      recoverable: false,
      suggestion: 'Please provide a description of what you want to generate',
    });
    res.end();
    return;
  }

  // The pipeline goes silent for the whole LLM call and again through
  // verification; without this a proxy idle timeout reads as a failure.
  stream.startHeartbeat();

  try {
    const outcome = await runStoryGeneration(
      {
        prompt: body.prompt,
        fileName: body.fileName,
        conversation: body.conversation as Array<{ role: string; content: string }> | undefined,
        isUpdate: body.isUpdate,
        originalTitle: body.originalTitle,
        storyId: body.storyId,
        framework: body.framework,
        autoDetectFramework: body.autoDetectFramework,
        images: body.images as any,
        files: body.files,
        visionMode: body.visionMode,
        designSystem: body.designSystem,
        considerations: body.considerations,
        selection: body.selection,
        provider: body.provider,
        model: body.model,
        useStorybookMcp: body.useStorybookMcp,
        storybookUrl: body.storybookUrl,
        voiceMode: body.voiceMode,
      },
      {
        onProgress: (step, totalSteps, phase, message, details) =>
          stream.sendProgress(step, totalSteps, phase as ProgressUpdate['phase'], message, details),
        onIntent: (intent) => stream.sendIntent(intent),
        onValidation: (validation) => stream.sendValidation(validation),
        onRetry: (attempt, maxAttempts, reason, errors) =>
          stream.sendRetry(attempt, maxAttempts, reason, errors),
        onStarted: (generationId) => stream.sendStarted(generationId),
        onPreviewReady: (preview) => stream.sendPreviewReady(preview),
        onLlmText: (text) => stream.sendLlmText(text),
        onLLMCall: () => stream.trackLLMCall(),
      }
    );

    stream.sendCompletion({
      success: outcome.success,
      title: outcome.title,
      fileName: outcome.fileName,
      storyId: outcome.storyId,
      summary: {
        action: outcome.isFallbackStory ? 'failed' : (outcome.isUpdate ? 'updated' : 'created'),
        description: outcome.chatSummary || (outcome.isFallbackStory
          ? `Story generation failed for: "${body.prompt.slice(0, 100)}${body.prompt.length > 100 ? '...' : ''}" - an error placeholder was created`
          : (outcome.isUpdate
            ? `Updated story based on your request: "${body.prompt.slice(0, 100)}${body.prompt.length > 100 ? '...' : ''}"`
            : `Created new story for: "${body.prompt.slice(0, 100)}${body.prompt.length > 100 ? '...' : ''}"`)),
      },
      componentsUsed: outcome.analysis.componentsUsed,
      layoutChoices: outcome.analysis.layoutChoices,
      styleChoices: outcome.analysis.styleChoices,
      suggestions: outcome.suggestions,
      notice: outcome.notice,
      pins: outcome.pins,
      edits: outcome.edits,
      chatSummary: outcome.chatSummary,
      storybookId: outcome.storybookId,
      // Browser verification — forwarded verbatim so the panel can show what was
      // actually observed, including an honest "not verified".
      verification: outcome.verification ? {
        outcome: outcome.verification.outcome,
        reason: outcome.verification.reason,
        findings: outcome.verification.findings.map(f => ({
          id: f.id, severity: f.severity, class: f.class,
          message: f.message, evidence: f.evidence, selector: f.selector,
        })),
        metrics: outcome.verification.metrics,
      } : undefined,
      // Only surface runtime results the user should act on: a pass, or a
      // genuine in-Storybook crash. Inconclusive infra results (story not
      // indexed yet, Storybook unreachable) would show a false alarm.
      runtimeValidation: outcome.runtimeValidation.enabled &&
        (outcome.runtimeValidation.success ||
          outcome.runtimeValidation.errorType === 'module_error' ||
          outcome.runtimeValidation.errorType === 'render_error') ? {
        enabled: true,
        success: outcome.runtimeValidation.success,
        error: outcome.runtimeValidation.error,
        healedByRetry: outcome.runtimeValidation.healedByRetry,
      } : undefined,
      validation: {
        isValid: !outcome.validation.hasWarnings && !outcome.isFallbackStory,
        errors: outcome.validation.errors,
        warnings: outcome.validation.warnings,
        autoFixApplied: outcome.validation.autoFixApplied,
        fixDetails: outcome.validation.fixDetails,
      },
      code: outcome.code,
    });

    stream.stopHeartbeat();
    res.end();
  } catch (err: any) {
    stream.stopHeartbeat();
    if (err instanceof GenerationError) {
      stream.sendError({
        code: err.code,
        message: err.message,
        details: err.options.details,
        recoverable: err.options.recoverable ?? false,
        suggestion: err.options.suggestion,
      });
    } else {
      stream.sendError({
        code: 'GENERATION_ERROR',
        message: err.message || 'Story generation failed',
        recoverable: false,
        suggestion: 'Please try again with a different prompt',
      });
    }
    res.end();
  }
}
