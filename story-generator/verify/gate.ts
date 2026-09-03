/**
 * The shippable gate.
 *
 * "We should never be able to generate something that is broken, looks
 * broken, isn't able to be generated, or says it's generated but then shows
 * you a blank story." Verification answers whether a story is any of those;
 * this module turns that answer into a decision the pipeline acts on — try
 * again with the findings as instructions, keep the best attempt, and say
 * exactly what happened — rather than a badge the user reads after the fact.
 *
 * Pure functions, so the decision is testable without a browser.
 */

import type { Finding, VerifyReport } from './findings.js';

export interface GateVerdict {
  /** Rendered, verified, and no blocker the story itself could fix. */
  shippable: boolean;
  /**
   * Whether another attempt could change the answer. A story verification
   * could not judge (no Storybook, no browser) is not shippable AND not
   * retryable: regenerating cannot fix the infrastructure, and pretending it
   * might costs minutes.
   */
  retryable: boolean;
  /** One line a person can read: why, and what stood in the way. */
  reason: string;
  rendered: boolean;
  verified: boolean;
  /** Blockers the story authored — the ones a regeneration can remove. */
  blockers: Finding[];
  warnings: number;
}

/** Blockers the story wrote: the library's own markup is not the story's to fix. */
export function storyBlockers(report: VerifyReport): Finding[] {
  return report.findings.filter(f => f.severity === 'blocker' && f.repairable !== false && f.class !== 'infrastructure');
}

export function gateVerdict(report: VerifyReport | undefined): GateVerdict {
  if (!report) {
    return { shippable: false, retryable: false, reason: 'verification did not run', rendered: true, verified: false, blockers: [], warnings: 0 };
  }
  const warnings = report.findings.filter(f => f.severity === 'warning').length;
  if (report.outcome === 'not_verified') {
    return {
      shippable: false, retryable: false, rendered: true, verified: false, blockers: [], warnings,
      reason: `not verified: ${report.reason || 'verification could not run'}`,
    };
  }
  const rendered = !report.findings.some(f => f.id === 'render-failed' || f.id.startsWith('render-failed'));
  const blockers = storyBlockers(report);
  if (!rendered) {
    const why = report.findings.find(f => f.id.startsWith('render-failed'))?.message || 'the story did not render';
    return { shippable: false, retryable: true, rendered: false, verified: true, blockers, warnings, reason: `did not render: ${why.slice(0, 160)}` };
  }
  if (blockers.length > 0) {
    return {
      shippable: false, retryable: true, rendered: true, verified: true, blockers, warnings,
      reason: `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}: ${blockers.map(b => b.message.replace(/\s+—.*$/, '').slice(0, 90)).join('; ')}`,
    };
  }
  return { shippable: true, retryable: false, rendered: true, verified: true, blockers: [], warnings, reason: warnings ? `verified, ${warnings} warning${warnings === 1 ? '' : 's'}` : 'verified clean' };
}

/**
 * The attempt to keep: one that rendered beats one that did not; fewer
 * story blockers beats more; fewer warnings; then the LATER attempt, which
 * had the most instructions. Never an unverified attempt over a verified one.
 */
export function pickBest<T extends { verdict: GateVerdict }>(attempts: T[]): T {
  if (attempts.length === 0) throw new Error('pickBest: no attempts');
  return [...attempts].sort((a, b) => {
    const av = a.verdict, bv = b.verdict;
    if (av.shippable !== bv.shippable) return av.shippable ? -1 : 1;
    if (av.verified !== bv.verified) return av.verified ? -1 : 1;
    if (av.rendered !== bv.rendered) return av.rendered ? -1 : 1;
    if (av.blockers.length !== bv.blockers.length) return av.blockers.length - bv.blockers.length;
    if (av.warnings !== bv.warnings) return av.warnings - bv.warnings;
    return attempts.indexOf(b) - attempts.indexOf(a);
  })[0];
}

/** How many attempts the gate may spend, including the first. Bounded: this is minutes of the user's time. */
export function gateMaxAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.STORY_UI_GATE_ATTEMPTS ?? 3);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.floor(n))) : 3;
}

/** The instructions a retry carries: what the browser measured, as a rule the next composition must satisfy. */
export function gateFeedback(verdict: GateVerdict): string[] {
  if (!verdict.rendered) return [`The story did not render in a browser: ${verdict.reason.replace(/^did not render: /, '')}`];
  return verdict.blockers.slice(0, 6).map(b => `${b.message}${b.evidence ? ` (measured: ${String(b.evidence).slice(0, 140)})` : ''}`);
}

/** The sentence the reply leads with when the gate did more than pass. */
export function gateStatusLine(attempts: number, best: GateVerdict, bestAttempt: number): string | null {
  if (attempts === 1 && best.shippable) return null;
  if (best.shippable) return `Verified clean on attempt ${bestAttempt} of ${attempts}; the earlier attempt${attempts - 1 === 1 ? '' : 's'} failed verification and ${attempts - 1 === 1 ? 'was' : 'were'} discarded.`;
  if (!best.verified) return null; // infrastructure: the existing "not verified" reporting says it
  if (!best.rendered) return `This story did not render in a browser on any of ${attempts} attempt${attempts === 1 ? '' : 's'}. The last attempt's code is kept so you can inspect it; it is not a working story. Try again, or narrow the request.`;
  return `${attempts} attempt${attempts === 1 ? '' : 's'}; ${best.reason}. The best attempt is kept, and the issue${best.blockers.length === 1 ? '' : 's'} above still need${best.blockers.length === 1 ? 's' : ''} a fix.`;
}
