/**
 * Shared helper functions for story generation routes.
 * These utilities are used by both generateStory.ts and generateStoryStream.ts
 * to eliminate code duplication and ensure consistent behavior.
 */

import { logger } from '../../story-generator/logger.js';
import {
  chatCompletion,
  generateTitle as llmGenerateTitle,
  isProviderConfigured,
  getProviderInfo,
  chatCompletionWithImages,
  buildMessageWithImages
} from '../../story-generator/llm-providers/story-llm-service.js';
import { ImageContent } from '../../story-generator/llm-providers/types.js';

/**
 * Slugify a string for use in filenames and identifiers.
 */
export function slugify(str: string): string {
  if (!str || typeof str !== 'string') {
    return 'untitled';
  }
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract code block from LLM response text.
 * Accepts various language identifiers (tsx, jsx, typescript, etc.)
 */
export function extractCodeBlock(text: string): string | null {
  const codeBlock = text.match(/```(?:tsx|jsx|typescript|ts|js|javascript)?([\s\S]*?)```/i);
  return codeBlock ? codeBlock[1].trim() : null;
}

/**
 * Call the LLM service with optional vision support.
 * Automatically handles provider configuration and image attachment.
 */
export async function callLLM(
  messages: { role: 'user' | 'assistant'; content: string }[],
  images?: ImageContent[]
): Promise<string> {
  if (!isProviderConfigured()) {
    throw new Error('No LLM provider configured. Please set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
  }

  const providerInfo = getProviderInfo();
  logger.debug(`Using ${providerInfo.currentProvider} (${providerInfo.currentModel}) for story generation`);

  if (images && images.length > 0) {
    if (!providerInfo.supportsVision) {
      throw new Error(`${providerInfo.currentProvider} does not support vision. Please configure a vision-capable provider.`);
    }

    logger.log(`🖼️ Using vision-capable chat with ${images.length} image(s)`);

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

/**
 * Clean a user prompt to create a readable title.
 * Removes common leading phrases and normalizes formatting.
 */
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

  return cleaned
    .replace(/[^\w\s'"?!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Generate a title using the LLM service.
 * Falls back to empty string on failure.
 */
export async function getLLMTitle(userPrompt: string): Promise<string> {
  try {
    return await llmGenerateTitle(userPrompt);
  } catch (error) {
    logger.warn('Failed to generate title via LLM, using fallback', { error });
    return '';
  }
}

/**
 * Escape a title string for use in TypeScript string literals.
 */
export function escapeTitleForTS(title: string): string {
  return title
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Extract component imports from code for a specific import path.
 */
export function extractImportsFromCode(code: string, importPath: string): string[] {
  const imports: string[] = [];
  const escapedPath = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importRegex = new RegExp(`import\\s*{([^}]+)}\\s*from\\s*['"]${escapedPath}['"]`, 'g');

  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const importList = match[1];
    const components = importList.split(',').map(comp => comp.trim());
    imports.push(...components);
  }

  return imports;
}

/**
 * Generate a filename from a story title and hash.
 * @param title - The story title
 * @param hash - The unique hash for the story
 * @param extension - The file extension (e.g., '.stories.tsx' or '.stories.ts')
 */
export function fileNameFromTitle(title: string, hash: string, extension: string = '.stories.tsx'): string {
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

/**
 * Find a similar icon name from the allowed icons set.
 * Used for providing suggestions when an invalid icon is used.
 */
export function findSimilarIcon(iconName: string, allowedIcons: Set<string>): string | null {
  if (!iconName || typeof iconName !== 'string') {
    return null;
  }

  const iconLower = iconName.toLowerCase();

  for (const allowed of allowedIcons) {
    const allowedLower = allowed.toLowerCase();

    // Check if core words match
    if (iconLower.includes('commit') && allowedLower.includes('commit')) return allowed;
    if (iconLower.includes('branch') && allowedLower.includes('branch')) return allowed;
    if (iconLower.includes('merge') && allowedLower.includes('merge')) return allowed;
    if (iconLower.includes('pull') && allowedLower.includes('pull')) return allowed;
    if (iconLower.includes('push') && allowedLower.includes('push')) return allowed;
    if (iconLower.includes('star') && allowedLower.includes('star')) return allowed;
    if (iconLower.includes('user') && allowedLower.includes('user')) return allowed;
    if (iconLower.includes('search') && allowedLower.includes('search')) return allowed;
    if (iconLower.includes('settings') && allowedLower.includes('settings')) return allowed;
    if (iconLower.includes('home') && allowedLower.includes('home')) return allowed;
  }

  return null;
}

/**
 * Creates a framework-aware fallback story when generation fails.
 * Uses the adapter to generate framework-appropriate code.
 */
export function createFrameworkAwareFallbackStory(
  prompt: string,
  config: any,
  framework: string
): string {
  const title = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
  const escapedTitle = title.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const storyPrefix = config.storyPrefix || 'Generated/';

  // Framework-specific fallback templates
  switch (framework) {
    case 'vue':
      return `import type { Meta, StoryObj } from '@storybook/vue3';

// Fallback story generated due to AI generation error
const meta: Meta = {
  title: '${storyPrefix}${escapedTitle}',
  parameters: {
    docs: {
      description: {
        story: 'This is a fallback story created when the AI generation failed due to syntax errors.'
      }
    }
  }
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: \`
      <div style="padding: 2rem; text-align: center; border: 2px dashed #ccc; border-radius: 8px;">
        <h2>Story Generation Error</h2>
        <p>The AI-generated story contained syntax errors and could not be created.</p>
        <p><strong>Original prompt:</strong> ${escapedTitle}</p>
        <p>Please try rephrasing your request.</p>
      </div>
    \`
  })
};`;

    case 'angular':
      return `import type { Meta, StoryObj } from '@storybook/angular';

// Fallback story generated due to AI generation error
const meta: Meta = {
  title: '${storyPrefix}${escapedTitle}',
  parameters: {
    docs: {
      description: {
        story: 'This is a fallback story created when the AI generation failed due to syntax errors.'
      }
    }
  }
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: \`
      <div style="padding: 2rem; text-align: center; border: 2px dashed #ccc; border-radius: 8px;">
        <h2>Story Generation Error</h2>
        <p>The AI-generated story contained syntax errors and could not be created.</p>
        <p><strong>Original prompt:</strong> ${escapedTitle}</p>
        <p>Please try rephrasing your request.</p>
      </div>
    \`
  })
};`;

    case 'svelte':
      return `import type { Meta, StoryObj } from '@storybook/svelte';

// Fallback story generated due to AI generation error
const meta: Meta = {
  title: '${storyPrefix}${escapedTitle}',
  parameters: {
    docs: {
      description: {
        story: 'This is a fallback story created when the AI generation failed due to syntax errors.'
      }
    }
  }
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    Component: null,
    props: {}
  })
};`;

    case 'web-components':
      return `import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';

// Fallback story generated due to AI generation error
const meta: Meta = {
  title: '${storyPrefix}${escapedTitle}',
  parameters: {
    docs: {
      description: {
        story: 'This is a fallback story created when the AI generation failed due to syntax errors.'
      }
    }
  }
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => html\`
    <div style="padding: 2rem; text-align: center; border: 2px dashed #ccc; border-radius: 8px;">
      <h2>Story Generation Error</h2>
      <p>The AI-generated story contained syntax errors and could not be created.</p>
      <p><strong>Original prompt:</strong> ${escapedTitle}</p>
      <p>Please try rephrasing your request.</p>
    </div>
  \`
};`;

    case 'react':
    default:
      const storybookFramework = config.storybookFramework || '@storybook/react';
      return `import React from 'react';
import type { StoryObj } from '${storybookFramework}';

// Fallback story generated due to AI generation error
export default {
  title: '${storyPrefix}${escapedTitle}',
  component: () => (
    <div style={{ padding: '2rem', textAlign: 'center', border: '2px dashed #ccc', borderRadius: '8px' }}>
      <h2>Story Generation Error</h2>
      <p>The AI-generated story contained syntax errors and could not be created.</p>
      <p><strong>Original prompt:</strong> ${escapedTitle}</p>
      <p>Please try rephrasing your request or contact support.</p>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'This is a fallback story created when the AI generation failed due to syntax errors.'
      }
    }
  }
};

export const Default: StoryObj = {
  args: {}
};`;
  }
}
