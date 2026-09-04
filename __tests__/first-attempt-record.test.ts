/**
 * The first-attempt bench's record shaping.
 *
 * The cases that matter are the ones a live run will not produce on demand: a
 * stream that ends without a completion, a server too old to send `gate`, a
 * verification that could not judge. Every one of them must come out as
 * UNKNOWN — distinct from both clean and dirty — because the whole point of
 * the metric is that it cannot be gamed by a check that silently did not run.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — the bench is plain ESM JavaScript, deliberately outside tsconfig.
import { buildRecord, summarise, headline, classifyValidationError, storyBlockerVerdict, median } from '../bench/lib/firstAttemptRecord.mjs';
// @ts-expect-error — same.
import { PROMPTS, selectSuite } from '../bench/firstAttempt.mjs';

const P = { id: 'c01', suite: 'classic', complexity: 'simple', prompt: 'A primary button' };

const ev = (type: string, data: unknown) => ({ type, timestamp: 0, data });
const progress = (phase: string, message = '') => ev('progress', { step: 1, totalSteps: 11, phase, message });

function completion(over: Record<string, unknown> = {}) {
  return ev('completion', {
    success: true,
    storyId: 'story-abc',
    fileName: 'button-abc12345.stories.tsx',
    summary: { action: 'created', description: '' },
    metrics: { totalTimeMs: 30000, llmCallsCount: 2 },
    validation: { isValid: true, errors: [], warnings: [], autoFixApplied: false, attempts: 1, selfHealingUsed: false },
    verification: { outcome: 'verified', findings: [] },
    gate: { attempts: 1, bestAttempt: 1, shippable: true, reason: 'verified clean' },
    ...over,
  });
}

const validationOk = ev('validation', { isValid: true, errors: [], warnings: [], autoFixApplied: false });

describe('firstAttemptClean', () => {
  it('is true only when validation passed round 1, verification found no story blocker, and the gate spent one attempt', () => {
    const r = buildRecord({ prompt: P, events: [validationOk, progress('verified'), completion()], durationMs: 31000 });
    expect(r.firstAttemptClean).toBe(true);
    expect(r.validation.attempts).toBe(1);
    expect(r.gate.attempts).toBe(1);
    expect(r.modelCalls).toBe(2);
    expect(r.seconds).toBe(31);
  });

  it('is false when the first output failed validation, even though healing made it valid', () => {
    const events = [
      ev('validation', {
        isValid: false,
        errors: ['Line 4: <Button tone="loud"> it accepts only "primary" | "secondary"'],
        errorsByBucket: { syntax: [], pattern: [], import: ['Line 4: <Button tone="loud"> it accepts only "primary" | "secondary"'] },
        warnings: [], autoFixApplied: false,
      }),
      ev('retry', { attempt: 2, maxAttempts: 3, reason: 'AI self-healing: fixing validation errors', errors: [] }),
      validationOk,
      progress('verified'),
      completion({ validation: { isValid: true, errors: [], warnings: [], autoFixApplied: false, attempts: 2, selfHealingUsed: true } }),
    ];
    const r = buildRecord({ prompt: P, events, durationMs: 60000 });
    expect(r.firstAttemptClean).toBe(false);
    expect(r.validation.attempts).toBe(2);
    expect(r.validation.passedFirstRound).toBe(false);
    expect(r.validation.rounds[0].errors[0].class).toBe('prop-bad-value');
    expect(r.validation.rounds[0].errors[0].bucket).toBe('import');
  });

  it('is false when the gate regenerated, and records why the earlier attempt failed', () => {
    const events = [
      validationOk,
      progress('verify_issues', '2 blockers'),
      progress('gate_retry', 'Attempt 1 failed verification (2 blockers: text overflows) — generating again with the findings'),
      validationOk,
      progress('verified'),
      completion({ gate: { attempts: 2, bestAttempt: 2, shippable: true, reason: 'verified clean' } }),
    ];
    const r = buildRecord({ prompt: P, events, durationMs: 90000 });
    expect(r.firstAttemptClean).toBe(false);
    expect(r.gate.attempts).toBe(2);
    expect(r.gate.earlierFailures[0].reason).toMatch(/2 blockers/);
    // Validation counted for ATTEMPT 1 only, not the whole run.
    expect(r.validation.attempts).toBe(1);
  });

  it('is false when a repair pass was needed, even though the repaired story verifies clean', () => {
    // The gate's verdict is computed AFTER repair, so `shippable` alone cannot
    // tell "was right" from "was made right". A repair having run is the proof.
    const r = buildRecord({
      prompt: P,
      events: [validationOk, progress('verify_repairing'), progress('verify_repaired'), progress('verified'), completion()],
      durationMs: 40000,
    });
    expect(r.verification.repairRan).toBe(true);
    expect(r.verification.storyBlockerFree).toBe(true);   // after repair
    expect(r.verification.firstOutputClean).toBe(false);  // before it
    expect(r.firstAttemptClean).toBe(false);
  });

  it('records repair separately from the headline, with "ran but did not help" distinct from "did not run"', () => {
    const ran = buildRecord({
      prompt: P,
      events: [validationOk, progress('verify_repairing'), progress('verify_repair_failed'), progress('verify_issues'),
        completion({ gate: { attempts: 1, bestAttempt: 1, shippable: false, reason: '1 blocker: empty panel' } })],
      durationMs: 1000,
    });
    expect(ran.verification.repairRan).toBe(true);
    expect(ran.verification.repairImproved).toBe(false);
    expect(ran.firstAttemptClean).toBe(false);

    const never = buildRecord({ prompt: P, events: [validationOk, progress('verified'), completion()], durationMs: 1000 });
    expect(never.verification.repairRan).toBe(false);
    expect(never.verification.repairImproved).toBe(null);
  });
});

describe('absent is not zero', () => {
  it('a run that never reached a verification outcome is UNKNOWN, not clean', () => {
    const r = buildRecord({ prompt: P, events: [validationOk, completion({ gate: undefined, verification: undefined })], durationMs: 1000 });
    expect(r.verification.repairRan).toBe(null);
    expect(r.firstAttemptClean).toBe(null);
    expect(r.unknown.join(' ')).toMatch(/whether a repair was needed is unknown/);
  });

  it('an unverifiable run is UNKNOWN, not clean and not dirty', () => {
    const r = buildRecord({
      prompt: P,
      events: [validationOk, progress('verify_inconclusive'), completion({
        verification: { outcome: 'not_verified', reason: 'Storybook unreachable', findings: [] },
        gate: { attempts: 1, bestAttempt: 1, shippable: false, reason: 'not verified: Storybook unreachable' },
      })],
      durationMs: 1000,
    });
    expect(r.firstAttemptClean).toBe(null);
    expect(r.unknown.join(' ')).toMatch(/verification inconclusive/);
  });

  it('a stream that ends without a completion reports null counts, never 0', () => {
    const r = buildRecord({ prompt: P, events: [], durationMs: 5000, transportError: { code: 'TIMEOUT', message: 'no completion within 600s' } });
    expect(r.firstAttemptClean).toBe(null);
    expect(r.modelCalls).toBe(null);
    expect(r.validation.attempts).toBe(null);
    expect(r.gate.attempts).toBe(null);
    expect(r.outcome).toBe('transport-error');
  });

  it('a definite failure stays false even when another leg is unknown', () => {
    const r = buildRecord({
      prompt: P,
      events: [
        ev('validation', { isValid: false, errors: ['Import error: "@foo/bar" does not resolve to a file'], warnings: [], autoFixApplied: false }),
        progress('verify_inconclusive'),
        completion({ verification: { outcome: 'not_verified', reason: 'no browser', findings: [] }, gate: undefined }),
      ],
      durationMs: 1000,
    });
    expect(r.firstAttemptClean).toBe(false);
  });

  it('blockers without attribution cannot be read as none', () => {
    const withoutRepairable = storyBlockerVerdict(
      { verification: { outcome: 'issues', findings: [{ id: 'x', severity: 'blocker', class: 'code', message: 'm' }] } },
      1,
    );
    expect(withoutRepairable.verdict).toBe(null);
    const libraryOwned = storyBlockerVerdict(
      { verification: { outcome: 'issues', findings: [{ id: 'x', severity: 'blocker', class: 'a11y', message: 'm', repairable: false }] } },
      1,
    );
    expect(libraryOwned.verdict).toBe(true);
  });

  it('falls back to counting gate_retry events when the server does not send gate', () => {
    const r = buildRecord({
      prompt: P,
      events: [validationOk, progress('gate_retry', 'Attempt 1 failed'), validationOk, progress('verified'),
        completion({ gate: undefined, verification: { outcome: 'verified', findings: [] } })],
      durationMs: 1000,
    });
    expect(r.gate.attempts).toBe(2);
    expect(r.gate.source).toBe('gate_retry progress events');
    expect(r.firstAttemptClean).toBe(false);
  });
});

describe('summary', () => {
  const clean = buildRecord({ prompt: P, events: [validationOk, progress('verified'), completion()], durationMs: 20000 });
  const dirty = buildRecord({
    prompt: { ...P, id: 'c02' },
    events: [
      ev('validation', {
        isValid: false,
        errors: ['Line 3: var(--brand-500) is not a design token in this project'],
        errorsByBucket: { syntax: [], pattern: [], import: ['Line 3: var(--brand-500) is not a design token in this project'] },
        warnings: [], autoFixApplied: false,
      }),
      ev('retry', { attempt: 2, maxAttempts: 3, reason: 'AI self-healing: fixing validation errors', errors: [] }),
      validationOk, progress('verified'),
      completion({ metrics: { totalTimeMs: 1, llmCallsCount: 4 } }),
    ],
    durationMs: 40000,
  });
  const unknown = buildRecord({
    prompt: { ...P, id: 'c03' },
    events: [validationOk, progress('verify_inconclusive'), completion({ verification: { outcome: 'not_verified', reason: 'no browser', findings: [] }, gate: { attempts: 1, bestAttempt: 1, shippable: false, reason: 'not verified: no browser' } })],
    durationMs: 30000,
  });

  it('scores the percentage over what was JUDGED and names the unjudged', () => {
    const s = summarise([clean, dirty, unknown]);
    expect(s.total).toBe(3);
    expect(s.clean).toBe(1);
    expect(s.dirty).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.judged).toBe(2);
    expect(s.percent).toBe(50);
    expect(headline(s)).toBe('first-attempt clean: 1/2 judged of 3 (50%) · median model calls 2 · median 30s');
  });

  it('counts first-round error classes only — the prevention targets', () => {
    const s = summarise([clean, dirty, unknown]);
    expect(s.validationClasses).toEqual([['token-undeclared', 1]]);
    expect(s.selfHealed).toBe(1);
  });

  it('median ignores nulls and is null when nothing was measured', () => {
    expect(median([1, null, 3])).toBe(2);
    expect(median([null, undefined])).toBe(null);
  });
});

describe('selectSuite', () => {
  it('spreads a subset across the complexity range instead of taking the easy end', () => {
    const six = selectSuite(PROMPTS, 6);
    expect(six).toHaveLength(6);
    expect(new Set(six.map((p: { complexity: string }) => p.complexity))).toEqual(new Set(['simple', 'medium']));
    expect(six.map((p: { id: string }) => p.id)).toEqual(['c01', 'c04', 'c07', 'w01', 'w04', 'w07']);
    expect(selectSuite(PROMPTS, 0)).toHaveLength(PROMPTS.length);
    expect(selectSuite(PROMPTS, 99)).toHaveLength(PROMPTS.length);
  });
});

describe('classifyValidationError', () => {
  it.each([
    ['Import from "@atlaskit" is not valid — that is an npm SCOPE, a directory of packages', 'import-isolation'],
    ['Import error: "../x" does not export "Meta".', 'import-missing-export'],
    ['Import error: "Foo" is an unknown component (not in the catalog for @mantine/core).', 'catalog-unknown-component'],
    ['Line 2: "IconFoo" is not exported by lucide-react', 'icon-import'],
    ['Line 9: inline gap: "12px" is a raw spacing value in a design system that has a spacing scale', 'inline-spacing'],
    ['Line 5: <Card elevated> is not a prop this component declares', 'prop-undeclared'],
    ['Line 7: var(--x) is a primitive colour; this project aliases it as --surface', 'token-tier'],
    // Carbon's real wording, which an earlier pattern list classified as import-other.
    ['Line 286: <IconButton kind="danger--ghost"> is not one of the values this prop accepts: primary | secondary. Map your data to those values.', 'prop-bad-value'],
    ['Line 3: <Tile as={… as any}> casts away this prop\'s type; it accepts only "sm" | "lg".', 'prop-cast'],
  ])('%s → %s', (message, cls) => {
    expect(classifyValidationError(message as string)).toBe(cls);
  });

  it('falls back to the pipeline bucket rather than a catch-all', () => {
    expect(classifyValidationError('TS1005: expected ;', 'syntax')).toBe('syntax-other');
    expect(classifyValidationError('something new', null)).toBe('unclassified');
  });
});
