/**
 * Streaming Story Generation with Two-Way Communication
 *
 * This endpoint provides real-time feedback during story generation via SSE.
 * It enables the chat to show:
 * 1. Intent preview - what the AI plans to do
 * 2. Progress updates - step-by-step execution
 * 3. Execution feedback - detailed completion with reasoning
 */

import { Request, Response } from 'express';
import * as crypto from 'crypto';
import * as path from 'path';
import { generateStory } from '../../story-generator/generateStory.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import {
  buildClaudePrompt as buildFlexiblePrompt,
  buildFrameworkAwarePrompt,
  detectProjectFramework,
} from '../../story-generator/promptGenerator.js';
import { FrameworkType, StoryGenerationOptions, getAdapter } from '../../story-generator/framework-adapters/index.js';
import { loadUserConfig, validateConfig } from '../../story-generator/configLoader.js';
import { extractAndValidateCodeBlock } from '../../story-generator/validateStory.js';
import { createFrameworkAwareFallbackStory } from './storyHelpers.js';
import { isBlacklistedComponent, isBlacklistedIcon, getBlacklistErrorMessage, ICON_CORRECTIONS } from '../../story-generator/componentBlacklist.js';
import { StoryTracker, StoryMapping } from '../../story-generator/storyTracker.js';
import { getDocumentation } from '../../story-generator/documentation-sources.js';
import { postProcessStory } from '../../story-generator/postProcessStory.js';
import { validateStory, ValidationError } from '../../story-generator/storyValidator.js';
import { validateStoryCode, ValidationResult } from '../../story-generator/validateStory.js';
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
import { StoryHistoryManager } from '../../story-generator/storyHistory.js';
import { logger } from '../../story-generator/logger.js';
import { UrlRedirectService } from '../../story-generator/urlRedirectService.js';
import { chatCompletion, generateTitle as llmGenerateTitle, isProviderConfigured, getProviderInfo, chatCompletionWithImages, buildMessageWithImages } from '../../story-generator/llm-providers/story-llm-service.js';
import { processImageInputs, ImageInput } from '../../story-generator/imageProcessor.js';
import { VisionPromptType, buildVisionAwarePrompt } from '../../story-generator/visionPrompts.js';
import { ImageContent } from '../../story-generator/llm-providers/types.js';
import {
  StreamEvent,
  IntentPreview,
  ProgressUpdate,
  ValidationFeedback,
  RetryInfo,
  CompletionFeedback,
  ErrorFeedback,
  formatSSE,
  createStreamEvent,
  StreamGenerateRequest,
} from './streamTypes.js';

// Helper class to manage SSE stream
class StreamWriter {
  private res: Response;
  private startTime: number;
  private llmCalls: number = 0;

  constructor(res: Response) {
    this.res = res;
    this.startTime = Date.now();
  }

  // Send an event to the client
  send(event: StreamEvent): void {
    this.res.write(formatSSE(event));
  }

  // Send intent preview
  sendIntent(intent: IntentPreview): void {
    this.send(createStreamEvent('intent', intent));
  }

  // Send progress update
  sendProgress(
    step: number,
    totalSteps: number,
    phase: ProgressUpdate['phase'],
    message: string,
    details?: Record<string, unknown>
  ): void {
    this.send(createStreamEvent('progress', {
      step,
      totalSteps,
      phase,
      message,
      details
    }));
  }

  // Send validation feedback
  sendValidation(validation: ValidationFeedback): void {
    this.send(createStreamEvent('validation', validation));
  }

  // Send retry info
  sendRetry(attempt: number, maxAttempts: number, reason: string, errors: string[]): void {
    this.llmCalls++;
    this.send(createStreamEvent('retry', {
      attempt,
      maxAttempts,
      reason,
      errors
    }));
  }

  // Send completion
  sendCompletion(completion: Omit<CompletionFeedback, 'metrics'>): void {
    this.llmCalls++;
    const fullCompletion: CompletionFeedback = {
      ...completion,
      metrics: {
        totalTimeMs: Date.now() - this.startTime,
        llmCallsCount: this.llmCalls
      }
    };
    console.log('[Story UI Server DEBUG] sendCompletion called:', {
      hasCode: !!fullCompletion.code,
      codeLength: fullCompletion.code?.length,
      title: fullCompletion.title,
      fileName: fullCompletion.fileName,
      storyId: fullCompletion.storyId
    });
    this.send(createStreamEvent('completion', fullCompletion));
  }

  // Send error
  sendError(error: ErrorFeedback): void {
    this.send(createStreamEvent('error', error));
  }

  // Track LLM call
  trackLLMCall(): void {
    this.llmCalls++;
  }

