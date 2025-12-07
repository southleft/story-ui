import { Request, Response } from 'express';
import { generateStory } from '../../story-generator/generateStory.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { discoverComponents } from '../../story-generator/componentDiscovery.js';
import {
  buildClaudePrompt as buildFlexiblePrompt,
  buildFrameworkAwarePrompt,
  detectProjectFramework,
  getAvailableFrameworks,
} from '../../story-generator/promptGenerator.js';
import { FrameworkType, StoryGenerationOptions, getAdapter } from '../../story-generator/framework-adapters/index.js';
import { loadUserConfig, validateConfig } from '../../story-generator/configLoader.js';
import { extractAndValidateCodeBlock, validateStoryCode } from '../../story-generator/validateStory.js';
import { createFrameworkAwareFallbackStory } from './storyHelpers.js';
import { isBlacklistedComponent, isBlacklistedIcon, getBlacklistErrorMessage, ICON_CORRECTIONS } from '../../story-generator/componentBlacklist.js';
import { StoryTracker, StoryMapping } from '../../story-generator/storyTracker.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import { getDocumentation, isDeprecatedComponent, getComponentReplacement } from '../../story-generator/documentation-sources.js';
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
  formatRuntimeErrorForHealing,
  isRuntimeValidationEnabled,
} from '../../story-generator/runtimeValidator.js';

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

// Legacy function - now uses flexible system with enhanced discovery
async function buildClaudePrompt(userPrompt: string) {
  const config = loadUserConfig();
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();
  return await buildFlexiblePrompt(userPrompt, config, components);
}

// Enhanced function that includes conversation context and previous code
// Now supports multi-framework prompt generation and vision-aware prompts
// NOTE: Framework is now REQUIRED - caller must pass the detected framework
async function buildClaudePromptWithContext(
  userPrompt: string,
  config: any,
  conversation?: any[],
  previousCode?: string,
  options?: {
    framework: FrameworkType;  // REQUIRED - from early detection
    autoDetectFramework?: boolean;  // Deprecated - kept for compatibility but ignored
    visionMode?: VisionPromptType;
    designSystem?: string;
  }
) {
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();

  // SIMPLIFIED: Trust the passed framework from early detection
  // The caller (main handler) is responsible for detecting the framework once
  // We no longer re-detect here - this eliminates duplicate detection and inconsistency
  if (!options?.framework) {
    throw new Error('Framework must be passed to buildClaudePromptWithContext - early detection should have determined it');
  }

  const frameworkOptions: StoryGenerationOptions = { framework: options.framework };

  // Always start with component discovery as the authoritative source
  logger.log(`📦 Discovered ${components.length} components from ${config.importPath}`);
  const availableComponents = components.map(c => c.name).join(', ');
  logger.log(`✅ Available components: ${availableComponents}`);

  // Build framework-aware prompt since we now always have a framework
  let prompt: string = await buildFrameworkAwarePrompt(userPrompt, config, components, frameworkOptions);
  logger.log(`🔧 Built framework-aware prompt for ${options.framework}`);

  // Enhance prompt with vision-aware context if vision mode is provided
  if (options?.visionMode) {
    logger.log(`🔍 Enhancing prompt with vision mode: ${options.visionMode}`);
    const visionPrompts = buildVisionAwarePrompt({
      promptType: options.visionMode,
      userDescription: userPrompt,
      availableComponents: components.map(c => c.name),
      framework: options.framework,  // Use required framework, no fallback
      designSystem: options.designSystem,
    });
    // Combine the vision system prompt with the existing prompt and add the user prompt
    prompt = `${visionPrompts.systemPrompt}\n\n---\n\n${prompt}\n\n---\n\n${visionPrompts.userPrompt}`;
  }

// Try to enhance with bundled documentation for usage patterns and design tokens
  logger.log('📋 Using bundled documentation for enhancement');
  const documentation = getDocumentation(config.importPath);
  if (documentation) {
    const bundledEnhancement = `

📚 BUNDLED DOCUMENTATION:
${Object.entries(documentation.components || {}).map(([name, info]: [string, any]) => {
  // Only include docs for components that actually exist in the discovered list
  if (components.some(c => c.name === name)) {
    return `- ${name}: ${info.description || 'Component available'}
   ${info.variants ? `Variants: ${info.variants.join(', ')}` : ''}
   ${info.commonProps ? `Props: ${info.commonProps.join(', ')}` : ''}
   ${info.examples ? `\n   Examples:\n${info.examples.map((ex: any) => `   // ${ex.label}
   ${ex.code}`).join('\n')}` : ''}`;
  }
  return null;
}).filter(Boolean).join('\n\n')}`;

    prompt = prompt.replace('User request:', `${bundledEnhancement}

User request:`);
  }

  // If no conversation context, return the prompt as-is
  if (!conversation || conversation.length <= 1) {
    return prompt;
  }

  // Extract conversation context for modifications
  const conversationContext = conversation
    .slice(0, -1) // Remove the current message (last one)
    .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n\n');

  // Build contextual prompt with previous code if available
  let contextSection = `CONVERSATION CONTEXT (for modifications/updates):
${conversationContext}`;

  if (previousCode) {
    contextSection += `

PREVIOUS GENERATED CODE (this is what you're modifying):
\`\`\`tsx
${previousCode}
\`\`\`

CRITICAL INSTRUCTIONS FOR MODIFICATIONS:
1. DO NOT regenerate the entire story from scratch
2. PRESERVE all existing styling, components, and structure
3. ONLY change what the user specifically requests
4. Keep the exact same layout (Grid structure, columns, etc.) unless explicitly asked to change it
5. Maintain all visual styling (colors, shadows, spacing) unless asked to modify them
6. Think of this as EDITING the code above, not creating new code`;
  }

  // Add conversation context to the prompt
  const contextualPrompt = prompt.replace(
    'User request:',
    `${contextSection}

IMPORTANT: The user is asking to modify/update the story based on the above conversation.
- Keep the SAME layout structure (number of columns, grid setup) unless explicitly asked to change it
- Only modify the specific aspects mentioned in the latest request
- Maintain the overall story concept from the original request

Current modification request:`
  );

  return contextualPrompt;
}

