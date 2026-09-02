/**
 * LLM Provider Types and Interfaces
 *
 * This module defines the abstraction layer for multiple LLM providers.
 * Providers like Claude, OpenAI, Gemini, and local models (Ollama) can
 * implement this interface to provide a unified API.
 */

// Message types for conversation history
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContent[];
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    mediaType?: string; // e.g., 'image/png', 'image/jpeg'
    data?: string; // base64 encoded data
    url?: string; // URL for remote images
  };
}

export interface DocumentContent {
  type: 'document';
  source: {
    type: 'base64' | 'url';
    mediaType: string; // e.g., 'application/pdf'
    data?: string;
    url?: string;
    name?: string; // Original filename
  };
}

export type MessageContent = TextContent | ImageContent | DocumentContent;

// Model information
export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderType;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsDocuments: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  supportsReasoning?: boolean; // Native reasoning/thinking capability (GPT-5.1, Gemini 3, o1)
  inputPricePer1kTokens?: number;
  outputPricePer1kTokens?: number;
  description?: string; // Human-readable description for UI
}

// Provider types
export type ProviderType = 'claude' | 'openai' | 'gemini' | 'ollama' | 'custom';

// Provider configuration
export interface ProviderConfig {
  provider: ProviderType;
  apiKey?: string;
  model: string;
  baseUrl?: string; // For custom endpoints or proxies
  organizationId?: string; // For OpenAI
  projectId?: string; // For GCP/Gemini
  timeout?: number; // Request timeout in ms
}

// Chat request options
export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  systemPrompt?: string;
  /**
   * Send the system prompt as a cacheable block so the static prefix of a
   * prompt is read from the provider's prompt cache on repeat calls instead
   * of being re-billed in full. Defaults to true. Only Claude acts on it
   * today; other providers ignore it.
   */
  cacheSystemPrompt?: boolean;
  /** Reasoning effort for models that take one: low | medium | high | xhigh | max. */
  effort?: string;
  /**
   * Wall-clock budget for a buffered (non-streaming) call, in ms. The
   * provider's configured timeout applies when absent. Vision turns need
   * more than the 120s default: a full-page composition from a screenshot
   * on Opus 5 timed out on it every time.
   */
  timeoutMs?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  /**
   * Caller-side abort — e.g. a verification-phase budget cancelling an
   * in-flight repair call. Combined with the provider's own wall-clock
   * timeout; an abort is never retried.
   */
  signal?: AbortSignal;
}

// Tool/Function calling support
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// Chat response
export interface ChatResponse {
  id: string;
  model: string;
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Prompt tokens served from the provider's prompt cache (Claude). */
    cacheReadInputTokens?: number;
    /** Prompt tokens written to the provider's prompt cache on this call (Claude). */
    cacheCreationInputTokens?: number;
  };
  toolCalls?: ToolCall[];
  raw?: any; // Original response from provider
}

/**
 * Why a stream ended, normalised across providers. The named members are the
 * ones callers branch on ('length' is the truncation signal); the open string
 * lets a provider pass through a value this union has not learned yet rather
 * than mislabel it as a clean stop.
 */
export type StreamFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_use'
  | 'tool_calls'
  | 'error'
  | (string & {});

// Streaming response
export interface StreamChunk {
  type: 'text' | 'thinking' | 'tool_call' | 'error' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
  usage?: ChatResponse['usage'];
  /**
   * On the 'done' chunk only: the provider's stop reason. Left undefined when
   * the stream ended without the provider ever saying why (a cut connection),
   * so "absent" and "stopped cleanly" never look the same to a caller.
   */
  finishReason?: StreamFinishReason;
  /** On the 'done' chunk: the model that actually served the request. */
  model?: string;
}

// Image analysis response
export interface ImageAnalysis {
  description: string;
  components?: string[];
  layout?: string;
  colors?: string[];
  suggestions?: string[];
}

// Provider validation result
export interface ValidationResult {
  valid: boolean;
  error?: string;
  models?: ModelInfo[];
}

/**
 * LLM Provider Interface
 *
 * All LLM providers must implement this interface.
 */
export interface LLMProvider {
  // Provider information
  readonly name: string;
  readonly type: ProviderType;
  readonly supportedModels: ModelInfo[];

  // Capability checks
  supportsVision(): boolean;
  supportsDocuments(): boolean;
  supportsFunctionCalling(): boolean;
  supportsStreaming(): boolean;

  // Configuration
  configure(config: ProviderConfig): void;
  getConfig(): ProviderConfig;

  // Validation
  validateApiKey(apiKey: string): Promise<ValidationResult>;
  isConfigured(): boolean;

  // Core methods
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream?(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamChunk>;

  // Multimodal methods
  analyzeImage?(image: ImageContent, prompt?: string): Promise<ImageAnalysis>;

  // Token counting (estimate)
  estimateTokens?(text: string): number;
}

/**
 * Provider Registry
 *
 * Manages available providers and their configurations.
 */
export interface ProviderRegistry {
  // Register a provider
  register(provider: LLMProvider): void;

  // Get a provider by type
  get(type: ProviderType): LLMProvider | undefined;

  // Get all registered providers
  getAll(): LLMProvider[];

  // Get available models across all providers
  getAvailableModels(): ModelInfo[];

  // Get default provider
  getDefault(): LLMProvider | undefined;

  // Set default provider
  setDefault(type: ProviderType): void;
}

/**
 * Provider Factory Function Type
 */
export type ProviderFactory = (config?: Partial<ProviderConfig>) => LLMProvider;
