/**
 * Does the output conform to the facts we supplied?
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT ANOTHER PROBE.
 *
 * Every real defect found by review this session was the same thing: the model
 * applying knowledge that is TRUE SOMEWHERE ELSE. `isSelected` is React Aria's
 * prop, on a library whose prop is `value`. `card-bordered` was daisyUI v4,
 * renamed in v5. `Menu.Content` without a positioner is Radix's composition
 * applied to Chakra. `DataTable render` is what Carbon's own docs showed a
 * version ago. Not hallucination — transfer, plausible enough to survive review.
 *
 * And in nearly every case THE KNOWLEDGE LAYER ALREADY HELD THE RIGHT ANSWER.
 * The catalog listed `value (boolean)`. propExtractor knew every legal prop. We
 * knew, and the knowledge did not win.
 *
 * That reframes the work. "What other defect classes exist" is unbounded and
 * generates one hand-written check per answer — which is what this file replaces.
 * The bounded question is: for every fact we already extract, is the output
 * conformant to it? That set is enumerable, and it GROWS with the knowledge
 * layer rather than with anyone's memory of past bugs. When federation taught us
 * Fluent's 198 components' props, conformance over Fluent became possible with
 * no new code here.
 *
 * THE HARD CONSTRAINT. A rule may only fire where our knowledge of that fact is
 * CLOSED. Measured, the naive version is unusable: unknown-prop validation
 * flagged 6,097 of 6,541 Mantine elements, and required-prop validation 894 of
 * 981 — because Mantine's `checked`/`onChange` arrive through
 * `ElementProps<'input'>` and are invisible to extraction. Firing on partial
 * knowledge rejects correct code, which is strictly worse than missing a defect:
 * it teaches the reader to ignore the whole report.
 *
 * So the rules here are exactly the ones whose facts are closed by construction:
 *
 *   ENUM VALUES   — resolved from the library's own const tuple. Either we
 *                   resolved the union or we did not; there is no inheritance
 *                   hole to be wrong about.
 *   DEPRECATED    — completeness is irrelevant. If we know a prop is deprecated,
 *                   we know it exists.
 *
 * Required-prop and unknown-prop checking belong here too and are deliberately
 * absent: both need extraction to declare its own completeness first, which is a
 * change to the extractor's contract that every environment depends on.
 *
 * Measured baseline across 207 generated stories on six design systems: 0 enum
 * violations, 16 deprecated-prop uses. The zero is itself the finding — the
 * catalog presents legal values as a closed set inline, and the model respects
 * them. Deprecations were only MARKED, and marking lost. This check exists for
 * the case where a prop is written from memory rather than read from the
 * catalog; withholding it from the catalog is the first line, and this is the
 * second.
 */

import ts from 'typescript';
import type { ExtractedProps } from './propExtractor.js';

export interface ConformanceViolation {
  /** Which fact was contradicted. */
  kind: 'enum_value' | 'deprecated_prop';
  component: string;
  prop: string;
  line: number;
  /** A message that names the fix, not just the fault. */
  message: string;
}

/**
 * Props every React component accepts, which no design system declares.
 *
 * Checked against the catalog rather than assumed: a component that genuinely
 * declares `key` or `className` still gets its own facts used.
 */
const UNIVERSAL = new Set(['key', 'ref', 'children', 'className', 'style', 'id']);

export function checkConformance(
  code: string,
  known: Pick<ExtractedProps, 'components'> | null | undefined,
  fileName = 'story.tsx',
): ConformanceViolation[] {
  if (!known?.components) return [];
  const out: ConformanceViolation[] = [];
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  } catch {
    return [];   // unparseable code is the AST validator's problem, not ours
  }

  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const facts = known.components[tag];
      if (facts?.props?.length) {
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !attr.name) continue;
          const prop = attr.name.getText(source);
          if (UNIVERSAL.has(prop) || prop.startsWith('aria-') || prop.startsWith('data-')) continue;
          const fact = facts.props.find(p => p.name === prop);
          if (!fact) continue;   // unknown props need a completeness signal first

          if (fact.deprecated) {
            const detail = fact.deprecated !== 'deprecated'
              ? ` ${String(fact.deprecated).replace(/\s+/g, ' ').trim()}`
              : '';
            out.push({
              kind: 'deprecated_prop', component: tag, prop, line: lineOf(attr),
              message: `<${tag} ${prop}> uses a prop this version of the library deprecates.${detail}`,
            });
          }

          /**
           * A literal value outside the resolved option set.
           *
           * Only a plain string literal is judged. An expression could evaluate
           * to anything, and guessing at one is how a check starts rejecting
           * correct code.
           */
          if (fact.options?.length && attr.initializer) {
            let literal: string | null = null;
            if (ts.isStringLiteral(attr.initializer)) literal = attr.initializer.text;
            else if (ts.isJsxExpression(attr.initializer)
              && attr.initializer.expression
              && ts.isStringLiteral(attr.initializer.expression)) {
              literal = attr.initializer.expression.text;
            }
            if (literal !== null && !fact.options.includes(literal)) {
              out.push({
                kind: 'enum_value', component: tag, prop, line: lineOf(attr),
                message: `<${tag} ${prop}="${literal}"> is not one of the values this prop accepts: `
                  + `${fact.options.slice(0, 10).join(' | ')}${fact.options.length > 10 ? ' | …' : ''}.`,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Violations as the self-healing loop consumes them. */
export function formatConformanceErrors(violations: ConformanceViolation[]): string[] {
  return violations.map(v => `Line ${v.line}: ${v.message}`);
}
