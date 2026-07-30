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
import { renderStory, waitForStoryIndexed, indexIsStale } from './renderHarness.js';
import { runDomCensus } from './probes/domCensus.js';
import { runLayoutProbe } from './probes/layout.js';
import { runClassEffectProbe } from './probes/classEffect.js';
import { runVisualCritique, type CritiqueModel } from './probes/visualCritic.js';
import { runA11yProbe, isGenerationDefect, isDesignSystemConcern, isDesignSystemInternal, isContrastDefect } from './probes/a11y.js';
import type { Finding, VerifyReport } from './findings.js';
import { blockers, summarize } from './findings.js';

export interface VerifyStoryOptions {
  /** Base Storybook URL, e.g. http://localhost:6101 */
  storybookUrl?: string;
  /** Story id prefix derived from the generated title, e.g. "generated-menu-bar". */
  storyIdPrefix: string;
  /**
   * The story's title. Storybook derives ids from the title when the meta does
   * not declare one, so the prefix alone can fail to resolve a story that
   * rendered fine. See waitForStoryIndexed.
   */
  title?: string;
  /** Project root to resolve host tooling from. */
  projectRoot?: string;
  /** Total budget. Verification must never dominate generation latency. */
  timeoutMs?: number;
  /**
   * The design system's component names, so findings can be attributed to the
   * library that rendered the markup rather than to the story that used it.
   */
  libraryComponents?: string[];
  /**
   * Where generated stories are written, so "not indexed" can be told apart
   * from "Storybook's watcher has stopped noticing files".
   */
  generatedDir?: string;
  /**
   * Vision model for judging the rendered result against the request.
   *
   * Supplied by the caller so this module stays free of provider coupling —
   * the same shape as the repair loop's callModel.
   */
  visualCritic?: CritiqueModel;
  /** What the user asked for, which the critic judges the screenshot against. */
  request?: string;
  /** Components the story used, so the critic cannot suggest foreign ones. */
  componentsUsed?: string[];
}

const notVerified = (reason: string, started: number, extra: Finding[] = []): VerifyReport => ({
  outcome: 'not_verified',
  reason,
  findings: extra,
  metrics: {},
  durationMs: Date.now() - started,
});

/**
 * Map census problems onto typed findings with deliberate severity choices.
 *
 * A problem in markup the LIBRARY rendered is demoted before any of the
 * per-kind choices below apply. The defect is real — a sortable `<th>` with an
 * onClick and no tabIndex genuinely cannot be operated by keyboard — but the
 * story did not write that markup and cannot change it. The only repair
 * available to a model told to fix it is to stop using the component, which
 * turns a composition built from the design system into one that avoids it.
 *
 * Still reported, because a design system team should see it. Never blocking,
 * never repairable, and named so the address is unambiguous.
 */
