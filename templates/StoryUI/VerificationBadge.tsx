/**
 * Verification badge — what the browser actually observed after rendering.
 *
 * The point of this component is honesty. Story UI previously reported success
 * on every generation because its "runtime validation" fetched the Storybook
 * shell as text and regexed it — a response that is byte-identical whether the
 * story works, is broken, or does not exist. So "not verified" is presented as
 * plainly as a pass here; a confident green tick we cannot back up is worse than
 * no tick at all.
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

const LABEL: Record<VerificationResult['outcome'], string> = {
  verified: 'Verified in browser',
  issues: 'Issues found',
  not_verified: 'Not verified',
};

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

  const summary = outcome === 'not_verified'
    ? reason || 'Verification could not run'
    : [
        blockerCount ? `${blockerCount} blocking` : '',
        warningCount ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(', ') || 'no issues found';

  const metricBits = metrics
    ? HEADLINE_METRICS
        .filter(m => typeof metrics[m.key] === 'number')
        .map(m => `${metrics[m.key]} ${m.label}`)
    : [];

  return (
    <div className={`sui-verify sui-verify--${outcome}`}>
      <button
        type="button"
        className="sui-verify-head"
        onClick={() => shown.length > 0 && setOpen(o => !o)}
        aria-expanded={shown.length > 0 ? open : undefined}
        // Nothing to expand when clean — don't advertise a control that no-ops.
        style={shown.length === 0 ? { cursor: 'default' } : undefined}
      >
        <span className="sui-verify-dot" aria-hidden="true" />
        <span className="sui-verify-label">{LABEL[outcome]}</span>
        <span className="sui-verify-summary">{summary}</span>
        {shown.length > 0 && (
          <span className="sui-verify-toggle">{open ? 'Hide' : 'Details'}</span>
        )}
      </button>

      {metricBits.length > 0 && (
        <div className="sui-verify-metrics">{metricBits.join(' · ')}</div>
      )}

      {open && shown.length > 0 && (
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
  );
};

export default VerificationBadge;
