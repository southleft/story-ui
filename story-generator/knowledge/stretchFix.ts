/**
 * The one edit that stops an action row spreading, applied without a model.
 *
 * The defect, measured on Carbon across four benches: a story puts two buttons
 * in the design system's own row primitive, and they come out at opposite ends
 * of a 300px void. The chain is short and every link is correct on its own.
 * `.cds--stack-vertical` declares `display: grid` and sets no `justify-items`,
 * so every direct child stretches. The row of buttons IS a direct child, so it
 * is stretched to the full width, and its own auto columns then absorb the
 * free space and push the first and last button apart.
 *
 * Four rounds of prompt guidance did not prevent it: a rule about action rows,
 * the container behaviour derived from the stylesheet, the layout probe's own
 * remedy, and finally a copyable JSX pattern. Across those runs the model added
 * the fix reliably AFTER the probe reported the defect and almost never before,
 * and the same prompt on the same build moved between one and three gate
 * attempts. That is the signature of a change that should not involve a model:
 * there is exactly one correct edit, to one attribute of one element, and the
 * project already treats those as AST work rather than generation.
 *
 * WHAT IT WILL NOT TOUCH. The rule is deliberately narrow, because the same
 * shape with different contents is a layout that SHOULD span the full width —
 * a card header with a title on the left and a badge on the right is a row
 * inside the same stretching container, and hugging it would be a regression.
 * So a row qualifies only when its own direct children are two or more
 * elements of the SAME component. Every measured failure is that: two Buttons.
 * A title beside a Tag is two different components and is left alone.
 */

import ts from 'typescript';
import type { LayoutBehaviour } from './stylingFacts.js';

export interface StretchFixEdit {
  line: number;
  /** The stretching container whose child was hugging nothing. */
  container: string;
  /** The row element that was stretched. */
  row: string;
  /** The component repeated inside it. */
  control: string;
  count: number;
  /** The property written. */
  property: string;
}

export interface StretchFixSkip {
  line: number;
  row: string;
  reason: string;
}

export interface StretchFixResult {
  code: string;
  edits: StretchFixEdit[];
  skipped: StretchFixSkip[];
  /**
   * False when no stretching container is known for this design system, so
   * the pass could not run at all. A design system with hashed class names
   * derives nothing and lands here — which must not read like a pass.
   */
  ran: boolean;
  /** One line for the log, always. */
  source: string;
}

/** Properties that mean the author has already decided this element's width. */
const ALREADY_DECIDED = /^(justifySelf|alignSelf|width|maxWidth|minWidth|inlineSize|maxInlineSize|justifyContent|placeSelf|gridColumn|flex)$/;

interface RowVariant {
  /** Values of a prop that select the inline-flowing form, e.g. horizontal. */
  values: Map<string, string>;
  /** The prop those values belong to. */
  prop?: string;
}

/**
 * Which components stretch their children, and which of their variants are
 * rows — both read from the behaviours derived from the project's stylesheet,
 * never from a name.
 */
function index(behaviours: LayoutBehaviour[]) {
  const stretching = new Map<string, LayoutBehaviour>();
  const rows = new Map<string, RowVariant>();
  for (const b of behaviours) {
    if (b.stretchesChildren) {
      // The default form of the component is the one with no variant class;
      // prefer it, so `<Stack>` with no orientation is recognised.
      if (!stretching.has(b.component) || !b.variant) stretching.set(b.component, b);
      continue;
    }
    const flowsAcross = /column/.test(b.autoFlow || '') || /^row$/.test(b.flexDirection || '');
    if (!flowsAcross || !b.variant) continue;
    const entry: RowVariant = rows.get(b.component) || { values: new Map<string, string>() };
    entry.values.set(b.variant.value, b.variant.prop);
    entry.prop = b.variant.prop;
    rows.set(b.component, entry);
  }
  return { stretching, rows };
}

const tagName = (
  el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, src: ts.SourceFile,
): string => el.tagName.getText(src);

function attributesOf(el: ts.JsxOpeningElement | ts.JsxSelfClosingElement): ts.JsxAttribute[] {
  return el.attributes.properties.filter((a): a is ts.JsxAttribute => ts.isJsxAttribute(a));
}

function attribute(
  el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string, src: ts.SourceFile,
): ts.JsxAttribute | undefined {
  return attributesOf(el).find(a => a.name.getText(src) === name);
}

/** The literal string an attribute is set to, when it is one. */
function literalValue(attr: ts.JsxAttribute | undefined, src: ts.SourceFile): string | null {
  if (!attr || !attr.initializer) return null;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression
      && ts.isStringLiteralLike(attr.initializer.expression)) {
    return attr.initializer.expression.text;
  }
  void src;
  return null;
}

/** JSX element children, ignoring whitespace text and expression containers. */
function elementChildren(node: ts.JsxElement): Array<ts.JsxElement | ts.JsxSelfClosingElement> {
  const out: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
  for (const child of node.children) {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) out.push(child);
  }
  return out;
}

