/**
 * The voice canvas as a tree of elements — read from, and edited in, its code.
 *
 * The canvas state is CODE (`const Canvas = () => …; render(<Canvas />)`),
 * because that is what react-live renders, what the LLM fallback produces and
 * what canvas-save turns into a story. A separate JSON tree would be a second
 * source of truth that the model's output could not be merged back into.
 *
 * So the tree is an index over the code: every JSX element the Canvas returns,
 * in document order, with its literal attributes and its text. Edits are text
 * splices at AST positions — the same technique propEditor uses — so an edit
 * touches exactly the attribute, text or element it names and nothing else.
 */

import ts from 'typescript';

export interface CanvasNode {
  /** `e0`, `e1`, … in document order. Stable for one version of the code. */
  id: string;
  /** Tag as written: `Button`, `Card.Section`, `div`, or `` for a fragment. */
  tag: string;
  /** Literal attribute values; expressions are absent. */
  attrs: Record<string, string | number | boolean>;
  /** Direct text content, whitespace-collapsed. */
  text: string;
  parent: string | null;
  children: string[];
  selfClosing: boolean;
  /** @internal source positions */
  start: number;
  end: number;
  openEnd: number;
  closeStart: number;
  textRange: { start: number; end: number } | null;
  attrRanges: Record<string, { start: number; end: number }>;
  /** Position after the tag name in the opening tag, where a new attr goes. */
  attrInsert: number;
}

export interface CanvasTree {
  code: string;
  nodes: CanvasNode[];
  /** The element the Canvas returns. */
  root: CanvasNode | null;
}

export const EMPTY_CANVAS_CODE = `const Canvas = () => {
  return (
    <>
    </>
  );
};

render(<Canvas />);
`;

type JsxLike = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

function isJsxLike(n: ts.Node): n is JsxLike {
  return ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);
}

/** The JSX expression the `Canvas` component returns, if it can be found. */
function findReturnedJsx(sf: ts.SourceFile): JsxLike | null {
  let body: ts.ConciseBody | undefined;
  const visit = (n: ts.Node) => {
    if (body) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'Canvas' && n.initializer) {
      const init = n.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) body = init.body;
    } else if (ts.isFunctionDeclaration(n) && n.name?.text === 'Canvas' && n.body) {
      body = n.body;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!body) return null;

  const unwrap = (e: ts.Expression): JsxLike | null => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    return isJsxLike(e) ? e : null;
  };
  if (!ts.isBlock(body)) return unwrap(body);

  // The last top-level return of the component body.
  let found: JsxLike | null = null;
  for (const stmt of body.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) found = unwrap(stmt.expression) ?? found;
  }
  return found;
}

function tagText(n: ts.JsxTagNameExpression, sf: ts.SourceFile): string {
  return n.getText(sf);
}

function literalOf(init: ts.JsxAttributeValue | undefined, sf: ts.SourceFile): string | number | boolean | undefined {
  if (!init) return true;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) {
      return -Number(e.operand.text);
    }
  }
  void sf;
  return undefined;
}

