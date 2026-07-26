/**
 * Verification orchestrator.
 *
 * Contract, in priority order:
 *  1. Never report success we cannot prove. Missing tooling, an unreachable
 *     Storybook, or an unindexed story all produce `not_verified` with a reason —
 *     never `verified`. The check this replaces reported success unconditionally.
 *  2. Never let our own environment cost the user an LLM call. Infrastructure
 *     findings are non-repairable by construction.
 *  3. Report-only in this stage. Nothing here triggers repair yet; the
 *     measurements have to be trusted before they are allowed to spend tokens.
 */

import { logger } from '../logger.js';
import { resolveHostTooling, canLaunchBrowser } from './hostTooling.js';
import { renderStory, waitForStoryIndexed } from './renderHarness.js';
import { runDomCensus } from './probes/domCensus.js';
import { runA11yProbe, isGenerationDefect, isDesignSystemConcern, isDesignSystemInternal } from './probes/a11y.js';
import type { Finding, VerifyReport } from './findings.js';
import { blockers, summarize } from './findings.js';

export interface VerifyStoryOptions {
  /** Base Storybook URL, e.g. http://localhost:6101 */
  storybookUrl?: string;
  /** Story id prefix derived from the generated title, e.g. "generated-menu-bar". */
  storyIdPrefix: string;
  /** Project root to resolve host tooling from. */
  projectRoot?: string;
  /** Total budget. Verification must never dominate generation latency. */
  timeoutMs?: number;
}

const notVerified = (reason: string, started: number, extra: Finding[] = []): VerifyReport => ({
  outcome: 'not_verified',
  reason,
  findings: extra,
  metrics: {},
  durationMs: Date.now() - started,
});

/** Map census problems onto typed findings with deliberate severity choices. */
function censusFindings(problems: Awaited<ReturnType<typeof runDomCensus>>['problems']): Finding[] {
  return problems.map((p, i) => {
    switch (p.kind) {
      case 'fake_field':
        return {
          id: `fake-field-${i}`, severity: 'blocker', class: 'interaction',
          message: p.message, evidence: p.evidence, selector: p.selector, repairable: true,
        } as Finding;
      case 'no_focusables':
        return {
          id: 'no-focusables', severity: 'blocker', class: 'interaction',
          message: p.message, evidence: p.evidence, repairable: true,
        } as Finding;
      case 'clickable_non_button':
        return {
          id: `clickable-non-button-${i}`, severity: 'blocker', class: 'a11y',
          message: p.message, evidence: p.evidence, selector: p.selector, repairable: true,
        } as Finding;
      case 'unnamed_icon_control':
        return {
          id: `unnamed-icon-${i}`, severity: 'blocker', class: 'a11y',
          message: p.message, evidence: p.evidence, selector: p.selector, repairable: true,
        } as Finding;
      case 'static_only':
        // Informational by design: a presentational component with no focusable
        // elements is a legitimate result, not a defect to repair.
        return {
          id: 'static-only', severity: 'info', class: 'interaction',
          message: p.message, evidence: p.evidence, repairable: false,
        } as Finding;
      case 'orphan_icon':
      default:
        // Warning, not blocker: a decorative icon that simply lacks aria-hidden
        // is common and harmless, and flagging it as blocking would spend repair
        // attempts on cosmetics.
        return {
          id: `orphan-icon-${i}`, severity: 'warning', class: 'a11y',
          message: p.message, evidence: p.evidence, selector: p.selector, repairable: true,
        } as Finding;
    }
  });
}

