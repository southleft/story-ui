/**
 * A stream must say WHY the model stopped, and the static prefix must be
 * marked cacheable.
 *
 * The buffered path has always read stop_reason. The stream parser read
 * message_delta only for its output-token count and dropped the stop_reason
 * riding beside it, so a streaming caller had to guess truncation from an
 * unbalanced code fence — a guess that is wrong on precisely the large
 * compositions most likely to truncate. These feed the parser real Anthropic
 * SSE bytes, split mid-line the way a socket delivers them, and read the
 * answer off the done chunk.
 *
 * The caching tests inspect the REQUEST: the system prompt goes out as a text
 * block carrying cache_control, and the response's cache counters come back
 * on usage where the effect can be seen.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { ClaudeProvider } from '../story-generator/llm-providers/claude-provider.js';
import type { StreamChunk } from '../story-generator/llm-providers/types.js';
import { chatCompletionStreamDetailed } from '../story-generator/llm-providers/story-llm-service.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Anthropic's wire format: one `event:` line and one `data:` line per event. */
function sse(events: Array<Record<string, unknown>>): string {
  return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** A Response whose body arrives in awkward 7-byte pieces, so line buffering is exercised. */
function streamingResponse(text: string, pieceSize = 7): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + pieceSize));
      offset += pieceSize;
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function installFetch(response: () => Response) {
  const spy = vi.fn(async (_url: unknown, _init?: RequestInit) => response());
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function requestBodyOf(spy: ReturnType<typeof installFetch>): any {
  const init = spy.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body));
}

function provider() {
  return new ClaudeProvider({ apiKey: 'test-key', model: 'claude-sonnet-5' });
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iter) chunks.push(chunk);
  return chunks;
}

