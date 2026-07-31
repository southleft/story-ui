/**
 * GET /story-ui/active-generations — the "server is still working" signal.
 *
 * The defect this pins: a client's recovery window expired while the server
 * was legitimately mid-pipeline, because nothing about the request existed
 * anywhere a poller could see until COMPLETION wrote the manifest entry. The
 * registry must show a generation for its whole lifetime and must be empty
 * the moment it ends — on success, on fallback, and on throw alike, because a
 * stale entry makes a poller wait forever, which is worse than the silence
 * this endpoint exists to fix.
 *
 * Runs the REAL pipeline against a fixture project with only the LLM mocked
 * (gated behind a promise so a test can observe the in-flight state).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createFixtureProject, validStoryResponse, FixtureProject } from './helpers/fixtureProject.js';

const llm = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
}));

vi.mock('../../story-generator/llm-providers/story-llm-service.js', () => ({
  chatCompletionDetailed: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    const first = typeof messages[0]?.content === 'string' ? messages[0].content : '';
    // The post-generation conversational summary is a separate call — answer
    // it out-of-band so it never waits on the test's gate.
    if (first.includes('You are Story UI, an assistant that just')) {
      return { content: 'Built it.\nSUGGESTIONS:\nMake it larger\nAdd a card\nCenter it', truncated: false };
    }
    if (llm.gate) await llm.gate;
    return { content: validStoryResponse(), truncated: false };
  }),
  chatCompletion: vi.fn(async () => ''),
  chatCompletionStream: vi.fn(),
  chatCompletionWithImages: vi.fn(async () => { throw new Error('vision not used in these tests'); }),
  chatCompletionWithImagesDetailed: vi.fn(async () => { throw new Error('vision not used in these tests'); }),
  buildMessageWithImages: vi.fn((content: string) => content),
  generateTitle: vi.fn(async () => 'Active Fixture Story'),
  isProviderConfigured: vi.fn(() => true),
  getProviderInfo: vi.fn(() => ({ currentProvider: 'mock', supportsVision: false })),
}));

import { runStoryGeneration } from '../../mcp-server/routes/generationCore.js';
import {
  activeGenerationsHandler,
  listActiveGenerations,
} from '../../mcp-server/routes/activeGenerations.js';

let fixture: FixtureProject;
let originalCwd: string;
let originalStorybookUrl: string | undefined;

beforeAll(() => {
  originalCwd = process.cwd();
  fixture = createFixtureProject();
  process.chdir(fixture.root);
  // Keep the suite off the network — port 1 fails instantly instead of
  // verifying against whatever Storybook happens to be running locally.
  originalStorybookUrl = process.env.STORYBOOK_URL;
  process.env.STORYBOOK_URL = 'http://127.0.0.1:1';
});

afterAll(() => {
  process.chdir(originalCwd);
  fixture.cleanup();
  if (originalStorybookUrl === undefined) delete process.env.STORYBOOK_URL;
  else process.env.STORYBOOK_URL = originalStorybookUrl;
});

/** Minimal Express response double for calling the route handler directly. */
function mockRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
}

describe('active generations endpoint (integration)', () => {
  it('shows an in-flight generation with the contract shape, then clears on completion', async () => {
    let release!: () => void;
    llm.gate = new Promise<void>(resolve => { release = resolve; });

    const before = Date.now();
    const pending = runStoryGeneration({ prompt: 'Create an availability card' });

    // Registration happens at pipeline start, so the poller can already see it
    // while the (gated) LLM call is in flight.
    const during = mockRes();
    activeGenerationsHandler({} as any, during as any);
    expect(during.body.active).toHaveLength(1);
    const entry = during.body.active[0];
    // Exactly the contract the client implements against.
    expect(entry.prompt).toBe('Create an availability card');
    expect(entry.fileName).toBeNull();
    expect(typeof entry.startedAt).toBe('number');
    expect(entry.startedAt).toBeGreaterThanOrEqual(before);
    expect(entry.startedAt).toBeLessThanOrEqual(Date.now());

    release();
    llm.gate = null;
    const outcome = await pending;
    expect(outcome.success).toBe(true);

    const after = mockRes();
    activeGenerationsHandler({} as any, after as any);
    expect(after.body.active).toHaveLength(0);
  });

  it('registers the target fileName for updates, and clears on throw', async () => {
    // A missing prompt throws at the top of the pipeline — the finally must
    // still remove the registration, or every failed request leaks a
    // permanently "active" entry.
    const pending = runStoryGeneration({ prompt: '', fileName: 'existing.stories.tsx' } as any);

    const during = listActiveGenerations();
    expect(during).toHaveLength(1);
    expect(during[0].fileName).toBe('existing.stories.tsx');

    await expect(pending).rejects.toMatchObject({ code: 'MISSING_PROMPT' });
    expect(listActiveGenerations()).toHaveLength(0);
  });
});
