/**
 * Self-Healing Loop for Story Generation
 *
 * Provides LLM-assisted error correction when validation fails
 * and auto-fix cannot repair the code.
 *
 * Design-system agnostic - uses discovered components from the user's project.
 */

import { ValidationResult } from './validateStory.js';
import { ValidationError } from './storyValidator.js';

/**
 * Aggregated validation errors from all validation systems
 */
export interface ValidationErrors {
  /** TypeScript AST syntax errors */
  syntaxErrors: string[];
  /** Forbidden pattern violations (e.g., UNSAFE_style) */
  patternErrors: string[];
  /** Invalid component import errors */
  importErrors: string[];
}

/**
 * Options for self-healing prompt generation
 */
export interface SelfHealingOptions {
  /** Maximum retry attempts */
  maxAttempts: number;
  /** List of available component names from discovery */
  availableComponents: string[];
  /** Framework being used (react, vue, angular, etc.) */
  framework: string;
  /** Import path for the component library */
  importPath: string;
}

/**
 * Result of a self-healing attempt
 */
export interface SelfHealingResult {
  /** Whether the code was successfully healed */
  success: boolean;
  /** The final code (healed or best attempt) */
  code: string;
  /** Number of attempts made */
  attempts: number;
  /** History of errors from each attempt */
  errorHistory: ValidationErrors[];
  /** Final remaining errors (if any) */
  finalErrors: ValidationErrors;
  /** Whether self-healing was actually used */
  selfHealingUsed: boolean;
}

/**
 * Metrics for generation response
 */
export interface GenerationMetrics {
  attempts: number;
  selfHealingUsed: boolean;
  validationHistory: Array<{
    attempt: number;
    syntaxErrors: number;
    patternErrors: number;
    importErrors: number;
    autoFixApplied: boolean;
  }>;
}

/**
 * Check if validation errors object is empty (no errors)
 */
export function hasNoErrors(errors: ValidationErrors): boolean {
  return (
    errors.syntaxErrors.length === 0 &&
    errors.patternErrors.length === 0 &&
    errors.importErrors.length === 0
  );
}

/**
 * Get total error count
 */
export function getTotalErrorCount(errors: ValidationErrors): number {
  return (
    errors.syntaxErrors.length +
    errors.patternErrors.length +
    errors.importErrors.length
  );
}

/**
 * Create empty validation errors object
 */
export function createEmptyErrors(): ValidationErrors {
  return {
    syntaxErrors: [],
    patternErrors: [],
    importErrors: [],
  };
}

/**
 * Aggregate validation errors from different validation systems
 */
export function aggregateValidationErrors(
  astResult: ValidationResult | null,
  patternErrors: ValidationError[] | null,
  importErrors: string[] | null
): ValidationErrors {
  const errors: ValidationErrors = createEmptyErrors();

  // Add AST validation errors
  if (astResult && !astResult.isValid) {
    errors.syntaxErrors = [...astResult.errors];
  }

  // Add pattern validation errors
  if (patternErrors && patternErrors.length > 0) {
    errors.patternErrors = patternErrors.map(
      (e) => `Line ${e.line}: ${e.message}`
    );
  }

  // Add import validation errors
  if (importErrors && importErrors.length > 0) {
    errors.importErrors = [...importErrors];
  }

  return errors;
}

/**
 * Determine if we should continue retrying based on error history
 */
export function shouldContinueRetrying(
  attempts: number,
  maxAttempts: number,
  errorHistory: ValidationErrors[]
): { shouldRetry: boolean; reason: string } {
  // Don't exceed max attempts
  if (attempts >= maxAttempts) {
    return { shouldRetry: false, reason: 'Maximum retry attempts reached' };
  }

  // If we have at least 2 attempts, check if errors are repeating
  if (errorHistory.length >= 2) {
    const currentErrors = errorHistory[errorHistory.length - 1];
    const previousErrors = errorHistory[errorHistory.length - 2];

    // Convert to sets for comparison
    const currentSet = new Set([
      ...currentErrors.syntaxErrors,
      ...currentErrors.patternErrors,
      ...currentErrors.importErrors,
    ]);

    const previousSet = new Set([
      ...previousErrors.syntaxErrors,
      ...previousErrors.patternErrors,
      ...previousErrors.importErrors,
    ]);

    // Check if same errors are repeating (LLM is stuck)
    if (currentSet.size === previousSet.size) {
      let allSame = true;
      for (const error of currentSet) {
        if (!previousSet.has(error)) {
          allSame = false;
          break;
        }
      }
      if (allSame && currentSet.size > 0) {
        return {
          shouldRetry: false,
          reason: 'Same errors repeating - LLM appears stuck',
        };
      }
    }
  }

  return { shouldRetry: true, reason: '' };
}

