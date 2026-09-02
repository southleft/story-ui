/**
 * Story LLM Service
 *
 * Service layer that provides LLM functionality specifically for story generation.
 * Wraps the provider system to maintain backwards compatibility while enabling
 * multi-provider support.
 */

import {
  smallModelFor,
  getProviderRegistry,
  initializeFromEnv,
  resolveModelAlias,
  ChatMessage,
  ChatResponse,
  LLMProvider,
  ProviderType,
  ImageContent,
  MessageContent,
  StreamFinishReason,
} from './index.js';
import { logger } from '../logger.js';

/**
 * Result of a chat completion including metadata callers need to detect
 * truncation and account for token usage.
 */
export interface ChatCompletionResult {
  content: string;
  finishReason: ChatResponse['finishReason'];
  usage?: ChatResponse['usage'];
  provider: string;
  model: string;
  /** True when the model stopped because it hit the output token limit. */
  truncated: boolean;
}

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

  // Honor the operator-configured default provider first.
  const envDefault = process.env.DEFAULT_PROVIDER as ProviderType | undefined;
  if (envDefault) {
    const provider = registry.get(envDefault);
    if (provider?.isConfigured()) {
      return provider;
    }
  }

  // Then the registry default (set via the providers API).
  const defaultProvider = registry.getDefault();
  if (defaultProvider?.isConfigured()) {
    return defaultProvider;
  }

  // Then any configured provider.
  const configured = registry.getConfiguredProviders();
  if (configured.length > 0) {
    return configured[0];
  }

  // Fall back to the (unconfigured) default so callers get a useful error.
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
  const result = await chatCompletionDetailed(messages, options);
  return result.content;
}

/**
 * What a completed stream reports beyond the text the caller already saw.
 * Same field names as the buffered path's ChatCompletionResult so a call site
 * can swap between them; `finishReason` is optional because a stream can end
 * without the provider ever saying why.
 */
export interface ChatStreamResult {
  /** The whole reply — the concatenation of every delta. */
  content: string;
  /**
   * Undefined when the provider never reported a stop reason (a stream cut
   * mid-flight), so "unknown" and "stopped cleanly" are distinguishable.
   */
  finishReason?: StreamFinishReason;
  usage?: ChatResponse['usage'];
  provider: string;
  model: string;
  /** True only when the provider REPORTED hitting its output ceiling. */
  truncated: boolean;
}

export interface ChatStreamOptions {
  provider?: ProviderType;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Caller-side abort (e.g. a phase budget) — cancels the in-flight HTTP call. */
  signal?: AbortSignal;
  /** Send the system prompt as a cacheable block (default true; Claude only). */
  cacheSystemPrompt?: boolean;
  /** Summarised reasoning as it streams (Claude, streaming only). Narration, not content. */
  onThinking?: (delta: string) => void;
}

/**
 * Streaming chat completion — yields text deltas as the model generates them,
 * and RETURNS the stop reason and usage when the stream ends. A plain
 * `for await` sees only the deltas (the Voice Canvas path); call `.next()`
 * yourself, or use chatCompletionStreamDetailed, to read the result.
 *
 * Throws on stream errors; callers should surface them to the user.
 */
export async function* chatCompletionStream(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  options?: ChatStreamOptions
): AsyncGenerator<string, ChatStreamResult> {
  ensureInitialized();

  let provider: LLMProvider;
  if (options?.provider) {
    const registry = getProviderRegistry();
    const requestedProvider = registry.get(options.provider);
    provider = requestedProvider?.isConfigured() ? requestedProvider : getStoryProvider();
  } else {
    provider = getStoryProvider();
  }
  if (!provider.isConfigured()) {
    throw new Error(`${provider.name} provider is not configured. Please set the API key.`);
  }

  const systemMessages = messages.filter(msg => msg.role === 'system');
  const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
  const systemPrompt = systemMessages.map(msg => msg.content).join('\n\n') || undefined;

  const chatMessages: ChatMessage[] = nonSystemMessages.map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  const model = options?.model ? resolveModelAlias(options.model) : undefined;
  const chatOptions = {
    model,
    maxTokens: options?.maxTokens,
    temperature: options?.temperature,
    systemPrompt,
    signal: options?.signal,
    cacheSystemPrompt: options?.cacheSystemPrompt,
  };

  if (!provider.chatStream) {
    // Provider without streaming support — degrade to a single final chunk.
    const result = await provider.chat(chatMessages, chatOptions);
    yield result.content;
    return {
      content: result.content,
      finishReason: result.finishReason,
      usage: result.usage,
      provider: provider.name,
      model: result.model,
      truncated: result.finishReason === 'length',
    };
  }

  let content = '';
  let finishReason: StreamFinishReason | undefined;
  let usage: ChatResponse['usage'] | undefined;
  let servedModel: string | undefined;

  for await (const chunk of provider.chatStream(chatMessages, chatOptions)) {
    if (chunk.type === 'text' && chunk.content) {
      content += chunk.content;
      yield chunk.content;
    } else if (chunk.type === 'thinking' && chunk.content) {
      options?.onThinking?.(chunk.content);
    } else if (chunk.type === 'done') {
      finishReason = chunk.finishReason;
      usage = chunk.usage;
      servedModel = chunk.model;
    } else if (chunk.type === 'error') {
      throw new Error(chunk.error || 'LLM stream error');
    }
  }

  if (finishReason === 'length') {
    logger.warn('LLM stream was truncated at the output token limit', {
      provider: provider.name,
      model: servedModel || model || provider.getConfig().model,
      maxTokens: options?.maxTokens,
    });
  }

  return {
    content,
    finishReason,
    usage,
    provider: provider.name,
    model: servedModel || model || provider.getConfig().model,
    truncated: finishReason === 'length',
  };
}