export function censusFindings(problems: Awaited<ReturnType<typeof runDomCensus>>['problems']): Finding[] {
  return problems.map((p, i) => {
    if (p.ownedByLibrary && p.owner) {
      return {
        id: `library-${p.kind}-${i}`,
        severity: 'warning',
        class: p.kind === 'clickable_non_button' || p.kind === 'unnamed_icon_control' ? 'a11y' : 'interaction',
        message: `${p.message} — in <${p.owner}>, a design system component`,
        evidence: [p.evidence, `rendered by <${p.owner}>, not by this story; not fixable from the composition`]
          .filter(Boolean).join(' · '),
        selector: p.selector,
        repairable: false,
      } as Finding;
    }
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
      case 'invisible_icon':
        // Blocker: an icon nobody can see is not a style preference, it is
        // missing content. Repairable, and the evidence names the fix.
        return {
          id: `invisible-icon-${i}`, severity: 'blocker', class: 'a11y',
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
  const { storybookUrl, storyIdPrefix, title, projectRoot = process.cwd(), timeoutMs = 20000, libraryComponents, generatedDir, visualCritic, request, componentsUsed } = options;

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
  const indexed = await waitForStoryIndexed(storybookUrl, storyIdPrefix, Math.min(10000, timeoutMs), 250, title);
  if (!indexed.indexed || !indexed.storyId) {
    // Stale watcher or broken story? The counts answer it, and the two need
    // very different responses from whoever reads this.
    const staleness = generatedDir
      ? await indexIsStale(storybookUrl, generatedDir)
      : { stale: false, onDisk: 0, indexed: 0 };

    return notVerified(
      staleness.stale
        ? `Storybook's index is behind the filesystem — its file watcher has stopped picking up changes. Restart Storybook to verify.`
        : `Story did not appear in Storybook's index — it may not have been picked up yet`,
      started,
      [{
        id: staleness.stale ? 'stale-index' : 'not-indexed',
        severity: 'warning', class: 'infrastructure',
        message: staleness.stale
          ? 'Storybook\'s story index is stale — this is a dev-server problem, not a defect in the generated story'
          : 'Storybook has not indexed the generated story',
        evidence: staleness.stale
          ? `${staleness.onDisk} generated story files on disk, ${staleness.indexed} in Storybook's index`
          : `no entry starting with "${storyIdPrefix}--" after polling /index.json`,
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

    const census = await runDomCensus(render.page, { libraryComponents });

    /**
     * Layout arithmetic, before any aesthetic judgement is applied.
     *
     * "This does not sit on the grid" reads as taste and is not: a row using
     * 11 of 16 columns is a sum, and stacked elements 3px out of line are a
     * measurement. Checking them costs nothing, cannot drift, and catches the
     * defect a reviewer notices first.
     */
    /**
     * Classes the story wrote that no loaded stylesheet defines.
     *
     * The only check that can catch a stale or mistyped class name. Nothing
     * static can: no import is involved, the HTML is valid, and the element
     * renders unstyled without an error. Version drift is the common case —
     * daisyUI renamed `card-bordered` to `card-border` between majors, and a
     * model's training data still carries the old one.
     */
    const classes = await runClassEffectProbe(render.page, { libraryComponents });
    if (classes.unreadable) {
      // No stylesheet was readable, so silence here means nothing. Say that.
      logger.log(`🎨 Class check skipped: ${classes.sheetsBlocked} stylesheet(s) unreadable, 0 readable — classes unverified, not clean`);
    } else {
      for (const u of classes.undefined_) {
        findings.push({
          id: `undefined-class-${findings.length}`,
          severity: 'warning',
          class: 'code',
          message: u.ownedByLibrary && u.owner
            ? `Class "${u.className}" is not defined by any loaded stylesheet — written by <${u.owner}>, a design system component`
            : `Class "${u.className}" is not defined by any loaded stylesheet`,
          evidence: u.ownedByLibrary
            ? `used on ${u.onElements} element(s); the library rendered this markup, so the composition cannot change it`
            : `used on ${u.onElements} element(s), first a <${u.sample}> — the element renders unstyled, with no error`,
          // The library's own markup is not the story's to fix. Sending repair
          // at it can only make the model stop using the component.
          repairable: !u.ownedByLibrary,
        });
      }
    }

    const layout = await runLayoutProbe(render.page, { libraryComponents });
    for (const p of layout.problems) {
      findings.push({
        id: `${p.kind}-${findings.length}`,
        // Blocker: a composition that does not fill its grid is the most
        // visible defect a design system owner sees, and it is repairable by
        // changing numbers the story already wrote.
        severity: p.kind === 'grid_underfilled' ? 'blocker' : 'warning',
        class: 'code',
        message: p.ownedByLibrary && p.owner
          ? `${p.message} — in <${p.owner}>, a design system component`
          : p.message,
        evidence: p.evidence,
        selector: p.selector,
        repairable: !p.ownedByLibrary,
      });
    }
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
        /**
         * Unreadable text blocks, unless the library rendered it.
         *
         * The story chose the foreground/background pairing, so the story can
         * change it — and text at contrast 1.04 is not a preference, it is
         * content nobody can see.
         */
        const contrastDefect = isContrastDefect(v.id) && !libraryInternal;
        const generationDefect = (isGenerationDefect(v.id) || contrastDefect) && !libraryInternal;
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

    /**
     * Eyes, last — and only on something that already renders.
     *
     * Deliberately after the deterministic probes: those are free and exact,
     * and there is no sense paying a vision call to be told about a grid whose
     * arithmetic we already checked. The critic answers only what arithmetic
     * cannot — whether the composition delivers what was asked for.
     */
    if (visualCritic && request) {
      try {
        /**
         * FULL PAGE, not the viewport.
         *
         * A viewport capture cuts every composition taller than 900px, and the
         * critic — reporting the image faithfully — calls the cut edge a
         * clipped element. Measured: a permissions page whose last button sat
         * below the fold was reported as "clipped at the bottom of the
         * viewport, cutting off its text and border". The critic was right
         * about the picture and the picture was wrong about the page.
         */
        const screenshot: Buffer = await render.page.screenshot({ type: 'png', fullPage: true });
        const visual = await runVisualCritique(
          { screenshot, request, componentsUsed }, visualCritic,
        );
        for (const v of visual) {
          findings.push({
            id: `visual-${findings.length}`,
            severity: v.severity,
            class: 'code',
            message: v.element ? `${v.issue} (${v.element})` : v.issue,
            evidence: v.fix ? `Suggested change: ${v.fix}` : 'observed in the rendered screenshot',
            // Only a blocker earns a repair attempt. A warning from a
            // subjective reviewer must never rewrite working code.
            repairable: v.severity === 'blocker',
          });
        }
        // Logged either way: "no findings" and "never ran" must not look alike.
        logger.log(`👁️ Visual critique: ${visual.length} finding(s)`);
      } catch (err) {
        logger.warn(`[visual-critique] skipped: ${err instanceof Error ? err.message : String(err)}`);
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
        ...layout.metrics,
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
