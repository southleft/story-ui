/**
 * Shared story-generation pipeline.
 *
 * Both HTTP transports delegate here:
 *  - generateStoryStream.ts (SSE) forwards pipeline events to the client
 *  - generateStory.ts (JSON) runs the same pipeline with no-op events
 *
 * Keeping the pipeline in one place guarantees the two routes cannot drift
 * (runtime validation, barrel-import fixing, and post-processing re-validation
 * previously existed on only one of the two paths).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { loadConsiderations, considerationsToPrompt } from '../../story-generator/considerationsLoader.js';
import { generateStory } from '../../story-generator/generateStory.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import {
  buildFrameworkAwarePrompt,
  detectProjectFramework,
} from '../../story-generator/promptGenerator.js';
import { FrameworkType, StoryGenerationOptions, getAdapter, FrameworkAdapter } from '../../story-generator/framework-adapters/index.js';
import { loadUserConfig, validateConfig } from '../../story-generator/configLoader.js';
import { extractAndValidateCodeBlock, validateStoryCode, ValidationResult } from '../../story-generator/validateStory.js';
import { createFrameworkAwareFallbackStory } from './storyHelpers.js';
import { isBlacklistedComponent, isBlacklistedIcon, getBlacklistErrorMessage, ICON_CORRECTIONS } from '../../story-generator/componentBlacklist.js';
import { StoryTracker, StoryMapping } from '../../story-generator/storyTracker.js';
import { getManifestManager } from '../../story-generator/manifestManager.js';
import { getDocumentation } from '../../story-generator/documentation-sources.js';
import { postProcessStory, fixBarrelImports } from '../../story-generator/postProcessStory.js';
import { validateStory } from '../../story-generator/storyValidator.js';
import {
  ValidationErrors,
  SelfHealingOptions,
  aggregateValidationErrors,
  shouldContinueRetrying,
  buildSelfHealingPrompt,
  hasNoErrors,
  getTotalErrorCount,
  createEmptyErrors,
  formatErrorsForLog,
  selectBestAttempt,
} from '../../story-generator/selfHealingLoop.js';
import {
  validateStoryRuntime,
  getStorybookUrl,
  formatRuntimeErrorForHealing,
  isRuntimeValidationEnabled,
  RuntimeValidationResult,
} from '../../story-generator/runtimeValidator.js';
import { StoryHistoryManager } from '../../story-generator/storyHistory.js';
import { logger } from '../../story-generator/logger.js';
import {
  fetchStorybookCatalog,
  rankByRelevance,
  formatCatalogForPrompt,
  storybookComponentDirs,
} from '../../story-generator/knowledge/storybookCatalog.js';
import { UrlRedirectService } from '../../story-generator/urlRedirectService.js';
import {
  chatCompletionDetailed,
  chatCompletionStream,
  generateTitle as llmGenerateTitle,
  isProviderConfigured,
  getProviderInfo,
  chatCompletionWithImages,
  buildMessageWithImages,
} from '../../story-generator/llm-providers/story-llm-service.js';
import { processImageInputs, ImageInput } from '../../story-generator/imageProcessor.js';
import { VisionPromptType, buildVisionAwarePrompt } from '../../story-generator/visionPrompts.js';
import { ImageContent } from '../../story-generator/llm-providers/types.js';
import {
  createStorybookMcpClient,
  formatStorybookContext,
  StorybookMcpContext,
} from '../../story-generator/storybookMcpClient.js';
import { IntentPreview, ValidationFeedback, CompletionFeedback } from './streamTypes.js';
import { verifyStory } from '../../story-generator/verify/verifyStory.js';
import { reflectDesignSystem, formatCompoundReference } from '../../story-generator/knowledge/runtimeReflect.js';
import { extractProps, extractPropsForPackages, rankProps } from '../../story-generator/knowledge/propExtractor.js';
import { saysMoreThanName } from '../../story-generator/knowledge/descriptionQuality.js';
import { enrichWithSourceFacts } from '../../story-generator/knowledge/sourceFacts.js';
import { readStylingFacts, formatStylingGuidance } from '../../story-generator/knowledge/stylingFacts.js';
import { inheritCompoundExamples } from '../../story-generator/knowledge/storybookCatalog.js';
import {
  writeStoryArtifacts,
  extractStylesheet,
  sweepOrphanedArtifacts,
} from '../../story-generator/storyArtifacts.js';
import { attemptVerificationRepair } from './verifyRepair.js';
import type { VerifyReport } from '../../story-generator/verify/findings.js';

// ============================================================
// Public interface
// ============================================================

export interface GenerationRequest {
  prompt: string;
  fileName?: string;
  conversation?: Array<{ role: string; content: string }>;
  isUpdate?: boolean;
  /**
   * A prose description of the element the user pointed at in the preview,
   * e.g. `a ThemeIcon containing the text "Deployment completed" inside
   * Timeline > Card`. Prose rather than a selector because the model edits
   * SOURCE, and the rendered class hashes appear nowhere in it.
   */
  selection?: string;
  originalTitle?: string;
  storyId?: string;
  framework?: string;
  autoDetectFramework?: boolean;
  images?: ImageInput[];
  visionMode?: string;
  designSystem?: string;
  considerations?: string;
  provider?: string;
  model?: string;
  useStorybookMcp?: boolean;
  /**
   * Storybook origin detected by the panel (it runs inside Storybook, so it
   * knows). Lets the MCP-context toggle work with zero configuration; an
   * explicit config.storybookMcpUrl still takes precedence.
   */
  storybookUrl?: string;
  voiceMode?: boolean;
}

export interface GenerationEvents {
  onProgress?(step: number, totalSteps: number, phase: string, message: string, details?: Record<string, unknown>): void;
  onIntent?(intent: IntentPreview): void;
  onValidation?(validation: ValidationFeedback): void;
  onRetry?(attempt: number, maxAttempts: number, reason: string, errors: string[]): void;
  onLLMCall?(): void;
}

/** Total steps reported through onProgress (kept for panel progress bars). */
export const GENERATION_TOTAL_STEPS = 8;

/**
 * Error with transport metadata. Streaming maps it to an SSE error event;
 * the JSON route maps httpStatus/code onto the response.
 */
