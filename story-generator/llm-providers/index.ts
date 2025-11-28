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
export { ClaudeProvider, createClaudeProvider } from './claude-provider.js';
export { OpenAIProvider, createOpenAIProvider } from './openai-provider.js';
export { GeminiProvider, createGeminiProvider } from './gemini-provider.js';

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
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    });
    logger.info('Claude provider configured from environment');
  }

  // Configure OpenAI if API key is present
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    registry.configureProvider('openai', {
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      organizationId: process.env.OPENAI_ORG_ID,
    });
    logger.info('OpenAI provider configured from environment');
  }

  // Configure Gemini if API key is present
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    registry.configureProvider('gemini', {
      apiKey: geminiKey,
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    });
    logger.info('Gemini provider configured from environment');
  }
}
