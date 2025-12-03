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
import { extractAndValidateCodeBlock, createFallbackStory, validateStoryCode } from '../../story-generator/validateStory.js';
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



// Legacy function - now uses flexible system with enhanced discovery
async function buildClaudePrompt(userPrompt: string) {
  const config = loadUserConfig();
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();
  return await buildFlexiblePrompt(userPrompt, config, components);
}

// Enhanced function that includes conversation context and previous code
// Now supports multi-framework prompt generation and vision-aware prompts
async function buildClaudePromptWithContext(
  userPrompt: string,
  config: any,
  conversation?: any[],
  previousCode?: string,
  options?: {
    framework?: FrameworkType;
    autoDetectFramework?: boolean;
    visionMode?: VisionPromptType;
    designSystem?: string;
  }
) {
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();

  // Determine if we should use framework-aware prompts
  let useFrameworkAware = false;
  let frameworkOptions: StoryGenerationOptions | undefined;

  if (options?.framework) {
    // Explicit framework specified in request
    useFrameworkAware = true;
    frameworkOptions = { framework: options.framework };
    logger.log(`📦 Using specified framework: ${options.framework}`);
  } else if (config.componentFramework || config.framework) {
    // Framework configured in story-ui.config.js
    const configFramework = (config.componentFramework || config.framework) as FrameworkType;
    useFrameworkAware = true;
    frameworkOptions = { framework: configFramework };
    logger.log(`📦 Using framework from config: ${configFramework}`);
  } else if (options?.autoDetectFramework) {
    // Auto-detect framework from project
    try {
      const detectedFramework = await detectProjectFramework(process.cwd());
      useFrameworkAware = true;
      frameworkOptions = { framework: detectedFramework };
      // CRITICAL: Also set config.componentFramework so validateStoryCode receives the correct framework
      // This ensures React imports are properly removed for non-React frameworks during post-processing
      config.componentFramework = detectedFramework;
      logger.log(`📦 Auto-detected framework: ${detectedFramework}`);
    } catch (error) {
      logger.warn('Failed to auto-detect framework, using React default', { error });
    }
  }

  // Always start with component discovery as the authoritative source
  logger.log(`📦 Discovered ${components.length} components from ${config.importPath}`);
  const availableComponents = components.map(c => c.name).join(', ');
  logger.log(`✅ Available components: ${availableComponents}`);

  // Build base prompt with discovered components (always required)
  // Use framework-aware prompt if configured, otherwise use legacy React prompt
  let prompt: string;
  if (useFrameworkAware && frameworkOptions) {
    prompt = await buildFrameworkAwarePrompt(userPrompt, config, components, frameworkOptions);
    logger.log(`🔧 Built framework-aware prompt for ${frameworkOptions.framework}`);
  } else {
    prompt = await buildFlexiblePrompt(userPrompt, config, components);
  }

  // Enhance prompt with vision-aware context if vision mode is provided
  if (options?.visionMode) {
    logger.log(`🔍 Enhancing prompt with vision mode: ${options.visionMode}`);
    const visionPrompts = buildVisionAwarePrompt({
      promptType: options.visionMode,
      userDescription: userPrompt,
      availableComponents: components.map(c => c.name),
      framework: frameworkOptions?.framework || 'react',
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

function fileNameFromTitle(title: string, hash: string): string {
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
  return `${base}-${hash}.stories.tsx`;
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

    // --- Start of Validation and Retry Loop ---
    let aiText = '';
    let validationErrors: ValidationError[] = [];
    const maxRetries = 3;
    let attempts = 0;

    // Build framework-aware options with vision support
    const frameworkOptions = {
      framework: framework as FrameworkType | undefined,
      autoDetectFramework: autoDetectFramework === true,
      visionMode: visionMode as VisionPromptType | undefined,
      designSystem: designSystem as string | undefined,
    };

    const initialPrompt = await buildClaudePromptWithContext(prompt, config, conversation, previousCode, frameworkOptions);
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

      validationErrors = validateStory(aiText);

      if (validationErrors.length === 0) {
        logger.log('✅ Validation successful!');
        break; // Exit loop on success
      }

      logger.log(`❌ Validation failed with ${validationErrors.length} errors:`);
      validationErrors.forEach(err => logger.log(`  - Line ${err.line}: ${err.message}`));

      if (attempts < maxRetries) {
        const errorFeedback = validationErrors
          .map(err => `- Line ${err.line}: ${err.message}`)
          .join('\n');

        const retryPrompt = `Your previous attempt failed validation with the following errors:\n${errorFeedback}\n\nPlease correct these issues and provide the full, valid story code. Do not use the forbidden patterns.`;

        messages.push({ role: 'assistant', content: claudeResponse });
        messages.push({ role: 'user', content: retryPrompt });
      }
    }

    if (validationErrors.length > 0) {
      console.error(`Story generation failed after ${maxRetries} attempts.`);
      // Optional: decide if you want to return an error or proceed with the last attempt
      // For now, we'll proceed with the last attempt and let the user see the result
    }
    // --- End of Validation and Retry Loop ---

    logger.log('Claude final response:', aiText);

    // Create enhanced component discovery for validation
    const discovery = new EnhancedComponentDiscovery(config);
    await discovery.discoverAll();

    // Pre-validate imports in the raw AI text to catch blacklisted components early
    const preValidation = await preValidateImports(aiText, config, discovery);
    
    if (!preValidation.isValid) {
      console.error('Pre-validation failed - blacklisted components detected:', preValidation.errors);

      // Return error immediately without creating file
      return res.status(400).json({
        error: 'Generated code contains invalid imports',
        details: preValidation.errors,
        suggestion: 'The AI tried to use components that do not exist. Please try rephrasing your request using basic components like Box, Stack, Header, Button, etc.'
      });
    }

    // Use the new robust validation system
    const validationResult = extractAndValidateCodeBlock(aiText, config);

    let fileContents: string;
    let hasValidationWarnings = false;

    logger.log('Validation result:', {
      isValid: validationResult.isValid,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      hasFixedCode: !!validationResult.fixedCode
    });

    if (!validationResult.isValid && !validationResult.fixedCode) {
      console.error('Generated code validation failed:', validationResult.errors);

      // Create fallback story only if we can't fix the code
      logger.log('Creating fallback story due to validation failure');
      fileContents = createFallbackStory(prompt, config);
      hasValidationWarnings = true;
    } else {
      // Use fixed code if available, otherwise use the extracted code
      if (validationResult.fixedCode) {
        fileContents = validationResult.fixedCode;
        hasValidationWarnings = true;
        logger.log('Using auto-fixed code');
      } else {
        // Extract the validated code
        const codeMatch = aiText.match(/```(?:tsx|jsx|typescript|ts|js|javascript)?\s*([\s\S]*?)\s*```/i);
        if (codeMatch) {
          fileContents = codeMatch[1].trim();
        } else {
          // Fallback: extract from import to end of valid TypeScript
          const importIdx = aiText.indexOf('import');
          if (importIdx !== -1) {
            fileContents = aiText;
          } else {
            fileContents = aiText.trim();
          }
        }
      }

      if (validationResult.warnings && validationResult.warnings.length > 0) {
        hasValidationWarnings = true;
        logger.log('Validation warnings:', validationResult.warnings);
      }
    }

    if (!fileContents) {
      console.error('No valid code could be extracted or generated.');
      return res.status(500).json({ error: 'Failed to generate valid TypeScript code.' });
    }

    // Determine the framework being used (priority: request > config.componentFramework > config.framework > auto-detect > default)
    // CRITICAL: Check config.componentFramework BEFORE config.framework - many projects use componentFramework (not framework)
    const detectedFramework = frameworkOptions.framework ||
                              config.componentFramework as FrameworkType ||
                              config.framework as FrameworkType ||
                              (frameworkOptions.autoDetectFramework ? await detectProjectFramework(process.cwd()).catch(() => 'react' as FrameworkType) : 'react' as FrameworkType);

    logger.log(`🎯 Framework detection: request=${frameworkOptions.framework}, config=${config.framework}, detected=${detectedFramework}`);

    // Get the framework adapter for post-processing
    const frameworkAdapter = getAdapter(detectedFramework);

    // Only add React import for React framework
    if (detectedFramework === 'react' && !fileContents.includes("import React from 'react';")) {
      fileContents = "import React from 'react';\n" + fileContents;
    }

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

    // Escape the title for TypeScript
    const prettyPrompt = escapeTitleForTS(aiTitle);

    // Fix title with storyPrefix - handle both single-line and multi-line formats
    fixedFileContents = fixedFileContents.replace(
      /(const\s+meta\s*=\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
      (match, p1, oldTitle, p3) => {
        // Check if the title already has the prefix to avoid double prefixing
        const titleToUse = prettyPrompt.startsWith(config.storyPrefix) 
          ? prettyPrompt 
          : config.storyPrefix + prettyPrompt;
        return p1 + titleToUse + p3;
      }
    );

    // Fallback: export default { title: "..." } format
    if (!fixedFileContents.includes(config.storyPrefix)) {
      fixedFileContents = fixedFileContents.replace(
        /(export\s+default\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
        (match, p1, oldTitle, p3) => {
          // Check if the title already has the prefix to avoid double prefixing
          const titleToUse = prettyPrompt.startsWith(config.storyPrefix)
            ? prettyPrompt
            : config.storyPrefix + prettyPrompt;
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

    // Check if this is an update to an existing story
    // ONLY consider it an update if we're in the same conversation context
    let existingStory = null;
    if (isActualUpdate && fileName) {
      // When updating within a conversation, look for the story by fileName
      existingStory = storyTracker.findByTitle(aiTitle);
      if (existingStory && existingStory.fileName !== fileName) {
        // If found story has different fileName, it's not the same story
        existingStory = null;
      }
    }
    // Remove the automatic "find by prompt" logic that was preventing duplicates

    // Generate unique ID and filename
    let hash, finalFileName, storyId;

    if (isActualUpdate && (fileName || providedStoryId)) {
      // For updates, preserve the existing fileName and ID
      // Ensure the filename has the proper .stories.tsx extension
      // FIX: Handle case where fileName is undefined but providedStoryId exists
      if (fileName) {
        finalFileName = fileName;
      } else if (providedStoryId) {
        // Generate filename from storyId when fileName not provided
        finalFileName = `${providedStoryId}.stories.tsx`;
        logger.log('📝 Generated filename from storyId:', finalFileName);
      }
      if (finalFileName && !finalFileName.endsWith('.stories.tsx')) {
        finalFileName = finalFileName + '.stories.tsx';
      }
      
      // Use provided storyId or extract from fileName
      if (providedStoryId) {
        storyId = providedStoryId;
        // Extract hash from storyId
        const hashMatch = providedStoryId.match(/^story-([a-f0-9]{8})$/);
        hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
      } else {
        // Extract hash from existing fileName if possible
        const hashMatch = fileName.match(/-([a-f0-9]{8})(?:\.stories\.tsx)?$/);
        hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
        storyId = `story-${hash}`;
      }
      
      logger.log('📌 Preserving story identity for update:', { storyId, fileName: finalFileName });
    } else {
      // For new stories, ALWAYS generate new IDs with timestamp to ensure uniqueness
      const timestamp = Date.now();
      hash = crypto.createHash('sha1').update(prompt + timestamp).digest('hex').slice(0, 8);
      finalFileName = fileName || fileNameFromTitle(aiTitle, hash);
      storyId = `story-${hash}`;
      logger.log('🆕 Creating new story:', { storyId, fileName: finalFileName });
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
        errors: validationResult?.errors || [],
        warnings: validationResult?.warnings || []
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