function openingOf(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

/**
 * Does this element already say how wide it should be?
 *
 * Checked in the style object and in the attributes, because a design system
 * may own either. When the style is not an object literal we cannot read it,
 * and an unreadable style counts as decided — guessing past it is how a
 * transform breaks a layout someone wrote on purpose.
 */
function widthIsDecided(
  el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, src: ts.SourceFile,
): string | null {
  for (const attr of attributesOf(el)) {
    const name = attr.name.getText(src);
    if (ALREADY_DECIDED.test(name)) return `the element already sets ${name}`;
    if (name === 'className' || name === 'class') return 'the element carries a class of its own';
    if (name !== 'style') continue;
    const init = attr.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression) return 'its style could not be read';
    if (!ts.isObjectLiteralExpression(init.expression)) return 'its style is not an object literal';
    for (const prop of init.expression.properties) {
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) {
        return 'its style object is spread from elsewhere';
      }
      const key = prop.name?.getText(src).replace(/['"]/g, '') ?? '';
      if (ALREADY_DECIDED.test(key)) return `its style already sets ${key}`;
    }
  }
  return null;
}

/** Is this element a row that flows across, per the derived behaviours? */
function rowVariantOf(
  el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, src: ts.SourceFile, rows: Map<string, RowVariant>,
): boolean {
  const entry = rows.get(tagName(el, src));
  if (!entry) return false;
  for (const [value, prop] of entry.values) {
    if (literalValue(attribute(el, prop, src), src) === value) return true;
  }
  return false;
}

/**
 * Add `justifySelf: 'start'` (or `alignSelf` under a flex parent) to every row
 * of identical controls sitting directly inside a container the stylesheet
 * says stretches its children.
 */
export function fixStretchedControlRows(
  code: string,
  behaviours: LayoutBehaviour[],
  fileName = 'story.tsx',
): StretchFixResult {
  const { stretching, rows } = index(behaviours);
  if (!stretching.size || !rows.size) {
    return {
      code, edits: [], skipped: [], ran: false,
      source: stretching.size
        ? `${stretching.size} stretching container(s) derived but no row variant among them — nothing to place`
        : 'no stretching container derived from this project\'s stylesheet — the pass did not run',
    };
  }

  const src = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: StretchFixEdit[] = [];
  const skipped: StretchFixSkip[] = [];
  /** Insertions, applied back to front so earlier offsets stay valid. */
  const splices: Array<{ at: number; text: string }> = [];

  const lineOf = (node: ts.Node) => src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const open = node.openingElement;
      const name = tagName(open, src);
      const container = stretching.get(name);
      // The row form of the same component is not the stretching form.
      if (container && !rowVariantOf(open, src, rows)) {
        for (const child of elementChildren(node)) {
          const childOpen = openingOf(child);
          if (!rowVariantOf(childOpen, src, rows)) continue;
          const inner = ts.isJsxElement(child) ? elementChildren(child) : [];
          const controlNames = new Set(inner.map(c => tagName(openingOf(c), src)));
          if (inner.length < 2 || controlNames.size !== 1) {
            // Not an action row: one control, or a mix of components, which is
            // usually a header that is meant to span the full width.
            continue;
          }
          const decided = widthIsDecided(childOpen, src);
          if (decided) {
            skipped.push({ line: lineOf(childOpen), row: tagName(childOpen, src), reason: decided });
            continue;
          }
          const property = /grid$/.test(container.display) ? 'justifySelf' : 'alignSelf';
          const styleAttr = attribute(childOpen, 'style', src);
          if (styleAttr && styleAttr.initializer && ts.isJsxExpression(styleAttr.initializer)
              && styleAttr.initializer.expression
              && ts.isObjectLiteralExpression(styleAttr.initializer.expression)) {
            const obj = styleAttr.initializer.expression;
            const at = obj.properties.length ? obj.properties[0].getStart(src) : obj.getStart(src) + 1;
            splices.push({ at, text: `${property}: 'start'${obj.properties.length ? ', ' : ''}` });
          } else {
            const props = childOpen.attributes.properties;
            const anchor = props.length ? props[props.length - 1].getEnd() : childOpen.tagName.getEnd();
            splices.push({ at: anchor, text: ` style={{ ${property}: 'start' }}` });
          }
          edits.push({
            line: lineOf(childOpen),
            container: name,
            row: tagName(childOpen, src),
            control: [...controlNames][0],
            count: inner.length,
            property,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);

  let out = code;
  for (const s of splices.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, s.at) + s.text + out.slice(s.at);
  }

  const source = edits.length
    ? `${edits.length} control row(s) held to their content inside ${[...new Set(edits.map(e => e.container))].join(', ')}`
    : `no control row needed it (${stretching.size} stretching container(s), ${skipped.length} row(s) already decided)`;
  return { code: out, edits, skipped, ran: true, source };
}
