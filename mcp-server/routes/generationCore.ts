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
import os from 'os';
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
import { createFrameworkAwareFallbackStory, isFallbackStoryCode } from './storyHelpers.js';
import { isBlacklistedComponent, isBlacklistedIcon, getBlacklistErrorMessage, ICON_CORRECTIONS } from '../../story-generator/componentBlacklist.js';
import { StoryTracker, StoryMapping } from '../../story-generator/storyTracker.js';
import { getManifestManager } from '../../story-generator/manifestManager.js';
import { reapplyPins, pinsForPrompt, describePin, type PropPin } from '../../story-generator/editing/pins.js';
import { hasPatchBlocks, parsePatchBlocks, applyPatches, describePatchFailures, PATCH_INSTRUCTIONS } from '../../story-generator/editing/patchEdit.js';
import { closeBrowserSession } from '../../story-generator/verify/browserSession.js';
import { smallModelFor } from '../../story-generator/llm-providers/index.js';
import type { PreviewReady, LlmText } from './streamTypes.js';
import { getDocumentation } from '../../story-generator/documentation-sources.js';
import { postProcessStory, fixBarrelImports, splitScopeImports, editDivergence } from '../../story-generator/postProcessStory.js';
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
  isGuessedStorybookUrl,
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
  chatCompletionWithImagesDetailed,
  buildMessageWithImages, chatCompletionStreamDetailed,
} from '../../story-generator/llm-providers/story-llm-service.js';
import { processImageInputs, ImageInput } from '../../story-generator/imageProcessor.js';
import { processFileInputs, fileFraming, FileInput } from '../../story-generator/fileAttachments.js';
import { checkTokenUsage, formatTokenErrors } from '../../story-generator/knowledge/tokenConformance.js';
import { targetComponentFromSelection, repairWithinTarget, scopedCritiqueRequest, repairScopeNote } from '../../story-generator/editing/repairScope.js';
import { relocateUnresolvableImports, resolveLocalModule, relativeSpecifier } from '../../story-generator/editing/relocateImports.js';
import { resolveSpecifier } from '../../story-generator/knowledge/moduleResolution.js';
import { chooseStorybookUrl } from '../../story-generator/storybookOrigin.js';
import { VisionPromptType, buildVisionAwarePrompt } from '../../story-generator/visionPrompts.js';
import { ImageContent, MessageContent, TextContent } from '../../story-generator/llm-providers/types.js';
import {
  createStorybookMcpClient,
  formatStorybookContext,
  StorybookMcpContext,
} from '../../story-generator/storybookMcpClient.js';
import { IntentPreview, ValidationFeedback, CompletionFeedback } from './streamTypes.js';
import { verifyStory, repairableByStory } from '../../story-generator/verify/verifyStory.js';
import { describeAutoFix } from '../../story-generator/autoFixSummary.js';
import { moduleText, waitForRecompile } from '../../story-generator/verify/renderHarness.js';
import { reflectDesignSystem, formatCompoundReference } from '../../story-generator/knowledge/runtimeReflect.js';
import { extractProps, extractPropsForPackages, rankProps } from '../../story-generator/knowledge/propExtractor.js';
import { saysMoreThanName } from '../../story-generator/knowledge/descriptionQuality.js';

/**
 * Props that decide geometry, and documentation that actually explains it.
 *
 * Both conditions matter. The name alone admits `FluidNumberInput.max` (a
 * numeric bound, not a breakpoint); the prose alone would admit half the
 * library. Together they select the props whose value the model has to get
 * numerically right — column spans, offsets, gutters — and nothing else.
 */
const GEOMETRY_PROP = /^(sm|md|lg|xl|xxl|max|xs|span|offset|start|end|gap|columns|narrow|condensed|fullWidth|orientation)$/;
const LAYOUT_PROSE = /\b(column|columns|grid|breakpoint|gutter|span|spacing|width|row|layout)\b/i;
import { enrichWithSourceFacts, withLocalPropFacts } from '../../story-generator/knowledge/sourceFacts.js';
import { readStylingFacts, formatStylingGuidance, readDesignTokens } from '../../story-generator/knowledge/stylingFacts.js';
import type { StylingFacts } from '../../story-generator/knowledge/stylingFacts.js';
import {
  deriveSpacingVocabulary, checkInlineSpacing, checkTokenTiers, checkRawColors, formatSpacingErrors, formatTierErrors, formatColorErrors, repairSpacingNote,
  type SpacingVocabulary,
} from '../../story-generator/knowledge/spacingFacts.js';
import {
  deriveIconVocabulary, derivedIconPackages, checkIconImports, formatIconImportErrors,
  type IconVocabulary,
} from '../../story-generator/knowledge/iconFacts.js';
import { inheritCompoundExamples } from '../../story-generator/knowledge/storybookCatalog.js';
import { checkConformance, formatConformanceErrors } from '../../story-generator/knowledge/conformance.js';
import {
  checkPropConformance, formatPropConformanceErrors, summarisePropConformance, rewriteGlobalJsxNamespace,
} from '../../story-generator/knowledge/propConformance.js';
import { isSafeStoryFileName,
  writeStoryArtifacts,
  extractStylesheet,
  sweepOrphanedArtifacts,
  stripStoryPrefix,
} from '../../story-generator/storyArtifacts.js';
import { attemptVerificationRepair } from './verifyRepair.js';
import type { VerifyReport, RepairSummary } from '../../story-generator/verify/findings.js';
import { registerActiveGeneration, unregisterActiveGeneration, isGenerationCancelled, cancellationSignal } from './activeGenerations.js';
import { gateVerdict, pickBest, gateMaxAttempts, gateFeedback, gateStatusLine, type GateVerdict } from '../../story-generator/verify/gate.js';

// ============================================================
// Public interface
// ============================================================

export interface GenerationRequest {
  prompt: string;
  fileName?: string;
  conversation?: Array<{ role: string; content: string; thumbnails?: string[] }>;
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
  /** Reference files: text-like ones are inlined, PDFs go to Claude as documents. */
  files?: FileInput[];
  visionMode?: string;
  designSystem?: string;
  considerations?: string;
  provider?: string;
  model?: string;
  useStorybookMcp?: boolean;
  /**
   * Storybook origin detected by the panel (it runs inside Storybook, so it
   * knows). Wins over config.storybookMcpUrl whenever this server can reach
   * it — see chooseStorybookUrl.
   */
  storybookUrl?: string;
  voiceMode?: boolean;
  /**
   * Set by the shippable gate on a retry: what the browser measured on the
   * previous attempt, as rules the next composition must satisfy.
   */
  gateFeedback?: string[];
  /** Which attempt this is (1-based); recorded with the completion. */
  gateAttempt?: number;
  /**
   * A retry writes the SAME story: same file, same title, same hash — never
   * a "v2" beside the failed one.
   */
  regenerateOf?: { fileName: string; title: string; hash: string };
}

export interface GenerationEvents {
  onProgress?(step: number, totalSteps: number, phase: string, message: string, details?: Record<string, unknown>): void;
  onIntent?(intent: IntentPreview): void;
  onValidation?(validation: ValidationFeedback): void;
  onRetry?(attempt: number, maxAttempts: number, reason: string, errors: string[]): void;
  onLLMCall?(): void;
  /** Fired once with the run's id, so a client can cancel this specific run. */
  onStarted?(generationId: string): void;
  /** The file is written. Show it; the rest is background. */
  onPreviewReady?(preview: PreviewReady): void;
  /** Model prose as it streams: the plan before the code, the summary after. */
  onLlmText?(text: LlmText): void;
}

/**
 * Total steps reported through onProgress (kept for panel progress bars).
 *
 * Steps 9–11 are the post-write phases — runtime check, browser verification,
 * repair. They are conditional (runtime validation can be disabled, verification
 * needs a reachable Storybook), so a generation may legitimately complete at
 * 8/11; the completion event is what ends the progress display, not the count.
 */
export const GENERATION_TOTAL_STEPS = 11;

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
    /** What the auto-fix changed, one clause each; empty when it changed nothing. */
    fixDetails?: string[];
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
  /** The generated stylesheet, when the model wrote one — so a kept attempt can be restored with it. */
  stylesheet?: string;
  /** What the shippable gate did: attempts spent, whether the kept attempt is shippable, and why. */
  gate?: { attempts: number; bestAttempt: number; shippable: boolean; reason: string };
  /** Conversational, model-authored reply describing what was built. */
  chatSummary?: string;
  /** Short follow-up prompt ideas the user can click to refine. */
  suggestions?: string[];
  /** Advice for the user to read — never rendered as a clickable prompt. */
  notice?: string;
  /** Hand-set props re-applied after the model's rewrite. */
  pins?: { applied: string[]; kept: string[]; lost: string[] };
  /** Edit blocks an update was answered with. */
  edits?: Array<{ search: string; replace: string }>;
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
  /**
   * Make the in-flight request visible to GET /story-ui/active-generations.
   *
   * Registered before ANY pipeline work and removed in a finally, so success,
   * fallback stories, and throws all leave the list clean — a stale entry
   * would make a poller wait forever, which is worse than the silence this
   * registry exists to fix.
   */
  const startedAt = Date.now();
  const activeKey = registerActiveGeneration({
    prompt: request?.prompt ?? '',
    fileName: request?.fileName ?? null,
    startedAt,
  });
  // Name the run to the client so Stop can address it.
  events.onStarted?.(activeKey);
  try {
    return await runGatedGeneration(request, events, startedAt, activeKey);
  } finally {
    unregisterActiveGeneration(activeKey);
    // Verification and repair share one Chromium per run; it ends with the run.
    await closeBrowserSession().catch(() => undefined);
  }
}

/**
 * The shippable gate around the pipeline.
 *
 * One pipeline run produces a story and a verdict. A story that rendered
 * and has no blocker of its own ships. One that did not render, or that
 * keeps a blocker after repair, is generated AGAIN from scratch with the
 * browser's findings as instructions — the same file, title and id, so
 * the user sees one story, not a failed one beside a retry — up to
 * STORY_UI_GATE_ATTEMPTS (default 3). The best attempt is kept, and the
 * reply says what happened: "verified clean on attempt 2", or what still
 * stands. A story verification could not judge is reported as such and
 * not retried; regeneration cannot fix a missing Storybook.
 */
