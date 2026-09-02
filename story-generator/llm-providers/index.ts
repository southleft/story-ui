/**
 * LLM Providers Module
 *
 * Exports all LLM providers and the provider registry for managing them.
 */

// Types
export * from './types.js';

// Base provider
export { BaseLLMProvider } from './base-provider.js';

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
 * Initialize providers from environment variables
 */
export function initializeFromEnv(): void {
  const registry = getProviderRegistry();

  // Configure Claude if API key is present
  const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (claudeKey) {
    registry.configureProvider('claude', {
      apiKey: claudeKey,
      model: resolveModelAlias(process.env.CLAUDE_MODEL || 'claude-opus-5'),
    });
    logger.info('Claude provider configured from environment');
  }

  // Configure OpenAI if API key is present
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    registry.configureProvider('openai', {
      apiKey: openaiKey,
      model: resolveModelAlias(process.env.OPENAI_MODEL || 'gpt-5.5'),
      organizationId: process.env.OPENAI_ORG_ID,
    });
    logger.info('OpenAI provider configured from environment');
  }

  // Configure Gemini if API key is present
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    registry.configureProvider('gemini', {
      apiKey: geminiKey,
      model: resolveModelAlias(process.env.GEMINI_MODEL || 'gemini-3.1-pro'),
    });
    logger.info('Gemini provider configured from environment');
  }
}
