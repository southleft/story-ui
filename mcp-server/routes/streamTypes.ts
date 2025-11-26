/**
 * Stream Types for Two-Way Chat Communication
 *
 * These types define the event structure for Server-Sent Events (SSE)
 * that enable real-time feedback during story generation.
 */

// Event types for SSE stream
export type StreamEventType =
  | 'intent'           // Initial plan/intent before execution
  | 'progress'         // Step-by-step progress updates
  | 'validation'       // Validation results (errors, warnings)
  | 'retry'            // Retry attempt information
  | 'completion'       // Final completion with details
  | 'error';           // Error event

// Intent preview - what the AI plans to do
export interface IntentPreview {
  requestType: 'new' | 'modification';
  framework: string;
  detectedDesignSystem: string | null;
  strategy: string;
  estimatedComponents: string[];
  promptAnalysis: {
    hasVisionInput: boolean;
    hasConversationContext: boolean;
    hasPreviousCode: boolean;
  };
}

// Progress update during execution
export interface ProgressUpdate {
  step: number;
  totalSteps: number;
  phase:
    | 'config_loaded'
    | 'components_discovered'
    | 'prompt_built'
    | 'llm_thinking'
    | 'code_extracted'
    | 'validating'
    | 'post_processing'
    | 'saving';
  message: string;
  details?: Record<string, unknown>;
}

// Validation feedback
export interface ValidationFeedback {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  autoFixApplied: boolean;
  fixDetails?: string[];
}

// Retry information
export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  reason: string;
  errors: string[];
}

// Completion feedback - detailed explanation of what was done
export interface CompletionFeedback {
  success: boolean;
  title: string;
  fileName: string;
  storyId: string;

  // What was done
  summary: {
    action: 'created' | 'updated' | 'failed';
    description: string;
  };

  // Components used
  componentsUsed: {
    name: string;
    reason?: string;
  }[];

  // Layout decisions
  layoutChoices: {
    pattern: string;
    reason: string;
  }[];

  // Props/variants applied
  styleChoices: {
    property: string;
    value: string;
    reason?: string;
  }[];

  // Warnings or suggestions
  suggestions?: string[];

  // Validation status
  validation: ValidationFeedback;

  // The generated code
  code: string;

  // Performance metrics
  metrics: {
    totalTimeMs: number;
    llmCallsCount: number;
    tokensUsed?: number;
  };
}

// Error event
export interface ErrorFeedback {
  code: string;
  message: string;
  details?: string;
  recoverable: boolean;
  suggestion?: string;
}

// Union type for all stream events
export interface StreamEvent {
  type: StreamEventType;
  timestamp: number;
  data: IntentPreview | ProgressUpdate | ValidationFeedback | RetryInfo | CompletionFeedback | ErrorFeedback;
}

// Request body for streaming endpoint
export interface StreamGenerateRequest {
  prompt: string;
  fileName?: string;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  isUpdate?: boolean;
  originalTitle?: string;
  storyId?: string;
  framework?: string;
  autoDetectFramework?: boolean;
  images?: Array<{
    type: 'base64' | 'url' | 'file';
    data?: string;
    url?: string;
    path?: string;
    mediaType?: string;
  }>;
  visionMode?: string;
  designSystem?: string;
}

// Helper to create SSE-formatted message
export function formatSSE(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// Helper to create event objects
export function createStreamEvent<T extends StreamEvent['data']>(
  type: StreamEventType,
  data: T
): StreamEvent {
  return {
    type,
    timestamp: Date.now(),
    data
  };
}
