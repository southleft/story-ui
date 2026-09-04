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

import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { storybookWatcherHint } from './storybookWatcher.js';
import { resolveHostTooling, canLaunchBrowser } from './hostTooling.js';
import { renderStory, waitForStoryIndexed, indexIsStale, type IndexLookup } from './renderHarness.js';
import { runDomCensus } from './probes/domCensus.js';
import { runLayoutProbe } from './probes/layout.js';
import { runOverflowProbe } from './probes/overflow.js';
import { runClassEffectProbe } from './probes/classEffect.js';
import { runInteractionProbe } from './probes/interaction.js';
import { runVisualCritique, type CritiqueModel } from './probes/visualCritic.js';
import { runA11yProbe, isGenerationDefect, isDesignSystemConcern, isDesignSystemInternal, isContrastDefect } from './probes/a11y.js';
import type { Finding, VerifyReport, VerifyCoverage } from './findings.js';
import { blockers, summarize, coverageRatio, missingLayers } from './findings.js';

export interface VerifyStoryOptions {
  /** The story's file name, so an index match by title is confined to this file. */
  fileName?: string;
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
   * The component framework of the story. Ownership of a rendered node is
   * read from React's fiber; for anything else it is unknown, and a finding
   * that cannot be attributed must not block or trigger repair — the only
   * repair a model can make to a library's own markup is to stop using the
   * component.
   */
  framework?: string;
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

const notVerified = (
  reason: string,
  started: number,
  extra: Finding[] = [],
  storyId?: string,
): VerifyReport => {
  // Every verification that did not happen says so in the log. A `verified`
  // has a line, an `issues` has a line; a `not_verified` had none, so a
  // Storybook that was down for an hour left the log looking exactly like
  // one where nothing needed checking.
  logger.log(`🔍 Verification not run: ${reason}`);
  return {
    outcome: 'not_verified',
    reason,
    findings: extra,
    metrics: {},
    durationMs: Date.now() - started,
    storyId,
  };
};

/**
 * Why a story could not be looked up in Storybook's index, in the words the
 * user needs. Three situations that used to share one message:
 *
 *  - Storybook was never reached: nothing on the port, or an error page.
 *    Start it, or point verification at the right URL.
 *  - Storybook answered, and its index knows fewer generated stories than
 *    the directory holds: the file watcher has died. Restart it.
 *  - Storybook answered, the counts agree, and the story is not there: it
 *    was not picked up in time.
 *
 * Every reason names the URL that was checked, because "did not appear in
 * the index" was also what a story indexed on :6103 got when verification
 * had been looking at :6006.
 */

/**
 * A "not indexed" result on macOS is almost always Storybook's fs.watch
 * stream having dropped the file (see storybookWatcher.ts — it is not a
 * version), so say so where the user is looking: `story-ui check` proves it
 * live, but nobody runs check when a story fails.
 */
export { storybookWatcherHint };

export function classifyIndexMiss(
  storybookUrl: string,
  lookup: Pick<IndexLookup, 'reachable' | 'error'>,
  staleness: { stale: boolean; onDisk: number; indexed: number },
  storyIdPrefix: string,
): { reason: string; finding: Finding } {
  const url = storybookUrl.replace(/\/+$/, '');
  if (!lookup.reachable) {
    const why = lookup.error ? ` (${lookup.error})` : '';
    return {
      reason: `Storybook at ${url} is not reachable${why} — start it, or point verification at the Storybook this project uses`,
      finding: {
        id: 'storybook-unreachable', severity: 'warning', class: 'infrastructure',
        message: `Storybook at ${url} is not reachable, so the story was not verified`,
        evidence: lookup.error ? `${url}/index.json: ${lookup.error}` : `${url}/index.json never answered`,
        repairable: false,
      },
    };
  }
  if (staleness.stale) {
    return {
      reason: `Storybook's index at ${url} is behind the filesystem — its file watcher has stopped picking up changes. Restart Storybook to verify.${storybookWatcherHint()}`,
      finding: {
        id: 'stale-index', severity: 'warning', class: 'infrastructure',
        message: 'Storybook\'s story index is stale — this is a dev-server problem, not a defect in the generated story',
        evidence: `${staleness.onDisk} generated story files on disk, ${staleness.indexed} in the index at ${url}`,
        repairable: false,
      },
    };
  }
  return {
    reason: `Story did not appear in the index at ${url} — it may not have been picked up yet${storybookWatcherHint() ? '.' + storybookWatcherHint() : ''}`,
    finding: {
      id: 'not-indexed', severity: 'warning', class: 'infrastructure',
      message: `Storybook at ${url} has not indexed the generated story`,
      evidence: `no entry starting with "${storyIdPrefix}--" after polling ${url}/index.json`,
      repairable: false,
    },
  };
}

/**
 * Which verification findings may be offered as "Fix: …" chips.
 *
 * A chip sends its text as the next prompt, so it is a promise that the
 * story can fix this. That holds only when the finding is repairable AND the
 * finding can be attributed to the story: ownership is read from React's
 * fiber, so outside React a warning like "class v-card--density-default is
 * not defined by any loaded stylesheet" may be — and on Vuetify is — the
 * library's own markup. Such findings stay in the list as information and
 * never become a chip. Infrastructure findings describe our environment and
 * are never the story's to fix.
 */
export function attributionSupported(framework: string | undefined): boolean {
  return !framework || framework === 'react';
}

export function repairableByStory(findings: Finding[], framework: string | undefined): Finding[] {
  if (!attributionSupported(framework)) return [];
  return findings.filter(f =>
    f.class !== 'infrastructure' &&
    f.repairable &&
    (f.severity === 'blocker' || f.severity === 'warning'),
  );
}

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

/** How long a new story gets to reach Storybook's index. A live watcher answers in about a second; a busy one in tens. */
export const INDEX_WAIT_MS = 60_000;

export async function verifyStory(options: VerifyStoryOptions): Promise<VerifyReport> {
  const started = Date.now();
  const { storybookUrl, storyIdPrefix, title, projectRoot = process.cwd(), timeoutMs = 20000, libraryComponents, generatedDir, visualCritic, request, componentsUsed, framework } = options;

  if (!storybookUrl) {
    return notVerified('No Storybook URL available to verify against', started);
  }

  const tooling = resolveHostTooling(projectRoot);
  if (!tooling) {
    return notVerified('Playwright is not installed in this project — install it to enable verification', started);
  }

  const launch = await canLaunchBrowser(tooling);
  if (!launch.ok) {
    return notVerified(describeLaunchFailure(launch.error || ''), started);
  }

  // The story has to be in the index before it can be rendered by id. This also
  // separates "generated badly" from "Storybook never noticed the file".
  // Storybook 10.5.10 indexes a new file reliably but not instantly: with a
  // 10s wait, two of three stories were declared "index behind" and never
  // verified, then appeared a moment later. 30s, bounded by the budget.
  // 60s, not 30: with several Storybooks rebuilding their indexes on one
  // machine, a story the harness later found within a minute was reported
  // "not in the index" at thirty seconds. A live watcher (polling) still
  // answers in about a second; the cap only matters when it is busy.
  // Independent of the render timeout: that defaults to 20s and capped the
  // index wait with it, so a story indexed at 25s was reported missing.
  const indexed = await waitForStoryIndexed(storybookUrl, storyIdPrefix, INDEX_WAIT_MS, 250, title, options.fileName);
  if (!indexed.indexed || !indexed.storyId) {
    // Down, stale watcher, or not picked up yet? Reachability and the counts
    // answer it, and the three need different responses from whoever reads
    // this. The counts are only worth asking for when the index answered.
    let staleness = indexed.reachable && generatedDir
      ? await indexIsStale(storybookUrl, generatedDir)
      : { stale: false, onDisk: 0, indexed: 0 };
    if (staleness.stale && generatedDir) {
      // Two stories written seconds apart put the count two behind for a
      // moment and a live watcher was reported dead. Stale means it STAYS
      // behind: ask again after the indexer has had time to catch up.
      await new Promise(r => setTimeout(r, 4000));
      staleness = await indexIsStale(storybookUrl, generatedDir);
    }
    const miss = classifyIndexMiss(storybookUrl, indexed, staleness, storyIdPrefix);
    return notVerified(miss.reason, started, [miss.finding]);
  }

  // Which Storybook. A result that names no URL cannot be told apart from one
  // measured against the wrong server — the panel used to verify against
  // :6006 "by convention" and nothing in the log said so once it succeeded.
  logger.log(`🔍 Verifying ${indexed.storyId} at ${storybookUrl.replace(/\/+$/, '')}`);
  const render = await renderStory({ storybookUrl, storyId: indexed.storyId, tooling, timeoutMs });

  if (!render.ok) {
    // A render failure is a code defect worth repairing ONLY when the page
    // actually loaded and the story then failed to put anything on it. When
    // the harness threw on its way there — chromium refusing to launch, a
    // refused connection, a tab that died, Storybook restarting mid-run — we
    // never observed the story at all, and charging that to the generated
    // code spends a repair rewriting something already correct.
    if (render.failureClass === 'infrastructure') {
      return notVerified(
        `Could not render the story from ${storybookUrl.replace(/\/+$/, '')} in a browser: ${render.reason || 'unknown error'}`,
        started,
        [{
          id: 'render-unavailable', severity: 'warning', class: 'infrastructure',
          message: 'The browser could not render the story, so it was not verified',
          evidence: (render.reason || '').slice(0, 500),
          repairable: false,
        }],
        indexed.storyId,
      );
    }

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

    // Track what actually executed. `verified` reports that nothing blocking
    // was found; this reports how much of the page was looked at, so the two
    // claims stop being indistinguishable.
    const coverage: VerifyCoverage = {
      census: { ran: false, reason: 'did not run' },
      layout: { ran: false, reason: 'did not run' },
      classes: { ran: false, reason: 'did not run' },
      interaction: { ran: false, reason: 'did not run' },
      a11y: { ran: false, reason: 'did not run' },
      visual: { ran: false, reason: 'not requested' },
    };

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

    /**
     * React's own warnings are findings too. "React does not recognize the
     * `InputProps` prop on a DOM element" means the story used a prop the
     * installed major removed and it is being spread onto a <div>; "a props
     * object containing a key is being spread" is a React 19 break. Both
     * rendered fine, so nothing else noticed; the bench saw them as console
     * errors on every page that showed the story's thumbnail.
     */
    const reactWarning = /does not recognize the [`'"]?(\w+)[`'"]? prop|Unknown event handler property [`'"]?(\w+)[`'"]?|containing a "key" prop is being spread|Each child in a list should have a unique "key"|Invalid DOM property|Received `?(true|false)`? for a non-boolean attribute|cannot be a descendant of|cannot appear as a child of|cannot contain a nested/;
    const seenWarnings = new Set<string>();
    for (const line of render.consoleErrors) {
      const m = reactWarning.exec(line);
      if (!m) continue;
      const prop = m[1] || m[2];
      const key = (prop || m[0]).toLowerCase();
      if (seenWarnings.has(key) || seenWarnings.size >= 6) continue;
      seenWarnings.add(key);
      findings.push({
        id: `react-warning-${key.replace(/\W+/g, '-')}`, severity: 'warning', class: 'code',
        message: prop
          ? `React does not recognize the \`${prop}\` prop — it is reaching a DOM element, so the component ignores it (the prop does not exist on that component)`
          : /cannot be a descendant|cannot appear as a child|cannot contain a nested/.test(line)
            ? `Invalid HTML nesting: ${line.replace(/\s+/g, ' ').replace(/^.*?(<\w+>[^.]*)/, '$1').slice(0, 140)}`
            : 'React reported a rendering warning for this story',
        evidence: line.replace(/%s/g, m[1] || '').replace(/\s+/g, ' ').slice(0, 300),
        repairable: true,
      });
    }

    const census = await runDomCensus(render.page, { libraryComponents });
    coverage.census = { ran: true };

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
    /**
     * Use the page, do not merely look at it.
     *
     * Every probe above observes a static render, and a human reviewer found two
     * defects living precisely in that gap: three toggle switches that were
     * correctly labelled, focusable, axe-clean and completely inert, and a menu
     * that pushed sibling content sideways every time it opened. Neither is
     * visible in a screenshot, so the vision critic cannot see them either.
     */
    const interaction = await runInteractionProbe(render.page, { libraryComponents });
    coverage.interaction = interaction.skipped
      ? { ran: false, reason: interaction.skipReason || 'skipped' }
      : { ran: true };
    if (interaction.skipped) {
      logger.log(`🖱️ Interaction checks skipped: ${interaction.skipReason} — controls unverified, not working`);
    } else {
      for (const c of interaction.deadControls) {
        /**
         * Deliberately NOT attributed to the library, unlike a11y and census
         * findings.
         *
         * The element is always a library component — it is the library's Switch
         * or Checkbox — so attributing by who rendered it would demote every
         * single dead control to a warning and defeat the check entirely.
         * Measured: three inert Astryx switches all reported owner=Switch.
         *
         * But the WIRING is the story's. The real defect in that case was the
         * story passing `isSelected={…}` to a component whose prop is `value` —
         * React Aria's convention on a library that does not use it. The handler
         * fired, state updated, and the control never reflected it. That is
         * fixable from the composition, which is the test for repairable.
         *
         * Same reasoning as grid underfill in the layout probe: fiber names the
         * container's owner, but the spans are props the story wrote.
         */
        findings.push({
          id: `dead-control-${findings.length}`,
          severity: 'blocker',
          class: 'interaction',
          message: `"${c.label}" does not respond to a click`,
          evidence: `${c.descriptor}${c.owner ? ` (a <${c.owner}>)` : ''}: clicked it and waited for ${c.expected}. `
            + `Check the component's own prop names — a value/checked prop from a different library is ignored silently.`,
          repairable: true,
        });
      }
      for (const o of interaction.flowBreakingOverlays) {
        findings.push({
          id: `overlay-in-flow-${findings.length}`,
          severity: o.ownedByLibrary ? 'warning' : 'blocker',
          class: 'interaction',
          message: o.ownedByLibrary && o.owner
            ? `Opening "${o.label}" moves the page — rendered by <${o.owner}>, a design system component`
            : `Opening "${o.label}" pushes other content instead of floating above it`,
          evidence: `${o.siblingsMoved} element(s) shifted by up to ${o.shiftedBy}px when it opened. `
            + `The overlay is in the document flow — it needs the library's portal/positioner parts around its content.`,
          repairable: !o.ownedByLibrary,
        });
      }
      logger.log(
        `🖱️ Interaction: ${interaction.controlsTested} control(s) and ${interaction.overlaysTested} overlay(s) exercised` +
        ` — ${interaction.deadControls.length} inert, ${interaction.flowBreakingOverlays.length} in-flow` +
        (interaction.controlsTested === 0 && interaction.overlaysTested === 0
          ? (interaction.buttonsPresent
              ? ` (${interaction.buttonsPresent} button(s)/link(s) present, not exercised — only toggles and overlays are clicked; not a pass)`
              : ' (nothing interactive found — not a pass)')
          : '') +
        // A cap reached is not an all-clear, and must not read like one.
        (interaction.controlsSkippedByCap || interaction.overlaysSkippedByCap
          ? ` · CAPPED: ${interaction.controlsSkippedByCap} control(s) and ${interaction.overlaysSkippedByCap} overlay(s) left untested`
          : ''),
      );
    }

    const classes = await runClassEffectProbe(render.page, { libraryComponents });
    coverage.classes = classes.unreadable
      ? { ran: false, reason: `${classes.sheetsBlocked} stylesheet(s) unreadable, 0 readable` }
      : { ran: true };
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
    coverage.layout = { ran: true };
    /**
     * Blockers: a row that does not fill its grid, a row that ends a column
     * short, a pill stretched by its stack, a toolbar spread across the page.
     * Each is the most visible defect a design system owner sees, each is
     * arithmetic the probe measured, and each is repairable from the
     * composition — a span, a wrapper, a container. Ragged left edges stay a
     * warning: a few pixels is real but not worth a regeneration.
     *
     * A layout finding the probe attributes to the LIBRARY (the placement was
     * made inside a design system component, not by the story) is reported
     * at warning and never repaired, for the same reason as everywhere else:
     * the only fix a model can make to the library's own markup is to stop
     * using the component.
     */
    // Alignment is rhythm: a control row that sags, a filter bar whose fields
    // are different heights, and a label off its tick box are each the kind of
    // defect a designer names on sight, and each is arithmetic on rendered
    // boxes rather than taste. They block for the same reason the rest do.
    const BLOCKING_LAYOUT_KINDS = new Set([
      'grid_underfilled', 'grid_ragged', 'stretched_control', 'gap_outlier',
      'row_misaligned', 'row_height_mismatch', 'label_misaligned',
    ]);
    for (const p of layout.problems) {
      findings.push({
        id: `${p.kind}-${findings.length}`,
        severity: BLOCKING_LAYOUT_KINDS.has(p.kind) && !p.ownedByLibrary ? 'blocker' : 'warning',
        class: 'code',
        message: p.ownedByLibrary && p.owner
          ? `${p.message} — in <${p.owner}>, a design system component`
          : p.message,
        evidence: p.evidence,
        selector: p.selector,
        repairable: !p.ownedByLibrary,
      });
    }
    /**
     * Looks broken, measured: content painting past its container, text cut
     * off, siblings overlapping, a page wider than the viewport, a bordered
     * box with nothing in it. A stat value "34,600 nm" wider than its tile
     * went out as "Verified" before this ran. Every kind blocks when the
     * story wrote it — a person would call each one broken on sight — and is
     * repairable with the numbers and the fix in the message.
     */
    const overflow = await runOverflowProbe(render.page, { libraryComponents });
    coverage.overflow = { ran: true };
    for (const p of overflow.problems) {
      // Content that does not fit its box is the STORY's to fix even when a
      // library component drew the box: the story chose the value, the size
      // and the column width. "34,600 nm" spilling out of a design system's
      // stat tile is shortened, resized or given room by the composition,
      // never by the library. The other kinds follow the usual attribution.
      const storyCanFix = p.kind === 'content_escapes' || p.kind === 'text_clipped' || !p.ownedByLibrary;
      findings.push({
        id: `${p.kind}-${findings.length}`,
        severity: storyCanFix ? 'blocker' : 'warning',
        class: 'code',
        message: p.ownedByLibrary && p.owner
          ? `${p.message} — rendered by <${p.owner}>, a design system component${storyCanFix ? ': change what the story passes to it (a shorter value, a size prop, a wider column), not the component' : ''}`
          : p.message,
        evidence: p.evidence,
        selector: p.selector,
        repairable: storyCanFix,
      });
    }
    logger.log(overflow.problems.length
      ? `📐 Overflow: ${overflow.problems.length} finding(s) across ${overflow.metrics.boundaries} bounded containers — ${overflow.problems.map(p => p.kind).join(', ')}`
      : `📐 Overflow: none across ${overflow.metrics.boundaries} bounded containers (${overflow.metrics.elements} elements)`);
    /**
     * A composition that resizes when you use it.
     *
     * Switching a tab changed the dashboard's width from 980px to 1040px,
     * because its root took its width from its content. The host can cause
     * this (a preview stylesheet that centres the story) or the story can,
     * and either way the story is what can defend itself by declaring a
     * width. Blocking, because a page that jumps under the cursor is exactly
     * the "looks broken" the user sees.
     */
    for (const r of interaction.reflows ?? []) {
      /**
       * Whose defect is this?
       *
       * When Storybook's own root is a shrink-to-fit flex item — which a
       * project's preview stylesheet causes by centring the body — the width
       * follows the content whatever the story does, and asking a model to
       * fix it would have it rewrite a correct composition. That is the
       * environment's to fix, in one line of CSS, which `story-ui update`
       * writes. Only when the host is innocent is the story answerable.
       */
      findings.push(r.hostShrinkWraps
        ? {
            id: `reflow-host-${findings.length}`,
            severity: 'warning',
            class: 'infrastructure',
            message: `Using "${r.label}" changes the width of the whole page (${r.before}px → ${r.after}px), because this Storybook's preview makes the story hug its content rather than fill the canvas. The story is not the cause. Run \`npx story-ui update\` to add the one-line preview rule, then restart Storybook.`,
            evidence: `${r.descriptor} "${r.label}": ${r.before}px → ${r.after}px; #storybook-root is a shrink-to-fit item of a flex/grid parent`,
            repairable: false,
          }
        : {
            id: `reflow-${findings.length}`,
            severity: 'blocker',
            class: 'code',
            message: `Using "${r.label}" changes the width of the whole composition (${r.before}px → ${r.after}px), so the page jumps when it is used — its width depends on which content is showing. Give the composition's outermost element a width that does not follow its content.`,
            evidence: `${r.descriptor} "${r.label}": composition ${r.before}px → ${r.after}px while the viewport changed by ${r.hostDelta}px`,
            repairable: true,
          });
    }

    findings.push(...censusFindings(census.problems));

    // Accessibility. Only rules that indicate the GENERATOR produced wrong
    // markup can block; palette and document-structure rules describe the design
    // system itself and would push the model into overriding it.
    const a11y = await runA11yProbe(render.page, tooling);
    coverage.a11y = a11y.ran ? { ran: true } : { ran: false, reason: a11y.reason || 'axe did not run' };
    if (a11y.ran) {
      for (const v of a11y.violations) {
        // A violation on markup the library renders is not something the story
        // can fix, however severe the rule.
        const libraryInternal = isDesignSystemInternal(v.selector)
          || (!!v.owner && (libraryComponents ?? []).includes(v.owner));
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
        const critique = await runVisualCritique(
          { screenshot, request, componentsUsed }, visualCritic,
        );
        for (const v of critique.findings) {
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
        coverage.visual = critique.ran
          ? { ran: true }
          : { ran: false, reason: `critic call failed: ${critique.reason ?? 'unknown'}` };
        // Logged either way: "no findings" and "never ran" must not look alike.
        logger.log(critique.ran
          ? `👁️ Visual critique: ${critique.findings.length} finding(s)`
          : `👁️ Visual critique: DID NOT RUN (${critique.reason})`);
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        coverage.visual = { ran: false, reason: why };
        logger.warn(`[visual-critique] skipped: ${why}`);
      }
    }

    /**
     * Outside React nothing here can say who rendered a node, so every
     * blocker is an unattributed one. Reported, never enforced: the finding
     * stays, at warning, with the reason, and cannot spend an LLM call.
     */
    let attributionNote: string | undefined;
    if (framework && framework !== 'react') {
      let downgraded = 0;
      for (const f of findings) {
        if (f.severity === 'blocker' && f.class !== 'infrastructure') {
          f.severity = 'warning';
          f.repairable = false;
          f.evidence = `${f.evidence ? `${f.evidence}; ` : ''}unattributed: element ownership is only readable for React, so this may be the design system's own markup`;
          downgraded++;
        }
      }
      if (downgraded) {
        attributionNote = `${downgraded} finding(s) reported at warning: attribution is React-only and this is a ${framework} story`;
        logger.log(`🔍 ${attributionNote}`);
      }
    }
    const outcome = blockers(findings).length > 0 ? 'issues' : 'verified';
    const ratio = coverageRatio(coverage);
    const gaps = missingLayers(coverage);
    logger.log(
      `🔍 Verification (${indexed.storyId}): ${outcome} — ${summarize(findings)} ` +
      `[${census.metrics.focusables} focusable, ${census.metrics.realInputs} inputs, ${census.metrics.nodes} nodes] ` +
      `· ${ratio.ran}/${ratio.total} checks ran`,
    );
    // Name the gaps. "verified" with two layers dark is a materially weaker
    // claim than "verified" with all six, and the reader cannot tell from the
    // outcome alone.
    if (gaps.length) {
      logger.log(`   checks that did NOT run — ${gaps.join('; ')}`);
    }

    return {
      ...(attributionNote ? { reason: attributionNote } : {}),
      outcome,
      coverage,
      findings,
      metrics: {
        ...census.metrics,
        ...layout.metrics,
        navMs: render.navMs,
        checksRun: ratio.ran,
        checksTotal: ratio.total,
        // The NAMES of the layers that did not run travel with the count, so a
        // "5/6" badge can say which one instead of leaving it in the log.
        checksNotRun: gaps,
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

/**
 * One readable line for a browser that would not start.
 *
 * Playwright's own message is a boxed, multi-line paragraph ("Executable
 * doesn't exist at ~/Library/Caches/ms-playwright/chromium_headless_shell-1187
 * ╔══ ... ║ Looks like Playwright Test or Playwright was just installed or
 * updated ..."). Shown raw in a chat bubble it read as a crash. The fact is
 * simple — the package is installed, its browser is not — and so is the fix.
 */
export function describeLaunchFailure(error: string): string {
  if (/Executable doesn't exist|please run the following command|playwright install/i.test(error)) {
    return 'Playwright is installed but its browser is not. Run: npx playwright install chromium';
  }
  const firstLine = error.split('\n').map(l => l.replace(/[\u2500-\u257f]/g, '').trim()).find(Boolean) || 'unknown error';
  return `Browser could not launch: ${firstLine.slice(0, 200)}`;
}
