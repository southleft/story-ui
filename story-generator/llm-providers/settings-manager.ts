/**
 * LLM Settings Manager
 *
 * Manages hybrid configuration for LLM provider/model selection.
 * Combines environment variables (DevOps guardrails) with user preferences.
 *
 * Environment Variables:
 * - DEFAULT_PROVIDER: Default provider (claude, openai, gemini)
 * - DEFAULT_MODEL: Default model ID
 * - ALLOWED_MODELS: Comma-separated list of allowed model IDs (optional)
 * - ALLOWED_PROVIDERS: Comma-separated list of allowed providers (optional)
 * - SINGLE_PROVIDER_MODE: Hide provider selection (true/false)
 */

import { ProviderType, ModelInfo, LLMProvider } from './types.js';
import { getProviderRegistry } from './index.js';
import { logger } from '../logger.js';

export interface UserSettings {
  selectedProvider?: ProviderType;
  selectedModel?: string;
  // Additional UI preferences can be added here
}

export interface SettingsConfig {
  defaultProvider: ProviderType;
  defaultModel: string;
  allowedProviders: ProviderType[];
  allowedModels: string[];
  singleProviderMode: boolean;
}

export interface AvailableOption {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  isRecommended?: boolean;
}

export interface SettingsResponse {
  providers: AvailableOption[];
  models: AvailableOption[];
  currentProvider: ProviderType;
  currentModel: string;
  config: {
    singleProviderMode: boolean;
    hasRestrictions: boolean;
  };
}

/**
 * Load settings configuration from environment
 */
export function loadSettingsConfig(): SettingsConfig {
  const defaultProvider = (process.env.DEFAULT_PROVIDER as ProviderType) || 'claude';
  const defaultModel = process.env.DEFAULT_MODEL || 'claude-sonnet-4-5-20250929';

  // Parse allowed providers
  const allowedProvidersEnv = process.env.ALLOWED_PROVIDERS;
  const allowedProviders: ProviderType[] = allowedProvidersEnv
    ? (allowedProvidersEnv.split(',').map(p => p.trim()) as ProviderType[])
    : ['claude', 'openai', 'gemini']; // All providers allowed by default

  // Parse allowed models
  const allowedModelsEnv = process.env.ALLOWED_MODELS;
  const allowedModels: string[] = allowedModelsEnv
    ? allowedModelsEnv.split(',').map(m => m.trim())
    : []; // Empty means all models allowed

  // Single provider mode
  const singleProviderMode = process.env.SINGLE_PROVIDER_MODE === 'true';

  return {
    defaultProvider,
    defaultModel,
    allowedProviders,
    allowedModels,
    singleProviderMode,
  };
}

/**
 * Get available providers for UI selection
 */
export function getAvailableProviders(config: SettingsConfig): AvailableOption[] {
  const registry = getProviderRegistry();
  const configuredProviders = registry.getConfiguredProviders();

  // Filter to only configured and allowed providers
  const available = configuredProviders.filter(
    (provider: LLMProvider) => config.allowedProviders.includes(provider.type)
  );

  const providerNames: Record<ProviderType, string> = {
    claude: 'Anthropic Claude',
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    ollama: 'Ollama (Local)',
    custom: 'Custom Provider',
  };

  const recommendedProviders: ProviderType[] = ['claude', 'openai', 'gemini'];

  return available.map((provider: LLMProvider) => ({
    id: provider.type,
    name: providerNames[provider.type] || provider.type,
    isDefault: provider.type === config.defaultProvider,
    isRecommended: recommendedProviders.includes(provider.type),
  }));
}

/**
 * Get available models for a provider
 */
export function getAvailableModels(
  provider: ProviderType,
  config: SettingsConfig
): AvailableOption[] {
  const registry = getProviderRegistry();
  const providerInstance = registry.get(provider);

  if (!providerInstance) {
    return [];
  }

  const allModels = providerInstance.supportedModels;

  // Filter to allowed models if restrictions are set
  const filteredModels = config.allowedModels.length > 0
    ? allModels.filter((model: ModelInfo) => config.allowedModels.includes(model.id))
    : allModels;

  // Mark recommended models based on capabilities
  const recommendedModels = [
    // Claude
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-5-20251101',
    // OpenAI
    'gpt-5.1',
    'gpt-4o',
    // Gemini
    'gemini-3-pro',
    'gemini-2.0-flash',
  ];

  return filteredModels.map((model: ModelInfo) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    isDefault: model.id === config.defaultModel,
    isRecommended: recommendedModels.includes(model.id),
  }));
}

/**
 * Validate user's model selection against configuration
 */
export function validateSelection(
  provider: ProviderType,
  model: string,
  config: SettingsConfig
): { valid: boolean; error?: string } {
  // Check provider is allowed
  if (!config.allowedProviders.includes(provider)) {
    return {
      valid: false,
      error: `Provider "${provider}" is not allowed. Available: ${config.allowedProviders.join(', ')}`,
    };
  }

  // Check model is allowed (if restrictions set)
  if (config.allowedModels.length > 0 && !config.allowedModels.includes(model)) {
    return {
      valid: false,
      error: `Model "${model}" is not allowed. Please select from available models.`,
    };
  }

  // Check provider is configured
  const registry = getProviderRegistry();
  const providerInstance = registry.get(provider);
  if (!providerInstance || !providerInstance.isConfigured()) {
    return {
      valid: false,
      error: `Provider "${provider}" is not configured. API key may be missing.`,
    };
  }

  return { valid: true };
}

/**
 * Get complete settings response for UI
 */
export function getSettingsForUI(
  currentProvider?: ProviderType,
  currentModel?: string
): SettingsResponse {
  const config = loadSettingsConfig();

  // Use current or default
  const provider = currentProvider || config.defaultProvider;
  const model = currentModel || config.defaultModel;

  const providers = config.singleProviderMode
    ? [] // Hide provider selection
    : getAvailableProviders(config);

  const models = getAvailableModels(provider, config);

  return {
    providers,
    models,
    currentProvider: provider,
    currentModel: model,
    config: {
      singleProviderMode: config.singleProviderMode,
      hasRestrictions: config.allowedModels.length > 0,
    },
  };
}

/**
 * Apply user settings and return effective provider/model
 */
export function applyUserSettings(settings: UserSettings): {
  provider: ProviderType;
  model: string;
  applied: boolean;
  fallbackReason?: string;
} {
  const config = loadSettingsConfig();

  let provider = settings.selectedProvider || config.defaultProvider;
  let model = settings.selectedModel || config.defaultModel;
  let applied = true;
  let fallbackReason: string | undefined;

  // Validate and fallback if needed
  const validation = validateSelection(provider, model, config);
  if (!validation.valid) {
    logger.warn('User settings invalid, using defaults', {
      requested: { provider, model },
      error: validation.error,
    });

    provider = config.defaultProvider;
    model = config.defaultModel;
    applied = false;
    fallbackReason = validation.error;
  }

  return { provider, model, applied, fallbackReason };
}
