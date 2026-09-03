/**
 * Visual critique — the part of "does this look right" that arithmetic cannot
 * reach.
 *
 * The layout probe answers questions with exact answers: does this row fill
 * its grid, do these siblings share a left edge. What it cannot answer is
 * whether the composition ANSWERS THE REQUEST — whether the dashboard someone
 * asked for arrived as a dashboard, whether the hierarchy reads, whether a
 * region is conspicuously empty. Those need eyes.
 *
 * THE FAILURE MODE THIS IS DESIGNED AROUND. An unmeasured critic makes things
 * worse. Vague aesthetic feedback ("improve the visual hierarchy", "consider
 * more whitespace") fed back into a generator produces drift, not improvement:
 * the model rewrites working code to satisfy an opinion nobody can check, and
 * every pass moves further from what was asked for. That is the same shape as
 * the targeted edit that replaced a whole page.
 *
 * So the contract is narrow and enforced by the schema:
 *   - every finding names something VISIBLE in the screenshot
 *   - every finding states a CONCRETE change, not a direction
 *   - an empty list is a valid and expected answer
 *
 * A critic that always finds something is noise, and noise here costs a
 * regeneration of code that was already correct.
 */

import { logger } from '../../logger.js';

export interface VisualFinding {
  /** Which shippability category the critic put it in, when it said. */
  category?: string;
  /** The container the element sits in, as the critic named it. */
  container?: string;
  /** What is wrong, stated so a reader could confirm it from the image. */
  issue: string;
  /** The visible thing it concerns — "the filters panel", "the metric tiles". */
  element?: string;
  /** blocker = the composition fails the request; warning = worth knowing. */
  severity: 'blocker' | 'warning';
  /** The specific change to make. Absent when there is no concrete fix. */
  fix?: string;
}

export interface VisualCritiqueInput {
  /** PNG bytes of the rendered story. */
  screenshot: Buffer;
  /** What the user actually asked for. The critic judges against THIS. */
  request: string;
  /** Design system components the story used, so it does not suggest foreign ones. */
  componentsUsed?: string[];
}

/** Supplied by the caller so this module stays free of provider coupling. */
export type CritiqueModel = (
  prompt: string,
  screenshot: Buffer,
) => Promise<string>;

const CRITIQUE_PROMPT = (request: string, components: string[]) => `You are the last reviewer before a generated UI is shown to the person who asked for it. You can see the rendered result. Answer one question: is this shippable as it stands?

THE REQUEST WAS:
${request}

COMPONENTS THE DESIGN SYSTEM PROVIDED (the implementation may only use these):
${components.length ? components.join(', ') : '(not recorded)'}

A result is NOT shippable — report a BLOCKER — when you can see any of these. Each category is something a person calls "broken" on sight:
- overflow: text, a number, an image or a control paints outside the box that contains it (a value wider than its tile, a label crossing a card's border)
- overlap: two elements occupy the same space
- clipped: text is cut off mid-word or mid-number where the whole was meant to show
- empty: a tile, panel, column or card that was meant to hold content is blank
- misaligned: rows, columns or paired fields visibly out of line with each other (one field lower than its partner, a card taller than its siblings for no reason)
- illegible: text too small, too faint, or wrapping mid-word so it cannot be read
- unstyled: a raw element (a browser-default button, input, table or link) inside an otherwise styled composition
- missing: something the request explicitly asked for is not there, or a state it asked for (an error state, a highlighted tier, three columns) is absent

RULES, which matter more than the findings themselves:
1. Every finding names the element by its visible text or label ("the value 34,600 nm", "the Sign in button") AND the container it sits in ("the Sea Miles tile", "the third card"). A reader must be able to point at it.
2. Every finding states one concrete change the code can make: a smaller size from the type scale, letting the tile grow, wrapping, a gap, an alignment, the missing element. "Improve the layout" is not a finding.
3. Do NOT report taste: colour preferences, spacing you would have chosen differently, or anything phrased as "consider" or "could". Those are dropped unread.
4. Do NOT suggest components that are not in the list above.
5. If the composition delivers the request and nothing in the list above is visible, return an EMPTY list. That is the normal answer for good output; inventing a finding causes correct code to be rewritten.

Respond with JSON only, no prose around it:
{"findings":[{"category":"overflow|overlap|clipped|empty|misaligned|illegible|unstyled|missing|other","issue":"...","element":"...","container":"...","severity":"blocker|warning","fix":"..."}]}

Use "blocker" for every category above. Use "warning" only for something real that is not in the list (a hierarchy that misleads — a secondary action styled as the primary one).`;