/**
 * The streaming path with the result handed back as a value: every delta goes
 * to `onDelta` as it arrives, and the promise resolves with the full text,
 * the provider's stop reason and usage. This is the shape a generation loop
 * wants — the buffered path's answer, plus evidence of life along the way.
 */
export async function chatCompletionStreamDetailed(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  options?: ChatStreamOptions,
  onDelta?: (delta: string, accumulated: string) => void,
): Promise<ChatStreamResult> {
  const stream = chatCompletionStream(messages, options);
  let accumulated = '';
  while (true) {
    const next = await stream.next();
    if (next.done) return next.value;
    accumulated += next.value;
    onDelta?.(next.value, accumulated);
  }
}

/**
 * Chat completion that also returns finish reason and token usage so callers
 * can detect truncation and track cost. Prefer this over chatCompletion for
 * generation pipelines.
 */
export async function chatCompletionDetailed(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  options?: {
    provider?: ProviderType;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** Caller-side abort (e.g. a phase budget) — cancels the in-flight HTTP call. */
    signal?: AbortSignal;
  }
): Promise<ChatCompletionResult> {
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

  const model = options?.model ? resolveModelAlias(options.model) : undefined;

  logger.debug('Sending chat request to provider', {
    provider: provider.name,
    model: model || provider.getConfig().model,
    messageCount: chatMessages.length,
    hasSystemPrompt: !!systemPrompt,
  });

  try {
    const response = await provider.chat(chatMessages, {
      model,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      systemPrompt,
      signal: options?.signal,
    });

    if (response.finishReason === 'length') {
      logger.warn('LLM response was truncated at the output token limit', {
        provider: provider.name,
        model: model || provider.getConfig().model,
        maxTokens: options?.maxTokens,
      });
    }

    return {
      content: response.content,
      finishReason: response.finishReason,
      usage: response.usage,
      provider: provider.name,
      model: response.model,
      truncated: response.finishReason === 'length',
    };
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
  const result = await chatCompletionWithImagesDetailed(messages, options);
  return result.content;
}

/**
 * Vision chat completion that also returns finish reason and token usage so
 * callers can detect truncation — image-referenced compositions are exactly
 * the ones large enough to hit the output limit. Prefer this over
 * chatCompletionWithImages for generation pipelines.
 */
export async function chatCompletionWithImagesDetailed(
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | MessageContent[];
  }>,
  options?: {
    provider?: ProviderType;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** Caller-side abort (e.g. a phase budget) — cancels the in-flight HTTP call. */
    signal?: AbortSignal;
  }
): Promise<ChatCompletionResult> {
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

  const model = options?.model ? resolveModelAlias(options.model) : undefined;

  logger.debug('Sending chat request with images to provider', {
    provider: provider.name,
    model: model || provider.getConfig().model,
    messageCount: messages.length,
    hasImages,
  });

  try {
    const response = await provider.chat(chatMessages, {
      model,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      signal: options?.signal,
    });

    if (response.finishReason === 'length') {
      logger.warn('LLM vision response was truncated at the output token limit', {
        provider: provider.name,
        model: model || provider.getConfig().model,
        maxTokens: options?.maxTokens,
      });
    }

    return {
      content: response.content,
      finishReason: response.finishReason,
      usage: response.usage,
      provider: provider.name,
      model: response.model,
      truncated: response.finishReason === 'length',
    };
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
export async function generateTitle(description: string, provider?: ProviderType): Promise<string> {
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

  // A title is not worth the generation model's price.
  const response = await chatCompletion([{ role: 'user', content: titlePrompt }], {
    provider,
    model: smallModelFor(provider),
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
 * Get provider information for UI display.
 *
 * Pass the provider/model the request actually asked for — otherwise the
 * answer describes the *default* provider, which is a different question.
 * Vision capability is per-model, so a capability check against the default
 * model can both wrongly reject a vision request and wrongly allow one.
 */
export function getProviderInfo(requested?: {
  provider?: ProviderType;
  model?: string;
}): {
  currentProvider: string;
  currentModel: string;
  supportsVision: boolean;
  supportsStreaming: boolean;
  /** The model's real output ceiling, so callers stop hardcoding one. */
  maxOutputTokens?: number;
} {
  try {
    let provider: LLMProvider | undefined;

    if (requested?.provider) {
      const candidate = getProviderRegistry().get(requested.provider);
      if (candidate?.isConfigured()) provider = candidate;
    }
    if (!provider) provider = getStoryProvider();

    // Resolve capabilities against the requested model when one was named,
    // falling back to whatever the provider is configured with.
    const modelId = requested?.model || provider.getConfig().model;
    const modelInfo = provider.supportedModels.find(m => m.id === modelId);

    return {
      currentProvider: provider.name,
      currentModel: modelId,
      supportsVision: modelInfo ? modelInfo.supportsVision : provider.supportsVision(),
      supportsStreaming: modelInfo ? modelInfo.supportsStreaming : provider.supportsStreaming(),
      maxOutputTokens: modelInfo?.maxOutputTokens,
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
