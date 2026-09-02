/**
 * Claude LLM Provider
 *
 * Implementation of the LLM provider interface for Anthropic's Claude models.
 */

import {
  ProviderType,
  ProviderConfig,
  ModelInfo,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ValidationResult,
  MessageContent,
  ImageContent,
} from './types.js';
import { BaseLLMProvider } from './base-provider.js';
import { fetchWithRetry } from './http-utils.js';
import { logger } from '../logger.js';

// Claude model definitions - Updated 1 Sept 2026 from the Claude API reference
// (models table cached 2026-06-24). Pricing is per 1k tokens. Output ceilings are
// what the pipeline streams to; the models allow up to 128k with streaming.
export const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    provider: 'claude',
    contextWindow: 1000000,
    maxOutputTokens: 32000,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.005,
    outputPricePer1kTokens: 0.025,
  },
  {
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    provider: 'claude',
    contextWindow: 1000000,
    maxOutputTokens: 32000,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.01,
    outputPricePer1kTokens: 0.05,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'claude',
    contextWindow: 1000000,
    maxOutputTokens: 32000,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.002,
    outputPricePer1kTokens: 0.01,
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'claude',
    contextWindow: 1000000,
    maxOutputTokens: 32000,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.005,
    outputPricePer1kTokens: 0.025,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'claude',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.001,
    outputPricePer1kTokens: 0.005,
  },
];

/** The cheap model for trivial calls (titles, chat summaries). */
export const CLAUDE_SMALL_MODEL = 'claude-haiku-4-5';

// Older model IDs consumers may still have in .env / saved settings.
// They remain active upstream, so requests pass through unchanged; this map
// only keeps display/selection working after an update.
export const CLAUDE_LEGACY_MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4-6': 'claude-opus-4-8',
  'claude-opus-4-7': 'claude-opus-4-8',
  'claude-opus-4-5-20251101': 'claude-opus-5',
  'claude-opus-4-5': 'claude-opus-5',
  'claude-sonnet-4-6': 'claude-sonnet-5',
  'claude-sonnet-4-5-20250514': 'claude-sonnet-5',
  'claude-sonnet-4-5': 'claude-sonnet-5',
  'claude-sonnet-4-20250514': 'claude-sonnet-5',
  'claude-3-7-sonnet-20250219': 'claude-sonnet-5',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
};

// Default model. Accuracy over cost: the user's stated priority is that the
// composition uses the right components, variants and states.
const DEFAULT_MODEL = 'claude-opus-5';

// API configuration
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Sonnet 5, Opus 4.7/4.8, and Fable/Mythos reject temperature/top_p/top_k with a 400.
function supportsSamplingParams(model?: string): boolean {
  if (!model) return true;
  return !/^claude-(sonnet-5|opus-5|opus-4-[78]|fable|mythos)/.test(model);
}

/**
 * Adaptive thinking and effort levels: every current model (4.6 and later).
 * `budget_tokens` is rejected on these; `{ type: 'adaptive' }` is the only
 * on-mode, and Fable/Opus 5 run it whether or not it is sent.
 */
function supportsAdaptiveThinking(model?: string): boolean {
  if (!model) return false;
  return /^claude-(sonnet-5|sonnet-4-6|opus-5|opus-4-[678]|fable|mythos)/.test(model);
}

/** Effort levels the current models accept. */
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Thinking + effort for a request. Effort comes from the call, then
 * CLAUDE_EFFORT, then 'high'. Haiku 4.5 and older take neither.
 */
function reasoningParams(model: string, options?: ChatOptions, streaming = false): Record<string, unknown> {
  if (!supportsAdaptiveThinking(model)) return {};
  const requested = (options?.effort || process.env.CLAUDE_EFFORT || 'high').toLowerCase();
  const effort = EFFORT_LEVELS.has(requested) ? requested : 'high';
  return {
    // Streaming asks for the summarised reasoning so the wait before the
    // first token can be narrated; buffered calls have nobody to narrate to.
    thinking: streaming ? { type: 'adaptive', display: 'summarized' } : { type: 'adaptive' },
    output_config: { effort },
  };
}

