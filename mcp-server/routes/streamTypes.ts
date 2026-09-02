/**
 * Stream Types for Two-Way Chat Communication
 *
 * These types define the event structure for Server-Sent Events (SSE)
 * that enable real-time feedback during story generation.
 */

// Event types for SSE stream
export type StreamEventType =
  | 'started'          // Names the run, so the client can cancel this one
  | 'preview_ready'    // The file is on disk and indexed-or-indexing: show it now
  | 'llm_text'         // Model prose streaming in: the plan before the code, the summary after
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
    | 'saving'
    // Post-write phases. Everything after "saving" used to be silent, so a
    // story that crashed at runtime, was regenerated, and was then repaired by
    // verification all looked like one long "Saving" — the user watched a red
    // error story with no narration. These phases make that timeline visible:
    // written → runtime check → crashed, fixing → fixed → verifying → verified.
    | 'runtime_check'          // runtime validation running against Storybook
    | 'runtime_healing'        // story crashed at render; healing regeneration in flight
    | 'runtime_healed'         // healing outcome: it renders now
    | 'runtime_heal_failed'    // healing outcome: crash still stands
    | 'verifying'              // browser verification running
    | 'verify_repairing'       // blockers found; repair LLM call in flight (message carries the count)
    | 'verify_repaired'        // repair applied and re-verified
    | 'verify_repair_failed'   // original kept (message carries why: budget / not attempted / no improvement)
    | 'verified'               // final outcome: verified clean
    | 'verify_issues'          // final outcome: issues remain (message carries the count)
    | 'verify_inconclusive';   // final outcome: verification could not run
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

  // Model-authored follow-up ideas, rendered as clickable chips. Never advice.
  suggestions?: string[];

  /**
   * Something the user should read, not click: "automatic fixes were
   * applied", "the run failed, try rephrasing". These used to travel in
   * `suggestions` and were rendered as chips that sent themselves as the
   * next prompt.
   */
  notice?: string;

  /** Hand-set props re-applied after the model's rewrite, and any it could not keep. */
  pins?: { applied: string[]; kept: string[]; lost: string[] };

  /** For an update answered with edit blocks: exactly what was searched for and replaced. */
  edits?: Array<{ search: string; replace: string }>;

  // Conversational, model-authored reply describing what was built.
  // Rendered as the assistant's chat message in the panel.
  chatSummary?: string;

  // Storybook component ID (prefix before `--<story>`) for client-side navigation
  storybookId?: string;

  // Runtime (in-Storybook) validation status, when enabled
  runtimeValidation?: {
    enabled: boolean;
    success: boolean;
    error?: string;
    healedByRetry?: boolean;
  };

  /**
   * Browser verification result — the story was rendered and inspected, not
   * merely written. Absent when verification could not run, which the panel
   * reports honestly rather than as success.
   */
  verification?: {
    outcome: 'verified' | 'issues' | 'not_verified';
    reason?: string;
    findings: Array<{
      id: string;
      severity: 'blocker' | 'warning' | 'info';
      class: 'code' | 'a11y' | 'interaction' | 'infrastructure';
      message: string;
      evidence?: string;
      selector?: string;
    }>;
    metrics?: Record<string, number | string | boolean | string[]>;
  };

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

/** Names the in-flight run so a client can cancel this specific generation. */
export interface GenerationStarted {
  generationId: string;
}

/**
 * The story exists. Everything after this event — runtime check, browser
 * verification, repair, the chat summary — is background work that updates
 * the badge; none of it should stand between the user and the preview.
 */
/** A slice of the model's prose as it streams. */
export interface LlmText {
  /**
   * thinking: the model's summarised reasoning before its first token;
   * plan: the sentences before the code; code: the file as it is written
   * (`accumulated` is deliberately empty for code events — the client
   * accumulates the deltas — to keep frames small); summary: after.
   */
  phase: 'thinking' | 'plan' | 'code' | 'summary';
  delta: string;
  accumulated: string;
}

export interface PreviewReady {
  fileName: string;
  title: string;
  storybookId?: string;
  isUpdate: boolean;
  code: string;
}

// Union type for all stream events
export interface StreamEvent {
  type: StreamEventType;
  timestamp: number;
  data: GenerationStarted | PreviewReady | LlmText | IntentPreview | ProgressUpdate | ValidationFeedback | RetryInfo | CompletionFeedback | ErrorFeedback;
}

// Request body for streaming endpoint
export interface StreamGenerateRequest {
  /**
   * Prose description of an element the user selected in the preview, used to
   * scope the edit. Prose rather than a selector: the model edits source, where
   * rendered class hashes do not appear.
   */
  selection?: string;
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
  /** Reference files: text-like ones are inlined, PDFs go to Claude as documents. */
  files?: Array<{ name: string; mediaType?: string; data: string }>;
  visionMode?: string;
  designSystem?: string;
  provider?: string;  // LLM provider (claude, openai, gemini)
  model?: string;     // Model ID
  considerations?: string;  // Design system considerations (passed from frontend for environment parity)
  useStorybookMcp?: boolean;  // Whether to use Storybook MCP context for enhanced generation
  storybookUrl?: string;      // Storybook origin detected by the panel (zero-config MCP context)
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
