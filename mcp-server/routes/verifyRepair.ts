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
}

export interface RepairOutcome {
  /** Repaired code, or null when nothing was applied. */
  code: string | null;
  report: VerifyReport;
  attempts: number;
  /** Why no repair was applied, for logging and the panel. */
  note?: string;
}

const REPAIR_PREAMBLE = [
  'You previously generated the Storybook story below. It renders, but automated',
  'browser verification found problems that make parts of it non-functional.',
  '',
  'Return the COMPLETE corrected story in a single code block.',
].join('\n');

export async function attemptVerificationRepair(args: RepairAttemptArgs): Promise<RepairOutcome> {
  const { code, report, callModel, writeAndVerify, staticallyValid, maxAttempts = 1 } = args;

  const targets = repairable(report.findings);
  if (targets.length === 0) {
    return { code: null, report, attempts: 0, note: 'no repairable blockers' };
  }

  let bestCode = code;
  let bestReport = report;
  let attempts = 0;

  while (attempts < maxAttempts) {
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

    const candidate = await callModel(prompt);
    if (!candidate) {
      return { code: bestCode === code ? null : bestCode, report: bestReport, attempts, note: 'model returned no code' };
    }

    if (!staticallyValid(candidate)) {
      logger.log('🔧 Repair candidate failed static validation — keeping the previous story');
      return { code: bestCode === code ? null : bestCode, report: bestReport, attempts, note: 'repair failed static validation' };
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
