import { describe, it, expect } from 'vitest';
import {
  blockers,
  repairable,
  summarize,
  formatFindingsForRepair,
  type Finding,
} from '../story-generator/verify/findings.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', severity: 'blocker', class: 'code',
  message: 'something', repairable: true, ...over,
});

/**
 * The severity/repairability partition is the safety-critical part of
 * verification. The pre-existing self-healing loop treated every error as
 * blocking against one shared 3-attempt budget, which is how a cosmetic
 * complaint could hard-fail a generation. These rules exist so nothing spends
 * an LLM call unless it is a genuine, fixable code defect.
 */
describe('finding severity partition', () => {
  it('counts only blockers as blocking', () => {
    const list = [f({}), f({ severity: 'warning' }), f({ severity: 'info' })];
    expect(blockers(list)).toHaveLength(1);
  });

  it('never marks infrastructure findings repairable, even at blocker severity', () => {
    // Storybook being unreachable is our problem, not the story's. Asking a model
    // to "fix" a story because our dev server was down produces damage.
    const list = [f({ class: 'infrastructure', severity: 'blocker', repairable: true })];
    expect(repairable(list)).toHaveLength(0);
  });

  it('excludes warnings from repair even when repairable', () => {
    const list = [f({ severity: 'warning', repairable: true })];
    expect(repairable(list)).toHaveLength(0);
  });

  it('excludes blockers explicitly marked non-repairable', () => {
    const list = [f({ severity: 'blocker', repairable: false })];
    expect(repairable(list)).toHaveLength(0);
  });

  it('admits exactly the blocker + repairable + non-infrastructure case', () => {
    const list = [
      f({ id: 'good', severity: 'blocker', class: 'interaction', repairable: true }),
      f({ id: 'infra', severity: 'blocker', class: 'infrastructure', repairable: true }),
      f({ id: 'warn', severity: 'warning', repairable: true }),
    ];
    expect(repairable(list).map(x => x.id)).toEqual(['good']);
  });
});

describe('summarize', () => {
  it('reports a clean result plainly', () => {
    expect(summarize([])).toBe('no issues found');
  });

  it('counts blockers and warnings separately', () => {
    const list = [f({}), f({}), f({ severity: 'warning' })];
    expect(summarize(list)).toBe('2 blockers, 1 warning');
  });
});

describe('formatFindingsForRepair', () => {
  it('returns empty when nothing is repairable, so no call is made', () => {
    expect(formatFindingsForRepair([f({ class: 'infrastructure' })])).toBe('');
    expect(formatFindingsForRepair([])).toBe('');
  });

  it('includes evidence and selector, and constrains the edit', () => {
    const out = formatFindingsForRepair([
      f({ message: 'Search affordance has no input', evidence: '"Type to search" has no input', selector: 'div.bar' }),
    ]);
    expect(out).toContain('Search affordance has no input');
    expect(out).toContain('"Type to search" has no input');
    expect(out).toContain('div.bar');
    // The repair pass must not be licensed to rewrite the whole story.
    expect(out).toContain('Fix ONLY these problems');
  });

  it('omits non-repairable findings from the repair prompt entirely', () => {
    const out = formatFindingsForRepair([
      f({ id: 'a', message: 'real defect' }),
      f({ id: 'b', message: 'storybook unreachable', class: 'infrastructure' }),
    ]);
    expect(out).toContain('real defect');
    expect(out).not.toContain('storybook unreachable');
  });
});
