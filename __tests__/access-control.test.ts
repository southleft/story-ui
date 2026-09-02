/**
 * The server had no authentication and a README that said to expose it
 * publicly. Now: loopback-only by default, token when exposed.
 */
import { describe, it, expect } from 'vitest';
import { resolveAccessPolicy, accessControl, __test } from '../mcp-server/auth.js';

function run(policy: ReturnType<typeof resolveAccessPolicy>, req: any) {
  const res: any = {
    statusCode: 200, headers: {} as Record<string, string>, body: undefined as any, redirected: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
    redirect(c: number, to: string) { this.statusCode = c; this.redirected = to; },
  };
  let passed = false;
  accessControl(policy)({ method: 'GET', path: '/mcp/components', originalUrl: '/mcp/components', query: {}, headers: {}, ...req }, res, () => { passed = true; });
  return { passed, res };
}

describe('resolveAccessPolicy', () => {
  it('binds loopback with no token by default', () => {
    const p = resolveAccessPolicy({});
    expect(p.host).toBe('127.0.0.1');
    expect(p.publicMode).toBe(false);
    expect(p.token).toBeNull();
  });

  it('refuses a public deployment without a token', () => {
    expect(() => resolveAccessPolicy({ STORYBOOK_PROXY_ENABLED: 'true' })).toThrow(/STORY_UI_TOKEN/);
    expect(() => resolveAccessPolicy({ RAILWAY_ENVIRONMENT: 'production' })).toThrow(/STORY_UI_TOKEN/);
    expect(() => resolveAccessPolicy({ STORY_UI_HOST: '0.0.0.0' })).toThrow(/STORY_UI_TOKEN/);
  });

  it('allows public mode with a token, or with the explicit unsafe override', () => {
    const p = resolveAccessPolicy({ STORYBOOK_PROXY_ENABLED: 'true', STORY_UI_TOKEN: 'abc' });
    expect(p.host).toBe('0.0.0.0');
    expect(p.token).toBe('abc');
    const open = resolveAccessPolicy({ STORYBOOK_PROXY_ENABLED: 'true', STORY_UI_ALLOW_UNAUTHENTICATED: 'true' });
    expect(open.unauthenticatedPublic).toBe(true);
  });
});

describe('accessControl in loopback mode', () => {
  const policy = resolveAccessPolicy({});

  it('passes loopback hosts', () => {
    for (const host of ['localhost:4001', '127.0.0.1:4001', '[::1]:4001', 'localhost']) {
      expect(run(policy, { headers: { host } }).passed, host).toBe(true);
    }
  });

  it('rejects a rebound host name, which is how a web page reaches a local server', () => {
    const { passed, res } = run(policy, { headers: { host: 'evil.example.com' } });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('always answers /health', () => {
    expect(run(policy, { path: '/health', headers: { host: 'anything' } }).passed).toBe(true);
  });
});

describe('accessControl in token mode', () => {
  const policy = resolveAccessPolicy({ STORY_UI_TOKEN: 'secret-token' });

  it('rejects a request with no token', () => {
    const { passed, res } = run(policy, { headers: { host: 'localhost:4001' } });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('accepts a bearer header, a custom header, and the cookie', () => {
    expect(run(policy, { headers: { authorization: 'Bearer secret-token' } }).passed).toBe(true);
    expect(run(policy, { headers: { 'x-story-ui-token': 'secret-token' } }).passed).toBe(true);
    expect(run(policy, { headers: { cookie: `a=b; ${__test.COOKIE_NAME}=secret-token` } }).passed).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(run(policy, { headers: { authorization: 'Bearer nope' } }).passed).toBe(false);
  });

  it('turns ?token= on a GET into a cookie and a redirect without the secret', () => {
    const { passed, res } = run(policy, { originalUrl: '/?path=/story/x&token=secret-token', query: { token: 'secret-token' }, headers: {} });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(302);
    expect(res.redirected).toBe('/?path=%2Fstory%2Fx');
    expect(res.headers['Set-Cookie']).toMatch(/story_ui_token=secret-token; Path=\/; HttpOnly/);
  });
});
