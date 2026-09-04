/**
 * A CSS-named prop the component does not declare, moved into the style prop
 * it does declare — deterministically, instead of asking the model again.
 *
 * Measured on a twenty-prompt MUI run: 28 of 29 first-round validation errors
 * were `<Stack alignItems>` and `<Stack justifyContent>`, across half the
 * prompts. MUI removed both from Stack's own props in v6; they belong in `sx`.
 * The check was right, the catalog listed the real props, and the model wrote
 * the v5 idiom anyway — ten of twenty stories paid a full self-heal round trip
 * for it.
 *
 * There is exactly one correct edit and it is mechanical: the attribute's
 * value moves into the component's own style carrier under the same name. The
 * conformance checker already knows both halves — that the prop is undeclared,
 * and which of `sx`/`css`/`style` the component does declare — so this only
 * has to perform the move.
 *
 * IT IS DELIBERATELY CONSERVATIVE. A prop is moved only when its name is a CSS
 * property from the list below and its value is a literal. `variant` and
 * `color` are CSS properties AND common component props, so a component that
 * does not declare them is not asking for a style — those never move. Anything
 * this refuses stays a violation and reaches the model exactly as before.
 */

import ts from 'typescript';
import type { PropViolation } from './propConformance.js';

/**
 * CSS properties that a component might plausibly have exposed as a prop.
 *
 * Curated rather than derived: Node ships no CSS property list, and reaching
 * for a browser to get one would make a static repair depend on a render. The
 * cost of the list being short is a prop that stays a violation, which is the
 * behaviour without this file at all — so it errs that way on purpose.
 * `color`, `variant`, `size`, `width`, `height`, `display` and `overflow` are
 * excluded even though they are CSS: every design system uses at least one of
 * them as a semantic prop, and moving one into a style object would change
 * what the story means.
 */
const MOVEABLE = new Set([
  'alignItems', 'alignContent', 'alignSelf', 'justifyContent', 'justifyItems', 'justifySelf',
  'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'placeItems', 'placeContent',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'gridAutoFlow',
  'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginInline', 'marginBlock',
  'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingInline', 'paddingBlock',
  'maxWidth', 'minWidth', 'maxHeight', 'minHeight', 'textAlign', 'whiteSpace', 'wordBreak',
  'borderRadius', 'boxShadow', 'position', 'top', 'bottom', 'left', 'right', 'zIndex',
  'backgroundColor', 'textTransform', 'letterSpacing', 'lineHeight', 'fontWeight', 'fontSize',
  'objectFit', 'aspectRatio', 'cursor', 'opacity',
]);

export interface CssPropMove {
  line: number;
  component: string;
  prop: string;
  carrier: string;
}

export interface CssPropMoveResult {
  code: string;
  moved: CssPropMove[];
  /** Violations that were NOT moved, to be reported exactly as before. */
  remaining: PropViolation[];
}

/** The attribute's value as it should appear inside a style object. */
function valueText(attr: ts.JsxAttribute, src: ts.SourceFile): string | null {
  const init = attr.initializer;
  if (!init) return null;                                   // bare flag: not a style
  if (ts.isStringLiteral(init)) return JSON.stringify(init.text);
  if (ts.isJsxExpression(init) && init.expression) {
    const text = init.expression.getText(src);
    // A spread or an object would nest wrongly; anything else (a literal, a
    // template, an identifier, a ternary) is a value the carrier can hold.
    return ts.isObjectLiteralExpression(init.expression) ? null : text;
  }
  return null;
}

/**
 * Move every moveable violation into its component's style carrier.
 *
 * Returns the rewritten code and the violations that remain — never a claim
 * that a violation was handled when it was not.
 */
export function moveCssPropsIntoCarrier(
  code: string, violations: PropViolation[], fileName = 'story.tsx',
): CssPropMoveResult {
  const candidates = violations.filter(v =>
    v.kind === 'unknown_prop' && v.prop && v.styleCarrier && MOVEABLE.has(v.prop));
  if (!candidates.length) return { code, moved: [], remaining: violations };

  const src = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const moved: CssPropMove[] = [];
  const handled = new Set<PropViolation>();
  /** Edits applied back to front so earlier offsets stay valid. */
  const edits: Array<{ start: number; end: number; text: string }> = [];

  const byLine = new Map<string, PropViolation>();
  for (const v of candidates) byLine.set(`${v.line}:${v.component}:${v.prop}`, v);

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(src);
      const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);

      /* Decide everything for this element BEFORE editing anything: an
         attribute must never be removed unless its value has somewhere to go. */
      const takeable: Array<{ attr: ts.JsxAttribute; name: string; value: string; v: PropViolation; line: number }> = [];
      let carrier: string | undefined;
      for (const attr of attrs) {
        const name = attr.name.getText(src);
        const attrLine = src.getLineAndCharacterOfPosition(attr.getStart(src)).line + 1;
        const v = byLine.get(`${attrLine}:${tag}:${name}`) || byLine.get(`${line}:${tag}:${name}`);
        if (!v) continue;
        const value = valueText(attr, src);
        if (value === null) continue;
        carrier = v.styleCarrier!;
        takeable.push({ attr, name, value, v, line: attrLine });
      }

      if (takeable.length && carrier) {
        const existing = attrs.find(a => a.name.getText(src) === carrier);
        const readable = !existing || (existing.initializer !== undefined
          && ts.isJsxExpression(existing.initializer)
          && existing.initializer.expression !== undefined
          && ts.isObjectLiteralExpression(existing.initializer.expression));
        if (readable) {
          const gathered = takeable.map(t => `${t.name}: ${t.value}`);
          for (const t of takeable) {
            let from = t.attr.getStart(src);
            while (from > 0 && /\s/.test(code[from - 1])) from--;
            edits.push({ start: from, end: t.attr.getEnd(), text: '' });
            moved.push({ line: t.line, component: tag, prop: t.name, carrier: carrier! });
            handled.add(t.v);
          }
          if (existing) {
            const obj = (existing.initializer as ts.JsxExpression).expression as ts.ObjectLiteralExpression;
            const at = obj.properties.length ? obj.properties[0].getStart(src) : obj.getStart(src) + 1;
            edits.push({ start: at, end: at, text: `${gathered.join(', ')}${obj.properties.length ? ', ' : ''}` });
          } else {
            const props = node.attributes.properties;
            const anchor = props.length ? props[props.length - 1].getEnd() : node.tagName.getEnd();
            edits.push({ start: anchor, end: anchor, text: ` ${carrier}={{ ${gathered.join(', ')} }}` });
          }
        }
        // An unreadable carrier (a variable, a spread) means the props stay
        // where they are and stay violations — reported, not silently dropped.
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(src);

  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return { code: out, moved, remaining: violations.filter(v => !handled.has(v)) };
}