  // Get elapsed time
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}

// Build suggestion using the user's actual discovered components (design-system agnostic)
function buildComponentSuggestion(components: Array<{ name: string }> | null): string {
  if (!components?.length) {
    return 'Check your story-ui.config.js to ensure components are properly configured.';
  }

  // Show a sample of the user's actual available components (up to 5)
  const sampleComponents = components
    .slice(0, 5)
    .map(c => c.name)
    .join(', ');

  const moreCount = components.length > 5
    ? ` and ${components.length - 5} more`
    : '';

  return `Your available components include: ${sampleComponents}${moreCount}. Check story-ui.config.js if expected components are missing.`;
}

// Analyze prompt to determine intent
// NOTE: Framework is now REQUIRED - caller must detect it first
async function analyzeIntent(
  prompt: string,
  config: any,
  conversation: any[] | undefined,
  previousCode: string | undefined,
  options: {
    framework: FrameworkType;  // REQUIRED - from early detection
    autoDetectFramework?: boolean;  // Deprecated - kept for compatibility but ignored
    visionMode?: VisionPromptType;
    designSystem?: string;
    hasImages?: boolean;
  }
): Promise<IntentPreview> {
  // SIMPLIFIED: Trust the passed framework from early detection
  // The caller (main handler) is responsible for detecting the framework once
  // We no longer re-detect here - this eliminates duplicate detection and inconsistency
  if (!options.framework) {
    throw new Error('Framework must be passed to analyzeIntent - early detection should have determined it');
  }
  const framework: string = options.framework;

  // Analyze prompt for likely components
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

  // Determine strategy
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
    framework,
    detectedDesignSystem: options.designSystem || config.importPath?.includes('mantine') ? 'mantine' :
      config.importPath?.includes('chakra') ? 'chakra-ui' :
      config.importPath?.includes('mui') ? 'material-ui' : null,
    strategy,
    estimatedComponents,
    promptAnalysis: {
      hasVisionInput: !!options.hasImages,
      hasConversationContext: !!(conversation && conversation.length > 1),
      hasPreviousCode: !!previousCode
    }
  };
}

// Component insights - contextual reasons based on component role
const COMPONENT_INSIGHTS: Record<string, string> = {
  // Layout
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

  // Typography
  Text: 'text with theme styling',
  Title: 'semantic heading',
  Heading: 'hierarchical heading',
  Typography: 'styled text content',

  // Feedback
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

  // Actions
  Button: 'primary user actions',
  IconButton: 'icon-only actions',
  ActionIcon: 'compact icon actions',
  Menu: 'contextual options',
  Tooltip: 'hover information',

  // Forms
  Input: 'text input field',
  TextInput: 'text entry',
  Textarea: 'multi-line text',
  Select: 'dropdown selection',
  Checkbox: 'binary toggle',
  Switch: 'on/off toggle',
  Radio: 'single selection',
  Slider: 'range selection',
  NumberInput: 'numeric entry',

  // Data Display
  Card: 'content container with elevation',
  Paper: 'surface elevation',
  Table: 'tabular data display',
  List: 'sequential items',
  Avatar: 'user representation',
  Image: 'visual content',

  // Navigation
  Tabs: 'content organization',
  Breadcrumb: 'navigation hierarchy',
  Pagination: 'paged navigation',
  Stepper: 'multi-step progress',
  NavLink: 'navigation item',

  // Overlay
  Modal: 'focused interaction',
  Dialog: 'user confirmation',
  Drawer: 'side panel content',
  Popover: 'contextual overlay',
  Sheet: 'bottom panel (mobile-friendly)',
};

