/**
 * Local LLM Provider
 *
 * Any server speaking OpenAI's chat-completions protocol on your own machine:
 * LM Studio, Ollama, llama.cpp, vLLM. The request/stream handling is
 * OpenAI's; what differs is that the model list is whatever the server says
 * it has loaded, and an API key is optional.
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
} from './types.js';
import { OpenAIProvider } from './openai-provider.js';
import { logger } from '../logger.js';

/** LM Studio's richer listing: it states the model's kind and context length. */
interface LMStudioModel {
  id: string;
  type?: 'llm' | 'vlm' | 'embeddings' | string;
  max_context_length?: number;
}

function toModelInfo(id: string, extra?: Partial<ModelInfo>): ModelInfo {
  return {
    id,
    name: id,
    provider: 'local',
    contextWindow: 0,
    // Servers do not report an output ceiling; this is the pipeline's own default.
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsDocuments: false,
    supportsFunctionCalling: false,
    supportsStreaming: true,
    inputPricePer1kTokens: 0,
    outputPricePer1kTokens: 0,
    ...extra,
  };
}

export class LocalProvider extends OpenAIProvider {
  readonly name: string = 'Local';
  readonly type: ProviderType = 'local';
  readonly supportedModels: ModelInfo[] = [];

  /** e.g. http://localhost:1234/v1 — the chat URL and model listing hang off it. */
  private apiRoot: string = '';

  constructor(config?: Partial<ProviderConfig>) {
    super(config);
    // super() ran setProviderType before this class's `type` was assigned.
    this.setProviderType();
    // OpenAIProvider defaults to its own flagship; a local server has no such thing.
    this.config.model = config?.model || '';
  }

  configure(config: ProviderConfig): void {
    if (config.baseUrl) {
      this.apiRoot = config.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    }
    super.configure({
      ...config,
      baseUrl: this.apiRoot ? `${this.apiRoot}/chat/completions` : undefined,
      // OpenAIProvider refuses to send without a key; a keyless server ignores the header.
      apiKey: config.apiKey || 'local',
    });
    if (config.model) this.ensureModelListed(config.model);
  }

  // Configured by its URL alone: without LOCAL_LLM_MODEL the model comes from
  // the server's listing, which is async and may not have landed yet.
  isConfigured(): boolean {
    return !!this.apiRoot;
  }

  /**
   * Replace the model list with what the server reports. LM Studio's
   * /api/v0/models states each model's type (so embedding models stay out of
   * the picker) and context length; any other server gets the plain
   * OpenAI /v1/models. Returns false when the server could not be read, so a
   * stale list and an empty server are not confused.
   */
  async refreshModels(): Promise<boolean> {
    if (!this.apiRoot) return false;
    const headers: Record<string, string> = {};
    if (this.config.apiKey && this.config.apiKey !== 'local') {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    const origin = this.apiRoot.replace(/\/v1$/, '');

    let models: ModelInfo[] | undefined;
    try {
      const res = await fetch(`${origin}/api/v0/models`, { headers, signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const body = (await res.json()) as { data?: LMStudioModel[] };
        models = (body.data ?? [])
          .filter(m => m.type !== 'embeddings')
          .map(m => toModelInfo(m.id, {
            contextWindow: m.max_context_length ?? 0,
            supportsVision: m.type === 'vlm',
          }));
      }
    } catch {
      // Not LM Studio, or not reachable — try the generic listing.
    }

    if (!models) {
      try {
        const res = await fetch(`${this.apiRoot}/models`, { headers, signal: AbortSignal.timeout(3000) });
        if (!res.ok) {
          logger.warn(`Local LLM: model listing failed (${res.status}) at ${this.apiRoot}/models`);
          return false;
        }
        const body = (await res.json()) as { data?: Array<{ id: string }> };
        models = (body.data ?? []).map(m => toModelInfo(m.id));
      } catch (error) {
        logger.warn(`Local LLM: server unreachable at ${this.apiRoot}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }

    this.supportedModels.splice(0, this.supportedModels.length, ...models);
    if (!this.config.model && models.length > 0) this.config.model = models[0].id;
    if (this.config.model) this.ensureModelListed(this.config.model);
    return true;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    await this.ensureModel();
    return super.chat(messages, this.servedModel(options));
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    await this.ensureModel();
    yield* super.chatStream(messages, this.servedModel(options));
  }

  async validateApiKey(_apiKey: string): Promise<ValidationResult> {
    const ok = await this.refreshModels();
    return ok
      ? { valid: true, models: this.supportedModels }
      : { valid: false, error: `Could not list models at ${this.apiRoot}` };
  }

  /**
   * Callers name hosted models this server cannot have — the cheap-model
   * helpers, a model the panel remembered from another provider. Those go to
   * the configured model; an id the server listed is honoured as asked.
   */
  private servedModel(options?: ChatOptions): ChatOptions | undefined {
    const requested = options?.model;
    if (!requested || this.supportedModels.some(m => m.id === requested)) return options;
    logger.debug(`Local LLM: "${requested}" is not loaded here; using ${this.config.model}`);
    return { ...options, model: this.config.model };
  }

  private async ensureModel(): Promise<void> {
    if (this.config.model) return;
    await this.refreshModels();
    if (!this.config.model) {
      throw new Error(`Local LLM: no model available at ${this.apiRoot} — load one, or set LOCAL_LLM_MODEL`);
    }
  }

  private ensureModelListed(id: string): void {
    if (!this.supportedModels.some(m => m.id === id)) this.supportedModels.push(toModelInfo(id));
  }
}
