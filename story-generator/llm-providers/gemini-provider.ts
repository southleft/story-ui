/**
 * Gemini LLM Provider
 *
 * Implementation of the LLM provider interface for Google's Gemini models.
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

// Gemini model definitions - Updated December 2025
// Top 5 models - Reference: https://ai.google.dev/gemini-api/docs/models
const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    provider: 'gemini',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true,
    inputPricePer1kTokens: 0.002,
    outputPricePer1kTokens: 0.012,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true,
    inputPricePer1kTokens: 0.00125,
    outputPricePer1kTokens: 0.01,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true,
    inputPricePer1kTokens: 0.00015,
    outputPricePer1kTokens: 0.0006,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.00,
    outputPricePer1kTokens: 0.00,
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'gemini',
    contextWindow: 2097152,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsDocuments: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    inputPricePer1kTokens: 0.00125,
    outputPricePer1kTokens: 0.005,
  },
];

// Default model - Gemini 3 Pro Preview (most capable)
const DEFAULT_MODEL = 'gemini-3-pro-preview';

// API configuration
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text?: string }>;
      role: string;
    };
    finishReason: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiProvider extends BaseLLMProvider {
  readonly name = 'Gemini';
  readonly type: ProviderType = 'gemini';
  readonly supportedModels = GEMINI_MODELS;

  constructor(config?: Partial<ProviderConfig>) {
    super(config);
    // Set the provider type after base constructor
    this.setProviderType();
    // Set default model if not provided
    if (!this.config.model) {
      this.config.model = DEFAULT_MODEL;
    }
  }

  private getApiUrl(model: string, stream: boolean = false): string {
    const method = stream ? 'streamGenerateContent' : 'generateContent';
    return `${GEMINI_API_BASE}/${model}:${method}`;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this.validateMessages(messages);
    this.logRequest(messages, options);

    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const model = options?.model || this.config.model;
    const geminiContents = this.convertMessages(messages);
    const systemPrompt = this.buildSystemPrompt(options);

    const requestBody: Record<string, unknown> = {
      contents: geminiContents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 8192,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.topP !== undefined && { topP: options.topP }),
        ...(options?.topK !== undefined && { topK: options.topK }),
        ...(options?.stopSequences?.length && { stopSequences: options.stopSequences }),
      },
    };

    // Add system instruction if provided
    if (systemPrompt) {
      requestBody.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const url = `${this.getApiUrl(model)}?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout || 120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('Gemini API error response', { status: response.status, body: errorBody });
        throw new Error(`Gemini API error: ${response.status} - ${errorBody}`);
      }

      const data = (await response.json()) as GeminiResponse;
      const chatResponse = this.convertResponse(data, model);
      this.logResponse(chatResponse);
      return chatResponse;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`Gemini API request timed out after ${this.config.timeout}ms`);
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
      yield { type: 'error', error: 'Gemini API key not configured' };
      return;
    }

    const model = options?.model || this.config.model;
    const geminiContents = this.convertMessages(messages);
    const systemPrompt = this.buildSystemPrompt(options);

    const requestBody: Record<string, unknown> = {
      contents: geminiContents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 8192,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
      },
    };

    if (systemPrompt) {
      requestBody.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const url = `${this.getApiUrl(model, true)}?key=${apiKey}&alt=sse`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout || 120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        yield { type: 'error', error: `Gemini API error: ${response.status} - ${errorBody}` };
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
            if (!data || data === '[DONE]') continue;

            try {
              const event = JSON.parse(data) as GeminiResponse;

              // Extract text from candidates
              const text = event.candidates?.[0]?.content?.parts
                ?.map(p => p.text)
                .filter(Boolean)
                .join('');

              if (text) {
                yield { type: 'text', content: text };
              }

              // Extract usage metadata
              if (event.usageMetadata) {
                promptTokens = event.usageMetadata.promptTokenCount || 0;
                completionTokens = event.usageMetadata.candidatesTokenCount || 0;
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
      const url = `${this.getApiUrl('gemini-1.5-flash')}?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 1 },
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
      if (response.status === 400 && errorBody.includes('API_KEY_INVALID')) {
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

  // Convert our message format to Gemini format
  private convertMessages(messages: ChatMessage[]): GeminiContent[] {
    return messages
      .filter(msg => msg.role !== 'system') // System messages handled separately
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: this.convertContent(msg.content),
      }));
  }

  private convertContent(content: string | MessageContent[]): GeminiPart[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    return content.map(item => {
      if (item.type === 'text') {
        return { text: item.text };
      }
      if (item.type === 'image') {
        const imageContent = item as ImageContent;
        if (imageContent.source.type === 'base64' && imageContent.source.data) {
          return {
            inlineData: {
              mimeType: imageContent.source.mediaType || 'image/png',
              data: imageContent.source.data,
            },
          };
        }
        // URL images - Gemini requires base64, so we store for async processing
        // NOTE: For Gemini, URL images should be pre-converted to base64 using imageProcessor.ts
        // If a URL image reaches here, it means it wasn't pre-processed
        if (imageContent.source.url) {
          logger.warn(`Gemini provider received URL image that wasn't pre-converted to base64. URL: ${imageContent.source.url}`);
          logger.warn('For best results, use imageProcessor.processImageInputs() to convert URL images before sending to Gemini.');
          return { text: `[Image URL - requires base64 conversion: ${imageContent.source.url}]` };
        }
        return { text: '[Invalid image content]' };
      }
      // Document type
      if (item.type === 'document') {
        return { text: `[Document: ${item.source.name || 'unnamed'}]` };
      }
      return { text: '' };
    });
  }

  private convertResponse(data: GeminiResponse, model: string): ChatResponse {
    const candidate = data.candidates?.[0];
    const textParts = candidate?.content?.parts || [];
    const content = textParts.map(p => p.text || '').join('');

    return {
      id: `gemini-${Date.now()}`, // Gemini doesn't return an ID
      model,
      content,
      finishReason: this.mapFinishReason(candidate?.finishReason),
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      raw: data,
    };
  }

  private mapFinishReason(
    finishReason: string | undefined
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (finishReason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  // Token estimation for Gemini
  estimateTokens(text: string): number {
    // Gemini uses a similar tokenization to other LLMs
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

// Factory function
export function createGeminiProvider(config?: Partial<ProviderConfig>): GeminiProvider {
  return new GeminiProvider(config);
}
