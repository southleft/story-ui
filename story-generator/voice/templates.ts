/**
 * What "add a checkbox" inserts — read from the design system's own stories.
 *
 * Jev cannot write JSX, and nothing should invent it: the team's stories
 * already say what a Checkbox looks like in use (`<Checkbox id="terms" />`
 * beside `<Label htmlFor="terms">Accept terms and conditions</Label>`). Every
 * render function and args object in a component's story file becomes a
 * candidate template; Jev picks the one closest to the request and fills its
 * text from the words the person said.
 *
 * A template keeps only what is portable into the canvas: elements the canvas
 * scope has (catalog components and intrinsic HTML), literal attributes, and
 * text. Handlers, `{...args}` spreads, icons from other packages and computed
 * children are dropped rather than guessed at.
 */

import fs from 'fs';
import ts from 'typescript';
import { findStoryFor } from '../knowledge/sourceFacts.js';

export type Literal = string | number | boolean;

export interface TemplateNode {
  tag: string;
  attrs: Array<[string, Literal]>;
  children: Array<TemplateNode | string>;
}

export interface Template {
  /** Story export name, or `example N` / `bare`. */
  name: string;
  root: TemplateNode;
}

export interface TemplateSlot {
  /** `CardTitle.text`, `Input.placeholder` — the role the words play. */
  role: string;
  tag: string;
  /** `text` or an attribute name. */
  field: string;
  example: string;
}

// ── Reading templates ─────────────────────────────────────────

const INTRINSIC = /^[a-z][a-z0-9-]*$/;

function isKnownTag(tag: string, known: Set<string>): boolean {
  if (INTRINSIC.test(tag)) return true;
  return known.has(tag.split('.')[0]);
}

function literalAttr(init: ts.JsxAttributeValue | undefined): Literal | undefined {
  if (!init) return true;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  }
  return undefined;
}

function literalValue(e: ts.Expression): Literal | undefined {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function literalObject(e: ts.Expression | undefined): Record<string, Literal> {
  const out: Record<string, Literal> = {};
  if (!e || !ts.isObjectLiteralExpression(e)) return out;
  for (const p of e.properties) {
    if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
    const v = literalValue(p.initializer);
    if (v !== undefined) out[p.name.text] = v;
  }
  return out;
}

function unwrapExpr(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

type JsxLike = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;
const isJsxLike = (n: ts.Node): n is JsxLike =>
  ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);

function returnedJsx(fn: ts.Expression): JsxLike | null {
  fn = unwrapExpr(fn);
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  const body = fn.body;
  if (!ts.isBlock(body)) {
    const e = unwrapExpr(body);
    return isJsxLike(e) ? e : null;
  }
  let found: JsxLike | null = null;
  for (const s of body.statements) {
    if (ts.isReturnStatement(s) && s.expression) {
      const e = unwrapExpr(s.expression);
      if (isJsxLike(e)) found = e;
    }
  }
  return found;
}

function toTemplate(
  el: JsxLike,
  sf: ts.SourceFile,
  known: Set<string>,
  args: Record<string, Literal>,
): TemplateNode | null {
  if (ts.isJsxFragment(el)) {
    const children = childrenOf(el.children, sf, known, args);
    return children.length ? { tag: '', attrs: [], children } : null;
  }
  const opening = ts.isJsxElement(el) ? el.openingElement : el;
  const tag = opening.tagName.getText(sf);
  if (!isKnownTag(tag, known)) return null;

  const attrs: Array<[string, Literal]> = [];
  let spreadArgs = false;
  for (const p of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(p)) {
      if (ts.isIdentifier(p.expression) && p.expression.text === 'args') spreadArgs = true;
      continue;
    }
    const name = p.name.getText(sf);
    if (/^on[A-Z]/.test(name) || name === 'key' || name === 'ref') continue;
    const v = literalAttr(p.initializer);
    if (v !== undefined) attrs.push([name, v]);
  }
  let children = ts.isJsxElement(el) ? childrenOf(el.children, sf, known, args) : [];
  if (spreadArgs) {
    for (const [k, v] of Object.entries(args)) {
      if (v === false) continue; // a default restated, not part of the example
      if (k === 'children') {
        if (!children.length && typeof v === 'string') children = [v];
      } else if (!attrs.some(([n]) => n === k)) {
        attrs.push([k, v]);
      }
    }
  }
  return { tag, attrs, children };
}

