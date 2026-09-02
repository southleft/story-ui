/**
 * The verification budget must end a repair honestly.
 *
 * Three dispositions that used to be indistinguishable: repair never started
 * (nothing repairable, or the budget was already spent), repair was aborted by
 * the budget mid-flight, and repair ran and failed on the merits. Each pins a
 * different fact, and the panel/manifest report them as different statuses —
 * `abortedByBudget` is the flag that keeps a cancelled repair from reading
 * like a broken one.
 */
import { describe, it, expect, vi } from 'vitest';
import { attemptVerificationRepair } from '../mcp-server/routes/verifyRepair.js';
import type { VerifyReport, Finding } from '../story-generator/verify/findings.js';

function blockerFinding(id: string): Finding {
  return { id, severity: 'blocker', class: 'code', message: `broken ${id}`, repairable: true };
}

function issuesReport(blockerIds: string[] = ['f1']): VerifyReport {
  return {
    outcome: blockerIds.length ? 'issues' : 'verified',
    findings: blockerIds.map(blockerFinding),
    metrics: {},
    durationMs: 0,
  };
}

const CODE = 'export const Primary = {};';

describe('attemptVerificationRepair under a budget', () => {
  it('does not even call the model when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('budget exhausted'));
    const callModel = vi.fn();
    const writeAndVerify = vi.fn();

    const outcome = await attemptVerificationRepair({
      code: CODE,
      report: issuesReport(),
      callModel,
      writeAndVerify,
      staticallyValid: () => true,
      signal: controller.signal,
    });

    expect(outcome).toMatchObject({ code: null, attempts: 0, abortedByBudget: true });
    expect(outcome.note).toContain('budget exhausted before the repair attempt');
    expect(callModel).not.toHaveBeenCalled();
    expect(writeAndVerify).not.toHaveBeenCalled();
  });

  it('does not start when the wall-clock deadline has already passed', async () => {
    const callModel = vi.fn();
    const outcome = await attemptVerificationRepair({
      code: CODE,
      report: issuesReport(),
      callModel,
      writeAndVerify: vi.fn(),
      staticallyValid: () => true,
      deadline: Date.now() - 1,
    });

    expect(outcome).toMatchObject({ code: null, attempts: 0, abortedByBudget: true });
    expect(callModel).not.toHaveBeenCalled();
  });

  it('reports a budget abort mid-LLM-call as aborted, not failed', async () => {
    const controller = new AbortController();
    const outcome = await attemptVerificationRepair({
      code: CODE,
      report: issuesReport(),
      callModel: async () => {
        // The budget fires while the model call is in flight; the provider's
        // fetch rejects with the abort reason.
        controller.abort(new Error('verification budget of 100ms exhausted'));
        throw new Error('request aborted');
      },
      writeAndVerify: vi.fn(),
      staticallyValid: () => true,
      signal: controller.signal,
    });

    expect(outcome).toMatchObject({ code: null, attempts: 1, abortedByBudget: true });
    expect(outcome.note).toContain('aborted mid-LLM-call');
  });

  it('reports a genuine model failure as failed — distinctly from a budget abort', async () => {
    const outcome = await attemptVerificationRepair({
      code: CODE,
      report: issuesReport(),
      callModel: async () => { throw new Error('Claude API error: 500 - upstream'); },
      writeAndVerify: vi.fn(),
      staticallyValid: () => true,
      signal: new AbortController().signal,
      deadline: Date.now() + 60_000,
    });

    expect(outcome.abortedByBudget).toBeUndefined();
    expect(outcome.note).toContain('repair model call failed: Claude API error: 500 - upstream');
    expect(outcome.code).toBeNull();
  });

  it('refuses to start the write-and-verify pass over the deadline', async () => {
    const deadline = Date.now() + 40;
    const writeAndVerify = vi.fn();
    const outcome = await attemptVerificationRepair({
      code: CODE,
      report: issuesReport(),
      callModel: async () => {
        await new Promise(resolve => setTimeout(resolve, 80)); // outlives the deadline
        return 'export const Primary = { name: "fixed" };';
      },
      writeAndVerify,
      staticallyValid: () => true,
      deadline,
    });

    expect(outcome).toMatchObject({ code: null, attempts: 1, abortedByBudget: true });
    expect(outcome.note).toContain('candidate discarded unverified');
    expect(writeAndVerify).not.toHaveBeenCalled();
  });

  it('still applies a strictly-better repair inside the budget', async () => {
    const fixed = 'export const Primary = { name: "fixed" };';
    const outcome = await attemptVerificationRepair({
      code: CODE,
      report: issuesReport(['f1']),
      callModel: async () => fixed,
      writeAndVerify: async () => issuesReport([]),
      staticallyValid: () => true,
      signal: new AbortController().signal,
      deadline: Date.now() + 60_000,
    });

    expect(outcome.code).toBe(fixed);
    expect(outcome.attempts).toBe(1);
    expect(outcome.abortedByBudget).toBeUndefined();
  });
});
