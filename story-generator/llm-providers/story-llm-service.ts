/**
 * Story LLM Service
 *
 * Service layer that provides LLM functionality specifically for story generation.
 * Wraps the provider system to maintain backwards compatibility while enabling
 * multi-provider support.
 */

import {
  getProviderRegistry,
  initializeFromEnv,
  ChatMessage,
  ChatResponse,
  LLMProvider,
  ProviderType,
  ImageContent,
  MessageContent,
} from './index.js';
import { logger } from '../logger.js';

// Initialize providers from environment on module load
let initialized = false;

function ensureInitialized(): void {
  if (!initialized) {
    initializeFromEnv();
    initialized = true;
  }
}

/**
 * Get the currently configured provider for story generation
 */
export function getStoryProvider(): LLMProvider {
  ensureInitialized();
  const registry = getProviderRegistry();

  // First try to get a configured provider
  const configured = registry.getConfiguredProviders();
  if (configured.length > 0) {
    return configured[0];
  }

  // Fall back to default provider (may not be configured)
  const defaultProvider = registry.getDefault();
  if (defaultProvider) {
    return defaultProvider;
  }

  throw new Error('No LLM provider configured. Please set CLAUDE_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
}

/**
 * Check if any provider is configured and ready
 */
export function isProviderConfigured(): boolean {
  ensureInitialized();
  return getProviderRegistry().hasConfiguredProvider();
}

/**
 * Get available providers with their configuration status
 */
export function getAvailableProviders(): Array<{
  type: ProviderType;
  name: string;
  configured: boolean;
  models: string[];
}> {
  ensureInitialized();
  return getProviderRegistry().getAll().map(provider => ({
    type: provider.type,
    name: provider.name,
    configured: provider.isConfigured(),
    models: provider.supportedModels.map(m => m.id),
  }));
}

/**
 * Simple chat completion for story generation
 * Maintains backwards compatibility with the old callClaude interface
 * Now supports explicit provider selection from UI
 */
export async function chatCompletion(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  options?: {
    provider?: ProviderType;  // Explicit provider selection from UI
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  ensureInitialized();

  // Use explicitly requested provider, or fall back to first configured
  let provider: LLMProvider;
  if (options?.provider) {
    const registry = getProviderRegistry();
    const requestedProvider = registry.get(options.provider);
    if (requestedProvider && requestedProvider.isConfigured()) {
      provider = requestedProvider;
      logger.log(`🎯 Using explicitly requested provider: ${provider.name}`);
    } else {
      logger.warn(`Requested provider '${options.provider}' not configured, falling back to default`);
      provider = getStoryProvider();
    }
  } else {
    provider = getStoryProvider();
  }

  if (!provider.isConfigured()) {
    throw new Error(`${provider.name} provider is not configured. Please set the API key.`);
  }

  // Extract system messages and convert to systemPrompt option
  // This ensures proper handling across all providers
  const systemMessages = messages.filter(msg => msg.role === 'system');
  const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
  const systemPrompt = systemMessages.map(msg => msg.content).join('\n\n') || undefined;

  const chatMessages: ChatMessage[] = nonSystemMessages.map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  logger.debug('Sending chat request to provider', {
    provider: provider.name,
    model: options?.model || provider.getConfig().model,
    messageCount: chatMessages.length,
    hasSystemPrompt: !!systemPrompt,
  });

  try {
    const response = await provider.chat(chatMessages, {
      model: options?.model,
      maxTokens: options?.maxTokens || 8192,
      temperature: options?.temperature,
      systemPrompt,
    });

    return response.content;
  } catch (error) {
    logger.error('LLM chat completion failed', {
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Chat completion with image support for vision-based story generation
 * Supports sending images alongside text prompts
 * Now supports explicit provider selection from UI
 */
export async function chatCompletionWithImages(
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | MessageContent[];
  }>,
  options?: {
    provider?: ProviderType;  // Explicit provider selection from UI
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  ensureInitialized();

  // Use explicitly requested provider, or fall back to first configured
  let provider: LLMProvider;
  if (options?.provider) {
    const registry = getProviderRegistry();
    const requestedProvider = registry.get(options.provider);
    if (requestedProvider && requestedProvider.isConfigured()) {
      provider = requestedProvider;
      logger.log(`🎯 Using explicitly requested provider for vision: ${provider.name}`);
    } else {
      logger.warn(`Requested provider '${options.provider}' not configured, falling back to default`);
      provider = getStoryProvider();
    }
  } else {
    provider = getStoryProvider();
  }

  if (!provider.isConfigured()) {
    throw new Error(`${provider.name} provider is not configured. Please set the API key.`);
  }

  // Check if images are included and provider supports vision
  const hasImages = messages.some(msg =>
    Array.isArray(msg.content) && msg.content.some(c => c.type === 'image')
  );

  if (hasImages && !provider.supportsVision()) {
    throw new Error(`${provider.name} does not support vision/image analysis. Please use a vision-capable model.`);
  }

  const chatMessages: ChatMessage[] = messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  logger.debug('Sending chat request with images to provider', {
    provider: provider.name,
    model: options?.model || provider.getConfig().model,
    messageCount: messages.length,
    hasImages,
  });

  try {
    const response = await provider.chat(chatMessages, {
      model: options?.model,
      maxTokens: options?.maxTokens || 8192,
      temperature: options?.temperature,
    });

    return response.content;
  } catch (error) {
    logger.error('LLM chat completion with images failed', {
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Build a message content array with text and images
 * Helper function for constructing vision requests
 */
export function buildMessageWithImages(
  text: string,
  images: ImageContent[]
): MessageContent[] {
  const content: MessageContent[] = [];

  // Add images first so the model sees them before the text instructions
  for (const image of images) {
    content.push(image);
  }

  // Add the text prompt
  content.push({
    type: 'text',
    text,
  });

  return content;
}

/**
 * Generate a title for a story using the configured provider
 */
export async function generateTitle(description: string): Promise<string> {
  const titlePrompt = [
    'Given the following UI description, generate a short, clear, human-friendly title suitable for a Storybook navigation item.',
    'Requirements:',
    '- Do not include words like "Generate", "Build", or "Create"',
    '- Keep it under 50 characters',
    '- Use simple, clear language',
    '- Avoid special characters that could break code (use letters, numbers, spaces, hyphens, and basic punctuation only)',
    '',
    'UI description:',
    description,
    '',
    'Title:',
  ].join('\n');

  const response = await chatCompletion([{ role: 'user', content: titlePrompt }], {
    maxTokens: 100,
    temperature: 0.7,
  });

  // Extract the first non-empty line
  const lines = response.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    let title = lines[0].replace(/^['\"]|['\"]$/g, '').trim();
    // Sanitize
    title = title
      .replace(/[^\w\s'"?!-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50);
    return title;
  }

  return '';
}

/**
 * Get provider information for UI display
 */
export function getProviderInfo(): {
  currentProvider: string;
  currentModel: string;
  supportsVision: boolean;
  supportsStreaming: boolean;
} {
  try {
    const provider = getStoryProvider();
    return {
      currentProvider: provider.name,
      currentModel: provider.getConfig().model,
      supportsVision: provider.supportsVision(),
      supportsStreaming: provider.supportsStreaming(),
    };
  } catch {
    return {
      currentProvider: 'None',
      currentModel: 'None',
      supportsVision: false,
      supportsStreaming: false,
    };
  }
}

/**
 * Configure a specific provider with API key
 */
export function configureProvider(
  type: ProviderType,
  apiKey: string,
  model?: string
): boolean {
  ensureInitialized();
  const registry = getProviderRegistry();
  const provider = registry.get(type);

  if (!provider) {
    logger.error(`Unknown provider type: ${type}`);
    return false;
  }

  registry.configureProvider(type, {
    apiKey,
    model: model || provider.supportedModels[0]?.id,
  });

  logger.info(`Configured ${type} provider`, { model: model || 'default' });
  return true;
}

/**
 * Validate an API key for a provider
 */
export async function validateProviderKey(
  type: ProviderType,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  ensureInitialized();
  const registry = getProviderRegistry();
  const provider = registry.get(type);

  if (!provider) {
    return { valid: false, error: `Unknown provider type: ${type}` };
  }

  const result = await provider.validateApiKey(apiKey);
  return { valid: result.valid, error: result.error };
}
