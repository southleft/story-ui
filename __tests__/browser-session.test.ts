/**
 * One browser per generation.
 *
 * Verification launched a fresh Chromium for every render — the launch probe,
 * the runtime validator, verification, each repair pass — up to six per
 * generation. These pin the session that replaces it: acquire is idempotent,
 * release is counted, close is unconditional, the launch probe's browser is
 * the one that gets reused, and a render that borrows the shared browser
 * gives back only its own context.
 *
 * The first block runs against a fake Playwright so it is deterministic
 * everywhere; the last block launches a real Chromium when one is available.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  acquireBrowser,
  releaseBrowser,
  closeBrowserSession,
  currentBrowser,
} from '../story-generator/verify/browserSession.js';
import { canLaunchBrowser } from '../story-generator/verify/hostTooling.js';
import { testHostTooling } from './helpers/hostProject.js';
import { renderStory } from '../story-generator/verify/renderHarness.js';

function fakeBrowser() {
  const page = {
    on: vi.fn(),
    goto: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    evaluate: vi.fn(async () => ''),
    waitForTimeout: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const context = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  let connected = true;
  return {
    isConnected: () => connected,
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => { connected = false; }),
    /** Test seam: simulate a crash. */
    crash: () => { connected = false; },
    page,
    context,
  };
}

function fakeTooling(launch = vi.fn(async () => fakeBrowser())) {
  const tooling = { playwright: { chromium: { launch } }, axePath: null, resolvedFrom: 'fake' } as any;
  return { tooling, launch };
}

afterEach(async () => {
  await closeBrowserSession();
});

describe('browser session (fake playwright)', () => {
  it('launches once for concurrent acquires and hands everyone the same browser', async () => {
    const { tooling, launch } = fakeTooling();
    const [a, b] = await Promise.all([acquireBrowser(tooling), acquireBrowser(tooling)]);
    const c = await acquireBrowser(tooling);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(currentBrowser()).toBe(a);
  });

  it('closes only when the last holder releases', async () => {
    const { tooling } = fakeTooling();
    const browser = await acquireBrowser(tooling);
    await acquireBrowser(tooling);

    await releaseBrowser();
    expect(browser.close).not.toHaveBeenCalled();
    expect(currentBrowser()).toBe(browser);

    await releaseBrowser();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(currentBrowser()).toBeNull();
  });

  it('closeBrowserSession closes regardless of holders, and a later acquire relaunches', async () => {
    const { tooling, launch } = fakeTooling();
    const first = await acquireBrowser(tooling);
    await acquireBrowser(tooling);

    await closeBrowserSession();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(currentBrowser()).toBeNull();

    const second = await acquireBrowser(tooling);
    expect(second).not.toBe(first);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('relaunches when the shared browser has disconnected', async () => {
    const { tooling, launch } = fakeTooling();
    const first = await acquireBrowser(tooling);
    first.crash();
    expect(currentBrowser()).toBeNull();

    const second = await acquireBrowser(tooling);
    expect(second).not.toBe(first);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('the launch probe leaves the shared browser open for the renders that follow', async () => {
    const { tooling, launch } = fakeTooling();
    const probe = await canLaunchBrowser(tooling);
    expect(probe.ok).toBe(true);

    const warmed = currentBrowser();
    expect(warmed).not.toBeNull();
    expect(warmed.close).not.toHaveBeenCalled();

    // The browser the probe proved can launch is the one acquire hands out.
    const acquired = await acquireBrowser(tooling);
    expect(acquired).toBe(warmed);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('a failed launch surfaces to the caller and leaves nothing half-open', async () => {
    const launch = vi.fn(async () => { throw new Error('Executable doesn\'t exist'); });
    const { tooling } = fakeTooling(launch);

    await expect(acquireBrowser(tooling)).rejects.toThrow(/Executable/);
    expect(currentBrowser()).toBeNull();

    const probe = await canLaunchBrowser(tooling);
    expect(probe).toEqual({ ok: false, error: expect.stringMatching(/Executable/) });

    // Not a poisoned promise: the next attempt tries again.
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('renderStory borrows the session browser and closes only its context', async () => {
    const { tooling, launch } = fakeTooling();
    const browser = await acquireBrowser(tooling);

    const render = await renderStory({ storybookUrl: 'http://localhost:6101', storyId: 'generated-x--default', tooling });
    expect(render.ok).toBe(true);
    expect(browser.newContext).toHaveBeenCalledTimes(1);
    expect(browser.page.goto).toHaveBeenCalledWith(
      'http://localhost:6101/iframe.html?id=generated-x--default&viewMode=story',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );

    await render.dispose();
    expect(browser.page.close).toHaveBeenCalledTimes(1);
    expect(browser.context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(currentBrowser()).toBe(browser);
  });

  it('renderStory with no session launches and closes its own browser — the old behaviour', async () => {
    const { tooling, launch } = fakeTooling();
    expect(currentBrowser()).toBeNull();

    const render = await renderStory({ storybookUrl: 'http://localhost:6101', storyId: 's', tooling });
    expect(render.ok).toBe(true);
    expect(launch).toHaveBeenCalledTimes(1);
    const own = await launch.mock.results[0].value;

    await render.dispose();
    expect(own.context.close).toHaveBeenCalledTimes(1);
    expect(own.close).toHaveBeenCalledTimes(1);
    expect(currentBrowser()).toBeNull();
  });

  it('renderStory prefers an explicitly passed browser over the session', async () => {
    const { tooling, launch } = fakeTooling();
    const session = await acquireBrowser(tooling);
    const explicit = fakeBrowser();

    const render = await renderStory({ storybookUrl: 'http://x', storyId: 's', tooling, browser: explicit });
    expect(render.ok).toBe(true);
    expect(explicit.newContext).toHaveBeenCalledTimes(1);
    expect(session.newContext).not.toHaveBeenCalled();

    await render.dispose();
    expect(explicit.close).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

/**
 * A real browser, resolved from a host project the way the pipeline resolves
 * it. Skipped when the host has no Playwright.
 */
const realTooling = testHostTooling();

describe.runIf(realTooling)('browser session (real chromium)', { retry: 2 }, () => {
  it('acquire twice returns one live browser; release counts down; the last release ends it', async () => {
    const a = await acquireBrowser(realTooling!);
    const b = await acquireBrowser(realTooling!);
    expect(a).toBe(b);
    expect(a.isConnected()).toBe(true);

    // A context per render, on the shared browser.
    const context = await a.newContext();
    const page = await context.newPage();
    await page.setContent('<div id="storybook-root"><p>hi</p></div>');
    expect(await page.textContent('p')).toBe('hi');
    await context.close();
    expect(a.isConnected()).toBe(true);

    await releaseBrowser();
    expect(a.isConnected()).toBe(true);
    expect(currentBrowser()).toBe(a);

    await releaseBrowser();
    expect(a.isConnected()).toBe(false);
    expect(currentBrowser()).toBeNull();
  }, 60_000);
});
