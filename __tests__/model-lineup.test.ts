/**
 * The model lineup is a set of facts about three upstream APIs, and each fact
 * here once failed silently:
 *
 * - `gemini-3.1-pro` was never served (404), and the alias table remapped the
 *   working `gemini-3.1-pro-preview` ONTO it, so every Gemini generation
 *   failed. The invariant that would have caught it: every alias target and
 *   every default is a model the provider lists.
 * - Haiku 5.5 rejects `temperature` with a 400; the title call sends 0.7.
 * - The refusal fallback must go out with its beta header, and only to models
 *   documented for it, or every request to the others 400s.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_MODELS,
  CLAUDE_LEGACY_MODEL_ALIASES,
  CLAUDE_SMALL_MODEL,
  ClaudeProvider,
} from '../story-generator/llm-providers/claude-provider.js';
import {
  GEMINI_MODELS,
  GEMINI_LEGACY_MODEL_ALIASES,
  GEMINI_SMALL_MODEL,
  GeminiProvider,
} from '../story-generator/llm-providers/gemini-provider.js';
import {
  OPENAI_MODELS,
  OPENAI_LEGACY_MODEL_ALIASES,
  OPENAI_SMALL_MODEL,
} from '../story-generator/llm-providers/openai-provider.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function installFetch(body: unknown) {
  const spy = vi.fn(async (_url: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

const CLAUDE_REPLY = {
  id: 'msg_1', type: 'message', role: 'assistant', model: 'm',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

const lineups = [
  { provider: 'claude', models: CLAUDE_MODELS, aliases: CLAUDE_LEGACY_MODEL_ALIASES, small: CLAUDE_SMALL_MODEL, defaultModel: new ClaudeProvider({ apiKey: 'k' }).getConfig().model },
  { provider: 'gemini', models: GEMINI_MODELS, aliases: GEMINI_LEGACY_MODEL_ALIASES, small: GEMINI_SMALL_MODEL, defaultModel: new GeminiProvider({ apiKey: 'k' }).getConfig().model },
  { provider: 'openai', models: OPENAI_MODELS, aliases: OPENAI_LEGACY_MODEL_ALIASES, small: OPENAI_SMALL_MODEL, defaultModel: undefined },
];

describe.each(lineups)('$provider lineup', ({ models, aliases, small, defaultModel }) => {
  const listed = new Set(models.map(m => m.id));

  it('aliases only onto listed models, and never alias a listed model', () => {
    for (const [from, to] of Object.entries(aliases)) {
      expect(listed, `${from} -> ${to}`).toContain(to);
      expect(listed.has(from), `${from} is listed AND aliased away`).toBe(false);
    }
  });

  it('uses listed models for the default and the small model', () => {
    expect(listed).toContain(small);
    if (defaultModel) expect(listed).toContain(defaultModel);
  });
});

describe('Claude request shape per model', () => {
  async function send(model: string, options: Record<string, unknown> = {}) {
    const spy = installFetch(CLAUDE_REPLY);
    await new ClaudeProvider({ apiKey: 'k', model } as any)
      .chat([{ role: 'user', content: 'hi' }], { temperature: 0.7, ...options });
    const init = spy.mock.calls[0][1] as RequestInit;
    return { body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> };
  }

  it('sends no temperature to Haiku 5.5, and gives it adaptive thinking with effort', async () => {
    vi.stubEnv('CLAUDE_EFFORT', ''); // the developer's shell may set one
    const { body } = await send('claude-haiku-5-5');
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'high' });
  });

  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1'])(
    'asks %s for the server-side refusal fallback, with its beta header',
    async model => {
      const { body, headers } = await send(model);
      expect(body.fallbacks).toBe('default');
      expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    },
  );

  it('sends no fallback to models not documented for it', async () => {
    const { body, headers } = await send('claude-haiku-5-5');
    expect(body.fallbacks).toBeUndefined();
    expect(headers['anthropic-beta']).toBeUndefined();
  });
});

describe('Gemini request routing', () => {
  it.each(['gemini-3.1-pro', 'gemini-3.1-pro-preview'])('sends %s to a model that is served', async model => {
    const spy = installFetch({
      candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }],
    });
    await new GeminiProvider({ apiKey: 'k', model } as any).chat([{ role: 'user', content: 'hi' }]);
    expect(String(spy.mock.calls[0][0])).toContain('/models/gemini-4-argon:generateContent');
  });
});
