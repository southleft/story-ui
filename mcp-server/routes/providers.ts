/**
 * LLM Provider Management Routes
 *
 * API endpoints for managing LLM providers, API keys, and model selection.
 */

import { Request, Response } from 'express';
import {
  getProviderRegistry,
  ProviderType,
  ModelInfo,
} from '../../story-generator/llm-providers/index.js';
import {
  getAvailableProviders,
  getProviderInfo,
  configureProvider,
  validateProviderKey,
} from '../../story-generator/llm-providers/story-llm-service.js';
import {
  getSettingsForUI,
  applyUserSettings,
  loadSettingsConfig,
  validateSelection,
} from '../../story-generator/llm-providers/settings-manager.js';
import { logger } from '../../story-generator/logger.js';

/**
 * GET /mcp/providers
 * Returns list of available providers and their configuration status
 */
export function getProviders(req: Request, res: Response) {
  try {
    const providers = getAvailableProviders();
    const currentInfo = getProviderInfo();

    res.json({
      providers,
      current: {
        provider: currentInfo.currentProvider,
        model: currentInfo.currentModel,
        supportsVision: currentInfo.supportsVision,
        supportsStreaming: currentInfo.supportsStreaming,
      },
    });
  } catch (error) {
    logger.error('Error fetching providers', { error });
    res.status(500).json({
      error: 'Failed to fetch providers',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /mcp/providers/models
 * Returns all available models across all providers
 */
export function getModels(req: Request, res: Response) {
  try {
    const registry = getProviderRegistry();
    const models = registry.getAvailableModels();

    // Group models by provider for easier display
    const groupedModels: Record<string, ModelInfo[]> = {};
    for (const model of models) {
      const provider = model.provider;
      if (!groupedModels[provider]) {
        groupedModels[provider] = [];
      }
      groupedModels[provider].push(model);
    }

    res.json({
      models,
      grouped: groupedModels,
    });
  } catch (error) {
    logger.error('Error fetching models', { error });
    res.status(500).json({
      error: 'Failed to fetch models',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /mcp/providers/configure
 * Configure a provider with API key and optional model
 *
 * Body: {
 *   provider: 'claude' | 'openai' | 'gemini',
 *   apiKey: string,
 *   model?: string,
 *   setAsDefault?: boolean
 * }
 */
export async function configureProviderRoute(req: Request, res: Response) {
  try {
    const { provider, apiKey, model, setAsDefault } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Provider type is required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const validProviders: ProviderType[] = ['claude', 'openai', 'gemini', 'ollama', 'custom'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        error: 'Invalid provider type',
        validProviders,
      });
    }

    // Configure the provider
    const success = configureProvider(provider, apiKey, model);

    if (!success) {
      return res.status(500).json({ error: 'Failed to configure provider' });
    }

    // Set as default if requested
    if (setAsDefault) {
      const registry = getProviderRegistry();
      registry.setDefault(provider);
    }

    const currentInfo = getProviderInfo();

    res.json({
      success: true,
      message: `${provider} provider configured successfully`,
      current: {
        provider: currentInfo.currentProvider,
        model: currentInfo.currentModel,
      },
    });
  } catch (error) {
    logger.error('Error configuring provider', { error });
    res.status(500).json({
      error: 'Failed to configure provider',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /mcp/providers/validate
 * Validate an API key for a provider without saving it
 *
 * Body: {
 *   provider: 'claude' | 'openai' | 'gemini',
 *   apiKey: string
 * }
 */
export async function validateApiKey(req: Request, res: Response) {
  try {
    const { provider, apiKey } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Provider type is required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const validProviders: ProviderType[] = ['claude', 'openai', 'gemini'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        error: 'Invalid provider type',
        validProviders,
      });
    }

    const result = await validateProviderKey(provider, apiKey);

    res.json({
      valid: result.valid,
      error: result.error,
      provider,
    });
  } catch (error) {
    logger.error('Error validating API key', { error });
    res.status(500).json({
      error: 'Failed to validate API key',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /mcp/providers/default
 * Set the default provider
 *
 * Body: {
 *   provider: 'claude' | 'openai' | 'gemini'
 * }
 */
export function setDefaultProvider(req: Request, res: Response) {
  try {
    const { provider } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Provider type is required' });
    }

    const registry = getProviderRegistry();
    const providerInstance = registry.get(provider);

    if (!providerInstance) {
      return res.status(400).json({ error: `Provider '${provider}' not found` });
    }

    if (!providerInstance.isConfigured()) {
      return res.status(400).json({
        error: `Provider '${provider}' is not configured. Please set an API key first.`,
      });
    }

    registry.setDefault(provider);

    const currentInfo = getProviderInfo();

    res.json({
      success: true,
      message: `Default provider set to ${provider}`,
      current: {
        provider: currentInfo.currentProvider,
        model: currentInfo.currentModel,
      },
    });
  } catch (error) {
    logger.error('Error setting default provider', { error });
    res.status(500).json({
      error: 'Failed to set default provider',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /mcp/providers/model
 * Set the model for a provider
 *
 * Body: {
 *   provider?: 'claude' | 'openai' | 'gemini',  // defaults to current provider
 *   model: string
 * }
 */
export function setModel(req: Request, res: Response) {
  try {
    const { provider, model } = req.body;

    if (!model) {
      return res.status(400).json({ error: 'Model is required' });
    }

    const registry = getProviderRegistry();

    // If provider specified, use that; otherwise use default
    const targetProvider = provider
      ? registry.get(provider)
      : registry.getDefault();

    if (!targetProvider) {
      return res.status(400).json({
        error: provider ? `Provider '${provider}' not found` : 'No default provider configured',
      });
    }

    // Validate model is supported
    const supportedModels = targetProvider.supportedModels;
    const modelInfo = supportedModels.find(m => m.id === model);

    if (!modelInfo) {
      return res.status(400).json({
        error: `Model '${model}' is not supported by ${targetProvider.name}`,
        supportedModels: supportedModels.map(m => m.id),
      });
    }

    // Update the provider's model
    const currentConfig = targetProvider.getConfig();
    targetProvider.configure({
      ...currentConfig,
      model,
    });

    const currentInfo = getProviderInfo();

    res.json({
      success: true,
      message: `Model set to ${model}`,
      current: {
        provider: currentInfo.currentProvider,
        model: currentInfo.currentModel,
      },
    });
  } catch (error) {
    logger.error('Error setting model', { error });
    res.status(500).json({
      error: 'Failed to set model',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /mcp/providers/settings
 * Get UI settings configuration with available providers/models
 *
 * This endpoint is designed for non-technical users to select
 * from pre-approved providers and models configured by DevOps.
 *
 * Query params:
 *   provider?: current selected provider
 *   model?: current selected model
 */
export function getUISettings(req: Request, res: Response) {
  try {
    const currentProvider = req.query.provider as ProviderType | undefined;
    const currentModel = req.query.model as string | undefined;

    const settings = getSettingsForUI(currentProvider, currentModel);

    res.json({
      success: true,
      ...settings,
    });
  } catch (error) {
    logger.error('Error fetching UI settings', { error });
    res.status(500).json({
      error: 'Failed to fetch settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /mcp/providers/settings
 * Apply user's provider/model selection
 *
 * Body: {
 *   provider?: 'claude' | 'openai' | 'gemini',
 *   model?: string
 * }
 *
 * Returns effective settings (may fall back to defaults if invalid)
 */
export function applyUISettings(req: Request, res: Response) {
  try {
    const { provider, model } = req.body;

    const result = applyUserSettings({
      selectedProvider: provider,
      selectedModel: model,
    });

    // If settings were applied, also update the actual provider config
    if (result.applied) {
      const registry = getProviderRegistry();

      // Set the default provider
      registry.setDefault(result.provider);

      // Update model for the provider
      const providerInstance = registry.get(result.provider);
      if (providerInstance) {
        const currentConfig = providerInstance.getConfig();
        providerInstance.configure({
          ...currentConfig,
          model: result.model,
        });
      }
    }

    res.json({
      success: true,
      applied: result.applied,
      provider: result.provider,
      model: result.model,
      fallbackReason: result.fallbackReason,
    });
  } catch (error) {
    logger.error('Error applying UI settings', { error });
    res.status(500).json({
      error: 'Failed to apply settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /mcp/providers/config
 * Get current environment configuration (for admin/debugging)
 *
 * This reveals which restrictions are in place.
 */
export function getSettingsConfig(req: Request, res: Response) {
  try {
    const config = loadSettingsConfig();

    res.json({
      success: true,
      config: {
        defaultProvider: config.defaultProvider,
        defaultModel: config.defaultModel,
        allowedProviders: config.allowedProviders,
        allowedModels: config.allowedModels.length > 0
          ? config.allowedModels
          : 'all', // Show 'all' if no restrictions
        singleProviderMode: config.singleProviderMode,
      },
    });
  } catch (error) {
    logger.error('Error fetching settings config', { error });
    res.status(500).json({
      error: 'Failed to fetch config',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
