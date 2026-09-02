/**
 * The pure parts of the workspace's honesty fixes.
 *
 * Three places where the UI used to paint a worse outcome as a better one:
 * a negative pipeline phase drawn with the grey "finished" dot, a partial
 * verification wearing the same green badge as a full one, and the component
 * inventory — which did not exist, so "your design system" was a name with
 * nothing behind it. Each is a function without React or Express in it, so
 * each is tested as one.
 */

import { describe, it, expect } from 'vitest';
import {
  applyStep,
  stepStateForPhase,
  detailFromProgress,
  FAILED_PHASES,
  WARN_PHASES,
  type GenStep,
} from '../templates/StoryUIV2/useGeneration.js';
import {
  summarizeVerification,
  verificationFromCompletion,
  isPartialVerification,
} from '../templates/StoryUIV2/useSessions.js';
import { shapeInventory, inventorySourceOf } from '../mcp-server/routes/components.js';
import { luminanceOf } from '../templates/StoryUIV2/useAppearance.js';

describe('stepStateForPhase', () => {
  it('maps the three negative verdicts to failed', () => {
    for (const phase of ['runtime_heal_failed', 'verify_repair_failed', 'verify_issues']) {
      expect(stepStateForPhase(phase), phase).toBe('failed');
    }
  });

  it('maps "could not check" to warn, not failed', () => {
    expect(stepStateForPhase('verify_inconclusive')).toBe('warn');
  });

  it('leaves every other phase active', () => {
    for (const phase of ['saving', 'verifying', 'verified', 'llm_thinking', undefined]) {
      expect(stepStateForPhase(phase)).toBe('active');
    }
  });

  it('keeps the two sets disjoint', () => {
    for (const p of FAILED_PHASES) expect(WARN_PHASES.has(p)).toBe(false);
  });
});

describe('applyStep', () => {
  const t0 = 1_000;
  const push = (prev: GenStep[], id: string, opts: Partial<Omit<GenStep, 'id' | 'startedAt'>> = {}, now = t0) =>
    applyStep(prev, { id, label: opts.label ?? id, detail: opts.detail, state: opts.state }, now);

  it('closes the active step as done when the next one starts', () => {
    let steps = push([], 'saving');
    steps = push(steps, 'verifying', {}, t0 + 10);
    expect(steps.map(s => [s.id, s.state])).toEqual([['saving', 'done'], ['verifying', 'active']]);
  });

  it('records a failed phase as failed, and a later phase does not flip it back', () => {
    let steps = push([], 'verifying');
    steps = push(steps, 'verify_issues', { state: 'failed', label: 'Verification found 2 issues' }, t0 + 10);
    expect(steps.find(s => s.id === 'verify_issues')?.state).toBe('failed');
    // The previous step genuinely ran.
    expect(steps.find(s => s.id === 'verifying')?.state).toBe('done');
    steps = push(steps, 'saving', {}, t0 + 20);
    expect(steps.find(s => s.id === 'verify_issues')?.state).toBe('failed');
  });

  it('records an inconclusive verification as warn', () => {
    let steps = push([], 'verifying');
    steps = push(steps, 'verify_inconclusive', { state: 'warn' }, t0 + 10);
    expect(steps.find(s => s.id === 'verify_inconclusive')?.state).toBe('warn');
    steps = push(steps, 'verified', {}, t0 + 20);
    expect(steps.find(s => s.id === 'verify_inconclusive')?.state).toBe('warn');
  });

  it('re-emitting the ACTIVE phase keeps startedAt and label, updating only the detail', () => {
    let steps = push([], 'llm_thinking', { label: 'Writing the story' });
    steps = push(steps, 'llm_thinking', { label: 'Writing the story', detail: '1,200 characters written' }, t0 + 1_000);
    steps = push(steps, 'llm_thinking', { label: 'Writing the story', detail: '4,120 characters written' }, t0 + 2_000);
    expect(steps).toHaveLength(1);
    expect(steps[0].startedAt).toBe(t0);
    expect(steps[0].label).toBe('Writing the story');
    expect(steps[0].state).toBe('active');
    expect(steps[0].detail).toBe('4,120 characters written');
  });

  it('re-emitting the active phase with no detail keeps the last detail', () => {
    let steps = push([], 'llm_thinking', { detail: '900 characters written' });
    steps = push(steps, 'llm_thinking', {}, t0 + 1_000);
    expect(steps[0].detail).toBe('900 characters written');
    expect(steps[0].startedAt).toBe(t0);
  });

  it('re-activating a DONE step resets its clock (validating, per healing attempt)', () => {
    let steps = push([], 'validating');
    steps = push(steps, 'retry', {}, t0 + 5_000);
    expect(steps.find(s => s.id === 'validating')?.state).toBe('done');
    steps = push(steps, 'validating', {}, t0 + 6_000);
    const v = steps.find(s => s.id === 'validating')!;
    expect(v.state).toBe('active');
    expect(v.startedAt).toBe(t0 + 6_000);
    expect(steps.find(s => s.id === 'retry')?.state).toBe('done');
  });
});

