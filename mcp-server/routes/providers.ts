/**
 * LLM provider routes.
 *
 * Read-only: which providers are configured and which models each offers.
 * Keys and the default model come from .env; nothing here writes them.
 */

import { Request, Response } from 'express';
import { getProviderRegistry, ModelInfo } from '../../story-generator/llm-providers/index.js';
import { getAvailableProviders, getProviderInfo } from '../../story-generator/llm-providers/story-llm-service.js';
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
