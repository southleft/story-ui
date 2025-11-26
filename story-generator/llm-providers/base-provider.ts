/**
 * Base LLM Provider
 *
 * Abstract base class for LLM providers with shared functionality.
 */

import {
  LLMProvider,
  ProviderType,
  ProviderConfig,
  ModelInfo,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ImageContent,
  ImageAnalysis,
  ValidationResult,
} from './types.js';
import { logger } from '../logger.js';

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly type: ProviderType;
  abstract readonly supportedModels: ModelInfo[];

  protected config: ProviderConfig;

  constructor(config?: Partial<ProviderConfig>) {
    // Note: provider type will be set by subclass after construction
    this.config = {
      provider: 'custom' as ProviderType, // Placeholder, will be set when configure() is called
      model: '',
      timeout: 120000, // 2 minutes default
      ...config,
    } as ProviderConfig;
  }

  /**
   * Called after construction to set the provider type
   * Subclasses should call this in their constructor after super()
   */
  protected setProviderType(): void {
    this.config.provider = this.type;
  }

  // Abstract methods that must be implemented
  abstract chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  abstract validateApiKey(apiKey: string): Promise<ValidationResult>;

  // Default capability checks (can be overridden)
  supportsVision(): boolean {
    const model = this.getSelectedModel();
    return model?.supportsVision ?? false;
  }

  supportsDocuments(): boolean {
    const model = this.getSelectedModel();
    return model?.supportsDocuments ?? false;
  }

  supportsFunctionCalling(): boolean {
    const model = this.getSelectedModel();
    return model?.supportsFunctionCalling ?? false;
  }

  supportsStreaming(): boolean {
    const model = this.getSelectedModel();
    return model?.supportsStreaming ?? false;
  }

  // Configuration methods
  configure(config: ProviderConfig): void {
    this.config = { ...this.config, ...config };
    logger.debug(`${this.name} provider configured`, {
      model: config.model,
      hasApiKey: !!config.apiKey,
    });
  }

  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  isConfigured(): boolean {
    return !!this.config.apiKey && !!this.config.model;
  }

  // Helper methods
  protected getSelectedModel(): ModelInfo | undefined {
    return this.supportedModels.find(m => m.id === this.config.model);
  }

  protected validateMessages(messages: ChatMessage[]): void {
    if (!messages || messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    for (const msg of messages) {
      if (!['user', 'assistant', 'system'].includes(msg.role)) {
        throw new Error(`Invalid message role: ${msg.role}`);
      }
    }
  }

  protected buildSystemPrompt(options?: ChatOptions): string | undefined {
    return options?.systemPrompt;
  }

  // Default streaming implementation (providers can override)
  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<StreamChunk> {
    // Default non-streaming implementation
    try {
      const response = await this.chat(messages, options);
      yield {
        type: 'text',
        content: response.content,
      };
      yield {
        type: 'done',
        usage: response.usage,
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Default image analysis (providers can override)
  async analyzeImage(image: ImageContent, prompt?: string): Promise<ImageAnalysis> {
    if (!this.supportsVision()) {
      throw new Error(`${this.name} provider does not support image analysis`);
    }

    const analysisPrompt = prompt || 'Analyze this image and describe what you see, including any UI components, layout structure, colors, and design patterns.';

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt },
          image,
        ],
      },
    ];

    const response = await this.chat(messages);

    // Parse the response to extract structured information
    return {
      description: response.content,
      // Additional parsing could be done here based on the prompt
    };
  }

  // Simple token estimation (providers can override with more accurate methods)
  estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  // Request logging
  protected logRequest(messages: ChatMessage[], options?: ChatOptions): void {
    logger.debug(`${this.name} API request`, {
      model: options?.model || this.config.model,
      messageCount: messages.length,
      hasSystemPrompt: !!options?.systemPrompt,
    });
  }

  protected logResponse(response: ChatResponse): void {
    logger.debug(`${this.name} API response`, {
      model: response.model,
      finishReason: response.finishReason,
      usage: response.usage,
    });
  }
}