/** Absolute ceiling on one streamed call, silence or not. */
const STREAM_HARD_CAP_MS = Number(process.env.CLAUDE_STREAM_MAX_MS) || 15 * 60 * 1000;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

interface AnthropicContent {
  type: 'text' | 'image' | 'document';
  text?: string;
  source?: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
  /** Document blocks only: the filename, shown to the model. */
  title?: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** The block form of the `system` parameter, which is what carries a cache breakpoint. */
interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
}

export class ClaudeProvider extends BaseLLMProvider {
  readonly name = 'Claude';
  readonly type: ProviderType = 'claude';
  readonly supportedModels = CLAUDE_MODELS;

  constructor(config?: Partial<ProviderConfig>) {
    super(config);
    // Set the provider type after base constructor
    this.setProviderType();
    // Set default model if not provided
    if (!this.config.model) {
      this.config.model = DEFAULT_MODEL;
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this.validateMessages(messages);
    this.logRequest(messages, options);

    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error('Claude API key not configured');
    }

    const model = options?.model || this.config.model;
    const anthropicMessages = this.convertMessages(messages);
    const systemPrompt = this.buildSystemPrompt(options);

    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 4096,
      messages: anthropicMessages,
      ...reasoningParams(model, options),
    };

    // Add optional parameters
    if (systemPrompt) {
      requestBody.system = this.buildSystemParam(systemPrompt, options);
    }
    // Claude Sonnet 5 / Opus 4.7+ / Fable reject sampling parameters with a 400.
    if (supportsSamplingParams(model)) {
      if (options?.temperature !== undefined) {
        requestBody.temperature = options.temperature;
      }
      if (options?.topP !== undefined) {
        requestBody.top_p = options.topP;
      }
      if (options?.topK !== undefined) {
        requestBody.top_k = options.topK;
      }
    }
    if (options?.stopSequences?.length) {
      requestBody.stop_sequences = options.stopSequences;
    }

