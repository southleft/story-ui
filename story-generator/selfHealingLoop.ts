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
  /**
   * Project-specific design guidance (story-ui-considerations.md / story-ui-docs)
   * so corrections keep following the design system's own rules.
   */
  designGuidelines?: string;
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

  // If we have at least 2 attempts, check if errors are repeating.
  // Errors are normalized (line/column numbers stripped) before comparison so
  // that the "same" error shifting by a line still counts as being stuck.
  if (errorHistory.length >= 2) {
    const currentErrors = errorHistory[errorHistory.length - 1];
    const previousErrors = errorHistory[errorHistory.length - 2];

    const currentSet = new Set(collectNormalizedErrors(currentErrors));
    const previousSet = new Set(collectNormalizedErrors(previousErrors));

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

/** Strip line/column locations so error identity survives code shifting. */
function normalizeErrorMessage(error: string): string {
  return error
    .replace(/\bline\s+\d+/gi, 'line N')
    .replace(/\(\d+,\d+\)/g, '(N,N)')
    .replace(/:\d+(?::\d+)?/g, ':N')
    .trim();
}

function collectNormalizedErrors(errors: ValidationErrors): string[] {
  return [
    ...errors.syntaxErrors,
    ...errors.patternErrors,
    ...errors.importErrors,
  ].map(normalizeErrorMessage);
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
    instructions.push('5. Use `<Story name="StoryName" asChild>` components (NOT `export const StoryName`)');
    instructions.push('6. ALWAYS add asChild prop to Story to prevent double-wrapping: `<Story name="X" asChild>`');
    instructions.push('7. Close the script tag properly: `</script>`');
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
    instructions.push('<Story name="Default" asChild>');
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

  // Project design guidelines — corrections must keep following the design
  // system's own rules, not just fix syntax.
  if (options.designGuidelines) {
    sections.push('### Project Design Guidelines (still apply to the corrected code)');
    sections.push(options.designGuidelines.slice(0, 4000));
    sections.push('');
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

  // Import errors section - with approximation guidance
  if (errors.importErrors.length > 0) {
    sections.push('### Import Errors - MUST USE AVAILABLE COMPONENTS');
    sections.push('');
    sections.push('🚨 **CRITICAL: DO NOT try to import these components again - they DO NOT EXIST:**');
    errors.importErrors.forEach((e) => sections.push(`- ${e}`));
    sections.push('');

    sections.push('### HOW TO FIX: Approximate the UI with Available Components');
    sections.push('');
    sections.push('You MUST recreate the same visual appearance using ONLY the available components listed below.');
    sections.push('Think creatively - almost any UI can be approximated with basic layout and display components.');
    sections.push('');
    sections.push('**Common approximation strategies:**');
    // Described as SHAPES, not as component names. Naming Mantine's
    // `SimpleGrid`/`RingProgress`/`ThemeIcon` here told a Carbon or MUI
    // project to reach for components it does not have, in the very prompt
    // whose job is to stop it importing things that do not exist.
    sections.push('- **Calendar / DatePicker** → a grid of text cells, one per day');
    sections.push('- **Chart / Graph** → progress indicators, or a row of boxes with proportional heights');
    sections.push('- **Timeline** → a vertical stack, one card or surface per event');
    sections.push('- **Carousel / Slider** → a row of images with previous/next buttons');
    sections.push('- **DataTable** → the table primitives, or a stack of row surfaces');
    sections.push('- **TreeView** → nested stacks or an accordion, with links for leaves');
    sections.push('- **Rating / Stars** → a row of icon buttons');
    sections.push('- **Map** → an image placeholder with absolutely positioned markers');
    sections.push('');
    sections.push('**The goal is visual similarity, not exact functionality.**');
    sections.push('Users want to see what a UI could look like - use basic components creatively!');
    sections.push('');

    if (options.availableComponents.length > 0) {
      /**
       * Rank by relevance to what was actually missing, then truncate.
       *
       * This used to group by regexes matching Mantine identifiers
       * (`SimpleGrid`, `ThemeIcon`, `RingProgress`), so on Carbon, MUI or
       * Atlassian both groups came back EMPTY and everything fell through to
       * an arbitrary first-30 slice. The model was told "you MUST use these
       * instead" from a list that frequently did not contain the answer.
       *
       * Relevance is computed against the names that failed, so a missing
       * `DatePicker` surfaces `DatePickerInput` and `Calendar` at the top
       * whatever the design system calls them.
       */
      const missing = errors.importErrors
        .map(e => (e.match(/[A-Z][A-Za-z0-9_]*/g) || []).join(' '))
        .join(' ')
        .toLowerCase();
      const missingWords = [...new Set(missing.split(/\s+/).filter(w => w.length > 2))];

      /** Crude but stable: shared prefix, containment, and shared word stems. */
      const relevance = (name: string): number => {
        const lower = name.toLowerCase();
        let score = 0;
        for (const w of missingWords) {
          if (lower === w) score += 100;
          else if (lower.startsWith(w) || w.startsWith(lower)) score += 40;
          else if (lower.includes(w) || w.includes(lower)) score += 20;
        }
        return score;
      };

      const ranked = [...options.availableComponents]
        .map(name => ({ name, score: relevance(name) }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

      const closest = ranked.filter(r => r.score > 0).slice(0, 12).map(r => r.name);
      const rest = ranked.filter(r => !closest.includes(r.name)).map(r => r.name);

      sections.push('**Available components you MUST use instead:**');
      if (closest.length > 0) {
        sections.push(`- **Closest to what you tried to import:** ${closest.join(', ')}`);
      }
      // The full list still ships, capped, so the model is never asked to
      // choose from a set that excludes the right answer.
      const CAP = 120;
      sections.push(
        `- **All available:** ${rest.slice(0, CAP).join(', ')}` +
        (rest.length > CAP ? ` ... and ${rest.length - CAP} more` : ''),
      );
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
  sections.push('4. **CRITICAL: Escape apostrophes in title strings** - Use `\\\'` not `\'`');
  sections.push('   Example: `title: \'Women\\\'s Athletic Dashboard\'` NOT `title: \'Women\'s Athletic Dashboard\'`');
  sections.push('5. Do NOT duplicate title segments - "Dashboard Dashboard" is WRONG');

  if (options.framework === 'svelte') {
    sections.push('6. Use proper Svelte 5 syntax (class=, onclick=, NOT on:click=)');
    sections.push('7. NEVER nest a component inside itself: <Comp><Comp>X</Comp></Comp> is WRONG! Use <Comp>X</Comp>');
    sections.push(
      `8. Only import from ROOT: import { Comp } from "${options.importPath}" - NEVER use deep paths like "${options.importPath}/dist/..." or "${options.importPath}/components/..."`
    );
    sections.push(`9. Return the COMPLETE corrected code in a \`\`\`svelte code block`);
    sections.push('10. Do NOT include any explanation - just the corrected code block');
  } else if (options.framework === 'web-components') {
    // Web Components use side-effect imports and often require deep paths
    sections.push('6. Use Lit html template literal for rendering');
    sections.push('7. Web Component imports register custom elements as side-effects');
    sections.push('8. Use correct import path for each component (deep paths are allowed for web components)');
    sections.push(`9. Return the COMPLETE corrected code in a \`\`\`${codeBlockLang} code block`);
    sections.push('10. Do NOT include any explanation - just the corrected code block');
  } else {
    sections.push('6. Ensure all JSX elements are properly opened and closed');
    sections.push(
      `7. Only import components that exist in "${options.importPath}"`
    );
    sections.push(`8. Return the COMPLETE corrected code in a \`\`\`${codeBlockLang} code block`);
    sections.push('9. Do NOT include any explanation - just the corrected code block');
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
 * Select the best code from multiple attempts using severity-weighted scoring:
 * a fatal syntax or import error outweighs several cosmetic pattern warnings,
 * so an attempt with one style nit beats an attempt that won't compile.
 */
export function selectBestAttempt(
  attempts: Array<{ code: string; errors: ValidationErrors }>
): { code: string; errors: ValidationErrors } | null {
  if (attempts.length === 0) return null;

  const score = (errors: ValidationErrors): number =>
    errors.syntaxErrors.length * 10 +
    errors.importErrors.length * 10 +
    errors.patternErrors.length;

  let best = attempts[0];
  let bestScore = score(best.errors);

  for (const attempt of attempts) {
    const attemptScore = score(attempt.errors);
    if (attemptScore < bestScore) {
      best = attempt;
      bestScore = attemptScore;
    }
  }

  return best;
}
