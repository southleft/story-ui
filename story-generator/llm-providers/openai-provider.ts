/**
 * OpenAI LLM Provider
 *
 * Implementation of the LLM provider interface for OpenAI's GPT models.
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

// OpenAI model definitions - Updated July 2026
// Reference: https://developers.openai.com/api/docs/models
export const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'openai',
    contextWindow: 1047576,
    maxOutputTokens: 32768,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.005,
    outputPricePer1kTokens: 0.03,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    contextWindow: 1047576,
    maxOutputTokens: 32768,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.0004,
    outputPricePer1kTokens: 0.0016,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    provider: 'openai',
    contextWindow: 1047576,
    maxOutputTokens: 32768,
    supportsVision: true,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.0001,
    outputPricePer1kTokens: 0.0004,
  },
];

// Older model IDs consumers may still have configured; kept working via passthrough.
export const OPENAI_LEGACY_MODEL_ALIASES: Record<string, string> = {
  'gpt-5.4': 'gpt-5.5',
  'o4-mini': 'gpt-5.4-mini',
};

// Default model - GPT-5.5 (flagship, 1M context window, July 2026)
const DEFAULT_MODEL = 'gpt-5.5';

// API configuration
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// o-series reasoning models reject temperature/top_p outright; gpt-5.x models
// on chat.completions accept only the default temperature. Suppress both to
// avoid 400s — output style is steered via prompting instead.
function acceptsSamplingParams(model?: string): boolean {
  if (!model) return true;
  return !/^o\d/.test(model) && !/^gpt-5/.test(model);
}

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContent[];
}

interface OpenAIContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
    };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'OpenAI';
  readonly type: ProviderType = 'openai';
  readonly supportedModels = OPENAI_MODELS;

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
      throw new Error('OpenAI API key not configured');
    }

    const model = options?.model || this.config.model;
    const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

    // Determine which token parameter to use based on model
    // o-series models (o1, o3, o4-mini, etc.) require max_completion_tokens instead of max_tokens
    const maxTokens = options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 4096;
    const useMaxCompletionTokens = /^o\d/.test(model) || /^gpt-5/.test(model);

    const requestBody: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      ...(useMaxCompletionTokens
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
    };

    // Add optional parameters
    // Reasoning models (o-series) and gpt-5.x reject non-default sampling params.
    if (acceptsSamplingParams(model)) {
      if (options?.temperature !== undefined) {
        requestBody.temperature = options.temperature;
      }
      if (options?.topP !== undefined) {
        requestBody.top_p = options.topP;
      }
    }
    if (options?.stopSequences?.length) {
      requestBody.stop = options.stopSequences;
    }

    // One wall-clock budget for the whole call, retries included; on timeout
    // the error reports MEASURED elapsed, never just the configured number.
    const timeoutMs = this.config.timeout || 120000;
    const requestStartedAt = Date.now();
    try {
      const response = await fetchWithRetry(this.config.baseUrl || OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(this.config.organizationId && { 'OpenAI-Organization': this.config.organizationId }),
        },
        body: JSON.stringify(requestBody),
      }, { timeoutMs, signal: options?.signal });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('OpenAI API error response', { status: response.status, body: errorBody });
        throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
      }

      const data = (await response.json()) as OpenAIResponse;
      const chatResponse = this.convertResponse(data);
      this.logResponse(chatResponse);
      return chatResponse;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        const elapsedMs = Date.now() - requestStartedAt;
        throw new Error(
          `OpenAI API request timed out after ${elapsedMs}ms of wall time (configured timeout ${timeoutMs}ms)`,
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
      yield { type: 'error', error: 'OpenAI API key not configured' };
      return;
    }

    const model = options?.model || this.config.model;
    const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

    // Determine which token parameter to use based on model
    // o-series models (o1, o3, o4-mini, etc.) require max_completion_tokens instead of max_tokens
    const maxTokens = options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 4096;
    const useMaxCompletionTokens = /^o\d/.test(model) || /^gpt-5/.test(model);

    const requestBody: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      ...(useMaxCompletionTokens
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
      stream: true,
      // Ask OpenAI to include a final usage chunk so token accounting works.
      stream_options: { include_usage: true },
    };

    if (acceptsSamplingParams(model) && options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    try {
      const response = await fetchWithRetry(this.config.baseUrl || OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(this.config.organizationId && { 'OpenAI-Organization': this.config.organizationId }),
        },
        body: JSON.stringify(requestBody),
      }, { timeoutMs: this.config.timeout || 120000, signal: options?.signal });

      if (!response.ok) {
        const errorBody = await response.text();
        yield { type: 'error', error: `OpenAI API error: ${response.status} - ${errorBody}` };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: 'error', error: 'No response body' };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let promptTokens = 0;
      let completionTokens = 0;
      // null until the API sends one, so a cut stream reports "unknown".
      let finishReason: string | null = null;
      let servedModel: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              if (event.choices?.[0]?.delta?.content) {
                yield { type: 'text', content: event.choices[0].delta.content };
              }

              // finish_reason is null on every chunk but the last content one;
              // the usage-only chunk after it has an empty choices array.
              if (event.choices?.[0]?.finish_reason) {
                finishReason = event.choices[0].finish_reason;
              }
              if (typeof event.model === 'string') servedModel = event.model;

              // Usage may be included in the final message
              if (event.usage) {
                promptTokens = event.usage.prompt_tokens || 0;
                completionTokens = event.usage.completion_tokens || 0;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      yield {
        type: 'done',
        finishReason: finishReason === null ? undefined : this.mapFinishReason(finishReason),
        model: servedModel,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
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
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-5.4-mini',
          max_completion_tokens: 1,
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

  // Convert our message format to OpenAI format
  private convertMessages(
    messages: ChatMessage[],
    systemPrompt?: string
  ): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    // Convert remaining messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        // Add system messages directly
        result.push({
          role: 'system',
          content: typeof msg.content === 'string' ? msg.content : this.extractTextContent(msg.content),
        });
      } else {
        result.push({
          role: msg.role as 'user' | 'assistant',
          content: this.convertContent(msg.content),
        });
      }
    }

    return result;
  }

  private extractTextContent(content: MessageContent[]): string {
    return content
      .filter(item => item.type === 'text')
      .map(item => (item as { type: 'text'; text: string }).text)
      .join('\n');
  }

  private convertContent(content: string | MessageContent[]): string | OpenAIContent[] {
    if (typeof content === 'string') {
      return content;
    }

    return content.map(item => {
      if (item.type === 'text') {
        return { type: 'text' as const, text: item.text };
      }
      if (item.type === 'image') {
        const imageContent = item as ImageContent;
        // OpenAI expects either a URL or a base64 data URL
        const imageUrl = imageContent.source.url ||
          `data:${imageContent.source.mediaType || 'image/png'};base64,${imageContent.source.data}`;
        return {
          type: 'image_url' as const,
          image_url: {
            url: imageUrl,
            detail: 'auto' as const,
          },
        };
      }
      // Document type - convert to text representation
      if (item.type === 'document') {
        return {
          type: 'text' as const,
          text: `[Document: ${item.source.name || 'unnamed'}]`,
        };
      }
      return { type: 'text' as const, text: '' };
    });
  }

  private convertResponse(data: OpenAIResponse): ChatResponse {
    const choice = data.choices[0];
    const content = choice?.message?.content || '';

    return {
      id: data.id,
      model: data.model,
      content,
      finishReason: this.mapFinishReason(choice?.finish_reason),
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      raw: data,
    };
  }

  private mapFinishReason(
    finishReason: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (finishReason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
      case 'function_call':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

}

