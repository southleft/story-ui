/**
 * Verification repair — fix what the browser actually observed.
 *
 * Only runs on findings that are simultaneously blocker, repairable, and not
 * infrastructure. That partition is enforced in verify/findings.ts and is the
 * whole safety story: a false blocker here does not merely waste a call, it
 * makes the model edit correct code.
 *
 * Two deliberate departures from the existing self-healing loop:
 *
 *  1. FRESH conversation. The generate loop appends to one growing messages
 *     array, so by the third attempt the model is re-reading two prior failed
 *     drafts. Repair gets only the current code and the specific findings.
 *  2. NEVER ship a regression. The repaired story is re-verified, and if it has
 *     more blockers than the original it is discarded and the original kept.
 *     A repair that makes things worse is worse than no repair.
 */

import { logger } from '../../story-generator/logger.js';
import { formatFindingsForRepair, repairable, blockers } from '../../story-generator/verify/findings.js';
import type { VerifyReport } from '../../story-generator/verify/findings.js';

export interface RepairAttemptArgs {
  code: string;
  report: VerifyReport;
  /** Re-run the full LLM call with a self-contained prompt. */
  callModel: (prompt: string) => Promise<string | null>;
  /** Write the candidate and re-verify it in the browser. */
  writeAndVerify: (code: string) => Promise<VerifyReport>;
  /** Static gate; a repair that fails static validation is discarded. */
  staticallyValid: (code: string) => boolean;
  maxAttempts?: number;
  /**
   * The verification phase's budget abort. When it fires the in-flight LLM
   * call is cancelled (the signal reaches the provider's fetch), and this loop
   * stops at the next step boundary instead of starting more work.
   */
  signal?: AbortSignal;
  /**
   * Wall-clock deadline (`Date.now()` ms) for the whole verify+repair phase.
   * Checked between steps so a step that finished just under the wire cannot
   * start another whole browser pass over the line.
   */
  deadline?: number;
}

export interface RepairOutcome {
  /** Repaired code, or null when nothing was applied. */
  code: string | null;
  report: VerifyReport;
  attempts: number;
  /** Why no repair was applied, for logging and the panel. */
  note?: string;
  /**
   * True when the verification budget — not the model, not validation — ended
   * the attempt. Callers report this as its own outcome: a repair the budget
   * cancelled must not read like a repair that failed on the merits.
   */
  abortedByBudget?: boolean;
}

const REPAIR_PREAMBLE = [
  'You previously generated the Storybook story below. It renders, but automated',
  'browser verification found problems that make parts of it non-functional.',
  '',
  'Return the COMPLETE corrected story in a single code block.',
].join('\n');

export async function attemptVerificationRepair(args: RepairAttemptArgs): Promise<RepairOutcome> {
  const { code, report, callModel, writeAndVerify, staticallyValid, maxAttempts = 1, signal, deadline } = args;

  const targets = repairable(report.findings);
  if (targets.length === 0) {
    return { code: null, report, attempts: 0, note: 'no repairable blockers' };
  }

  let bestCode = code;
  let bestReport = report;
  let attempts = 0;

  /** Budget exhaustion — the signal fired, or the wall clock passed the deadline. */
  const outOfBudget = (): boolean =>
    Boolean(signal?.aborted) || (deadline !== undefined && Date.now() >= deadline);

  /** The outcome so far, with whatever improvement (if any) was already banked. */
  const partial = (note: string, abortedByBudget = false): RepairOutcome => ({
    code: bestCode === code ? null : bestCode,
    report: bestReport,
    attempts,
    note,
    ...(abortedByBudget ? { abortedByBudget: true } : {}),
  });

  while (attempts < maxAttempts) {
    if (outOfBudget()) {
      return partial('verification budget exhausted before the repair attempt could start', true);
    }
    attempts++;
    const baselineBlockers = blockers(bestReport.findings).length;

    const prompt = [
      REPAIR_PREAMBLE,
      '',
      formatFindingsForRepair(bestReport.findings),
      '',
      '--- CURRENT STORY ---',
      bestCode,
    ].join('\n');

    let candidate: string | null;
    try {
      candidate = await callModel(prompt);
    } catch (error) {
      // A budget abort mid-LLM-call and a model failure are different facts,
      // and reporting them the same way is how three diagnoses on this branch
      // went wrong. The abort is the budget's doing; say so.
      if (outOfBudget()) {
        return partial('repair aborted mid-LLM-call: verification budget exhausted', true);
      }
      return partial(`repair model call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!candidate) {
      return partial('model returned no code');
    }

    if (!staticallyValid(candidate)) {
      logger.log('🔧 Repair candidate failed static validation — keeping the previous story');
      return partial('repair failed static validation');
    }

    // The next step is a whole write-recompile-render pass; never start it
    // after the deadline.
    if (outOfBudget()) {
      return partial('verification budget exhausted after the model call — candidate discarded unverified', true);
    }

    const candidateReport = await writeAndVerify(candidate);
    const candidateBlockers = blockers(candidateReport.findings).length;

    // Strictly better, or nothing.
    if (candidateBlockers < baselineBlockers) {
      logger.log(`🔧 Repair improved the story: ${baselineBlockers} → ${candidateBlockers} blockers`);
      bestCode = candidate;
      bestReport = candidateReport;
      if (candidateBlockers === 0) break;
    } else {
      logger.log(
        `🔧 Repair did not improve the story (${baselineBlockers} → ${candidateBlockers} blockers) — keeping the original`,
      );
      return {
        code: bestCode === code ? null : bestCode,
        report: bestReport,
        attempts,
        note: 'repair did not reduce blockers',
      };
    }
  }

  return {
    code: bestCode === code ? null : bestCode,
    report: bestReport,
    attempts,
  };
}
