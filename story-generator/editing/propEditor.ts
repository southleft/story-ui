/**
 * Direct property editing — changing a prop without asking a model.
 *
 * Changes to a generated story fall into two classes that have been treated as
 * one:
 *
 *   COMPOSITIONAL  "add a filters panel", "make this three columns". Needs
 *                  judgement about structure and component choice. A model is
 *                  the right tool.
 *
 *   PARAMETRIC     "make this button red", "use the secondary variant",
 *                  "increase the gap". There is exactly ONE correct edit to
 *                  exactly one attribute of one element. A model adds latency,
 *                  cost, and risk, and nothing else.
 *
 * Routing the second class through an LLM is how a request to change a
 * background colour returned an entirely different page. This module removes
 * the model from that path: the edit is an AST transform, it is instant, it is
 * free, and it is structurally incapable of touching anything it was not
 * pointed at.
 *
 * TARGETING. React 19 removed `_debugSource`, so a DOM node cannot be mapped
 * to a file and line directly. `_debugOwner` survives and names the component
 * whose render authored the element, which is enough: the caller identifies
 * the element as "the Nth <Dropdown> authored by the story", and this finds
 * the Nth <Dropdown> in the source. Both orders are document order, so they
 * correspond.
 *
 * The known limit is `.map()` — one JSX element produces many DOM nodes, so
 * occurrence N in the DOM is not occurrence N in the source. That case is
 * detected rather than guessed at (see `occurrencesInSource`), and the caller
 * is told the edit applies to every instance, which is nearly always what
 * someone selecting one row of a repeated list actually wants.
 */

import ts from 'typescript';

export interface PropEdit {
  /** JSX element name, e.g. `Button`. */
  component: string;
  /** Which occurrence in source order, 0-based. */
  occurrence: number;
  /** Attribute to set. */
  prop: string;
  /**
   * New value. A string becomes a string literal; anything else becomes an
   * expression container. `null` REMOVES the attribute, which is how a prop is
   * reset to its default.
   */
  value: string | number | boolean | null;
}

export interface PropEditResult {
  code: string;
  changed: boolean;
  /** What the attribute was before, for undo and for reporting. */
  previous?: string;
  /** Human-readable reason when nothing changed. */
  reason?: string;
}

/** How many times this component appears as a JSX element in the source. */
export function occurrencesInSource(code: string, component: string): number {
  const source = ts.createSourceFile('story.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === component) count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

/**
 * Set, replace or remove one attribute on one JSX element.
 *
 * Uses the TypeScript printer on a transformed AST rather than string surgery.
 * Regex editing of JSX looks adequate until an attribute value contains a
 * brace, a nested element or a template string — and this codebase has already
 * been bitten by a regex that spanned two statements and by one that treated
 * `/**\/` as a comment.
 */
export function editProp(code: string, edit: PropEdit): PropEditResult {
  const source = ts.createSourceFile('story.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  let seen = 0;
  let found = false;
  let previous: string | undefined;

  const makeInitializer = (): ts.JsxAttributeValue | undefined => {
    const v = edit.value;
    if (typeof v === 'string') return ts.factory.createStringLiteral(v);
    if (typeof v === 'number') {
      return ts.factory.createJsxExpression(undefined, ts.factory.createNumericLiteral(v));
    }
    if (typeof v === 'boolean') {
      // `<X flag />` rather than `<X flag={true} />` — the idiom every design
      // system's own examples use.
      return v ? undefined : ts.factory.createJsxExpression(undefined, ts.factory.createFalse());
    }
    return undefined;
  };

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => (root) => {
    const visit = (node: ts.Node): ts.Node => {
      const isOpening = ts.isJsxOpeningElement(node);
      const isSelfClosing = ts.isJsxSelfClosingElement(node);

      if ((isOpening || isSelfClosing) && (node as any).tagName.getText(source) === edit.component) {
        const index = seen++;
        if (index === edit.occurrence) {
          found = true;
          const element = node as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
          const existing = element.attributes.properties.filter(
            (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(source) === edit.prop,
          );
          if (existing.length) {
            previous = existing[0].initializer ? existing[0].initializer.getText(source) : 'true';
          }

          const isTarget = (a: ts.JsxAttributeLike) =>
            ts.isJsxAttribute(a) && a.name.getText(source) === edit.prop;

          const replacement = ts.factory.createJsxAttribute(
            ts.factory.createIdentifier(edit.prop),
            makeInitializer(),
          );

          /**
           * Replace IN PLACE; only append when the attribute is new.
           *
           * Removing and re-appending moved every edited prop to the end of
           * the tag, so changing `kind` on `<Button kind="tertiary"
           * size="sm">` rewrote it as `<Button size="sm" kind="danger">`. The
           * result is correct and the diff is noise — and this writes to a
           * file someone else reviews, where a tool that reshuffles lines it
           * did not need to touch stops being trusted.
           */
          const next = edit.value === null
            ? element.attributes.properties.filter(a => !isTarget(a))
            : existing.length
              ? element.attributes.properties.map(a => (isTarget(a) ? replacement : a))
              : [...element.attributes.properties, replacement];

          const attrs = ts.factory.createJsxAttributes(next);
          return isSelfClosing
            ? ts.factory.updateJsxSelfClosingElement(
                node as ts.JsxSelfClosingElement,
                (node as ts.JsxSelfClosingElement).tagName,
                (node as ts.JsxSelfClosingElement).typeArguments,
                attrs,
              )
            : ts.factory.updateJsxOpeningElement(
                node as ts.JsxOpeningElement,
                (node as ts.JsxOpeningElement).tagName,
                (node as ts.JsxOpeningElement).typeArguments,
                attrs,
              );
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  };

  const result = ts.transform(source, [transformer]);
  const transformed = result.transformed[0];

  if (!found) {
    result.dispose();
    return {
      code,
      changed: false,
      reason: `No <${edit.component}> at occurrence ${edit.occurrence} — the file has ${seen}.`,
    };
  }

  /**
   * Print the WHOLE file from the transformed AST.
   *
   * The printer reformats, which is a real cost — but emitting only the
   * changed node and splicing it back by offset is how a "targeted" edit
   * corrupts a file when any earlier transform has shifted positions. A stable
   * file that is reformatted beats an unstable one that is not.
   */
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });
  const printed = printer.printFile(transformed);
  result.dispose();

  return { code: printed, changed: true, previous };
}