export async function verifyStory(options: VerifyStoryOptions): Promise<VerifyReport> {
  const started = Date.now();
  const { storybookUrl, storyIdPrefix, projectRoot = process.cwd(), timeoutMs = 20000 } = options;

  if (!storybookUrl) {
    return notVerified('No Storybook URL available to verify against', started);
  }

  const tooling = resolveHostTooling(projectRoot);
  if (!tooling) {
    return notVerified('Playwright is not installed in this project — install it to enable verification', started);
  }

  const launch = await canLaunchBrowser(tooling);
  if (!launch.ok) {
    return notVerified(`Browser could not launch: ${launch.error}`, started);
  }

  // The story has to be in the index before it can be rendered by id. This also
  // separates "generated badly" from "Storybook never noticed the file".
  const indexed = await waitForStoryIndexed(storybookUrl, storyIdPrefix, Math.min(10000, timeoutMs));
  if (!indexed.indexed || !indexed.storyId) {
    return notVerified(
      `Story did not appear in Storybook's index — it may not have been picked up yet`,
      started,
      [{
        id: 'not-indexed', severity: 'warning', class: 'infrastructure',
        message: 'Storybook has not indexed the generated story',
        evidence: `no entry starting with "${storyIdPrefix}--" after polling /index.json`,
        repairable: false,
      }],
    );
  }

  const render = await renderStory({ storybookUrl, storyId: indexed.storyId, tooling, timeoutMs });

  if (!render.ok) {
    // A render failure IS a code defect and is worth repairing — unlike the
    // infrastructure cases above.
    return {
      outcome: 'issues',
      findings: [{
        id: 'render-failed', severity: 'blocker', class: 'code',
        message: 'Story failed to render in the browser',
        evidence: [render.reason, ...render.pageErrors].filter(Boolean).join(' | ').slice(0, 500),
        repairable: true,
      }],
      metrics: { navMs: render.navMs },
      durationMs: Date.now() - started,
      storyId: indexed.storyId,
    };
  }

  try {
    const findings: Finding[] = [];

    if (render.isErrorPlaceholder) {
      findings.push({
        id: 'error-placeholder', severity: 'blocker', class: 'code',
        message: 'The rendered story is Story UI\'s generation-error placeholder, not real content',
        evidence: 'page contains the fallback "Story Generation Error" text',
        repairable: true,
      });
    }

    for (const err of render.pageErrors.slice(0, 3)) {
      findings.push({
        id: `page-error-${findings.length}`, severity: 'blocker', class: 'code',
        message: 'Uncaught error while rendering',
        evidence: err.slice(0, 300),
        repairable: true,
      });
    }

    const census = await runDomCensus(render.page);
    findings.push(...censusFindings(census.problems));

    // Accessibility. Only rules that indicate the GENERATOR produced wrong
    // markup can block; palette and document-structure rules describe the design
    // system itself and would push the model into overriding it.
    const a11y = await runA11yProbe(render.page, tooling);
    if (a11y.ran) {
      for (const v of a11y.violations) {
        // A violation on markup the library renders is not something the story
        // can fix, however severe the rule.
        const libraryInternal = isDesignSystemInternal(v.selector);
        const generationDefect = isGenerationDefect(v.id) && !libraryInternal;
        const severe = v.impact === 'critical' || v.impact === 'serious';
        findings.push({
          id: `axe-${v.id}`,
          severity: generationDefect && severe ? 'blocker' : 'warning',
          class: 'a11y',
          message: v.help,
          evidence: [
            `axe rule "${v.id}"`,
            v.impact ? `${v.impact} impact` : null,
            `${v.nodeCount} element${v.nodeCount === 1 ? '' : 's'}`,
            isDesignSystemConcern(v.id) ? 'design-system level, not a composition defect' : null,
            libraryInternal ? 'fails on markup the component library renders — not fixable from the story' : null,
          ].filter(Boolean).join(' · '),
          selector: v.selector,
          // Only a generation defect is worth asking the model to fix.
          repairable: generationDefect,
        });
      }
    }

    const outcome = blockers(findings).length > 0 ? 'issues' : 'verified';
    logger.log(
      `🔍 Verification (${indexed.storyId}): ${outcome} — ${summarize(findings)} ` +
      `[${census.metrics.focusables} focusable, ${census.metrics.realInputs} inputs, ${census.metrics.nodes} nodes]`,
    );

    return {
      outcome,
      findings,
      metrics: {
        ...census.metrics,
        navMs: render.navMs,
        axeRan: a11y.ran,
        axeViolations: a11y.violations.length,
        axePasses: a11y.passCount,
      },
      durationMs: Date.now() - started,
      storyId: indexed.storyId,
    };
  } finally {
    await render.dispose();
  }
}
