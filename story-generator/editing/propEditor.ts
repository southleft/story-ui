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
 * The names the file declares at top level — functions, variables, classes.
 *
 * This is the file's statement of which components are ITS OWN. It settles a
 * question no fiber fact can: whether a chain entry is an element the story
 * authored or a library internal. Measured live, a click on a Mantine
 * Button's label yields an internal Box owned by `Button` — imported, not
 * declared here — while the story's own elements are owned by `PricingPage`
 * or `PromoBanner`, which this set contains.
 */
export function topLevelDeclarations(code: string): Set<string> {
  const source = ts.createSourceFile('story.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set<string>();
  for (const stmt of source.statements) {
    if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
      names.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
    }
  }
  return names;
}

/**
 * Whole-file occurrence indices of `<component>` that sit inside the
 * declaration of the top-level component named `owner`.
 *
 * This is the file's answer to the browser's owner-scoped occurrence. The
 * fiber's `_debugOwner` names the component whose render authored a clicked
 * element — "VolunteerBanner", "PricingPage" — and DOM order only corresponds
 * to source order INSIDE one component's render: measured live, a banner
 * component DEFINED first but RENDERED last put its Button at whole-page DOM
 * position 8 in a file containing 3. The owner's declaration span is stated
 * by the file itself, so "the Nth <Button> inside VolunteerBanner" resolves
 * without any whole-page assumption.
 *
 * Indices are into the same pre-order walk `editProp` and
 * `occurrencesInSource` use, so a returned index can be passed straight to
 * `editProp`. Empty when the file declares no top-level function, variable or
 * class named `owner` — the caller must treat that as "cannot place", not as
 * "first one".
 */
/** Names Storybook gives the component that wraps an anonymous story `render`. */
export const STORYBOOK_RENDER_WRAPPERS = new Set(['unboundStoryFn', 'StoryFn', 'boundStoryFn', 'renderer', 'StoryRender']);

/**
 * The span of each story's render function: `export const X = { render: () => … }`
 * (CSF3), `render() {}` methods, and `export const X = () => …` (CSF2).
 * Keyed by export name, in source order.
 */
export function storyRenderSpans(code: string): Array<{ name: string; start: number; end: number }> {
  const source = ts.createSourceFile('story.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const spans: Array<{ name: string; start: number; end: number }> = [];
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const exported = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      let init: ts.Expression = decl.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        for (const prop of init.properties) {
          const isRender = (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop))
            && prop.name && ts.isIdentifier(prop.name) && prop.name.text === 'render';
          if (isRender) spans.push({ name: decl.name.text, start: prop.getStart(source), end: prop.getEnd() });
        }
      } else if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        if (decl.name.text !== 'meta') spans.push({ name: decl.name.text, start: decl.getStart(source), end: decl.getEnd() });
      }
    }
  }
  return spans;
}