async function runGatedGeneration(
  request: GenerationRequest,
  events: GenerationEvents,
  startedAt: number,
  activeKey: string,
): Promise<GenerationOutcome> {
  const maxAttempts = gateMaxAttempts();
  const attempts: Array<{ result: GenerationOutcome; verdict: GateVerdict }> = [];
  let req: GenerationRequest = request;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptEvents: GenerationEvents = attempt === 1 ? events : {
      ...events,
      onStarted: undefined,
      onProgress: (step, total, phase, message, details) =>
        events.onProgress?.(step, total, phase, `Attempt ${attempt} of ${maxAttempts}: ${message}`, details),
    };
    const result = await runStoryGenerationPipeline(req, attemptEvents, startedAt, activeKey);
    const verdict = gateVerdict(result.verification);
    attempts.push({ result, verdict });
    logger.log(verdict.shippable
      ? `🚦 Gate: shippable on attempt ${attempt} of ${maxAttempts} (${verdict.reason})`
      : `🚦 Gate: attempt ${attempt} of ${maxAttempts} not shippable — ${verdict.reason}${verdict.retryable && attempt < maxAttempts ? '; regenerating with the findings' : ''}`);
    if (verdict.shippable || !verdict.retryable || result.isFallbackStory || attempt === maxAttempts) break;
    if (isGenerationCancelled(activeKey)) break;
    const hash = result.fileName.match(/-([a-f0-9]{8})(?:\.stories\.\w+)?$/)?.[1]
      ?? crypto.createHash('sha1').update(result.fileName).digest('hex').slice(0, 8);
    req = {
      ...request,
      gateFeedback: gateFeedback(verdict),
      gateAttempt: attempt + 1,
      regenerateOf: { fileName: result.fileName, title: result.title, hash },
    };
    events.onProgress?.(11, 12, 'gate_retry',
      `Attempt ${attempt} failed verification (${verdict.reason.slice(0, 80)}) — generating again with the findings`);
  }

  const best = pickBest(attempts);
  const bestIndex = attempts.indexOf(best) + 1;
  const last = attempts[attempts.length - 1];
  if (best !== last) {
    // A later attempt overwrote the file; put the kept attempt back on disk.
    try {
      const cfg = loadUserConfig();
      const dir = path.resolve(process.cwd(), cfg.generatedStoriesPath || './src/stories/generated/');
      writeStoryArtifacts({ dir, fileName: best.result.fileName, code: best.result.code, css: best.result.stylesheet ?? null });
      logger.log(`🚦 Gate: restored attempt ${bestIndex} to disk (attempt ${attempts.length} was worse)`);
    } catch (err) {
      logger.warn(`🚦 Gate: could not restore attempt ${bestIndex}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const status = gateStatusLine(attempts.length, best.verdict, bestIndex);
  const out: GenerationOutcome = {
    ...best.result,
    gate: { attempts: attempts.length, bestAttempt: bestIndex, shippable: best.verdict.shippable, reason: best.verdict.reason },
  };
  if (status) {
    out.chatSummary = out.chatSummary ? `${status}\n\n${out.chatSummary}` : status;
    if (!best.verdict.shippable) {
      out.notice = [status, out.notice].filter(Boolean).join(' ');
      if (!best.verdict.rendered) out.suggestions = ['Try again', ...(out.suggestions ?? []).filter(s => s !== 'Try again')].slice(0, 5);
    }
  }
  return out;
}

async function runStoryGenerationPipeline(
  request: GenerationRequest,
  events: GenerationEvents,
  startedAt: number,
  generationId?: string,
): Promise<GenerationOutcome> {
  /**
   * Stop, honoured.
   *
   * Aborting the client fetch closes one socket and nothing else: the pipeline
   * ran on, wrote the story and persisted the reply, so a story appeared in
   * Storybook half a minute after the user thought they had cancelled. Checked
   * at phase boundaries rather than pre-empted, because there is no safe point
   * to kill a pipeline mid-write.
   */
  const cancelSignal = cancellationSignal(generationId);
  const throwIfCancelled = (phase: string) => {
    if (isGenerationCancelled(generationId)) {
      // Say so in the log: a cancelled run and a finished one used to look identical there.
      logger.log(`🛑 Generation ${generationId} stopped by the user during ${phase}`);
      throw new GenerationError('CANCELLED', `Generation stopped by the user during ${phase}`, {
        httpStatus: 499, recoverable: false,
      });
    }
  };
  /**
   * The component facts handed to the model, kept for the validation loop.
   *
   * Deliberately the SAME object the catalog was built from, so what the model
   * was told and what it is judged against cannot drift — the divergence that
   * once had the catalog offering a component the validator then rejected.
   */
  let knownProps: Awaited<ReturnType<typeof extractProps>> = null;
  let knownTokens: Set<string> | null = null;
  /**
   * How this design system spaces things, derived once from the catalog and
   * stylesheets: the prompt is written from it and the output is checked
   * against it, so the two can never disagree.
   */
  let stylingFacts: StylingFacts | null = null;
  let spacingVocab: SpacingVocabulary | null = null;
  let iconVocab: IconVocabulary | null = null;

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
    files,
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

  /**
   * The one client-controlled path in the pipeline. Rejected before any work
   * so a bad name cannot even reach the model.
   */
  if (fileName !== undefined && fileName !== null && fileName !== '' && !isSafeStoryFileName(fileName)) {
    throw new GenerationError(
      'INVALID_FILE_NAME',
      `"${String(fileName)}" is not a story file name. Use the bare name of a generated story, like my-story-1a2b3c4d.stories.tsx.`,
      { httpStatus: 400, recoverable: false },
    );
  }

  const totalSteps = GENERATION_TOTAL_STEPS;

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
  let attachments: MessageContent[] = [];
  if (images && Array.isArray(images) && images.length > 0) {
    try {
      attachments = await processImageInputs(images);
    } catch (imageError) {
      throw new GenerationError('IMAGE_PROCESSING_ERROR', 'Failed to process images', {
        httpStatus: 400,
        details: imageError instanceof Error ? imageError.message : String(imageError),
        recoverable: true,
        suggestion: 'Try again without images or use a different format',
      });
    }
  }
  // Reference files. Text is inlined for every provider; a PDF is a document
  // block only Claude reads, so on another provider it is refused, not
  // silently dropped — the user asked the model to read it.
  const skippedFiles: { name: string; reason: string }[] = [];
  if (files && Array.isArray(files) && files.length > 0) {
    const processed = processFileInputs(files);
    skippedFiles.push(...processed.skipped);
    const providerNow = getProviderInfo({ provider: provider as any, model }).currentProvider;
    for (const block of processed.blocks) {
      if (block.type === 'document' && providerNow !== 'claude') {
        skippedFiles.push({ name: block.source.name || 'document', reason: `PDFs are only read by Claude; the request used ${providerNow}` });
        continue;
      }
      attachments.push(block);
    }
    logger.log(`📎 Attached ${processed.summary.text} text file(s), ${processed.summary.pdf} PDF(s)${skippedFiles.length ? `; skipped ${skippedFiles.length}` : ''}`);
  }

  // Step 2: Discover components
  events.onProgress?.(2, totalSteps, 'components_discovered', 'Discovering available components...');
  const discovery = new EnhancedComponentDiscovery(config);

  /**
   * This request's Storybook, chosen once and used everywhere a URL is needed:
   * component-directory discovery, the MCP context, runtime validation and
   * browser verification. The panel's origin wins when this server can reach
   * it; story-ui.config's storybookMcpUrl otherwise; the environment last.
   * See storybookOrigin.ts for why the config no longer wins outright.
   */
  const storybookChoice = await chooseStorybookUrl({
    callerOrigin: storybookUrl,
    configured: config.storybookMcpUrl,
    fallback: getStorybookUrl(),
  });
  const projectStorybookUrl = storybookChoice.url;
  if (storybookChoice.note) logger.log(`🔭 Storybook: ${storybookChoice.note}`);

  // Where Storybook says this project's components are.
  //
  // Discovery otherwise guesses at conventional directory names, so a design
  // system living outside them is invisible — and a component the model is not
  // told about is a component it will not use, however good the rest of the
  // context is.
  try {
    const sbUrl = projectStorybookUrl;
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
    // Held for the validation loop below, which checks the generated code
    // against these same facts. Same object, so the catalog the model was given
    // and the catalog it is judged against can never drift apart.
    knownProps = withLocalPropFacts(extracted, components as any[], config.importPath);
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
          /**
           * Deprecated props are WITHHELD from the list, not merely marked.
           *
           * They were marked `⚠DEPRECATED: Use children instead` and used anyway
           * — measured across 207 generated stories, 16 uses of a prop the
           * catalog explicitly warned against. `DataTable render`,
           * `OverflowMenu ariaLabel`, `Lozenge isBold`, and Atlassian's whole
           * `Box` padding shorthand family.
           *
           * The reason a warning loses: these are what the LIBRARY'S OWN DOCS
           * showed a version ago, so the model is not reading past the marker —
           * it is not consulting the catalog for a prop it already "knows". A
           * prohibition competes with muscle memory; an absence does not.
           *
           * Withholding also buys back scarce slots. The window is 12 props, and
           * Atlassian's `Box` has 6 of its 13 deprecated — half the budget spent
           * describing props that must not be used. Those slots now go to props
           * that should be.
           *
           * The replacement is named separately below, because "do not use X"
           * without "use Y" leaves the model to invent the alternative, and the
           * deprecation text usually states it.
           *
           * A prop written from memory anyway is caught statically after
           * generation — see conformance.ts. Assert first, verify second.
           */
          const deprecatedFacts = facts.props.filter(p => p.deprecated);
          // Descriptions ride alongside, keyed by name; the catalog renders
          // them only for the components the request is about.
          const propDocs: Record<string, string> = {};
          for (const p of facts.props) {
            if (!p.deprecated && p.doc && p.doc.trim()) propDocs[p.name] = p.doc.trim().split('\n')[0];
          }
          if (Object.keys(propDocs).length) component.__propDocs = propDocs;
          component.props = rankProps(facts.props.filter(p => !p.deprecated)).map(p => {
            /**
             * Say REQUIRED, rather than implying it by the absence of `?`.
             *
             * A TypeScript reader infers required from a missing question mark.
             * A model weighing that against a strong prior from another library
             * does not. Measured: Astryx's Switch declares `value` as REQUIRED
             * and the catalog rendered it `value (boolean)` — visually
             * indistinguishable from an optional prop — so the model bound state
             * to `isSelected` instead, React Aria's name. The switch was pinned
             * off and completely inert, and the catalog had the right answer.
             */
            let entry = `${p.name}${p.required ? '' : '?'}${p.type ? ` (${p.type})` : ''}${p.required ? ' REQUIRED' : ''}`;
            // A stated default stops the model restating it. `variant="text"`
            // on an MUI Button is not wrong, but it reads to the team that owns
            // the system as someone who did not know the API.
            /**
             * The values this prop actually accepts.
             *
             * Resolved from the library's own const tuples, so `kind` on a
             * Carbon Button reads as its eight real kinds rather than as an
             * unhelpful `ButtonKind`. A model given the legal set cannot
             * invent `kind="destructive"`.
             */
            if (p.options?.length) {
              const shown = p.options.slice(0, 8).join('|');
              entry += ` [${shown}${p.options.length > 8 ? `|…${p.options.length - 8}` : ''}]`;
            }
            if (p.defaultValue) entry += ` =${p.defaultValue}`;
            // Deprecation is the one fact here that changes whether the output
            // is acceptable at all, so it is never truncated away and never
            // silently ranked out of view.
            //
            /**
             * Layout props carry their documentation. Nothing else does.
             *
             * Alignment defects are the most visible thing a design system
             * owner sees, and they come from one fact the model cannot infer:
             * how many columns the grid has. Carbon states it in the prop's
             * own JSDoc — "This breakpoint supports 16 columns by default" —
             * and without it the model produced `lg={5}` beside `lg={6}`,
             * leaving five of sixteen columns empty, and `sm={4}` twice in a
             * FOUR-column grid, which wraps. Both were visible as ragged edges
             * in the rendered output.
             *
             * Selected by what the prop DOES, not by component name: a prop
             * whose name is geometric AND whose documentation talks about
             * columns, gutters or breakpoints. That works for Carbon's 16/8/4,
             * MUI's 12 and anything else, because each states its own numbers.
             * Measured cost on Carbon: 44 props, about 1k tokens.
             */
            if (p.doc && GEOMETRY_PROP.test(p.name) && LAYOUT_PROSE.test(p.doc)) {
              // 150, not 110: the COLUMN COUNT is the payload and it sits at the
              // end of Carbon's sentence — clipping shorter risks cutting the number.
              entry += ` — ${p.doc.length > 150 ? `${p.doc.slice(0, 149)}…` : p.doc}`;
            }
            // Other prop DESCRIPTIONS are deliberately absent. They are extracted and
            // available (95% coverage on Carbon), but rendering even the top
            // three per component costs ~10k tokens and the full set ~28k —
            // against a 15k-token catalog, most of it describing components a
            // given generation never touches. Filtering the uninformative ones
            // does not help: Carbon phrases them as full sentences that say
            // nothing ("Specify an optional className to add"). Serving them
            // on demand is the right shape, and is not built yet.
            return entry;
          });
          /**
           * One compact line naming what NOT to reach for, and what instead.
           *
           * Grouped rather than inline: a single "do not use" list reads as a
           * rule, where a marker buried mid-list reads as a footnote. The
           * library's own deprecation text carries the replacement most of the
           * time ("Use `children` instead", "use `paddingBlock`"), so the model
           * is given the alternative rather than left to invent one.
           */
          if (deprecatedFacts.length) {
            const avoid = deprecatedFacts.slice(0, 8).map(p =>
              p.deprecated && p.deprecated !== 'deprecated'
                ? `${p.name} (${String(p.deprecated).replace(/\s+/g, ' ').trim().slice(0, 60)})`
                : p.name);
            const note = `DO NOT USE these deprecated props: ${avoid.join('; ')}`
              + (deprecatedFacts.length > 8 ? ` (+${deprecatedFacts.length - 8} more)` : '');
            component.description = component.description ? `${component.description} — ${note}` : note;
          }
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
  } catch (enrichError) {
    // Enrichment is additive, so generation proceeds — but a names-only catalog
    // must not look like a library with no types.
    logger.warn(`⚠️ Component enrichment failed; the catalog carries names only: ${enrichError instanceof Error ? enrichError.message : String(enrichError)}`);
  }
  // The spacing vocabulary: gap primitives and padding owners from the
  // catalog (with the values their types declare), the spacing scale and
  // colour tiers from the stylesheets, the utility steps from the team's own
  // stories. The prompt's spacing rules are written from it; the validation
  // loop judges the output against the same object.
  try {
    stylingFacts = readStylingFacts(process.cwd(), (config.generatedStoriesPath || '')
      .replace(/^\.\//, '').replace(/\/+$/, '').split('/').pop() || 'generated',
      config.importPath);
    spacingVocab = deriveSpacingVocabulary({
      components: components as any[], facts: knownProps, styling: stylingFacts, layoutRules: config.layoutRules,
    });
    logger.log(spacingVocab.hasScale
      ? `📏 Spacing vocabulary: ${spacingVocab.source}${Object.keys(spacingVocab.aliasesOf).length ? `; ${Object.keys(spacingVocab.aliasesOf).length} primitive colour(s) with a semantic alias` : ''}`
      : `📏 Spacing vocabulary: ${spacingVocab.source} — the prompt falls back to inline spacing examples and says so`);
  } catch (spacingError) {
    logger.warn(`⚠️ Could not derive the spacing vocabulary: ${spacingError instanceof Error ? spacingError.message : String(spacingError)} — prompt uses the inline fallback; spacing check will be skipped, not passed`);
  }
  // Icons and placeholder images: installed icon packages (the project's or
  // the design system's own), the catalog's icon components and primitive,
  // and its placeholder components. Named in the prompt, allowed by the
  // isolation check, and import names verified against the package's exports.
  try {
    iconVocab = deriveIconVocabulary({
      projectRoot: process.cwd(), importPath: config.importPath, configuredPackage: config.iconImports?.package, components: components as any[],
    });
    logger.log(`🖼️ Icon vocabulary: ${iconVocab.source}`);
  } catch (iconError) {
    logger.warn(`⚠️ Could not derive the icon vocabulary: ${iconError instanceof Error ? iconError.message : String(iconError)}`);
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
  const mcpUrl = projectStorybookUrl || undefined;
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
      storybookContext = await storybookClient.fetchContext(componentNames, prompt);
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
        /**
         * `examples`, not `stories`.
         *
         * ComponentDocumentation has no `stories` field — fetchFromManifest
         * normalises each story's snippet into `examples[].code`. Reading
         * `doc.stories` was therefore always undefined, so NO manifest example
         * has ever reached a prompt, and inheritCompoundExamples on the next
         * line had nothing to propagate.
         *
         * It survived because bench/resolution.mjs parses the RAW manifest,
         * where `stories[].snippet` does exist, and reported example coverage
         * the pipeline never received. Same bench-versus-pipeline divergence
         * already recorded for the description predicate.
         */
        const snippets = doc?.examples?.map((ex: any) => ex.code).filter(Boolean);
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
  /**
   * An update is whatever names a story that already exists.
   *
   * The flag used to be the only signal, so an API client (the stdio MCP
   * server, a script) that sent `fileName` without `isUpdate` got a FRESH
   * generation written over the existing file. The file on disk is the fact;
   * the flag can only add to it, or explicitly opt out with `isUpdate: false`.
   */
  const namedFileExists = Boolean(fileName) && (() => {
    try {
      return fs.existsSync(path.resolve(process.cwd(), config.generatedStoriesPath, fileName as string));
    } catch { return false; }
  })();
  const isActualUpdate = isUpdate === false
    ? false
    : Boolean(isUpdate || namedFileExists || (fileName && conversation && conversation.length > 2));
  let previousCode: string | undefined;
  /**
   * True when the baseline is the placeholder a FAILED generation wrote.
   *
   * That failure was recorded to disk and to history unconditionally, and the
   * panel keeps its activeFile even on failure — so the user's natural next
   * message ("try again") arrives as an update whose previous code is the
   * error box. A fresh composition then diverges ~1.0 from it, and the edit
   * guard would hard-block every retry with EDIT_DIVERGENCE, permanently.
   * Rebuilding from scratch over a placeholder is the desired outcome, so the
   * guard is skipped for exactly this baseline.
   */
  let previousCodeIsFallback = false;
  /**
   * Props the user set by hand on this story. Told to the model, and
   * re-applied to whatever it returns — the model rewrites props as a matter
   * of style even when asked not to.
   */
  const pins: PropPin[] = (isActualUpdate && fileName)
    ? (() => { try { return getManifestManager().get(fileName)?.metadata?.pins ?? []; } catch { return []; } })()
    : [];
  const pinReport = { applied: new Set<string>(), kept: new Set<string>(), lost: new Set<string>() };
  let parentVersionId: string | undefined;
  let oldTitle: string | undefined;
  let oldStoryUrl: string | undefined;

  if (isActualUpdate && fileName) {
    /**
     * The file on disk IS the story. History is a convenience for versioning.
     *
     * Two failure shapes, both observed, both from trusting history over disk:
     *
     *  - History MISSING: the model is handed no prior code, invents a whole
     *    new composition, and overwrites the user's work — while the reply
     *    claims the layout was preserved, because the model is describing the
     *    thing it just invented. Reported from manual testing, where selecting
     *    one button and asking for a red background replaced an entire page.
     *
     *  - History STALE: something wrote the file without recording a version —
     *    a prop edit, a hand edit — and regenerating from history's current
     *    version silently reverts the change the user is looking at right now.
     *
     * So the disk wins whenever it disagrees with history, and the two cases
     * log differently: absent history and divergent history are different
     * facts, and a log that conflates them makes the next diagnosis a guess.
     */
    let onDiskCode: string | undefined;
    try {
      const onDisk = path.resolve(
        process.cwd(),
        config.generatedStoriesPath || './src/stories/generated',
        fileName,
      );
      if (fs.existsSync(onDisk)) {
        onDiskCode = fs.readFileSync(onDisk, 'utf-8');
      }
    } catch {
      /* unreadable — history below, or the no-prior-code guard */
    }

    const currentVersion = historyManager.getCurrentVersion(fileName);
    if (currentVersion) {
      parentVersionId = currentVersion.id;
      if (onDiskCode !== undefined && onDiskCode !== currentVersion.code) {
        previousCode = onDiskCode;
        logger.log(
          `📄 History for ${fileName} is behind the file on disk (something wrote the file without ` +
          `recording a version) — using the file on disk as the base for this edit`,
        );
      } else {
        previousCode = currentVersion.code;
        if (onDiskCode === undefined) {
          logger.log(`📄 ${fileName} is not readable on disk — using history's current version as the base for this edit`);
        }
      }
    } else if (onDiskCode !== undefined) {
      previousCode = onDiskCode;
      logger.log(`📄 History had no version for ${fileName}; using the file on disk as the base for this edit`);
    }

    if (previousCode && isFallbackStoryCode(previousCode)) {
      previousCodeIsFallback = true;
      logger.log(
        `📄 The baseline for ${fileName} is the placeholder a failed generation wrote — ` +
        `the edit-divergence guard is skipped so this retry can rebuild from scratch`,
      );
    }

    if (previousCode) {
      const titleMatch = previousCode.match(/title:\s*["']([^"']+)['"]/);
      if (titleMatch) {
        oldTitle = titleMatch[1];
        const cleanOldTitle = oldTitle.replace(config.storyPrefix || 'Generated/', '');
        oldStoryUrl = `/story/${cleanOldTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}--primary`;
      }
    } else {
      // An edit with nothing to edit. Regenerating from scratch here is how a
      // one-word request ("Red background.") silently destroys a page, so say
      // so rather than letting it look like a successful modification.
      logger.warn(
        `⚠️ Update requested for "${fileName}" but no prior code was found in history or on disk — ` +
        `this will generate a NEW composition rather than modify the existing one`,
      );
    }
  }

  // Intent preview
  const intent = analyzeIntent(prompt, config, conversation, previousCode, {
    framework: detectedFramework,
    designSystem,
    hasImages: attachments.some(a => a.type === 'image'),
  });
  events.onIntent?.(intent);

  // Step 3: Build prompt
  events.onProgress?.(3, totalSteps, 'prompt_built', 'Building generation prompt...', {
    framework: intent.framework,
    hasContext: intent.promptAnalysis.hasConversationContext,
  });

  /**
   * A retry from the shippable gate carries what the browser measured on the
   * previous attempt. Appended to the request, not the system prompt, so it
   * reads as this request's requirement.
   */
  const promptForModel = request.gateFeedback?.length
    ? `${prompt}\n\nTHE PREVIOUS ATTEMPT FAILED VERIFICATION. Rendered in a browser, it had these defects:\n${request.gateFeedback.map(f => `- ${f}`).join('\n')}\nProduce a composition that CANNOT have these defects: every value stays inside its container (a shorter value or the type scale's smaller step, never a hand-set size), paired fields align, every panel holds content, nothing overlaps, and nothing beyond the request is added.`
    : prompt;
  let initialPrompt = await buildClaudePromptWithContext(
    promptForModel, config, conversation, previousCode, components, {
      framework: detectedFramework,
      visionMode: visionMode as VisionPromptType | undefined,
      designSystem,
      considerations,
      storybookContext,
      selection,
      pins,
      storybookUrl: projectStorybookUrl || undefined,
      spacing: spacingVocab,
      styling: stylingFacts,
      icons: iconVocab,
    }
  );

  if (voiceMode && conversation && conversation.length > 0) {
    initialPrompt = VOICE_MODE_PREAMBLE + '\n\n' + initialPrompt;
  }

  /**
   * Everything above "User request:" — the catalog, the docs, the rules, the
   * considerations — is the same for every attempt of this request and for
   * every repair of this story. Sent as the system block, which the Claude
   * provider marks cacheable, so retries and repairs stop paying for the
   * 15k-token catalog. The request itself stays in the user turn.
   */
  const split = splitAtUserRequest(initialPrompt);
  logger.log(split
    ? `🧱 Prompt: system ${split.system.length} chars (cacheable), user ${split.user.length} chars`
    : `🧱 Prompt: ${initialPrompt.length} chars in one user turn (no "User request:" marker)`);
  if (process.env.STORY_UI_DUMP_PROMPT) {
    // The exact prompt, for reading with eyes. Opt-in; it is large.
    try {
      const dumpDir = path.join(os.tmpdir(), 'story-ui-prompts');
      fs.mkdirSync(dumpDir, { recursive: true });
      const dumpPath = path.join(dumpDir, `${Date.now()}.prompt.txt`);
      fs.writeFileSync(dumpPath, split ? `=== SYSTEM ===\n${split.system}\n\n=== USER ===\n${split.user}` : initialPrompt, 'utf-8');
      logger.log(`🧱 Prompt written to ${dumpPath}`);
    } catch { /* diagnostics only */ }
  }
  const messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = split
    ? [{ role: 'system', content: split.system }, { role: 'user', content: split.user }]
    : [{ role: 'user', content: initialPrompt }];

  // Step 4: Self-healing generation loop
  throwIfCancelled('generation');
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

  /** Each component's real package, for repairing a scope-root import. */
  const componentHomes = new Map<string, string>();
  for (const c of components as any[]) {
    const home = c.__componentPath || c.source?.path;
    if (c.name && typeof home === 'string' && home.includes('/')) componentHomes.set(c.name, home);
  }

  /**
   * The title is a separate, trivial model call that used to sit on the
   * critical path between the generation and the write (1–3s, sometimes 30s
   * when the provider was slow). It depends only on the request, so it runs
   * alongside the generation and is awaited when the file is named.
   */
  const titleNeedsModel = !(isActualUpdate && originalTitle);
  const titlePromise: Promise<string> = titleNeedsModel
    ? getLLMTitle(isActualUpdate && conversation
        ? (conversation.find((msg) => msg.role === 'user')?.content || prompt)
        : prompt, provider)
    : Promise.resolve(stripStoryPrefix(originalTitle as string, config.storyPrefix));

  let aiText = '';
  /** The model's last raw reply, for the prose it wrote around the code. */
  let lastModelReply = '';
  /** Edit blocks the update was answered with, for the client's diff view. */
  let appliedEdits: Array<{ search: string; replace: string }> | undefined;
  /** Stylesheet emitted alongside the story, when the model needed real states. */
  let generatedStylesheet: string | null = null;
  let finalErrors: ValidationErrors = createEmptyErrors();
  /**
   * Divergence findings from the last attempt, kept apart from the aggregate.
   *
   * They ride inside importErrors so the healing loop retries on them like any
   * other error, but folding them in for REPORTING made a persistent
   * divergence failure throw INVALID_IMPORTS — the user asked for a small
   * change, was told their imports were wrong, and neither was true.
   */
  let finalEditErrors: string[] = [];
  const errorHistory: ValidationErrors[] = [];
  const allAttempts: Array<{ code: string; errors: ValidationErrors; editErrors: string[] }> = [];
  let attempts = 0;
  let selfHealingUsed = false;
  let lastAstResult: ValidationResult | null = null;
  // What the last auto-fix did, read from the text it changed.
  let autoFixDetails: string[] | undefined;

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

    // Streamed when there are no images (the streaming path carries text
    // only). The one-per-second progress event is the only evidence of life
    // the user gets during the longest phase of the run.
    let lastStreamEmit = 0;
    let lastThinkEmit = 0;
    let thinkingText = '';
    let planSent = '';
    let codeSent = '';
    let lastCodeEmit = 0;
    // Only an image or a PDF needs the buffered multi-part call. Text files
    // are folded into the user turn by callLLM anyway; sending them through
    // the buffered path lost the thinking/plan narration for the whole run.
    const needsBufferedCall = attachments.some(a => a.type !== 'text');
    if (!needsBufferedCall && attachments.length > 0) {
      const textBlocks = attachments.filter((a): a is TextContent => a.type === 'text');
      const targetIndex = messages.findIndex(m => m.role === 'user');
      if (targetIndex !== -1) {
        const preface = `${fileFraming(textBlocks.length)}\n\n${textBlocks.map(b => b.text).join('\n\n')}\n\n`;
        messages[targetIndex] = { ...messages[targetIndex], content: preface + messages[targetIndex].content };
      }
    }
    const llmResult = needsBufferedCall
      ? await callLLM(messages, attachments, { provider, model, ...(cancelSignal ? { signal: cancelSignal } : {}) })
      : await callLLMStreaming(messages, { provider, model, ...(cancelSignal ? { signal: cancelSignal } : {}) }, (chars, accumulated) => {
          /**
           * The model is asked to say, in a few sentences, what it is about to
           * build before it writes the code. That prose is the narration the
           * user reads while the code streams — everything before the first
           * fence, sent as it arrives. Nothing inside the fence is sent as text.
           */
          const fence = accumulated.indexOf('```');
          const plan = fence >= 0 ? accumulated.slice(0, fence) : accumulated;
          if (plan.length > planSent.length && plan.startsWith(planSent)) {
            events.onLlmText?.({ phase: 'plan', delta: plan.slice(planSent.length), accumulated: plan });
            planSent = plan;
          }
          /**
           * The code itself, as it is written, so the canvas can show the file
           * growing instead of a placeholder. Everything after the opening
           * fence line; throttled; delta only.
           */
          if (fence >= 0) {
            const nl = accumulated.indexOf('\n', fence);
            const codeSoFar = nl >= 0 ? accumulated.slice(nl + 1) : '';
            const now = Date.now();
            if (codeSoFar.length > codeSent.length && now - lastCodeEmit >= 150) {
              events.onLlmText?.({ phase: 'code', delta: codeSoFar.slice(codeSent.length), accumulated: '' });
              codeSent = codeSoFar;
              lastCodeEmit = now;
            }
          }
          const now = Date.now();
          if (now - lastStreamEmit < 1000) return;
          lastStreamEmit = now;
          events.onProgress?.(4, totalSteps, 'llm_thinking', 'AI is generating your story...', { charsWritten: chars });
        }, (delta) => {
          // The model's own summary of its reasoning, while nothing else is
          // visible. Capped so a long think does not become a wall of text.
          thinkingText = (thinkingText + delta).slice(-2000);
          const now = Date.now();
          if (now - lastThinkEmit < 300) return;
          lastThinkEmit = now;
          events.onLlmText?.({ phase: 'thinking', delta, accumulated: thinkingText });
        });
    const claudeResponse = llmResult.content;
    lastModelReply = llmResult.content;

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

    /**
     * An update answered with edit blocks is applied to the previous code
     * here, deterministically. A block whose SEARCH is not in the file (or is
     * in it twice) is sent back to the model with the reason, once; the file
     * is never guessed at. A complete file in a tsx block still works.
     */
    let replyForExtraction = claudeResponse;
    if (previousCode && !previousCodeIsFallback && hasPatchBlocks(claudeResponse)) {
      const blocks = parsePatchBlocks(claudeResponse);
      const patched = applyPatches(previousCode, blocks);
      if (patched.failures.length > 0 && attempts < selfHealingOptions.maxAttempts) {
        logger.warn(`✂️ ${patched.failures.length} of ${blocks.length} edit block(s) did not apply — asking for corrected blocks`);
        events.onRetry?.(attempts + 1, selfHealingOptions.maxAttempts,
          `${patched.failures.length} edit block(s) did not match the file`, patched.failures.map(f => f.reason));
        messages.push({ role: 'assistant', content: claudeResponse });
        messages.push({
          role: 'user',
          content: [
            'These edit blocks could not be applied:',
            '',
            describePatchFailures(patched.failures),
            '',
            'Copy each SEARCH exactly from PREVIOUS GENERATED CODE — same lines, same indentation —',
            'and make it match one place. Resend ALL the edit blocks (the applied ones too) in one ```edit fence.',
          ].join('\n'),
        });
        continue;
      }
      if (patched.failures.length === 0) {
        logger.log(`✂️ Applied ${patched.applied.length} edit block(s) to the previous code`);
        replyForExtraction = '```tsx\n' + patched.code + '\n```';
        appliedEdits = patched.applied.map(b => ({ search: b.search, replace: b.replace }));
      } else {
        logger.warn(`✂️ ${patched.failures.length} edit block(s) still did not apply on the last attempt — applying the ${patched.applied.length} that did`);
        replyForExtraction = '```tsx\n' + patched.code + '\n```';
      }
    }

    const extractedCode = extractCodeBlock(replyForExtraction, detectedFramework);
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
      /**
       * A reply with no code is an answer, not a story. Falling through wrote
       * the prose into a fallback story titled with the model's first sentence
       * ("I'd be happy to help but I don't see an attached spec…"); the
       * apostrophe broke the file and Storybook's index lost every story.
       * The model's words go back to the user as the reply, and nothing is
       * written.
       */
      const said = proseBeforeFence(claudeResponse).replace(/\s+/g, ' ').slice(0, 400);
      logger.warn(`🙅 The model answered without code after ${attempts} attempt(s): ${said.slice(0, 160)}`);
      throw new GenerationError('MODEL_DECLINED', said || 'The model did not produce a story.', {
        httpStatus: 422,
        recoverable: true,
        suggestion: 'Rephrase the request, or attach what the model asked for, and send again.',
        details: said,
      });
    }
    aiText = extractedCode;

    /**
     * Deterministic repair before validation judges the result.
     *
     * The model collapses some components onto the npm SCOPE root even with a
     * correct, complete catalog in front of it, and repeats it through every
     * healing attempt. The right package for each component is a fact
     * discovery already holds, so this is fixed from data rather than by
     * spending another LLM call on an instruction that has not worked.
     */
    aiText = splitScopeImports(aiText, config.importPath, componentHomes);
    {
      // A relative import that does not resolve is a story Vite cannot serve.
      // Where discovery knows the file, the fix is on disk — apply it here,
      // before validation, and say so.
      const moved = relocateUnresolvableImports(aiText, path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated'), components as any);
      if (moved.relocated.length) {
        logger.log(`🧭 Relocated ${moved.relocated.length} import(s) to the files discovery knows: ${moved.relocated.slice(0, 6).join('; ')}`);
        aiText = moved.code;
      }
    }

    // Step 5: Validation (pattern + AST + imports)
    events.onProgress?.(5, totalSteps, 'validating', 'Validating generated code...');

    /**
     * An update must not become a rewrite.
     *
     * When the user pointed AT something, a selection plus a short request is
     * a property change, and it cannot legitimately replace most of the tree.
     * Without this the model can restart from scratch, overwrite the page, and
     * describe the result as a preserved layout — which is what happened when
     * "Red background." on one button returned a different page entirely.
     *
     * A conversational follow-up with no selection gets the same guard at a
     * looser threshold. Compositional requests legitimately change structure —
     * "add a filters panel" adds elements, "make it three columns" moves them,
     * "rewrite the copy" replaces the words — and divergence is measured
     * relative to the PREVIOUS code, so all of those score well under the
     * limit. What none of them can defend is the previous work almost entirely
     * gone, which is the only thing the loose threshold blocks.
     *
     * Fed into the same self-healing loop as any other error, so the retry
     * carries the original code and an explicit instruction, and the attempt
     * with the LOWEST error count still wins if the model cannot comply.
     */
    const TARGETED_EDIT_DIVERGENCE_LIMIT = 0.5;
    // The arithmetic bounds this limit: editDivergence weights tags 0.35 and
    // content 0.65, so a rewrite that keeps the same tag multiset but replaces
    // ALL text and attributes — the documented "same components, entirely
    // different page" failure — caps at 0.65. The limit must sit BELOW 0.65 or
    // it can never fire on that case (0.85 was unreachable). 0.6 blocks the
    // full content rewrite while legitimate work passes: divergence measures
    // overlap relative to the PREVIOUS code, so pure additions score ~0 and
    // prop tweaks score well under 0.4.
    const CONVERSATIONAL_UPDATE_DIVERGENCE_LIMIT = 0.6;
    const editErrors: string[] = [];
    if (previousCode && !previousCodeIsFallback) {
      const { divergence, before, after } = editDivergence(previousCode, aiText);
      const limit = selection ? TARGETED_EDIT_DIVERGENCE_LIMIT : CONVERSATIONAL_UPDATE_DIVERGENCE_LIMIT;
      if (divergence > limit) {
        editErrors.push(selection
          ? `This was a targeted edit to "${selection}", but the result replaced the composition ` +
            `(${Math.round(divergence * 100)}% of the element structure and content changed; ${before} elements before, ${after} after). ` +
            `Return the ORIGINAL code with ONLY the requested change applied. Do not rewrite, re-theme, ` +
            `or re-content anything else — every other element, prop and string must be byte-identical.`
          : `This was an update to an existing story, but the result replaced nearly all of it ` +
            `(${Math.round(divergence * 100)}% of the element structure and content changed; ${before} elements before, ${after} after). ` +
            `Modify the PREVIOUS GENERATED CODE instead of starting over — keep every element, prop ` +
            `and string the request did not ask to change.`,
        );
        logger.warn(
          `⚠️ ${selection ? 'Targeted edit' : 'Update'} diverged ${Math.round(divergence * 100)}% from the original ` +
          `(limit ${Math.round(limit * 100)}%) — treating as a failed edit`,
        );
        // What came back, so a rejection can be diagnosed from the log alone:
        // a fragment, a truncation and a genuine rewrite look identical above.
        try {
          // The reply itself, so the next diagnosis does not need a re-run.
          const dumpDir = path.join(os.tmpdir(), 'story-ui-rejected');
          fs.mkdirSync(dumpDir, { recursive: true });
          const dumpPath = path.join(dumpDir, `${fileName || 'story'}.${Date.now()}.attempt${attempts + 1}.txt`);
          fs.writeFileSync(dumpPath, aiText, 'utf-8');
          logger.warn(`   rejected reply saved to ${dumpPath}`);
        } catch { /* diagnostics only */ }
        logger.warn(
          `   reply: ${aiText.length} chars, ${aiText.split('\n').length} lines, ` +
          `${/export\s+default/.test(aiText) ? 'has' : 'NO'} default export, ` +
          `${/^\s*import\s/m.test(aiText) ? 'has' : 'NO'} imports; ` +
          `previous: ${previousCode.length} chars. First line: ${JSON.stringify(aiText.split('\n').find(l => l.trim()) ?? '')}`,
        );
      }
    }

    const patternErrors = validateStory(aiText);

    const validationFileName = `story${frameworkAdapter.defaultExtension || '.stories.tsx'}`;
    let astResult: ValidationResult | null = null;
    try {
      astResult = validateStoryCode(aiText, validationFileName, config);
      if (astResult.fixedCode) {
        autoFixDetails = describeAutoFix(aiText, astResult.fixedCode, astResult.errors);
        aiText = astResult.fixedCode;
        logger.log(autoFixDetails.length
          ? `🔧 Auto-fix: ${autoFixDetails.join('; ')}`
          : '🔧 Auto-fix reported, but the code is unchanged');
      }
    } catch (astError) {
      // A validator that crashed has not passed. Leaving astResult null here
      // made the aggregator read "no syntax errors" and write the story.
      logger.error('AST validation error:', astError);
      astResult = {
        isValid: false,
        errors: [`The syntax validator crashed on this code: ${astError instanceof Error ? astError.message : String(astError)}`],
        warnings: [],
      };
    }
    lastAstResult = astResult;

    const importValidation = detectedFramework === 'web-components'
      ? { isValid: true, errors: [] }
      : await preValidateImports(aiText, config, discovery);
    // Isolation runs for EVERY framework: generated code may only import from
    // the configured library, framework runtime, and explicit allowances.
    // Again here, immediately before judging: an earlier pass (auto-fix,
    // barrel rewriting) can reintroduce a scope-root import after the first
    // repair, and validation must judge the code that will actually be written.
    aiText = splitScopeImports(aiText, config.importPath, componentHomes);
    {
      // A relative import that does not resolve is a story Vite cannot serve.
      // Where discovery knows the file, the fix is on disk — apply it here,
      // before validation, and say so.
      const moved = relocateUnresolvableImports(aiText, path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated'), components as any);
      if (moved.relocated.length) {
        logger.log(`🧭 Relocated ${moved.relocated.length} import(s) to the files discovery knows: ${moved.relocated.slice(0, 6).join('; ')}`);
        aiText = moved.code;
      }
    }
    const isolationErrors = validateImportIsolation(aiText, config, detectedFramework, considerationsText, components as any);
    // A resolving specifier is not an existing binding: verified against the
    // module on disk, for relative imports where that answer is certain.
    const namedImportErrors = validateLocalNamedImports(
      aiText, path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated'), components as any, config as any,
    );
    /**
     * Does the output conform to the facts we handed the model?
     *
     * Static, free, and keyed to the knowledge layer rather than to a list of
     * remembered bugs — so it strengthens whenever extraction learns something
     * new, with no code change here. Fires only on facts that are closed by
     * construction (resolved enum sets, known deprecations); see conformance.ts
     * for why required- and unknown-prop checks are deliberately absent.
     */
    // JSX only: the checker walks JSX attributes, so on a Vue, Svelte, Angular
    // or Lit story it found nothing and looked like a pass.
    if (detectedFramework === 'react') {
      // `(): JSX.Element` is TS2503 under React 19 — deterministic, so fixed
      // here rather than sent back to the model.
      const jsxFix = rewriteGlobalJsxNamespace(aiText);
      if (jsxFix.removed || jsxFix.qualified) {
        logger.log(`🔧 JSX namespace: removed ${jsxFix.removed} \`: JSX.Element\` return annotation(s), qualified ${jsxFix.qualified} other JSX.* reference(s)`);
        aiText = jsxFix.code;
      }
    }
    const conformanceErrors = detectedFramework === 'react'
      ? formatConformanceErrors(checkConformance(aiText, knownProps))
      : (logger.log(`📐 Conformance: not applicable to ${detectedFramework} (JSX-only check) — skipped, not passed`), []);
    if (conformanceErrors.length) {
      logger.log(`📐 Conformance: ${conformanceErrors.length} violation(s) of the catalog we supplied`);
    }
    /**
     * Every prop must be one the receiving component declares.
     *
     * Judged against the attributes type the project's own TypeScript computes
     * for the element — the ceiling, where the extracted catalog is a floor —
     * and only where that set is closed. A component whose props are `any` or
     * carry an index signature is skipped and named in the log, so absent and
     * zero look different; see propConformance.ts.
     */
    if (detectedFramework === 'react') {
      const propReport = checkPropConformance(aiText, {
        storiesDir: path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated'),
      });
      logger.log(`🧷 Prop check: ${summarisePropConformance(propReport)}`);
      conformanceErrors.push(...formatPropConformanceErrors(propReport));
    }
    // Every var(--x) must be a token the project declares. Skipped, and said
    // so, when the project declares none — absent and zero look different.
    if (knownTokens === null) {
      knownTokens = new Set(readDesignTokens(process.cwd(), config.importPath).flatMap(g => g.names));
    }
    const tokenErrors = knownTokens.size
      ? formatTokenErrors(checkTokenUsage(aiText, knownTokens))
      : (logger.log('🎨 Token check: project declares no CSS custom properties — skipped, not passed'), []);
    if (tokenErrors.length) {
      logger.log(`🎨 Token check: ${tokenErrors.length} invented token(s): ${tokenErrors.map(e => e.split('var(')[1]?.split(')')[0]).filter(Boolean).join(', ')}`);
      conformanceErrors.push(...tokenErrors);
    } else if (knownTokens.size) {
      // Say it ran: a silent pass is indistinguishable from a check that never
      // looked (the first CBDS re-run went to a stale server and looked the same).
      logger.log(`🎨 Token check: ${(aiText.match(/var\(\s*--/g) || []).length} var() use(s), all declared by the project (${knownTokens.size} tokens)`);
    }

    /**
     * Inline spacing literals and primitive-for-semantic colours, judged
     * against the same vocabulary the prompt was written from. Three states,
     * each said out loud: not derived (skipped), derived with no scale
     * (skipped — the fallback prompt allowed inline spacing), and checked.
     */
    if (!spacingVocab) {
      logger.log('📏 Spacing check: vocabulary not derived — skipped, not passed');
    } else if (!spacingVocab.hasScale) {
      logger.log('📏 Spacing check: design system declares no gap primitive, no spacing tokens and no utility scale — skipped, not passed');
    } else {
      const spacingViolations = checkInlineSpacing(aiText, spacingVocab);
      if (spacingViolations.length) {
        logger.log(`📏 Spacing check: ${spacingViolations.length} inline spacing/typography literal(s): ${spacingViolations.slice(0, 6).map(v => `L${v.line} ${v.property}=${v.value}`).join(', ')}`);
        conformanceErrors.push(...formatSpacingErrors(spacingViolations));
      } else {
        logger.log(`📏 Spacing check: 0 inline spacing literals (${spacingVocab.source})`);
      }
    }
    if (spacingVocab && Object.keys(spacingVocab.aliasesOf).length) {
      const tierViolations = checkTokenTiers(aiText, spacingVocab);
      if (tierViolations.length) {
        logger.log(`🎨 Token tiers: ${tierViolations.length} primitive colour(s) used where a semantic alias exists: ${tierViolations.slice(0, 6).map(v => `--${v.primitive}→--${v.aliases[0]}`).join(', ')}`);
        conformanceErrors.push(...formatTierErrors(tierViolations));
      } else {
        logger.log(`🎨 Token tiers: no primitive colour used where an alias exists (${Object.keys(spacingVocab.aliasesOf).length} aliased primitives)`);
      }
      const colorViolations = checkRawColors(aiText, spacingVocab);
      if (colorViolations.length) {
        logger.log(`🎨 Colour literals: ${colorViolations.length} inline hex/rgb value(s): ${colorViolations.slice(0, 6).map(v => `L${v.line} ${v.property}=${v.value}`).join(', ')}`);
        conformanceErrors.push(...formatColorErrors(colorViolations));
      } else {
        logger.log('🎨 Colour literals: none inline (the project declares colour tokens)');
      }
    } else if (spacingVocab) {
      logger.log('🎨 Token tiers and colour literals: project declares no colour tokens — skipped, not passed');
    }
    // Names imported from a derived icon package must be names it exports.
    if (iconVocab?.packages.some(p => p.exports.length)) {
      const iconErrors = checkIconImports(aiText, iconVocab);
      if (iconErrors.length) {
        logger.log(`🖼️ Icon imports: ${iconErrors.length} name(s) the package does not export: ${iconErrors.slice(0, 6).map(v => v.name).join(', ')}`);
        conformanceErrors.push(...formatIconImportErrors(iconErrors));
      } else if (iconVocab.packages.some(p => new RegExp(`from\\s*['"]${p.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(aiText))) {
        logger.log('🖼️ Icon imports: every imported icon name is exported by its package');
      }
    }

    const importErrors = [
      ...(importValidation.isValid ? [] : importValidation.errors),
      ...isolationErrors,
      ...namedImportErrors,
      ...editErrors,
      ...conformanceErrors,
    ];

    const currentErrors = aggregateValidationErrors(astResult, patternErrors, importErrors);
    errorHistory.push(currentErrors);
    allAttempts.push({ code: aiText, errors: currentErrors, editErrors });

    if (hasNoErrors(currentErrors)) {
      logger.log('✅ Validation passed on attempt', attempts);
      events.onValidation?.({
        isValid: true,
        errors: [],
        warnings: [],
        autoFixApplied: !!astResult?.fixedCode,
      });
      finalErrors = currentErrors;
      finalEditErrors = editErrors;
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
      // Kept in buckets as well as flattened: which KIND of error the first
      // model output produced is the thing prevention work aims at, and the
      // flat list cannot answer it.
      errorsByBucket: {
        syntax: currentErrors.syntaxErrors,
        pattern: currentErrors.patternErrors,
        import: currentErrors.importErrors,
      },
    });

    finalErrors = currentErrors;
    finalEditErrors = editErrors;

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
      // selectBestAttempt narrows the type; the chosen object is still ours.
      finalEditErrors = (bestAttempt as typeof allAttempts[number]).editErrors ?? [];
      logger.log(`📌 Selected best attempt with ${getTotalErrorCount(finalErrors)} errors`);
    }
  }
  if (selfHealingUsed) {
    logger.log(`🔄 Self-healing summary: ${attempts} attempts, final errors: ${formatErrorsForLog(finalErrors)}`);
  }

  // Step 6: Code extraction and final processing
  events.onProgress?.(6, totalSteps, 'code_extracted', 'Processing generated code...');

  /**
   * A persistent divergence failure is its own outcome, named as what it is.
   *
   * It travels through the loop inside importErrors, but throwing it as
   * INVALID_IMPORTS told the user their imports were wrong when the actual
   * event was "the model rewrote your page and we refused to save it". Nothing
   * has been written at this point, and the message says so — that the
   * existing story is intact is the one fact the user needs.
   */
  if (finalEditErrors.length > 0) {
    logger.log(`❌ Edit divergence persisted through ${attempts} attempt(s) — the existing story was left untouched`);
    throw new GenerationError('EDIT_DIVERGENCE', 'The change replaced too much of the existing story; nothing was written', {
      httpStatus: 422,
      details: finalEditErrors.join('; '),
      recoverable: true,
      suggestion: 'Try describing the change more narrowly, or break it into smaller steps — the existing story is unchanged',
    });
  }

  if (finalErrors.importErrors.length > 0) {
    logger.log(`❌ Import validation failed. Invalid components: ${finalErrors.importErrors.join(', ')}`);
    // What the model ACTUALLY wrote. An error that says "your imports were
    // rejected" without showing them makes every diagnosis a guess — three
    // separate investigations on this branch had to reconstruct it by hand.
    logger.log(
      `   imports as written:\n${
        (aiText.match(/^\s*import[^;\n]*(from\s*['"][^'"]+['"])?;?/gm) || [])
          .slice(0, 12).map(l => `     ${l.trim()}`).join('\n') || '     (none)'
      }`,
    );
    // Conformance violations ride in importErrors (same repair budget); they
    // are not import problems and must not be reported as such.
    const allConformance = finalErrors.importErrors.every(e => /^Line \d+: </.test(e) || /^</.test(e));
    throw new GenerationError(
      allConformance ? 'CATALOG_CONFORMANCE' : 'INVALID_IMPORTS',
      allConformance
        ? 'The generated code used prop values the design system does not accept'
        : 'Generated code contains invalid imports',
      {
        httpStatus: 422,
        details: finalErrors.importErrors.join('; '),
        recoverable: true,
        suggestion: allConformance
          ? 'Try again — the value sets are shown to the model; if this repeats, the prop may accept more than the catalog lists.'
          : buildComponentSuggestion(components),
      },
    );
  }

  const validationResult = extractAndValidateCodeBlock(aiText, config);
  let fileContents: string;
  /**
   * Seeded from what the healing loop actually ended up with.
   *
   * Only import errors throw above; syntax and pattern errors that survived
   * every attempt (`UNSAFE_style`, emoji-as-icon, a missing `export default
   * meta`) fall through here, and `extractAndValidateCodeBlock` below is
   * AST-only so it never sees them again. Starting at `false` meant the SSE
   * route computed `isValid: !hasWarnings` = true while `validation.errors`
   * was non-empty — the story shipped flagged as clean, carrying the errors
   * that describe why it is not.
   */
  let hasValidationWarnings = !hasNoErrors(finalErrors);
  if (hasValidationWarnings) {
    logger.warn(`⚠️ Shipping with unresolved validation errors: ${formatErrorsForLog(finalErrors)}`);
  }
  let isFallbackStory = false;

  if (!validationResult.isValid && !validationResult.fixedCode) {
    // The hash is already unique per generation; passing it as the story id
    // stops two failures from colliding and breaking Storybook's index.
    fileContents = createFrameworkAwareFallbackStory(
      prompt, cleanPromptForTitle(prompt), config, detectedFramework,
      // Hashed from the prompt AND the moment, because the same prompt failing
      // twice is exactly the case that collided.
      `fallback-${crypto.createHash('sha1').update(`${prompt}${startedAt}`).digest('hex').slice(0, 8)}`,
    );
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

  // Title — started before the generation loop; see titlePromise.
  let aiTitle: string = await titlePromise;
  if (titleNeedsModel) events.onLLMCall?.();
  if (!aiTitle || aiTitle.length < 2) {
    aiTitle = cleanPromptForTitle(prompt);
  }

  // IDs
  const fileExtension = frameworkAdapter.defaultExtension || '.stories.tsx';
  let hash: string;
  let finalFileName: string;
  let storyId: string;

  if (request.regenerateOf) {
    // A gate retry: the failed attempt's identity, so the retry overwrites it.
    hash = request.regenerateOf.hash;
    finalFileName = request.regenerateOf.fileName;
    storyId = `story-${hash}`;
  } else if (isActualUpdate && (fileName || providedStoryId)) {
    if (providedStoryId) {
      storyId = providedStoryId;
      // The classic panel sends the FILE NAME as storyId. Hashing the prompt
      // instead gave the update a brand-new id, the panel polled the index
      // for a story that does not exist, and reported "index stalled" over a
      // story that had rendered and verified. The file's own hash is the id.
      const hashMatch = providedStoryId.match(/^story-([a-f0-9]{8})$/)
        ?? providedStoryId.match(/-([a-f0-9]{8})(?:\.stories\.\w+)?$/)
        ?? fileName?.match(/-([a-f0-9]{8})(?:\.stories\.\w+)?$/);
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
  const cleanTitle = request.regenerateOf
    ? sanitizeStoryTitle(request.regenerateOf.title)
    : sanitizeStoryTitle(isActualUpdate ? prettyPrompt : storyTracker.getNextVersionTitle(prettyPrompt));
  if (cleanTitle !== prettyPrompt) {
    logger.log(`📋 Title "${prettyPrompt}" already exists, using "${cleanTitle}" instead`);
  }
  const storyIdSlug = `${cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${hash}`;

  // Finalizer applied to the initial code AND any runtime-healed regeneration,
  // so both go through identical title/prefix/id/import treatment.
  const finalizeStoryCode = (code: string): { code: string; finalValidationErrors: string[] } => {
    let fixed = postProcessStory(code, config.importPath);
    // Whatever the model did to a hand-set prop, put it back. Runs on the
    // first result, on a runtime-healed result and on a repair candidate
    // alike, because all three come through here.
    if (pins.length) {
      const r = reapplyPins(fixed, pins);
      fixed = r.code;
      for (const p of r.applied) pinReport.applied.add(describePin(p));
      for (const p of r.kept) pinReport.kept.add(describePin(p));
      for (const p of r.lost) pinReport.lost.add(describePin(p));
      if (r.applied.length) logger.log(`📌 Restored ${r.applied.length} pinned prop(s) the model had changed: ${r.applied.map(describePin).join(', ')}`);
      if (r.lost.length) logger.warn(`📌 ${r.lost.length} pinned prop(s) no longer have an element: ${r.lost.map(describePin).join(', ')}`);
    }
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

    /**
     * THE LAST WORD ON IMPORTS. Nothing may run after this.
     *
     * The model writes `import { Box, Stack, Flex } from '@atlaskit'` in its
     * raw output — verified by logging the code before any transform — with a
     * correct 4KB catalog in front of it saying `@atlaskit/primitives`, and it
     * repeats that through every self-healing attempt. Three prompt revisions
     * did not move it.
     *
     * Every component's real package is a fact discovery already holds, so
     * this is repaired from data at zero cost instead of spending more LLM
     * calls on an instruction that does not land. It has to be last because
     * validation and barrel-rewriting both run after the earlier repair and
     * put the scope import back.
     */
    fixed = splitScopeImports(fixed, config.importPath, componentHomes);
    {
      const moved = relocateUnresolvableImports(fixed, path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated'), components as any);
      if (moved.relocated.length) {
        logger.log(`🧭 Relocated ${moved.relocated.length} import(s) before writing: ${moved.relocated.slice(0, 6).join('; ')}`);
        fixed = moved.code;
      }
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

  /**
   * Last point at which stopping costs nothing.
   *
   * Placed here rather than inside the runtime-check block, where an earlier
   * attempt put it: that block is wrapped in a try/catch which swallowed the
   * cancellation and the pipeline ran to completion anyway — verified live,
   * a DELETE at 0.7s still produced a finished story 232s later.
   *
   * Before the write is also the only boundary a user would recognise as
   * "nothing happened": after it, the file is on disk and Storybook has
   * already picked it up.
   */
  throwIfCancelled('saving');

  // Step 8: Save story
  events.onProgress?.(8, totalSteps, 'saving', 'Saving your story...');

  // A story may come with a stylesheet — inline style cannot express hover,
  // focus-visible or active states, so anything with real interaction needs one.
  // generatedStylesheet is captured from the model response below.
  /**
   * The last bytes this pipeline put on disk. Once the preview is shown, the
   * user can edit the file (a prop edit, their editor) while verification and
   * repair are still running; a later write from here would silently discard
   * that. So every write after the first checks the file is still ours.
   */
  let lastWritten: string | undefined;
  class FileChangedError extends Error {
    constructor() { super('The story file was changed by someone else while the pipeline was still working on it — leaving their version in place'); this.name = 'FileChangedError'; }
  }
  const writeStory = (code: string): string => {
    const dir = path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated/');
    if (lastWritten !== undefined) {
      let onDisk: string | undefined;
      try { onDisk = fs.readFileSync(path.join(dir, finalFileName), 'utf-8'); } catch { onDisk = undefined; }
      if (onDisk !== undefined && onDisk !== lastWritten) {
        logger.warn('✋ ' + new FileChangedError().message);
        throw new FileChangedError();
      }
    }
    const { storyPath, code: written } = writeStoryArtifacts({
      dir,
      fileName: finalFileName,
      code,
      css: generatedStylesheet,
    });
    // Collect stylesheets whose story was removed by any of the many delete
    // paths that know nothing about them.
    sweepOrphanedArtifacts(dir);
    // What is ON DISK, not what was passed in: with a stylesheet the writer
    // rewrites the import first, and remembering the pre-rewrite bytes made
    // the pipeline refuse its own repair as "changed by someone else".
    lastWritten = written;
    return storyPath;
  };

  let outPath = writeStory(fixedFileContents);

  /**
   * The story exists. Tell the client now.
   *
   * Everything below — runtime check, browser verification, repair, the chat
   * summary — used to stand between the write and the first preview, which
   * made a 49-second generation feel like 49 seconds when the file had been
   * on disk since second 38. The manifest is upserted here too, so a panel
   * that reloads during the background work still finds the story.
   */
  const earlyStorybookId = computeStorybookId(fixedFileContents, storyIdSlug);
  if (!isFallbackStory) {
    try {
      getManifestManager().upsert(finalFileName, {
        id: storyIdSlug,
        title: cleanTitle,
        source: (conversation?.length ?? 0) > 0 ? 'panel' : 'mcp-external',
        metadata: {
          provider: provider ?? undefined,
          model: model ?? undefined,
          prompt,
          lastCompletion: {
            code: fixedFileContents.slice(0, 60_000),
            generationTimeMs: Date.now() - startedAt,
            storybookId: earlyStorybookId,
          },
        },
      });
    } catch (earlyManifestErr) {
      logger.warn('[manifest] early upsert failed (non-fatal):', earlyManifestErr);
    }
    events.onPreviewReady?.({
      fileName: finalFileName,
      title: cleanTitle,
      storybookId: earlyStorybookId,
      isUpdate: isActualUpdate,
      code: fixedFileContents,
    });
  }

  /**
   * The conversational reply runs alongside verification instead of after it.
   * It depends on the request and the components used, both known now; the
   * verification badge is reported separately, so nothing the summary says
   * can be contradicted by a repair that lands later.
   */
  const summaryPromise = isFallbackStory ? null : generateChatSummary({
    prompt,
    isUpdate: isActualUpdate,
    title: cleanTitle,
    componentsUsed: analyzeGeneratedCode(fixedFileContents, prompt, config).componentsUsed.map(c => c.name),
    framework: detectedFramework,
    provider,
    model,
  }).catch((err) => { logger.warn(`Chat summary failed: ${err instanceof Error ? err.message : String(err)}`); return null; });

  // --- Runtime validation, wired into the healing loop ---
  // Requires the file on disk (Storybook must rebuild it), so it runs after
  // the first write; a failure triggers one bounded regeneration attempt.
  const runtimeEnabled = isRuntimeValidationEnabled();
  // Seeded as NOT RUN, not as a pass. When the block below is skipped this
  // value is what `generateStory.ts` reports as `runtimeValidation.success`,
  // so seeding `true` meant a check that never happened claimed the story
  // renders.
  let runtimeResult: RuntimeValidationResult = {
    success: false, storyExists: false, errorType: 'not_run',
    details: 'Runtime validation did not run for this generation',
  };
  let runtimeHealed = false;

  if (runtimeEnabled && !isFallbackStory) {
    try {
      // Narrate the phase: everything after "saving" used to be silent, so a
      // crash-and-heal cycle looked like one long save while the user watched
      // a red error story with no explanation.
      events.onProgress?.(9, totalSteps, 'runtime_check', 'Checking the story renders in Storybook...');
      runtimeResult = await validateStoryRuntime(fixedFileContents, aiTitle, config.storyPrefix,
        { storyId: computeStorybookId(fixedFileContents, storyIdSlug), projectRoot: process.cwd(),
          storybookUrl: projectStorybookUrl || undefined });
      // Only spend a healing LLM call on genuine in-Storybook failures.
      // Infrastructure problems (Storybook not running, story not indexed
      // yet, timeouts) are not code errors and can't be healed.
      const isCodeFailure = !runtimeResult.success &&
        (runtimeResult.errorType === 'module_error' || runtimeResult.errorType === 'render_error');
      if (!runtimeResult.success && !isCodeFailure) {
        const why = runtimeResult.renderError || runtimeResult.details || 'no reason reported';
        logger.warn(`⚠️ Runtime validation inconclusive (${runtimeResult.errorType}): ${why} — skipping healing`);
      }
      if (isCodeFailure) {
        logger.error(`❌ Runtime validation failed: ${runtimeResult.renderError}`);
        events.onRetry?.(attempts + 1, selfHealingOptions.maxAttempts + 1,
          'Story crashed in Storybook — regenerating with the runtime error', [runtimeResult.renderError || 'runtime error']);
        events.onProgress?.(9, totalSteps, 'runtime_healing',
          'The story crashed when it rendered — fixing it',
          { error: (runtimeResult.renderError || '').slice(0, 300) });

        const healed = await attemptRuntimeHealing({
          runtimeResult,
          messages,
          images: attachments,
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
            runtimeResult = await validateStoryRuntime(fixedFileContents, aiTitle, config.storyPrefix,
              { storyId: computeStorybookId(fixedFileContents, storyIdSlug), projectRoot: process.cwd(),
                storybookUrl: projectStorybookUrl || undefined });
            runtimeHealed = runtimeResult.success;
          } catch {
            // Leave the last known result in place.
          }
          logger.log(runtimeHealed
            ? '✅ Runtime healing succeeded — story now loads in Storybook'
            : '⚠️ Runtime healing attempt did not resolve the error');
        }
        // Healing outcome, honestly: "fixed" only when the regenerated story
        // was re-validated and passed. No healed code, a rejected candidate,
        // and a revalidation that still crashes all read as not fixed.
        events.onProgress?.(9, totalSteps,
          runtimeResult.success ? 'runtime_healed' : 'runtime_heal_failed',
          runtimeResult.success
            ? 'Fixed — the story renders now'
            : 'The crash could not be fixed automatically');
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
    /**
     * One wall-clock budget for the ENTIRE post-write verification+repair
     * phase, default 3 minutes, `STORY_UI_VERIFY_BUDGET_MS` to override.
     *
     * Without it this phase was unbounded: one blocker finding triggered a
     * repair LLM call that pushed a generation to ~18 minutes, and the
     * user-facing completion landed 13 minutes after the client's recovery
     * window had given up. Verification is report-only and repair is
     * strictly-better-or-nothing, so on exhaustion the honest outcome is
     * cheap: keep the original story on disk, report what verification found
     * and why repair was skipped or aborted, and COMPLETE the generation.
     *
     * The controller's signal is threaded into every LLM call this phase
     * makes (visual critique, repair), so the timer cancels an in-flight
     * request mid-call rather than waiting politely for it to finish.
     */
    const budgetRaw = Number(process.env.STORY_UI_VERIFY_BUDGET_MS);
    const verifyBudgetMs = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 180_000;
    const verifyPhaseStart = Date.now();
    const verifyDeadline = verifyPhaseStart + verifyBudgetMs;
    const verifyBudget = new AbortController();
    const verifyBudgetTimer = setTimeout(
      () => verifyBudget.abort(new Error(`verification budget of ${verifyBudgetMs}ms exhausted`)),
      verifyBudgetMs,
    );
    verifyBudgetTimer.unref?.();
    try {
      const verifyUrl = projectStorybookUrl;
      /**
       * Say when the URL was a guess.
       *
       * With no storybookUrl from the caller and no STORYBOOK_PORT in the
       * environment, this falls back to the conventional 6006 — which is right
       * for a default Storybook and wrong for every project that chose another
       * port. Verifying against the wrong Storybook does not fail loudly: the
       * story simply is not in that index, and the report describes somebody
       * else's page. Naming it turns a confusing result into an actionable one.
       */
      if (storybookChoice.source === 'environment' && isGuessedStorybookUrl()) {
        logger.log(
          `🔍 No Storybook URL was supplied and STORYBOOK_PORT is unset — verifying against ${verifyUrl} by convention. ` +
          `If this project's Storybook runs elsewhere, set STORYBOOK_PORT so verification reaches it.`,
        );
      }
      if (verifyUrl) {
        // Names of the design system's own components, so a defect rendered by
        // the LIBRARY is reported against the library rather than charged to
        // the composition that used it.
        const libraryComponents = (components as any[]).map(c => c.name).filter(Boolean);
        const generatedDir = path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated');

        /**
         * Vision critique, on unless switched off.
         *
         * Costs one extra call per generation. That buys the class of defect a
         * reviewer notices first and no probe can compute — a region that
         * arrived empty, a primary action that reads as secondary, a request
         * that was half-answered. `STORY_UI_VISUAL_CRITIQUE=false` disables it
         * for anyone who would rather have the latency back.
         */
        const critiqueEnabled = process.env.STORY_UI_VISUAL_CRITIQUE !== 'false';
        const visualCritic = critiqueEnabled
          ? async (critiquePrompt: string, screenshot: Buffer) => {
              events.onLLMCall?.();
              const result = await callLLM(
                [{ role: 'user', content: critiquePrompt }],
                // Full ImageContent shape. An earlier `as any` here passed a
                // flat {data, mediaType} object, which the provider rejected —
                // and the critic's own catch swallowed it, so the pass looked
                // like "no findings" rather than "never ran". Silent no-ops
                // are the failure mode this whole verification stack exists to
                // avoid.
                [{
                  type: 'image',
                  source: { type: 'base64', mediaType: 'image/png', data: screenshot.toString('base64') },
                }],
                // The phase budget can cancel the critique mid-call too — it
                // is part of the same bounded phase as repair.
                { provider, model, signal: verifyBudget.signal },
              );
              return result.content;
            }
          : undefined;
        events.onProgress?.(10, totalSteps, 'verifying', 'Rendering the story in a browser and inspecting it...');
        verification = await verifyStory({
          storybookUrl: verifyUrl,
          storyIdPrefix: storyIdSlug,
          title: cleanTitle,
          fileName: finalFileName,
          projectRoot: process.cwd(),
          libraryComponents,
          generatedDir,
          visualCritic,
          // A targeted turn is judged as a targeted turn. Told only the raw
          // request, the critic filed "background not orange" against a page
          // whose one selected tile was, correctly, the only orange thing.
          request: selection ? scopedCritiqueRequest(prompt, selection) : prompt,
          componentsUsed: libraryComponents,
          framework: detectedFramework,
        });
        /**
         * The count the narration quotes. Blockers are what gate the outcome
         * and trigger repair; when the outcome is 'issues' with no blocker
         * findings (defensive — shouldn't happen), fall back to the total so
         * "found 0 issues — repairing" can never be said.
         */
        const blockerCount = verification.findings.filter(f => f.severity === 'blocker').length
          || verification.findings.length;
        // Enforce mode: repair what the browser observed.
        //
        // Gated on STORY_UI_VERIFY_ENFORCE because it spends an extra LLM call
        // and, unlike report-only, can change the user's story. The repair
        // helper refuses to ship anything that does not strictly reduce
        // blockers, so the worst case is a wasted call rather than a damaged
        // composition.
        /**
         * On by default.
         *
         * The verification stack finds real, specific defects — a row using 11
         * of 16 columns, a control nothing can focus — and until now did
         * nothing about them. Repair is strictly-better-or-nothing by
         * construction: the candidate is re-verified and discarded unless it
         * reduces blockers, and the original is restored on disk either way,
         * so the worst case is one wasted call rather than a damaged story.
         *
         * Measured: 1 blocker to 0 on a story it could rewrite. The limit is
         * SIZE — a 380-line composition exceeds the output ceiling and is kept
         * unchanged, which is reported rather than silently skipped.
         */
        const enforce = process.env.STORY_UI_VERIFY_ENFORCE !== 'false';
        if (enforce && verification.outcome === 'issues' && Date.now() >= verifyDeadline) {
          // Verification itself consumed the whole budget. Its findings stand
          // and are reported; repair never started, and saying "not attempted"
          // is a different fact from "attempted and failed".
          verification.repair = {
            status: 'not-attempted',
            note: `verification used the whole ${verifyBudgetMs}ms budget ` +
              `(${Date.now() - verifyPhaseStart}ms elapsed) — repair skipped, original story kept`,
          };
          logger.warn(`⚠️ ${verification.repair.note}`);
          events.onProgress?.(11, totalSteps, 'verify_repair_failed',
            'Out of time to repair what verification found — kept the story as written');
        } else if (enforce && verification.outcome === 'issues') {
          events.onProgress?.(11, totalSteps, 'verify_repairing',
            `Verification found ${blockerCount} issue${blockerCount === 1 ? '' : 's'} — repairing`);
          try {
          const repairTarget = selection ? targetComponentFromSelection(selection) : null;
          // A repair must not undo the spacing discipline: it gets the one-
          // paragraph note, and a candidate that adds inline spacing literals
          // or primitive-colour uses the original did not have is discarded.
          const spacingNote = repairSpacingNote(spacingVocab);
          const repairContext = [selection ? repairScopeNote(selection) : null, spacingNote].filter(Boolean).join('\n\n') || undefined;
          const baselineSpacing = checkInlineSpacing(fixedFileContents, spacingVocab).length;
          const baselineTiers = checkTokenTiers(fixedFileContents, spacingVocab).length;
          const repair = await attemptVerificationRepair({
            code: fixedFileContents,
            report: verification,
            context: repairContext,
            signal: verifyBudget.signal,
            deadline: verifyDeadline,
            staticallyValid: (candidate) => {
              const patternErrors = validateStory(candidate);
              const ast = validateStoryCode(candidate, finalFileName, config);
              if (patternErrors.length > 0 || !ast.isValid) return false;
              const spacing = checkInlineSpacing(candidate, spacingVocab);
              const tiers = checkTokenTiers(candidate, spacingVocab);
              if (spacing.length > baselineSpacing || tiers.length > baselineTiers) {
                logger.warn(`✂️ Repair rejected: it introduced ${Math.max(0, spacing.length - baselineSpacing)} inline spacing literal(s) and ${Math.max(0, tiers.length - baselineTiers)} primitive colour use(s) the story did not have (${[...spacing.slice(0, 3).map(v => `L${v.line} ${v.property}=${v.value}`), ...tiers.slice(0, 3).map(v => `L${v.line} --${v.primitive}`)].join(', ')})`);
                return false;
              }
              return true;
            },
            callModel: async (prompt, currentCode) => {
              events.onLLMCall?.();
              // Fresh, minimal context — not the growing generate transcript.
              // The budget signal reaches the provider's fetch, so exhaustion
              // aborts this call mid-flight instead of waiting it out.
              const result = await callLLM([{ role: 'user', content: prompt }], undefined,
                { provider, model, signal: verifyBudget.signal });
              /**
               * Say when the model ran out of room rather than reporting it as
               * "no code".
               *
               * Repair asks for the COMPLETE story, so a large composition can
               * exceed the output ceiling — measured on a 380-line story, which
               * stopped at max_tokens and produced no usable block. That is a
               * size limit worth naming, not a model that declined to answer,
               * and the two look identical in a log that does not distinguish
               * them.
               */
              if (result.truncated) {
                logger.warn(
                  '⚠️ Verification repair hit the output limit regenerating this story — ' +
                  'it is too large to rewrite in one response, so the original is kept',
                );
                return null;
              }
              /**
               * Repair answers with edit blocks, applied to the current code.
               * A whole-file rewrite of a 13k-character story on Opus 5 ran
               * past the verification budget (observed: 2:18 and aborted);
               * a block that changes three lines takes seconds and cannot
               * disturb the rest of the story.
               */
              if (hasPatchBlocks(result.content)) {
                const patched = applyPatches(currentCode, parsePatchBlocks(result.content));
                if (patched.failures.length > 0) {
                  logger.warn(`✂️ Repair: ${patched.failures.length} edit block(s) did not match the story — keeping the original`);
                  return null;
                }
                // The prompt asks the repair to stay on the selected element;
                // this is what makes it true. The repair that painted a whole
                // page orange was two tidy edit blocks on a <Box> nowhere near
                // the selected <Statlet>.
                if (repairTarget) {
                  const scope = repairWithinTarget(currentCode, patched.applied, repairTarget);
                  if (!scope.ok) {
                    logger.warn(`✂️ Repair rejected: ${scope.outside.length} of ${patched.applied.length} edit block(s) fall outside the selected <${repairTarget}> (${scope.outside.map(l => `"${l}"`).join(', ')}) — keeping the targeted edit as made`);
                    return null;
                  }
                }
                logger.log(`✂️ Repair applied ${patched.applied.length} edit block(s)`);
                return patched.code;
              }
              return extractCodeBlock(result.content, detectedFramework);
            },
            writeAndVerify: async (candidate) => {
              const { code: finalized } = finalizeStoryCode(candidate);
              /**
               * Capture the compiled module BEFORE writing, then wait for it to
               * change before judging the result.
               *
               * Without this the loop verifies the PREVIOUS render: a grid fix
               * changing `lg={12}` to `lg={16}` was measured as no improvement
               * and discarded, while probing the same story a minute later
               * showed zero problems. Storybook can take longer than ten
               * seconds to recompile, so no fixed sleep is both safe and fast —
               * the module text changing is the actual signal.
               */
              const relModule = path.relative(process.cwd(), outPath).split(path.sep).join('/');

              /**
               * A repair that changes nothing needs no wait and no re-render.
               *
               * The model sometimes returns the story essentially unchanged.
               * The module text then never changes either, so waiting for a
               * recompile burns the full timeout and reports "Storybook did
               * not recompile in time" — which reads as an infrastructure
               * problem when it is simply a no-op repair. Two different things
               * must not produce the same warning.
               */
              const identical = (() => {
                try { return fs.readFileSync(outPath, 'utf-8') === finalized; } catch { return false; }
              })();

              if (identical) {
                logger.log('🔧 Repair returned the story unchanged — nothing to re-verify');
              } else {
                const before = await moduleText(verifyUrl, relModule);
                writeStory(finalized);
                const recompile = await waitForRecompile(verifyUrl, relModule, before);
                if (!recompile.live) {
                  // Say WHICH failure this is. The three read identically in a
                  // render and were logged identically, which sent one
                  // investigation after the dev server when the poll simply had
                  // no baseline to compare against.
                  const why = {
                    no_baseline: `the module could not be read from ${verifyUrl}/${relModule} before the write, so no comparison was possible`,
                    unreachable: `the module never returned 200 from ${verifyUrl}/${relModule}${recompile.status ? ` (last status ${recompile.status})` : ''}`,
                    timeout: `the served module was byte-identical for ${Math.round(recompile.waitedMs / 1000)}s (${recompile.beforeBytes} bytes before, ${recompile.afterBytes} after) although the file on disk changed`,
                    changed: '',
                  }[recompile.reason];
                  logger.warn(`⚠️ The repair check may read a stale render: ${why}`);
                }
              }
              return verifyStory({
                storybookUrl: verifyUrl,
                storyIdPrefix: storyIdSlug,
                title: cleanTitle,
                fileName: finalFileName,
                projectRoot: process.cwd(),
                libraryComponents,
                generatedDir,
                // No critique on the repair pass: it judged the previous
                // render, and re-judging mid-repair invites an opinion loop
                // where each pass chases the last one's aesthetic note.
                framework: detectedFramework,
              });
            },
          });

          if (repair.code) {
            const { code: finalized } = finalizeStoryCode(repair.code);
            fixedFileContents = finalized;
            outPath = writeStory(fixedFileContents);
            verification = repair.report;
            selfHealingUsed = true;
            verification.repair = {
              status: 'applied',
              attempts: repair.attempts,
              ...(repair.note ? { note: repair.note } : {}),
            };
            logger.log(`✅ Verification repair applied after ${repair.attempts} attempt(s)`);
            events.onProgress?.(11, totalSteps, 'verify_repaired', 'Repaired and re-checked in the browser');
          } else {
            // Restore the original on disk — writeAndVerify may have left a
            // rejected candidate there.
            writeStory(fixedFileContents);
            // Three distinct dispositions, persisted as such: the budget
            // cancelled it, it never started, or it ran and did not improve
            // the story. Conflating them makes the next diagnosis a guess.
            verification.repair = {
              status: repair.abortedByBudget
                ? 'aborted-budget'
                : repair.attempts === 0 ? 'not-attempted' : 'failed',
              attempts: repair.attempts,
              ...(repair.note ? { note: repair.note } : {}),
            };
            if (repair.note) logger.log(`ℹ️ No verification repair applied: ${repair.note}`);
            // Same three dispositions the manifest persists, in words: the
            // budget cancelled it, it never started, or it ran and did not
            // improve the story. Never a claim of success.
            events.onProgress?.(11, totalSteps, 'verify_repair_failed',
              verification.repair.status === 'aborted-budget'
                ? 'Repair ran out of time — kept the story as written'
                : verification.repair.status === 'not-attempted'
                  ? 'Repair was not attempted — kept the story as written'
                  : 'Repair did not improve the story — kept the original');
          }
          } catch (repairErr: any) {
            // A repair failure — including a budget abort surfacing as a
            // thrown error — must not void the verification that already ran.
            // Without this catch the outer handler rewrote the outcome to
            // not_verified, erasing real findings because repair broke.
            writeStory(fixedFileContents);
            const abortedByBudget = verifyBudget.signal.aborted;
            const msg = repairErr?.message ?? String(repairErr);
            verification.repair = abortedByBudget
              ? {
                  status: 'aborted-budget',
                  note: `repair aborted by the ${verifyBudgetMs}ms verification budget after ` +
                    `${Date.now() - verifyPhaseStart}ms: ${msg}`,
                }
              : { status: 'failed', note: `repair threw: ${msg}` };
            logger.warn(`⚠️ Verification repair ${abortedByBudget ? 'aborted by budget' : 'failed'}: ${msg}`);
            events.onProgress?.(11, totalSteps, 'verify_repair_failed',
              abortedByBudget
                ? 'Repair ran out of time — kept the story as written'
                : 'Repair failed — kept the story as written');
          }
        }

        // Final verdict, emitted only once repair (if any) has resolved — the
        // step list must never say "verified" while a repair is still pending.
        if (verification.outcome === 'verified') {
          events.onProgress?.(11, totalSteps, 'verified', 'Verified in the browser');
        } else if (verification.outcome === 'issues') {
          const remaining = verification.findings.filter(f => f.severity === 'blocker').length
            || verification.findings.length;
          events.onProgress?.(11, totalSteps, 'verify_issues',
            `Verification found ${remaining} issue${remaining === 1 ? '' : 's'} it could not fix`);
        } else {
          events.onProgress?.(11, totalSteps, 'verify_inconclusive', 'Could not verify the story in a browser');
        }

        if (verification.outcome === 'issues') {
          hasValidationWarnings = true;
        }
      }
    } catch (verifyErr: any) {
      /**
       * A verification that could not run must not look like one that passed.
       *
       * This used to log a warning and leave `verification` undefined, so the
       * caller — the panel, the bench, an MCP client — received exactly what it
       * receives for a story with no findings. Silence meant both "checked and
       * clean" and "never checked", which is the failure shape this project
       * keeps paying for, sitting in the middle of the machinery built to
       * prevent it.
       *
       * Still never fails the generation: the outcome is `not_verified`, which
       * is reported and carries the reason, and infrastructure findings are
       * non-repairable by construction so this cannot cost an LLM call.
       */
      const reason = verifyErr?.message ?? String(verifyErr);
      logger.warn(`⚠️ Verification could not complete: ${reason}`);
      verification = {
        outcome: 'not_verified',
        reason: `Verification threw before completing: ${reason}`,
        findings: [],
        metrics: {},
        durationMs: 0,
      };
      events.onProgress?.(11, totalSteps, 'verify_inconclusive', 'Could not verify the story in a browser');
    } finally {
      clearTimeout(verifyBudgetTimer);
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

  // The analysis the summary and the completion describe is of the code that
  // was actually written — after healing and repair.
  const analysis = analyzeGeneratedCode(fixedFileContents, prompt, config);

  let chatSummary: string | undefined;
  let suggestions: string[] | undefined;
  if (summaryPromise) {
    const conversational = await summaryPromise;
    chatSummary = conversational?.summary;
    suggestions = conversational?.suggestions;
    if (chatSummary) events.onLLMCall?.();
  }
  /**
   * Advice is not a suggestion. These strings used to ride in `suggestions`,
   * which the workspace renders as chips that send their text as the next
   * prompt — so "Story generation failed. Please try rephrasing your request."
   * could be sent to the model as a request.
   */
  /**
   * Follow-ups grounded in what verification actually found, ahead of the
   * model's generic ideas. "Fix the contrast on the muted labels" is a
   * suggestion the user can act on; "Add a dark mode toggle" is filler.
   */
  /**
   * Only what the story can fix. A chip is a promise; outside React nothing
   * can say whether a finding is the story's markup or the library's, so
   * such findings stay in the list as information and are never offered as
   * one — on Vuetify, "class v-card--density-default is not defined" was
   * the library's own class and became a "Fix:" chip.
   */
  const grounded: string[] = [];
  if (verification && verification.outcome !== 'not_verified') {
    const unresolved = repairableByStory(verification.findings, detectedFramework);
    for (const f of unresolved.slice(0, 2)) {
      const target = f.selector ? ` (${f.selector})` : '';
      grounded.push(`Fix: ${f.message.replace(/\s+—.*$/, '').slice(0, 90)}${target}`);
    }
  }
  if (grounded.length) {
    suggestions = [...grounded, ...(suggestions ?? []).filter(s => !grounded.includes(s))].slice(0, 5);
  }

  const noticeParts: string[] = [];
  if (isFallbackStory) noticeParts.push('The generation did not produce a working story. Try rephrasing the request, or make it narrower.');
  else if (hasValidationWarnings) noticeParts.push('Some automatic fixes were applied; check the code view.');
  for (const f of skippedFiles) noticeParts.push(`${f.name} was not attached: ${f.reason}.`);
  if (pinReport.lost.size) noticeParts.push(`Could not keep ${pinReport.lost.size} hand-set prop(s) because the element is gone: ${[...pinReport.lost].join(', ')}.`);
  const notice = noticeParts.length ? noticeParts.join(' ') : undefined;

  const storybookId = computeStorybookId(fixedFileContents, storyIdSlug);

  // Manifest upsert — links the story file to its chat conversation. The
  // assistant reply is appended server-side so the conversation survives even
  // if the panel never receives the completion event.
  try {
    const manifestConversation: Array<{ role: 'user' | 'ai'; content: string; thumbnails?: string[] }> =
      (conversation ?? [])
        .filter((m) => (m.role === 'user' || m.role === 'ai') && typeof m.content === 'string' && m.content.trim())
        // Thumbnails ride along so a reopened chat still shows its reference
        // images; the manifest manager bounds them (count and size) on write.
        .map((m) => ({
          role: m.role as 'user' | 'ai',
          content: m.content,
          ...(Array.isArray(m.thumbnails) ? { thumbnails: m.thumbnails } : {}),
        }));
    if (manifestConversation.length > 0) {
      if (isFallbackStory) {
        // Recovery requires the conversation to END with an 'ai' reply — the
        // poller treats anything else as still-in-flight and gives up after
        // its window, leaving the user staring at a fallback story it never
        // acknowledged. A failure gets an honest reply, not silence. There is
        // no completion payload, so lastCompletion stays undefined below.
        const reason = (validationResult.errors?.[0] || 'the generated code failed validation')
          .split('\n')[0].slice(0, 300);
        manifestConversation.push({
          role: 'ai',
          content:
            `[ERROR] **Generation failed: "${cleanTitle}"**\n\n` +
            `${reason}\n\n` +
            `A placeholder story was written in its place — try rephrasing your request.`,
        });
      } else {
        const replyHeader = `[SUCCESS] **${isActualUpdate ? 'Updated' : 'Created'}: "${cleanTitle}"**`;
        /**
         * The reply a returning user reads is what the model SAID, not a
         * second model's guess from the component names. The summary is
         * built from prompt, title and names only, and described "two
         * Buttons side-by-side, Save and Cancel" on a story that had neither.
         * The narration streamed live is the prose before the first fence.
         */
        const narration = proseBeforeFence(lastModelReply);
        const replyBody = (narration.length >= 120 ? narration : '')
          || chatSummary
          || `${isActualUpdate ? 'Updated' : 'Created'} this story based on your request.`;
        manifestConversation.push({ role: 'ai', content: `${replyHeader}\n\n${replyBody}` });
      }
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
          /**
           * The verification badge's data survives the iframe reload.
           *
           * The server logged "verified — 2 warnings" and then persisted
           * nothing about it, so a recovered thread showed no badge — absent
           * looked exactly like never-ran. A compact summary (outcome, reason,
           * the counts the badge renders) is enough to rebuild it; the full
           * findings list is deliberately not persisted.
           */
          ...(verification ? {
            verification: {
              outcome: verification.outcome,
              attempts: request.gateAttempt ?? 1,
              ...(verification.reason ? { reason: verification.reason.slice(0, 300) } : {}),
              blockers: verification.findings.filter(f => f.severity === 'blocker').length,
              warnings: verification.findings.filter(f => f.severity === 'warning').length,
              // The findings themselves, compact. The docs page reloads on
              // every new story, and a panel rebuilt from counts alone could
              // show "Issues · 3 blocking" with nothing to expand.
              findings: verification.findings.slice(0, 12).map(f => ({
                id: f.id, severity: f.severity, class: f.class, message: String(f.message).slice(0, 240),
                ...(f.evidence ? { evidence: String(f.evidence).slice(0, 200) } : {}),
                ...(f.repairable !== undefined ? { repairable: f.repairable } : {}),
              })),
              // Whether the story loaded at all. The counts alone cannot say
              // so, and a card reopened in another browser needs to.
              ...(verification.findings.some(f => f.id === 'render-failed') ? { renderFailed: true } : {}),
              ...(typeof verification.metrics?.focusables === 'number'
                ? { focusables: verification.metrics.focusables }
                : {}),
              // A restored conversation used to show a green "Verified" for a
              // run that skipped a layer: the counts never reached the manifest.
              ...(typeof verification.metrics?.checksRun === 'number'
                ? { checksRun: verification.metrics.checksRun, checksTotal: verification.metrics.checksTotal }
                : {}),
              ...(Array.isArray(verification.metrics?.checksNotRun) && (verification.metrics.checksNotRun as string[]).length
                ? { checksNotRun: (verification.metrics.checksNotRun as string[]).slice(0, 8) }
                : {}),
              // Repair disposition survives the iframe reload with the rest of
              // the badge data. `not-attempted`, `aborted-budget` and `failed`
              // are deliberately distinct statuses — see RepairSummary.
              ...(verification.repair ? {
                repair: {
                  status: verification.repair.status,
                  ...(typeof verification.repair.attempts === 'number'
                    ? { attempts: verification.repair.attempts }
                    : {}),
                  ...(verification.repair.note ? { note: verification.repair.note.slice(0, 300) } : {}),
                },
              } : {}),
            },
          } : {}),
        },
      },
    });
  } catch (manifestErr) {
    logger.warn('[manifest] upsert error (non-fatal):', manifestErr);
  }

  // History — through a manager loaded NOW. The one built at the start of the
  // run holds a snapshot from minutes ago; saving through it overwrote any
  // version a prop edit recorded in the meantime.
  try {
    new StoryHistoryManager(process.cwd()).addVersion(finalFileName, prompt, fixedFileContents, parentVersionId);
  } catch (historyErr) {
    logger.warn('[history] version record failed (non-fatal):', historyErr);
  }

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
    stylesheet: generatedStylesheet ?? undefined,
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
      fixDetails: autoFixDetails ?? (validationResult?.fixedCode ? validationResult.warnings : undefined),
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
    notice,
    pins: pins.length ? { applied: [...pinReport.applied], kept: [...pinReport.kept], lost: [...pinReport.lost] } : undefined,
    edits: appliedEdits,
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
  // The file says which id it declares; that is the id Storybook indexes it
  // under, whatever this run expected. Falling through to the title gave a
  // slug the index never held.
  const declared = code.match(/^\s*id:\s*['"]([a-z0-9][a-z0-9-]*)['"]/m);
  if (declared) return declared[1];
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
/**
 * Split a built prompt into the static prefix and the request, at the last
 * "User request:" marker. Null when the marker is missing, in which case the
 * whole prompt travels as one user turn exactly as before.
 */
function splitAtUserRequest(prompt: string): { system: string; user: string } | null {
  // An update rewrites the closing marker to "Current modification request:"
  // (see buildClaudePromptWithContext). Whichever comes LAST is the request;
  // splitting at an earlier "User request:" put the request itself into the
  // system block and left a stray fragment as the user turn.
  const markers = ['Current modification request:', 'User request:'];
  const idx = Math.max(...markers.map(m => prompt.lastIndexOf(m)));
  if (idx === -1) return null;
  const system = prompt.slice(0, idx).trimEnd();
  const user = prompt.slice(idx);
  if (system.length < 200) return null;
  return { system, user };
}

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
    /** Props the user set by hand, which the model must not restyle. */
    pins?: PropPin[];
    /** Where this project's Storybook is served, so its own stories can be read. */
    storybookUrl?: string;
    /** The derived spacing vocabulary; the adapter writes its spacing rules from it. */
    spacing?: SpacingVocabulary | null;
    /** The styling facts already read for the vocabulary, so they are not read twice. */
    styling?: StylingFacts | null;
    /** The derived icon/placeholder vocabulary. */
    icons?: IconVocabulary | null;
  }
): Promise<string> {
  // What the previous code already uses must stay fully described, or an
  // update could not keep using it.
  const usedBefore = previousCode
    ? [...new Set([...previousCode.matchAll(/<([A-Z][\w]*)(?:[\s/>])/g)].map(m => m[1]))]
    : [];
  const frameworkOptions: StoryGenerationOptions = {
    framework: options.framework,
    catalogFocus: { prompt: userPrompt, mustInclude: usedBefore },
    spacing: options.spacing ?? null,
    icons: options.icons ?? null,
  };
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
    const styling = options.styling ?? readStylingFacts(process.cwd(), (config.generatedStoriesPath || '')
      .replace(/^\.\//, '').replace(/\/+$/, '').split('/').pop() || 'generated',
      config.importPath);
    const guidance = formatStylingGuidance(styling);
    const src = styling.sources;
    if (guidance) {
      logger.log(`🎨 Injecting styling guidance: ${styling.idiom.attributes[0]?.name ?? 'no idiom'} idiom, ${src.tokens} token(s) from ${src.projectFiles} project + ${src.packageFiles} package file(s)`);
      prompt = injectBeforeUserRequest(prompt, guidance);
    } else {
      /**
       * Log the EMPTY case too.
       *
       * This branch previously logged nothing, so a design system whose tokens
       * we failed to find was indistinguishable in the log from one where the
       * feature was never wired up. Measured: Fluent, Astryx and MUI all
       * emitted an empty guidance string and said nothing about it, and Astryx
       * had 288 tokens sitting in a file we were not reading.
       */
      logger.log(
        src.lookedAtNothing
          ? `🎨 No styling guidance: examined NO stylesheets (${config.importPath ?? 'no importPath'} declares none and the project has none) — tokens unknown, not zero`
          : `🎨 No styling guidance: examined ${src.projectFiles} project + ${src.packageFiles} package file(s) (${src.declaredFiles} declared) and found ${src.tokens} token(s)`,
      );
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
  if (options.pins?.length) {
    logger.log(`📌 ${options.pins.length} pinned prop(s) carried into the prompt`);
    prompt = injectBeforeUserRequest(prompt, pinsForPrompt(options.pins));
  }

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

  /**
   * The previous code is the object of an update, whether or not a
   * conversation came with it. This used to return early on a short or absent
   * conversation, so an update from the stdio MCP server or any API client
   * (fileName + isUpdate, no chat history) reached the model with NO previous
   * code: it generated a fresh story, the divergence guard rejected it, and
   * the user was told the change "replaced too much" of a story the model had
   * never seen. Observed live, 1 Sept 2026, three runs in a row.
   */
  const hasConversation = Boolean(conversation && conversation.length > 1);
  if (!hasConversation && !previousCode) {
    return prompt;
  }

  const conversationContext = hasConversation
    ? conversation!
        .slice(0, -1)
        .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n')
    : '';

  let contextSection = hasConversation
    ? `CONVERSATION CONTEXT (for modifications/updates):\n${conversationContext}`
    : 'MODIFICATION OF AN EXISTING STORY:';
  if (previousCode) {
    contextSection += `\n\nPREVIOUS GENERATED CODE (this is what you're modifying):\n\`\`\`tsx\n${previousCode}\n\`\`\`\n\n${PATCH_INSTRUCTIONS}`;
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
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  options: { provider?: string; model?: string; maxTokens?: number; signal?: AbortSignal },
  onDelta: (charsWritten: number, accumulated: string) => void,
  onThinking?: (delta: string) => void,
): Promise<{ content: string; truncated: boolean }> {
  if (!isProviderConfigured()) {
    throw new Error('No LLM provider configured');
  }
  if (options.provider) {
    logger.log(`🎯 Explicit provider requested: ${options.provider} (model: ${options.model || 'default'})`);
  }
  const providerInfo = getProviderInfo({ provider: options.provider as any, model: options.model });
  const result = await chatCompletionStreamDetailed(messages, {
    provider: options.provider as any,
    model: options.model,
    maxTokens: options.maxTokens ?? providerInfo.maxOutputTokens ?? 8192,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(onThinking ? { onThinking } : {}),
  }, (_delta, accumulated) => onDelta(accumulated.length, accumulated));
  onDelta(result.content.length, result.content);
  if (result.usage) {
    const u = result.usage as Record<string, number | undefined>;
    logger.log(
      `🧾 Tokens: in ${u.promptTokens ?? '?'} (cache read ${u.cacheReadInputTokens ?? 0}, ` +
      `cache write ${u.cacheCreationInputTokens ?? 0}), out ${u.completionTokens ?? '?'}, stop=${result.finishReason ?? 'unknown'}`,
    );
  }
  // The provider says whether it stopped on its own. When it did not say —
  // a stream cut before message_delta — fall back to the fence heuristic
  // rather than call an unknown ending a clean one.
  const truncated = result.finishReason !== undefined
    ? result.truncated
    : (() => { const fences = (result.content.match(/```/g) || []).length; return fences > 0 && fences % 2 !== 0; })();
  return { content: result.content, truncated };
}

async function callLLM(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  attachments?: MessageContent[],
  options?: { provider?: string; model?: string; signal?: AbortSignal }
): Promise<{ content: string; truncated: boolean }> {
  if (!isProviderConfigured()) {
    throw new Error('No LLM provider configured');
  }

  // Text attachments are just more text: fold them into the user turn so the
  // call keeps the streaming path (narration, idle-bounded timeout). Only an
  // image or a PDF needs the multi-part message.
  const textBlocks = (attachments || []).filter((a): a is TextContent => a.type === 'text');
  const images = (attachments || []).filter(a => a.type !== 'text');
  if (textBlocks.length) {
    const targetIndex = messages.findIndex(m => m.role === 'user');
    if (targetIndex === -1) throw new Error('Cannot attach files: no user message in the request');
    const preface = `${fileFraming(textBlocks.length + images.filter(a => a.type === 'document').length)}\n\n${textBlocks.map(b => b.text).join('\n\n')}\n\n`;
    messages = messages.map((m, i) => i === targetIndex ? { ...m, content: preface + m.content } : m);
  }

  // Every text-only call streams: the stream is bounded by silence rather than
  // by a wall clock, which is what a two-minute repair of an 8k-token story
  // needs. Only a call with images takes the buffered path.
  if (!images || images.length === 0) {
    return callLLMStreaming(messages, {
      provider: options?.provider, model: options?.model,
      ...(options?.signal ? { signal: options.signal } : {}),
    }, () => {});
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
  const llmOptions: { provider?: any; model?: string; maxTokens: number; signal?: AbortSignal; timeoutMs?: number } = {
    maxTokens: providerInfo.maxOutputTokens ?? 8192,
    provider: options?.provider,
    model: options?.model,
    ...(options?.signal ? { signal: options.signal } : {}),
    // A vision turn is buffered, not streamed, so it has no idle watchdog —
    // only a wall clock. 120s was too short for a full-page composition
    // from a screenshot on Opus 5 (timed out 2/2 in the classic-panel
    // battery). Same ceiling as streamed calls.
    timeoutMs: Number(process.env.CLAUDE_STREAM_MAX_MS) || 15 * 60 * 1000,
  };

  if (images && images.length > 0) {
    // Check the provider/model the request actually asked for, not the default.
    const providerInfo = getProviderInfo({ provider: options?.provider as any, model: options?.model });
    const imageCount = images.filter(a => a.type === 'image').length;
    if (imageCount > 0 && !providerInfo.supportsVision) {
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
    /**
     * Say what the images are FOR, right next to them.
     *
     * A screenshot beside a bare request read to the model as "recreate this
     * app": the bench's image scenario came back as a plain React component
     * with lucide-react icons and Tailwind classes and no story export — the
     * model's favourite stack, not the project's, and not a story. The
     * catalog and the rules were all in the system block; the images were the
     * last thing it saw. The framing goes with them.
     */
    const IMAGE_FRAMING = imageCount === 0 ? '' :
      `The ${imageCount === 1 ? 'attached image is a reference' : `${imageCount} attached images are references`} ` +
      'for layout, density and tone — not a source to copy. Build what the request asks for as a ' +
      'Storybook story in exactly the format and with exactly the components and import paths the ' +
      'rules above require. Do not reproduce colours, class names or a component library from the ' +
      'image; express everything through this design system.';
    const messagesWithImages = messages.map((msg, index) => {
      if (index === targetIndex) {
        const text = typeof msg.content === 'string' && IMAGE_FRAMING ? `${IMAGE_FRAMING}\n\n${msg.content}` : msg.content;
        return {
          role: msg.role,
          content: buildMessageWithImages(text as string, images),
        };
      }
      return msg;
    });
    logger.log(`🖼️ Attached ${imageCount} image(s) and ${images.length - imageCount} document(s) to message ${targetIndex} for ${providerInfo.currentProvider}/${providerInfo.currentModel}`);
    const visionResult = await chatCompletionWithImagesDetailed(messagesWithImages as any, llmOptions);
    return { content: visionResult.content, truncated: visionResult.truncated };
  }

  const result = await chatCompletionDetailed(messages, llmOptions);
  return { content: result.content, truncated: result.truncated };
}

/**
 * One bounded regeneration attempt driven by a runtime (in-Storybook) error.
 */
async function attemptRuntimeHealing(args: {
  runtimeResult: RuntimeValidationResult;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  images: MessageContent[];
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
      (discovery?.getDiscoveredComponents?.() ?? []) as any, config as any,
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
    // The summary is two sentences; the cheap model writes it.
    ], { provider: provider as any, model: smallModelFor(provider) ?? model, maxTokens: 400 });

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

/**
 * Inject storyPrefix into the title and a unique id after it.
 *
 * Everything happens INSIDE the meta object. The first version searched the
 * whole file for `title:` and `id:` — and a kanban story whose column data
 * began `{ id: 'todo', title: 'To do' }` matched there first: the injector
 * decided the story already had an id, wrote none, Storybook derived one
 * from the title, and the next update could not find the story by id.
 */
export function applyTitleAndId(code: string, cleanTitle: string, storyIdSlug: string, storyPrefix: string): string {
  // The title lands inside a string literal. A model refusal became the
  // title "I'd be happy to help…", the apostrophe closed the literal, and the
  // syntax error took every story out of Storybook's index.
  const safeTitle = sanitizeStoryTitle(cleanTitle);
  const titleToUse = safeTitle.startsWith(storyPrefix) ? safeTitle : storyPrefix + safeTitle;

  // Where the meta object starts: CSF `const meta = {`, `export default {`,
  // or Svelte's `defineMeta({`. Nothing before it is touched.
  const metaStart = code.search(/const\s+meta\s*(?::\s*\w+(?:<[^>]+>)?)?\s*=\s*\{|export\s+default\s*\{|defineMeta\s*\(\s*\{/);
  if (metaStart < 0) return code;
  const head = code.slice(0, metaStart);
  let meta = code.slice(metaStart);

  meta = meta.replace(/(title:\s*["'])([^"']+)(["'])/, (_m, p1, _old, p3) => p1 + titleToUse + p3);

  // Skip the id for Svelte defineMeta: addon-svelte-csf's indexer derives IDs
  // from the title and ignores a custom `id`, so injecting one desyncs index
  // vs runtime ("Couldn't find story matching id ... after importing a CSF file").
  const isDefineMetaFormat = meta.startsWith('defineMeta');
  const hasMetaId = /^\s*id:\s*['"]/m.test(meta.slice(0, meta.indexOf('title:')))
    || /title:\s*["'][^"']+["'],\s*\n\s*id:/.test(meta);
  if (!hasMetaId && !isDefineMetaFormat) {
    meta = meta.replace(/(title:\s*["'][^"']+["'])(,?\s*\n)/, `$1,\n  id: '${storyIdSlug}'$2`);
  }
  return head + meta;
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
    .replace(/[^\p{L}\p{N}_\s'"?!-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)(\p{L})/gu, (_m, sp, ch) => sp + ch.toUpperCase())
    .slice(0, 60);
}

async function getLLMTitle(userPrompt: string, provider?: string): Promise<string> {
  try {
    return await llmGenerateTitle(userPrompt, provider as any);
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
 * The packages a local design system's own source depends on.
 *
 * college-town's `Form` is built on react-hook-form (form.tsx imports
 * FormProvider and useFormContext from it) and its own story — one of the
 * usage examples the prompt hands the model — imports zod and
 * @hookform/resolvers. The isolation check then forbade all three, so the
 * model was shown a form built one way, told to build it that way, and
 * rejected for doing so; a healing retry rebuilt the form without the
 * project's Form component at all. What a component's source imports is a
 * fact about the design system, and the allowance is derived from it here.
 * Only local files are read (npm components carry their own package.json),
 * and only packages the project actually installs count.
 */
const _librarySourceDepsCache = new Map<string, { at: number; deps: Set<string> }>();
export function librarySourceDependencies(
  components: Array<{ name: string; filePath?: string }>,
  installed: Set<string>,
): Set<string> {
  const files = new Set<string>();
  for (const c of components) {
    const f = c.filePath;
    if (!f || !path.isAbsolute(f) || f.includes(`${path.sep}node_modules${path.sep}`)) continue;
    files.add(f);
    // The component's own co-located stories: documented usage.
    try {
      const dir = path.dirname(f);
      for (const entry of fs.readdirSync(dir)) {
        if (/\.stories\.(tsx|ts|jsx|js|mjs|vue|svelte)$/.test(entry)) files.add(path.join(dir, entry));
      }
    } catch { /* a directory we cannot list adds nothing */ }
  }
  const key = [...files].sort().join('\n');
  const cached = _librarySourceDepsCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.deps;

  const deps = new Set<string>();
  for (const file of files) {
    let text: string;
    try { text = fs.readFileSync(file, 'utf-8'); } catch { continue; }
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'".][^'"]*)['"]/g)) {
      const root = importSpecifierRoot(m[1]);
      if (root && installed.has(root)) deps.add(root);
    }
  }
  _librarySourceDepsCache.clear();
  _librarySourceDepsCache.set(key, { at: Date.now(), deps });
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
/** Does this specifier name an actual installed package (not just a scope dir)? */
function hasPackageManifest(specifier: string): boolean {
  try {
    return fs.existsSync(path.join(process.cwd(), 'node_modules', specifier, 'package.json'));
  } catch {
    return false;
  }
}

/** Extensions a relative specifier may resolve to, in resolution order. */
const LOCAL_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];

/** An importable specifier for `file`, as written from `fromDir`. */

/** Resolve a relative specifier to a file the way the bundler would. */

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
  /** The declared importPath → componentsPath pairing, so an alias import resolves too. */
  config?: { importPath?: string; componentsPath?: string },
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
  const importRegex = /import\s+(?:([^'"]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
  const aliasOptions = { projectRoot: process.cwd(), fromDir: generatedDir, importPath: config?.importPath, componentsPath: config?.componentsPath };

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

    /**
     * Relative specifiers resolve from the generated directory; an ALIAS
     * (`@/components/data-table/data-table`, through tsconfig `paths` or the
     * declared importPath → componentsPath pairing) resolves to a local file
     * too, and is checked the same way. Before this only `./` and `../`
     * imports were checked, so `import { DataTable } from '@/components'` —
     * a barrel that does not export it — passed every gate and rendered
     * blank. A bare npm specifier is not this check's business and is skipped.
     */
    let file: string | null;
    if (specifier.startsWith('.')) {
      file = resolveLocalModule(specifier, generatedDir);
    } else {
      const r = resolveSpecifier(specifier, aliasOptions);
      if (!r.aliasMatched) continue;
      file = r.file;
    }
    if (!file) {
      /**
       * This used to `continue`, on the belief that import validation had
       * already reported it. It had not. Three stories on a local library
       * shipped with `from '../../components'` — a directory with no index —
       * and every one showed Vite's red overlay. Absent is not a pass.
       */
      const fixes = bindings.map(b => {
        const known = components.find(c => c.name === b && (c.__componentPath || c.filePath));
        return known ? `import { ${b} } from '${known.__componentPath || relativeSpecifier(generatedDir, known.filePath!)}';` : null;
      }).filter(Boolean);
      errors.push(
        `Import error: "${specifier}" does not resolve to a file from the generated stories directory ` +
        `(no such module and no index file there). Vite cannot serve the story.` +
        (fixes.length
          ? `\nWrite instead:\n${fixes.join('\n')}`
          : `\nImport ${bindings.join(', ')} from the exact path shown beside each component in the component reference.`),
      );
      continue;
    }

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
  components: Array<{ name: string; __componentPath?: string; filePath?: string }> = [],
): string[] {
  const errors: string[] = [];

  const allowedRoots = new Set<string>();
  const allow = (specifier?: string) => {
    if (specifier) allowedRoots.add(importSpecifierRoot(specifier));
  };

  allow(config.importPath);
  allow(config.iconImports?.package);
  // An installed icon set — the project's dependency or the design system's
  // own — is part of what the model was told to use (see iconFacts.ts).
  for (const pkg of derivedIconPackages(process.cwd(), config.importPath, config.iconImports?.package)) allow(pkg.name);
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
  const libraryDeps = librarySourceDependencies(components, consumerDeps);

  for (const [specifier, boundNames] of specifiers) {
    // Relative imports can't smuggle in foreign packages.
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    const root = importSpecifierRoot(specifier);
    // The design system's own source imports it: part of the system, by its
    // own account.
    if (libraryDeps.has(root) && !allowedRoots.has(root)) {
      logger.log(`🔓 Import "${specifier}" permitted — the project's own components import ${root}`);
      continue;
    }

    /**
     * A SCOPE is not a package.
     *
     * `@atlaskit` names a directory in node_modules, not something importable.
     * It is the configured importPath, so it sat in allowedRoots and every
     * check waved it through — while the model, told its design system is
     * "@atlaskit", collapsed eleven components onto
     * `import { Avatar, Box, Stack, … } from '@atlaskit'`. That resolves to
     * nothing and renders nothing.
     *
     * The catalog already gives each component its real package. This turns an
     * unrenderable story into an error the healing loop can act on.
     */
    if (specifier === importScope && importScope && !hasPackageManifest(importScope)) {
      const bound = boundNames
        .map(name => components.find(c => c.name === name && c.__componentPath))
        .filter((c): c is { name: string; __componentPath: string } => !!c?.__componentPath);
      errors.push(
        `Import from "${specifier}" is not valid — that is an npm SCOPE, a directory of packages, not a package. ` +
        `Every component lives in its own package under it. ` +
        (bound.length
          ? bound.slice(0, 4).map(c => `Import ${c.name} from "${c.__componentPath}".`).join(' ') + ' '
          : '') +
        `Use the exact import path shown beside each component in the component reference.`,
      );
      continue;
    }

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
    // Same design system family: a sibling package under the scope, or the
    // scope name itself when it really is a package.
    if (importScope && (root.startsWith(importScope + '/') || root === importScope)) {
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

  const reportedAsInvalid = new Set(validation.invalid);
  for (const importName of componentImports) {
    // An import that validation already reports as unknown gets one message
    // (below, with its nearest catalog names), not two.
    if (reportedAsInvalid.has(importName)) continue;
    if (isBlacklistedComponent(importName, allowedComponents, config.importPath)) {
      const errorMsg = getBlacklistErrorMessage(importName, config.importPath);
      errors.push(`Unknown component: ${errorMsg}`);
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

/** The prose a model wrote before its first code fence, trimmed of edit-block noise. */
export function proseBeforeFence(reply: string): string {
  if (!reply) return '';
  const cut = reply.indexOf('```');
  const head = (cut === -1 ? reply : reply.slice(0, cut)).trim();
  // Edit-block replies carry their prose after the fence too; keep the head only.
  return head.replace(/^<{7} SEARCH[\s\S]*$/m, '').trim().slice(0, 2000);
}

/** A title that can sit inside any string literal and any sidebar: no quotes, backslashes or line breaks. */
export function sanitizeStoryTitle(title: string): string {
  return title.replace(/[\\"'`]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
}
