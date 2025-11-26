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
  stream?: boolean;
  tools?: ToolDefinition[];
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
  };
  toolCalls?: ToolCall[];
  raw?: any; // Original response from provider
}

// Streaming response
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'error' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
  usage?: ChatResponse['usage'];
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
