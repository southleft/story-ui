/**
 * Integration tests for the full generation pipeline (generationCore).
 *
 * Everything runs for real — config loading, component discovery, prompt
 * assembly, validation, import isolation, self-healing, post-processing,
 * file write, manifest and history persistence — against a temp fixture
 * project. Only the LLM boundary (story-llm-service) is mocked, with a FIFO
 * queue of scripted responses so each test controls exactly what "the model"
 * returns on every attempt.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import { createFixtureProject, validStoryResponse, FixtureProject, FIXTURE_LIB } from './helpers/fixtureProject.js';

const llm = vi.hoisted(() => ({
  queue: [] as Array<{ content: string; truncated?: boolean }>,
  calls: [] as Array<Array<{ role: string; content: string }>>,
}));

vi.mock('../../story-generator/llm-providers/story-llm-service.js', () => ({
  chatCompletionDetailed: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    const first = typeof messages[0]?.content === 'string' ? messages[0].content : '';
    // The post-generation conversational summary is a separate LLM call —
    // answer it out-of-band so it never consumes the scripted queue.
    if (first.includes('You are Story UI, an assistant that just')) {
      return {
        content: 'I put together the layout you asked for.\nSUGGESTIONS:\nMake the button larger\nAdd a second card\nCenter the content',
        truncated: false,
      };
    }
    llm.calls.push(messages.map(m => ({ role: m.role, content: m.content })));
    const next = llm.queue.shift();
    if (!next) throw new Error('Mock LLM queue exhausted — test did not script enough responses');
    return { content: next.content, truncated: !!next.truncated };
  }),
  chatCompletion: vi.fn(async () => ''),
  chatCompletionStream: vi.fn(),
  chatCompletionWithImages: vi.fn(async () => { throw new Error('vision not used in these tests'); }),
  buildMessageWithImages: vi.fn((content: string) => content),
  generateTitle: vi.fn(async () => 'Fixture Story'),
  isProviderConfigured: vi.fn(() => true),
  getProviderInfo: vi.fn(() => ({ currentProvider: 'mock', supportsVision: false })),
}));

import { runStoryGeneration } from '../../mcp-server/routes/generationCore.js';
import { getManifestManager } from '../../story-generator/manifestManager.js';

let fixture: FixtureProject;
let originalCwd: string;

let originalStorybookUrl: string | undefined;

beforeAll(() => {
  originalCwd = process.cwd();
  fixture = createFixtureProject();
  process.chdir(fixture.root);

  /**
   * Keep this suite off the network.
   *
   * With no Storybook URL supplied, generation falls back to
   * `http://localhost:6006` — the conventional default — and on a developer
   * machine that is very often a REAL, unrelated Storybook. This suite was
   * silently fetching 16 components from whatever happened to be running
   * there, spending 3.4s doing it, and timing out at 5s depending on that
   * server's load. A test whose result depends on ambient network state is
   * measuring the machine, not the code.
   *
   * Port 1 cannot be listened on, so the fetch fails immediately rather than
   * waiting out a timeout.
   */
  originalStorybookUrl = process.env.STORYBOOK_URL;
  process.env.STORYBOOK_URL = 'http://127.0.0.1:1';
});

afterAll(() => {
  process.chdir(originalCwd);
  fixture.cleanup();
  if (originalStorybookUrl === undefined) delete process.env.STORYBOOK_URL;
  else process.env.STORYBOOK_URL = originalStorybookUrl;
});

beforeEach(() => {
  llm.queue.length = 0;
  llm.calls.length = 0;
});


