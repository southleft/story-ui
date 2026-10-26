/**
 * HTTPS_PROXY / HTTP_PROXY route the server's fetch traffic through a proxy,
 * NO_PROXY is honoured, and loopback is always direct. The end-to-end case
 * uses a hostname that does not resolve: it can only succeed via the proxy.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import {
  installOutboundProxy,
  redactProxyUrl,
  resolveProxySettings,
} from '../story-generator/outboundProxy.js';

describe('resolveProxySettings', () => {
  it('returns null when no proxy is set', () => {
    expect(resolveProxySettings({})).toBeNull();
    expect(resolveProxySettings({ HTTPS_PROXY: '  ' })).toBeNull();
  });

  it('falls back to HTTP_PROXY for HTTPS traffic', () => {
    const s = resolveProxySettings({ HTTP_PROXY: 'http://proxy:8080' });
    expect(s?.httpsProxy).toBe('http://proxy:8080');
  });

  it('reads lowercase variables', () => {
    const s = resolveProxySettings({ https_proxy: 'http://proxy:3128', no_proxy: 'corp.internal' });
    expect(s?.httpsProxy).toBe('http://proxy:3128');
    expect(s?.noProxy.split(',')).toContain('corp.internal');
  });

  it('always exempts loopback, without duplicating a declared entry', () => {
    const s = resolveProxySettings({ HTTPS_PROXY: 'http://proxy:8080', NO_PROXY: 'localhost, .corp' });
    expect(s?.noProxy.split(',')).toEqual(['localhost', '.corp', '127.0.0.1', '::1']);
  });
});

describe('redactProxyUrl', () => {
  it('hides credentials', () => {
    expect(redactProxyUrl('http://user:s3cret@proxy:8080')).toBe('http://***@proxy:8080');
  });

  it('leaves a credential-free URL alone', () => {
    expect(redactProxyUrl('http://proxy:8080/')).toBe('http://proxy:8080');
  });
});

describe('installOutboundProxy', () => {
  const original = getGlobalDispatcher();
  afterEach(() => setGlobalDispatcher(original));

  it('installs nothing when no proxy is set', () => {
    expect(installOutboundProxy({})).toBe(false);
    expect(getGlobalDispatcher()).toBe(original);
  });

  it('routes fetch through the proxy, and keeps loopback direct', async () => {
    const seen: string[] = [];
    const proxy = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.end('via-proxy');
    });
    // undici tunnels even plain HTTP with CONNECT; answer inside the tunnel.
    proxy.on('connect', (req, socket) => {
      seen.push(`CONNECT ${req.url}`);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      proxy.emit('connection', socket);
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const { port } = proxy.address() as AddressInfo;

    try {
      expect(installOutboundProxy({ HTTP_PROXY: `http://127.0.0.1:${port}` })).toBe(true);

      const proxied = await fetch('http://llm-provider.invalid/v1/messages');
      expect(await proxied.text()).toBe('via-proxy');

      await (await fetch(`http://localhost:${port}/direct`)).text();

      // The provider call was tunnelled; the loopback call arrived directly.
      expect(seen).toEqual(['CONNECT llm-provider.invalid:80', '/v1/messages', '/direct']);
    } finally {
      proxy.close();
    }
  });
});
