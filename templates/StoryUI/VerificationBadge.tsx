/**
 * Verification badge — what the browser actually observed after rendering.
 *
 * The point of this component is honesty. Story UI previously reported success
 * on every generation because its "runtime validation" fetched the Storybook
 * shell as text and regexed it — a response that is byte-identical whether the
 * story works, is broken, or does not exist. So "not verified" is presented as
 * plainly as a pass here; a confident green tick we cannot back up is worse than
 * no tick at all.
 *
 * Rendered as a pill in the turn's meta row ("● Verified · 6/6 checks"). The
 * pill is a button only when there is something to reveal — findings, a
 * reason, metrics — and a plain span otherwise, so nothing advertises a
 * control that no-ops.
 */

import React, { useState } from 'react';

interface VerificationFinding {
  id: string;
  severity: 'blocker' | 'warning' | 'info';
  class: 'code' | 'a11y' | 'interaction' | 'infrastructure';
  message: string;
  evidence?: string;
  selector?: string;
}

interface VerificationResult {
  outcome: 'verified' | 'issues' | 'not_verified';
  reason?: string;
  findings: VerificationFinding[];
  metrics?: Record<string, number | string | boolean | string[]>;
}

/** Metrics worth showing a designer, in the order they answer "does it work". */
const HEADLINE_METRICS: Array<{ key: string; label: string }> = [
  { key: 'focusables', label: 'focusable' },
  { key: 'realInputs', label: 'inputs' },
  { key: 'buttons', label: 'buttons' },
  { key: 'nodes', label: 'nodes' },
];

export const VerificationBadge: React.FC<{ verification: VerificationResult }> = ({ verification }) => {
  const [open, setOpen] = useState(false);
  const { outcome, reason, metrics } = verification;
  // A reopened chat restores the manifest's SUMMARY of a verification —
  // counts, no findings list. Reading `.filter` off a missing array blanked
  // the whole panel when a past story was opened.
  const findings = Array.isArray(verification.findings) ? verification.findings : [];

  const blockers = findings.filter(f => f.severity === 'blocker');
  const warnings = findings.filter(f => f.severity === 'warning');
  const shown = [...blockers, ...warnings];
  const blockerCount = blockers.length || Number(metrics?.blockers ?? 0) || 0;
  const warningCount = warnings.length || Number(metrics?.warnings ?? 0) || 0;

  const checksRun = typeof metrics?.checksRun === 'number' ? metrics.checksRun : undefined;
  const checksTotal = typeof metrics?.checksTotal === 'number' ? metrics.checksTotal : undefined;
  const checksLabel = checksRun !== undefined && checksTotal !== undefined ? `${checksRun}/${checksTotal} checks` : '';

  const issueSummary = [
    blockerCount ? `${blockerCount} blocking` : '',
    warningCount ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ');

  // Green for a clean pass, amber for warnings only, red once anything
  // blocks, grey when the check could not run at all.
  const tone = outcome === 'verified' ? 'ok'
    : outcome === 'issues' ? (blockerCount > 0 ? 'bad' : 'warn')
    : 'muted';

  const label = outcome === 'verified'
    ? `Verified${checksLabel ? ` · ${checksLabel}` : ''}`
    : outcome === 'issues'
      ? `Issues${issueSummary ? ` · ${issueSummary}` : ''}`
      : 'Not verified';

  const metricBits = metrics
    ? HEADLINE_METRICS
        .filter(m => typeof metrics[m.key] === 'number')
        .map(m => `${metrics[m.key]} ${m.label}`)
    : [];
  const notRun = Array.isArray(metrics?.checksNotRun) ? (metrics!.checksNotRun as string[]) : [];

  const summary = outcome === 'not_verified'
    ? reason || 'Verification could not run'
    : outcome === 'verified'
      ? (checksLabel ? `${checksLabel} passed in the browser` : 'No issues found in the browser')
      : issueSummary;

  const expandable = shown.length > 0 || metricBits.length > 0 || notRun.length > 0 || !!reason;

  return (
    <div className={`sui-verify sui-verify--${tone}`}>
      {expandable ? (
        <button
          type="button"
          className="sui-verify-pill"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          title={summary}
        >
          <span className="sui-verify-dot" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ) : (
        <span className="sui-verify-pill" title={summary}>
          <span className="sui-verify-dot" aria-hidden="true" />
          <span>{label}</span>
        </span>
      )}

      {open && expandable && (
        <div className="sui-verify-detail">
          <div className="sui-verify-summary">{summary}</div>
          {(metricBits.length > 0 || notRun.length > 0) && (
            <div className="sui-verify-metrics">
              {metricBits.join(' · ')}
              {notRun.length > 0 && `${metricBits.length ? ' · ' : ''}not run: ${notRun.join(', ')}`}
            </div>
          )}
          {shown.length > 0 && (
            <ul className="sui-verify-list">
              {shown.map(f => (
                <li key={f.id} className={`sui-verify-item sui-verify-item--${f.severity}`}>
                  <span className="sui-verify-item-sev">{f.severity === 'blocker' ? 'Blocking' : 'Warning'}</span>
                  <span className="sui-verify-item-msg">{f.message}</span>
                  {f.evidence && <span className="sui-verify-item-ev">{f.evidence}</span>}
                  {f.selector && <code className="sui-verify-item-sel">{f.selector}</code>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default VerificationBadge;
