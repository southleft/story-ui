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
import { logger } from '../logger.js';

// OpenAI model definitions - Updated November 2025
// Reference: https://openai.com/index/introducing-gpt-5/
const OPENAI_MODELS: ModelInfo[] = [
  // GPT-5.1 Series - Latest (November 2025)
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    provider: 'openai',
    contextWindow: 256000,
    maxOutputTokens: 32768,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true, // Adaptive reasoning with reasoning_effort parameter
    inputPricePer1kTokens: 0.005,
    outputPricePer1kTokens: 0.015,
    description: 'Latest GPT-5 series. 76.3% on SWE-bench. Adaptive reasoning capability.',
  },
  {
    id: 'gpt-5.1-chat-latest',
    name: 'GPT-5.1 Instant',
    provider: 'openai',
    contextWindow: 256000,
    maxOutputTokens: 32768,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true,
    inputPricePer1kTokens: 0.003,
    outputPricePer1kTokens: 0.012,
    description: 'More conversational GPT-5.1 with improved instruction following.',
  },
  {
    id: 'gpt-5.1-thinking',
    name: 'GPT-5.1 Thinking',
    provider: 'openai',
    contextWindow: 256000,
    maxOutputTokens: 65536,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true,
    inputPricePer1kTokens: 0.008,
    outputPricePer1kTokens: 0.024,
    description: 'Extended thinking mode for complex reasoning tasks.',
  },
  // GPT-5 Original (August 2025)
  {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    contextWindow: 200000,
    maxOutputTokens: 32768,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true,
    inputPricePer1kTokens: 0.005,
    outputPricePer1kTokens: 0.015,
    description: 'Multimodal foundation model combining reasoning and general capabilities.',
  },
  // GPT-4o Series
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.0025,
    outputPricePer1kTokens: 0.01,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.00015,
    outputPricePer1kTokens: 0.0006,
  },
  // o1 Reasoning Series
  {
    id: 'o1',
    name: 'o1 (Reasoning)',
    provider: 'openai',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsVision: true,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.015,
    outputPricePer1kTokens: 0.06,
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini (Reasoning)',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 65536,
    supportsVision: false,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.003,
    outputPricePer1kTokens: 0.012,
  },
  // Legacy GPT-4 Series
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.01,
    outputPricePer1kTokens: 0.03,
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo (Legacy)',
    provider: 'openai',
    contextWindow: 16385,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsDocuments: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.0005,
    outputPricePer1kTokens: 0.0015,
  },
];

// Default model
const DEFAULT_MODEL = 'gpt-4o';

// API configuration
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

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

    const requestBody: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      max_tokens: options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 4096,
    };

    // Add optional parameters
    if (options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }
    if (options?.topP !== undefined) {
      requestBody.top_p = options.topP;
    }
    if (options?.stopSequences?.length) {
      requestBody.stop = options.stopSequences;
    }

    try {
      const response = await fetch(this.config.baseUrl || OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(this.config.organizationId && { 'OpenAI-Organization': this.config.organizationId }),
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout || 120000),
      });

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
        throw new Error(`OpenAI API request timed out after ${this.config.timeout}ms`);
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

    const requestBody: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      max_tokens: options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 4096,
      stream: true,
    };

    if (options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    try {
      const response = await fetch(this.config.baseUrl || OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(this.config.organizationId && { 'OpenAI-Organization': this.config.organizationId }),
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout || 120000),
      });

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
          model: 'gpt-3.5-turbo',
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

  // Token estimation using tiktoken approximation
  estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English text
    // OpenAI uses cl100k_base encoding for newer models
    return Math.ceil(text.length / 4);
  }
}

// Factory function
export function createOpenAIProvider(config?: Partial<ProviderConfig>): OpenAIProvider {
  return new OpenAIProvider(config);
}
