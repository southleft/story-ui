import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  ProviderType,
  ProviderConfig,
  ModelInfo,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ValidationResult,
  MessageContent,
} from './types.js';
import { BaseLLMProvider } from './base-provider.js';
import {
  CLAUDE_MODELS,
  CLAUDE_KEY_ENV_VARS,
  STREAM_HARD_CAP_MS,
  resolveEffort,
  mapStopReason,
  toAnthropicContent,
  toUsage,
} from './claude-provider.js';

/**
 * Stripped from the child process so a key in the server's environment
 * cannot silently switch billing from the subscription back to the API.
 */
const STRIPPED_ENV = [...CLAUDE_KEY_ENV_VARS, 'ANTHROPIC_AUTH_TOKEN'];

type UserBlocks = Exclude<SDKUserMessage['message']['content'], string>;

export const CLAUDE_CODE_MODELS: ModelInfo[] = CLAUDE_MODELS.map(model => ({
  ...model,
  provider: 'claude-code',
}));

/**
 * The Claude models through the Claude Agent SDK, billed to the machine's
 * Claude Code login. There is no key to detect, so the provider counts as
 * configured only once something has selected it and given it a model
 * (initializeFromEnv does, when DEFAULT_PROVIDER=claude-code).
 */
export class ClaudeCodeProvider extends BaseLLMProvider {
  readonly name = 'Claude Code';
  readonly type: ProviderType = 'claude-code';
  readonly supportedModels = CLAUDE_CODE_MODELS;
  protected readonly requiresApiKey = false;

  constructor(config?: Partial<ProviderConfig>) {
    super(config);
    this.setProviderType();
  }

  async validateApiKey(): Promise<ValidationResult> {
    return { valid: true, models: this.supportedModels };
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    let content = '';
    let done: StreamChunk | undefined;
    for await (const chunk of this.chatStream(messages, options)) {
      if (chunk.type === 'text') content += chunk.content ?? '';
      else if (chunk.type === 'error') throw new Error(chunk.error);
      else if (chunk.type === 'done') done = chunk;
    }
    const response: ChatResponse = {
      id: `claude-code-${Date.now()}`,
      model: done?.model || options?.model || this.config.model,
      content,
      finishReason: (done?.finishReason as ChatResponse['finishReason']) ?? 'stop',
      usage: done?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
    this.logResponse(response);
    return response;
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    this.validateMessages(messages);
    this.logRequest(messages, options);

    const model = options?.model || this.config.model;
    const idleMs = this.config.timeout || 120000;
    const hardCapMs = options?.timeoutMs || STREAM_HARD_CAP_MS;
    const abort = new AbortController();
    const stop = (reason: string) => abort.abort(new Error(reason));
    const onAbort = () => stop('Claude Code request was cancelled');
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    const hardCap = setTimeout(() => stop(`Claude Code request exceeded its ${hardCapMs}ms budget`), hardCapMs);
    hardCap.unref?.();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop(`no output from Claude Code for ${idleMs}ms`), idleMs);
      idleTimer.unref?.();
    };
    touch();

    let streamedText = false;
    let truncated = false;
    let servedModel = model;
    try {
      // Loaded here, not at module scope: the SDK is a 1.5 MB bundle every
      // server start and CLI run would otherwise pay for.
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      for await (const message of query({ prompt: toPrompt(messages), options: this.queryOptions(model, options, abort) })) {
        touch();
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type !== 'content_block_delta') continue;
          if (event.delta.type === 'text_delta') {
            streamedText = true;
            yield { type: 'text', content: event.delta.text };
          } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
            yield { type: 'thinking', content: event.delta.thinking };
          }
        } else if (message.type === 'assistant') {
          servedModel = message.message.model || servedModel;
          if (message.error === 'max_output_tokens') {
            truncated = true;
          } else if (message.error) {
            yield { type: 'error', error: describeError(message.error) };
            return;
          }
          if (!streamedText) {
            for (const block of message.message.content) {
              if (block.type === 'text') yield { type: 'text', content: block.text };
            }
          }
        } else if (message.type === 'result') {
          if (message.subtype !== 'success') {
            yield { type: 'error', error: message.errors.join('; ') || message.subtype };
            return;
          }
          if (message.is_error && !truncated) {
            yield { type: 'error', error: message.result || 'Claude Code returned an error' };
            return;
          }
          yield {
            type: 'done',
            model: servedModel,
            finishReason: truncated ? 'length' : mapStopReason(message.stop_reason),
            usage: toUsage(message.usage),
          };
          return;
        }
      }
    } catch (error) {
      const cause = abort.signal.aborted ? abort.signal.reason : error;
      yield { type: 'error', error: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      clearTimeout(hardCap);
      if (idleTimer) clearTimeout(idleTimer);
      options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  private queryOptions(model: string, options: ChatOptions | undefined, abort: AbortController): Options {
    const env = { ...process.env };
    for (const key of STRIPPED_ENV) delete env[key];

    return {
      model,
      systemPrompt: this.buildSystemPrompt(options),
      tools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      effort: resolveEffort(options),
      abortController: abort,
      env,
    };
  }
}

async function* toPrompt(messages: ChatMessage[]): AsyncIterable<SDKUserMessage> {
  const turns = messages.filter(message => message.role !== 'system');
  const last = turns[turns.length - 1];
  const lastIsUser = last?.role === 'user';
  const history = lastIsUser ? turns.slice(0, -1) : turns;

  const content: UserBlocks = [];
  if (history.length > 0) {
    const transcript = history
      .map(message => `<${message.role}>\n${textOf(message.content)}\n</${message.role}>`)
      .join('\n');
    content.push({ type: 'text', text: `Conversation so far:\n${transcript}\n\nContinue from the latest user message.` });
  }
  content.push(...(lastIsUser ? toBlocks(last.content) : [{ type: 'text' as const, text: 'Continue.' }]));

  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  };
}

function textOf(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content;
  return content.map(item => (item.type === 'text' ? item.text : `[${item.type}]`)).join('\n');
}

function toBlocks(content: string | MessageContent[]): UserBlocks {
  const blocks = toAnthropicContent(content);
  return (typeof blocks === 'string' ? [{ type: 'text', text: blocks }] : blocks) as UserBlocks;
}

function describeError(code: string): string {
  switch (code) {
    case 'authentication_failed':
    case 'verification_required':
    case 'oauth_org_not_allowed':
      return `Claude Code is not logged in. Run \`claude auth login\`, or set DEFAULT_PROVIDER to a provider with an API key. (${code})`;
    case 'rate_limit':
      return 'Claude Code usage limit reached for this subscription window. Wait for it to reset or switch to an API-key provider.';
    default:
      return `Claude Code error: ${code}`;
  }
}
