/**
 * Enterprise auth: teams without long-lived API keys reach models through
 * Vertex AI or a company gateway, authenticated by a short-lived bearer token.
 *
 * These tests inspect the REQUEST each provider sends (URL, auth header, body
 * shape) with fetch mocked, so they run offline and spend nothing. The one
 * thing they cannot check is that Google accepts the token; that needs a real
 * project.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClaudeProvider } from '../story-generator/llm-providers/claude-provider.js';
import { GeminiProvider } from '../story-generator/llm-providers/gemini-provider.js';
import { OpenAIProvider } from '../story-generator/llm-providers/openai-provider.js';
import {
  bearerSourceFromEnv,
  oauthClientCredentialsSource,
  staticBearerSource,
  tokenCommandSource,
  vertexTargetFromEnv,
  joinEndpoint,
} from '../story-generator/llm-providers/enterprise-auth.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

type Call = { url: string; init: RequestInit };

function mockFetch(respond: (call: Call) => unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const call = { url: String(url), init };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  return calls;
}

const anthropicReply = { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
const geminiReply = { candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }] };
const openaiReply = { id: 'c', model: 'gpt-5.6-sol', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };

const headersOf = (c: Call) => c.init.headers as Record<string, string>;
const bodyOf = (c: Call) => JSON.parse(String(c.init.body));

describe('Claude on Vertex AI', () => {
  it('puts the model in the URL, the Vertex API version in the body, and sends a bearer token', async () => {
    const calls = mockFetch(() => anthropicReply);
    const p = new ClaudeProvider();
    p.configure({
      provider: 'claude', model: 'claude-opus-5-5',
      vertex: { project: 'acme-ai', location: 'us-east5' },
      credentials: staticBearerSource('ya29.test', 'test'),
    });
    expect(p.isConfigured()).toBe(true);
    await p.chat([{ role: 'user', content: 'hi' }]);

    expect(calls[0].url).toBe('https://us-east5-aiplatform.googleapis.com/v1/projects/acme-ai/locations/us-east5/publishers/anthropic/models/claude-opus-5-5:rawPredict');
    expect(headersOf(calls[0]).Authorization).toBe('Bearer ya29.test');
    expect(headersOf(calls[0])['x-api-key']).toBeUndefined();
    expect(headersOf(calls[0])['anthropic-beta']).toBeUndefined();
    const body = bodyOf(calls[0]);
    expect(body.anthropic_version).toBe('vertex-2023-10-16');
    expect(body.model).toBeUndefined();
    expect(body.fallbacks).toBeUndefined();
  });

  it('streams through streamRawPredict on the global endpoint', async () => {
    const calls = mockFetch(() => ({}));
    const p = new ClaudeProvider();
    p.configure({
      provider: 'claude', model: 'claude-opus-5-5',
      vertex: { project: 'acme-ai', location: 'global' },
      credentials: staticBearerSource('ya29.test', 'test'),
    });
    for await (const _ of p.chatStream([{ role: 'user', content: 'hi' }])) { /* drain */ }
    expect(calls[0].url).toBe('https://aiplatform.googleapis.com/v1/projects/acme-ai/locations/global/publishers/anthropic/models/claude-opus-5-5:streamRawPredict');
  });
});

describe('Claude through a gateway', () => {
  it('accepts the SDK base URL form and sends the bearer in place of x-api-key', async () => {
    const calls = mockFetch(() => anthropicReply);
    const p = new ClaudeProvider();
    p.configure({ provider: 'claude', model: 'claude-opus-5-5', baseUrl: 'https://ai.acme.dev/anthropic/', credentials: staticBearerSource('tok', 'test') });
    await p.chat([{ role: 'user', content: 'hi' }]);
    expect(calls[0].url).toBe('https://ai.acme.dev/anthropic/v1/messages');
    expect(headersOf(calls[0]).Authorization).toBe('Bearer tok');
    expect(headersOf(calls[0])['anthropic-version']).toBe('2023-06-01');
    expect(bodyOf(calls[0]).model).toBe('claude-opus-5-5');
  });

  it('keeps the plain API-key path unchanged', async () => {
    const calls = mockFetch(() => anthropicReply);
    const p = new ClaudeProvider();
    p.configure({ provider: 'claude', model: 'claude-opus-5-5', apiKey: 'sk-ant-x' });
    await p.chat([{ role: 'user', content: 'hi' }]);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(headersOf(calls[0])['x-api-key']).toBe('sk-ant-x');
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });
});

