/**
 * Enterprise credentials and endpoints for the LLM providers.
 *
 * Teams that do not hand out long-lived API keys reach models one of three ways,
 * and each provider can use any of them:
 *
 * 1. Google Cloud Vertex AI (Model Garden): Claude and Gemini both run there.
 *    Auth is Application Default Credentials, which covers service accounts,
 *    workload identity federation (an `external_account` credentials file),
 *    GKE/Cloud Run workload identity, and `gcloud auth application-default login`.
 *       STORY_UI_VERTEX=true
 *       STORY_UI_VERTEX_PROJECT=my-project      (or GOOGLE_CLOUD_PROJECT)
 *       STORY_UI_VERTEX_LOCATION=global         (or GOOGLE_CLOUD_LOCATION; default global)
 *
 * 2. A company AI gateway (LiteLLM, Apigee, Kong, Portkey, an internal proxy):
 *       ANTHROPIC_BASE_URL=https://ai-gateway.example.com/anthropic
 *       OPENAI_BASE_URL=https://ai-gateway.example.com/v1
 *
 * 3. A short-lived bearer token, sent as `Authorization: Bearer <token>` to
 *    the gateway (or to Vertex, in place of ADC):
 *       STORY_UI_AUTH_TOKEN_COMMAND="gcloud auth print-access-token"
 *         any command that prints a token: an SSO CLI, `az account get-access-token
 *         --query accessToken -o tsv`, a vault helper. Re-run every
 *         STORY_UI_AUTH_TOKEN_TTL seconds (default 300).
 *       or OAuth 2.0 client credentials:
 *       STORY_UI_OAUTH_TOKEN_URL, STORY_UI_OAUTH_CLIENT_ID,
 *       STORY_UI_OAUTH_CLIENT_SECRET, STORY_UI_OAUTH_SCOPE (optional),
 *       STORY_UI_OAUTH_AUDIENCE (optional)
 *       or a static token: ANTHROPIC_AUTH_TOKEN (Claude only, as the Anthropic SDK reads it)
 *
 * Nothing here is used unless one of these variables is set; with only an API
 * key, every provider behaves exactly as before.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger.js';

const execAsync = promisify(exec);

/**
 * Something that can produce request auth headers. Providers call
 * `headers()` before every request and `invalidate()` after a 401 so the next
 * request fetches a fresh token.
 */
export interface CredentialSource {
  /** Shown in logs and the providers list, never the token itself. */
  readonly description: string;
  headers(): Promise<Record<string, string>>;
  invalidate(): void;
}

export interface VertexTarget {
  project: string;
  location: string;
}

/** Bearer token with a cache; `fetchToken` returns the token and its lifetime in seconds. */
class CachedBearer implements CredentialSource {
  private token?: string;
  private expiresAt = 0;
  private inflight?: Promise<string>;

  constructor(
    readonly description: string,
    private readonly fetchToken: () => Promise<{ token: string; ttlSeconds: number }>,
  ) {}

  async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  invalidate(): void {
    this.token = undefined;
    this.expiresAt = 0;
  }

  private async getToken(): Promise<string> {
    // Refresh a minute early so a token never expires between fetch and use.
    if (this.token && Date.now() < this.expiresAt - 60_000) return this.token;
    // Concurrent requests share one refresh instead of each running the command.
    if (!this.inflight) {
      this.inflight = this.fetchToken()
        .then(({ token, ttlSeconds }) => {
          this.token = token;
          this.expiresAt = Date.now() + ttlSeconds * 1000;
          return token;
        })
        .finally(() => { this.inflight = undefined; });
    }
    return this.inflight;
  }
}

/** Runs a shell command and uses its trimmed stdout as the bearer token. */
export function tokenCommandSource(command: string, ttlSeconds: number): CredentialSource {
  return new CachedBearer(`token command (${command.split(/\s+/)[0]})`, async () => {
    try {
      const { stdout } = await execAsync(command, { timeout: 30_000, maxBuffer: 1024 * 1024 });
      const token = stdout.trim();
      if (!token) throw new Error('command printed nothing');
      // Only the last line: some CLIs print a notice before the token.
      return { token: token.split(/\r?\n/).pop()!.trim(), ttlSeconds };
    } catch (err) {
      // The command line itself may hold secrets, and exec's own message
      // repeats it, so report only the program, exit code and stderr.
      const e = err as { code?: number | string; stderr?: string; message?: string };
      const reason = e.stderr?.trim().split('\n')[0]
        || (e.code !== undefined ? `exit code ${e.code}` : e.message === 'command printed nothing' ? e.message : 'failed');
      throw new Error(`STORY_UI_AUTH_TOKEN_COMMAND failed (${command.split(/\s+/)[0]}): ${reason}`);
    }
  });
}

