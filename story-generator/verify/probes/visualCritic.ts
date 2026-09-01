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

const CRITIQUE_PROMPT = (request: string, components: string[]) => `You are reviewing a UI that was generated from a written request. You can see the rendered result.

THE REQUEST WAS:
${request}

COMPONENTS THE DESIGN SYSTEM PROVIDED (the implementation may only use these):
${components.length ? components.join(', ') : '(not recorded)'}

Judge ONLY what is visible in the screenshot. Report a finding when the rendered result:
- fails to deliver something the request explicitly asked for
- has an obviously broken or unbalanced layout (an element overflowing, a region conspicuously empty, content colliding or clipped)
- has a hierarchy that misleads — for example a secondary action styled as the primary one, or a heading that reads as body text

RULES, which matter more than the findings themselves:
1. Every finding must name something a person could POINT AT in the image.
2. Every finding must state a concrete change. "Improve the visual hierarchy" is not a finding. "The Save and Publish buttons are identical weight, so the primary action is ambiguous — make Publish primary and Save secondary" is.
3. Do NOT report subjective polish: colour preferences, spacing you would have chosen differently, or anything phrased as "consider".
4. Do NOT suggest components that are not in the list above.
5. If the composition delivers the request and has no visible defect, return an EMPTY list. That is a normal and expected answer — most well-formed output should produce it. Inventing a finding to seem useful causes correct code to be rewritten.

Respond with JSON only, no prose around it:
{"findings":[{"issue":"...","element":"...","severity":"blocker|warning","fix":"..."}]}

Use "blocker" ONLY when the result fails the request or is visibly broken. Everything else is "warning".`;

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

  return findings
    .filter((f: any) => typeof f?.issue === 'string' && f.issue.trim().length > 12)
    // A finding phrased as a suggestion is an opinion. Opinions rewrite
    // working code.
    .filter((f: any) => !VAGUE.test(f.issue) && !VAGUE.test(f.fix ?? ''))
    .slice(0, 6)
    .map((f: any) => ({
      issue: String(f.issue).slice(0, 300),
      element: typeof f.element === 'string' ? f.element.slice(0, 80) : undefined,
      severity: f.severity === 'blocker' ? 'blocker' : 'warning',
      fix: typeof f.fix === 'string' ? f.fix.slice(0, 300) : undefined,
    })) as VisualFinding[];
}
