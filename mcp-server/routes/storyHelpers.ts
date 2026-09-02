/**
 * The fallback story a failed generation writes, and the check that recognises
 * one on disk. Used by generationCore; the title/filename/code-extraction
 * helpers that once lived here are private to generationCore now.
 */

/**
 * Sentinel comment emitted by every framework's fallback template below.
 *
 * The disk file has to be detectable as a fallback even when history is
 * empty: a failed generation writes the placeholder AND records it as a
 * version, so the user's follow-up "try again" arrives as an update whose
 * baseline is the placeholder. Divergence from an error box is ~1.0 by
 * construction — a fresh build over it is the DESIRED outcome, not a rewrite
 * to block.
 */
const FALLBACK_STORY_MARKER = 'Fallback story generated due to AI generation error';

/** Is this code one of the fallback placeholders below, whatever the framework? */
export function isFallbackStoryCode(code: string): boolean {
  return code.includes(FALLBACK_STORY_MARKER);
}

/**
 * Creates a framework-aware fallback story when generation fails.
 * Uses the adapter to generate framework-appropriate code.
 * @param prompt - The original user prompt (used in error message)
 * @param displayTitle - The properly formatted title for the story (with proper casing)
 * @param config - The story-ui config
 * @param framework - The target framework
 */
export function createFrameworkAwareFallbackStory(
  prompt: string,
  displayTitle: string,
  config: any,
  framework: string,
  /**
   * A unique story id for this fallback.
   *
   * Without one Storybook derives the id from the TITLE, and the title here is
   * the prompt truncated to 50 characters. Two failures on similar prompts
   * therefore produced identical ids, Storybook refused to index the project,
   * and the ENTIRE Storybook went down — not just the failed story. Observed
   * on Atlassian: two attempts at the same panel took the whole environment
   * with them, so a generation failure became an environment failure.
   */
  storyId?: string,
): string {
  // Use the displayTitle for the story title (properly cased)
  // Use the prompt for the "Original prompt" in the error message
  const truncatedTitle = displayTitle.length > 50 ? displayTitle.substring(0, 50) + '...' : displayTitle;
  const escapedTitle = truncatedTitle.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const storyPrefix = config.storyPrefix || 'Generated/';
  // Emitted next to the title so the id can never be derived from it.
  const idLine = storyId ? `\n  id: '${storyId.replace(/'/g, "")}',` : '';

  // Framework-specific fallback templates
  switch (framework) {
    case 'vue':
      return `import type { Meta, StoryObj } from '@storybook/vue3';

// Fallback story generated due to AI generation error
const meta: Meta = {
  title: '${storyPrefix}${escapedTitle}',${idLine}
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
        <p><strong>Original prompt:</strong> ${escapedPrompt}</p>
        <p>Please try rephrasing your request.</p>
      </div>
    \`
  })
};`;

    case 'angular':
      return `import type { Meta, StoryObj } from '@storybook/angular';

// Fallback story generated due to AI generation error
const meta: Meta = {
  title: '${storyPrefix}${escapedTitle}',${idLine}
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
        <p><strong>Original prompt:</strong> ${escapedPrompt}</p>
        <p>Please try rephrasing your request.</p>
      </div>
    \`
  })
};`;

    case 'svelte':
      // Use native .stories.svelte format with defineMeta for addon-svelte-csf v5+
      return `<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';

  // Fallback story generated due to AI generation error
  const { Story } = defineMeta({
    title: '${storyPrefix}${escapedTitle}',${idLine}
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          story: 'This is a fallback story created when the AI generation failed due to syntax errors.'
        }
      }
    }
  });
</script>

<Story name="Error">
  <div style="padding: 2rem; text-align: center; border: 2px dashed #ccc; border-radius: 8px;">
    <h2 style="color: #374151; margin-bottom: 1rem;">Story Generation Error</h2>
    <p style="color: #6b7280;">The AI-generated story contained syntax errors and could not be created.</p>
    <p style="color: #6b7280;"><strong>Original prompt:</strong> ${escapedPrompt}</p>
    <p style="color: #6b7280;">Please try rephrasing your request.</p>
  </div>
</Story>`;

    case 'web-components':
      return `import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';

// Fallback story generated due to AI generation error
const meta: Meta = {
  title: '${storyPrefix}${escapedTitle}',${idLine}
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
      <p><strong>Original prompt:</strong> ${escapedPrompt}</p>
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
  title: '${storyPrefix}${escapedTitle}',${idLine}
  component: () => (
    <div style={{ padding: '2rem', textAlign: 'center', border: '2px dashed #ccc', borderRadius: '8px' }}>
      <h2>Story Generation Error</h2>
      <p>The AI-generated story contained syntax errors and could not be created.</p>
      <p><strong>Original prompt:</strong> ${escapedPrompt}</p>
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