describe('generation pipeline (integration)', () => {
  it('generates, validates, and persists a story on the happy path', async () => {
    llm.queue.push({ content: validStoryResponse() });

    const progressPhases: string[] = [];
    const outcome = await runStoryGeneration(
      {
        prompt: 'Create a card with a greeting and a button',
        conversation: [{ role: 'user', content: 'Create a card with a greeting and a button' }],
      },
      { onProgress: (_s, _t, phase) => progressPhases.push(phase) }
    );

    expect(outcome.success).toBe(true);
    expect(outcome.isFallbackStory).toBe(false);
    expect(outcome.validation.selfHealingUsed).toBe(false);
    expect(outcome.validation.attempts).toBe(1);

    // File written into the fixture project with title prefix + injected id
    expect(fs.existsSync(outcome.outPath)).toBe(true);
    const written = fs.readFileSync(outcome.outPath, 'utf-8');
    expect(written).toContain("title: 'Generated/");
    expect(written).toMatch(/id: '[a-z0-9-]+'/);
    expect(written).toContain(`from '${FIXTURE_LIB}'`);

    // Storybook ID derivable by clients
    expect(outcome.storybookId).toBeTruthy();
    expect(written).toContain(`id: '${outcome.storybookId}'`);

    // Conversational reply flows through, and is persisted server-side in the
    // manifest so the panel can recover it after a preview-iframe reload.
    expect(outcome.chatSummary).toContain('I put together');
    expect(outcome.suggestions).toHaveLength(3);
    const entry = getManifestManager().get(outcome.fileName);
    expect(entry).toBeTruthy();
    expect(entry!.conversation.at(-1)!.role).toBe('ai');
    expect(entry!.conversation.at(-1)!.content).toContain('I put together');

    // The full completion payload is persisted so a panel that reloaded
    // mid-generation (or reopens this chat later) can restore the reply.
    const lastCompletion = entry!.metadata.lastCompletion;
    expect(lastCompletion).toBeTruthy();
    expect(lastCompletion!.code).toContain(FIXTURE_LIB);
    expect(lastCompletion!.suggestions).toHaveLength(3);
    expect(lastCompletion!.generationTimeMs).toBeGreaterThanOrEqual(0);
    expect(lastCompletion!.storybookId).toBe(outcome.storybookId);

    // All 8 pipeline steps reported
    expect(progressPhases).toContain('config_loaded');
    expect(progressPhases).toContain('components_discovered');
    expect(progressPhases).toContain('saving');
  });

  it('self-heals a forbidden import and produces clean output', async () => {
    llm.queue.push({ content: validStoryResponse("import { motion } from 'framer-motion';") });
    llm.queue.push({ content: validStoryResponse() });

    const retries: string[] = [];
    const outcome = await runStoryGeneration(
      { prompt: 'Create an animated card' },
      { onRetry: (_a, _m, reason) => retries.push(reason) }
    );

    expect(outcome.success).toBe(true);
    expect(outcome.validation.selfHealingUsed).toBe(true);
    expect(outcome.validation.attempts).toBe(2);
    expect(retries.length).toBeGreaterThan(0);

    const written = fs.readFileSync(outcome.outPath, 'utf-8');
    expect(written).not.toContain('framer-motion');

    // The healing prompt sent back to the model named the violation
    const healingCall = llm.calls[1];
    const healingText = healingCall.map(m => m.content).join('\n');
    expect(healingText).toContain('framer-motion');
  });

  it('permits an extra package when the considerations text names it', async () => {
    llm.queue.push({ content: validStoryResponse("import { motion } from 'framer-motion';") });

    const outcome = await runStoryGeneration({
      prompt: 'Create an animated card',
      considerations: 'Allowed additional imports: framer-motion for entrance animations.',
    });

    expect(outcome.success).toBe(true);
    expect(outcome.validation.selfHealingUsed).toBe(false);
    const written = fs.readFileSync(outcome.outPath, 'utf-8');
    expect(written).toContain('framer-motion');
  });

  it('rejects with INVALID_IMPORTS when healing never converges', async () => {
    const bad = validStoryResponse("import styled from 'styled-components';");
    llm.queue.push({ content: bad }, { content: bad }, { content: bad });

    await expect(runStoryGeneration({ prompt: 'Create a styled card' }))
      .rejects.toMatchObject({
        name: 'GenerationError',
        code: 'INVALID_IMPORTS',
        options: expect.objectContaining({ httpStatus: 422 }),
      });
  });

  it('re-requests a complete block when the response is truncated', async () => {
    llm.queue.push({ content: 'Here is your story:\n```tsx\nimport { Butt', truncated: true });
    llm.queue.push({ content: validStoryResponse() });

    const outcome = await runStoryGeneration({ prompt: 'Create a card' });

    expect(outcome.success).toBe(true);
    // The follow-up message asked for a complete block
    const followUp = llm.calls[1].map(m => m.content).join('\n');
    expect(followUp).toContain('cut off');
  });

  it('re-prompts when the model returns prose without a code block', async () => {
    llm.queue.push({ content: 'Sure! I would build a card with a button inside it.' });
    llm.queue.push({ content: validStoryResponse() });

    const outcome = await runStoryGeneration({ prompt: 'Create a card' });

    expect(outcome.success).toBe(true);
    const followUp = llm.calls[1].map(m => m.content).join('\n');
    expect(followUp).toContain('code block');
  });

  it('updates an existing story in place, preserving its title', async () => {
    llm.queue.push({ content: validStoryResponse() });
    const first = await runStoryGeneration({
      prompt: 'Create a pricing card',
      conversation: [{ role: 'user', content: 'Create a pricing card' }],
    });

    llm.queue.push({ content: validStoryResponse() });
    const second = await runStoryGeneration({
      prompt: 'Make the button say Subscribe',
      fileName: first.fileName,
      isUpdate: true,
      originalTitle: first.title,
      storyId: first.storyId,
      conversation: [
        { role: 'user', content: 'Create a pricing card' },
        { role: 'ai', content: 'Done' },
        { role: 'user', content: 'Make the button say Subscribe' },
      ],
    });

    expect(second.isUpdate).toBe(true);
    expect(second.fileName).toBe(first.fileName);
    expect(second.title).toBe(first.title);
    expect(second.storyId).toBe(first.storyId);

    // Refinement prompt carried the previous code as modification context
    const updateCall = llm.calls[1].map(m => m.content).join('\n');
    expect(updateCall).toContain('PREVIOUS GENERATED CODE');
  });
});
