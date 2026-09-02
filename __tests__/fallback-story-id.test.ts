/**
 * A failed generation must not take down the Storybook.
 *
 * The fallback story written when generation fails carried no `id`, so
 * Storybook derived one from the TITLE — and that title is the user's prompt
 * truncated to 50 characters. Two failures on similar prompts produced
 * identical ids, Storybook refused to index the project, and the ENTIRE
 * environment went down with a "Duplicate stories with id" build error.
 *
 * Observed on Atlassian: two attempts at the same panel made every other story
 * unreachable. A generation failure became an environment failure, which is
 * the same shape as the voice-canvas template that broke Vite for projects
 * without react-live.
 */

import { describe, it, expect } from 'vitest';
import { createFrameworkAwareFallbackStory } from '../mcp-server/routes/storyHelpers.js';

const config = { storyPrefix: 'Generated/' };

// The real collision: two different prompts that truncate to the same title.
const promptA = '"People" panel of a team settings page top an invite form with an email field and toggles';
const promptB = '"People" panel of a team settings page top an invite list with avatars and a remove action';
const titleOf = (p: string) => p.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 60);

describe('fallback story ids', () => {
  it('emits an explicit id so Storybook cannot derive one from the title', () => {
    const code = createFrameworkAwareFallbackStory(promptA, titleOf(promptA), config, 'react', 'fallback-abc12345');
    expect(code).toContain("id: 'fallback-abc12345'");
  });

  it('gives two failures on near-identical prompts different ids', () => {
    const a = createFrameworkAwareFallbackStory(promptA, titleOf(promptA), config, 'react', 'fallback-aaaa1111');
    const b = createFrameworkAwareFallbackStory(promptB, titleOf(promptB), config, 'react', 'fallback-bbbb2222');

    // The titles genuinely collide once truncated — that is the bug's premise.
    const titleA = a.match(/title: '([^']*)'/)?.[1];
    const titleB = b.match(/title: '([^']*)'/)?.[1];
    expect(titleA).toBe(titleB);

    // The ids must not.
    expect(a.match(/id: '([^']*)'/)?.[1]).not.toBe(b.match(/id: '([^']*)'/)?.[1]);
  });

  it('still produces a valid story when no id is supplied', () => {
    // Callers that predate the parameter must keep working rather than emit
    // a broken `id:` line.
    const code = createFrameworkAwareFallbackStory(promptA, titleOf(promptA), config, 'react');
    expect(code).not.toContain('id:');
    expect(code).toContain('title:');
  });

  it('carries the id across every framework template', () => {
    // The collision is not React-specific; a Vue or Svelte project fails the
    // same way, and only one of five templates having the fix would hide it.
    for (const framework of ['react', 'vue', 'svelte', 'angular', 'web-components']) {
      const code = createFrameworkAwareFallbackStory(promptA, titleOf(promptA), config, framework, 'fallback-xyz99999');
      expect(code, `${framework} template`).toContain('fallback-xyz99999');
    }
  });
});
