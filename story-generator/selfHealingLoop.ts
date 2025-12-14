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
 * Get the appropriate code block language for a framework
 */
function getCodeBlockLanguage(framework: string): string {
  switch (framework) {
    case 'svelte':
      return 'svelte';
    case 'vue':
      return 'vue';
    default:
      return 'tsx';
  }
}

/**
 * Get framework-specific correction instructions
 */
function getFrameworkSpecificInstructions(framework: string, importPath: string): string[] {
  const instructions: string[] = [];

  if (framework === 'svelte') {
    instructions.push('');
    instructions.push('### CRITICAL: Svelte Story Format Requirements');
    instructions.push('You MUST use the addon-svelte-csf v5+ format. This is REQUIRED:');
    instructions.push('');
    instructions.push('1. Use `<script module>` (NOT `<script context="module">`!)');
    instructions.push('2. Import defineMeta: `import { defineMeta } from "@storybook/addon-svelte-csf";`');
    instructions.push(`3. Import components: \`import { ComponentName } from "${importPath}";\``);
    instructions.push('4. Destructure Story from defineMeta: `const { Story } = defineMeta({ title: "...", component: ... });`');
    instructions.push('5. Use `<Story name="StoryName">` components (NOT `export const StoryName`)');
    instructions.push('6. Close the script tag properly: `</script>`');
    instructions.push('');
    instructions.push('**FORBIDDEN in Svelte stories:**');
    instructions.push('- `export const meta = { ... }` (old CSF format)');
    instructions.push('- `export default meta` (old CSF format)');
    instructions.push('- `<script context="module">` (old syntax)');
    instructions.push('- TypeScript CSF 3.0 format (`const meta: Meta<typeof Component>`)');
    instructions.push('- React imports (`import React from "react"`)');
    instructions.push('- JSX syntax (`className`, `onClick`)');
    instructions.push('- NESTING a component inside itself: `<Comp><Comp>text</Comp></Comp>` is WRONG!');
    instructions.push('');
    instructions.push('**Correct Svelte story structure:**');
    instructions.push('```svelte');
    instructions.push('<script module>');
    instructions.push('  import { defineMeta } from "@storybook/addon-svelte-csf";');
    instructions.push(`  import { Button } from "${importPath}";`);
    instructions.push('');
    instructions.push('  const { Story } = defineMeta({');
    instructions.push('    title: "Generated/Button",');
    instructions.push('    component: Button,');
    instructions.push('  });');
    instructions.push('</script>');
    instructions.push('');
    instructions.push('<Story name="Default">');
    instructions.push('  <Button>Click Me</Button>');
    instructions.push('</Story>');
    instructions.push('```');
    instructions.push('');
  } else if (framework === 'vue') {
    instructions.push('');
    instructions.push('### Vue Story Format Requirements');
    instructions.push('Use Vue 3 composition API with `<script setup>` or standard Vue story format.');
    instructions.push('');
  }

  return instructions;
}

/**
 * Build the self-healing prompt to send to the LLM
 * Design-system agnostic - uses discovered components
 * Framework-aware - provides specific instructions for Svelte, Vue, etc.
 */
export function buildSelfHealingPrompt(
  originalCode: string,
  errors: ValidationErrors,
  attempt: number,
  options: SelfHealingOptions
): string {
  const sections: string[] = [];
  const codeBlockLang = getCodeBlockLanguage(options.framework);

  sections.push(
    `## CODE CORRECTION REQUIRED (Attempt ${attempt} of ${options.maxAttempts})`
  );
  sections.push('');
  sections.push(
    'Your previous code contained errors. Please fix them while preserving the original intent.'
  );
  sections.push('');

  // Framework-specific instructions FIRST (most important for Svelte)
  const frameworkInstructions = getFrameworkSpecificInstructions(options.framework, options.importPath);
  if (frameworkInstructions.length > 0) {
    sections.push(...frameworkInstructions);
  }

  // Syntax errors section
  if (errors.syntaxErrors.length > 0) {
    if (options.framework === 'svelte') {
      sections.push('### Svelte Syntax Errors');
      sections.push('These indicate invalid Svelte story structure:');
    } else {
      sections.push('### TypeScript Syntax Errors');
      sections.push('These prevent the code from compiling:');
    }
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

  // Original code section - use correct language
  sections.push('### Original Code (with errors)');
  sections.push(`\`\`\`${codeBlockLang}`);
  sections.push(originalCode);
  sections.push('```');
  sections.push('');

  // Correction instructions
  sections.push('### Correction Instructions');
  sections.push('1. Fix ALL errors listed above');
  sections.push('2. Keep the same component structure and layout');
  sections.push('3. Do NOT add new features - only fix the errors');

  if (options.framework === 'svelte') {
    sections.push('4. Use proper Svelte 5 syntax (class=, onclick=, NOT on:click=)');
    sections.push('5. NEVER nest a component inside itself: <Comp><Comp>X</Comp></Comp> is WRONG! Use <Comp>X</Comp>');
    sections.push(
      `6. Only import components that exist in "${options.importPath}" (no deep paths)`
    );
    sections.push(`7. Return the COMPLETE corrected code in a \`\`\`svelte code block`);
    sections.push('8. Do NOT include any explanation - just the corrected code block');
  } else {
    sections.push('4. Ensure all JSX elements are properly opened and closed');
    sections.push(
      `5. Only import components that exist in "${options.importPath}"`
    );
    sections.push(`6. Return the COMPLETE corrected code in a \`\`\`${codeBlockLang} code block`);
    sections.push('7. Do NOT include any explanation - just the corrected code block');
  }

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
