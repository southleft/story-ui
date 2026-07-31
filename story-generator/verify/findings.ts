/**
 * Typed findings produced by verification.
 *
 * Severity and repairability are separate on purpose. The existing self-healing
 * loop treats every error as blocking and shares one 3-attempt budget, which is
 * how a cosmetic complaint could burn the same budget as a syntax error. Nothing
 * here spends an LLM call unless it is a blocker AND repairable AND not an
 * infrastructure problem.
 */

export type FindingSeverity = 'blocker' | 'warning' | 'info';

/**
 * `infrastructure` findings describe OUR environment failing (Storybook down,
 * story not indexed, no browser), never the generated code. They must never
 * trigger a repair — asking a model to fix a story because our dev server was
 * unreachable produces damage, not repair.
 */
export type FindingClass = 'code' | 'a11y' | 'interaction' | 'infrastructure';

export interface Finding {
  /** Stable id for dedupe, baseline subtraction, and bench tracking. */
  id: string;
  severity: FindingSeverity;
  class: FindingClass;
  /** Human-readable statement of the defect. */
  message: string;
  /** Concrete evidence — counts, selectors, text — never a vague assertion. */
  evidence?: string;
  /** CSS selector for the offending node, when there is exactly one. */
  selector?: string;
  /** Whether a bounded repair pass could plausibly fix this. */
  repairable: boolean;
}

export type VerifyOutcome =
  /** Rendered and every blocker-level probe passed. */
  | 'verified'
  /** Rendered, but blockers were found. */
  | 'issues'
  /** We could not check. Never reported as success. */
  | 'not_verified';

/**
 * What the repair phase did about the findings. Four outcomes, deliberately
 * distinct: `applied` (a strictly-better story shipped), `not-attempted`
 * (nothing repairable, or the budget was spent before repair could start),
 * `aborted-budget` (the phase budget cancelled it mid-flight), and `failed`
 * (attempted on the merits and did not improve the story). A repair the
 * budget cancelled must never be reported as one that failed.
 */
export interface RepairSummary {
  status: 'applied' | 'not-attempted' | 'aborted-budget' | 'failed';
  /** Human-readable reason string, always present for non-applied outcomes. */
  note?: string;
  attempts?: number;
}

export interface VerifyReport {
  outcome: VerifyOutcome;
  /** Why verification was skipped, when outcome is not_verified. */
  reason?: string;
  findings: Finding[];
  /** Raw probe measurements, kept for the bench and for regression tracking. */
  metrics: Record<string, number | string | boolean>;
  durationMs: number;
  storyId?: string;
  /** Repair disposition, when verification found issues and enforce mode ran. */
  repair?: RepairSummary;
}

export const blockers = (f: Finding[]): Finding[] => f.filter(x => x.severity === 'blocker');

/** The only findings permitted to spend an LLM call. */
export const repairable = (f: Finding[]): Finding[] =>
  f.filter(x => x.severity === 'blocker' && x.repairable && x.class !== 'infrastructure');

export function summarize(findings: Finding[]): string {
  if (findings.length === 0) return 'no issues found';
  const b = blockers(findings).length;
  const w = findings.filter(x => x.severity === 'warning').length;
  const parts: string[] = [];
  if (b) parts.push(`${b} blocker${b === 1 ? '' : 's'}`);
  if (w) parts.push(`${w} warning${w === 1 ? '' : 's'}`);
  return parts.join(', ') || `${findings.length} finding(s)`;
}

/**
 * Render findings for a repair conversation. Deliberately terse and concrete:
 * the repair pass gets a fresh context, so this is the model's entire picture
 * of what is wrong.
 */
export function formatFindingsForRepair(findings: Finding[]): string {
  const list = repairable(findings);
  if (list.length === 0) return '';
  const lines = list.map((f, i) => {
    const bits = [`${i + 1}. ${f.message}`];
    if (f.evidence) bits.push(`   Evidence: ${f.evidence}`);
    if (f.selector) bits.push(`   Element: ${f.selector}`);
    return bits.join('\n');
  });
  return [
    'The generated story rendered, but automated verification found problems that make it non-functional:',
    '',
    ...lines,
    '',
    'Fix ONLY these problems. Keep everything else identical — do not restyle, rename, or restructure anything that was not called out above.',
  ].join('\n');
}