export class GenerationError extends Error {
  constructor(
    public code: string,
    message: string,
    public options: {
      httpStatus?: number;
      details?: string;
      recoverable?: boolean;
      suggestion?: string;
    } = {}
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

export interface GenerationOutcome {
  success: boolean;
  isFallbackStory: boolean;
  title: string;
  fileName: string;
  storyId: string;
  outPath: string;
  code: string;
  isUpdate: boolean;
  analysis: {
    componentsUsed: CompletionFeedback['componentsUsed'];
    layoutChoices: CompletionFeedback['layoutChoices'];
    styleChoices: CompletionFeedback['styleChoices'];
  };
  validation: {
    hasWarnings: boolean;
    errors: string[];
    warnings: string[];
    selfHealingUsed: boolean;
    attempts: number;
    autoFixApplied: boolean;
    isFallback: boolean;
  };
  runtimeValidation: {
    enabled: boolean;
    success: boolean;
    storyExists: boolean;
    error?: string;
    errorType?: string;
    details?: unknown;
    healedByRetry?: boolean;
  };
  /**
   * Browser verification: the story was actually rendered and inspected.
   * Absent when verification could not run (no Playwright, no Storybook URL).
   */
  verification?: VerifyReport;
  /** Conversational, model-authored reply describing what was built. */
  chatSummary?: string;
  /** Short follow-up prompt ideas the user can click to refine. */
  suggestions?: string[];
  /**
   * Storybook component ID (the `--<story>` prefix) for the generated story,
   * so clients can navigate to it without guessing.
   */
  storybookId?: string;
}

// ============================================================
// Main pipeline
// ============================================================

export async function runStoryGeneration(
  request: GenerationRequest,
  events: GenerationEvents = {}
): Promise<GenerationOutcome> {
  const {
    prompt,
    fileName,
    conversation,
    isUpdate,
    originalTitle,
    storyId: providedStoryId,
    framework,
    autoDetectFramework,
    images,
    visionMode,
    designSystem,
    considerations,
    selection,
    provider,
    model,
    useStorybookMcp,
    storybookUrl,
    voiceMode,
  } = request;

  const totalSteps = GENERATION_TOTAL_STEPS;
  const startedAt = Date.now();

  if (!prompt) {
    throw new GenerationError('MISSING_PROMPT', 'No prompt provided', {
      httpStatus: 400,
      recoverable: false,
      suggestion: 'Please provide a description of what you want to generate',
    });
  }

  // Step 1: Load configuration
  events.onProgress?.(1, totalSteps, 'config_loaded', 'Loading configuration...');
  const config = loadUserConfig();
  const configValidation = validateConfig(config);
  if (!configValidation.isValid) {
    throw new GenerationError('CONFIG_ERROR', 'Configuration validation failed', {
      httpStatus: 400,
      details: configValidation.errors.join('; '),
      recoverable: false,
      suggestion: 'Check your story-ui.config.js file',
    });
  }

  // Early framework detection — detect once, use everywhere.
  const detectedFramework = await resolveFramework(framework, config, autoDetectFramework);
  const frameworkAdapter = getAdapter(detectedFramework);
  if (!frameworkAdapter) {
    throw new GenerationError('ADAPTER_NOT_FOUND', `No adapter found for framework: ${detectedFramework}`, {
      httpStatus: 400,
      recoverable: false,
      suggestion: 'Check that the framework name is correct: react, vue, angular, svelte, or web-components',
    });
  }
  logger.log(`🔧 Using framework adapter: ${frameworkAdapter.name}`);

  // Process images if provided
  let processedImages: ImageContent[] = [];
  if (images && Array.isArray(images) && images.length > 0) {
    try {
      processedImages = await processImageInputs(images);
    } catch (imageError) {
      throw new GenerationError('IMAGE_PROCESSING_ERROR', 'Failed to process images', {
        httpStatus: 400,
        details: imageError instanceof Error ? imageError.message : String(imageError),
        recoverable: true,
        suggestion: 'Try again without images or use a different format',
      });
    }
  }

  // Step 2: Discover components
  events.onProgress?.(2, totalSteps, 'components_discovered', 'Discovering available components...');
  const discovery = new EnhancedComponentDiscovery(config);

  // Where Storybook says this project's components are.
  //
  // Discovery otherwise guesses at conventional directory names, so a design
  // system living outside them is invisible — and a component the model is not
  // told about is a component it will not use, however good the rest of the
  // context is.
  try {
    const sbUrl = config.storybookMcpUrl || storybookUrl || getStorybookUrl();
    if (sbUrl) {
      const dirs = await storybookComponentDirs({ storybookUrl: sbUrl, projectRoot: process.cwd() });
      if (dirs.length) discovery.setStorybookComponentDirs(dirs);
    }
  } catch {
    // Discovery still works from conventions; this only widens it.
  }
  const components = await discovery.discoverAll();

  // Read what a LOCAL design system says about itself: the exact variant values
  // its cva()/tv() maps declare, the prose its own stories use to explain each
  // component, and its per-prop argTypes documentation.
  //
  // Measured before this: 7% of college-town's 246 components had a real
  // description and none had its allowed variant values, while 51 of its
  // stories carried a written explanation and 15 components declared their
  // options in source. Without the variant values the model picks a
  // plausible-sounding one — `variant="soft"` where the options are
  // default | secondary | destructive — which renders as the default and
  // silently drops the intent.
  //
  // Runs before npm prop extraction so a project's own words win over anything
  // inferred from type declarations.
  try {
    enrichWithSourceFacts(components as any[]);
  } catch (error) {
    logger.log(`⚠️ Could not read local source facts: ${error}`);
  }

  // Enrich the catalog with real prop signatures read from the installed
  // package's type declarations. Discovery yields names only for npm packages,
  // so without this the model infers every component's API — fine for a library
  // it has memorised, guesswork for a private design system.
  try {
    /**
     * Read every package the components actually live in.
     *
     * For a barrel library that is the one configured path. For a
     * package-per-component system it is ~20 of them, and reading only
     * `config.importPath` meant reading a scope directory as one tree and
     * truncating — so which components had props depended on directory order.
     */
    const homes = [...new Set(
      (components as any[]).map(c => c.__componentPath).filter((p): p is string => typeof p === 'string'),
    )];
    // The union, not a replacement. Reading the homes ALONE measured worse
    // than the scope walk it was meant to fix (45% vs 52%): shared packages
    // that declare no component of their own — primitives, tokens, base types
    // — are not in the homes list, and the scope walk was picking them up.
    // Each source covers what the other misses.
    const extracted = homes.length > 1
      ? await extractPropsForPackages([config.importPath, ...homes], process.cwd())
      : await extractProps(config.importPath, process.cwd());
    if (extracted) {
      let enriched = 0;
      let describedFromTypes = 0;
      for (const component of components as any[]) {
        const facts = extracted.components[component.name];
        if (!facts) continue;
        if (!component.props || component.props.length === 0) {
          // `htmlFor (string)`, not `htmlFor?: string`.
          //
          // The TypeScript signature form is copyable into an attribute
          // position and reads as plausible there. Observed: the model emitted
          // `<Label htmlFor: string="name" htmlFor="name">`, which React parses
          // as a namespaced attribute and passes to the DOM as garbage — it
          // renders, so verification passes it, and only a prop check catches
          // it. Parentheses keep the type information while making the string
          // impossible to paste into JSX and have it look right.
          component.props = rankProps(facts.props).map(p => {
            let entry = `${p.name}${p.required ? '' : '?'}${p.type ? ` (${p.type})` : ''}`;
            // A stated default stops the model restating it. `variant="text"`
            // on an MUI Button is not wrong, but it reads to the team that owns
            // the system as someone who did not know the API.
            if (p.defaultValue) entry += ` =${p.defaultValue}`;
            // Deprecation is the one fact here that changes whether the output
            // is acceptable at all, so it is never truncated away and never
            // silently ranked out of view.
            //
            // Prop DESCRIPTIONS are deliberately absent. They are extracted and
            // available (95% coverage on Carbon), but rendering even the top
            // three per component costs ~10k tokens and the full set ~28k —
            // against a 15k-token catalog, most of it describing components a
            // given generation never touches. Filtering the uninformative ones
            // does not help: Carbon phrases them as full sentences that say
            // nothing ("Specify an optional className to add"). Serving them
            // on demand is the right shape, and is not built yet.
            if (p.deprecated) {
              // A bare `@deprecated` carries no replacement to name; printing
              // the tag's own fallback text reads as `DEPRECATED: deprecated`.
              entry += p.deprecated === 'deprecated' ? ' ⚠DEPRECATED' : ` ⚠DEPRECATED: ${p.deprecated}`;
            }
            return entry;
          });
          enriched++;
        }
        if (facts.variants?.length) {
          const variantNote = `variants: ${facts.variants.join(' | ')}`;
          component.description = component.description
            ? `${component.description} — ${variantNote}`
            : variantNote;
        }
        // Prose the package wrote about itself. Overwrites discovery's
        // placeholder but never a real description: one read from the
        // project's own source is closer to the team's language than anything
        // npm ships.
        if (facts.doc && !saysMoreThanName(component.name, component.description)) {
          component.description = facts.doc;
          describedFromTypes++;
        }
      }
      logger.log(`🧠 Enriched ${enriched} components with extracted prop signatures${describedFromTypes ? `, ${describedFromTypes} with descriptions` : ""}`);
    }
  } catch {
    // Enrichment is additive; generation proceeds with names alone.
  }
  events.onProgress?.(2, totalSteps, 'components_discovered',
    `Found ${components.length} components from ${config.importPath}`,
    { componentCount: components.length });

  // Optional Storybook MCP context
  const componentNames = components.map((c: any) => c.name);
  let storybookContext: StorybookMcpContext | undefined;
  const shouldUseMcp = useStorybookMcp !== false;
  // Explicit config wins; otherwise use the Storybook origin the panel
  // detected, so the MCP-context toggle works with zero configuration.
  // Fall back to the environment-derived URL, the same one verification uses.
  //
  // Without this the richest component knowledge available — Storybook's own
  // components manifest, with the team's real imports and story snippets —
  // simply never loaded whenever a caller did not pass storybookUrl, which is
  // every request that is not the panel. The client, the manifest endpoint and
  // the formatter all already worked; nothing ever triggered them.
  const mcpUrl = config.storybookMcpUrl || storybookUrl || getStorybookUrl() || undefined;
  if (mcpUrl && shouldUseMcp) {
    // Pass the generated-stories directory so our own prior output is kept out
    // of the exemplar pool it sends back as the house style.
    const generatedDirFragment = (config.generatedStoriesPath || '')
      .replace(/^\.\//, '')
      .replace(/\/+$/, '');
    const storybookClient = createStorybookMcpClient(
      mcpUrl,
      config.storybookMcpTimeout,
      generatedDirFragment || undefined,
    );
    if (storybookClient) {
      storybookContext = await storybookClient.fetchContext(componentNames);
      logger.log(storybookContext.available
        ? `✅ Storybook MCP context fetched in ${storybookContext.fetchTimeMs}ms`
        : `⚠️ Storybook MCP not available: ${storybookContext.error}`);
    }
  }

  // Where each compound part nests, derived from its parent's real example.
  //
  // A design system documents `Alert`, not `AlertTitle`; 187 of college-town's
  // 247 components have no usage of their own but appear inside a documented
  // parent's code. Requires storybookContext to have supplied examples, which
  // is why it runs after that fetch.
  try {
    const docs = storybookContext?.componentDocs;
    if (docs) {
      for (const component of components as any[]) {
        if (component.examples?.length) continue;
        const doc = (docs as any)[component.name];
        const snippets = doc?.stories?.map((st: any) => st.snippet).filter(Boolean);
        if (snippets?.length) component.examples = snippets;
      }
    }
    inheritCompoundExamples(components as any[]);
  } catch (error) {
    logger.log(`⚠️ Could not attribute compound usage: ${error}`);
  }


  // Persistence services
  const storyTracker = new StoryTracker(config);
  const historyManager = new StoryHistoryManager(process.cwd());
  const redirectService = new UrlRedirectService(path.dirname(config.generatedStoriesPath));

  // Refinement resolution — find the prior story when this is an update
  const isActualUpdate = Boolean(isUpdate || (fileName && conversation && conversation.length > 2));
  let previousCode: string | undefined;
  let parentVersionId: string | undefined;
  let oldTitle: string | undefined;
  let oldStoryUrl: string | undefined;

  if (isActualUpdate && fileName) {
    const currentVersion = historyManager.getCurrentVersion(fileName);
    if (currentVersion) {
      previousCode = currentVersion.code;
      parentVersionId = currentVersion.id;
      const titleMatch = previousCode.match(/title:\s*["']([^"']+)['"]/);
      if (titleMatch) {
        oldTitle = titleMatch[1];
        const cleanOldTitle = oldTitle.replace(config.storyPrefix || 'Generated/', '');
        oldStoryUrl = `/story/${cleanOldTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}--primary`;
      }
    }
  }

  // Intent preview
  const intent = analyzeIntent(prompt, config, conversation, previousCode, {
    framework: detectedFramework,
    designSystem,
    hasImages: processedImages.length > 0,
  });
  events.onIntent?.(intent);

  // Step 3: Build prompt
  events.onProgress?.(3, totalSteps, 'prompt_built', 'Building generation prompt...', {
    framework: intent.framework,
    hasContext: intent.promptAnalysis.hasConversationContext,
  });

  let initialPrompt = await buildClaudePromptWithContext(
    prompt, config, conversation, previousCode, components, {
      framework: detectedFramework,
      visionMode: visionMode as VisionPromptType | undefined,
      designSystem,
      considerations,
      storybookContext,
      selection,
      storybookUrl: config.storybookMcpUrl || storybookUrl || getStorybookUrl() || undefined,
    }
  );

  if (voiceMode && conversation && conversation.length > 0) {
    initialPrompt = VOICE_MODE_PREAMBLE + '\n\n' + initialPrompt;
  }

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: initialPrompt },
  ];

  // Step 4: Self-healing generation loop
  events.onProgress?.(4, totalSteps, 'llm_thinking', 'AI is generating your story...');

  // Combined AI-considerations text (request-provided + project file). Used
  // both for healing-prompt guidance and as the isolation escape hatch: a
  // package explicitly named here is permitted in generated imports.
  let considerationsText = considerations || '';
  try {
    const fileConsiderations = loadConsiderations(config.considerationsPath);
    if (fileConsiderations) {
      const fileText = considerationsToPrompt(fileConsiderations);
      if (fileText) considerationsText = [considerationsText, fileText].filter(Boolean).join('\n');
    }
  } catch { /* considerations file unreadable — request text only */ }

  const selfHealingOptions: SelfHealingOptions = {
    maxAttempts: 3,
    availableComponents: componentNames,
    framework: detectedFramework,
    importPath: config.importPath,
    // Corrections must keep following the project's own design rules.
    designGuidelines: considerationsText || undefined,
  };

  let aiText = '';
  /** Stylesheet emitted alongside the story, when the model needed real states. */
  let generatedStylesheet: string | null = null;
  let finalErrors: ValidationErrors = createEmptyErrors();
  const errorHistory: ValidationErrors[] = [];
  const allAttempts: Array<{ code: string; errors: ValidationErrors }> = [];
  let attempts = 0;
  let selfHealingUsed = false;
  let lastAstResult: ValidationResult | null = null;

  while (attempts < selfHealingOptions.maxAttempts) {
    attempts++;
    events.onLLMCall?.();

    if (attempts > 1) {
      selfHealingUsed = true;
      const allErrors = [
        ...finalErrors.syntaxErrors,
        ...finalErrors.patternErrors,
        ...finalErrors.importErrors,
      ];
      events.onRetry?.(attempts, selfHealingOptions.maxAttempts, 'AI self-healing: fixing validation errors', allErrors);
      logger.log(`🔄 Self-healing attempt ${attempts}/${selfHealingOptions.maxAttempts}`);
    }

    const llmResult = await callLLM(messages, processedImages.length > 0 ? processedImages : undefined, { provider, model });
    const claudeResponse = llmResult.content;

    // Truncated responses can't validate — ask the model to complete the block.
    //
    // The retry used to say "keeping the implementation as concise as possible",
    // which is exactly backwards for the compositions most likely to truncate.
    // A dashboard or CRM view gets cut off precisely because it is large, and
    // telling the model to shrink it trades a truncated good answer for a
    // complete lesser one — the user asked for the dashboard. Instruct it to
    // economise on repetition instead, and preserve every region.
    if (llmResult.truncated && attempts < selfHealingOptions.maxAttempts) {
      logger.warn('⚠️ LLM response was truncated at the token limit, requesting a complete block');
      messages.push({ role: 'assistant', content: claudeResponse });
      messages.push({
        role: 'user',
        content: [
          'Your previous response was cut off before the code block was complete.',
          'Regenerate the FULL story in a single complete code block.',
          '',
          'Keep every region and feature that was requested — do NOT drop sections or',
          'simplify the composition to fit. Save space by removing repetition instead:',
          '- lift repeated markup into a small local sub-component or a .map() over a data array',
          '- move long literal content into a const array above the story',
          '- keep sample data short (3-5 rows is enough to show the pattern)',
          '- omit redundant comments',
        ].join('\n'),
      });
      continue;
    }

    const extractedCode = extractCodeBlock(claudeResponse, detectedFramework);
    if (extractedCode) {
      // Only kept when the story actually imports it — an unreferenced
      // stylesheet is just litter in the user's repository.
      generatedStylesheet = extractStylesheet(claudeResponse, extractedCode);
    }
    if (!extractedCode) {
      aiText = claudeResponse;
      if (attempts < selfHealingOptions.maxAttempts) {
        messages.push({ role: 'assistant', content: aiText });
        messages.push({ role: 'user', content: 'You did not provide a code block. Please provide the complete story in a single `tsx` code block.' });
        continue;
      }
      break;
    }
    aiText = extractedCode;

    // Step 5: Validation (pattern + AST + imports)
    events.onProgress?.(5, totalSteps, 'validating', 'Validating generated code...');

    const patternErrors = validateStory(aiText);

    const validationFileName = `story${frameworkAdapter.defaultExtension || '.stories.tsx'}`;
    let astResult: ValidationResult | null = null;
    try {
      astResult = validateStoryCode(aiText, validationFileName, config);
      if (astResult.fixedCode) {
        aiText = astResult.fixedCode;
        logger.log('🔧 Auto-fix applied for syntax issues');
      }
    } catch (astError) {
      logger.error('AST validation error:', astError);
    }
    lastAstResult = astResult;

    const importValidation = detectedFramework === 'web-components'
      ? { isValid: true, errors: [] }
      : await preValidateImports(aiText, config, discovery);
    // Isolation runs for EVERY framework: generated code may only import from
    // the configured library, framework runtime, and explicit allowances.
    const isolationErrors = validateImportIsolation(aiText, config, detectedFramework, considerationsText, components as any);
    // A resolving specifier is not an existing binding: verified against the
    // module on disk, for relative imports where that answer is certain.
    const namedImportErrors = validateLocalNamedImports(
      aiText, path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated'), components as any,
    );
    const importErrors = [
      ...(importValidation.isValid ? [] : importValidation.errors),
      ...isolationErrors,
      ...namedImportErrors,
    ];

    const currentErrors = aggregateValidationErrors(astResult, patternErrors, importErrors);
    errorHistory.push(currentErrors);
    allAttempts.push({ code: aiText, errors: currentErrors });

    if (hasNoErrors(currentErrors)) {
      logger.log('✅ Validation passed on attempt', attempts);
      events.onValidation?.({
        isValid: true,
        errors: [],
        warnings: [],
        autoFixApplied: !!astResult?.fixedCode,
      });
      finalErrors = currentErrors;
      break;
    }

    logger.log(`⚠️ Attempt ${attempts} validation errors: ${formatErrorsForLog(currentErrors)}`);
    events.onValidation?.({
      isValid: false,
      errors: [
        ...currentErrors.syntaxErrors,
        ...currentErrors.patternErrors,
        ...currentErrors.importErrors,
      ],
      warnings: [],
      autoFixApplied: !!astResult?.fixedCode,
    });

    finalErrors = currentErrors;

    const retryDecision = shouldContinueRetrying(attempts, selfHealingOptions.maxAttempts, errorHistory);
    if (!retryDecision.shouldRetry) {
      logger.log(`🛑 Stopping retries: ${retryDecision.reason}`);
      break;
    }

    const healingPrompt = buildSelfHealingPrompt(aiText, currentErrors, attempts, selfHealingOptions);
    messages.push({ role: 'assistant', content: claudeResponse });
    messages.push({ role: 'user', content: healingPrompt });
  }

  // Select best attempt if we still have errors
  if (!hasNoErrors(finalErrors) && allAttempts.length > 0) {
    const bestAttempt = selectBestAttempt(allAttempts);
    if (bestAttempt) {
      aiText = bestAttempt.code;
      finalErrors = bestAttempt.errors;
      logger.log(`📌 Selected best attempt with ${getTotalErrorCount(finalErrors)} errors`);
    }
  }
  if (selfHealingUsed) {
    logger.log(`🔄 Self-healing summary: ${attempts} attempts, final errors: ${formatErrorsForLog(finalErrors)}`);
  }

  // Step 6: Code extraction and final processing
  events.onProgress?.(6, totalSteps, 'code_extracted', 'Processing generated code...');

  if (finalErrors.importErrors.length > 0) {
    logger.log(`❌ Import validation failed. Invalid components: ${finalErrors.importErrors.join(', ')}`);
    throw new GenerationError('INVALID_IMPORTS', 'Generated code contains invalid imports', {
      httpStatus: 422,
      details: finalErrors.importErrors.join('; '),
      recoverable: true,
      suggestion: buildComponentSuggestion(components),
    });
  }

  const validationResult = extractAndValidateCodeBlock(aiText, config);
  let fileContents: string;
  let hasValidationWarnings = false;
  let isFallbackStory = false;

  if (!validationResult.isValid && !validationResult.fixedCode) {
    fileContents = createFrameworkAwareFallbackStory(prompt, cleanPromptForTitle(prompt), config, detectedFramework);
    hasValidationWarnings = true;
    isFallbackStory = true;
    events.onValidation?.({
      isValid: false,
      errors: validationResult.errors || [],
      warnings: ['Using fallback template due to validation failures'],
      autoFixApplied: false,
    });
  } else if (validationResult.fixedCode) {
    fileContents = validationResult.fixedCode;
    hasValidationWarnings = true;
    events.onValidation?.({
      isValid: true,
      errors: [],
      warnings: validationResult.warnings || [],
      autoFixApplied: true,
      fixDetails: ['Applied automatic corrections to fix validation errors'],
    });
  } else {
    fileContents = extractCodeBlock(aiText, detectedFramework) || aiText.trim();
    if (validationResult.warnings?.length) {
      hasValidationWarnings = true;
    }
  }

  // Step 7: Post-processing
  events.onProgress?.(7, totalSteps, 'post_processing', 'Applying finishing touches...');

  // Title generation
  let aiTitle: string;
  if (isActualUpdate && originalTitle) {
    aiTitle = originalTitle;
  } else if (isActualUpdate && conversation) {
    const originalPrompt = conversation.find((msg) => msg.role === 'user')?.content || prompt;
    aiTitle = await getLLMTitle(originalPrompt);
    events.onLLMCall?.();
  } else {
    aiTitle = await getLLMTitle(prompt);
    events.onLLMCall?.();
  }
  if (!aiTitle || aiTitle.length < 2) {
    aiTitle = cleanPromptForTitle(prompt);
  }

  // IDs
  const fileExtension = frameworkAdapter.defaultExtension || '.stories.tsx';
  let hash: string;
  let finalFileName: string;
  let storyId: string;

  if (isActualUpdate && (fileName || providedStoryId)) {
    if (providedStoryId) {
      storyId = providedStoryId;
      const hashMatch = providedStoryId.match(/^story-([a-f0-9]{8})$/);
      hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
    } else {
      const hashMatch = fileName?.match(/-([a-f0-9]{8})(?:\.stories\.\w+)?$/);
      hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
      storyId = `story-${hash}`;
    }
    finalFileName = fileName || fileNameFromTitle(aiTitle, hash, fileExtension);
  } else {
    const timestamp = Date.now();
    hash = crypto.createHash('sha1').update(prompt + timestamp).digest('hex').slice(0, 8);
    finalFileName = fileName || fileNameFromTitle(aiTitle, hash, fileExtension);
    storyId = `story-${hash}`;
  }

  const prettyPrompt = escapeTitleForTS(aiTitle);
  const cleanTitle = isActualUpdate ? prettyPrompt : storyTracker.getNextVersionTitle(prettyPrompt);
  if (cleanTitle !== prettyPrompt) {
    logger.log(`📋 Title "${prettyPrompt}" already exists, using "${cleanTitle}" instead`);
  }
  const storyIdSlug = `${cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${hash}`;

  // Finalizer applied to the initial code AND any runtime-healed regeneration,
  // so both go through identical title/prefix/id/import treatment.
  const finalizeStoryCode = (code: string): { code: string; finalValidationErrors: string[] } => {
    let fixed = postProcessStory(code, config.importPath);
    fixed = frameworkAdapter.postProcess(fixed);
    fixed = applyTitleAndId(fixed, cleanTitle, storyIdSlug, config.storyPrefix);
    fixed = alignStorybookTypesImport(fixed, config.storybookFramework);

    // Final validation after ALL post-processing — catches syntax errors
    // introduced by regex-based transforms.
    const finalValidation = validateStoryCode(fixed, finalFileName, config);
    if (finalValidation.fixedCode) {
      fixed = finalValidation.fixedCode;
    }

    // Barrel → individual imports when configured (must run after validation,
    // which can rewrite the code).
    if (config.importPath && (config as any).importStyle === 'individual') {
      fixed = fixBarrelImports(
        fixed,
        config.importPath,
        (config as any).importStyle,
        (config as any).componentsPath,
        components
      );
    }

    return {
      code: fixed,
      finalValidationErrors: finalValidation.isValid || finalValidation.fixedCode ? [] : (finalValidation.errors || []),
    };
  };

  if (finalFileName && !finalFileName.endsWith(fileExtension)) {
    finalFileName = finalFileName + fileExtension;
  }

  const finalized = finalizeStoryCode(fileContents);
  let fixedFileContents = finalized.code;
  if (finalized.finalValidationErrors.length > 0) {
    logger.log('⚠️ Post-processing introduced syntax errors:', finalized.finalValidationErrors);
    throw new GenerationError('POST_PROCESSING_ERROR', 'Story generation failed due to post-processing errors', {
      httpStatus: 500,
      details: finalized.finalValidationErrors.join('; '),
      recoverable: false,
      suggestion: 'This is a bug in Story UI. Please report this issue with your prompt.',
    });
  }

  // Step 8: Save story
  events.onProgress?.(8, totalSteps, 'saving', 'Saving your story...');

  // A story may come with a stylesheet — inline style cannot express hover,
  // focus-visible or active states, so anything with real interaction needs one.
  // generatedStylesheet is captured from the model response below.
  const writeStory = (code: string): string => {
    const dir = path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated/');
    const { storyPath } = writeStoryArtifacts({
      dir,
      fileName: finalFileName,
      code,
      css: generatedStylesheet,
    });
    // Collect stylesheets whose story was removed by any of the many delete
    // paths that know nothing about them.
    sweepOrphanedArtifacts(dir);
    return storyPath;
  };

  let outPath = writeStory(fixedFileContents);

  // --- Runtime validation, wired into the healing loop ---
  // Requires the file on disk (Storybook must rebuild it), so it runs after
  // the first write; a failure triggers one bounded regeneration attempt.
  const runtimeEnabled = isRuntimeValidationEnabled();
  let runtimeResult: RuntimeValidationResult = { success: true, storyExists: true } as RuntimeValidationResult;
  let runtimeHealed = false;

  if (runtimeEnabled && !isFallbackStory) {
    try {
      runtimeResult = await validateStoryRuntime(fixedFileContents, aiTitle, config.storyPrefix);
      // Only spend a healing LLM call on genuine in-Storybook failures.
      // Infrastructure problems (Storybook not running, story not indexed
      // yet, timeouts) are not code errors and can't be healed.
      const isCodeFailure = !runtimeResult.success &&
        (runtimeResult.errorType === 'module_error' || runtimeResult.errorType === 'render_error');
      if (!runtimeResult.success && !isCodeFailure) {
        logger.warn(`⚠️ Runtime validation inconclusive (${runtimeResult.errorType}): ${runtimeResult.renderError} — skipping healing`);
      }
      if (isCodeFailure) {
        logger.error(`❌ Runtime validation failed: ${runtimeResult.renderError}`);
        events.onRetry?.(attempts + 1, selfHealingOptions.maxAttempts + 1,
          'Story crashed in Storybook — regenerating with the runtime error', [runtimeResult.renderError || 'runtime error']);

        const healed = await attemptRuntimeHealing({
          runtimeResult,
          messages,
          images: processedImages,
          provider,
          model,
          framework: detectedFramework,
          adapter: frameworkAdapter,
          config,
          discovery,
          considerationsText,
          finalizeStoryCode,
          events,
        });

        if (healed) {
          fixedFileContents = healed;
          outPath = writeStory(fixedFileContents);
          selfHealingUsed = true;
          try {
            runtimeResult = await validateStoryRuntime(fixedFileContents, aiTitle, config.storyPrefix);
            runtimeHealed = runtimeResult.success;
          } catch {
            // Leave the last known result in place.
          }
          logger.log(runtimeHealed
            ? '✅ Runtime healing succeeded — story now loads in Storybook'
            : '⚠️ Runtime healing attempt did not resolve the error');
        }
        if (!runtimeResult.success) {
          hasValidationWarnings = true;
        }
      } else if (runtimeResult.success) {
        logger.info('✅ Runtime validation passed - story loads correctly in Storybook');
      }
    } catch (runtimeErr: any) {
      logger.warn(`⚠️ Runtime validation could not complete: ${runtimeErr.message}`);
    }
  }

  // --- Browser verification (report-only) ---
  // The legacy check above fetches iframe.html as TEXT and regexes it. Storybook
  // renders client-side, so that response is byte-identical for a real story, a
  // bogus id, and no id at all (verified by md5) — it cannot observe anything.
  // This actually renders the story in the host project's own Playwright, walks
  // the DOM, and reports what it finds.
  //
  // Deliberately does NOT trigger repair yet: the probes must be shown
  // trustworthy before they are allowed to spend an LLM call. Producing a false
  // blocker here would make the model damage correct code.
  let verification: VerifyReport | undefined;
  if (!isFallbackStory) {
    try {
      const verifyUrl = config.storybookMcpUrl || storybookUrl || getStorybookUrl();
      if (verifyUrl) {
        verification = await verifyStory({
          storybookUrl: verifyUrl,
          storyIdPrefix: storyIdSlug,
          title: cleanTitle,
          projectRoot: process.cwd(),
        });
        // Enforce mode: repair what the browser observed.
        //
        // Gated on STORY_UI_VERIFY_ENFORCE because it spends an extra LLM call
        // and, unlike report-only, can change the user's story. The repair
        // helper refuses to ship anything that does not strictly reduce
        // blockers, so the worst case is a wasted call rather than a damaged
        // composition.
        const enforce = process.env.STORY_UI_VERIFY_ENFORCE === 'true';
        if (enforce && verification.outcome === 'issues') {
          const repair = await attemptVerificationRepair({
            code: fixedFileContents,
            report: verification,
            staticallyValid: (candidate) => {
              const patternErrors = validateStory(candidate);
              const ast = validateStoryCode(candidate, finalFileName, config);
              return patternErrors.length === 0 && ast.isValid;
            },
            callModel: async (prompt) => {
              events.onLLMCall?.();
              // Fresh, minimal context — not the growing generate transcript.
              const result = await callLLM([{ role: 'user', content: prompt }], undefined, { provider, model });
              return extractCodeBlock(result.content, detectedFramework);
            },
            writeAndVerify: async (candidate) => {
              const { code: finalized } = finalizeStoryCode(candidate);
              writeStory(finalized);
              return verifyStory({
                storybookUrl: verifyUrl,
                storyIdPrefix: storyIdSlug,
                title: cleanTitle,
                projectRoot: process.cwd(),
              });
            },
          });

          if (repair.code) {
            const { code: finalized } = finalizeStoryCode(repair.code);
            fixedFileContents = finalized;
            outPath = writeStory(fixedFileContents);
            verification = repair.report;
            selfHealingUsed = true;
            logger.log(`✅ Verification repair applied after ${repair.attempts} attempt(s)`);
          } else {
            // Restore the original on disk — writeAndVerify may have left a
            // rejected candidate there.
            writeStory(fixedFileContents);
            if (repair.note) logger.log(`ℹ️ No verification repair applied: ${repair.note}`);
          }
        }

        if (verification.outcome === 'issues') {
          hasValidationWarnings = true;
        }
      }
    } catch (verifyErr: any) {
      // Verification is observational; never let it fail a generation.
      logger.warn(`⚠️ Verification could not complete: ${verifyErr?.message ?? verifyErr}`);
    }
  }

  // Register with tracker
  const mapping: StoryMapping = {
    title: cleanTitle,
    fileName: finalFileName,
    storyId,
    hash,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prompt,
  };
  storyTracker.registerStory(mapping);

  const analysis = analyzeGeneratedCode(fixedFileContents, prompt, config);

  // Conversational reply + follow-up suggestions (model-authored). Computed
  // BEFORE the manifest upsert so the assistant's reply is persisted
  // server-side — the panel lives in Storybook's preview iframe, which can
  // reload when the new story file lands, killing the in-flight SSE stream.
  let chatSummary: string | undefined;
  let suggestions: string[] | undefined;
  if (!isFallbackStory) {
    const conversational = await generateChatSummary({
      prompt,
      isUpdate: isActualUpdate,
      title: cleanTitle,
      componentsUsed: analysis.componentsUsed.map(c => c.name),
      framework: detectedFramework,
      provider,
      model,
    });
    chatSummary = conversational?.summary;
    suggestions = conversational?.suggestions;
    if (chatSummary) events.onLLMCall?.();
  }
  if (!suggestions?.length) {
    suggestions = isFallbackStory
      ? ['Story generation failed. Please try rephrasing your request.']
      : hasValidationWarnings
        ? ['Some automatic fixes were applied. Review the generated code.']
        : undefined;
  }

  const storybookId = computeStorybookId(fixedFileContents, storyIdSlug);

  // Manifest upsert — links the story file to its chat conversation. The
  // assistant reply is appended server-side so the conversation survives even
  // if the panel never receives the completion event.
  try {
    const manifestConversation = (conversation ?? [])
      .filter((m) => (m.role === 'user' || m.role === 'ai') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role as 'user' | 'ai', content: m.content }));
    if (manifestConversation.length > 0 && !isFallbackStory) {
      const replyHeader = `[SUCCESS] **${isActualUpdate ? 'Updated' : 'Created'}: "${cleanTitle}"**`;
      const replyBody = chatSummary
        || `${isActualUpdate ? 'Updated' : 'Created'} this story based on your request.`;
      manifestConversation.push({ role: 'ai', content: `${replyHeader}\n\n${replyBody}` });
    }
    getManifestManager().upsert(finalFileName, {
      id: storyIdSlug,
      title: cleanTitle,
      source: manifestConversation.length > 0 ? 'panel' : 'mcp-external',
      conversation: manifestConversation,
      metadata: {
        provider: provider ?? undefined,
        model: model ?? undefined,
        prompt,
        // Full completion payload so a panel that reloaded mid-generation
        // (or reopens this chat later) can restore code/timing/suggestions.
        lastCompletion: isFallbackStory ? undefined : {
          code: fixedFileContents.slice(0, 60_000),
          suggestions: suggestions?.slice(0, 5),
          generationTimeMs: Date.now() - startedAt,
          storybookId,
        },
      },
    });
  } catch (manifestErr) {
    logger.warn('[manifest] upsert error (non-fatal):', manifestErr);
  }

  // History
  historyManager.addVersion(finalFileName, prompt, fixedFileContents, parentVersionId);

  // URL redirect when an update renamed the story
  if (isActualUpdate && oldTitle && oldStoryUrl) {
    const newTitleMatch = fixedFileContents.match(/title:\s*["']([^"']+)['"]/);
    if (newTitleMatch) {
      const newTitle = newTitleMatch[1];
      const cleanNewTitle = newTitle.replace(config.storyPrefix, '');
      const cleanOldTitle = oldTitle.replace(config.storyPrefix, '');
      const newStoryUrl = `/story/${cleanNewTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}--primary`;
      if (oldStoryUrl !== newStoryUrl) {
        redirectService.addRedirect(oldStoryUrl, newStoryUrl, cleanOldTitle, cleanNewTitle, storyId);
      }
    }
  }

  return {
    success: !isFallbackStory,
    isFallbackStory,
    title: cleanTitle,
    fileName: finalFileName,
    storyId,
    outPath,
    code: fixedFileContents,
    isUpdate: isActualUpdate,
    analysis,
    validation: {
      hasWarnings: hasValidationWarnings,
      errors: [
        ...finalErrors.syntaxErrors,
        ...finalErrors.patternErrors,
        ...finalErrors.importErrors,
        ...(validationResult?.errors || []),
      ],
      warnings: validationResult?.warnings || [],
      selfHealingUsed,
      attempts,
      autoFixApplied: !!validationResult?.fixedCode || !!lastAstResult?.fixedCode,
      isFallback: isFallbackStory,
    },
    runtimeValidation: {
      enabled: runtimeEnabled,
      success: runtimeResult.success,
      storyExists: runtimeResult.storyExists,
      error: runtimeResult.renderError,
      errorType: runtimeResult.errorType,
      details: runtimeResult.details,
      healedByRetry: runtimeHealed || undefined,
    },
    chatSummary,
    suggestions,
    storybookId,
    verification,
  };
}

/**
 * Compute the Storybook component ID for the generated story. When we injected
 * a meta `id:` it is authoritative; otherwise (e.g. Svelte defineMeta) the ID
 * derives from the title the same way Storybook sanitizes it.
 */
function computeStorybookId(code: string, storyIdSlug: string): string {
  const escapedSlug = storyIdSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`id:\\s*['"]${escapedSlug}['"]`).test(code)) {
    return storyIdSlug;
  }
  const titleMatch = code.match(/title:\s*["']([^"']+)["']/);
  if (!titleMatch) return storyIdSlug;
  return titleMatch[1]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ============================================================
// Framework resolution
// ============================================================

async function resolveFramework(
  requested: string | undefined,
  config: any,
  autoDetect: boolean | undefined
): Promise<FrameworkType> {
  if (requested) {
    logger.log(`🎯 Using explicit framework from request: ${requested}`);
    return requested as FrameworkType;
  }
  if (config.componentFramework) {
    logger.log(`🎯 Using framework from config.componentFramework: ${config.componentFramework}`);
    return config.componentFramework as FrameworkType;
  }
  if (config.framework) {
    logger.log(`🎯 Using framework from config.framework: ${config.framework}`);
    return config.framework as FrameworkType;
  }
  if (autoDetect) {
    try {
      const detected = await detectProjectFramework(process.cwd());
      logger.log(`🎯 Auto-detected framework: ${detected}`);
      return detected;
    } catch (error) {
      logger.error('Failed to auto-detect framework and no framework configured', { error });
      throw new GenerationError('FRAMEWORK_DETECTION_FAILED', 'Could not auto-detect framework', {
        httpStatus: 400,
        details: 'Please set componentFramework in story-ui.config.js or pass framework in the request.',
        recoverable: false,
        suggestion: 'Add componentFramework: "react" (or vue, angular, svelte, web-components) to your story-ui.config.js',
      });
    }
  }
  logger.warn('⚠️ No framework configured, defaulting to React. Consider setting componentFramework in story-ui.config.js');
  return 'react';
}

// ============================================================
// Prompt assembly
// ============================================================

const VOICE_MODE_PREAMBLE = `
VOICE MODE CONTEXT:
The user is dictating UI changes by voice. They are building or modifying an interface incrementally through speech.

CRITICAL VOICE MODE RULES:
- When updating an existing story, modify ONLY what the user asked for and preserve everything else.
- Respond to spatial/structural commands like "move X above Y", "put X next to Y", "swap X and Y".
- Respond to property changes like "make the button red", "change the title to Welcome", "make it bigger".
- Respond to additions like "add a sidebar", "put a search bar at the top", "add three cards below the header".
- Respond to removals like "remove the footer", "delete the second card", "get rid of the image".
- Keep all existing components, imports, and structure intact unless the user explicitly asks to change them.
- Maintain the existing story title and metadata — only modify the rendered JSX/template.
`;

/**
 * Insert a context section immediately before the final "User request:" line.
 * Uses lastIndexOf (the actual request section is always last) and appends as
 * a fallback, so a "User request:" string appearing inside component docs or
 * the user's own prompt can no longer hijack the injection point.
 */
function injectBeforeUserRequest(prompt: string, section: string): string {
  const marker = 'User request:';
  const idx = prompt.lastIndexOf(marker);
  if (idx === -1) {
    logger.warn('Prompt has no "User request:" marker — appending context section at the end');
    return `${prompt}\n\n${section}`;
  }
  return `${prompt.slice(0, idx)}${section}\n\n${prompt.slice(idx)}`;
}

async function buildClaudePromptWithContext(
  userPrompt: string,
  config: any,
  conversation: Array<{ role: string; content: string }> | undefined,
  previousCode: string | undefined,
  components: any[],
  options: {
    framework: FrameworkType;
    visionMode?: VisionPromptType;
    designSystem?: string;
    considerations?: string;
    storybookContext?: StorybookMcpContext;
    /** Prose description of the element the user pointed at, if any. */
    selection?: string;
    /** Where this project's Storybook is served, so its own stories can be read. */
    storybookUrl?: string;
  }
): Promise<string> {
  const frameworkOptions: StoryGenerationOptions = { framework: options.framework };
  let prompt = await buildFrameworkAwarePrompt(userPrompt, config, components, frameworkOptions);

  if (options.visionMode) {
    const visionPrompts = buildVisionAwarePrompt({
      promptType: options.visionMode,
      userDescription: userPrompt,
      availableComponents: components.map((c: any) => c.name),
      framework: options.framework,
      designSystem: options.designSystem,
    });
    prompt = `${visionPrompts.systemPrompt}\n\n---\n\n${prompt}\n\n---\n\n${visionPrompts.userPrompt}`;
  }

  // NOTE ON ORDERING: injectBeforeUserRequest splices each block in immediately
  // above "User request:", so the LAST block injected ends up CLOSEST to the
  // request — the strongest position. Background material (bundled docs, the
  // Storybook exemplar pool) is injected first; the project's own considerations
  // go last so they can out-argue anything above them. Previously considerations
  // went first and the exemplar pool sat closest, which inverted the priority.
  const documentation = getDocumentation(config.importPath);
  if (documentation) {
    const bundledEnhancement = `📚 BUNDLED DOCUMENTATION:\n${Object.entries(documentation.components || {}).map(([name, info]: [string, any]) => {
      if (components.some((c: any) => c.name === name)) {
        return `- ${name}: ${info.description || 'Component available'}`;
      }
      return null;
    }).filter(Boolean).join('\n')}`;
    prompt = injectBeforeUserRequest(prompt, bundledEnhancement);
  }

  // Compound structure reflected from the installed package. The flat component
  // catalog cannot express that MenuTarget/MenuDropdown are Menu.Target and
  // Menu.Dropdown, so the model was relying on recollection of the library —
  // precisely the knowledge that is wrong for a private or updated design system.
  try {
    const reflected = await reflectDesignSystem(config.importPath, process.cwd(), {
      framework: options.framework,
    });
    if (reflected) {
      const compoundRef = formatCompoundReference(reflected);
      if (compoundRef) prompt = injectBeforeUserRequest(prompt, compoundRef);
    }
  } catch {
    // Reflection is an enhancement; generation proceeds without it.
  }

  if (options.storybookContext?.available) {
    const storybookContextStr = formatStorybookContext(options.storybookContext);
    if (storybookContextStr) {
      logger.log('📚 Injecting Storybook MCP context into prompt');
      prompt = injectBeforeUserRequest(prompt, storybookContextStr);
    }
  }

  // What the team's own Storybook says about their design system — FALLBACK.
  //
  // Read from the story files directly, for Storybooks that do not expose a
  // components manifest (addon-mcp is recent; most projects will not have it).
  // Same idea, cruder execution: the flat catalog is 237 scraped export names
  // with no props and no examples, while this is the team's real code for the
  // components they actually document.
  //
  // Only when Storybook's own components manifest is unavailable. When it IS
  // available it supplies the same knowledge better — Storybook normalises the
  // CSF wrapper into runnable code with resolved imports, and covers far more
  // components than the story files we can usefully read ourselves. Injecting
  // both would spend context twice to say the same thing.
  const manifestSuppliedDocs = Boolean(
    options.storybookContext?.available && options.storybookContext?.componentDocs
      && Object.keys(options.storybookContext.componentDocs).length > 0,
  );
  if (options.storybookUrl && !manifestSuppliedDocs) {
    try {
      const catalog = await fetchStorybookCatalog({
        storybookUrl: options.storybookUrl,
        projectRoot: process.cwd(),
      });
      if (catalog.length) {
        // Ranked, not dumped. Sending every example would reintroduce the
        // problem the flat catalog already has: a wall of context in which the
        // relevant component is no more prominent than the rest.
        const relevant = rankByRelevance(catalog, userPrompt, 10);
        const section = formatCatalogForPrompt(relevant, process.cwd());
        if (section) prompt = injectBeforeUserRequest(prompt, section);
      }
    } catch {
      // Prompt enhancement only — a generation must still work without it.
    }
  }

  // How this project expresses spacing, colour and shape.
  //
  // Measured across 48 generated stories in a Tailwind project declaring 119
  // tokens: 607 raw pixel values, 103 raw hex colours, zero token uses. Well
  // built components carry their own styling, so this leaks in the connective
  // tissue between them — page padding, grid gaps, max-widths — which is
  // exactly where a hardcoded number marks a composition as foreign to the
  // design system that owns it.
  try {
    const styling = readStylingFacts(process.cwd(), (config.generatedStoriesPath || '')
      .replace(/^\.\//, '').replace(/\/+$/, '').split('/').pop() || 'generated',
      config.importPath);
    const guidance = formatStylingGuidance(styling);
    if (guidance) {
      logger.log(`🎨 Injecting styling guidance: ${styling.idiom.attributes[0]?.name ?? 'no idiom'} idiom, ${styling.tokens.reduce((n, g) => n + g.names.length, 0)} token(s)`);
      prompt = injectBeforeUserRequest(prompt, guidance);
    }
  } catch (error) {
    logger.log(`⚠️ Could not read styling facts: ${error}`);
  }

  // A pointed-at element, injected just above the considerations so the
  // project's own rules still win, but below everything generic.
  //
  // The scoping instruction matters as much as the target. An update rewrites
  // the whole story file, so without it a request to recolour one icon can
  // quietly restructure a dashboard that was already correct — observed: an
  // edit introduced a verification blocker into a composition that had none.
  if (options.selection) {
    logger.log(`🎯 Scoping the edit to: ${options.selection}`);
    prompt = injectBeforeUserRequest(prompt, [
      '🎯 TARGETED EDIT — the user selected a specific element in the rendered preview:',
      `  ${options.selection}`,
      '',
      'The request below applies to THAT element. Find it in the code using the',
      'component name and the quoted text, which appear verbatim in the source.',
      'Change only what the request asks for on that element.',
      'Reproduce the ENTIRE rest of the file byte-for-byte: same components, same',
      'props, same layout, same copy, same order. Do not "improve" anything you',
      'were not asked about, and do not drop code to save space.',
      'If the element cannot be found, say so in your summary rather than guessing.',
    ].join('\n'));
  }

  // Injected LAST so it sits directly above the user request — the project's own
  // rules must be able to override every generic instruction above them.
  if (options.considerations) {
    logger.log('📋 Injecting client-provided design system considerations into prompt');
    prompt = injectBeforeUserRequest(prompt,
      `📋 DESIGN SYSTEM CONSIDERATIONS (project-specific rules — these OVERRIDE any conflicting general guidance, including any example code shown above):\n${options.considerations}`);
  }

  if (!conversation || conversation.length <= 1) {
    return prompt;
  }

  const conversationContext = conversation
    .slice(0, -1)
    .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n\n');

  let contextSection = `CONVERSATION CONTEXT (for modifications/updates):\n${conversationContext}`;
  if (previousCode) {
    contextSection += `\n\nPREVIOUS GENERATED CODE (this is what you're modifying):\n\`\`\`tsx\n${previousCode}\n\`\`\`\n\nCRITICAL INSTRUCTIONS FOR MODIFICATIONS:\n1. DO NOT regenerate the entire story from scratch\n2. PRESERVE all existing styling, components, and structure\n3. ONLY change what the user specifically requests`;
  }

  const marker = 'User request:';
  const idx = prompt.lastIndexOf(marker);
  if (idx === -1) {
    return `${prompt}\n\n${contextSection}\n\nIMPORTANT: The user is asking to modify/update the story based on the above conversation.\n\nCurrent modification request:\n${userPrompt}`;
  }
  return `${prompt.slice(0, idx)}${contextSection}\n\nIMPORTANT: The user is asking to modify/update the story based on the above conversation.\n\nCurrent modification request:${prompt.slice(idx + marker.length)}`;
}

// ============================================================
// LLM interaction
// ============================================================

/**
 * Stream the model's output so the longest phase of a generation is not silent.
 *
 * NOT YET WIRED INTO THE GENERATION LOOP, deliberately.
 *
 * The provider layer has always exposed a token stream (base-provider's
 * chatStream, implemented by claude-provider), and the generation core only ever
 * called the buffered path — leaving a ~30s window where the UI could say
 * nothing truer than "AI is generating your story...". Closing that window is
 * worth doing.
 *
 * The blocker is truncation. chatCompletionStream does not surface stop_reason,
 * so this helper has to INFER truncation from unbalanced code fences, whereas
 * the buffered path reads it from the provider. Swapping the call site would
 * trade a reliable signal for a guess on precisely the large compositions
 * (dashboards, CRM views) most likely to truncate — the case the output-ceiling
 * work earlier fixed.
 *
 * The correct sequence is: surface stop_reason through chatStream and the
 * service generator, then swap the call site, then extend the integration mocks.
 * Until then the buffered path stays authoritative.
 */
/** The selected model's real output ceiling, shared by both LLM paths. */
function providerMaxTokens(provider?: string, model?: string): number {
  return getProviderInfo({ provider: provider as any, model }).maxOutputTokens ?? 8192;
}

async function callLLMStreaming(
  messages: { role: 'user' | 'assistant'; content: string }[],
  options: { provider?: string; model?: string; maxTokens: number },
  onDelta: (charsWritten: number) => void,
): Promise<{ content: string; truncated: boolean }> {
  let content = '';
  let lastEmit = 0;

  for await (const chunk of chatCompletionStream(messages, {
    provider: options.provider as any,
    model: options.model,
    maxTokens: options.maxTokens,
  })) {
    content += chunk;
    // Throttled: the point is evidence of life, not a character counter.
    const now = Date.now();
    if (now - lastEmit > 250) {
      lastEmit = now;
      onDelta(content.length);
    }
  }
  onDelta(content.length);

  // The streaming path does not surface stop_reason, so infer truncation the
  // same way the retry prompt describes it: the response was cut off before the
  // code block closed. An odd number of fences means the block never ended.
  const fences = (content.match(/```/g) || []).length;
  return { content, truncated: fences > 0 && fences % 2 !== 0 };
}

async function callLLM(
  messages: { role: 'user' | 'assistant'; content: string }[],
  images?: ImageContent[],
  options?: { provider?: string; model?: string }
): Promise<{ content: string; truncated: boolean }> {
  if (!isProviderConfigured()) {
    throw new Error('No LLM provider configured');
  }

  if (options?.provider) {
    logger.log(`🎯 Explicit provider requested: ${options.provider} (model: ${options.model || 'default'})`);
  }

  // Use the selected model's real output ceiling rather than a hardcoded 8192.
  // Sonnet 5 supports 16000, so half its capacity was being discarded — and the
  // compositions the tool most needs to get right (dashboards, CRM views,
  // monitoring layouts) are exactly the ones that truncate, burn a repair
  // attempt, and come back smaller than the user asked for.
  const providerInfo = getProviderInfo({ provider: options?.provider as any, model: options?.model });
  const llmOptions: { provider?: any; model?: string; maxTokens: number } = {
    maxTokens: providerInfo.maxOutputTokens ?? 8192,
    provider: options?.provider,
    model: options?.model,
  };

  if (images && images.length > 0) {
    // Check the provider/model the request actually asked for, not the default.
    const providerInfo = getProviderInfo({ provider: options?.provider as any, model: options?.model });
    if (!providerInfo.supportsVision) {
      throw new Error(
        `${providerInfo.currentProvider} (${providerInfo.currentModel}) does not support vision. ` +
        `Choose a vision-capable model to generate from an image.`
      );
    }
    // Attach to the FIRST user message — that's the one carrying the built
    // prompt. Resolve it by position rather than assuming index 0, so a future
    // system/preamble message can't silently detach the images.
    const targetIndex = messages.findIndex(m => m.role === 'user');
    if (targetIndex === -1) {
      throw new Error('Cannot attach images: no user message in the request');
    }
    const messagesWithImages = messages.map((msg, index) => {
      if (index === targetIndex) {
        return {
          role: msg.role,
          content: buildMessageWithImages(msg.content, images),
        };
      }
      return msg;
    });
    logger.log(`🖼️ Attached ${images.length} image(s) to message ${targetIndex} for ${providerInfo.currentProvider}/${providerInfo.currentModel}`);
    const content = await chatCompletionWithImages(messagesWithImages as any, llmOptions);
    return { content, truncated: false };
  }

  const result = await chatCompletionDetailed(messages, llmOptions);
  return { content: result.content, truncated: result.truncated };
}

/**
 * One bounded regeneration attempt driven by a runtime (in-Storybook) error.
 */
async function attemptRuntimeHealing(args: {
  runtimeResult: RuntimeValidationResult;
  messages: { role: 'user' | 'assistant'; content: string }[];
  images: ImageContent[];
  provider?: string;
  model?: string;
  framework: FrameworkType;
  adapter: FrameworkAdapter;
  config: any;
  discovery: EnhancedComponentDiscovery;
  considerationsText: string;
  finalizeStoryCode: (code: string) => { code: string; finalValidationErrors: string[] };
  events: GenerationEvents;
}): Promise<string | null> {
  const { runtimeResult, messages, images, provider, model, framework, adapter, config, discovery, considerationsText, finalizeStoryCode, events } = args;

  try {
    const healingMessage = formatRuntimeErrorForHealing(runtimeResult);
    messages.push({
      role: 'user',
      content: `The story you generated passed static validation but CRASHES when Storybook renders it.\n\n${healingMessage}\n\nFix the runtime error and respond with the complete corrected story in a single code block. Change only what is needed to fix the crash.`,
    });
    events.onLLMCall?.();

    const llmResult = await callLLM(messages, images.length > 0 ? images : undefined, { provider, model });
    const extracted = extractCodeBlock(llmResult.content, framework);
    if (!extracted) return null;

    // Static re-validation of the healed code
    const patternErrors = validateStory(extracted);
    const astResult = validateStoryCode(extracted, `story${adapter.defaultExtension || '.stories.tsx'}`, config);
    const code = astResult.fixedCode || extracted;
    const importValidation = framework === 'web-components'
      ? { isValid: true, errors: [] }
      : await preValidateImports(code, config, discovery);
    const isolationErrors = validateImportIsolation(
      code, config, framework, considerationsText,
      (discovery?.getDiscoveredComponents?.() ?? []) as any,
    );
    const namedImportErrors = validateLocalNamedImports(
      code, path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated'),
      (discovery?.getDiscoveredComponents?.() ?? []) as any,
    );
    const errors = aggregateValidationErrors(astResult, patternErrors, [
      ...(importValidation.isValid ? [] : importValidation.errors),
      ...isolationErrors,
      ...namedImportErrors,
    ]);
    if (!hasNoErrors(errors)) {
      logger.warn(`⚠️ Runtime-healed code failed static validation: ${formatErrorsForLog(errors)}`);
      return null;
    }

    const finalized = finalizeStoryCode(code);
    if (finalized.finalValidationErrors.length > 0) return null;
    return finalized.code;
  } catch (error) {
    logger.warn('Runtime healing attempt failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Model-authored conversational reply about what was generated, plus
 * follow-up suggestions the panel renders as clickable chips.
 */
async function generateChatSummary(args: {
  prompt: string;
  isUpdate: boolean;
  title: string;
  componentsUsed: string[];
  framework: string;
  provider?: string;
  model?: string;
}): Promise<{ summary: string; suggestions: string[] } | null> {
  try {
    const { prompt, isUpdate, title, componentsUsed, framework, provider, model } = args;
    const result = await chatCompletionDetailed([
      {
        role: 'user',
        content: [
          `You are Story UI, an assistant that just ${isUpdate ? 'updated' : 'created'} a Storybook story called "${title}" for a ${framework} design system.`,
          `The user asked: "${prompt.slice(0, 400)}"`,
          componentsUsed.length > 0 ? `Components used: ${componentsUsed.slice(0, 12).join(', ')}` : '',
          '',
          'Write a short, friendly reply to the user (2-3 sentences, first person) describing what you built and any notable layout or component decisions. Do not include code.',
          'Then on a new line write exactly "SUGGESTIONS:" followed by 3 short follow-up refinement prompts the user might click next, one per line, each under 10 words, phrased as instructions (e.g. "Make the header sticky").',
        ].filter(Boolean).join('\n'),
      },
    ], { provider: provider as any, model, maxTokens: 400 });

    const text = result.content.trim();
    const suggestionIdx = text.indexOf('SUGGESTIONS:');
    if (suggestionIdx === -1) {
      return { summary: text, suggestions: [] };
    }
    const summary = text.slice(0, suggestionIdx).trim();
    const suggestions = text.slice(suggestionIdx + 'SUGGESTIONS:'.length)
      .split('\n')
      .map(s => s.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(s => s.length > 0 && s.length < 80)
      .slice(0, 3);
    return { summary: summary || text, suggestions };
  } catch (error) {
    logger.warn('Chat summary generation failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================
// Code / title helpers
// ============================================================

export function extractCodeBlock(text: string, framework?: string): string | null {
  const codeBlock = text.match(/```(?:tsx|jsx|typescript|ts|js|javascript|svelte|html|vue)?\s*([\s\S]*?)\s*```/i);
  if (codeBlock) {
    return codeBlock[1].trim();
  }

  if (framework === 'svelte') {
    const scriptModuleIndex = text.indexOf('<script module>');
    if (scriptModuleIndex !== -1) {
      return text.slice(scriptModuleIndex).trim();
    }
    const scriptContextIndex = text.indexOf('<script context="module">');
    if (scriptContextIndex !== -1) {
      return text.slice(scriptContextIndex).trim();
    }
  } else if (framework === 'vue') {
    const scriptSetupIndex = text.indexOf('<script setup');
    if (scriptSetupIndex !== -1) {
      return text.slice(scriptSetupIndex).trim();
    }
  }

  const importIndex = text.indexOf('import');
  if (importIndex !== -1) {
    return text.slice(importIndex).trim();
  }
  return null;
}

/**
 * Point the Storybook type-only import at the framework package the project
 * actually depends on.
 *
 * Prompt examples teach `@storybook/react`, but a Vite project only declares
 * `@storybook/react-vite` — the bare package resolves transitively inside
 * Storybook and then fails the moment an engineer lifts the file into the app,
 * which is exactly the workflow this tool exists to serve.
 */
export function alignStorybookTypesImport(code: string, storybookFramework?: string): string {
  // Only these re-export Meta/StoryObj. Anything else (e.g. @storybook/nextjs
  // variants we don't recognise) is left alone rather than guessed at.
  const KNOWN = new Set([
    '@storybook/react-vite',
    '@storybook/react-webpack5',
    '@storybook/nextjs',
    '@storybook/nextjs-vite',
    '@storybook/vue3-vite',
    '@storybook/angular',
    '@storybook/svelte-vite',
    '@storybook/sveltekit',
    '@storybook/web-components-vite',
  ]);
  if (!storybookFramework || !KNOWN.has(storybookFramework)) return code;

  // Rewrite only the generic framework package, never an already-specific one.
  const generic = /(from\s+['"])@storybook\/(react|vue3|svelte|web-components)(['"])/g;
  return code.replace(generic, (match, pre, _fw, post) => {
    return `${pre}${storybookFramework}${post}`;
  });
}

/** Inject storyPrefix into the title and a unique id after it. */
function applyTitleAndId(code: string, cleanTitle: string, storyIdSlug: string, storyPrefix: string): string {
  let fixed = code;
  const titleToUse = cleanTitle.startsWith(storyPrefix) ? cleanTitle : storyPrefix + cleanTitle;

  // Pattern 1: CSF format - const meta = { title: "..." }
  fixed = fixed.replace(
    /(const\s+meta\s*(?::\s*\w+(?:<[^>]+>)?)?\s*=\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
    (_m, p1, _old, p3) => p1 + titleToUse + p3
  );

  // Pattern 2: export default { title: "..." }
  if (!fixed.includes(storyPrefix)) {
    fixed = fixed.replace(
      /(export\s+default\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
      (_m, p1, _old, p3) => p1 + titleToUse + p3
    );
  }

  // Pattern 3: Svelte native format - defineMeta({ title: "..." })
  if (!fixed.includes(storyPrefix)) {
    fixed = fixed.replace(
      /(defineMeta\s*\(\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
      (_m, p1, _old, p3) => p1 + titleToUse + p3
    );
  }

  // Unique story id after the title line. Anchor on the *title line* rather
  // than a bare includes("id:") check, which any `id:` in the user's JSX trips.
  // Skip for Svelte defineMeta: addon-svelte-csf's indexer derives IDs from the
  // title and ignores a custom `id`, so injecting one desyncs index vs runtime
  // ("Couldn't find story matching id ... after importing a CSF file").
  const isDefineMetaFormat = fixed.includes('defineMeta');
  const hasMetaId = /title:\s*["'][^"']+["'],\s*\n\s*id:/.test(fixed);
  if (!hasMetaId && !isDefineMetaFormat) {
    fixed = fixed.replace(
      /(title:\s*["'][^"']+["'])(,?\s*\n)/,
      `$1,\n  id: '${storyIdSlug}'$2`
    );
  }
  return fixed;
}

export function cleanPromptForTitle(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') {
    return 'Untitled Story';
  }
  const leadingPhrases = [
    /^generate (a|an|the)? /i,
    /^build (a|an|the)? /i,
    /^create (a|an|the)? /i,
    /^make (a|an|the)? /i,
    /^design (a|an|the)? /i,
    /^show (me )?(a|an|the)? /i,
    /^add (a|an|the)? /i,
    /^i (want|need|would like) (a|an|the)? /i,
    /^please /i,
    /^can you /i,
  ];
  let cleaned = prompt.trim();
  for (const regex of leadingPhrases) {
    cleaned = cleaned.replace(regex, '');
  }
  return cleaned
    .replace(/[^\w\s'"?!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
    .slice(0, 60);
}

async function getLLMTitle(userPrompt: string): Promise<string> {
  try {
    return await llmGenerateTitle(userPrompt);
  } catch {
    return '';
  }
}

function escapeTitleForTS(title: string): string {
  return title
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function fileNameFromTitle(title: string, hash: string, extension: string = '.stories.tsx'): string {
  if (!title || typeof title !== 'string') {
    title = 'untitled';
  }
  if (!hash || typeof hash !== 'string') {
    hash = 'default';
  }
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/"|'/g, '')
    .slice(0, 60);
  return `${base}-${hash}${extension}`;
}

// ============================================================
// Import validation
// ============================================================

function extractImportsFromCode(code: string, importPath: string): string[] {
  const imports: string[] = [];
  const escapedPath = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Named imports: import { A, B } from 'lib'
  const namedRegex = new RegExp(`import\\s*{([^}]+)}\\s*from\\s*['"]${escapedPath}['"]`, 'g');
  let match;
  while ((match = namedRegex.exec(code)) !== null) {
    const components = match[1].split(',').map(comp => comp.trim()).filter(Boolean);
    imports.push(...components);
  }

  // Default imports of component-looking (capitalized) names:
  // import Button from 'lib' / import Button, { Card } from 'lib'
  const defaultRegex = new RegExp(`import\\s+([A-Z][\\w]*)\\s*(?:,\\s*{[^}]*})?\\s*from\\s*['"]${escapedPath}['"]`, 'g');
  while ((match = defaultRegex.exec(code)) !== null) {
    imports.push(match[1]);
  }

  // Normalize "X as Y" aliases to the exported name X
  return imports.map(name => name.split(/\s+as\s+/)[0].trim()).filter(Boolean);
}

// ============================================================
// Component-library isolation
// ============================================================

/** Root package of an import specifier: '@scope/pkg/sub' → '@scope/pkg', 'pkg/sub' → 'pkg'. */
function importSpecifierRoot(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Per-framework runtime packages that generated stories legitimately need. */
const FRAMEWORK_RUNTIME_ALLOWLIST: Record<string, string[]> = {
  react: ['react', 'react-dom'],
  vue: ['vue'],
  angular: ['@angular/core', '@angular/common', '@angular/forms', '@angular/animations', '@angular/cdk', '@angular/material', 'rxjs'],
  svelte: ['svelte', '@storybook/addon-svelte-csf'],
  'web-components': ['lit', 'lit-html', '@lit/reactive-element'],
};

let _consumerDepsCache: { deps: Set<string>; timestamp: number } | null = null;
function getConsumerDependencies(): Set<string> {
  const now = Date.now();
  if (_consumerDepsCache && now - _consumerDepsCache.timestamp < 60_000) {
    return _consumerDepsCache.deps;
  }
  const deps = new Set<string>();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    for (const key of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      deps.add(key);
    }
  } catch { /* no package.json — no extra info */ }
  _consumerDepsCache = { deps, timestamp: now };
  return deps;
}

/**
 * Is this package provably NOT part of the project?
 *
 * Must answer "no" whenever it cannot see the project, because the caller
 * REJECTS on true. getConsumerDependencies can afford a miss — it only grants
 * allowances, so a wrong answer costs nothing. Inverting that polarity without
 * inverting the failure mode turned a legitimate `@mantine/hooks` import into a
 * validation error the moment cwd was not the consumer project, which is every
 * unit test and any host that runs the server from elsewhere.
 *
 * Two independent sources, either sufficient to acquit: a declared dependency,
 * or a directory on disk (transitive installs are never declared).
 *
 * `anchor` is the design system's own package. If THAT is not visible from
 * here, cwd is not the consumer project — story-ui's own repo is a perfectly
 * valid Node project that simply has no @mantine in it — and nothing in its
 * scope can be judged absent.
 */
function packageIsAbsent(pkgName: string, consumerDeps: Set<string>, anchor: string): boolean {
  const modules = path.join(process.cwd(), 'node_modules');
  const visible = (p: string) => consumerDeps.has(p) || fs.existsSync(path.join(modules, p));
  if (!visible(anchor)) return false;
  return !visible(pkgName);
}

/**
 * Deterministic isolation: every import in generated code must come from the
 * configured component library, the framework runtime, Storybook, configured
 * icon/additional imports, or a package explicitly named in the project's
 * considerations file (the sole escape hatch). Everything else — Tailwind,
 * other UI kits, random npm packages — is rejected and fed to self-healing.
 */
/** Extensions a relative specifier may resolve to, in resolution order. */
const LOCAL_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];

/** An importable specifier for `file`, as written from `fromDir`. */
function relativeSpecifier(fromDir: string, file: string): string {
  let rel = path.relative(fromDir, file).replace(/\\/g, '/');
  rel = rel.replace(/\.(tsx|ts|jsx|js|mjs)$/, '').replace(/\/index$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Resolve a relative specifier to a file the way the bundler would. */
function resolveLocalModule(specifier: string, fromDir: string): string | null {
  const base = path.resolve(fromDir, specifier);
  for (const ext of LOCAL_EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of LOCAL_EXTENSIONS) {
    const indexFile = path.join(base, `index${ext}`);
    if (fs.existsSync(indexFile)) return indexFile;
  }
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

/**
 * Names a module exports, following `export * from` one hop.
 *
 * Deliberately textual. The alternative is a TypeScript program per generated
 * story, which costs more than the whole generation, and the shapes here are
 * the ones a design system actually writes.
 */
function exportedNames(file: string, depth = 0, seen = new Set<string>()): Set<string> {
  const names = new Set<string>();
  if (depth > 2 || seen.has(file)) return names;
  seen.add(file);

  let text: string;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { return names; }

  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const alias = part.split(/\s+as\s+/).pop()?.trim();
      if (alias && /^[A-Za-z_$][\w$]*$/.test(alias)) names.add(alias);
    }
  }
  if (/export\s+default\b/.test(text)) names.add('default');

  // `export * from './Pillbox'` — the names live one file over.
  for (const m of text.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveLocalModule(m[1], path.dirname(file));
    if (target) for (const n of exportedNames(target, depth + 1, seen)) names.add(n);
  }
  return names;
}

/**
 * Does each named import actually exist in the module it is taken from?
 *
 * A specifier that RESOLVES is not the same as a binding that EXISTS, and the
 * gap between them produces the worst failure available: the story compiles,
 * Storybook indexes it, and the browser throws
 *
 *   The requested module '/src/housekit/Datagrid.tsx' does not provide an
 *   export named 'Pillbox'
 *
 * — leaving a blank canvas with no build error. Observed on a local design
 * system where the model wrote one bundled import for four components that
 * live in four files, having correctly imported three of them on the lines
 * below. Every existing check passed it: the components are real, the package
 * is in scope, the path resolves.
 *
 * Scoped to relative imports, where the answer is on disk and certain. npm
 * packages are covered by the catalog's default-export marking and the
 * scope-existence check.
 */
export function validateLocalNamedImports(
  code: string,
  generatedDir: string,
  /** Where discovery says each component lives, to name the right module. */
  components: Array<{ name: string; __componentPath?: string; filePath?: string }> = [],
): string[] {
  const errors: string[] = [];
  /**
   * `[^'"]` for the clause, not `[\s\S]` — an import clause can never contain
   * a quote, and allowing one let the match START at an earlier statement and
   * END at this specifier. `import type { Meta, StoryObj } from
   * '@storybook/react-vite'` followed by a relative import produced
   * "'../../housekit/Datagrid' does not export 'Meta'", and the healing loop
   * could not satisfy it because there was nothing wrong.
   */
  const importRegex = /import\s+(?:([^'"]*?)\s+from\s+)?['"](\.[^'"]+)['"]/g;

  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const clause = match[1] || '';
    const specifier = match[2];

    // Only the braced part: a default import binds any name it likes.
    const braced = clause.match(/\{([^}]*)\}/);
    if (!braced) continue;
    const bindings = braced[1]
      .split(',')
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(s => /^[A-Za-z_$][\w$]*$/.test(s));
    if (bindings.length === 0) continue;

    const file = resolveLocalModule(specifier, generatedDir);
    // An unresolvable relative path is a different fault, already reported by
    // import validation; saying so twice helps nobody.
    if (!file) continue;

    const available = exportedNames(file);
    // A module we could not read anything from tells us nothing. Staying quiet
    // beats inventing an error for every binding in it.
    if (available.size === 0) continue;

    for (const binding of bindings) {
      if (available.has(binding)) continue;
      /**
       * Where this component really lives, as a specifier the model can paste.
       *
       * Local components carry `filePath` (absolute, on disk) and usually no
       * `__componentPath`, so relying on the latter alone meant the correction
       * was never offered for exactly the design systems this check exists to
       * protect — the private ones.
       */
      const known = components.find(c => c.name === binding && (c.__componentPath || c.filePath));
      const home = known && {
        __componentPath: known.__componentPath || relativeSpecifier(generatedDir, known.filePath!),
      };
      /**
       * State the FIX, not just the fault.
       *
       * The first version of this error said only what was wrong. The healing
       * loop took the cheapest route that satisfied it: it deleted the
       * offending components and rebuilt the composition out of the npm
       * library instead, turning a broken story that used four of the
       * project's own components into a working one that used none. That is a
       * worse outcome than the bug, and it was this message that chose it.
       */
      errors.push(
        `Import error: "${specifier}" does not export "${binding}". ` +
        `This compiles but throws at runtime and renders nothing.` +
        (home
          ? `\nFix the PATH — write: import { ${binding} } from '${home.__componentPath}';`
          : `\nImport ${binding} from the exact path shown beside it in the component reference.`) +
        `\nDo NOT remove ${binding} or replace it with something else: it is one of this ` +
        `project's own components and belongs in this composition. Only the import path is wrong.`,
      );
    }
  }
  return errors;
}

export function validateImportIsolation(
  code: string,
  config: any,
  framework: FrameworkType,
  considerationsText: string,
  /** Discovered components, so a wrong import can be told where the real one lives. */
  components: Array<{ name: string; __componentPath?: string }> = [],
): string[] {
  const errors: string[] = [];

  const allowedRoots = new Set<string>();
  const allow = (specifier?: string) => {
    if (specifier) allowedRoots.add(importSpecifierRoot(specifier));
  };

  allow(config.importPath);
  allow(config.iconImports?.package);
  for (const extra of config.additionalImports || []) allow(extra.path);
  for (const extra of (config.allowedImports || [])) allow(extra);
  for (const pkg of FRAMEWORK_RUNTIME_ALLOWLIST[framework] || []) allowedRoots.add(pkg);

  // Same-scope packages ship as one design system family (@mantine/core →
  // @mantine/hooks, @angular/material → @angular/cdk, ...).
  const importScope = config.importPath?.startsWith('@') ? config.importPath.split('/')[0] : null;

  // Collect every static import specifier (named, default, namespace, side-effect),
  // keeping the names each one binds. A rejected import can then be told where
  // ITS OWN components live, rather than the first familiar name in the file.
  const specifiers = new Map<string, string[]>();
  const importRegex = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const bound = (match[1] || '')
      .replace(/[{}]/g, ' ')
      .split(',')
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(s => /^[A-Za-z_$][\w$]*$/.test(s));
    const existing = specifiers.get(match[2]) || [];
    specifiers.set(match[2], [...existing, ...bound]);
  }

  const consumerDeps = getConsumerDependencies();

  for (const [specifier, boundNames] of specifiers) {
    // Relative imports can't smuggle in foreign packages.
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    const root = importSpecifierRoot(specifier);

    if (allowedRoots.has(root)) continue;

    /**
     * Inside the design system's scope, but does the package exist?
     *
     * A scope check alone let `@atlaskit/grid` and `@atlaskit/avatar-context`
     * through — neither is installed. The catalog had told the model the truth
     * (`Grid` is in `@atlaskit/primitives`, `AvatarContext` is in
     * `@atlaskit/avatar`); the model kebab-cased the component name into a
     * package instead, which is the same guess this engine stopped making. The
     * story then failed to render.
     *
     * For a package-per-component design system that prior is strong enough to
     * override an explicit instruction, so prevention is not enough. This turns
     * an unrenderable story into a validation error the healing loop can act
     * on, and names the real package when discovery knows it.
     */
    if (importScope && root.startsWith(importScope + '/')) {
      if (!packageIsAbsent(root, consumerDeps, importSpecifierRoot(config.importPath))) continue;

      // Only the names THIS import binds. Searching the whole file would find
      // `Button` in every story and confidently redirect the wrong import.
      const relocations = boundNames
        .map(name => components.find(c => c.name === name && c.__componentPath))
        .filter((c): c is { name: string; __componentPath: string } =>
          !!c?.__componentPath && c.__componentPath !== specifier);

      errors.push(
        `Import "${specifier}" does not exist — there is no package "${root}" in this project. ` +
        (relocations.length
          ? relocations.map(c => `Import ${c.name} from "${c.__componentPath}" instead. `).join('')
          : '') +
        `Use the exact import path shown next to each component in the component reference; ` +
        `do not derive a package name from a component name.`,
      );
      continue;
    }
    if (root === 'storybook' || root.startsWith('@storybook/')) continue;
    if (root === 'react' && framework === 'react') continue; // react/jsx-runtime etc.
    // Explicitly named in the considerations file → permitted by the project.
    if (considerationsText && considerationsText.includes(root)) continue;

    errors.push(
      `Forbidden import "${specifier}": generated stories may only use components from "${config.importPath}" ` +
      `(plus the framework runtime and configured icon packages). Rebuild this UI using ONLY available components. ` +
      `If "${root}" should be permitted for this project, name it in story-ui-considerations.md.`
    );
  }

  // Tailwind utility-class guard: catches styling hallucinated from another
  // ecosystem, which silently renders as unstyled markup. Skipped when the
  // project actually uses Tailwind (dependency present or library built on it).
  const projectUsesTailwind =
    consumerDeps.has('tailwindcss') ||
    (config.importPath || '').includes('flowbite') ||
    considerationsText.toLowerCase().includes('tailwind');
  if (!projectUsesTailwind) {
    const classAttrs = code.match(/(?:className|class)\s*=\s*["'`]([^"'`]+)["'`]/g) || [];
    const TW_TOKEN = /(?:^|\s)(?:flex|grid|items-center|justify-(?:center|between|start|end)|(?:p|m)[trblxy]?-\d+|gap-\d+|space-[xy]-\d+|text-(?:xs|sm|base|lg|\dxl)|font-(?:bold|semibold|medium)|bg-\w+-\d{2,3}|text-\w+-\d{2,3}|rounded(?:-\w+)?|shadow(?:-\w+)?|w-(?:full|\d+)|h-(?:full|\d+)|border-\w+-\d{2,3})(?=\s|$)/;
    for (const attr of classAttrs) {
      const value = attr.replace(/^(?:className|class)\s*=\s*["'`]/, '').replace(/["'`]$/, '');
      const tokens = value.split(/\s+/);
      const twHits = tokens.filter(t => TW_TOKEN.test(' ' + t)).length;
      if (twHits >= 3) {
        errors.push(
          `Tailwind utility classes detected ("${value.slice(0, 60)}...") but Tailwind is not part of this project — ` +
          `use the design system's own styling props/components instead of utility classes.`
        );
        break;
      }
    }
  }

  return errors;
}

/** Extract PascalCase component tags used in markup/JSX (e.g. <Button ...). */
function extractComponentsFromContent(content: string): string[] {
  const componentMatches = content.match(/<([A-Z][A-Za-z0-9]*)[\s/>]/g);
  if (!componentMatches) return [];
  return Array.from(new Set(componentMatches.map(match => match.replace(/[<\s/>]/g, ''))));
}

export async function preValidateImports(
  code: string,
  config: any,
  discovery: EnhancedComponentDiscovery
): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const componentImports = extractImportsFromCode(code, config.importPath);
  const validation = await discovery.validateComponentNames(componentImports);
  const allowedComponents = new Set<string>(discovery.getAvailableComponentNames());

  for (const importName of componentImports) {
    if (isBlacklistedComponent(importName, allowedComponents, config.importPath)) {
      const errorMsg = getBlacklistErrorMessage(importName, config.importPath);
      errors.push(`Blacklisted component detected: ${errorMsg}`);
    }
  }

  for (const invalidComponent of validation.invalid) {
    const suggestion = validation.suggestions.get(invalidComponent);
    if (suggestion) {
      errors.push(`Invalid component: "${invalidComponent}" does not exist. Did you mean "${suggestion}"?`);
    } else {
      errors.push(`Invalid component: "${invalidComponent}" does not exist.`);
    }
  }

  // Svelte: components used in markup MUST be imported in the script block —
  // an unimported PascalCase tag is a guaranteed runtime crash. (Vue/Angular/Lit
  // templates use kebab-case/global registration, so this check stays inert there.)
  const framework = config.componentFramework || config.framework;
  if (framework === 'svelte') {
    const usedComponents = extractComponentsFromContent(code);
    const importedNames = new Set<string>();
    const anyImportRegex = /import\s+(?:(\w+)\s*,?\s*)?(?:{([^}]+)})?\s*from\s*['"][^'"]+['"]/g;
    let importMatch;
    while ((importMatch = anyImportRegex.exec(code)) !== null) {
      if (importMatch[1]) importedNames.add(importMatch[1]);
      if (importMatch[2]) {
        importMatch[2].split(',').forEach(name => {
          const cleaned = name.split(/\s+as\s+/).pop()?.trim();
          if (cleaned) importedNames.add(cleaned);
        });
      }
    }
    const addonProvided = new Set(['Story', 'Template']);
    for (const comp of usedComponents) {
      if (!addonProvided.has(comp) && !importedNames.has(comp)) {
        errors.push(`Component "${comp}" is used in the markup but never imported - add it to the <script module> imports.`);
      }
    }
  }

  if (config.iconImports?.package) {
    const iconImports = extractImportsFromCode(code, config.iconImports.package);
    if (!config.iconImports.allowAllIcons) {
      const allowedIcons = new Set<string>(config.iconImports?.commonIcons || []);
      for (const iconName of iconImports) {
        if (isBlacklistedIcon(iconName, allowedIcons)) {
          const correction = ICON_CORRECTIONS[iconName];
          if (correction) {
            errors.push(`Invalid icon: "${iconName}" does not exist. Did you mean "${correction}"?`);
          } else {
            errors.push(`Invalid icon: "${iconName}" is not available.`);
          }
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================================
// Intent + generated-code analysis (used for completion feedback)
// ============================================================

function buildComponentSuggestion(components: Array<{ name: string }> | null): string {
  if (!components?.length) {
    return 'Check your story-ui.config.js to ensure components are properly configured.';
  }
  const sampleComponents = components.slice(0, 5).map(c => c.name).join(', ');
  const moreCount = components.length > 5 ? ` and ${components.length - 5} more` : '';
  return `Your available components include: ${sampleComponents}${moreCount}. Check story-ui.config.js if expected components are missing.`;
}

function analyzeIntent(
  prompt: string,
  config: any,
  conversation: Array<{ role: string; content: string }> | undefined,
  previousCode: string | undefined,
  options: {
    framework: FrameworkType;
    designSystem?: string;
    hasImages?: boolean;
  }
): IntentPreview {
  const componentKeywords: Record<string, string[]> = {
    button: ['button', 'click', 'submit', 'action', 'cta'],
    card: ['card', 'panel', 'tile', 'box'],
    form: ['form', 'input', 'field', 'submit', 'login', 'signup', 'register'],
    table: ['table', 'list', 'data', 'grid', 'rows'],
    modal: ['modal', 'dialog', 'popup', 'overlay'],
    navigation: ['nav', 'menu', 'header', 'sidebar', 'footer'],
    layout: ['layout', 'page', 'section', 'container', 'grid', 'stack'],
    pricing: ['pricing', 'price', 'plan', 'subscription', 'tier'],
    dashboard: ['dashboard', 'analytics', 'stats', 'metrics', 'chart'],
    profile: ['profile', 'user', 'avatar', 'account'],
  };

  const promptLower = prompt.toLowerCase();
  const estimatedComponents: string[] = [];
  for (const [component, keywords] of Object.entries(componentKeywords)) {
    if (keywords.some(kw => promptLower.includes(kw))) {
      estimatedComponents.push(component);
    }
  }

  let strategy = 'Creating new component story';
  if (previousCode) {
    strategy = 'Modifying existing story - preserving structure';
  } else if (options.hasImages) {
    strategy = 'Analyzing visual reference to generate matching component';
  } else if (estimatedComponents.includes('dashboard')) {
    strategy = 'Creating multi-section dashboard layout';
  } else if (estimatedComponents.includes('form')) {
    strategy = 'Building form with validation-ready structure';
  }

  return {
    requestType: previousCode ? 'modification' : 'new',
    framework: options.framework,
    detectedDesignSystem: options.designSystem || (config.importPath?.includes('mantine') ? 'mantine' :
      config.importPath?.includes('chakra') ? 'chakra-ui' :
      config.importPath?.includes('mui') ? 'material-ui' : null),
    strategy,
    estimatedComponents,
    promptAnalysis: {
      hasVisionInput: !!options.hasImages,
      hasConversationContext: !!(conversation && conversation.length > 1),
      hasPreviousCode: !!previousCode,
    },
  };
}

// Component insights - contextual reasons based on component role
const COMPONENT_INSIGHTS: Record<string, string> = {
  Box: 'base container for custom layouts',
  Container: 'centered content with max-width',
  Stack: 'vertical flow with consistent spacing',
  HStack: 'horizontal alignment',
  VStack: 'vertical alignment',
  Flex: 'flexible positioning',
  Grid: 'multi-column responsive layout',
  SimpleGrid: 'auto-sizing grid columns',
  Group: 'inline element grouping',
  Center: 'centered content',
  Space: 'controlled whitespace',
  Divider: 'visual section separation',
  Text: 'text with theme styling',
  Title: 'semantic heading',
  Heading: 'hierarchical heading',
  Typography: 'styled text content',
  Alert: 'contextual user notifications',
  AlertTitle: 'alert heading',
  Badge: 'status indicators',
  Chip: 'compact info tags',
  Progress: 'task completion feedback',
  CircularProgress: 'loading state indicator',
  LinearProgress: 'progress visualization',
  Skeleton: 'loading placeholder',
  Spinner: 'loading animation',
  Loader: 'async state feedback',
  Button: 'primary user actions',
  IconButton: 'icon-only actions',
  ActionIcon: 'compact icon actions',
  Menu: 'contextual options',
  Tooltip: 'hover information',
  Input: 'text input field',
  TextInput: 'text entry',
  Textarea: 'multi-line text',
  Select: 'dropdown selection',
  Checkbox: 'binary toggle',
  Switch: 'on/off toggle',
  Radio: 'single selection',
  Slider: 'range selection',
  NumberInput: 'numeric entry',
  Card: 'content container with elevation',
  Paper: 'surface elevation',
  Table: 'tabular data display',
  List: 'sequential items',
  Avatar: 'user representation',
  Image: 'visual content',
  Tabs: 'content organization',
  Breadcrumb: 'navigation hierarchy',
  Pagination: 'paged navigation',
  Stepper: 'multi-step progress',
  NavLink: 'navigation item',
  Modal: 'focused interaction',
  Dialog: 'user confirmation',
  Drawer: 'side panel content',
  Popover: 'contextual overlay',
  Sheet: 'bottom panel (mobile-friendly)',
};

export function analyzeGeneratedCode(
  code: string,
  prompt: string,
  config: any
): {
  componentsUsed: CompletionFeedback['componentsUsed'];
  layoutChoices: CompletionFeedback['layoutChoices'];
  styleChoices: CompletionFeedback['styleChoices'];
} {
  const componentsUsed: CompletionFeedback['componentsUsed'] = [];
  const layoutChoices: CompletionFeedback['layoutChoices'] = [];
  const styleChoices: CompletionFeedback['styleChoices'] = [];

  const importMatch = code.match(/import\s*{([^}]+)}\s*from\s*['"][^'"]+['"]/g);
  if (importMatch) {
    for (const imp of importMatch) {
      const components = imp.match(/{([^}]+)}/);
      if (components) {
        const names = components[1].split(',').map(n => n.trim());
        for (const name of names) {
          if (name && /^[A-Z]/.test(name)) {
            const insight = COMPONENT_INSIGHTS[name];
            componentsUsed.push({ name, reason: insight || undefined });
          }
        }
      }
    }
  }

  const hasGrid = code.includes('Grid') || code.includes('SimpleGrid');
  const hasStack = code.includes('Stack') || code.includes('VStack') || code.includes('HStack');
  const hasFlex = code.includes('Flex') || /display:\s*['"]?flex/i.test(code);
  const hasContainer = code.includes('Container');

  if (hasGrid) {
    const colMatch = code.match(/columns?[=:]\s*[{]?\s*(\d+|[{][^}]+[}])/i);
    const cols = colMatch ? 'responsive columns' : 'auto columns';
    layoutChoices.push({ pattern: 'Grid', reason: `${cols} for organized content arrangement` });
  }
  if (hasStack && !hasGrid) {
    const isHorizontal = code.includes('HStack') || code.includes('direction="row"') || code.includes("direction='row'");
    layoutChoices.push({
      pattern: isHorizontal ? 'Horizontal Stack' : 'Vertical Stack',
      reason: isHorizontal
        ? 'inline element alignment with automatic spacing'
        : 'stacked sections with consistent gaps',
    });
  }
  if (hasFlex && !hasStack && !hasGrid) {
    const hasJustify = /justify/i.test(code);
    const hasAlign = /align/i.test(code);
    layoutChoices.push({
      pattern: 'Flexbox',
      reason: hasJustify && hasAlign
        ? 'precise control over element distribution and alignment'
        : 'flexible element positioning',
    });
  }
  if (hasContainer) {
    layoutChoices.push({ pattern: 'Container', reason: 'centered content with readable max-width' });
  }

  const variantMatch = code.match(/variant[=:]\s*["']([^"']+)["']/gi);
  if (variantMatch) {
    const variants = new Set(variantMatch.map(m => m.split(/[=:]/)[1]?.trim().replace(/["']/g, '')).filter(Boolean));
    const variantReasons: Record<string, string> = {
      filled: 'high visual emphasis',
      outlined: 'secondary emphasis',
      subtle: 'minimal visual weight',
      light: 'soft background emphasis',
      gradient: 'eye-catching visual treatment',
      contained: 'solid button style',
      text: 'inline text action',
    };
    for (const variant of Array.from(variants).slice(0, 2)) {
      if (variant && variantReasons[variant]) {
        styleChoices.push({ property: 'variant', value: variant, reason: variantReasons[variant] });
      }
    }
  }

  const colorMatch = code.match(/color[=:]\s*["']([^"']+)["']/gi);
  if (colorMatch) {
    const colors = new Set(colorMatch.map(m => m.split(/[=:]/)[1]?.trim().replace(/["']/g, '')).filter(Boolean));
    const semanticColors: Record<string, string> = {
      primary: 'brand identity emphasis',
      secondary: 'supporting visual accent',
      success: 'positive outcome indication',
      error: 'error state signaling',
      warning: 'caution indication',
      info: 'informational context',
      green: 'success/positive state',
      red: 'error/danger state',
      blue: 'informational emphasis',
      yellow: 'warning indication',
      orange: 'attention drawing',
    };
    for (const color of Array.from(colors).slice(0, 2)) {
      if (!color) continue;
      const colorLower = color.toLowerCase();
      for (const [key, reason] of Object.entries(semanticColors)) {
        if (colorLower.includes(key)) {
          styleChoices.push({ property: 'color', value: color, reason });
          break;
        }
      }
    }
  }

  return { componentsUsed, layoutChoices, styleChoices };
}