export function parseCanvas(code: string): CanvasTree {
  const sf = ts.createSourceFile('canvas.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rootJsx = findReturnedJsx(sf);
  const nodes: CanvasNode[] = [];
  if (!rootJsx) return { code, nodes, root: null };

  const walk = (el: JsxLike, parent: CanvasNode | null) => {
    const node: CanvasNode = {
      id: `e${nodes.length}`,
      tag: '',
      attrs: {},
      text: '',
      parent: parent?.id ?? null,
      children: [],
      selfClosing: ts.isJsxSelfClosingElement(el),
      start: el.getStart(sf),
      end: el.getEnd(),
      openEnd: 0,
      closeStart: 0,
      textRange: null,
      attrRanges: {},
      attrInsert: 0,
    };
    nodes.push(node);
    parent?.children.push(node.id);

    let attributes: ts.JsxAttributes | null = null;
    let kids: ts.NodeArray<ts.JsxChild> | null = null;
    if (ts.isJsxElement(el)) {
      node.tag = tagText(el.openingElement.tagName, sf);
      attributes = el.openingElement.attributes;
      node.openEnd = el.openingElement.getEnd();
      node.closeStart = el.closingElement.getStart(sf);
      node.attrInsert = el.openingElement.tagName.getEnd();
      kids = el.children;
    } else if (ts.isJsxSelfClosingElement(el)) {
      node.tag = tagText(el.tagName, sf);
      attributes = el.attributes;
      node.openEnd = node.end;
      node.closeStart = node.end;
      node.attrInsert = el.tagName.getEnd();
    } else {
      node.openEnd = el.openingFragment.getEnd();
      node.closeStart = el.closingFragment.getStart(sf);
      node.attrInsert = node.openEnd - 1;
      kids = el.children;
    }

    for (const prop of attributes?.properties ?? []) {
      if (!ts.isJsxAttribute(prop)) continue;
      const name = prop.name.getText(sf);
      node.attrRanges[name] = { start: prop.getStart(sf), end: prop.getEnd() };
      const value = literalOf(prop.initializer, sf);
      if (value !== undefined) node.attrs[name] = value;
    }

    const texts: ts.JsxText[] = [];
    for (const kid of kids ?? []) {
      if (ts.isJsxText(kid)) {
        if (!kid.containsOnlyTriviaWhiteSpaces) texts.push(kid);
      } else if (isJsxLike(kid)) {
        walk(kid, node);
      } else if (ts.isJsxExpression(kid) && kid.expression && ts.isStringLiteral(kid.expression)) {
        node.text += (node.text ? ' ' : '') + kid.expression.text;
      }
    }
    if (texts.length) {
      node.text = [node.text, ...texts.map(t => t.getText(sf))].join(' ').replace(/\s+/g, ' ').trim();
      if (texts.length === 1) {
        const raw = texts[0].getText(sf);
        const lead = raw.length - raw.trimStart().length;
        const trail = raw.length - raw.trimEnd().length;
        node.textRange = { start: texts[0].getStart(sf) + lead, end: texts[0].getEnd() - trail };
      }
    }
  };
  walk(rootJsx, null);

  return { code, nodes, root: nodes[0] ?? null };
}

// ── Descriptions (what Jev reads) ────────────────────────────

/** How a person would name this element: `Button "Send"`, `Input (placeholder "Email")`. */
export function describeNode(tree: CanvasTree, node: CanvasNode): string {
  if (!node.tag) return 'the whole design';
  const bits: string[] = [node.tag];
  if (node.text) bits.push(`"${truncate(node.text, 60)}"`);
  const shown = Object.entries(node.attrs)
    .filter(([k]) => !/^(className|id|key|style|htmlFor)$/.test(k))
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${truncate(v, 40)}"` : String(v)}`);
  if (shown.length) bits.push(`(${shown.join(', ')})`);
  const parent = node.parent ? tree.nodes.find(n => n.id === node.parent) : null;
  if (parent?.tag) bits.push(`inside ${parent.tag}${parent.text ? ` "${truncate(parent.text, 30)}"` : ''}`);
  // A checkbox's words live in its sibling Label; saying so is what lets
  // "change the checkbox text" find the Label.
  const hasOwnWords = Object.entries(node.attrs).some(([k, v]) => typeof v === 'string' && !/^(id|className|type|name)$/.test(k));
  if (!node.text && !hasOwnWords && parent) {
    const labelled = parent.children
      .map(id => tree.nodes.find(n => n.id === id)!)
      .find(s => s.id !== node.id && s.text && !s.children.length);
    if (labelled) bits.push(`next to ${labelled.tag} "${truncate(labelled.text, 30)}"`);
  }
  return bits.join(' ');
}

/** A compact outline of the canvas for Jev's state — only what questions refer to. */
export function outlineCanvas(tree: CanvasTree): Array<{ id: string; element: string }> {
  return tree.nodes.filter(n => n.tag).map(n => ({ id: n.id, element: describeNode(tree, n) }));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ── Edits ─────────────────────────────────────────────────────

interface Splice { start: number; end: number; text: string }

function apply(code: string, s: Splice): string {
  return code.slice(0, s.start) + s.text + code.slice(s.end);
}

function findNode(tree: CanvasTree, id: string): CanvasNode {
  const node = tree.nodes.find(n => n.id === id);
  if (!node) throw new Error(`No element ${id} on the canvas`);
  return node;
}

export function attrSource(name: string, value: string | number | boolean): string {
  if (value === true) return name;
  if (typeof value === 'string') {
    return /["{}<>\n]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;
  }
  return `${name}={${String(value)}}`;
}

/** Set (or with `null`, remove) one attribute of one element. */
export function setAttr(tree: CanvasTree, id: string, name: string, value: string | number | boolean | null): string {
  const node = findNode(tree, id);
  if (!node.tag) throw new Error('A fragment has no attributes');
  const existing = node.attrRanges[name];
  if (existing) {
    if (value === null) {
      // Take the whitespace before the attribute with it.
      let start = existing.start;
      while (start > 0 && /\s/.test(tree.code[start - 1])) start--;
      return apply(tree.code, { start, end: existing.end, text: '' });
    }
    return apply(tree.code, { start: existing.start, end: existing.end, text: attrSource(name, value) });
  }
  if (value === null) return tree.code;
  return apply(tree.code, { start: node.attrInsert, end: node.attrInsert, text: ` ${attrSource(name, value)}` });
}

function escapeJsxText(text: string): string {
  return /[{}<>]/.test(text) ? `{${JSON.stringify(text)}}` : text;
}

/** Replace an element's text. Only for an element whose content IS text. */
export function setText(tree: CanvasTree, id: string, text: string): string {
  const node = findNode(tree, id);
  if (!node.tag) throw new Error('A fragment has no text');
  if (node.textRange) {
    return apply(tree.code, { start: node.textRange.start, end: node.textRange.end, text: escapeJsxText(text) });
  }
  if (node.children.length) throw new Error(`${node.tag} holds elements, not text`);
  if (node.selfClosing) {
    // `<Button variant="x" />` → `<Button variant="x">text</Button>`
    const open = tree.code.slice(node.start, node.end).replace(/\s*\/>$/, '>');
    return apply(tree.code, { start: node.start, end: node.end, text: `${open}${escapeJsxText(text)}</${node.tag}>` });
  }
  return apply(tree.code, { start: node.openEnd, end: node.closeStart, text: escapeJsxText(text) });
}

function lineIndent(code: string, pos: number): string {
  const lineStart = code.lastIndexOf('\n', pos - 1) + 1;
  return code.slice(lineStart).match(/^[ \t]*/)?.[0] ?? '';
}

function reindent(jsx: string, indent: string): string {
  return jsx.split('\n').map(l => (l.trim() ? indent + l : l)).join('\n');
}

/** Insert JSX as the last child of `parentId` (or of the root). */
export function insertChild(tree: CanvasTree, parentId: string | null, jsx: string): string {
  const parent = parentId ? findNode(tree, parentId) : tree.root;
  if (!parent) throw new Error('The canvas has no root element');
  const base = lineIndent(tree.code, parent.start);
  const inner = `${base}  `;
  const block = reindent(jsx.trim(), inner);

  if (parent.selfClosing) {
    const open = tree.code.slice(parent.start, parent.end).replace(/\s*\/>$/, '>');
    return apply(tree.code, {
      start: parent.start,
      end: parent.end,
      text: `${open}\n${block}\n${base}</${parent.tag}>`,
    });
  }
  // A text-only element takes the new child after its text.
  const before = tree.code.slice(0, parent.closeStart).replace(/[ \t]*$/, '');
  const after = tree.code.slice(parent.closeStart);
  return `${before}${before.endsWith('\n') ? '' : '\n'}${block}\n${base}${after}`;
}

/** Remove one element (and its subtree). */
export function removeNode(tree: CanvasTree, id: string): string {
  const node = findNode(tree, id);
  if (!node.parent) throw new Error('Clear the canvas to remove the whole design');
  let start = node.start;
  while (start > 0 && /[ \t]/.test(tree.code[start - 1])) start--;
  if (tree.code[start - 1] === '\n') start--;
  return apply(tree.code, { start, end: node.end, text: '' });
}

/** Elements a new child can be placed inside. */
export function containers(tree: CanvasTree): CanvasNode[] {
  return tree.nodes.filter(n => !n.text || n.children.length > 0);
}
