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
  it('leaves the width to the author and forbids only content-dependent width', async () => {
    const { formatSpacingRules } = await import('../story-generator/knowledge/spacingFacts');
    const vocab: any = { primitives: [], tokens: [], utilities: null, typography: [], colourTiers: null };
    const text = formatSpacingRules(vocab, 'jsx', {});
    // The width is the author's choice; only the dependence on content is a rule.
    expect(text).toContain('Choose the width the request calls for');
    expect(text).toContain('must not depend on');
    expect(text).not.toContain('must take its width from the SPACE IT IS GIVEN');
  });
});

describe('the preview root fills the canvas', () => {
  it('appends the rule once, keeps the project\'s own CSS, and spares centered layouts', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path');
    const { ensurePreviewRootCss, PREVIEW_ROOT_MARKER } = await import('../cli/setup');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-'));
    fs.mkdirSync(path.join(dir, '.storybook'));
    const theirs = '<style>\n  body.sb-main-padded { display: flex !important; align-items: center !important; }\n</style>\n';
    fs.writeFileSync(path.join(dir, '.storybook', 'preview-head.html'), theirs);

    const first = ensurePreviewRootCss(dir);
    expect(first.action).toBe('appended');
    const after = fs.readFileSync(path.join(dir, '.storybook', 'preview-head.html'), 'utf8');
    expect(after).toContain('body.sb-main-padded { display: flex');           // theirs survives
    expect(after).toContain('body:not(.sb-main-centered) #storybook-root { width: 100%; }');
    expect(after).toContain(PREVIEW_ROOT_MARKER);

    // Idempotent: running update again changes nothing.
    expect(ensurePreviewRootCss(dir).action).toBe('unchanged');
    expect(fs.readFileSync(path.join(dir, '.storybook', 'preview-head.html'), 'utf8')).toBe(after);

    // A project with no preview-head gets one.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'preview2-'));
    fs.mkdirSync(path.join(fresh, '.storybook'));
    expect(ensurePreviewRootCss(fresh).action).toBe('created');
  });
});
