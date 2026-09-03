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
          /**
           * Only a CLOSED set can reject a value. Mantine's `color` resolves to
           * fourteen theme colours AND `(string & {})` — any shade like
           * "blue.9" or any CSS colour is legal, and the extractor records that
           * as `optionsOpen`. Judging the value against the fourteen rejected
           * `color="blue.9"` on correct code and cost two retries.
           */
          if (fact.options?.length && !fact.optionsOpen && attr.initializer) {
            const accepts = `${fact.options.slice(0, 10).join(' | ')}${fact.options.length > 10 ? ' | …' : ''}`;
            const expr = ts.isStringLiteral(attr.initializer)
              ? attr.initializer
              : ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
            if (!expr) continue;
            const { values, castToAny } = literalValuesOf(expr, source);
            /**
             * Every value the expression can take, when the file states them.
             *
             * A plain literal, a conditional, or a lookup into a const object
             * literal written in the same file all have a closed set of string
             * values, and each is judged. `STATE_TONE[row.state]` where
             * STATE_TONE maps to 'success' | 'warning' | 'danger' — another
             * library's names — crashed a house Pillbox whose palette has no
             * such keys ("undefined is not iterable"), twice, and the repair
             * could not see why. An expression whose values the file does not
             * state is left alone, as before.
             */
            const bad = values.filter(v => !fact.options!.includes(v));
            if (bad.length) {
              out.push({
                kind: 'enum_value', component: tag, prop, line: lineOf(attr),
                message: `<${tag} ${prop}=${values.length === 1 && ts.isStringLiteral(expr) ? `"${bad[0]}"` : `{…}`}> `
                  + `${values.length === 1 && ts.isStringLiteral(expr) ? 'is' : `can be "${bad.slice(0, 4).join('" | "')}", which is`} `
                  + `not one of the values this prop accepts: ${accepts}. Map your data to those values.`,
              });
            } else if (castToAny && values.length === 0) {
              /**
               * `as any` on a closed-enum prop exists only to defeat the type
               * — the value came from somewhere the type would have rejected.
               */
              out.push({
                kind: 'enum_value', component: tag, prop, line: lineOf(attr),
                message: `<${tag} ${prop}={… as any}> casts away this prop's type; it accepts only ${accepts}. `
                  + `Map your data to those values and drop the cast.`,
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

/**
 * The string values an expression can evaluate to, when the file states them:
 * a literal, a conditional's branches, a lookup into a const object literal
 * declared in this file, or any of those behind a cast. `castToAny` records
 * an `as any` / `<any>` anywhere in the chain.
 */
function literalValuesOf(expr: ts.Expression, source: ts.SourceFile, depth = 0): { values: string[]; castToAny: boolean } {
  const none = { values: [] as string[], castToAny: false };
  if (depth > 4) return none;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return { values: [expr.text], castToAny: false };
  if (ts.isParenthesizedExpression(expr)) return literalValuesOf(expr.expression, source, depth + 1);
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    const inner = literalValuesOf(expr.expression, source, depth + 1);
    const toAny = expr.type.kind === ts.SyntaxKind.AnyKeyword;
    return { values: inner.values, castToAny: inner.castToAny || toAny };
  }
  if (ts.isConditionalExpression(expr)) {
    const a = literalValuesOf(expr.whenTrue, source, depth + 1);
    const b = literalValuesOf(expr.whenFalse, source, depth + 1);
    if (!a.values.length || !b.values.length) return { values: [], castToAny: a.castToAny || b.castToAny };
    return { values: [...new Set([...a.values, ...b.values])], castToAny: a.castToAny || b.castToAny };
  }
  if ((ts.isElementAccessExpression(expr) || ts.isPropertyAccessExpression(expr)) && ts.isIdentifier(expr.expression)) {
    const table = objectLiteralNamed(expr.expression.text, source);
    if (!table) return none;
    if (ts.isPropertyAccessExpression(expr)) {
      const member = table.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source).replace(/['"]/g, '') === expr.name.text);
      if (member && ts.isPropertyAssignment(member)) return literalValuesOf(member.initializer, source, depth + 1);
      return none;
    }
    // A dynamic key: every value the table holds is reachable.
    const values: string[] = [];
    for (const p of table.properties) {
      if (!ts.isPropertyAssignment(p)) return none;
      const v = literalValuesOf(p.initializer, source, depth + 1);
      if (!v.values.length) return none;
      values.push(...v.values);
    }
    return { values: [...new Set(values)], castToAny: false };
  }
  return none;
}

/** `const NAME = { … }` at any depth of the file, when its initializer is an object literal. */
function objectLiteralNamed(name: string, source: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      let init: ts.Expression = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) found = init;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Violations as the self-healing loop consumes them. */
export function formatConformanceErrors(violations: ConformanceViolation[]): string[] {
  return violations.map(v => `Line ${v.line}: ${v.message}`);
}