export function occurrencesWithinOwner(
  code: string,
  component: string,
  owner: string,
  /** The story export the preview is showing, when the client knows it. */
  storyExport?: string,
): number[] {
  const source = ts.createSourceFile('story.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  let span: { start: number; end: number } | null = null;
  /**
   * An anonymous `render: () => …` has no name of its own; React reports
   * Storybook's wrapper (`unboundStoryFn`) as the owner, and no declaration
   * is named that. The region that corresponds to the DOM is the story's
   * render function. One story, or the named one, is unambiguous; several
   * stories all holding <component> are not, and stay a refusal.
   */
  const stories = storyRenderSpans(code);
  const isWrapper = STORYBOOK_RENDER_WRAPPERS.has(owner) || stories.some(st => st.name === owner);
  if (isWrapper) {
    const named = stories.find(st => st.name === (storyExport || owner));
    if (named) span = named;
    else if (stories.length === 1) span = stories[0];
    else {
      const holding = stories.filter(st => new RegExp(`<${component}(?=[\\s/>])`).test(code.slice(st.start, st.end)));
      if (holding.length === 1) span = holding[0];
    }
  }
  if (!span) {
    for (const stmt of source.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === owner) { span = { start: stmt.getStart(source), end: stmt.getEnd() }; break; }
      if (ts.isClassDeclaration(stmt) && stmt.name?.text === owner) { span = { start: stmt.getStart(source), end: stmt.getEnd() }; break; }
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === owner) { span = { start: decl.getStart(source), end: decl.getEnd() }; break; }
        }
        if (span) break;
      }
    }
  }
  if (!span) return [];

  const inside: number[] = [];
  let index = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === component) {
        const pos = node.getStart(source);
        if (pos >= span!.start && pos < span!.end) inside.push(index);
        index++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return inside;
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
/**
 * Read the attributes an element already carries.
 *
 * The property panel had no way to ask this, so every control rendered
 * uncontrolled: a `Select` with no `value` showed its placeholder even for a
 * prop the source explicitly sets, and a `Switch` with no `checked` rendered
 * off for a boolean that was already on. The panel was a write-only form over
 * state it could not read — you set `variant="outline"`, the canvas reloaded,
 * and the control still said "choose…", which is indistinguishable from the
 * edit not having landed.
 *
 * Same traversal and the same occurrence semantics as `editProp`, so what the
 * panel displays and what an edit will target cannot disagree.
 *
 * Values come back as the SOURCE text: a string literal without quotes, an
 * expression verbatim, and `true` for a bare shorthand flag.
 */
export function readProps(
  code: string,
  component: string,
  occurrence: number = 0,
): Record<string, string> | null {
  const source = ts.createSourceFile('story.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  let seen = 0;
  let result: Record<string, string> | null = null;

  const visit = (node: ts.Node): void => {
    if (result) return;
    const isOpening = ts.isJsxOpeningElement(node);
    const isSelfClosing = ts.isJsxSelfClosingElement(node);

    if ((isOpening || isSelfClosing) && (node as any).tagName.getText(source) === component) {
      if (seen++ === occurrence) {
        const element = node as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
        const found: Record<string, string> = {};
        for (const attr of element.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;   // spread — nothing to show
          const name = attr.name.getText(source);
          if (!attr.initializer) { found[name] = 'true'; continue; }
          if (ts.isStringLiteral(attr.initializer)) { found[name] = attr.initializer.text; continue; }
          if (ts.isJsxExpression(attr.initializer)) {
            found[name] = attr.initializer.expression?.getText(source) ?? '';
            continue;
          }
          found[name] = attr.initializer.getText(source);
        }
        result = found;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return result;
}

export function editProp(code: string, edit: PropEdit): PropEditResult {
  const source = ts.createSourceFile('story.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  let seen = 0;
  let found = false;
  let previous: string | undefined;
  /** The located element, so the edit can be applied as a text splice. */
  let targetElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;

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
          targetElement = element;
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

  result.dispose();

  /**
   * Splice the ONE attribute back into the original text.
   *
   * This used to print the whole file from the transformed AST, on the
   * reasoning that emitting a node and splicing it by offset is how a
   * "targeted" edit corrupts a file once an earlier transform has shifted
   * positions. That reasoning holds for MULTIPLE edits and not for one:
   * exactly one range changes here, so no offset can have moved beneath it.
   *
   * The cost of reprinting was not theoretical. TypeScript's printer
   * normalises formatting, so setting `size="xl"` on one Button also collapsed
   * a ten-line import block onto a single line — measured. This writes to a
   * file someone else reviews, and a one-attribute change that rewrites a
   * hundred lines is a change nobody can review.
   *
   * The AST above is still what LOCATES the attribute; only the rewriting is
   * textual, and if a range cannot be resolved we fall back to the printer.
   */
  const spliced = spliceAttribute(code, source, edit, targetElement);
  if (spliced !== null) return { code: spliced, changed: true, previous };

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });
  return { code: printer.printFile(transformed), changed: true, previous };
}

/**
 * Rewrite a single JSX attribute in the original source text.
 *
 * Returns null when the edit cannot be expressed as one contiguous range, so
 * the caller can fall back to a full reprint rather than guess.
 */
function spliceAttribute(
  code: string,
  source: ts.SourceFile,
  edit: PropEdit,
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null,
): string | null {
  if (!element) return null;

  const existing = element.attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(source) === edit.prop,
  );

  /** The attribute source text for the new value, or null to remove it. */
  const rendered = (): string | null => {
    const v = edit.value;
    if (v === null) return null;
    if (typeof v === 'string') return `${edit.prop}="${v.replace(/"/g, '&quot;')}"`;
    if (typeof v === 'number') return `${edit.prop}={${v}}`;
    // `<X flag />` rather than `<X flag={true} />` — every design system's own
    // examples use the shorthand.
    if (typeof v === 'boolean') return v ? edit.prop : `${edit.prop}={false}`;
    return null;
  };

  const text = rendered();

  if (existing) {
    const start = existing.getStart(source);
    const end = existing.getEnd();
    if (text === null) {
      // Remove the attribute AND the whitespace that preceded it, or the tag
      // is left with a double space where it used to be.
      let from = start;
      while (from > 0 && /\s/.test(code[from - 1])) from--;
      return code.slice(0, from) + code.slice(end);
    }
    return code.slice(0, start) + text + code.slice(end);
  }

  // Nothing to remove.
  if (text === null) return code;

  /**
   * A new attribute goes at the END of the existing ones, matching what the
   * AST path did. Insert after the last attribute, or after the tag name when
   * there are none — never by scanning for `>`, which would find the wrong
   * one inside a generic type argument or an attribute string.
   */
  const props = element.attributes.properties;
  const anchor = props.length > 0
    ? props[props.length - 1].getEnd()
    : element.tagName.getEnd();
  return code.slice(0, anchor) + ' ' + text + code.slice(anchor);
}
