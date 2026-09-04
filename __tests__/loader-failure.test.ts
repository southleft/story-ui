import { describe, it, expect } from 'vitest';
import { isLoaderFailure, renderFailureLine } from '../templates/StoryUIV2/renderFailure';
import { gateVerdict } from '../story-generator/verify/gate';

describe('Storybook failing to load a story is not the story failing', () => {
  it('recognises the loader errors and not a real code error', () => {
    for (const r of [
      'importers[path] is not a function',
      "Couldn't find story matching 'generated-x--default'",
      'Failed to fetch dynamically imported module: http://localhost:6101/src/stories/generated/a.stories.tsx',
      'Unable to load story',
    ]) expect(isLoaderFailure(r), r).toBe(true);

    for (const r of [
      "TypeError: Cannot read properties of undefined (reading 'map')",
      'Element type is invalid: expected a string but got: undefined',
      'ReferenceError: BrandBadge is not defined',
    ]) expect(isLoaderFailure(r), r).toBe(false);
  });

  it('explains a loader failure without blaming the composition', () => {
    const line = renderFailureLine('importers[path] is not a function');
    expect(line).toContain('Storybook could not load');
    expect(line).toContain('never run');
    expect(line).not.toContain('importers[');
    // A genuine code failure still reports what happened.
    expect(renderFailureLine('TypeError: x is not a function')).toContain('TypeError');
  });

  it('an infrastructure verdict is never retried by the gate', () => {
    // What verifyStory returns once the harness calls a loader failure
    // infrastructure: not_verified, which must not spend a regeneration.
    const infra: any = {
      outcome: 'not_verified',
      reason: "Storybook could not load the story's module: importers[path] is not a function",
      findings: [{ id: 'render-unavailable', severity: 'warning', class: 'infrastructure', message: 'not verified', repairable: false }],
      metrics: {},
    };
    const v = gateVerdict(infra);
    expect(v.shippable).toBe(false);
    expect(v.retryable).toBe(false);
    expect(v.reason).toContain('could not load');

    // Whereas a story that genuinely rendered nothing IS worth another attempt.
    const codeFailure: any = {
      outcome: 'issues',
      findings: [{ id: 'render-failed', severity: 'blocker', class: 'code', message: 'Story failed to render in the browser', repairable: true }],
      metrics: {},
    };
    expect(gateVerdict(codeFailure).retryable).toBe(true);
  });
});

describe('a composition must not resize when it is used', () => {
  it('states the rule for compositions and exempts single specimens', async () => {
    const { formatSpacingRules } = await import('../story-generator/knowledge/spacingFacts');
    const vocab: any = { primitives: [], tokens: [], utilities: null, typography: [], colourTiers: null };
    const text = formatSpacingRules(vocab, 'jsx', {});
    expect(text).toContain('width from the SPACE IT IS GIVEN');
    expect(text).toContain('switching a tab visibly resizes');
    expect(text).toContain('should NOT be stretched');
  });
});
