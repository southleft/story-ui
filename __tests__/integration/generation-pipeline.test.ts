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
  chatCompletionWithImagesDetailed: vi.fn(async () => { throw new Error('vision not used in these tests'); }),
  buildMessageWithImages: vi.fn((content: string) => content),
  generateTitle: vi.fn(async () => 'Fixture Story'),
  isProviderConfigured: vi.fn(() => true),
  getProviderInfo: vi.fn(() => ({ currentProvider: 'mock', supportsVision: false })),
}));

import { runStoryGeneration } from '../../mcp-server/routes/generationCore.js';
import { editPropHandler, editablePropsHandler } from '../../mcp-server/routes/editProp.js';
import { editDivergence } from '../../story-generator/postProcessStory.js';
import { getManifestManager } from '../../story-generator/manifestManager.js';
import { StoryHistoryManager } from '../../story-generator/storyHistory.js';

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

/** Minimal Express response double for calling route handlers directly. */
function mockRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
}

/**
 * A response that keeps the Stack and one line of copy ("Click me") but
 * replaces the rest — measured divergence ~0.59, between the targeted
 * threshold (0.5) and the conversational one (0.6), so it pins the
 * two-threshold split: rejected when a selection said "change one thing",
 * accepted as a conversational rework. The tests below assert the arithmetic
 * by running editDivergence directly, so a drift in the metric or the
 * thresholds fails loudly here instead of silently un-pinning the split.
 */
function moderateRewriteResponse(): string {
  return [
    '```tsx',
    "import React from 'react';",
    "import type { Meta, StoryObj } from '@storybook/react';",
    `import { Badge, Stack } from '${FIXTURE_LIB}';`,
    'const meta: Meta = {',
    "  title: 'Placeholder',",
    '};',
    'export default meta;',
    'type Story = StoryObj;',
    '',
    'export const Primary: Story = {',
    '  render: () => (',
    '    <Stack>',
    '      <Badge>Click me</Badge>',
    '      <Badge>Brand new copy</Badge>',
    '      <Badge>Another badge</Badge>',
    '    </Stack>',
    '  ),',
    '};',
    '```',
  ].join('\n');
}

/** The bare code inside a scripted response, as the divergence guard sees it. */
function codeOf(response: string): string {
  return response.replace(/^[\s\S]*?```tsx\n/, '').replace(/\n```[\s\S]*$/, '');
}

/** A response sharing no elements and no content with the fixture story. */
function totalRewriteResponse(): string {
  return [
    '```tsx',
    "import React from 'react';",
    "import type { Meta, StoryObj } from '@storybook/react';",
    `import { Badge } from '${FIXTURE_LIB}';`,
    'const meta: Meta = {',
    "  title: 'Placeholder',",
    '};',
    'export default meta;',
    'type Story = StoryObj;',
    '',
    'export const Primary: Story = {',
    '  render: () => (',
    '    <>',
    '      <Badge>Entirely</Badge>',
    '      <Badge>Different</Badge>',
    '      <Badge>Composition</Badge>',
    '    </>',
    '  ),',
    '};',
    '```',
  ].join('\n');
}

function updateRequest(first: { fileName: string; title: string; storyId: string }, prompt: string) {
  return {
    prompt,
    fileName: first.fileName,
    isUpdate: true,
    originalTitle: first.title,
    storyId: first.storyId,
    conversation: [
      { role: 'user', content: 'Create a card' },
      { role: 'ai', content: 'Done' },
      { role: 'user', content: prompt },
    ],
  };
}