/**
 * Ask a vision model whether the rendered composition answers the request.
 *
 * Returns an empty array on any failure — an unreachable or confused critic
 * must never block a generation that otherwise verified. This is additional
 * judgement, not a gate.
 */
export interface VisualCritiqueResult {
  findings: VisualFinding[];
  /** False when the model call itself failed. "No findings" and "never looked" are different answers. */
  ran: boolean;
  reason?: string;
}

export async function runVisualCritique(
  input: VisualCritiqueInput,
  model: CritiqueModel,
): Promise<VisualCritiqueResult> {
  try {
    const raw = await model(
      CRITIQUE_PROMPT(input.request, input.componentsUsed ?? []),
      input.screenshot,
    );
    return { findings: parseCritique(raw), ran: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`[visual-critique] did not run: ${reason}`);
    return { findings: [], ran: false, reason };
  }
}

/**
 * Parse the model's reply into findings, discarding anything that breaks the
 * contract.
 *
 * Filtering here rather than trusting the prompt: the instruction not to
 * produce vague findings is a request, and a rule that is only asked for is a
 * rule that eventually gets ignored. Anything without a concrete claim is
 * dropped rather than passed on to spend a repair attempt.
 */
export function parseCritique(raw: string): VisualFinding[] {
  if (!raw) {
    // A silent `[]` here is indistinguishable from "the model looked and
    // found nothing", which is the exact confusion this codebase keeps
    // paying for. The outer catch already warns; these paths did not.
    logger.warn('[visual-critique] model returned an empty reply — no findings, and nothing was judged');
    return [];
  }

  // Models wrap JSON in prose or fences no matter how firmly asked not to.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    logger.warn(`[visual-critique] no JSON object in the reply — not judged. First 120 chars: ${raw.slice(0, 120)}`);
    return [];
  }

  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    logger.warn(`[visual-critique] reply was not parseable JSON — not judged: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
  const VAGUE = /\b(consider|might|could|perhaps|maybe|generally|overall|polish|more modern|nicer|cleaner|improve the (look|feel|aesthetic))\b/i;

  const SHIPPABILITY = new Set(['overflow', 'overlap', 'clipped', 'empty', 'misaligned', 'illegible', 'unstyled', 'missing']);
  return findings
    .filter((f: any) => typeof f?.issue === 'string' && f.issue.trim().length > 12)
    // A finding phrased as a suggestion is an opinion. Opinions rewrite
    // working code.
    .filter((f: any) => !VAGUE.test(f.issue) && !VAGUE.test(f.fix ?? ''))
    // Rules 1 and 2 are enforced here, not merely asked, for anything that
    // would BLOCK: a blocker that names no element is one nobody can point
    // at and the repair cannot target; one without a fix is a complaint.
    // Both are kept as warnings, so the observation is not lost.
    .map((f: any) => {
      const named = typeof f.element === 'string' && f.element.trim().length > 1;
      const fixed = typeof f.fix === 'string' && f.fix.trim().length > 8;
      const wantsBlock = f.severity === 'blocker' || (typeof f.category === 'string' && SHIPPABILITY.has(f.category.toLowerCase()));
      return wantsBlock && !(named && fixed) ? { ...f, category: undefined, severity: 'warning' } : f;
    })
    .slice(0, 6)
    .map((f: any) => {
      const category = typeof f.category === 'string' && SHIPPABILITY.has(f.category.toLowerCase()) ? f.category.toLowerCase() : undefined;
      return {
        category,
        issue: String(f.issue).slice(0, 300),
        element: typeof f.element === 'string' ? f.element.slice(0, 80) : undefined,
        container: typeof f.container === 'string' ? f.container.slice(0, 80) : undefined,
        // A shippability category is a blocker by definition; anything else
        // is a blocker only if the critic said so and named the fix.
        severity: category || f.severity === 'blocker' ? 'blocker' : 'warning',
        fix: typeof f.fix === 'string' ? f.fix.slice(0, 300) : undefined,
      };
    }) as VisualFinding[];
}
