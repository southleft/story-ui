import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { generateStory } from '../../story-generator/generateStory.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { discoverComponents } from '../../story-generator/componentDiscovery.js';
import { buildClaudePrompt as buildFlexiblePrompt } from '../../story-generator/promptGenerator.js';
import { loadUserConfig, validateConfig } from '../../story-generator/configLoader.js';
import { setupProductionGitignore } from '../../story-generator/productionGitignoreManager.js';
import { getInMemoryStoryService, GeneratedStory } from '../../story-generator/inMemoryStoryService.js';
import { extractAndValidateCodeBlock, createFallbackStory, validateStoryCode } from '../../story-generator/validateStory.js';
import { StoryTracker, StoryMapping } from '../../story-generator/storyTracker.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';

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
  return buildFlexiblePrompt(userPrompt, config, components);
}

// Enhanced function that includes conversation context
async function buildClaudePromptWithContext(userPrompt: string, config: any, conversation?: any[]) {
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();

  // If no conversation context, use the standard prompt
  if (!conversation || conversation.length <= 1) {
    return buildFlexiblePrompt(userPrompt, config, components);
  }

  // Extract conversation context for modifications
  const conversationContext = conversation
    .slice(0, -1) // Remove the current message (last one)
    .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n\n');

  // Get the base prompt
  const basePrompt = buildFlexiblePrompt(userPrompt, config, components);

  // Add conversation context to the prompt
  const contextualPrompt = basePrompt.replace(
    'User request:',
    `CONVERSATION CONTEXT (for modifications/updates):
${conversationContext}

IMPORTANT: The user is asking to modify/update the story based on the above conversation.
- Keep the SAME layout structure (number of columns, grid setup) unless explicitly asked to change it
- Only modify the specific aspects mentioned in the latest request
- Maintain the overall story concept from the original request

Current modification request:`
  );

  return contextualPrompt;
}

function slugify(str: string) {
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

async function callClaude(prompt: string): Promise<string> {
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
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  // Try to extract the main content
  return data?.content?.[0]?.text || data?.completion || '';
}

function cleanPromptForTitle(prompt: string): string {
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
  const aiText = await callClaude(titlePrompt);
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

function fileNameFromTitle(title: string, hash: string): string {
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

    // Check if this is an update to an existing story
    const isUpdate = fileName && conversation && conversation.length > 2;

    // Build prompt with conversation context if available
    const fullPrompt = await buildClaudePromptWithContext(prompt, config, conversation);
    console.log('Layout configuration:', JSON.stringify(config.layoutRules, null, 2));
    console.log('Claude prompt:', fullPrompt);
    const aiText = await callClaude(fullPrompt);
    console.log('Claude raw response:', aiText);

    // Use the new robust validation system
    const validationResult = extractAndValidateCodeBlock(aiText);

    let fileContents: string;
    let hasValidationWarnings = false;

    if (!validationResult.isValid) {
      console.error('Generated code validation failed:', validationResult.errors);

      // If we have fixedCode, use it
      if (validationResult.fixedCode) {
        fileContents = validationResult.fixedCode;
        hasValidationWarnings = true;
        console.log('Using auto-fixed code with warnings:', validationResult.warnings);
      } else {
        // Create fallback story
        console.log('Creating fallback story due to validation failure');
        fileContents = createFallbackStory(prompt, config);
        hasValidationWarnings = true;
      }
    } else {
      // Extract the validated code
      const codeMatch = aiText.match(/```(?:tsx|jsx|typescript|ts|js|javascript)?\s*([\s\S]*?)\s*```/i);
      if (codeMatch) {
        fileContents = codeMatch[1].trim();
      } else {
        const importIdx = aiText.indexOf('import');
        fileContents = importIdx !== -1 ? aiText.slice(importIdx).trim() : aiText.trim();
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
    const fixedFileContents = fileContents.replace(
      /(export default \{\s*\n\s*title:\s*["'])([^"']+)(["'])/,
      (match, p1, _p2, p3) => {
        const title = config.storyPrefix + prettyPrompt;
        return p1 + title + p3;
      }
    );

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
      const outPath = generateStory({ fileContents: fixedFileContents, fileName: finalFileName });

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
 * Extracts component names from story content
 */
function extractComponentsFromContent(content: string): string[] {
  const componentMatches = content.match(/<[A-Z][A-Za-z0-9]*\s/g);
  if (!componentMatches) return [];

  return Array.from(new Set(
    componentMatches.map(match => match.replace(/[<\s]/g, ''))
  ));
}
