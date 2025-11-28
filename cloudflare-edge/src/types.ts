/**
 * Story UI MCP Edge - Type Definitions
 */

export interface Env {
  // Durable Objects
  MCP_SESSIONS: DurableObjectNamespace;

  // Environment variables
  STORY_UI_VERSION: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEFAULT_LLM_PROVIDER?: string;
  DEFAULT_PROVIDER?: string;
  DEFAULT_MODEL?: string;
  DEFAULT_OPENAI_MODEL?: string;
  DEFAULT_GEMINI_MODEL?: string;
}

// JSON-RPC 2.0 Types
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// MCP Tool Types
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

// Session Types
export interface SessionData {
  id: string;
  createdAt: number;
  lastActive: number;
  clientInfo?: {
    name?: string;
    version?: string;
  };
}

// Story Types
export interface StoryMetadata {
  id: string;
  title: string;
  componentPath?: string;
  createdAt: number;
  framework?: string;
}

export interface Story extends StoryMetadata {
  content: string;
}

// Health Check Response
export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  version: string;
  transport: string;
  activeSessions: number;
  timestamp: string;
}