// Analyze generated code to extract components and decisions
function analyzeGeneratedCode(
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
  const promptLower = prompt.toLowerCase();

  // Extract imported components with contextual reasons
  const importMatch = code.match(/import\s*{([^}]+)}\s*from\s*['"][^'"]+['"]/g);
  if (importMatch) {
    for (const imp of importMatch) {
      const components = imp.match(/{([^}]+)}/);
      if (components) {
        const names = components[1].split(',').map(n => n.trim());
        for (const name of names) {
          if (name && /^[A-Z]/.test(name)) {
            // Get contextual insight if available
            const insight = COMPONENT_INSIGHTS[name];
            componentsUsed.push({
              name,
              reason: insight || undefined
            });
          }
        }
      }
    }
  }

  // Detect layout patterns with better context
  const hasGrid = code.includes('Grid') || code.includes('SimpleGrid');
  const hasStack = code.includes('Stack') || code.includes('VStack') || code.includes('HStack');
  const hasFlex = code.includes('Flex') || /display:\s*['"]?flex/i.test(code);
  const hasContainer = code.includes('Container');

  if (hasGrid) {
    const colMatch = code.match(/columns?[=:]\s*[{]?\s*(\d+|[{][^}]+[}])/i);
    const cols = colMatch ? 'responsive columns' : 'auto columns';
    layoutChoices.push({
      pattern: 'Grid',
      reason: `${cols} for organized content arrangement`
    });
  }

  if (hasStack && !hasGrid) {
    const isHorizontal = code.includes('HStack') || code.includes('direction="row"') || code.includes("direction='row'");
    layoutChoices.push({
      pattern: isHorizontal ? 'Horizontal Stack' : 'Vertical Stack',
      reason: isHorizontal
        ? 'inline element alignment with automatic spacing'
        : 'stacked sections with consistent gaps'
    });
  }

  if (hasFlex && !hasStack && !hasGrid) {
    const hasJustify = /justify/i.test(code);
    const hasAlign = /align/i.test(code);
    layoutChoices.push({
      pattern: 'Flexbox',
      reason: hasJustify && hasAlign
        ? 'precise control over element distribution and alignment'
        : 'flexible element positioning'
    });
  }

  if (hasContainer) {
    layoutChoices.push({
      pattern: 'Container',
      reason: 'centered content with readable max-width'
    });
  }

  // Detect meaningful style choices
  const variantMatch = code.match(/variant[=:]\s*["']([^"']+)["']/gi);
  if (variantMatch) {
    const variants = new Set(variantMatch.map(m =>
      m.split(/[=:]/)[1]?.trim().replace(/["']/g, '')
    ).filter(Boolean));

    for (const variant of Array.from(variants).slice(0, 2)) {
      const variantReasons: Record<string, string> = {
        'filled': 'high visual emphasis',
        'outlined': 'secondary emphasis',
        'subtle': 'minimal visual weight',
        'light': 'soft background emphasis',
        'gradient': 'eye-catching visual treatment',
        'contained': 'solid button style',
        'text': 'inline text action',
      };
      if (variantReasons[variant]) {
        styleChoices.push({
          property: 'variant',
          value: variant,
          reason: variantReasons[variant]
        });
      }
    }
  }

  // Detect color usage with semantic context
  const colorMatch = code.match(/color[=:]\s*["']([^"']+)["']/gi);
  if (colorMatch) {
    const colors = new Set(colorMatch.map(m =>
      m.split(/[=:]/)[1]?.trim().replace(/["']/g, '')
    ).filter(Boolean));

    const semanticColors: Record<string, string> = {
      'primary': 'brand identity emphasis',
      'secondary': 'supporting visual accent',
      'success': 'positive outcome indication',
      'error': 'error state signaling',
      'warning': 'caution indication',
      'info': 'informational context',
      'green': 'success/positive state',
      'red': 'error/danger state',
      'blue': 'informational emphasis',
      'yellow': 'warning indication',
      'orange': 'attention drawing',
    };

    for (const color of Array.from(colors).slice(0, 2)) {
      const colorLower = color.toLowerCase();
      for (const [key, reason] of Object.entries(semanticColors)) {
        if (colorLower.includes(key)) {
          styleChoices.push({
            property: 'color',
            value: color,
            reason
          });
          break;
        }
      }
    }
  }

  return { componentsUsed, layoutChoices, styleChoices };
}

// Main streaming handler
export async function generateStoryFromPromptStream(req: Request, res: Response) {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  const stream = new StreamWriter(res);
  const totalSteps = 8;
  let currentStep = 0;

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
    considerations
  } = req.body as StreamGenerateRequest;

  // DEBUG: Trace incoming fileName for iteration bug
  const _debug = req.body._debug;
  console.log('[Story UI Server DEBUG] Request received:', {
    fileName,
    storyId: providedStoryId,
    isUpdate,
    conversationLength: conversation?.length || 0,
    _debug,
  });

  if (!prompt) {
    stream.sendError({
      code: 'MISSING_PROMPT',
      message: 'No prompt provided',
      recoverable: false,
      suggestion: 'Please provide a description of what you want to generate'
    });
    res.end();
    return;
  }

  try {
    // Step 1: Load configuration
    currentStep++;
    stream.sendProgress(currentStep, totalSteps, 'config_loaded', 'Loading configuration...');

    const config = loadUserConfig();
    const validation = validateConfig(config);

    if (!validation.isValid) {
      stream.sendError({
        code: 'CONFIG_ERROR',
        message: 'Configuration validation failed',
        details: validation.errors.join('; '),
        recoverable: false,
        suggestion: 'Check your story-ui.config.js file'
      });
      res.end();
      return;
    }

    // EARLY FRAMEWORK DETECTION - detect once and use consistently throughout
    // Priority: request > config.componentFramework > config.framework > auto-detect
    // CRITICAL: Fail explicitly if no framework can be determined rather than silently defaulting to React
    let detectedFramework: FrameworkType;
    if (framework) {
      detectedFramework = framework as FrameworkType;
      logger.log(`🎯 Using explicit framework from request: ${detectedFramework}`);
    } else if (config.componentFramework) {
      detectedFramework = config.componentFramework as FrameworkType;
      logger.log(`🎯 Using framework from config.componentFramework: ${detectedFramework}`);
    } else if ((config as any).framework) {
      detectedFramework = (config as any).framework as FrameworkType;
      logger.log(`🎯 Using framework from config.framework: ${detectedFramework}`);
    } else if (autoDetectFramework) {
      try {
        detectedFramework = await detectProjectFramework(process.cwd());
        logger.log(`🎯 Auto-detected framework: ${detectedFramework}`);
      } catch (error) {
        // FAIL EXPLICITLY rather than silently defaulting to React
        logger.error('Failed to auto-detect framework and no framework configured', { error });
        stream.sendError({
          code: 'FRAMEWORK_DETECTION_FAILED',
          message: 'Could not auto-detect framework',
          details: 'Please set componentFramework in story-ui.config.js or pass framework in the request.',
          recoverable: false,
          suggestion: 'Add componentFramework: "react" (or vue, angular, svelte, web-components) to your story-ui.config.js'
        });
        res.end();
        return;
      }
    } else {
      // Default to React only with a warning - this is the ONLY place we default
      detectedFramework = 'react';
      logger.warn('⚠️ No framework configured, defaulting to React. Consider setting componentFramework in story-ui.config.js');
    }

    // Get the framework adapter early for consistent use
    const frameworkAdapter = getAdapter(detectedFramework);
    if (!frameworkAdapter) {
      logger.error(`No adapter found for framework: ${detectedFramework}`);
      stream.sendError({
        code: 'ADAPTER_NOT_FOUND',
        message: `No adapter found for framework: ${detectedFramework}`,
        recoverable: false,
        suggestion: 'Check that the framework name is correct: react, vue, angular, svelte, or web-components'
      });
      res.end();
      return;
    }
    logger.log(`🔧 Using framework adapter: ${frameworkAdapter.name}`);

    // Process images if provided
    let processedImages: ImageContent[] = [];
    if (images && Array.isArray(images) && images.length > 0) {
      try {
        processedImages = await processImageInputs(images as ImageInput[]);
      } catch (imageError) {
        stream.sendError({
          code: 'IMAGE_PROCESSING_ERROR',
          message: 'Failed to process images',
          details: imageError instanceof Error ? imageError.message : String(imageError),
          recoverable: true,
          suggestion: 'Try again without images or use a different format'
        });
        res.end();
        return;
      }
    }

    // Step 2: Discover components
    currentStep++;
    stream.sendProgress(currentStep, totalSteps, 'components_discovered', 'Discovering available components...');

    const discovery = new EnhancedComponentDiscovery(config);
    const components = await discovery.discoverAll();

    stream.sendProgress(currentStep, totalSteps, 'components_discovered',
      `Found ${components.length} components from ${config.importPath}`,
      { componentCount: components.length }
    );

    // Set up environment
    const storyTracker = new StoryTracker(config);
    const historyManager = new StoryHistoryManager(process.cwd());
    const redirectDir = path.dirname(config.generatedStoriesPath);
    const redirectService = new UrlRedirectService(redirectDir);

    // Check for previous code if update
    const isActualUpdate = isUpdate || (fileName && conversation && conversation.length > 2);
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

    // INTENT PREVIEW: Analyze and show what we're going to do
    // Pass the already-detected framework - no need for the function to re-detect
    const intent = await analyzeIntent(prompt, config, conversation, previousCode, {
      framework: detectedFramework,  // Use early-detected framework, not request's framework
      autoDetectFramework: false,     // Already detected, don't re-detect
      visionMode: visionMode as VisionPromptType | undefined,
      designSystem,
      hasImages: processedImages.length > 0
    });

    stream.sendIntent(intent);

    // Step 3: Build prompt
    currentStep++;
    stream.sendProgress(currentStep, totalSteps, 'prompt_built', 'Building generation prompt...', {
      framework: intent.framework,
      hasContext: intent.promptAnalysis.hasConversationContext
    });

    // Pass detected framework to prompt builder - no re-detection needed
    const frameworkOptions = {
      framework: detectedFramework,  // Use early-detected framework
      autoDetectFramework: false,    // Already detected, don't re-detect
      visionMode: visionMode as VisionPromptType | undefined,
      designSystem: designSystem as string | undefined,
      considerations: considerations as string | undefined,
    };

    const initialPrompt = await buildClaudePromptWithContext(
      prompt, config, conversation, previousCode, components, frameworkOptions
    );

    const messages: { role: 'user' | 'assistant', content: string }[] = [
      { role: 'user', content: initialPrompt }
    ];

    // Step 4: Call LLM with Self-Healing Loop
    currentStep++;
    stream.sendProgress(currentStep, totalSteps, 'llm_thinking', 'AI is generating your story...');

    // Get available component names for self-healing prompts
    const availableComponentNames = components.map(c => c.name);

    // Self-healing options (design-system agnostic)
    // Uses detectedFramework from early detection - no need to re-detect
    const selfHealingOptions: SelfHealingOptions = {
      maxAttempts: 3,
      availableComponents: availableComponentNames,
      framework: detectedFramework,
      importPath: config.importPath,
    };

    // Initialize self-healing state
    let aiText = '';
    let finalErrors: ValidationErrors = createEmptyErrors();
    const errorHistory: ValidationErrors[] = [];
    const allAttempts: Array<{ code: string; errors: ValidationErrors }> = [];
    let attempts = 0;
    let selfHealingUsed = false;
    let lastClaudeResponse = '';

    // Self-Healing Retry Loop
    while (attempts < selfHealingOptions.maxAttempts) {
      attempts++;
      stream.trackLLMCall();

      if (attempts > 1) {
        selfHealingUsed = true;
        const allErrors = [
          ...finalErrors.syntaxErrors,
          ...finalErrors.patternErrors,
          ...finalErrors.importErrors,
        ];
        stream.sendRetry(attempts, selfHealingOptions.maxAttempts, 'AI self-healing: fixing validation errors', allErrors);
        logger.log(`🔄 Self-healing attempt ${attempts}/${selfHealingOptions.maxAttempts}`);
      }

      // Call LLM
      const claudeResponse = await callLLM(messages, processedImages.length > 0 ? processedImages : undefined);
      lastClaudeResponse = claudeResponse;

      // Extract code block
      const extractedCode = extractCodeBlock(claudeResponse);

      if (!extractedCode) {
        aiText = claudeResponse;
        if (attempts < selfHealingOptions.maxAttempts) {
          messages.push({ role: 'assistant', content: aiText });
          messages.push({ role: 'user', content: 'You did not provide a code block. Please provide the complete story in a single `tsx` code block.' });
          continue;
        } else {
          break;
        }
      } else {
        aiText = extractedCode;
      }

      // Step 5: Comprehensive Validation (Pattern + AST + Import)
      currentStep = 5;
      stream.sendProgress(currentStep, totalSteps, 'validating', 'Validating generated code...');

      // 1. Pattern validation
      const patternErrors = validateStory(aiText);

      // 2. AST validation with auto-fix attempt
      let astResult: ValidationResult | null = null;
      let codeToValidate = aiText;
      try {
        astResult = validateStoryCode(aiText, 'story.tsx', config);
        if (astResult.fixedCode) {
          codeToValidate = astResult.fixedCode;
          aiText = codeToValidate;
          logger.log('🔧 Auto-fix applied for syntax issues');
        }
      } catch (astError) {
        logger.error('AST validation error:', astError);
      }

      // 3. Import validation
      const importValidation = await preValidateImports(codeToValidate, config, discovery);
      const importErrors = importValidation.isValid ? [] : importValidation.errors;

      // Aggregate all errors
      const currentErrors = aggregateValidationErrors(astResult, patternErrors, importErrors);
      errorHistory.push(currentErrors);
      allAttempts.push({ code: aiText, errors: currentErrors });

      // Check if we have no errors
      if (hasNoErrors(currentErrors)) {
        logger.log('✅ Validation passed on attempt', attempts);
        stream.sendValidation({
          isValid: true,
          errors: [],
          warnings: [],
          autoFixApplied: !!astResult?.fixedCode
        });
        finalErrors = currentErrors;
        break;
      }

      // Log validation failures
      logger.log(`⚠️ Attempt ${attempts} validation errors: ${formatErrorsForLog(currentErrors)}`);
      stream.sendValidation({
        isValid: false,
        errors: [
          ...currentErrors.syntaxErrors,
          ...currentErrors.patternErrors,
          ...currentErrors.importErrors,
        ],
        warnings: [],
        autoFixApplied: !!astResult?.fixedCode
      });

      finalErrors = currentErrors;

      // Check if we should continue retrying
      const retryDecision = shouldContinueRetrying(attempts, selfHealingOptions.maxAttempts, errorHistory);
      if (!retryDecision.shouldRetry) {
        logger.log(`🛑 Stopping retries: ${retryDecision.reason}`);
        break;
      }

      // Build self-healing prompt and add to messages
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

    // Log self-healing summary
    if (selfHealingUsed) {
      logger.log(`🔄 Self-healing summary: ${attempts} attempts, final errors: ${formatErrorsForLog(finalErrors)}`);
    }

    // Step 6: Code extraction and final processing
    currentStep = 6;
    stream.sendProgress(currentStep, totalSteps, 'code_extracted', 'Processing generated code...');

    // If we still have import errors after all attempts, report them
    if (finalErrors.importErrors.length > 0) {
      stream.sendError({
        code: 'INVALID_IMPORTS',
        message: 'Generated code contains invalid imports',
        details: finalErrors.importErrors.join('; '),
        recoverable: true,
        suggestion: buildComponentSuggestion(components)
      });
      res.end();
      return;
    }

    // Full validation
    const validationResult = extractAndValidateCodeBlock(aiText, config);
    let fileContents: string;
    let hasValidationWarnings = false;

    if (!validationResult.isValid && !validationResult.fixedCode) {
      // Use framework-aware fallback story
      fileContents = createFrameworkAwareFallbackStory(prompt, config, detectedFramework);
      hasValidationWarnings = true;

      stream.sendValidation({
        isValid: false,
        errors: validationResult.errors || [],
        warnings: ['Using fallback template due to validation failures'],
        autoFixApplied: false
      });
    } else {
      if (validationResult.fixedCode) {
        fileContents = validationResult.fixedCode;
        hasValidationWarnings = true;

        stream.sendValidation({
          isValid: true,
          errors: [],
          warnings: validationResult.warnings || [],
          autoFixApplied: true,
          fixDetails: ['Applied automatic corrections to fix validation errors']
        });
      } else {
        const codeMatch = aiText.match(/```(?:tsx|jsx|typescript|ts|js|javascript)?\s*([\s\S]*?)\s*```/i);
        fileContents = codeMatch ? codeMatch[1].trim() : aiText.trim();

        if (validationResult.warnings?.length) {
          hasValidationWarnings = true;
        }
      }
    }

    // Step 7: Post-processing
    currentStep++;
    stream.sendProgress(currentStep, totalSteps, 'post_processing', 'Applying finishing touches...');

    // Framework detection already done at start - use detectedFramework and frameworkAdapter
    // The adapter's postProcess() method handles React import injection (or removal for non-React)
    let fixedFileContents = postProcessStory(fileContents, config.importPath);

    // Apply framework-specific post-processing via adapter
    const fileExtension = frameworkAdapter?.defaultExtension || '.stories.tsx';
    logger.log(`🔧 Applying ${detectedFramework} framework post-processing`);
    fixedFileContents = frameworkAdapter.postProcess(fixedFileContents);

    // Generate title
    let aiTitle;
    if (isActualUpdate && originalTitle) {
      aiTitle = originalTitle;
    } else if (isActualUpdate && conversation) {
      const originalPrompt = conversation.find((msg: any) => msg.role === 'user')?.content || prompt;
      aiTitle = await getLLMTitle(originalPrompt);
      stream.trackLLMCall();
    } else {
      aiTitle = await getLLMTitle(prompt);
      stream.trackLLMCall();
    }

    if (!aiTitle || aiTitle.length < 2) {
      aiTitle = cleanPromptForTitle(prompt);
    }

    // Generate IDs FIRST so we can include hash in title for uniqueness
    let hash: string;
    let finalFileName: string;
    let storyId: string;

    if (isActualUpdate && (fileName || providedStoryId)) {
      if (providedStoryId) {
        storyId = providedStoryId;
        const hashMatch = providedStoryId.match(/^story-([a-f0-9]{8})$/);
        hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
      } else {
        // Match hash from filename, supporting both .tsx and .ts extensions
        const hashMatch = fileName?.match(/-([a-f0-9]{8})(?:\.stories\.tsx?)?$/);
        hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
        storyId = `story-${hash}`;
      }
      // Ensure finalFileName is always set
      finalFileName = fileName || fileNameFromTitle(aiTitle, hash, fileExtension);
    } else {
      const timestamp = Date.now();
      hash = crypto.createHash('sha1').update(prompt + timestamp).digest('hex').slice(0, 8);
      finalFileName = fileName || fileNameFromTitle(aiTitle, hash, fileExtension);
      storyId = `story-${hash}`;
    }

    // Create title for the story
    const prettyPrompt = escapeTitleForTS(aiTitle);
    // Use the title without hash suffix for cleaner sidebar display
    // The filename already contains the hash for uniqueness
    const uniqueTitle = prettyPrompt;

    // Fix title with storyPrefix and hash
    // Note: (?::\s*\w+(?:<[^>]+>)?)? handles TypeScript type annotations including generics
    // e.g., "const meta: Meta = {" or "const meta: Meta<typeof Button> = {"
    fixedFileContents = fixedFileContents.replace(
      /(const\s+meta\s*(?::\s*\w+(?:<[^>]+>)?)?\s*=\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
      (match, p1, oldTitle, p3) => {
        const titleToUse = uniqueTitle.startsWith(config.storyPrefix)
          ? uniqueTitle
          : config.storyPrefix + uniqueTitle;
        return p1 + titleToUse + p3;
      }
    );

    if (!fixedFileContents.includes(config.storyPrefix)) {
      fixedFileContents = fixedFileContents.replace(
        /(export\s+default\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
        (match, p1, oldTitle, p3) => {
          const titleToUse = uniqueTitle.startsWith(config.storyPrefix)
            ? uniqueTitle
            : config.storyPrefix + uniqueTitle;
          return p1 + titleToUse + p3;
        }
      );
    }

    // Ensure file extension is correct (use framework-specific extension)
    if (finalFileName && !finalFileName.endsWith(fileExtension)) {
      finalFileName = finalFileName + fileExtension;
    }

    // Step 8: Save story
    currentStep++;
    stream.sendProgress(currentStep, totalSteps, 'saving', 'Saving your story...');

    // Analyze what was generated
    const analysis = analyzeGeneratedCode(fixedFileContents, prompt, config);

    // Write story to file system
    const outPath = generateStory({
      fileContents: fixedFileContents,
      fileName: finalFileName,
      config: config
    });

    // Register with story tracker
    const mapping: StoryMapping = {
      title: aiTitle,
      fileName: finalFileName,
      storyId,
      hash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prompt
    };
    storyTracker.registerStory(mapping);

    // Save to history
    historyManager.addVersion(finalFileName, prompt, fixedFileContents, parentVersionId);

    // Track URL redirect if this is an update and the title changed
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

    // COMPLETION: Send detailed feedback
    stream.sendCompletion({
      success: true,
      title: aiTitle,
      fileName: finalFileName,
      storyId,
      summary: {
        action: isActualUpdate ? 'updated' : 'created',
        description: isActualUpdate
          ? `Updated story based on your request: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`
          : `Created new story for: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`
      },
      componentsUsed: analysis.componentsUsed,
      layoutChoices: analysis.layoutChoices,
      styleChoices: analysis.styleChoices,
      suggestions: hasValidationWarnings
        ? ['Some automatic fixes were applied. Review the generated code.']
        : undefined,
      validation: {
        isValid: !hasValidationWarnings,
        errors: validationResult?.errors || [],
        warnings: validationResult?.warnings || [],
        autoFixApplied: !!validationResult?.fixedCode
      },
      code: fixedFileContents
    });

    res.end();

  } catch (err: any) {
    stream.sendError({
      code: 'GENERATION_ERROR',
      message: err.message || 'Story generation failed',
      recoverable: false,
      suggestion: 'Please try again with a different prompt'
    });
    res.end();
  }
}

// Helper functions (copied from generateStory.ts for consistency)

// NOTE: Framework is now REQUIRED - caller must pass the detected framework
async function buildClaudePromptWithContext(
  userPrompt: string,
  config: any,
  conversation?: any[],
  previousCode?: string,
  components?: any[],
  options?: {
    framework: FrameworkType;  // REQUIRED - from early detection
    autoDetectFramework?: boolean;  // Deprecated - kept for compatibility but ignored
    visionMode?: VisionPromptType;
    designSystem?: string;
    considerations?: string;
  }
) {
  const discovery = new EnhancedComponentDiscovery(config);
  const discoveredComponents = components || await discovery.discoverAll();

  // SIMPLIFIED: Trust the passed framework from early detection
  // No more duplicate detection logic here
  if (!options?.framework) {
    throw new Error('Framework must be passed to buildClaudePromptWithContext - early detection should have determined it');
  }

  const frameworkOptions: StoryGenerationOptions = { framework: options.framework };

  // Always use framework-aware prompt since we now always have a framework
  let prompt = await buildFrameworkAwarePrompt(userPrompt, config, discoveredComponents, frameworkOptions);

  if (options?.visionMode) {
    const visionPrompts = buildVisionAwarePrompt({
      promptType: options.visionMode,
      userDescription: userPrompt,
      availableComponents: discoveredComponents.map((c: any) => c.name),
      framework: options.framework,  // Use the required framework, no fallback
      designSystem: options.designSystem,
    });
    prompt = `${visionPrompts.systemPrompt}\n\n---\n\n${prompt}\n\n---\n\n${visionPrompts.userPrompt}`;
  }

  // Inject passed considerations (from frontend) for environment parity
  // This takes precedence over file system loading for production deployments
  if (options?.considerations) {
    const considerationsEnhancement = `\n\n📋 DESIGN SYSTEM CONSIDERATIONS:\n${options.considerations}`;
    prompt = prompt.replace('User request:', `${considerationsEnhancement}\n\nUser request:`);
  }

  const documentation = getDocumentation(config.importPath);
  if (documentation) {
    const bundledEnhancement = `\n\n📚 BUNDLED DOCUMENTATION:\n${Object.entries(documentation.components || {}).map(([name, info]: [string, any]) => {
      if (discoveredComponents.some((c: any) => c.name === name)) {
        return `- ${name}: ${info.description || 'Component available'}`;
      }
      return null;
    }).filter(Boolean).join('\n')}`;

    prompt = prompt.replace('User request:', `${bundledEnhancement}\n\nUser request:`);
  }

  if (!conversation || conversation.length <= 1) {
    return prompt;
  }

  const conversationContext = conversation
    .slice(0, -1)
    .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n\n');

  let contextSection = `CONVERSATION CONTEXT (for modifications/updates):\n${conversationContext}`;

  if (previousCode) {
    contextSection += `\n\nPREVIOUS GENERATED CODE (this is what you're modifying):\n\`\`\`tsx\n${previousCode}\n\`\`\`\n\nCRITICAL INSTRUCTIONS FOR MODIFICATIONS:\n1. DO NOT regenerate the entire story from scratch\n2. PRESERVE all existing styling, components, and structure\n3. ONLY change what the user specifically requests`;
  }

  const contextualPrompt = prompt.replace(
    'User request:',
    `${contextSection}\n\nIMPORTANT: The user is asking to modify/update the story based on the above conversation.\n\nCurrent modification request:`
  );

  return contextualPrompt;
}

function extractCodeBlock(text: string): string | null {
  const codeBlock = text.match(/```(?:tsx|jsx|typescript|ts|js|javascript)?([\s\S]*?)```/i);
  return codeBlock ? codeBlock[1].trim() : null;
}

async function callLLM(
  messages: { role: 'user' | 'assistant', content: string }[],
  images?: ImageContent[]
): Promise<string> {
  if (!isProviderConfigured()) {
    throw new Error('No LLM provider configured');
  }

  if (images && images.length > 0) {
    const providerInfo = getProviderInfo();
    if (!providerInfo.supportsVision) {
      throw new Error(`${providerInfo.currentProvider} does not support vision`);
    }

    const messagesWithImages = messages.map((msg, index) => {
      if (msg.role === 'user' && index === 0) {
        return {
          role: msg.role as 'user' | 'assistant',
          content: buildMessageWithImages(msg.content, images)
        };
      }
      return msg;
    });

    return await chatCompletionWithImages(messagesWithImages, { maxTokens: 8192 });
  }

  return await chatCompletion(messages, { maxTokens: 8192 });
}

function cleanPromptForTitle(prompt: string): string {
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
  ];
  let cleaned = prompt.trim();
  for (const regex of leadingPhrases) {
    cleaned = cleaned.replace(regex, '');
  }
  return cleaned
    .replace(/[^\w\s'"?!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
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
  let base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/"|'/g, '')
    .slice(0, 60);
  return `${base}-${hash}${extension}`;
}

function extractImportsFromCode(code: string, importPath: string): string[] {
  const imports: string[] = [];
  const importRegex = new RegExp(`import\\s*{([^}]+)}\\s*from\\s*['"]${importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');

  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const importList = match[1];
    const components = importList.split(',').map(comp => comp.trim());
    imports.push(...components);
  }

  return imports;
}

async function preValidateImports(code: string, config: any, discovery: EnhancedComponentDiscovery): Promise<{ isValid: boolean; errors: string[] }> {
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

  if (config.iconImports?.package) {
    const allowedIcons = new Set<string>(config.iconImports?.commonIcons || []);
    const iconImports = extractImportsFromCode(code, config.iconImports.package);

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

  return { isValid: errors.length === 0, errors };
}

function extractComponentsFromContent(content: string): string[] {
  const componentMatches = content.match(/<[A-Z][A-Za-z0-9]*\s/g);
  if (!componentMatches) return [];
  return Array.from(new Set(componentMatches.map(match => match.replace(/[<\s]/g, ''))));
}
