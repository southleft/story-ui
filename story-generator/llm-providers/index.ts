/**
 * LLM Providers Module
 *
 * Exports all LLM providers and the provider registry for managing them.
 */

// Types
export * from './types.js';

// Base provider
export { BaseLLMProvider } from './base-provider.js';
export type { CredentialSource, VertexTarget } from './enterprise-auth.js';

// Provider implementations
export { ClaudeProvider, CLAUDE_MODELS } from './claude-provider.js';
import { CLAUDE_SMALL_MODEL } from './claude-provider.js';
import { OPENAI_SMALL_MODEL } from './openai-provider.js';
import { GEMINI_SMALL_MODEL } from './gemini-provider.js';
export { OpenAIProvider, OPENAI_MODELS } from './openai-provider.js';
export { GeminiProvider, GEMINI_MODELS } from './gemini-provider.js';

// Legacy model-ID aliases (kept so consumer configs written against older
// releases keep working after an update).
import { CLAUDE_LEGACY_MODEL_ALIASES } from './claude-provider.js';
import { OPENAI_LEGACY_MODEL_ALIASES } from './openai-provider.js';
import { GEMINI_LEGACY_MODEL_ALIASES } from './gemini-provider.js';

export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  ...CLAUDE_LEGACY_MODEL_ALIASES,
  ...OPENAI_LEGACY_MODEL_ALIASES,
  ...GEMINI_LEGACY_MODEL_ALIASES,
};

/** Map an outdated model ID to its current equivalent (identity for current IDs). */
export function resolveModelAlias(modelId: string): string {
  return LEGACY_MODEL_ALIASES[modelId] || modelId;
}

// Provider registry
import {
  LLMProvider,
  ProviderType,
  ProviderRegistry,
  ModelInfo,
  ProviderConfig,
} from './types.js';
import { ClaudeProvider } from './claude-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { logger } from '../logger.js';
import {
  CredentialSource,
  bearerSourceFromEnv,
  googleAdcSource,
  staticBearerSource,
  vertexTargetFromEnv,
} from './enterprise-auth.js';

/**
 * Default Provider Registry Implementation
 */
class DefaultProviderRegistry implements ProviderRegistry {
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private defaultProviderType: ProviderType | null = null;

  constructor() {
    // Register built-in providers
    this.registerBuiltInProviders();
  }

  private registerBuiltInProviders(): void {
    // Register all built-in providers
    this.register(new ClaudeProvider());
    this.register(new OpenAIProvider());
    this.register(new GeminiProvider());
    logger.debug('Registered built-in providers: Claude, OpenAI, Gemini');
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.type, provider);
    logger.debug(`Registered provider: ${provider.name} (${provider.type})`);

