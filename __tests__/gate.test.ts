import { describe, it, expect } from 'vitest';
import { gateVerdict, pickBest, gateMaxAttempts, gateFeedback, gateStatusLine } from '../story-generator/verify/gate';

const report = (outcome: any, findings: any[] = [], reason?: string): any => ({ outcome, findings, reason, metrics: {} });
const blocker = (id: string, repairable = true, cls = 'code') => ({ id, severity: 'blocker', repairable, class: cls, message: `${id} broke`, evidence: 'x' });

describe('gate verdict', () => {
  it('passes a verified story with no story-authored blockers', () => {
    const v = gateVerdict(report('verified', [{ id: 'w', severity: 'warning', message: 'meh' }]));
    expect(v).toMatchObject({ shippable: true, retryable: false, rendered: true, verified: true, warnings: 1 });
  });
  it('does not retry what verification could not judge', () => {
    const v = gateVerdict(report('not_verified', [], 'Storybook at http://x is not reachable'));
    expect(v).toMatchObject({ shippable: false, retryable: false, verified: false });
    expect(v.reason).toContain('not reachable');
    expect(gateVerdict(undefined)).toMatchObject({ shippable: false, retryable: false });
  });
  it('retries a story the browser could not render, and one with story-authored blockers', () => {
    const dead = gateVerdict(report('issues', [{ id: 'render-failed', severity: 'blocker', message: 'the story threw', repairable: true }]));
    expect(dead).toMatchObject({ shippable: false, retryable: true, rendered: false });
    const blocked = gateVerdict(report('issues', [blocker('content_escapes-1'), blocker('lib-thing', false)]));
    expect(blocked.blockers.map(b => b.id)).toEqual(['content_escapes-1']);
    expect(blocked.retryable).toBe(true);
    // Only library-attributed blockers: nothing the story can fix, so it ships.
    expect(gateVerdict(report('issues', [blocker('lib-thing', false)])).shippable).toBe(true);
  });
});

describe('best attempt and retry instructions', () => {
  it('keeps the rendered, least-blocked, latest attempt', () => {
    const a = { n: 1, verdict: gateVerdict(report('issues', [blocker('a'), blocker('b')])) };
    const b = { n: 2, verdict: gateVerdict(report('issues', [blocker('a')])) };
    const c = { n: 3, verdict: gateVerdict(report('issues', [{ id: 'render-failed', severity: 'blocker', message: 'threw', repairable: true }])) };
    expect(pickBest([a, b, c]).n).toBe(2);
    const d = { n: 4, verdict: gateVerdict(report('issues', [blocker('a')])) };
    expect(pickBest([a, b, d]).n).toBe(4);
  });
  it('bounds attempts and turns blockers into instructions', () => {
    expect(gateMaxAttempts({})).toBe(3);
    expect(gateMaxAttempts({ STORY_UI_GATE_ATTEMPTS: '9' })).toBe(5);
    expect(gateMaxAttempts({ STORY_UI_GATE_ATTEMPTS: '0' })).toBe(1);
    const v = gateVerdict(report('issues', [blocker('content_escapes-0')]));
    expect(gateFeedback(v)[0]).toContain('content_escapes-0 broke');
    expect(gateStatusLine(1, gateVerdict(report('verified')), 1)).toBeNull();
    expect(gateStatusLine(2, gateVerdict(report('verified')), 2)).toContain('attempt 2 of 2');
    expect(gateStatusLine(3, v, 2)).toContain('3 attempts; 1 blocker');
    const dead = gateVerdict(report('issues', [{ id: 'render-failed', severity: 'blocker', message: 'threw', repairable: true }]));
    expect(gateStatusLine(3, dead, 3)).toContain('did not render in a browser on any of 3 attempts');
  });
});