    // One wall-clock budget for the whole call, retries included, enforced by
    // fetchWithRetry against Date.now(). The old per-call AbortSignal.timeout
    // was a fire-once timer whose error message reported the CONFIGURED number
    // — a "timed out after 120000ms" was once logged for a call that had
    // actually held the pipeline for 17 minutes.
    const timeoutMs = this.config.timeout || 120000;
    const requestStartedAt = Date.now();
    try {
      const response = await fetchWithRetry(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(requestBody),
      }, { timeoutMs, signal: options?.signal });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('Claude API error response', { status: response.status, body: errorBody });
        throw new Error(`Claude API error: ${response.status} - ${errorBody}`);
      }

      const data = (await response.json()) as AnthropicResponse;
      this.logCacheUsage(data.usage, 'chat');
      const chatResponse = this.convertResponse(data);
      this.logResponse(chatResponse);
      return chatResponse;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        // Measured elapsed, not the configured number — so the log can never
        // again claim 120s for a call that took 17 minutes.
        const elapsedMs = Date.now() - requestStartedAt;
        throw new Error(
          `Claude API request timed out after ${elapsedMs}ms of wall time (configured timeout ${timeoutMs}ms)`,
        );
      }
      throw error;
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<StreamChunk> {
    this.validateMessages(messages);
    this.logRequest(messages, options);

    const apiKey = this.config.apiKey;
    if (!apiKey) {
      yield { type: 'error', error: 'Claude API key not configured' };
      return;
    }

    const model = options?.model || this.config.model;
    const anthropicMessages = this.convertMessages(messages);
    const systemPrompt = this.buildSystemPrompt(options);

    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 4096,
      messages: anthropicMessages,
      stream: true,
      ...reasoningParams(model, options, /* streaming */ true),
    };

    // Idle watchdog: reset on every chunk, aborts the fetch after `timeout`
    // ms of silence. Composed with the caller's own signal.
    const idleMs = this.config.timeout || 120000;
    const idleController = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idleController.abort(new Error(`no bytes from Claude for ${idleMs}ms`)), idleMs);
      idleTimer.unref?.();
    };
    bump();
    const idle = {
      signal: options?.signal ? AbortSignal.any([idleController.signal, options.signal]) : idleController.signal,
      stop: () => { if (idleTimer) clearTimeout(idleTimer); },
    };

    if (systemPrompt) {
      requestBody.system = this.buildSystemParam(systemPrompt, options);
    }
    if (supportsSamplingParams(model) && options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    try {
      const response = await fetchWithRetry(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(requestBody),
      /**
       * A stream is bounded by SILENCE, not by wall clock. Opus 5 thinks for
       * 30–60s before its first token and writes an 8k-token story over two
       * minutes; a 120s total budget cut a healthy call mid-stream (observed:
       * "The operation was aborted due to timeout" at 120.9s on a support
       * inbox). The configured timeout now means "no bytes for this long",
       * with a separate hard cap so a wedged connection still ends.
       */
      }, { timeoutMs: STREAM_HARD_CAP_MS, signal: idle.signal });

      if (!response.ok) {
        const errorBody = await response.text();
        yield { type: 'error', error: `Claude API error: ${response.status} - ${errorBody}` };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: 'error', error: 'No response body' };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens: number | undefined;
      let cacheCreationTokens: number | undefined;
      // Undefined until the API says so. A stream that dies before its
      // message_delta must report "unknown", never "stopped cleanly".
      let stopReason: string | undefined;
      let servedModel: string | undefined;
      let streamError: string | undefined;

      try { while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bump();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              if (event.type === 'content_block_delta' && event.delta?.text) {
                yield { type: 'text', content: event.delta.text };
              } else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
                // The summarised reasoning, when display: 'summarized' was
                // requested. Narration for the user, never part of the answer.
                if (event.delta.thinking) yield { type: 'thinking', content: event.delta.thinking };
              } else if (event.type === 'message_start' && event.message) {
                // message_start carries the served model and the INPUT side
                // of usage, including the prompt-cache counters.
                if (typeof event.message.model === 'string') servedModel = event.message.model;
                const usage = event.message.usage;
                if (usage) {
                  inputTokens = usage.input_tokens || 0;
                  cacheReadTokens = usage.cache_read_input_tokens;
                  cacheCreationTokens = usage.cache_creation_input_tokens;
                }
              } else if (event.type === 'message_delta') {
                // stop_reason rides on message_delta's delta, beside the
                // cumulative output usage. This is the one event that says
                // WHY the model stopped; the old parser read only the count.
                if (typeof event.delta?.stop_reason === 'string') {
                  stopReason = event.delta.stop_reason;
                }
                if (event.usage) {
                  outputTokens = event.usage.output_tokens || 0;
                }
              } else if (event.type === 'error') {
                // Anthropic reports a mid-stream failure (overloaded, etc.) as
                // an SSE event on a 200 response, not as an HTTP status.
                streamError = event.error?.message || event.error?.type || 'Claude stream error';
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      if (streamError) {
        yield { type: 'error', error: `Claude API stream error: ${streamError}` };
        return;
      } } finally { idle.stop(); }

      this.logCacheUsage({
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheReadTokens,
        cache_creation_input_tokens: cacheCreationTokens,
      }, 'stream');

      yield {
        type: 'done',
        finishReason: stopReason === undefined ? undefined : this.mapStopReason(stopReason),
        model: servedModel,
        usage: {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
          ...(cacheReadTokens !== undefined && { cacheReadInputTokens: cacheReadTokens }),
          ...(cacheCreationTokens !== undefined && { cacheCreationInputTokens: cacheCreationTokens }),
        },
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async validateApiKey(apiKey: string): Promise<ValidationResult> {
    try {
      // Make a minimal API call to validate the key
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5', // Use latest Haiku for fast validation
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return {
          valid: true,
          models: this.supportedModels,
        };
      }

      const errorBody = await response.text();

      // Check for specific error types
      if (response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key',
        };
      }

      return {
        valid: false,
        error: `API validation failed: ${errorBody}`,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      };
    }
  }

  // Convert our message format to Anthropic format
  private convertMessages(messages: ChatMessage[]): AnthropicMessage[] {
    return messages
      .filter(msg => msg.role !== 'system') // System messages handled separately
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: this.convertContent(msg.content),
      }));
  }

  private convertContent(content: string | MessageContent[]): string | AnthropicContent[] {
    if (typeof content === 'string') {
      return content;
    }

    return content.map(item => {
      if (item.type === 'text') {
        return { type: 'text' as const, text: item.text };
      }
      if (item.type === 'image') {
        const imageContent = item as ImageContent;
        return {
          type: 'image' as const,
          source: {
            type: imageContent.source.type,
            media_type: imageContent.source.mediaType,
            data: imageContent.source.data,
            url: imageContent.source.url,
          },
        };
      }
      // A PDF goes as a native document block; the model reads its pages
      // (text and layout) directly. Placeholder text here used to hide the
      // whole file from the model while the log said it was attached.
      if (item.type === 'document') {
        return {
          type: 'document' as const,
          source: item.source.type === 'url'
            ? { type: 'url' as const, url: item.source.url }
            : { type: 'base64' as const, media_type: item.source.mediaType || 'application/pdf', data: item.source.data },
          ...(item.source.name ? { title: item.source.name.slice(0, 200) } : {}),
        };
      }
      return { type: 'text' as const, text: '' };
    });
  }

  private convertResponse(data: AnthropicResponse): ChatResponse {
    const textContent = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('');

    return {
      id: data.id,
      model: data.model,
      content: textContent,
      finishReason: this.mapStopReason(data.stop_reason),
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        ...(data.usage.cache_read_input_tokens !== undefined && {
          cacheReadInputTokens: data.usage.cache_read_input_tokens,
        }),
        ...(data.usage.cache_creation_input_tokens !== undefined && {
          cacheCreationInputTokens: data.usage.cache_creation_input_tokens,
        }),
      },
      raw: data,
    };
  }

  /**
   * The system prompt in the API's block form, with a cache breakpoint on the
   * last block.
   *
   * Prompt caching is a prefix match over tools → system → messages, so a
   * breakpoint on the final system block caches everything up to it. The
   * default ephemeral TTL is 5 minutes and every cache read refreshes the
   * timer, which suits a generate → verify → repair loop whose calls are
   * seconds apart. Below the model's minimum cacheable prefix (1024 tokens on
   * Sonnet 5 / Opus 4.8, 4096 on Haiku 4.5, 512 on Opus 5) the marker is
   * harmless: the API returns cache_creation_input_tokens: 0 and bills as
   * usual. That silence is why both call paths log the counters — a prompt
   * that never caches should be visible in the log, not assumed to work.
   */
  private buildSystemParam(
    systemPrompt: string,
    options?: ChatOptions,
  ): string | AnthropicSystemBlock[] {
    if (options?.cacheSystemPrompt === false) return systemPrompt;
    return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  }

  /** Make the cache's effect observable. Absent counters are logged as absent, not as 0. */
  private logCacheUsage(usage: Partial<AnthropicUsage> | undefined, mode: 'chat' | 'stream'): void {
    if (!usage) return;
    const read = usage.cache_read_input_tokens;
    const created = usage.cache_creation_input_tokens;
    if (read === undefined && created === undefined) {
      logger.debug(`Claude prompt cache (${mode}): no cache counters in usage`, {
        inputTokens: usage.input_tokens ?? 0,
      });
      return;
    }
    logger.debug(`Claude prompt cache (${mode})`, {
      cacheReadInputTokens: read ?? 0,
      cacheCreationInputTokens: created ?? 0,
      uncachedInputTokens: usage.input_tokens ?? 0,
    });
  }

  private mapStopReason(
    stopReason: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      case 'refusal':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

}

