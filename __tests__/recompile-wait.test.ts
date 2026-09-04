/**
 * The repair loop writes a fix and re-verifies it. Judging the PREVIOUS render
 * makes a correct repair look useless, so the loop waits for the dev server to
 * serve new module text first.
 *
 * The ways that wait can fail are not one thing, and they used to be logged as
 * one line: "Storybook did not recompile in time". A run of the Carbon bench
 * showed that line three times, which sent an investigation after the dev
 * server — while one of the three cases is simply that the poll had no
 * baseline to compare against and never waited at all. These tests pin each
 * outcome apart, because a check that cannot run must not look like a check
 * that ran and found nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { waitForRecompile, moduleText } from '../story-generator/verify/renderHarness.js';

let server: http.Server | undefined;

async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  const { port } = server!.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>(r => server!.close(() => r()));
  server = undefined;
});

describe('waitForRecompile', () => {
  it('reports the change as soon as the served text differs', async () => {
    let body = 'before';
    const url = await serve((_req, res) => { res.writeHead(200); res.end(body); });
    const before = await moduleText(url, 'src/x.stories.tsx');
    expect(before).toBe('before');
    setTimeout(() => { body = 'after the repair'; }, 60);
    const out = await waitForRecompile(url, 'src/x.stories.tsx', before, 3000, 25);
    expect(out.live).toBe(true);
    expect(out.reason).toBe('changed');
    expect(out.beforeBytes).toBe(6);
    expect(out.afterBytes).toBe('after the repair'.length);
  });

  it('never waits when there is no baseline, and says so', async () => {
    const url = await serve((_req, res) => { res.writeHead(200); res.end('anything'); });
    const out = await waitForRecompile(url, 'src/x.stories.tsx', null, 3000, 25);
    expect(out.live).toBe(false);
    expect(out.reason).toBe('no_baseline');
    // The distinction that matters: this is zero elapsed time, not a timeout.
    expect(out.waitedMs).toBe(0);
  });

  it('separates a served-but-unchanged module from one that never served', async () => {
    const stable = await serve((_req, res) => { res.writeHead(200); res.end('same'); });
    const timedOut = await waitForRecompile(stable, 'src/x.stories.tsx', 'same', 150, 25);
    expect(timedOut.reason).toBe('timeout');
    expect(timedOut.beforeBytes).toBe(4);
    expect(timedOut.afterBytes).toBe(4);
    await new Promise<void>(r => server!.close(() => r()));

    server = undefined;
    const missing = await serve((_req, res) => { res.writeHead(404); res.end('nope'); });
    const unreachable = await waitForRecompile(missing, 'src/x.stories.tsx', 'same', 150, 25);
    expect(unreachable.reason).toBe('unreachable');
    expect(unreachable.status).toBe(404);
  });
});
