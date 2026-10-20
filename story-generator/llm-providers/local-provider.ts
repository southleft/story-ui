/**
 * Local LLM Provider
 *
 * Any server speaking OpenAI's chat-completions protocol: LM Studio, Ollama,
 * llama.cpp and vLLM on your own machine, or a router such as OpenRouter. The
 * request/stream handling is OpenAI's; what differs is that the model list is
 * whatever the server says this account can use, and an API key is optional.
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

/** An OpenAI /models entry; routers like OpenRouter add capability fields. */
interface ListedModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null };
}

/**
 * Where a server lists its models, most informative first. LM Studio's own
 * listing states model kinds; OpenRouter's /models/user is filtered by the
 * account's provider settings, where /models lists models the account may be
 * refused (a 404 at send time); /models is the OpenAI standard.
 */
type Listing = 'lmstudio' | 'user' | 'openai';

const LISTING_TIMEOUT_MS = 10_000;

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

function fromListedModel(m: ListedModel): ModelInfo {
  const maxOut = m.top_provider?.max_completion_tokens;
  return toModelInfo(m.id, {
    ...(m.name && { name: m.name }),
    ...(m.context_length && { contextWindow: m.context_length }),
    ...(maxOut && { maxOutputTokens: maxOut }),
    supportsVision: m.architecture?.input_modalities?.includes('image') ?? false,
  });
}

export class LocalProvider extends OpenAIProvider {
  name: string = 'Local';
  readonly type: ProviderType = 'local';
  readonly supportedModels: ModelInfo[] = [];

  /** e.g. http://localhost:1234/v1 — the chat URL and model listing hang off it. */
  private apiRoot: string = '';
  /** The listing that last answered, so a refresh does not re-probe the others. */
  private listing?: Listing;
  /** Panels refresh on every load; warn about each unlisted model once. */
  private readonly warnedUnlisted = new Set<string>();
  private pending?: Promise<boolean>;
  /**
   * Until the server has been listed, supportedModels holds only the
   * configured model, and servedModel would swap every chosen model for it.
   */
  private listed = false;

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
      this.listing = undefined;
    }
    if (config.displayName) this.name = config.displayName;
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
   * Replace the model list with what the server reports, narrowed to
   * LOCAL_LLM_MODELS when set. Tries each listing in turn, starting with the
   * one that answered last time. Returns false when the server could not be
   * read, so a stale list and an empty server are not confused.
   */
  async refreshModels(): Promise<boolean> {
    // One request in flight at a time: the startup listing, a panel load and a
    // first chat can all ask at once.
    this.pending ??= this.fetchModels().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async fetchModels(): Promise<boolean> {
    if (!this.apiRoot) return false;
    const hasKey = !!this.config.apiKey && this.config.apiKey !== 'local';
    const headers: Record<string, string> = hasKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};

    // Without a key /models/user cannot know the account, so it is not tried.
    const order: Listing[] = hasKey ? ['lmstudio', 'user', 'openai'] : ['lmstudio', 'openai'];
    if (this.listing) order.sort((a, b) => Number(b === this.listing) - Number(a === this.listing));

    let models: ModelInfo[] | undefined;
    let lastFailure = '';
    for (const listing of order) {
      const url = this.listingUrl(listing);
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(LISTING_TIMEOUT_MS) });
        if (!res.ok) {
          lastFailure = `${res.status} at ${url}`;
          continue;
        }
        const body = (await res.json()) as { data?: unknown[] };
        if (!Array.isArray(body.data)) {
          lastFailure = `no model list at ${url}`;
          continue;
        }
        models = listing === 'lmstudio'
          ? (body.data as LMStudioModel[])
            .filter(m => m.type !== 'embeddings')
            .map(m => toModelInfo(m.id, {
              contextWindow: m.max_context_length ?? 0,
              supportsVision: m.type === 'vlm',
            }))
          : (body.data as ListedModel[])
            .filter(m => m.architecture?.output_modalities?.includes('text') ?? true)
            .map(fromListedModel);
        this.listing = listing;
        break;
      } catch (error) {
        lastFailure = `${url} unreachable (${error instanceof Error ? error.message : String(error)})`;
      }
    }

    if (!models) {
      logger.warn(`${this.name}: could not list models — ${lastFailure}`);
      return false;
    }

    const offered = models;
    const allowed = this.config.allowedModels;
    if (allowed?.length) {
      const missing = allowed.filter(id => !offered.some(m => m.id === id));
      if (missing.length) logger.warn(`${this.name}: LOCAL_LLM_MODELS names models the server does not offer: ${missing.join(', ')}`);
      models = offered.filter(m => allowed.includes(m.id));
    }

    this.supportedModels.splice(0, this.supportedModels.length, ...models);
    this.listed = true;
    if (!this.config.model && models.length > 0) this.config.model = models[0].id;

    // Kept usable (a server may load a model on demand), but a router will
    // usually refuse one it does not offer; say so now, not at the first request.
    const configured: Array<[string, string | undefined]> = [
      ['LOCAL_LLM_MODEL', this.config.model],
      ['LOCAL_LLM_SMALL_MODEL', this.config.smallModel],
    ];
    for (const [setting, id] of configured) {
      if (!id || offered.some(m => m.id === id) || this.warnedUnlisted.has(id)) continue;
      logger.warn(`${this.name}: ${setting} "${id}" is not among the ${offered.length} models ${this.apiRoot} offers this account`);
      this.warnedUnlisted.add(id);
    }
    if (this.config.model) this.ensureModelListed(this.config.model);
    return true;
  }

  private listingUrl(listing: Listing): string {
    switch (listing) {
      case 'lmstudio': return `${this.apiRoot.replace(/\/v1$/, '')}/api/v0/models`;
      case 'user': return `${this.apiRoot}/models/user`;
      case 'openai': return `${this.apiRoot}/models`;
    }
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
   * Callers name hosted models this server cannot have — a model the panel
   * remembered from another provider. Those go to the configured model; an id
   * the server listed, or the configured cheap model (which LOCAL_LLM_MODELS
   * may keep out of the picker), is honoured as asked.
   */
  private servedModel(options?: ChatOptions): ChatOptions | undefined {
    const requested = options?.model;
    if (!requested || requested === this.config.smallModel || this.supportedModels.some(m => m.id === requested)) {
      return options;
    }
    logger.debug(`${this.name}: "${requested}" is not offered here; using ${this.config.model}`);
    return { ...options, model: this.config.model };
  }

  private async ensureModel(): Promise<void> {
    // A failed listing is not fatal here: the configured model may still answer.
    if (!this.listed) await this.refreshModels();
    if (!this.config.model) {
      throw new Error(`${this.name}: no model available at ${this.apiRoot} — load one, or set LOCAL_LLM_MODEL`);
    }
  }

  private ensureModelListed(id: string): void {
    if (!this.supportedModels.some(m => m.id === id)) this.supportedModels.push(toModelInfo(id));
  }
}
