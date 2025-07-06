import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { generateStory } from '../../story-generator/generateStory.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { discoverComponents } from '../../story-generator/componentDiscovery.js';
import { buildClaudePrompt as buildFlexiblePrompt } from '../../story-generator/promptGenerator.js';
import { loadUserConfig, validateConfig } from '../../story-generator/configLoader.js';
import { setupProductionGitignore } from '../../story-generator/productionGitignoreManager.js';
import { getInMemoryStoryService, GeneratedStory } from '../../story-generator/inMemoryStoryService.js';
import { extractAndValidateCodeBlock, createFallbackStory } from '../../story-generator/validateStory.js';
import { isBlacklistedComponent, isBlacklistedIcon, getBlacklistErrorMessage, ICON_CORRECTIONS } from '../../story-generator/componentBlacklist.js';
import { StoryTracker, StoryMapping } from '../../story-generator/storyTracker.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import { getDocumentation, isDeprecatedComponent, getComponentReplacement } from '../../story-generator/documentation-sources.js';
import { postProcessStory } from '../../story-generator/postProcessStory.js';
import { validateStory, ValidationError } from '../../story-generator/storyValidator.js';
import { StoryHistoryManager } from '../../story-generator/storyHistory.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

// Legacy constants - now using dynamic discovery
const COMPONENT_LIST: string[] = [];

const SAMPLE_STORY = '';

// Legacy component reference - now using dynamic discovery
const COMPONENT_REFERENCE = '';



// Legacy function - now uses flexible system with enhanced discovery
async function buildClaudePrompt(userPrompt: string) {
  const config = loadUserConfig();
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();
  return await buildFlexiblePrompt(userPrompt, config, components);
}

// Enhanced function that includes conversation context and previous code
async function buildClaudePromptWithContext(
  userPrompt: string, 
  config: any, 
  conversation?: any[],
  previousCode?: string
) {
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();

  // Always start with component discovery as the authoritative source
  console.log(`📦 Discovered ${components.length} components from ${config.importPath}`);
  const availableComponents = components.map(c => c.name).join(', ');
  console.log(`✅ Available components: ${availableComponents}`);

  // Build base prompt with discovered components (always required)
  let prompt = await buildFlexiblePrompt(userPrompt, config, components);

// Try to enhance with bundled documentation for usage patterns and design tokens
  console.log('📋 Using bundled documentation for enhancement');
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

async function callClaude(messages: { role: 'user' | 'assistant', content: string }[]): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('Claude API key not set');
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages,
    }),
  });
  const data = await response.json();
  // Try to extract the main content
  return data?.content?.[0]?.text || data?.completion || '';
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

