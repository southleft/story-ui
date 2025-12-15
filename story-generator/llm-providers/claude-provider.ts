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
import { logger } from '../logger.js';

// Claude model definitions - Updated December 2025
// Top 4 models only - Reference: Anthropic API documentation
const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    provider: 'claude',
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.015,
    outputPricePer1kTokens: 0.075,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    provider: 'claude',
    contextWindow: 200000,
    maxOutputTokens: 16000,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.003,
    outputPricePer1kTokens: 0.015,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'claude',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.0008,
    outputPricePer1kTokens: 0.004,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'claude',
    contextWindow: 200000,
    maxOutputTokens: 16000,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.003,
    outputPricePer1kTokens: 0.015,
  },
];

// Default model - Claude Sonnet 4.5 (recommended for agents and coding)
const DEFAULT_MODEL = 'claude-opus-4-5-20251101';

// API configuration
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

interface AnthropicContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
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
    };

    // Add optional parameters
    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }
    if (options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }
    if (options?.topP !== undefined) {
      requestBody.top_p = options.topP;
    }
    if (options?.topK !== undefined) {
      requestBody.top_k = options.topK;
    }
    if (options?.stopSequences?.length) {
      requestBody.stop_sequences = options.stopSequences;
    }

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout || 120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('Claude API error response', { status: response.status, body: errorBody });
        throw new Error(`Claude API error: ${response.status} - ${errorBody}`);
      }

      const data = (await response.json()) as AnthropicResponse;
      const chatResponse = this.convertResponse(data);
      this.logResponse(chatResponse);
      return chatResponse;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`Claude API request timed out after ${this.config.timeout}ms`);
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
    };

    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }
    if (options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout || 120000),
      });

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

              if (event.type === 'content_block_delta' && event.delta?.text) {
                yield { type: 'text', content: event.delta.text };
              } else if (event.type === 'message_start' && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens || 0;
              } else if (event.type === 'message_delta' && event.usage) {
                outputTokens = event.usage.output_tokens || 0;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      yield {
        type: 'done',
        usage: {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
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
          model: 'claude-haiku-4-5-20251001', // Use latest Haiku for fast validation
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
      // Document type - convert to text representation for now
      if (item.type === 'document') {
        return {
          type: 'text' as const,
          text: `[Document: ${item.source.name || 'unnamed'}]`,
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
      },
      raw: data,
    };
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
      default:
        return 'stop';
    }
  }

  // Token estimation specific to Claude (using cl100k_base-like estimation)
  estimateTokens(text: string): number {
    // Claude uses a similar tokenization to GPT-4
    // Rough estimate: ~4 characters per token for English
    // This is a simple heuristic; actual tokenization may vary
    return Math.ceil(text.length / 4);
  }
}

// Factory function
export function createClaudeProvider(config?: Partial<ProviderConfig>): ClaudeProvider {
  return new ClaudeProvider(config);
}