/**
 * Build the self-healing prompt to send to the LLM
 * Design-system agnostic - uses discovered components
 */
export function buildSelfHealingPrompt(
  originalCode: string,
  errors: ValidationErrors,
  attempt: number,
  options: SelfHealingOptions
): string {
  const sections: string[] = [];

  sections.push(
    `## CODE CORRECTION REQUIRED (Attempt ${attempt} of ${options.maxAttempts})`
  );
  sections.push('');
  sections.push(
    'Your previous code contained errors. Please fix them while preserving the original intent.'
  );
  sections.push('');

  // Syntax errors section
  if (errors.syntaxErrors.length > 0) {
    sections.push('### TypeScript Syntax Errors');
    sections.push('These prevent the code from compiling:');
    errors.syntaxErrors.forEach((e) => sections.push(`- ${e}`));
    sections.push('');
  }

  // Pattern errors section
  if (errors.patternErrors.length > 0) {
    sections.push('### Forbidden Patterns');
    sections.push('These patterns are not allowed in this codebase:');
    errors.patternErrors.forEach((e) => sections.push(`- ${e}`));
    sections.push('');
  }

  // Import errors section
  if (errors.importErrors.length > 0) {
    sections.push('### Import Errors');
    sections.push(
      `These components do not exist in "${options.importPath}":`
    );
    errors.importErrors.forEach((e) => sections.push(`- ${e}`));
    sections.push('');

    // Show available components (design-system agnostic)
    if (options.availableComponents.length > 0) {
      sections.push('**Available components include:**');
      const displayComponents = options.availableComponents.slice(0, 20);
      sections.push(displayComponents.join(', '));
      if (options.availableComponents.length > 20) {
        sections.push(
          `... and ${options.availableComponents.length - 20} more`
        );
      }
      sections.push('');
    }
  }

  // Original code section
  sections.push('### Original Code (with errors)');
  sections.push('```tsx');
  sections.push(originalCode);
  sections.push('```');
  sections.push('');

  // Correction instructions
  sections.push('### Correction Instructions');
  sections.push('1. Fix ALL errors listed above');
  sections.push('2. Keep the same component structure and layout');
  sections.push('3. Do NOT add new features - only fix the errors');
  sections.push('4. Ensure all JSX elements are properly opened and closed');
  sections.push(
    `5. Only import components that exist in "${options.importPath}"`
  );
  sections.push('6. Return the COMPLETE corrected code in a ```tsx code block');
  sections.push(
    '7. Do NOT include any explanation - just the corrected code block'
  );

  return sections.join('\n');
}

/**
 * Format errors for logging
 */
export function formatErrorsForLog(errors: ValidationErrors): string {
  const parts: string[] = [];

  if (errors.syntaxErrors.length > 0) {
    parts.push(`Syntax(${errors.syntaxErrors.length})`);
  }
  if (errors.patternErrors.length > 0) {
    parts.push(`Pattern(${errors.patternErrors.length})`);
  }
  if (errors.importErrors.length > 0) {
    parts.push(`Import(${errors.importErrors.length})`);
  }

  return parts.length > 0 ? parts.join(', ') : 'None';
}

/**
 * Create generation metrics from error history
 */
export function createGenerationMetrics(
  attempts: number,
  errorHistory: ValidationErrors[],
  autoFixApplied: boolean[]
): GenerationMetrics {
  return {
    attempts,
    selfHealingUsed: attempts > 1,
    validationHistory: errorHistory.map((errors, index) => ({
      attempt: index + 1,
      syntaxErrors: errors.syntaxErrors.length,
      patternErrors: errors.patternErrors.length,
      importErrors: errors.importErrors.length,
      autoFixApplied: autoFixApplied[index] || false,
    })),
  };
}

/**
 * Select the best code from multiple attempts based on error count
 */
export function selectBestAttempt(
  attempts: Array<{ code: string; errors: ValidationErrors }>
): { code: string; errors: ValidationErrors } | null {
  if (attempts.length === 0) return null;

  let best = attempts[0];
  let bestErrorCount = getTotalErrorCount(best.errors);

  for (const attempt of attempts) {
    const errorCount = getTotalErrorCount(attempt.errors);
    if (errorCount < bestErrorCount) {
      best = attempt;
      bestErrorCount = errorCount;
    }
  }

  return best;
}