    // Set as default if it's the first provider
    if (!this.defaultProviderType) {
      this.defaultProviderType = provider.type;
    }
  }

  get(type: ProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }

  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getAvailableModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const provider of this.providers.values()) {
      models.push(...provider.supportedModels);
    }
    return models;
  }

  getDefault(): LLMProvider | undefined {
    if (!this.defaultProviderType) return undefined;
    return this.providers.get(this.defaultProviderType);
  }

  setDefault(type: ProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider type '${type}' is not registered`);
    }
    this.defaultProviderType = type;
    logger.debug(`Set default provider to: ${type}`);
  }

  /**
   * Configure a provider with API key and settings
   */
  configureProvider(type: ProviderType, config: Partial<ProviderConfig>): void {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider type '${type}' is not registered`);
    }
    provider.configure({ ...config, provider: type } as ProviderConfig);
  }

  /**
   * Get a provider that supports a specific model
   */
  getProviderForModel(modelId: string): LLMProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.supportedModels.some(m => m.id === modelId)) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * Check if any provider is configured and ready to use
   */
  hasConfiguredProvider(): boolean {
    for (const provider of this.providers.values()) {
      if (provider.isConfigured()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all configured providers
   */
  getConfiguredProviders(): LLMProvider[] {
    return this.getAll().filter(p => p.isConfigured());
  }
}

// Singleton registry instance
let registryInstance: DefaultProviderRegistry | null = null;

/**
 * Get the global provider registry instance
 */
export function getProviderRegistry(): DefaultProviderRegistry {
  if (!registryInstance) {
    registryInstance = new DefaultProviderRegistry();
  }
  return registryInstance;
}

/**
 * Convenience function to get a provider by type
 */
export function getProvider(type: ProviderType): LLMProvider | undefined {
  return getProviderRegistry().get(type);
}

/**
 * Convenience function to get the default provider
 */
/**
 * The cheap model of a provider, for calls where quality does not matter:
 * a story title, a two-sentence chat summary. Generation keeps the model the
 * user chose.
 */
export function smallModelFor(provider?: ProviderType | string): string | undefined {
  const type = (provider as ProviderType | undefined) || getDefaultProvider()?.type;
  switch (type) {
    case 'claude': return CLAUDE_SMALL_MODEL;
    case 'openai': return OPENAI_SMALL_MODEL;
    case 'gemini': return GEMINI_SMALL_MODEL;
    default: return undefined;
  }
}

export function getDefaultProvider(): LLMProvider | undefined {
  return getProviderRegistry().getDefault();
}

/**
 * Convenience function to configure a provider
 */
export function configureProvider(
  type: ProviderType,
  config: Partial<ProviderConfig>
): void {
  getProviderRegistry().configureProvider(type, config);
}

/**
 * Initialize providers from environment variables.
 *
 * Each provider is configured by an API key, or (for teams that do not issue
 * keys) by enterprise credentials: Vertex AI with Google ADC, or a gateway
 * base URL with an OAuth / token-command bearer. See enterprise-auth.ts for
 * every variable.
 */
export function initializeFromEnv(): void {
  const registry = getProviderRegistry();
  const env = process.env;
  // One bearer source shared by every gateway, so one token cache serves all.
  const gatewayBearer = bearerSourceFromEnv(env);
  const describe = (c?: CredentialSource) => (c ? ` with ${c.description}` : '');

  // Claude: Vertex AI, then a gateway, then the Claude API with a key.
  const claudeKey = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY;
  const claudeModel = resolveModelAlias(env.CLAUDE_MODEL || 'claude-opus-5-5');
  const claudeVertex = vertexTargetFromEnv('claude', env);
  const anthropicBaseUrl = env.ANTHROPIC_BASE_URL?.trim() || undefined;
  if (claudeVertex) {
    const credentials = gatewayBearer || googleAdcSource();
    registry.configureProvider('claude', { model: claudeModel, vertex: claudeVertex, credentials });
    logger.info(`Claude provider configured for Vertex AI (${claudeVertex.project}, ${claudeVertex.location})${describe(credentials)}`);
  } else {
    const credentials = env.ANTHROPIC_AUTH_TOKEN?.trim()
      ? staticBearerSource(env.ANTHROPIC_AUTH_TOKEN.trim(), 'ANTHROPIC_AUTH_TOKEN')
      : anthropicBaseUrl && !claudeKey ? gatewayBearer : undefined;
    if (claudeKey || credentials) {
      registry.configureProvider('claude', { apiKey: claudeKey, model: claudeModel, baseUrl: anthropicBaseUrl, credentials });
      logger.info(`Claude provider configured from environment${anthropicBaseUrl ? ` (gateway ${safeHost(anthropicBaseUrl)})` : ''}${describe(credentials)}`);
    }
  }

  // OpenAI (and any OpenAI-compatible gateway).
  const openaiKey = env.OPENAI_API_KEY;
  const openaiBaseUrl = env.OPENAI_BASE_URL?.trim() || undefined;
  const openaiCredentials = openaiBaseUrl && !openaiKey ? gatewayBearer : undefined;
  if (openaiKey || openaiCredentials) {
    registry.configureProvider('openai', {
      apiKey: openaiKey,
      model: resolveModelAlias(env.OPENAI_MODEL || 'gpt-5.6-sol'),
      organizationId: env.OPENAI_ORG_ID,
      baseUrl: openaiBaseUrl,
      credentials: openaiCredentials,
    });
    logger.info(`OpenAI provider configured from environment${openaiBaseUrl ? ` (gateway ${safeHost(openaiBaseUrl)})` : ''}${describe(openaiCredentials)}`);
  }

  // Gemini: Vertex AI, then the Gemini API with a key.
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const geminiModel = resolveModelAlias(env.GEMINI_MODEL || 'gemini-4-argon');
  const geminiVertex = vertexTargetFromEnv('gemini', env);
  if (geminiVertex) {
    const credentials = gatewayBearer || googleAdcSource();
    registry.configureProvider('gemini', { model: geminiModel, vertex: geminiVertex, credentials });
    logger.info(`Gemini provider configured for Vertex AI (${geminiVertex.project}, ${geminiVertex.location})${describe(credentials)}`);
  } else if (geminiKey) {
    registry.configureProvider('gemini', { apiKey: geminiKey, model: geminiModel });
    logger.info('Gemini provider configured from environment');
  }
}

/** Host of a URL for logs; a base URL can carry a key in its query string. */
function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return 'invalid URL'; }
}