describe('Gemini on Vertex AI', () => {
  it('uses the Vertex publisher URL with a bearer instead of x-goog-api-key', async () => {
    const calls = mockFetch(() => geminiReply);
    const p = new GeminiProvider();
    p.configure({
      provider: 'gemini', model: 'gemini-4-argon',
      vertex: { project: 'acme-ai', location: 'europe-west4' },
      credentials: staticBearerSource('ya29.g', 'test'),
    });
    const r = await p.chat([{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('ok');
    expect(calls[0].url).toBe('https://europe-west4-aiplatform.googleapis.com/v1/projects/acme-ai/locations/europe-west4/publishers/google/models/gemini-4-argon:generateContent');
    expect(headersOf(calls[0]).Authorization).toBe('Bearer ya29.g');
    expect(headersOf(calls[0])['x-goog-api-key']).toBeUndefined();
  });
});

describe('OpenAI-compatible gateway', () => {
  it('appends /chat/completions to OPENAI_BASE_URL and sends the gateway token', async () => {
    const calls = mockFetch(() => openaiReply);
    const p = new OpenAIProvider();
    p.configure({ provider: 'openai', model: 'gpt-5.6-sol', baseUrl: 'https://ai.acme.dev/v1', credentials: staticBearerSource('gw', 'test') });
    await p.chat([{ role: 'user', content: 'hi' }]);
    expect(calls[0].url).toBe('https://ai.acme.dev/v1/chat/completions');
    expect(headersOf(calls[0]).Authorization).toBe('Bearer gw');
  });
});

describe('token sources', () => {
  it('runs the token command once and caches the result', async () => {
    const src = tokenCommandSource(`node -e "console.log('notice'); console.log('tok-' + 1)"`, 300);
    expect(await src.headers()).toEqual({ Authorization: 'Bearer tok-1' });
    const again = await src.headers();
    expect(again.Authorization).toBe('Bearer tok-1');
  });

  it('names only the program when the command fails, never its arguments', async () => {
    const src = tokenCommandSource('false --secret=hunter2', 300);
    await expect(src.headers()).rejects.toThrow(/STORY_UI_AUTH_TOKEN_COMMAND failed \(false\)/);
    await expect(src.headers()).rejects.not.toThrow(/hunter2/);
  });

  it('fetches an OAuth client-credentials token, caches it, and refreshes after invalidate()', async () => {
    let issued = 0;
    const calls = mockFetch(() => ({ access_token: `at-${++issued}`, expires_in: 3600, token_type: 'Bearer' }));
    const src = oauthClientCredentialsSource({ tokenUrl: 'https://idp.acme.dev/oauth2/token', clientId: 'story-ui', clientSecret: 's3cret', scope: 'llm.invoke' });
    expect(await src.headers()).toEqual({ Authorization: 'Bearer at-1' });
    expect(await src.headers()).toEqual({ Authorization: 'Bearer at-1' });
    expect(calls).toHaveLength(1);
    expect(String(calls[0].init.body)).toBe('grant_type=client_credentials&scope=llm.invoke');
    expect((calls[0].init.headers as any).Authorization).toBe(`Basic ${Buffer.from('story-ui:s3cret').toString('base64')}`);
    src.invalidate();
    expect(await src.headers()).toEqual({ Authorization: 'Bearer at-2' });
  });

  it('a 401 from the model endpoint drops the cached token', async () => {
    mockFetch(() => ({ error: 'expired' }), 401);
    const invalidate = vi.fn();
    const p = new ClaudeProvider();
    p.configure({ provider: 'claude', model: 'claude-opus-5-5', baseUrl: 'https://gw', credentials: { description: 't', headers: async () => ({ Authorization: 'Bearer old' }), invalidate } });
    await expect(p.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401/);
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('environment parsing', () => {
  it('turns Vertex on per provider and requires a project', () => {
    expect(vertexTargetFromEnv('claude', { STORY_UI_VERTEX: 'true', GOOGLE_CLOUD_PROJECT: 'p' })).toEqual({ project: 'p', location: 'global' });
    expect(vertexTargetFromEnv('gemini', { STORY_UI_VERTEX: 'claude', STORY_UI_VERTEX_PROJECT: 'p' })).toBeUndefined();
    expect(vertexTargetFromEnv('claude', { STORY_UI_VERTEX: 'claude,gemini', STORY_UI_VERTEX_PROJECT: 'p', STORY_UI_VERTEX_LOCATION: 'us-east5' })).toEqual({ project: 'p', location: 'us-east5' });
    expect(vertexTargetFromEnv('claude', { STORY_UI_VERTEX: 'true' })).toBeUndefined();
    expect(vertexTargetFromEnv('claude', {})).toBeUndefined();
  });

  it('picks the token command over OAuth, and needs both client id and secret for OAuth', () => {
    expect(bearerSourceFromEnv({ STORY_UI_AUTH_TOKEN_COMMAND: 'x', STORY_UI_OAUTH_TOKEN_URL: 'https://i/t' })?.description).toMatch(/token command/);
    expect(bearerSourceFromEnv({ STORY_UI_OAUTH_TOKEN_URL: 'https://i/t', STORY_UI_OAUTH_CLIENT_ID: 'a' })).toBeUndefined();
    expect(bearerSourceFromEnv({})).toBeUndefined();
  });

  it('joins base URLs the way the SDKs do', () => {
    expect(joinEndpoint('https://gw/v1/', '/chat/completions')).toBe('https://gw/v1/chat/completions');
    expect(joinEndpoint('https://gw/v1/chat/completions', '/chat/completions')).toBe('https://gw/v1/chat/completions');
  });
});