const messageStart = {
  type: 'message_start',
  message: {
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [],
    stop_reason: null,
    usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
  },
};
const textDelta = (text: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
const messageDelta = (stop_reason: string, output_tokens: number) => ({
  type: 'message_delta',
  delta: { stop_reason, stop_sequence: null },
  usage: { output_tokens },
});
const messageStop = { type: 'message_stop' };

describe('Claude stream parser — stop reason', () => {
  it('maps max_tokens to "length" on the done chunk, with usage and model', async () => {
    installFetch(() => streamingResponse(sse([
      messageStart,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      textDelta('export default {'),
      textDelta(' title: "Generated/Dashboard"'),
      messageDelta('max_tokens', 4096),
      messageStop,
    ])));

    const chunks = await collect(provider().chatStream([{ role: 'user', content: 'go' }]));

    const text = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
    expect(text).toBe('export default { title: "Generated/Dashboard"');

    const done = chunks.find(c => c.type === 'done');
    expect(done).toBeDefined();
    expect(done!.finishReason).toBe('length');
    expect(done!.model).toBe('claude-sonnet-5');
    expect(done!.usage).toMatchObject({
      promptTokens: 1200,
      completionTokens: 4096,
      totalTokens: 5296,
      cacheReadInputTokens: 1000,
      cacheCreationInputTokens: 0,
    });
    expect(chunks.some(c => c.type === 'error')).toBe(false);
  });

  it('maps end_turn and stop_sequence to "stop"', async () => {
    for (const reason of ['end_turn', 'stop_sequence']) {
      installFetch(() => streamingResponse(sse([
        messageStart, textDelta('done'), messageDelta(reason, 3), messageStop,
      ])));
      const chunks = await collect(provider().chatStream([{ role: 'user', content: 'go' }]));
      expect(chunks.find(c => c.type === 'done')!.finishReason).toBe('stop');
    }
  });

  it('leaves finishReason undefined when the stream ends before any message_delta', async () => {
    // A cut connection must not be reported as a clean stop — "absent" and
    // "stopped" have to look different to the caller.
    installFetch(() => streamingResponse(sse([messageStart, textDelta('partial')])));
    const chunks = await collect(provider().chatStream([{ role: 'user', content: 'go' }]));
    const done = chunks.find(c => c.type === 'done');
    expect(done).toBeDefined();
    expect(done!.finishReason).toBeUndefined();
  });

  it('surfaces a mid-stream error event as an error chunk, not a done chunk', async () => {
    installFetch(() => streamingResponse(sse([
      messageStart,
      textDelta('so far'),
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ])));
    const chunks = await collect(provider().chatStream([{ role: 'user', content: 'go' }]));
    expect(chunks.some(c => c.type === 'done')).toBe(false);
    expect(chunks.find(c => c.type === 'error')!.error).toContain('Overloaded');
  });
});

describe('Claude prompt caching — request shape', () => {
  const system = 'You are a Storybook story generator. '.repeat(40);

  it('streams the system prompt as a text block with an ephemeral cache breakpoint', async () => {
    const spy = installFetch(() => streamingResponse(sse([messageStart, messageDelta('end_turn', 1), messageStop])));
    await collect(provider().chatStream([{ role: 'user', content: 'go' }], { systemPrompt: system }));

    const body = requestBodyOf(spy);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toHaveLength(1);
    expect(body.system[0]).toEqual({ type: 'text', text: system, cache_control: { type: 'ephemeral' } });
    // The user turn is untouched — the breakpoint sits on the static prefix only.
    expect(body.messages).toEqual([{ role: 'user', content: 'go' }]);
    expect(body.stream).toBe(true);
  });

  it('sends the same block shape on the buffered path and reads cache counters back', async () => {
    const spy = installFetch(() => new Response(JSON.stringify({
      id: 'msg_02', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'max_tokens', stop_sequence: null,
      usage: { input_tokens: 40, output_tokens: 4096, cache_read_input_tokens: 0, cache_creation_input_tokens: 1180 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await provider().chat([{ role: 'user', content: 'go' }], { systemPrompt: system });

    const body = requestBodyOf(spy);
    expect(body.system).toEqual([{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]);
    expect(response.finishReason).toBe('length');
    expect(response.usage).toMatchObject({ cacheReadInputTokens: 0, cacheCreationInputTokens: 1180 });
  });

  it('falls back to a plain string when cacheSystemPrompt is false, and omits system when absent', async () => {
    const spy = installFetch(() => streamingResponse(sse([messageStart, messageDelta('end_turn', 1), messageStop])));
    await collect(provider().chatStream([{ role: 'user', content: 'go' }], { systemPrompt: system, cacheSystemPrompt: false }));
    expect(requestBodyOf(spy).system).toBe(system);

    const spy2 = installFetch(() => streamingResponse(sse([messageStart, messageDelta('end_turn', 1), messageStop])));
    await collect(provider().chatStream([{ role: 'user', content: 'go' }]));
    expect('system' in requestBodyOf(spy2)).toBe(false);
  });
});

describe('chatCompletionStreamDetailed — the service surfaces the result', () => {
  beforeAll(() => {
    // The registry configures Claude from the environment on first use.
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  });

  it('delivers deltas as they arrive and resolves with content, finishReason and truncated', async () => {
    installFetch(() => streamingResponse(sse([
      messageStart,
      textDelta('const a = 1;'),
      textDelta('\nconst b = 2;'),
      messageDelta('max_tokens', 4096),
      messageStop,
    ])));

    const seen: Array<[string, string]> = [];
    const result = await chatCompletionStreamDetailed(
      [
        { role: 'system', content: 'You generate stories.' },
        { role: 'user', content: 'go' },
      ],
      { provider: 'claude', maxTokens: 4096 },
      (delta, accumulated) => seen.push([delta, accumulated]),
    );

    expect(seen).toEqual([
      ['const a = 1;', 'const a = 1;'],
      ['\nconst b = 2;', 'const a = 1;\nconst b = 2;'],
    ]);
    expect(result.content).toBe('const a = 1;\nconst b = 2;');
    expect(result.finishReason).toBe('length');
    expect(result.truncated).toBe(true);
    expect(result.provider).toBe('Claude');
    expect(result.model).toBe('claude-sonnet-5');
    expect(result.usage?.completionTokens).toBe(4096);
  });

  it('reports truncated: false and an undefined finishReason when the provider never said', async () => {
    installFetch(() => streamingResponse(sse([messageStart, textDelta('x')])));
    const result = await chatCompletionStreamDetailed(
      [{ role: 'user', content: 'go' }],
      { provider: 'claude' },
    );
    expect(result.content).toBe('x');
    expect(result.finishReason).toBeUndefined();
    expect(result.truncated).toBe(false);
  });
});
