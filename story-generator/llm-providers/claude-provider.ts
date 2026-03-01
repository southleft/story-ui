/**
 * Claude LLM Provider
 *
 * Implementation of the LLM provider interface for Anthropic's Claude models.
 * Supports both the direct Anthropic API and AWS Bedrock as deployment targets.
 *
 * Bedrock mode is activated when `bedrockRegion` is set in the provider config.
 * It requires `@aws-sdk/client-bedrock-runtime` to be installed (optional peer dep).
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
//
// In Bedrock mode the model ID is derived automatically as `anthropic.{id}-v1:0`.
// Override with AWS_BEDROCK_MODEL_ID env var for cross-region inference profiles,
// provisioned throughput ARNs, or any other custom Bedrock model identifier.
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

// Default model - Claude Opus 4.5 (recommended for agents and coding)
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

// Lazily cached Bedrock client to avoid re-creating per request
let bedrockClientCache: { client: any; region: string } | null = null;

async function getBedrockClient(config: ProviderConfig): Promise<any> {
  const region = config.bedrockRegion!;

  if (bedrockClientCache && bedrockClientCache.region === region) {
    return bedrockClientCache.client;
  }

  let BedrockRuntimeClient: any;
  try {
    const mod = await import('@aws-sdk/client-bedrock-runtime');
    BedrockRuntimeClient = mod.BedrockRuntimeClient;
  } catch {
    throw new Error(
      'AWS Bedrock support requires @aws-sdk/client-bedrock-runtime. ' +
      'Install it with: npm install @aws-sdk/client-bedrock-runtime'
    );
  }

  const clientConfig: Record<string, any> = { region };

  if (config.bedrockAccessKeyId && config.bedrockSecretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.bedrockAccessKeyId,
      secretAccessKey: config.bedrockSecretAccessKey,
      ...(config.bedrockSessionToken ? { sessionToken: config.bedrockSessionToken } : {}),
    };
  }

  const client = new BedrockRuntimeClient(clientConfig);
  bedrockClientCache = { client, region };
  return client;
}

function resolveBedrockModelId(config: ProviderConfig, modelOverride?: string): string {
  if (config.bedrockModelId) {
    return config.bedrockModelId;
  }
  const anthropicModelId = modelOverride || config.model;
  return `anthropic.${anthropicModelId}-v1:0`;
}

export class ClaudeProvider extends BaseLLMProvider {
  readonly name = 'Claude';
  readonly type: ProviderType = 'claude';
  readonly supportedModels = CLAUDE_MODELS;

  constructor(config?: Partial<ProviderConfig>) {
    super(config);
    // Set the provider type after base constructor
    this.setProviderType();
    if (!this.config.model) {
      this.config.model = DEFAULT_MODEL;
    }
  }

  isBedrockMode(): boolean {
    return this.config.transport === 'bedrock';
  }

  isConfigured(): boolean {
    if (this.isBedrockMode()) {
      return !!this.config.model;
    }
    return !!this.config.apiKey && !!this.config.model;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this.validateMessages(messages);
    this.logRequest(messages, options);

    const model = options?.model || this.config.model;
    const body = this.buildRequestBody(messages, options);

    try {
      const data = await this.sendRequest(body, model);
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

    const model = options?.model || this.config.model;
    const body = this.buildRequestBody(messages, options);

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const event of this.sendStreamRequest(body, model)) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield { type: 'text', content: event.delta.text };
        } else if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens || 0;
        } else if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens || 0;
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
      const body = { max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] };
      const model = this.isBedrockMode() ? this.config.model : 'claude-haiku-4-5-20251001';
      await this.sendRequest(body, model);
      return { valid: true, models: this.supportedModels };
    } catch (error: any) {
      const msg = error?.message || String(error);

      if (msg.includes('401') || msg.includes('Invalid API key')) {
        return { valid: false, error: 'Invalid API key' };
      }
      if (msg.includes('UnrecognizedClient') || msg.includes('security token') || msg.includes('credentials')) {
        return { valid: false, error: 'Invalid AWS credentials for Bedrock' };
      }
      if (msg.includes('AccessDeniedException')) {
        return { valid: false, error: 'AWS credentials lack Bedrock InvokeModel permission' };
      }
      return { valid: false, error: `Validation failed: ${msg}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Request body
  // ---------------------------------------------------------------------------

  private buildRequestBody(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Record<string, unknown> {
    const anthropicMessages = this.convertMessages(messages);
    const systemPrompt = this.buildSystemPrompt(options);

    const body: Record<string, unknown> = {
      max_tokens: options?.maxTokens || this.getSelectedModel()?.maxOutputTokens || 4096,
      messages: anthropicMessages,
    };

    if (systemPrompt) body.system = systemPrompt;
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.topP !== undefined) body.top_p = options.topP;
    if (options?.topK !== undefined) body.top_k = options.topK;
    if (options?.stopSequences?.length) body.stop_sequences = options.stopSequences;

    return body;
  }

  // ---------------------------------------------------------------------------
  // Transport — the only place Bedrock vs Direct API diverges
  // ---------------------------------------------------------------------------

  private async sendRequest(
    body: Record<string, unknown>,
    model: string,
  ): Promise<AnthropicResponse> {
    if (this.isBedrockMode()) {
      const client = await getBedrockClient(this.config);
      const modelId = resolveBedrockModelId(this.config, model);
      logger.debug('Bedrock InvokeModel', { modelId, region: this.config.bedrockRegion });

      const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ ...body, anthropic_version: ANTHROPIC_VERSION }),
      });

      const response = await client.send(command);
      return JSON.parse(new TextDecoder().decode(response.body)) as AnthropicResponse;
    }

    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error('Claude API key not configured');
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ ...body, model }),
      signal: AbortSignal.timeout(this.config.timeout || 120000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error('Claude API error response', { status: response.status, body: errorBody });
      throw new Error(`Claude API error: ${response.status} - ${errorBody}`);
    }

    return (await response.json()) as AnthropicResponse;
  }

  private async *sendStreamRequest(
    body: Record<string, unknown>,
    model: string,
  ): AsyncGenerator<any> {
    if (this.isBedrockMode()) {
      const client = await getBedrockClient(this.config);
      const modelId = resolveBedrockModelId(this.config, model);
      logger.debug('Bedrock InvokeModelWithResponseStream', { modelId, region: this.config.bedrockRegion });

      const { InvokeModelWithResponseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const command = new InvokeModelWithResponseStreamCommand({
        modelId,
        contentType: 'application/json',
        body: JSON.stringify({ ...body, anthropic_version: ANTHROPIC_VERSION }),
      });

      const response = await client.send(command);
      if (response.body) {
        for await (const event of response.body) {
          if (event.chunk?.bytes) {
            yield JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          }
        }
      }
      return;
    }

    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error('Claude API key not configured');
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ ...body, model, stream: true }),
      signal: AbortSignal.timeout(this.config.timeout || 120000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

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
            yield JSON.parse(data);
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message / response conversion
  // ---------------------------------------------------------------------------

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