describe('detailFromProgress', () => {
  it('formats the streaming character count', () => {
    expect(detailFromProgress({ charsWritten: 4120 })).toBe('4,120 characters written');
  });

  it('is undefined for anything that is not a count', () => {
    expect(detailFromProgress(undefined)).toBeUndefined();
    expect(detailFromProgress({})).toBeUndefined();
    expect(detailFromProgress({ charsWritten: 'lots' })).toBeUndefined();
    expect(detailFromProgress({ charsWritten: NaN })).toBeUndefined();
  });
});

describe('summarizeVerification with checks', () => {
  it('keeps checksRun and checksTotal from the metrics', () => {
    const s = summarizeVerification({
      outcome: 'verified',
      findings: [],
      metrics: { focusables: 4, checksRun: 3, checksTotal: 6 },
    });
    expect(s).toMatchObject({ outcome: 'verified', blockers: 0, focusables: 4, checksRun: 3, checksTotal: 6 });
  });

  it('leaves the counts absent when the server did not send them', () => {
    const s = summarizeVerification({ outcome: 'verified', findings: [], metrics: { focusables: 2 } })!;
    expect(s.checksRun).toBeUndefined();
    expect(s.checksTotal).toBeUndefined();
  });

  it('ignores counts that are not numbers', () => {
    const s = summarizeVerification({
      outcome: 'verified',
      findings: [],
      metrics: { checksRun: 'three' as any, checksTotal: -1 },
    })!;
    expect(s.checksRun).toBeUndefined();
    expect(s.checksTotal).toBeUndefined();
  });

  it('still counts blockers', () => {
    const s = summarizeVerification({
      outcome: 'issues',
      findings: [
        { id: 'a', severity: 'blocker', class: 'a11y', message: 'x' },
        { id: 'b', severity: 'warning', class: 'a11y', message: 'y' },
      ],
    })!;
    expect(s.blockers).toBe(1);
  });

  it('reads the counts back off a persisted completion too', () => {
    const s = verificationFromCompletion({ verification: { outcome: 'verified', checksRun: 6, checksTotal: 6 } })!;
    expect(s.checksRun).toBe(6);
    expect(s.checksTotal).toBe(6);
  });
});

describe('isPartialVerification', () => {
  it('is true only for a verified outcome with checks missing', () => {
    expect(isPartialVerification({ outcome: 'verified', blockers: 0, checksRun: 3, checksTotal: 6 })).toBe(true);
    expect(isPartialVerification({ outcome: 'verified', blockers: 0, checksRun: 6, checksTotal: 6 })).toBe(false);
  });

  it('never demotes a verdict whose counts are unknown', () => {
    expect(isPartialVerification({ outcome: 'verified', blockers: 0 })).toBe(false);
    expect(isPartialVerification({ outcome: 'verified', blockers: 0, checksRun: 3 })).toBe(false);
  });

  it('is false for the other outcomes regardless of counts', () => {
    expect(isPartialVerification({ outcome: 'issues', blockers: 1, checksRun: 3, checksTotal: 6 })).toBe(false);
    expect(isPartialVerification({ outcome: 'not_verified', blockers: 0, checksRun: 0, checksTotal: 6 })).toBe(false);
    expect(isPartialVerification(undefined)).toBe(false);
  });
});

