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

    const sent = spy.mock.calls
      .filter(([url]) => String(url).endsWith('/chat/completions'))
      .map(([, init]) => JSON.parse(String(init?.body)).model);
    expect(sent).toEqual(['qwen3-coder', 'gemma-3']);
  });

  it('sends the API key only when one is configured', async () => {
    const spy = installServer({ 'http://localhost:1234/v1/models': () => Response.json({ data: [] }) });
    const keyed = new LocalProvider();
    keyed.configure({ provider: 'local', baseUrl: 'http://localhost:1234/v1', apiKey: 'tok', model: 'm' });
    await keyed.refreshModels();
    await provider('m').refreshModels();

    // Keyed: LM Studio, /models/user, /models. Keyless skips /models/user.
    const auth = spy.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization);
    expect(auth).toEqual(['Bearer tok', 'Bearer tok', 'Bearer tok', undefined, undefined]);
  });
});

describe('LocalProvider against a router (OpenRouter)', () => {
  const ROOT = 'https://openrouter.ai/api/v1';
  const keyed = (extra: Partial<Parameters<LocalProvider['configure']>[0]> = {}) => {
    const p = new LocalProvider();
    p.configure({ provider: 'local', baseUrl: ROOT, apiKey: 'sk-or', model: '', ...extra });
    return p;
  };

  it('lists the models the account may use (/models/user), not every model', async () => {
    installServer({
      [`${ROOT}/models/user`]: () => Response.json({ data: [{ id: 'anthropic/claude-sonnet-5.5' }] }),
      [`${ROOT}/models`]: () => Response.json({ data: [{ id: 'anthropic/claude-sonnet-5.5' }, { id: 'qwen/qwen2.5-vl-72b-instruct' }] }),
    });
    const p = keyed();
    await p.refreshModels();
    expect(p.supportedModels.map(m => m.id)).toEqual(['anthropic/claude-sonnet-5.5']);
  });

  it('reads the capabilities the listing states, and drops models that do not output text', async () => {
    installServer({
      [`${ROOT}/models/user`]: () => Response.json({ data: [
        {
          id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', context_length: 1_000_000,
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          top_provider: { max_completion_tokens: 64_000 },
        },
        { id: 'qwen/qwen3-coder', context_length: 262_144, architecture: { input_modalities: ['text'] }, top_provider: { max_completion_tokens: null } },
        { id: 'openai/gpt-image-2', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
      ] }),
    });
    const p = keyed();
    await p.refreshModels();
    expect(p.supportedModels.map(m => [m.id, m.name, m.contextWindow, m.maxOutputTokens, m.supportsVision])).toEqual([
      ['anthropic/claude-sonnet-5.5', 'Anthropic: Claude Sonnet 5.5', 1_000_000, 64_000, true],
      ['qwen/qwen3-coder', 'qwen/qwen3-coder', 262_144, 8192, false],
    ]);
  });

  it('narrows to LOCAL_LLM_MODELS, and defaults to the first allowed model', async () => {
    installServer({
      [`${ROOT}/models/user`]: () => Response.json({ data: [{ id: 'a/one' }, { id: 'b/two' }, { id: 'c/three' }] }),
    });
    const p = keyed({ allowedModels: ['c/three', 'b/two'] });
    await p.refreshModels();
    expect(p.supportedModels.map(m => m.id)).toEqual(['b/two', 'c/three']);
    expect(p.getConfig().model).toBe('b/two');
  });

  it('goes straight to the listing that answered last time', async () => {
    const spy = installServer({
      [`${ROOT}/models/user`]: () => Response.json({ data: [{ id: 'a/one' }] }),
    });
    const p = keyed();
    await p.refreshModels();
    spy.mockClear();
    await p.refreshModels();
    expect(spy.mock.calls.map(([url]) => String(url))).toEqual([`${ROOT}/models/user`]);
  });

  it('titles a story with the model the user chose, not the configured default', async () => {
    // The default here is one the account cannot reach (OpenRouter refuses a
    // free model that trains on data when privacy settings forbid it).
    vi.stubEnv('LOCAL_LLM_BASE_URL', ROOT);
    vi.stubEnv('LOCAL_LLM_API_KEY', 'sk-or');
    vi.stubEnv('LOCAL_LLM_MODEL', 'nvidia/blocked:free');
    vi.resetModules();
    const spy = installServer({
      [`${ROOT}/models/user`]: () => Response.json({ data: [{ id: 'anthropic/claude-haiku-5.5' }] }),
      [`${ROOT}/chat/completions`]: completion('anthropic/claude-haiku-5.5'),
    });
    const { generateTitle } = await import('../story-generator/llm-providers/story-llm-service.js');

    await generateTitle('a pricing card', 'local', 'anthropic/claude-haiku-5.5');

    const chat = spy.mock.calls.find(([url]) => String(url).endsWith('/chat/completions'));
    expect(JSON.parse(String(chat?.[1]?.body)).model).toBe('anthropic/claude-haiku-5.5');
    vi.unstubAllEnvs();
  });

  it('titles with LOCAL_LLM_SMALL_MODEL when set, even if LOCAL_LLM_MODELS keeps it out of the picker', async () => {
    vi.stubEnv('LOCAL_LLM_BASE_URL', ROOT);
    vi.stubEnv('LOCAL_LLM_API_KEY', 'sk-or');
    vi.stubEnv('LOCAL_LLM_MODEL', 'anthropic/claude-opus-5.5');
    vi.stubEnv('LOCAL_LLM_SMALL_MODEL', 'anthropic/claude-haiku-5.5');
    vi.stubEnv('LOCAL_LLM_MODELS', 'anthropic/claude-opus-5.5, anthropic/claude-sonnet-5.5');
    vi.resetModules();
    const spy = installServer({
      [`${ROOT}/models/user`]: () => Response.json({ data: [
        { id: 'anthropic/claude-opus-5.5' },
        { id: 'anthropic/claude-sonnet-5.5' },
        { id: 'anthropic/claude-haiku-5.5' },
        { id: 'qwen/qwen3-coder' },
      ] }),
      [`${ROOT}/chat/completions`]: completion('anthropic/claude-haiku-5.5'),
    });
    const { generateTitle } = await import('../story-generator/llm-providers/story-llm-service.js');
    const { smallModelFor, getProvider } = await import('../story-generator/llm-providers/index.js');

    await generateTitle('a pricing card', 'local', 'anthropic/claude-opus-5.5');

    expect(smallModelFor('local')).toBe('anthropic/claude-haiku-5.5');
    expect(getProvider('local')?.supportedModels.map(m => m.id)).toEqual([
      'anthropic/claude-opus-5.5',
      'anthropic/claude-sonnet-5.5',
    ]);
    const chat = spy.mock.calls.find(([url]) => String(url).endsWith('/chat/completions'));
    expect(JSON.parse(String(chat?.[1]?.body)).model).toBe('anthropic/claude-haiku-5.5');
    vi.unstubAllEnvs();
  });

  it('gives no cheap model when LOCAL_LLM_SMALL_MODEL is unset, so callers keep the chosen one', async () => {
    vi.stubEnv('LOCAL_LLM_BASE_URL', ROOT);
    vi.stubEnv('LOCAL_LLM_SMALL_MODEL', '');
    vi.stubEnv('DEFAULT_PROVIDER', 'local');
    vi.resetModules();
    installServer({});
    const { initializeFromEnv, smallModelFor } = await import('../story-generator/llm-providers/index.js');
    initializeFromEnv();
    expect(smallModelFor('local')).toBeUndefined();
    // A call naming no provider resolves DEFAULT_PROVIDER, not the first registered (Claude).
    expect(smallModelFor()).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('takes its label from LOCAL_LLM_NAME', () => {
    expect(keyed({ displayName: 'OpenRouter' }).name).toBe('OpenRouter');
    expect(keyed().name).toBe('Local');
  });
});