async function getClaudeTitle(userPrompt: string): Promise<string> {
  const titlePrompt = [
    "Given the following UI description, generate a short, clear, human-friendly title suitable for a Storybook navigation item.",
    "Requirements:",
    "- Do not include words like 'Generate', 'Build', or 'Create'",
    "- Keep it under 50 characters",
    "- Use simple, clear language",
    "- Avoid special characters that could break code (use letters, numbers, spaces, hyphens, and basic punctuation only)",
    '',
    'UI description:',
    userPrompt,
    '',
    'Title:'
  ].join('\n');
  const aiText = await callClaude([{ role: 'user', content: titlePrompt }]);
  // Take the first non-empty line, trim, and remove quotes if present
  const lines = aiText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    let title = lines[0].replace(/^['\"]|['\"]$/g, '').trim();

    // Additional sanitization for safety
    title = title
      .replace(/[^\w\s'"?!-]/g, ' ')  // Remove problematic characters
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .trim()
      .slice(0, 50);                  // Limit length

    return title;
  }
  return '';
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
  const { prompt, fileName, conversation } = req.body;
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

    // Set up production-ready environment
    const gitignoreManager = setupProductionGitignore(config);
    const storyService = getInMemoryStoryService(config);
    const isProduction = gitignoreManager.isProductionMode();

    // Initialize story tracker for managing updates vs new creations
    const storyTracker = new StoryTracker(config);
    
    // Initialize history manager - use the current working directory
    const historyManager = new StoryHistoryManager(process.cwd());

    // Check if this is an update to an existing story
    const isUpdate = fileName && conversation && conversation.length > 2;
    
    // Get previous code if this is an update
    let previousCode: string | undefined;
    let parentVersionId: string | undefined;
    
    if (isUpdate && fileName) {
      const currentVersion = historyManager.getCurrentVersion(fileName);
      if (currentVersion) {
        previousCode = currentVersion.code;
        parentVersionId = currentVersion.id;
        console.log('🔄 Found previous version for iteration');
      }
    }

    // --- Start of Validation and Retry Loop ---
    let aiText = '';
    let validationErrors: ValidationError[] = [];
    const maxRetries = 3;
    let attempts = 0;

    const initialPrompt = await buildClaudePromptWithContext(prompt, config, conversation, previousCode);
    const messages: { role: 'user' | 'assistant', content: string }[] = [{ role: 'user', content: initialPrompt }];

    while (attempts < maxRetries) {
      attempts++;
      console.log(`--- Story Generation Attempt ${attempts} ---`);

      const claudeResponse = await callClaude(messages);
      const extractedCode = extractCodeBlock(claudeResponse);

      if (!extractedCode) {
        aiText = claudeResponse; // Use raw response if no code block
        if (attempts < maxRetries) {
          console.log('No code block found, retrying...');
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
        console.log('✅ Validation successful!');
        break; // Exit loop on success
      }

      console.log(`❌ Validation failed with ${validationErrors.length} errors:`);
      validationErrors.forEach(err => console.log(`  - Line ${err.line}: ${err.message}`));

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

    console.log('Claude final response:', aiText);

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

    console.log('Validation result:', {
      isValid: validationResult.isValid,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      hasFixedCode: !!validationResult.fixedCode
    });

    if (!validationResult.isValid && !validationResult.fixedCode) {
      console.error('Generated code validation failed:', validationResult.errors);

      // Create fallback story only if we can't fix the code
      console.log('Creating fallback story due to validation failure');
      fileContents = createFallbackStory(prompt, config);
      hasValidationWarnings = true;
    } else {
      // Use fixed code if available, otherwise use the extracted code
      if (validationResult.fixedCode) {
        fileContents = validationResult.fixedCode;
        hasValidationWarnings = true;
        console.log('Using auto-fixed code');
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
        console.log('Validation warnings:', validationResult.warnings);
      }
    }

    if (!fileContents) {
      console.error('No valid code could be extracted or generated.');
      return res.status(500).json({ error: 'Failed to generate valid TypeScript code.' });
    }

    // CRITICAL: Ensure React import exists but avoid duplicates
    if (!fileContents.includes("import React from 'react';")) {
      fileContents = "import React from 'react';\n" + fileContents;
    }

    // Post-processing is now consolidated to run once on the final code
    let fixedFileContents = postProcessStory(fileContents, config.importPath);

    // Generate title based on conversation context
    let aiTitle;
    if (isUpdate) {
      // For updates, try to keep the original title or modify it slightly
      const originalPrompt = conversation.find((msg: any) => msg.role === 'user')?.content || prompt;
      aiTitle = await getClaudeTitle(originalPrompt);
    } else {
      aiTitle = await getClaudeTitle(prompt);
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
        const title = config.storyPrefix + prettyPrompt;
        return p1 + title + p3;
      }
    );

    // Fallback: export default { title: "..." } format
    if (!fixedFileContents.includes(config.storyPrefix)) {
      fixedFileContents = fixedFileContents.replace(
        /(export\s+default\s*\{[\s\S]*?title:\s*["'])([^"']+)(["'])/,
        (match, p1, oldTitle, p3) => {
          const title = config.storyPrefix + prettyPrompt;
          return p1 + title + p3;
        }
      );
    }

    // Check if there's an existing story with this title or prompt
    const existingByTitle = storyTracker.findByTitle(aiTitle);
    const existingByPrompt = storyTracker.findByPrompt(prompt);
    const existingStory = existingByTitle || existingByPrompt;

    // Generate unique ID and filename
    let hash, finalFileName, storyId;
    let isActuallyUpdate = false;

    if (existingStory) {
      // Use existing story's details to update instead of creating duplicate
      console.log(`Found existing story "${existingStory.title}" - updating instead of creating new`);
      hash = existingStory.hash;
      finalFileName = existingStory.fileName;
      storyId = existingStory.storyId;
      isActuallyUpdate = true;
    } else if (isUpdate && fileName) {
      // For conversation-based updates, use existing fileName and ID
      finalFileName = fileName;
      // Extract hash from existing fileName if possible
      const hashMatch = fileName.match(/-([a-f0-9]{8})(?:\.stories\.tsx)?$/);
      hash = hashMatch ? hashMatch[1] : crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
      storyId = `story-${hash}`;
      isActuallyUpdate = true;
    } else {
      // For new stories, generate new IDs
      hash = crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8);
      finalFileName = fileName || fileNameFromTitle(aiTitle, hash);
      storyId = `story-${hash}`;
    }

    if (isProduction) {
      // Production: Store in memory
      const generatedStory: GeneratedStory = {
        id: storyId,
        title: aiTitle,
        description: isActuallyUpdate ? `Updated: ${prompt}` : prompt,
        content: fixedFileContents,
        createdAt: isActuallyUpdate ? (new Date()) : new Date(),
        lastAccessed: new Date(),
        prompt: isActuallyUpdate ? conversation.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n\n') : prompt,
        components: extractComponentsFromContent(fixedFileContents)
      };

      storyService.storeStory(generatedStory);

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

      console.log(`Story ${isActuallyUpdate ? 'updated' : 'stored'} in memory: ${storyId}`);
      res.json({
        success: true,
        fileName: finalFileName,
        storyId,
        title: aiTitle,
        story: fileContents,
        environment: 'production',
        storage: 'in-memory',
        isUpdate: isActuallyUpdate,
        validation: {
          hasWarnings: hasValidationWarnings,
          errors: validationResult?.errors || [],
          warnings: validationResult?.warnings || []
        }
      });
    } else {
      // Development: Write to file system
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

      console.log(`Story ${isActuallyUpdate ? 'updated' : 'written'} to:`, outPath);
      res.json({
        success: true,
        fileName: finalFileName,
        outPath,
        title: aiTitle,
        story: fileContents,
        environment: 'development',
        storage: 'file-system',
        isUpdate: isActuallyUpdate,
        validation: {
          hasWarnings: hasValidationWarnings,
          errors: validationResult?.errors || [],
          warnings: validationResult?.warnings || []
        }
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Story generation failed' });
  }
}

/**
 * Fixes inline styles in the generated story content
 * Converts React camelCase style properties to kebab-case CSS properties
 */
function fixInlineStyles(content: string): string {
  // This function is now superseded by the validator and postProcessStory
  // but can be kept for other potential style cleanups if needed.
  // For now, the main logic is in the validator.
  return content;
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