function childrenOf(
  kids: ts.NodeArray<ts.JsxChild>,
  sf: ts.SourceFile,
  known: Set<string>,
  args: Record<string, Literal>,
): Array<TemplateNode | string> {
  const out: Array<TemplateNode | string> = [];
  for (const k of kids) {
    if (ts.isJsxText(k)) {
      if (!k.containsOnlyTriviaWhiteSpaces) out.push(k.getText(sf).replace(/\s+/g, ' ').trim());
    } else if (ts.isJsxExpression(k) && k.expression) {
      const v = literalValue(k.expression);
      if (typeof v === 'string') out.push(v);
    } else if (isJsxLike(k)) {
      const t = toTemplate(k, sf, known, args);
      if (t) out.push(...(t.tag === '' ? t.children : [t]));
    }
  }
  return out;
}

function contains(node: TemplateNode, component: string): boolean {
  if (node.tag === component) return true;
  return node.children.some(c => typeof c !== 'string' && contains(c, component));
}

/**
 * Templates from one story file's source, for one component.
 *
 * `known` is the set of component names in canvas scope.
 */
export function templatesFromStorySource(
  source: string,
  component: string,
  known: Set<string>,
): Template[] {
  const sf = ts.createSourceFile('story.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let metaComponent: string | null = null;
  let metaArgs: Record<string, Literal> = {};
  const stories: Array<{ name: string; obj: ts.ObjectLiteralExpression }> = [];

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const exported = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const init = unwrapExpr(d.initializer);
      if (!ts.isObjectLiteralExpression(init)) continue;
      if (d.name.text === 'meta') {
        for (const p of init.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
          if (p.name.text === 'component' && ts.isIdentifier(p.initializer)) metaComponent = p.initializer.text;
          if (p.name.text === 'args') metaArgs = literalObject(p.initializer);
        }
      } else if (exported) {
        stories.push({ name: d.name.text, obj: init });
      }
    }
  }
  // `export default { component: X }` form.
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt)) {
      const e = unwrapExpr(stmt.expression);
      if (ts.isObjectLiteralExpression(e)) {
        for (const p of e.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'component' && ts.isIdentifier(p.initializer)) {
            metaComponent = p.initializer.text;
          }
        }
      }
    }
  }

  const out: Template[] = [];
  for (const { name, obj } of stories) {
    let render: ts.Expression | undefined;
    let args: Record<string, Literal> = { ...metaArgs };
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
        if (p.name.text === 'render') render = p.initializer;
        if (p.name.text === 'args') args = { ...args, ...literalObject(p.initializer) };
      } else if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name) && p.name.text === 'render' && p.body) {
        const ret = p.body.statements.find(ts.isReturnStatement);
        if (ret?.expression) {
          const e = unwrapExpr(ret.expression);
          if (isJsxLike(e)) {
            const t = toTemplate(e, sf, known, args);
            if (t && contains(t, component)) out.push({ name, root: t });
          }
        }
      }
    }
    if (render) {
      const jsx = returnedJsx(render);
      const t = jsx ? toTemplate(jsx, sf, known, args) : null;
      if (t && contains(t, component)) out.push({ name, root: t });
    } else if (metaComponent === component && Object.keys(args).length) {
      const { children, ...rest } = args;
      out.push({
        name,
        root: {
          tag: component,
          attrs: Object.entries(rest).filter(([k, v]) => !/^on[A-Z]/.test(k) && v !== false),
          children: typeof children === 'string' ? [children] : [],
        },
      });
    }
  }
  return dedupe(out);
}