describe('shapeInventory', () => {
  const discovered = [
    {
      name: 'Button',
      description: 'Buttons trigger actions and can carry an icon and a loading state.',
      category: 'form',
      props: ['variant', 'size', 'loading'],
      propTypes: [{ name: 'variant', type: 'string' }, { name: 'size', type: 'string' }, { name: 'loading', type: 'boolean' }, { name: 'onClick', type: 'fn' }] as any,
      filePath: '',
      source: { type: 'npm', path: '@mantine/core' },
    },
    {
      name: 'Tile',
      description: 'Tile component from Housekit',
      category: 'layout',
      props: ['padding'],
      filePath: '/proj/src/housekit/Tile.tsx',
      __componentPath: './src/housekit/Tile',
      source: { type: 'local', path: 'src/housekit' },
    },
    {
      name: 'Alert',
      description: '',
      props: [],
      __componentPath: '@mantine/core',
    },
    { name: '', description: 'nameless', props: [] },
  ];

  it('shapes rows sorted by name with provenance and counts', () => {
    const inv = shapeInventory(discovered, '@mantine/core');
    expect(inv.importPath).toBe('@mantine/core');
    expect(inv.components.map(c => c.name)).toEqual(['Alert', 'Button', 'Tile']);

    const button = inv.components.find(c => c.name === 'Button')!;
    expect(button).toMatchObject({
      importPath: '@mantine/core',
      category: 'form',
      propCount: 4,          // propTypes win over the plain names list
      hasDescription: true,
      source: 'npm',
    });

    const tile = inv.components.find(c => c.name === 'Tile')!;
    expect(tile).toMatchObject({
      importPath: './src/housekit/Tile',
      category: 'layout',
      propCount: 1,
      source: 'local',
    });
    // "Tile component from Housekit" says nothing beyond the name.
    expect(tile.hasDescription).toBe(false);

    const alert = inv.components.find(c => c.name === 'Alert')!;
    expect(alert).toMatchObject({ category: 'other', propCount: 0, hasDescription: false, description: '' });
  });

  it('drops entries without a name', () => {
    expect(shapeInventory(discovered, 'x').components.some(c => c.name === '')).toBe(false);
  });

  it('answers an empty discovery with an empty list, not an error', () => {
    expect(shapeInventory([], '@x/y')).toEqual({ importPath: '@x/y', components: [] });
  });
});

describe('inventorySourceOf', () => {
  it('trusts a declared npm or local source', () => {
    expect(inventorySourceOf({ name: 'A', source: { type: 'npm' }, filePath: '/proj/src/A.tsx' })).toBe('npm');
    expect(inventorySourceOf({ name: 'A', source: { type: 'local' } })).toBe('local');
    expect(inventorySourceOf({ name: 'A', source: { type: 'typescript' } })).toBe('local');
  });

  it('reads the file path when the source type says nothing', () => {
    expect(inventorySourceOf({ name: 'A', filePath: '/proj/src/ui/A.tsx' })).toBe('local');
    expect(inventorySourceOf({ name: 'A', filePath: '/proj/node_modules/@x/y/A.d.ts' })).toBe('npm');
    expect(inventorySourceOf({ name: 'A', filePath: 'C:\\proj\\node_modules\\x\\A.d.ts' })).toBe('npm');
  });

  it('reads a relative import specifier as local, a bare one as npm', () => {
    expect(inventorySourceOf({ name: 'A', __componentPath: './src/kit/A' })).toBe('local');
    expect(inventorySourceOf({ name: 'A', __componentPath: '@atlaskit/button' })).toBe('npm');
    expect(inventorySourceOf({ name: 'A' })).toBe('npm');
  });
});

describe('luminanceOf', () => {
  it('reads Storybook\'s two docs backgrounds apart', () => {
    expect(luminanceOf('rgb(255, 255, 255)')!).toBeGreaterThan(0.5);   // light theme content
    expect(luminanceOf('rgb(34, 36, 37)')!).toBeLessThan(0.5);         // dark theme content
  });

  it('treats a transparent colour as no signal', () => {
    expect(luminanceOf('rgba(0, 0, 0, 0)')).toBeNull();
    expect(luminanceOf('transparent')).toBeNull();
    expect(luminanceOf('')).toBeNull();
  });
});