function slugify(str: string) {
  if (!str || typeof str !== 'string') {
    return 'untitled';
  }
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractCodeBlock(text: string): string | null {
  // More flexible code block extraction - accept various language identifiers
  const codeBlock = text.match(/```(?:tsx|jsx|typescript|ts|js|javascript)?([\s\S]*?)```/i);
  return codeBlock ? codeBlock[1].trim() : null;
}

async function callLLM(
  messages: { role: 'user' | 'assistant', content: string }[],
  images?: ImageContent[]
): Promise<string> {
  // Check if any provider is configured
  if (!isProviderConfigured()) {
    throw new Error('No LLM provider configured. Please set CLAUDE_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
  }

  const providerInfo = getProviderInfo();
  logger.debug(`Using ${providerInfo.currentProvider} (${providerInfo.currentModel}) for story generation`);

  // If images are provided, use vision-capable chat
  if (images && images.length > 0) {
    if (!providerInfo.supportsVision) {
      throw new Error(`${providerInfo.currentProvider} does not support vision. Please configure a vision-capable provider.`);
    }

    logger.log(`🖼️ Using vision-capable chat with ${images.length} image(s)`);

    // Convert messages to include images in the first user message
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
  // Remove common leading phrases (case-insensitive)
  const leadingPhrases = [
    /^generate (a|an|the)? /i,
    /^build (a|an|the)? /i,
    /^create (a|an|the)? /i,
    /^make (a|an|the)? /i,
    /^design (a|an|the)? /i,
    /^show (me )?(a|an|the)? /i,
    /^write (a|an|the)? /i,
    /^produce (a|an|the)? /i,
    /^construct (a|an|the)? /i,
    /^draft (a|an|the)? /i,
    /^compose (a|an|the)? /i,
    /^implement (a|an|the)? /i,
    /^build out (a|an|the)? /i,
    /^add (a|an|the)? /i,
    /^render (a|an|the)? /i,
    /^display (a|an|the)? /i,
  ];
  let cleaned = prompt.trim();
  for (const regex of leadingPhrases) {
    cleaned = cleaned.replace(regex, '');
  }

  // More careful punctuation handling - preserve meaningful punctuation in quotes
  return cleaned
    // Replace problematic characters but preserve quoted content structure
    .replace(/[^\w\s'"?!-]/g, ' ')  // Keep letters, numbers, spaces, quotes, and basic punctuation
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()); // Capitalize words
}

async function getLLMTitle(userPrompt: string): Promise<string> {
  // Use the LLM service's built-in title generation
  try {
    return await llmGenerateTitle(userPrompt);
  } catch (error) {
    logger.warn('Failed to generate title via LLM, using fallback', { error });
    return '';
  }
}

function escapeTitleForTS(title: string): string {
  // Escape all characters that could break TypeScript string literals
  return title
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/"/g, '\\"')    // Escape double quotes
    .replace(/'/g, "\\'")    // Escape single quotes
    .replace(/`/g, '\\`')    // Escape backticks
    .replace(/\n/g, '\\n')   // Escape newlines
    .replace(/\r/g, '\\r')   // Escape carriage returns
    .replace(/\t/g, '\\t');  // Escape tabs
}

function extractImportsFromCode(code: string, importPath: string): string[] {
  const imports: string[] = [];

  // Match import statements from the specific import path
  const importRegex = new RegExp(`import\\s*{([^}]+)}\\s*from\\s*['"]${importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');

  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const importList = match[1];
    // Split by comma and clean up each import
    const components = importList.split(',').map(comp => comp.trim());
    imports.push(...components);
  }

  return imports;
}

async function preValidateImports(code: string, config: any, discovery: EnhancedComponentDiscovery): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Extract imports from the main import path
  const componentImports = extractImportsFromCode(code, config.importPath);

  // Use the enhanced discovery to validate components
  const validation = await discovery.validateComponentNames(componentImports);

  // Check for blacklisted components first
  const allowedComponents = new Set<string>(discovery.getAvailableComponentNames());
  
  for (const importName of componentImports) {
    if (isBlacklistedComponent(importName, allowedComponents, config.importPath)) {
      const errorMsg = getBlacklistErrorMessage(importName, config.importPath);
      errors.push(`Blacklisted component detected: ${errorMsg}`);
    }
  }

  // Add invalid component errors with suggestions
  for (const invalidComponent of validation.invalid) {
    const suggestion = validation.suggestions.get(invalidComponent);
    if (suggestion) {
      errors.push(`Invalid component: "${invalidComponent}" does not exist in ${config.importPath}. Did you mean "${suggestion}"?`);
    } else {
      errors.push(`Invalid component: "${invalidComponent}" does not exist in ${config.importPath}. Available components: ${validation.valid.slice(0, 5).join(', ')}${validation.valid.length > 5 ? '...' : ''}`);
    }
  }

    // Extract icon imports (keep existing icon validation)
  if (config.iconImports?.package) {
    const allowedIcons = new Set<string>(config.iconImports?.commonIcons || []);
    const iconImports = extractImportsFromCode(code, config.iconImports.package);

    for (const iconName of iconImports) {
      if (isBlacklistedIcon(iconName, allowedIcons)) {
        const correction = ICON_CORRECTIONS[iconName];
        if (correction) {
          errors.push(`Invalid icon: "${iconName}" does not exist. Did you mean "${correction}"?`);
        } else {
          errors.push(`Invalid icon: "${iconName}" is not in the list of available icons.`);
        }
      } else if (!allowedIcons.has(iconName)) {
        // Try to find a similar icon
        const similarIcon = findSimilarIcon(iconName, allowedIcons);
        if (similarIcon) {
          errors.push(`Invalid icon: "${iconName}" does not exist. Did you mean "${similarIcon}"?`);
        } else {
          errors.push(`Invalid icon: "${iconName}" is not in the list of available icons.`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

function findSimilarIcon(iconName: string, allowedIcons: Set<string>): string | null {
  if (!iconName || typeof iconName !== 'string') {
    return null;
  }
  // Simple similarity check - find icons that contain similar words
  const iconLower = iconName.toLowerCase();

  for (const allowed of allowedIcons) {
    const allowedLower = allowed.toLowerCase();

    // Check if the core word matches
    if (iconLower.includes('commit') && allowedLower.includes('commit')) return allowed;
    if (iconLower.includes('branch') && allowedLower.includes('branch')) return allowed;
    if (iconLower.includes('merge') && allowedLower.includes('merge')) return allowed;
    if (iconLower.includes('pull') && allowedLower.includes('pull')) return allowed;
  }

  return null;
}

function fileNameFromTitle(title: string, hash: string, extension: string = '.stories.tsx'): string {
  if (!title || typeof title !== 'string') {
    title = 'untitled';
  }
  if (!hash || typeof hash !== 'string') {
    hash = 'default';
  }
  // Lowercase, replace spaces/special chars with dashes, remove quotes, truncate
  let base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/"|'/g, '')
    .slice(0, 60);
  return `${base}-${hash}${extension}`;
}

export async function generateStoryFromPrompt(req: Request, res: Response) {
  const {
    prompt,
    fileName,
    conversation,
    isUpdate,
    originalTitle,
    storyId: providedStoryId,
    framework,           // Explicit framework (react, vue, angular, svelte, web-components)
    autoDetectFramework, // Auto-detect from project (default: false)
    images,              // Array of images for vision-based generation
    visionMode,          // Vision mode: 'screenshot_to_story', 'design_to_story', 'component_analysis', 'layout_analysis'
    designSystem         // Design system being used (chakra-ui, mantine, etc.)
  } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    // Load and validate configuration
    const config = loadUserConfig();
    const validation = validateConfig(config);

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Configuration validation failed',
        details: validation.errors
      });
    }

    // Process images if provided
    let processedImages: ImageContent[] = [];
    if (images && Array.isArray(images) && images.length > 0) {
      logger.log(`📸 Processing ${images.length} image(s) for vision-based story generation`);
      try {
        processedImages = await processImageInputs(images as ImageInput[]);
        logger.log(`✅ Successfully processed ${processedImages.length} image(s)`);
      } catch (imageError) {
        return res.status(400).json({
          error: 'Image processing failed',
          details: imageError instanceof Error ? imageError.message : String(imageError)
        });
      }
    }

    // Initialize story tracker for managing updates vs new creations
    const storyTracker = new StoryTracker(config);

    // Initialize history manager - use the current working directory
    const historyManager = new StoryHistoryManager(process.cwd());

    // Initialize URL redirect service
    const redirectDir = path.dirname(config.generatedStoriesPath);
    const redirectService = new UrlRedirectService(redirectDir);

    // Check if this is an update to an existing story
    // Use the explicit isUpdate flag from request, or fallback to old logic
    const isActualUpdate = req.body.isUpdate || (fileName && conversation && conversation.length > 2);

    // Get previous code if this is an update
    let previousCode: string | undefined;
    let parentVersionId: string | undefined;
    let oldTitle: string | undefined;
    let oldStoryUrl: string | undefined;

    if (isActualUpdate && fileName) {
      const currentVersion = historyManager.getCurrentVersion(fileName);
      if (currentVersion) {
        previousCode = currentVersion.code;
        parentVersionId = currentVersion.id;
        logger.log('🔄 Found previous version for iteration');
        
        // Extract the old title from previous code
        const titleMatch = previousCode.match(/title:\s*["']([^"']+)['"]/);
        if (titleMatch) {
          oldTitle = titleMatch[1];
          // Remove the prefix to get clean title for URL generation
          const cleanOldTitle = oldTitle.replace(config.storyPrefix || 'Generated/', '');
          // Convert title to Storybook URL format
          oldStoryUrl = `/story/${cleanOldTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}--primary`;
          logger.log('📌 Previous title:', oldTitle);
          logger.log('📌 Clean title for URL:', cleanOldTitle);
          logger.log('📌 Previous URL:', oldStoryUrl);
        }
      }
    }

    // --- Start of Self-Healing Validation and Retry Loop ---
    let aiText = '';
    let validationErrors: ValidationError[] = [];
    const maxRetries = 3;
    let attempts = 0;
    let selfHealingUsed = false;

    // Build framework-aware options with vision support
    // NOTE: Will be updated with detectedFramework after early detection
    let frameworkOptions = {
      framework: framework as FrameworkType | undefined,
      autoDetectFramework: autoDetectFramework === true,
      visionMode: visionMode as VisionPromptType | undefined,
      designSystem: designSystem as string | undefined,
    };

    // Create enhanced component discovery BEFORE the loop for use in self-healing
    const discovery = new EnhancedComponentDiscovery(config);
    const discoveredComponents = await discovery.discoverAll();
    const componentNames = discoveredComponents.map(c => c.name);

    // EARLY FRAMEWORK DETECTION - detect once and use consistently throughout
    // Priority: request > config.componentFramework > config.framework > auto-detect
    // CRITICAL: Fail explicitly if no framework can be determined rather than silently defaulting to React
    let detectedFramework: FrameworkType;
    if (frameworkOptions.framework) {
      detectedFramework = frameworkOptions.framework;
      logger.log(`🎯 Using explicit framework from request: ${detectedFramework}`);
    } else if (config.componentFramework) {
      detectedFramework = config.componentFramework as FrameworkType;
      logger.log(`🎯 Using framework from config.componentFramework: ${detectedFramework}`);
    } else if (config.framework) {
      detectedFramework = config.framework as FrameworkType;
      logger.log(`🎯 Using framework from config.framework: ${detectedFramework}`);
    } else if (frameworkOptions.autoDetectFramework) {
      try {
        detectedFramework = await detectProjectFramework(process.cwd());
        logger.log(`🎯 Auto-detected framework: ${detectedFramework}`);
      } catch (error) {
        // FAIL EXPLICITLY rather than silently defaulting to React
        logger.error('Failed to auto-detect framework and no framework configured', { error });
        return res.status(400).json({
          error: 'Framework detection failed',
          details: 'Could not auto-detect framework. Please set componentFramework in story-ui.config.js or pass framework in the request.',
          suggestion: 'Add componentFramework: "react" (or vue, angular, svelte, web-components) to your story-ui.config.js'
        });
      }
    } else {
      // Default to React only with a warning - this is the ONLY place we default
      detectedFramework = 'react';
      logger.warn('⚠️ No framework configured, defaulting to React. Consider setting componentFramework in story-ui.config.js');
    }

    // CREATE a properly-typed options object with the detected framework
    // This ensures TypeScript knows framework is definitely set
    const promptOptions = {
      framework: detectedFramework,  // Always set from early detection
      autoDetectFramework: false,    // Already detected, don't re-detect
      visionMode: visionMode as VisionPromptType | undefined,
      designSystem: designSystem as string | undefined,
    };

    // Get the framework adapter early for consistent use
    const frameworkAdapter = getAdapter(detectedFramework);

    // Self-healing options for retry prompts - use detected framework
    const selfHealingOptions: SelfHealingOptions = {
      maxAttempts: maxRetries,
      availableComponents: componentNames,
      framework: detectedFramework,
      importPath: config.importPath || 'your-library',
    };

    // Track all attempts for best-attempt selection
    const allAttempts: Array<{ code: string; errors: ValidationErrors; autoFixed: boolean }> = [];
    const errorHistory: ValidationErrors[] = [];

    const initialPrompt = await buildClaudePromptWithContext(prompt, config, conversation, previousCode, promptOptions);
    const messages: { role: 'user' | 'assistant', content: string }[] = [{ role: 'user', content: initialPrompt }];

    while (attempts < maxRetries) {
      attempts++;
      logger.log(`--- Story Generation Attempt ${attempts} ---`);

      const claudeResponse = await callLLM(messages, processedImages.length > 0 ? processedImages : undefined);
      const extractedCode = extractCodeBlock(claudeResponse);

      if (!extractedCode) {
        aiText = claudeResponse; // Use raw response if no code block
        if (attempts < maxRetries) {
          logger.log('No code block found, retrying...');
          messages.push({ role: 'assistant', content: aiText });
          messages.push({ role: 'user', content: 'You did not provide a code block. Please provide the complete story in a single `tsx` code block.' });
          continue;
        } else {
          // On last attempt, accept the response as is
          break;
        }
      } else {
        aiText = extractedCode;
      }

      // --- COMPREHENSIVE VALIDATION (Pattern + AST + Import) ---

      // 1. Pattern validation (storyValidator)
      validationErrors = validateStory(aiText);

      // 2. TypeScript AST validation (validateStory.ts)
      const astValidation = validateStoryCode(aiText, 'story.tsx', config);

      // 3. Import validation (check against discovered components)
      const importValidation = await preValidateImports(aiText, config, discovery);

      // Aggregate all errors
      const aggregatedErrors = aggregateValidationErrors(
        astValidation,
        validationErrors,
        importValidation.isValid ? [] : importValidation.errors
      );

      // Track this attempt
      const autoFixApplied = !!astValidation.fixedCode;
      allAttempts.push({
        code: astValidation.fixedCode || aiText,
        errors: aggregatedErrors,
        autoFixed: autoFixApplied,
      });
      errorHistory.push(aggregatedErrors);

      // Log validation results
      logger.log(`Validation: ${formatErrorsForLog(aggregatedErrors)}`);
      if (autoFixApplied) {
        logger.log('Auto-fix applied to code');
        aiText = astValidation.fixedCode!;
      }

      // Check if all validations pass
      if (hasNoErrors(aggregatedErrors)) {
        logger.log('✅ All validations passed!');
        break; // Exit loop on success
      }

      // Check if we should continue retrying
      const retryDecision = shouldContinueRetrying(attempts, maxRetries, errorHistory);
      if (!retryDecision.shouldRetry) {
        logger.log(`🛑 Stopping retries: ${retryDecision.reason}`);
        break;
      }

      // --- SELF-HEALING: Send errors back to LLM for correction ---
      selfHealingUsed = true;
      logger.log(`🔄 Self-healing attempt ${attempts} of ${maxRetries}`);
      logger.log(`   Errors: Syntax(${aggregatedErrors.syntaxErrors.length}), Pattern(${aggregatedErrors.patternErrors.length}), Import(${aggregatedErrors.importErrors.length})`);

      // Build the self-healing prompt with all errors
      const selfHealingPrompt = buildSelfHealingPrompt(
        aiText,
        aggregatedErrors,
        attempts,
        selfHealingOptions
      );

      messages.push({ role: 'assistant', content: claudeResponse });
      messages.push({ role: 'user', content: selfHealingPrompt });
    }
    // --- End of Self-Healing Validation and Retry Loop ---

    // Determine the best code to use
    let fileContents: string;
    let hasValidationWarnings = false;

    // Select the best attempt (fewest errors)
    const bestAttempt = selectBestAttempt(allAttempts);
    const finalErrors = bestAttempt ? bestAttempt.errors : createEmptyErrors();
    const finalErrorCount = getTotalErrorCount(finalErrors);

    logger.log(`Generation complete: ${attempts} attempts, self-healing=${selfHealingUsed}, final errors=${finalErrorCount}`);

    if (finalErrorCount > 0 && bestAttempt) {
      logger.log(`⚠️ Using best attempt with ${finalErrorCount} remaining errors`);
      logger.log(`   Remaining: ${formatErrorsForLog(finalErrors)}`);

      // If there are still errors but we have an attempt, use the best one
      // Only create fallback if we have no valid code at all
      if (bestAttempt.code && bestAttempt.code.includes('export')) {
        fileContents = bestAttempt.code;
        hasValidationWarnings = true;
      } else {
        // Create fallback story only if we have no usable code
        logger.log('Creating fallback story - no usable code generated');
        fileContents = createFrameworkAwareFallbackStory(prompt, config, detectedFramework);
        hasValidationWarnings = true;
      }
    } else if (bestAttempt) {
      // Success - use the best attempt (which should have no errors)
      fileContents = bestAttempt.code;
    } else {
      // No attempts at all (shouldn't happen)
      fileContents = aiText;
    }

    if (!fileContents) {
      console.error('No valid code could be extracted or generated.');
      return res.status(500).json({ error: 'Failed to generate valid TypeScript code.' });
    }

    // NOTE: Framework detection and adapter retrieval already done earlier in function
    // detectedFramework and frameworkAdapter are available from lines 555-588
    // React imports are handled by the adapter's postProcess method, not manually added here

    // Post-processing is now consolidated to run once on the final code
    let fixedFileContents = postProcessStory(fileContents, config.importPath);

    // Apply framework-specific post-processing if adapter is available
    if (frameworkAdapter) {
      logger.log(`🔧 Applying ${detectedFramework} framework post-processing`);
      fixedFileContents = frameworkAdapter.postProcess(fixedFileContents);
    }

    // Generate title based on conversation context
    let aiTitle;
    if (isActualUpdate && originalTitle) {
      // For updates, preserve the original title
      aiTitle = originalTitle;
      logger.log('📝 Preserving original title for update:', aiTitle);
    } else if (isActualUpdate) {
      // For updates without original title, try to keep the original title or modify it slightly
      const originalPrompt = conversation.find((msg: any) => msg.role === 'user')?.content || prompt;
      aiTitle = await getLLMTitle(originalPrompt);
    } else {
      // For new stories, generate a new title
      aiTitle = await getLLMTitle(prompt);
    }

    if (!aiTitle || aiTitle.length < 2) {
      // Fallback to cleaned prompt if Claude fails
      aiTitle = cleanPromptForTitle(prompt);
    }

    // Generate unique ID and filename FIRST so we can include hash in title
    // This is done early to ensure unique titles prevent Storybook duplicate ID errors
    const fileExtension = frameworkAdapter?.defaultExtension || '.stories.tsx';
    const timestamp = Date.now();

    // Always generate a hash - either from existing IDs or new
    let hash: string;
    let finalFileName: string;
    let storyId: string;

    if (isActualUpdate && (fileName || providedStoryId)) {
      // For updates, preserve the existing fileName and ID
      if (providedStoryId) {
        storyId = providedStoryId;
        const hashMatch = providedStoryId.match(/^story-([a-f0-9]{8})$/);
        hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt + timestamp).digest('hex').slice(0, 8);
        finalFileName = fileName || `${providedStoryId}${fileExtension}`;
        logger.log('📝 Using provided storyId:', finalFileName);
      } else if (fileName) {
        // Match hash from filename, supporting both .tsx and .ts extensions
        const hashMatch = fileName.match(/-([a-f0-9]{8})(?:\.stories\.tsx?)?$/);
        hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt + timestamp).digest('hex').slice(0, 8);
        storyId = `story-${hash}`;
        finalFileName = fileName;
      } else {
        // Fallback - should not reach here given the if condition, but satisfies TypeScript
        hash = crypto.createHash('sha1').update(prompt + timestamp).digest('hex').slice(0, 8);
        storyId = `story-${hash}`;
        finalFileName = fileNameFromTitle(aiTitle, hash, fileExtension);
      }

      if (!finalFileName.endsWith(fileExtension)) {
        finalFileName = finalFileName + fileExtension;
      }
      logger.log('📌 Preserving story identity for update:', { storyId, fileName: finalFileName });
    } else {
      // For new stories, ALWAYS generate new IDs with timestamp to ensure uniqueness
      hash = crypto.createHash('sha1').update(prompt + timestamp).digest('hex').slice(0, 8);
      finalFileName = fileName || fileNameFromTitle(aiTitle, hash, fileExtension);
      storyId = `story-${hash}`;
      logger.log('🆕 Creating new story:', { storyId, fileName: finalFileName });
    }

    // Create title for the story
    const prettyPrompt = escapeTitleForTS(aiTitle);
    // Use the title without hash suffix for cleaner sidebar display
    // The filename already contains the hash for uniqueness
    const uniqueTitle = prettyPrompt;

    // Fix title with storyPrefix and hash - handle both single-line and multi-line formats
    // Note: (?::\s*\w+(?:<[^>]+>)?)? handles TypeScript type annotations including generics
    // e.g., "const meta: Meta = {" or "const meta: Meta<typeof Button> = {"
    fixedFileContents = fixedFileContents.replace(
      /(const\s+meta\s*(?::\s*\w+(?:<[^>]+>)?)?\s*=\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
      (match, p1, oldTitle, p3) => {
        // Check if the title already has the prefix to avoid double prefixing
        const titleToUse = uniqueTitle.startsWith(config.storyPrefix)
          ? uniqueTitle
          : config.storyPrefix + uniqueTitle;
        return p1 + titleToUse + p3;
      }
    );

    // Fallback: export default { title: "..." } format
    if (!fixedFileContents.includes(config.storyPrefix)) {
      fixedFileContents = fixedFileContents.replace(
        /(export\s+default\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
        (match, p1, oldTitle, p3) => {
          // Check if the title already has the prefix to avoid double prefixing
          const titleToUse = uniqueTitle.startsWith(config.storyPrefix)
            ? uniqueTitle
            : config.storyPrefix + uniqueTitle;
          return p1 + titleToUse + p3;
        }
      );
    }

    // FIX #5: Final validation after ALL post-processing
    // This catches any syntax errors introduced by post-processing (e.g., buggy regex replacements)
    const finalValidation = validateStoryCode(fixedFileContents, 'story.tsx', config);

    // ALWAYS apply fixedCode if it exists - handles both:
    // 1. Syntax error fixes (where isValid = false)
    // 2. React import removal for non-React frameworks (where isValid = true but fixedCode exists)
    if (finalValidation.fixedCode) {
      logger.log('✅ Applied validation fixes (React import removal or syntax fixes)');
      fixedFileContents = finalValidation.fixedCode;
    }

    if (!finalValidation.isValid) {
      logger.log('⚠️ Post-processing introduced syntax errors:', finalValidation.errors);

      // If we don't have fixed code at this point, we can't recover
      if (!finalValidation.fixedCode) {
        // Post-processing broke the code and we can't fix it
        // Return an error rather than serving broken code
        console.error('Post-processing introduced unfixable syntax errors:', finalValidation.errors);
        return res.status(500).json({
          error: 'Story generation failed due to post-processing errors',
          details: finalValidation.errors,
          suggestion: 'This is a bug in Story UI. Please report this issue with your prompt.',
          validation: {
            hasWarnings: true,
            errors: finalValidation.errors,
            warnings: ['Post-processing introduced syntax errors that could not be automatically fixed']
          }
        });
      }
    } else {
      logger.log('✅ Final validation passed after post-processing');
    }

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
    historyManager.addVersion(
      finalFileName,
      prompt,
      fixedFileContents,
      parentVersionId
    );

    logger.log(`Story ${isActualUpdate ? 'updated' : 'written'} to:`, outPath);

    // --- RUNTIME VALIDATION: Check if story loads in Storybook ---
    // This catches errors that static validation cannot detect, like CSF module loader errors
    let runtimeValidationResult = { success: true, storyExists: true } as Awaited<ReturnType<typeof validateStoryRuntime>>;
    let hasRuntimeError = false;

    if (isRuntimeValidationEnabled()) {
      logger.info('🔍 Running runtime validation...');
      try {
        runtimeValidationResult = await validateStoryRuntime(fixedFileContents, aiTitle, config.storyPrefix);

        if (!runtimeValidationResult.success) {
          hasRuntimeError = true;
          hasValidationWarnings = true;
          logger.error(`❌ Runtime validation failed: ${runtimeValidationResult.renderError}`);
          logger.error(`   Error type: ${runtimeValidationResult.errorType}`);

          // Format the error for potential future self-healing
          const runtimeErrorMessage = formatRuntimeErrorForHealing(runtimeValidationResult);
          logger.debug('Runtime error details:', runtimeErrorMessage);
        } else {
          logger.info('✅ Runtime validation passed - story loads correctly in Storybook');
        }
      } catch (runtimeErr: any) {
        // Don't fail the request if runtime validation itself fails (e.g., Storybook not running)
        logger.warn(`⚠️ Runtime validation could not complete: ${runtimeErr.message}`);
        logger.warn('   Story was saved but runtime status is unknown');
      }
    }

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
          logger.log(`🔀 Added redirect: ${oldStoryUrl} → ${newStoryUrl}`);
        }
      }
    }

    res.json({
      success: true,
      fileName: finalFileName,
      storyId,
      outPath,
      title: aiTitle,
      story: fileContents,
      storage: 'file-system',
      isUpdate: isActualUpdate,
      validation: {
        hasWarnings: hasValidationWarnings,
        errors: [...finalErrors.syntaxErrors, ...finalErrors.patternErrors, ...finalErrors.importErrors],
        warnings: [],
        selfHealingUsed,
        attempts
      },
      runtimeValidation: {
        enabled: isRuntimeValidationEnabled(),
        success: runtimeValidationResult.success,
        storyExists: runtimeValidationResult.storyExists,
        error: runtimeValidationResult.renderError,
        errorType: runtimeValidationResult.errorType,
        details: runtimeValidationResult.details
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Story generation failed' });
  }
}


/**
 * Extracts component names from story content
 */
function extractComponentsFromContent(content: string): string[] {
  const componentMatches = content.match(/<[A-Z][A-Za-z0-9]*\s/g);
  if (!componentMatches) return [];

  return Array.from(new Set(
    componentMatches.map(match => match.replace(/[<\s]/g, ''))
  ));
}