/** Templates from JSX example strings (config `examples`). */
export function templatesFromExamples(examples: string[], component: string, known: Set<string>): Template[] {
  const out: Template[] = [];
  examples.forEach((ex, i) => {
    const src = `const X = () => (<>${ex}</>);`;
    const sf = ts.createSourceFile('ex.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let jsx: JsxLike | null = null;
    const visit = (n: ts.Node) => { if (!jsx && ts.isJsxFragment(n)) jsx = n; else ts.forEachChild(n, visit); };
    visit(sf);
    if (!jsx) return;
    const t = toTemplate(jsx, sf, known, {});
    if (!t) return;
    const root = t.children.length === 1 && typeof t.children[0] !== 'string' ? t.children[0] : t;
    if (contains(root, component)) out.push({ name: `example ${i + 1}`, root });
  });
  return dedupe(out);
}

function dedupe(templates: Template[]): Template[] {
  const seen = new Set<string>();
  return templates.filter(t => {
    const key = printTemplate(t.root);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface TemplateSourceComponent {
  name: string;
  filePath?: string;
  examples?: unknown[];
  props?: string[];
}

/**
 * Every template for `component`: its stories first, then declared examples,
 * then — only when nothing documents it — the bare element.
 */
export function templatesFor(entry: TemplateSourceComponent, known: Set<string>, maxTemplates = 8): Template[] {
  const found: Template[] = [];
  const storyFile = entry.filePath && !entry.filePath.includes('node_modules') ? findStoryFor(entry.filePath) : null;
  if (storyFile) {
    try {
      found.push(...templatesFromStorySource(fs.readFileSync(storyFile, 'utf8'), entry.name, known));
    } catch { /* an unreadable story is simply no templates */ }
  }
  const examples = (entry.examples ?? []).filter((e): e is string => typeof e === 'string');
  if (examples.length) found.push(...templatesFromExamples(examples, entry.name, known));
  const all = dedupe(found);
  if (all.length) {
    // The cap drops the most elaborate showcases, never the basic one; what
    // survives keeps FILE order, so templates[0] is the story file's first —
    // canonical — example, the one used when Jev is unsure which fits.
    const kept = new Set([...all].sort((a, b) => size(a.root) - size(b.root)).slice(0, maxTemplates));
    return all.filter(t => kept.has(t));
  }
  const takesChildren = !entry.props || entry.props.includes('children');
  return [{ name: 'bare', root: { tag: entry.name, attrs: [], children: takesChildren ? [entry.name] : [] } }];
}

function size(n: TemplateNode): number {
  return 1 + n.children.reduce<number>((s, c) => s + (typeof c === 'string' ? 0 : size(c)), 0);
}

// ── Slots: the words a request can supply ─────────────────────

/** Attributes that carry identity or styling, never words a person dictates. */
const NOT_CONTENT = /^(className|class|id|htmlFor|for|type|name|role|href|src|style|variant|size|color|key|asChild|autoComplete|inputMode|method|action|target|rel|data-.*|aria-(hidden|controls|describedby|labelledby))$/;

export function slotsOf(root: TemplateNode): TemplateSlot[] {
  const slots: TemplateSlot[] = [];
  const counts = new Map<string, number>();
  const add = (tag: string, field: string, example: string) => {
    const base = `${tag || 'element'}.${field}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    slots.push({ role: n === 1 ? base : `${base}#${n}`, tag, field, example });
  };
  const walk = (node: TemplateNode) => {
    for (const [k, v] of node.attrs) {
      if (typeof v === 'string' && /[a-z]/i.test(v) && !NOT_CONTENT.test(k)) add(node.tag, k, v);
    }
    const text = node.children.filter((c): c is string => typeof c === 'string').join(' ').trim();
    if (text) add(node.tag, 'text', text);
    for (const c of node.children) if (typeof c !== 'string') walk(c);
  };
  walk(root);
  return slots;
}

/** Fill slots by role, returning a new tree. */
export function fillSlots(root: TemplateNode, values: Record<string, string>): TemplateNode {
  const counts = new Map<string, number>();
  const roleFor = (tag: string, field: string) => {
    const base = `${tag || 'element'}.${field}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
  const walk = (node: TemplateNode): TemplateNode => {
    const attrs = node.attrs.map(([k, v]): [string, Literal] => {
      if (typeof v === 'string' && /[a-z]/i.test(v) && !NOT_CONTENT.test(k)) {
        const role = roleFor(node.tag, k);
        return [k, values[role] ?? v];
      }
      return [k, v];
    });
    const texts = node.children.filter(c => typeof c === 'string');
    let children = node.children;
    if (texts.length) {
      const role = roleFor(node.tag, 'text');
      if (values[role] !== undefined) {
        let placed = false;
        children = node.children.flatMap((c): Array<TemplateNode | string> => {
          if (typeof c !== 'string') return [c];
          if (placed) return [];
          placed = true;
          return [values[role]];
        });
      }
    }
    return { tag: node.tag, attrs, children: children.map(c => (typeof c === 'string' ? c : walk(c))) };
  };
  return walk(root);
}

/** Give every `id` in the template a value not already used in `code`, and follow it in `htmlFor`. */
export function uniquifyIds(root: TemplateNode, code: string): TemplateNode {
  const renames = new Map<string, string>();
  const collect = (n: TemplateNode) => {
    for (const [k, v] of n.attrs) {
      if (k === 'id' && typeof v === 'string' && new RegExp(`\\b(id|htmlFor)=["{]{1,2}${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["}]`).test(code)) {
        let i = 2;
        while (code.includes(`"${v}-${i}"`)) i++;
        renames.set(v, `${v}-${i}`);
      }
    }
    n.children.forEach(c => typeof c !== 'string' && collect(c));
  };
  collect(root);
  if (!renames.size) return root;
  const walk = (n: TemplateNode): TemplateNode => ({
    tag: n.tag,
    attrs: n.attrs.map(([k, v]) => [k, (k === 'id' || k === 'htmlFor') && typeof v === 'string' && renames.has(v) ? renames.get(v)! : v]),
    children: n.children.map(c => (typeof c === 'string' ? c : walk(c))),
  });
  return walk(root);
}

// ── Printing ──────────────────────────────────────────────────

/**
 * Marks a template attribute as a JavaScript expression rather than a string
 * — code-owned values only (a recipe's CSS fallback), never anything spoken.
 */
export const EXPR = '\u0001';
export const expr = (source: string): string => `${EXPR}${source}`;

function printAttr([k, v]: [string, Literal]): string {
  if (v === true) return k;
  if (typeof v === 'string' && v.startsWith(EXPR)) return `${k}={${v.slice(1)}}`;
  if (typeof v === 'string') return /["{}<>\n]/.test(v) ? `${k}={${JSON.stringify(v)}}` : `${k}="${v}"`;
  return `${k}={${String(v)}}`;
}

function printText(t: string): string {
  return /[{}<>]/.test(t) ? `{${JSON.stringify(t)}}` : t;
}

export function printTemplate(node: TemplateNode, indent = ''): string {
  const open = node.tag ? `<${node.tag}${node.attrs.map(a => ` ${printAttr(a)}`).join('')}` : '<';
  const close = node.tag ? `</${node.tag}>` : '</>';
  if (!node.children.length) return node.tag ? `${indent}${open} />` : `${indent}<></>`;
  if (node.children.every(c => typeof c === 'string')) {
    return `${indent}${open}>${printText((node.children as string[]).join(' '))}${close}`;
  }
  const inner = node.children
    .map(c => (typeof c === 'string' ? `${indent}  ${printText(c)}` : printTemplate(c, `${indent}  `)))
    .join('\n');
  return `${indent}${open}>\n${inner}\n${indent}${close}`;
}

/** One line a person would recognise: `Checkbox, Label "Accept terms and conditions"`. */
export function summarizeTemplate(root: TemplateNode): string {
  const parts: string[] = [];
  const walk = (n: TemplateNode) => {
    const text = n.children.filter((c): c is string => typeof c === 'string').join(' ').trim();
    const content = n.attrs
      .filter(([k]) => !/^(className|class|id|htmlFor|key|style)$/.test(k))
      .map(([k, v]) => (v === true ? k : typeof v === 'string' ? `${k} "${v}"` : `${k}=${v}`));
    if (n.tag && !INTRINSIC.test(n.tag)) parts.push([n.tag, text ? `"${text}"` : '', ...content].filter(Boolean).join(' '));
    n.children.forEach(c => typeof c !== 'string' && walk(c));
  };
  walk(root);
  return parts.join(', ').slice(0, 240);
}

/**
 * The attributes the team's own stories set on `component`, with the kind of
 * value they give it — what the code itself says the component accepts.
 *
 * The knowledge layer resolves a component's DECLARED props and deliberately
 * subtracts DOM attributes, which is right for a catalog and wrong here:
 * `placeholder` on an Input or `defaultChecked` on a Checkbox is exactly what
 * a person dictates. A story that writes `<Input placeholder="Email" />` is
 * the project stating that it works.
 */
export function attrsUsedInStories(templates: Template[], component: string): Map<string, 'string' | 'boolean'> {
  const out = new Map<string, 'string' | 'boolean'>();
  const walk = (n: TemplateNode) => {
    if (n.tag === component) {
      for (const [k, v] of n.attrs) {
        if (/^(className|class|id|htmlFor|key|style|ref)$/.test(k) || /^on[A-Z]/.test(k)) continue;
        if (typeof v === 'boolean') out.set(k, 'boolean');
        else if (typeof v === 'string' && !out.has(k)) out.set(k, 'string');
      }
    }
    n.children.forEach(c => typeof c !== 'string' && walk(c));
  };
  templates.forEach(t => walk(t.root));
  return out;
}

/** Whether the team's stories ever give `component` text children. */
export function takesTextInStories(templates: Template[], component: string): boolean {
  let found = false;
  const walk = (n: TemplateNode) => {
    if (n.tag === component && n.children.some(c => typeof c === 'string')) found = true;
    n.children.forEach(c => typeof c !== 'string' && walk(c));
  };
  templates.forEach(t => walk(t.root));
  return found;
}
