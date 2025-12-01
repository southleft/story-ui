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
import { FrameworkType, StoryGenerationOptions } from '../../story-generator/framework-adapters/index.js';
import { loadUserConfig, validateConfig } from '../../story-generator/configLoader.js';
import { setupProductionGitignore } from '../../story-generator/productionGitignoreManager.js';
import { getStoryService } from '../../story-generator/storyServiceFactory.js';
import type { GeneratedStory } from '../../story-generator/storyServiceInterface.js';
import { extractAndValidateCodeBlock, createFallbackStory } from '../../story-generator/validateStory.js';
import { isBlacklistedComponent, isBlacklistedIcon, getBlacklistErrorMessage, ICON_CORRECTIONS } from '../../story-generator/componentBlacklist.js';
import { StoryTracker, StoryMapping } from '../../story-generator/storyTracker.js';
import { getDocumentation } from '../../story-generator/documentation-sources.js';
import { postProcessStory } from '../../story-generator/postProcessStory.js';
import { validateStory, ValidationError } from '../../story-generator/storyValidator.js';
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

// Analyze prompt to determine intent
async function analyzeIntent(
  prompt: string,
  config: any,
  conversation: any[] | undefined,
  previousCode: string | undefined,
  options: {
    framework?: FrameworkType;
    autoDetectFramework?: boolean;
    visionMode?: VisionPromptType;
    designSystem?: string;
    hasImages?: boolean;
  }
): Promise<IntentPreview> {
  // Determine framework
  let framework = 'react';
  if (options.framework) {
    framework = options.framework;
  } else if (options.autoDetectFramework) {
    try {
      framework = await detectProjectFramework(process.cwd());
    } catch {
      framework = 'react';
    }
  }

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
    const gitignoreManager = setupProductionGitignore(config);
    const storyService = await getStoryService(config);
    const isProduction = gitignoreManager.isProductionMode();
    const storyTracker = new StoryTracker(config);
    const historyManager = new StoryHistoryManager(process.cwd());
    const redirectDir = isProduction ? process.cwd() : path.dirname(config.generatedStoriesPath);
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
    const intent = await analyzeIntent(prompt, config, conversation, previousCode, {
      framework: framework as FrameworkType | undefined,
      autoDetectFramework: autoDetectFramework === true,
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

    const frameworkOptions = {
      framework: framework as FrameworkType | undefined,
      autoDetectFramework: autoDetectFramework === true,
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

    // Step 4: Call LLM
    currentStep++;
    stream.sendProgress(currentStep, totalSteps, 'llm_thinking', 'AI is generating your story...');

    // Validation and retry loop
    let aiText = '';
    let validationErrors: ValidationError[] = [];
    const maxRetries = 3;
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts++;
      stream.trackLLMCall();

      if (attempts > 1) {
        stream.sendRetry(attempts, maxRetries, 'Fixing validation errors',
          validationErrors.map(e => e.message)
        );
      }

      const claudeResponse = await callLLM(messages, processedImages.length > 0 ? processedImages : undefined);
      const extractedCode = extractCodeBlock(claudeResponse);

      if (!extractedCode) {
        aiText = claudeResponse;
        if (attempts < maxRetries) {
          messages.push({ role: 'assistant', content: aiText });
          messages.push({ role: 'user', content: 'You did not provide a code block. Please provide the complete story in a single `tsx` code block.' });
          continue;
        } else {
          break;
        }
      } else {
        aiText = extractedCode;
      }

      // Step 5: Validate
      currentStep = 5;
      stream.sendProgress(currentStep, totalSteps, 'validating', 'Validating generated code...');

      validationErrors = validateStory(aiText);

      if (validationErrors.length === 0) {
        stream.sendValidation({
          isValid: true,
          errors: [],
          warnings: [],
          autoFixApplied: false
        });
        break;
      }

      stream.sendValidation({
        isValid: false,
        errors: validationErrors.map(e => e.message),
        warnings: [],
        autoFixApplied: false
      });

      if (attempts < maxRetries) {
        const errorFeedback = validationErrors
          .map(err => `- Line ${err.line}: ${err.message}`)
          .join('\n');

        const retryPrompt = `Your previous attempt failed validation with the following errors:\n${errorFeedback}\n\nPlease correct these issues and provide the full, valid story code.`;

        messages.push({ role: 'assistant', content: claudeResponse });
        messages.push({ role: 'user', content: retryPrompt });
      }
    }

    // Step 6: Code extraction and validation
    currentStep = 6;
    stream.sendProgress(currentStep, totalSteps, 'code_extracted', 'Processing generated code...');

    // Pre-validate imports
    const preValidation = await preValidateImports(aiText, config, discovery);

    if (!preValidation.isValid) {
      stream.sendError({
        code: 'INVALID_IMPORTS',
        message: 'Generated code contains invalid imports',
        details: preValidation.errors.join('; '),
        recoverable: true,
        suggestion: 'Try using basic components like Box, Stack, Button'
      });
      res.end();
      return;
    }

    // Full validation
    const validationResult = extractAndValidateCodeBlock(aiText, config);
    let fileContents: string;
    let hasValidationWarnings = false;

    if (!validationResult.isValid && !validationResult.fixedCode) {
      fileContents = createFallbackStory(prompt, config);
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

    // Ensure React import
    if (!fileContents.includes("import React from 'react';")) {
      fileContents = "import React from 'react';\n" + fileContents;
    }

    let fixedFileContents = postProcessStory(fileContents, config.importPath);

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

    const prettyPrompt = escapeTitleForTS(aiTitle);

    // Fix title with storyPrefix
    fixedFileContents = fixedFileContents.replace(
      /(const\s+meta\s*=\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
      (match, p1, oldTitle, p3) => {
        const titleToUse = prettyPrompt.startsWith(config.storyPrefix)
          ? prettyPrompt
          : config.storyPrefix + prettyPrompt;
        return p1 + titleToUse + p3;
      }
    );

    if (!fixedFileContents.includes(config.storyPrefix)) {
      fixedFileContents = fixedFileContents.replace(
        /(export\s+default\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
        (match, p1, oldTitle, p3) => {
          const titleToUse = prettyPrompt.startsWith(config.storyPrefix)
            ? prettyPrompt
            : config.storyPrefix + prettyPrompt;
          return p1 + titleToUse + p3;
        }
      );
    }

    // Generate IDs
    let hash: string;
    let finalFileName: string;
    let storyId: string;

    if (isActualUpdate && (fileName || providedStoryId)) {
      if (providedStoryId) {
        storyId = providedStoryId;
        const hashMatch = providedStoryId.match(/^story-([a-f0-9]{8})$/);
        hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
      } else {
        const hashMatch = fileName?.match(/-([a-f0-9]{8})(?:\.stories\.tsx)?$/);
        hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
        storyId = `story-${hash}`;
      }
      // Ensure finalFileName is always set
      finalFileName = fileName || fileNameFromTitle(aiTitle, hash);
    } else {
      const timestamp = Date.now();
      hash = crypto.createHash('sha1').update(prompt + timestamp).digest('hex').slice(0, 8);
      finalFileName = fileName || fileNameFromTitle(aiTitle, hash);
      storyId = `story-${hash}`;
    }

    // Step 8: Save story
    currentStep++;
    stream.sendProgress(currentStep, totalSteps, 'saving', 'Saving your story...');

    // Analyze what was generated
    const analysis = analyzeGeneratedCode(fixedFileContents, prompt, config);

    if (isProduction) {
      const generatedStory: GeneratedStory = {
        id: storyId,
        title: aiTitle,
        description: isActualUpdate ? `Updated: ${prompt}` : prompt,
        content: fixedFileContents,
        createdAt: isActualUpdate ? new Date() : new Date(),
        lastAccessed: new Date(),
        prompt: isActualUpdate && conversation
          ? conversation.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n\n')
          : prompt,
        components: extractComponentsFromContent(fixedFileContents)
      };

      await storyService.storeStory(generatedStory);

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

      historyManager.addVersion(finalFileName, prompt, fixedFileContents, parentVersionId);

      // Track URL redirect if needed
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
    } else {
      const outPath = generateStory({
        fileContents: fixedFileContents,
        fileName: finalFileName,
        config: config
      });

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

      historyManager.addVersion(finalFileName, prompt, fixedFileContents, parentVersionId);

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

async function buildClaudePromptWithContext(
  userPrompt: string,
  config: any,
  conversation?: any[],
  previousCode?: string,
  components?: any[],
  options?: {
    framework?: FrameworkType;
    autoDetectFramework?: boolean;
    visionMode?: VisionPromptType;
    designSystem?: string;
    considerations?: string;
  }
) {
  const discovery = new EnhancedComponentDiscovery(config);
  const discoveredComponents = components || await discovery.discoverAll();

  let useFrameworkAware = false;
  let frameworkOptions: StoryGenerationOptions | undefined;

  if (options?.framework) {
    useFrameworkAware = true;
    frameworkOptions = { framework: options.framework };
  } else if (options?.autoDetectFramework) {
    try {
      const detectedFramework = await detectProjectFramework(process.cwd());
      useFrameworkAware = true;
      frameworkOptions = { framework: detectedFramework };
    } catch {
      // Default to React
    }
  }

  let prompt: string;
  if (useFrameworkAware && frameworkOptions) {
    prompt = await buildFrameworkAwarePrompt(userPrompt, config, discoveredComponents, frameworkOptions);
  } else {
    prompt = await buildFlexiblePrompt(userPrompt, config, discoveredComponents);
  }

  if (options?.visionMode) {
    const visionPrompts = buildVisionAwarePrompt({
      promptType: options.visionMode,
      userDescription: userPrompt,
      availableComponents: discoveredComponents.map((c: any) => c.name),
      framework: frameworkOptions?.framework || 'react',
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

function fileNameFromTitle(title: string, hash: string): string {
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
  return `${base}-${hash}.stories.tsx`;
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