describe('generation pipeline (integration)', () => {
  it('generates, validates, and persists a story on the happy path', async () => {
    llm.queue.push({ content: validStoryResponse() });

    const progressPhases: string[] = [];
    const outcome = await runStoryGeneration(
      {
        prompt: 'Create a card with a greeting and a button',
        conversation: [{
          role: 'user',
          content: 'Create a card with a greeting and a button',
          // Small composer thumbnail — must survive to the manifest so a
          // reopened chat still shows what was referenced.
          thumbnails: ['data:image/jpeg;base64,thumb'],
        }],
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
    // The user message's thumbnails survived to disk (bounded by the manifest).
    expect(entry!.conversation[0].thumbnails).toEqual(['data:image/jpeg;base64,thumb']);

    // The full completion payload is persisted so a panel that reloaded
    // mid-generation (or reopens this chat later) can restore the reply.
    const lastCompletion = entry!.metadata.lastCompletion;
    expect(lastCompletion).toBeTruthy();
    expect(lastCompletion!.code).toContain(FIXTURE_LIB);
    expect(lastCompletion!.suggestions).toHaveLength(3);
    expect(lastCompletion!.generationTimeMs).toBeGreaterThanOrEqual(0);
    expect(lastCompletion!.storybookId).toBe(outcome.storybookId);

    // The verification summary is persisted too, so a recovered thread can
    // rebuild the badge. In this suite Storybook is unreachable (port 1), so
    // the honest outcome is not_verified WITH a reason — absent must not look
    // like never-ran, and never-ran must not look like passed.
    const verification = lastCompletion!.verification;
    expect(verification).toBeTruthy();
    expect(verification!.outcome).toBe('not_verified');
    expect(verification!.reason).toBeTruthy();
    expect(verification!.blockers).toBe(0);
    expect(verification!.warnings).toBe(0);
    // And it agrees with what the generation itself reported.
    expect(outcome.verification?.outcome).toBe('not_verified');

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

  it('builds the next update on the file a prop edit wrote, not the pre-edit history', async () => {
    llm.queue.push({ content: validStoryResponse() });
    const first = await runStoryGeneration({ prompt: 'Create a card to edit' });

    // Panel prop edit: a direct AST write, no model involved.
    const res = mockRes();
    await editPropHandler(
      { body: { fileName: first.fileName, component: 'Button', occurrence: 0, prop: 'size', value: 'lg' } } as any,
      res as any,
    );
    expect(res.body?.ok).toBe(true);

    // The edit was recorded as a version, so history agrees with the disk.
    const current = new StoryHistoryManager(process.cwd()).getCurrentVersion(first.fileName);
    expect(current?.code).toContain('size="lg"');
    expect(current?.prompt).toContain('size');

    // The conversational follow-up regenerates from the POST-edit code.
    llm.queue.push({ content: validStoryResponse() });
    const second = await runStoryGeneration(updateRequest(first, 'Add a subtitle'));
    expect(second.isUpdate).toBe(true);
    const updateCall = llm.calls.at(-1)!.map(m => m.content).join('\n');
    expect(updateCall).toContain('size="lg"');
  });

  it('resolves editable props through the candidate chain to the element the file contains', async () => {
    llm.queue.push({ content: validStoryResponse() });
    const first = await runStoryGeneration({ prompt: 'Create a card with a button' });

    // Clicking a button in the preview names the LIBRARY's inner component
    // (Mantine: UnstyledButton) — a name the story file never contains. The
    // GET must resolve the chain exactly as POST /mcp/edit-prop does, and
    // answer for the element an edit would actually target.
    const res = mockRes();
    await editablePropsHandler(
      { query: {
          component: 'UnstyledButton',
          candidates: 'UnstyledButton,Button',
          fileName: first.fileName,
      } } as any,
      res as any,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.component).toBe('Button');

    const byName = Object.fromEntries(res.body.props.map((p: any) => [p.name, p]));
    // Declared in ButtonProps: a closed union and a boolean.
    expect(byName.size).toMatchObject({ kind: 'enum', options: ['sm', 'md', 'lg'] });
    expect(byName.size.open).toBeUndefined();
    expect(byName.disabled).toMatchObject({ kind: 'boolean' });
    // Declared BESIDE the component as `type ButtonVariant`: offered as
    // suggestions (open), not a closed set.
    expect(byName.variant).toMatchObject({
      kind: 'enum',
      options: ['primary', 'secondary', 'ghost'],
      open: true,
    });
  });

  it('answers for the named component unchanged when no candidates are sent', async () => {
    llm.queue.push({ content: validStoryResponse() });
    await runStoryGeneration({ prompt: 'Create another card' });

    const res = mockRes();
    await editablePropsHandler({ query: { component: 'UnstyledButton' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    // No resolution requested: the dead end is honest, not silently redirected.
    expect(res.body.component).toBe('UnstyledButton');
    expect(res.body.props).toEqual([]);
  });

  it('rejects a targeted edit that rewrote the page, leaving the file untouched', async () => {
    llm.queue.push({ content: validStoryResponse() });
    const first = await runStoryGeneration({ prompt: 'Create a stats card' });
    const before = fs.readFileSync(first.outPath, 'utf-8');

    // Pin the arithmetic the two-threshold split depends on: this rewrite
    // scores strictly between the targeted limit (0.5) and the conversational
    // limit (0.6).
    const { divergence } = editDivergence(before, codeOf(moderateRewriteResponse()));
    expect(divergence).toBeGreaterThan(0.5);
    expect(divergence).toBeLessThan(0.6);

    llm.queue.push(
      { content: moderateRewriteResponse() },
      { content: moderateRewriteResponse() },
      { content: moderateRewriteResponse() },
    );
    await expect(runStoryGeneration({
      ...updateRequest(first, 'Red background.'),
      selection: 'the Button labelled "Click me"',
    })).rejects.toMatchObject({
      name: 'GenerationError',
      code: 'EDIT_DIVERGENCE',
      options: expect.objectContaining({ httpStatus: 422 }),
    });

    expect(fs.readFileSync(first.outPath, 'utf-8')).toBe(before);
  });

  it('allows the same structural change on a conversational update with no selection', async () => {
    llm.queue.push({ content: validStoryResponse() });
    const first = await runStoryGeneration({ prompt: 'Create a summary card' });

    llm.queue.push({ content: moderateRewriteResponse() });
    const second = await runStoryGeneration(updateRequest(first, 'Replace the card with a badge list'));

    expect(second.success).toBe(true);
    expect(fs.readFileSync(second.outPath, 'utf-8')).toContain('Badge');
  });

  it('rejects a conversational update that replaced everything', async () => {
    llm.queue.push({ content: validStoryResponse() });
    const first = await runStoryGeneration({ prompt: 'Create a welcome card' });
    const before = fs.readFileSync(first.outPath, 'utf-8');

    // The full replacement clears the conversational limit (0.6). A rewrite
    // keeping the tag multiset but replacing all content caps at 0.65
    // (content weighs 0.65), which is why the limit must sit below that.
    expect(editDivergence(before, codeOf(totalRewriteResponse())).divergence).toBeGreaterThan(0.6);

    llm.queue.push(
      { content: totalRewriteResponse() },
      { content: totalRewriteResponse() },
      { content: totalRewriteResponse() },
    );
    await expect(runStoryGeneration(updateRequest(first, 'Improve it')))
      .rejects.toMatchObject({ name: 'GenerationError', code: 'EDIT_DIVERGENCE' });

    expect(fs.readFileSync(first.outPath, 'utf-8')).toBe(before);
  });

  it('retries after a failed generation without being divergence-blocked by the placeholder', async () => {
    // Three responses with no code block at all — the pipeline gives up and
    // writes the fallback placeholder, records it in history, and reports
    // success: false. The V2 panel keeps its activeFile on failure, so the
    // user's follow-up arrives as an UPDATE whose baseline is the error box.
    llm.queue.push(
      { content: 'I could not produce a story this time.' },
      { content: 'Still nothing usable.' },
      { content: 'No code block here either.' },
    );
    const failed = await runStoryGeneration({
      prompt: 'Create an analytics dashboard',
      conversation: [{ role: 'user', content: 'Create an analytics dashboard' }],
    });
    expect(failed.success).toBe(false);
    expect(failed.isFallbackStory).toBe(true);
    expect(fs.readFileSync(failed.outPath, 'utf-8'))
      .toContain('Fallback story generated due to AI generation error');

    // The failure is visible to recovery: the manifest conversation ends with
    // an honest 'ai' reply (the poller requires one) and there is no
    // completion payload to restore.
    const entry = getManifestManager().get(failed.fileName);
    expect(entry).toBeTruthy();
    expect(entry!.conversation.at(-1)!.role).toBe('ai');
    expect(entry!.conversation.at(-1)!.content).toContain('Generation failed');
    expect(entry!.metadata.lastCompletion).toBeUndefined();

    // "Try again" over the placeholder: a fresh build diverges ~1.0 from an
    // error box, and that is the DESIRED outcome — the guard must not fire.
    llm.queue.push({ content: validStoryResponse() });
    const retry = await runStoryGeneration(updateRequest(failed, 'Try again'));
    expect(retry.success).toBe(true);
    const written = fs.readFileSync(retry.outPath, 'utf-8');
    expect(written).toContain(`from '${FIXTURE_LIB}'`);
    expect(written).not.toContain('Story Generation Error');
  });
});
