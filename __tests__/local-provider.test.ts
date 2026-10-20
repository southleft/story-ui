/**
 * The local provider's model list is whatever the server says it has loaded,
 * and a hosted model id handed to it (a cheap-model helper, a stale panel
 * preference) must not reach a server that cannot serve it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LocalProvider } from '../story-generator/llm-providers/local-provider.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function installServer(routes: Record<string, () => Response>) {
  const spy = vi.fn(async (url: unknown, _init?: RequestInit) => {
    const route = routes[String(url)];
    return route ? route() : new Response('not found', { status: 404 });
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

const completion = (model: string) => () => Response.json({
  id: 'x', object: 'chat.completion', created: 0, model,
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

function provider(model = '') {
  const p = new LocalProvider();
  p.configure({ provider: 'local', baseUrl: 'http://localhost:1234/v1/', model });
  return p;
}

describe('LocalProvider', () => {
  it('reads LM Studio\'s listing: embeddings dropped, vision and context kept', async () => {
    installServer({
      'http://localhost:1234/api/v0/models': () => Response.json({ data: [
        { id: 'qwen3-coder', type: 'llm', max_context_length: 262144 },
        { id: 'gemma-3', type: 'vlm', max_context_length: 131072 },
        { id: 'nomic-embed', type: 'embeddings' },
      ] }),
    });
    const p = provider();
    expect(await p.refreshModels()).toBe(true);
    expect(p.supportedModels.map(m => [m.id, m.supportsVision, m.contextWindow])).toEqual([
      ['qwen3-coder', false, 262144],
      ['gemma-3', true, 131072],
    ]);
    expect(p.getConfig().model).toBe('qwen3-coder');
  });

  it('is usable before its startup listing lands: the first call fetches the model', async () => {
    const spy = installServer({
      'http://localhost:1234/v1/models': () => Response.json({ data: [{ id: 'llama3.3' }] }),
      'http://localhost:1234/v1/chat/completions': completion('llama3.3'),
    });
    const p = provider();
    expect(p.isConfigured()).toBe(true);

    await p.chat([{ role: 'user', content: 'hi' }]);
    const chat = spy.mock.calls.find(([url]) => String(url).endsWith('/chat/completions'));
    expect(JSON.parse(String(chat?.[1]?.body)).model).toBe('llama3.3');
  });

  it('says no model is loaded rather than sending an empty model id', async () => {
    installServer({ 'http://localhost:1234/v1/models': () => Response.json({ data: [] }) });
    await expect(provider().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/no model available/);
  });

  it('falls back to the generic /v1/models on other servers', async () => {
    installServer({
      'http://localhost:1234/v1/models': () => Response.json({ data: [{ id: 'llama3.3' }] }),
    });
    const p = provider();
    expect(await p.refreshModels()).toBe(true);
    expect(p.supportedModels.map(m => m.id)).toEqual(['llama3.3']);
  });

  it('reports an unreachable server as a failure, keeping the configured model', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const p = provider('my-model');
    expect(await p.refreshModels()).toBe(false);
    expect(p.supportedModels.map(m => m.id)).toEqual(['my-model']);
  });

  it('sends a hosted model id as the configured model; a listed one as asked', async () => {
    const spy = installServer({
      'http://localhost:1234/v1/chat/completions': completion('served'),
    });
    const p = provider('qwen3-coder');
    p.supportedModels.push({ ...p.supportedModels[0], id: 'gemma-3' });

    await p.chat([{ role: 'user', content: 'hi' }], { model: 'claude-haiku-4-5' });
    await p.chat([{ role: 'user', content: 'hi' }], { model: 'gemma-3' });

    const sent = spy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).model);
    expect(sent).toEqual(['qwen3-coder', 'gemma-3']);
  });

  it('sends the API key only when one is configured', async () => {
    const spy = installServer({ 'http://localhost:1234/v1/models': () => Response.json({ data: [] }) });
    const keyed = new LocalProvider();
    keyed.configure({ provider: 'local', baseUrl: 'http://localhost:1234/v1', apiKey: 'tok', model: 'm' });
    await keyed.refreshModels();
    await provider('m').refreshModels();

    const auth = spy.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization);
    expect(auth).toEqual(['Bearer tok', 'Bearer tok', undefined, undefined]);
  });
});
