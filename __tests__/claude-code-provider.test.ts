import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const calls: Array<{ prompt: AsyncIterable<any>; options: Record<string, any> }> = [];
let script: any[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: { prompt: AsyncIterable<any>; options: Record<string, any> }) => {
    calls.push(params);
    const signal: AbortSignal | undefined = params.options.abortController?.signal;
    return (async function* () {
      for (const message of script) {
        if (message.wait) {
          await new Promise(resolve => setTimeout(resolve, message.wait));
          signal?.throwIfAborted();
          continue;
        }
        yield message;
      }
    })();
  },
}));

import { ClaudeCodeProvider } from '../story-generator/llm-providers/claude-code-provider.js';

const wait = (ms: number) => ({ wait: ms });

const textDelta = (text: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});
const assistant = (over: Record<string, unknown> = {}) => ({
  type: 'assistant',
  message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'Hello' }] },
  ...over,
});
const result = (over: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  stop_reason: 'end_turn',
  result: '',
  usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
  ...over,
});

function configured(): ClaudeCodeProvider {
  const provider = new ClaudeCodeProvider();
  provider.configure({ provider: 'claude-code', model: 'claude-opus-5' });
  return provider;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('ClaudeCodeProvider', () => {
  beforeEach(() => {
    calls.length = 0;
    script = [textDelta('ok'), result()];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('starts unconfigured because there is no key to detect', () => {
    const provider = new ClaudeCodeProvider();

    expect(provider.isConfigured()).toBe(false);
  });

  it('counts as configured once it has been selected', () => {
    const provider = new ClaudeCodeProvider();

    provider.configure({ provider: 'claude-code', model: 'claude-opus-5' });

    expect(provider.isConfigured()).toBe(true);
  });

  it('asks the SDK for a single tool-less turn with the story-ui system prompt and no API key in the child env', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-must-not-leak');
    const provider = configured();

    await provider.chat([{ role: 'user', content: 'hi' }], {
      systemPrompt: 'You build stories.',
      model: 'claude-sonnet-5',
      effort: 'low',
    });

    const { options } = calls[0];
    expect(options).toMatchObject({
      model: 'claude-sonnet-5',
      systemPrompt: 'You build stories.',
      tools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      effort: 'low',
    });
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('folds earlier turns into one user message and maps image blocks to the Messages API shape', async () => {
    const provider = configured();

    await provider.chat([
      { role: 'user', content: 'Build a card' },
      { role: 'assistant', content: '<Card />' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Match this' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AAAA' } },
        ],
      },
    ]);

    const prompt = await collect(calls[0].prompt);
    expect(prompt).toHaveLength(1);
    expect(prompt[0].message.role).toBe('user');
    expect(prompt[0].message.content[0].text).toContain('<assistant>\n<Card />\n</assistant>');
    expect(prompt[0].message.content.slice(1)).toEqual([
      { type: 'text', text: 'Match this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
  });

  it('streams text deltas once and reads model, usage and finish reason from the result', async () => {
    const provider = configured();
    script = [textDelta('Hel'), textDelta('lo'), assistant({ message: { model: 'claude-opus-5-served', content: [{ type: 'text', text: 'Hello' }] } }), result({ stop_reason: 'max_tokens' })];

    const chunks = await collect(provider.chatStream([{ role: 'user', content: 'hi' }]));

    expect(chunks).toEqual([
      { type: 'text', content: 'Hel' },
      { type: 'text', content: 'lo' },
      {
        type: 'done',
        model: 'claude-opus-5-served',
        finishReason: 'length',
        usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150, cacheReadInputTokens: 100, cacheCreationInputTokens: 0 },
      },
    ]);
  });

  it('reports a hit output cap as a truncated answer, not an error', async () => {
    const provider = configured();
    script = [textDelta('partial'), assistant({ error: 'max_output_tokens' }), result({ is_error: true, stop_reason: 'max_tokens' })];

    const chunks = await collect(provider.chatStream([{ role: 'user', content: 'hi' }]));

    expect(chunks.map(c => c.type)).toEqual(['text', 'done']);
    expect(chunks[1]).toMatchObject({ type: 'done', finishReason: 'length' });
  });

  it('keeps a slow stream alive as long as output keeps arriving', async () => {
    vi.useFakeTimers();
    const provider = configured();
    script = [wait(90_000), textDelta('a'), wait(90_000), textDelta('b'), wait(90_000), textDelta('c'), result()];

    const pending = collect(provider.chatStream([{ role: 'user', content: 'hi' }]));
    await vi.advanceTimersByTimeAsync(300_000);
    const chunks = await pending;

    expect(chunks.map(c => c.type)).toEqual(['text', 'text', 'text', 'done']);
  });

  it('gives up when nothing arrives for the whole idle window', async () => {
    vi.useFakeTimers();
    const provider = configured();
    script = [wait(130_000), textDelta('late'), result()];

    const pending = collect(provider.chatStream([{ role: 'user', content: 'hi' }]));
    await vi.advanceTimersByTimeAsync(300_000);
    const chunks = await pending;

    expect(chunks).toEqual([{ type: 'error', error: expect.stringMatching(/no output .*120000ms/) }]);
  });

  it('turns an authentication failure into a login hint', async () => {
    const provider = configured();
    script = [assistant({ error: 'authentication_failed', message: { model: 'claude-opus-5', content: [] } })];

    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/claude auth login/);
  });
});