/** OAuth 2.0 client-credentials grant (RFC 6749 §4.4). */
export function oauthClientCredentialsSource(opts: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
}): CredentialSource {
  return new CachedBearer(`OAuth client credentials (${new URL(opts.tokenUrl).host})`, async () => {
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (opts.scope) body.set('scope', opts.scope);
    if (opts.audience) body.set('audience', opts.audience);
    const res = await fetch(opts.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        // client_secret_basic, which every IdP must accept.
        Authorization: `Basic ${Buffer.from(`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`).toString('base64')}`,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`OAuth token request to ${new URL(opts.tokenUrl).host} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('OAuth token response had no access_token');
    return { token: json.access_token, ttlSeconds: Number(json.expires_in) || 3600 };
  });
}

/**
 * Google Application Default Credentials, via google-auth-library (an
 * optional dependency, loaded only when Vertex is in use). The library
 * caches and refreshes the token itself, including the STS exchange for
 * workload identity federation.
 */
export function googleAdcSource(): CredentialSource {
  let client: Promise<{ getAccessToken(): Promise<string | null | undefined> }> | undefined;
  const load = () => {
    if (!client) {
      client = (async () => {
        let mod: any;
        try {
          mod = await import('google-auth-library');
        } catch {
          throw new Error(
            'Vertex AI needs google-auth-library for Application Default Credentials. ' +
            'Install it (npm install google-auth-library), or set STORY_UI_AUTH_TOKEN_COMMAND="gcloud auth print-access-token".',
          );
        }
        const GoogleAuth = mod.GoogleAuth ?? mod.default?.GoogleAuth;
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        return auth.getClient();
      })();
      // A failed load (no credentials yet) must be retryable, not cached forever.
      client.catch(() => { client = undefined; });
    }
    return client;
  };
  return {
    description: 'Google Application Default Credentials',
    async headers() {
      const c = await load();
      const token = await c.getAccessToken();
      const value = typeof token === 'string' ? token : (token as any)?.token;
      if (!value) throw new Error('Application Default Credentials returned no access token');
      return { Authorization: `Bearer ${value}` };
    },
    invalidate() { client = undefined; },
  };
}

/** The bearer source an operator configured for gateways, if any. */
export function bearerSourceFromEnv(env: NodeJS.ProcessEnv = process.env): CredentialSource | undefined {
  const command = env.STORY_UI_AUTH_TOKEN_COMMAND?.trim();
  if (command) {
    const ttl = Number(env.STORY_UI_AUTH_TOKEN_TTL) || 300;
    return tokenCommandSource(command, ttl);
  }
  const tokenUrl = env.STORY_UI_OAUTH_TOKEN_URL?.trim();
  if (tokenUrl) {
    const clientId = env.STORY_UI_OAUTH_CLIENT_ID?.trim();
    const clientSecret = env.STORY_UI_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      logger.warn('STORY_UI_OAUTH_TOKEN_URL is set but STORY_UI_OAUTH_CLIENT_ID / STORY_UI_OAUTH_CLIENT_SECRET are not; OAuth is off');
      return undefined;
    }
    return oauthClientCredentialsSource({
      tokenUrl, clientId, clientSecret,
      scope: env.STORY_UI_OAUTH_SCOPE?.trim() || undefined,
      audience: env.STORY_UI_OAUTH_AUDIENCE?.trim() || undefined,
    });
  }
  return undefined;
}

/** A fixed bearer token (e.g. ANTHROPIC_AUTH_TOKEN). */
export function staticBearerSource(token: string, description: string): CredentialSource {
  return {
    description,
    async headers() { return { Authorization: `Bearer ${token}` }; },
    invalidate() {},
  };
}

function truthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|on)$/i.test(v.trim());
}

/**
 * Vertex target for a provider, or undefined when Vertex is off.
 * STORY_UI_VERTEX=true turns it on for Claude and Gemini; a list
 * (`claude`, `gemini`, `claude,gemini`) limits it to those.
 */
export function vertexTargetFromEnv(provider: 'claude' | 'gemini', env: NodeJS.ProcessEnv = process.env): VertexTarget | undefined {
  const flag = env.STORY_UI_VERTEX?.trim();
  if (!flag) return undefined;
  const enabled = truthy(flag) || flag.toLowerCase().split(/[\s,]+/).includes(provider);
  if (!enabled) return undefined;
  const project = (env.STORY_UI_VERTEX_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.ANTHROPIC_VERTEX_PROJECT_ID || '').trim();
  if (!project) {
    logger.warn(`STORY_UI_VERTEX is on for ${provider} but no project is set (STORY_UI_VERTEX_PROJECT or GOOGLE_CLOUD_PROJECT); Vertex is off`);
    return undefined;
  }
  const location = (env.STORY_UI_VERTEX_LOCATION || env.GOOGLE_CLOUD_LOCATION || env.CLOUD_ML_REGION || 'global').trim();
  return { project, location };
}

/** `https://{location}-aiplatform.googleapis.com`, or the global host. */
export function vertexHost(location: string): string {
  return location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`;
}

/** Full Vertex model URL for a publisher (`anthropic`, `google`) and method. */
export function vertexModelUrl(target: VertexTarget, publisher: string, model: string, method: string): string {
  return `${vertexHost(target.location)}/v1/projects/${encodeURIComponent(target.project)}/locations/${encodeURIComponent(target.location)}/publishers/${publisher}/models/${encodeURIComponent(model)}:${method}`;
}

/**
 * Join a base URL and an API path the way the official SDKs do: the base is
 * the API root (`https://gw.example.com/v1`), and a base that already ends in
 * the path is used as given.
 */
export function joinEndpoint(base: string, apiPath: string): string {
  const trimmed = base.replace(/\/+$/, '');
  if (trimmed.endsWith(apiPath)) return trimmed;
  return trimmed + apiPath;
}
