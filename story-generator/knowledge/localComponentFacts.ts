/**
 * What a LOCAL component states about itself, read from its own source.
 *
 * A private design system is the case this tool exists to serve, and it was
 * the case the engine knew least about. Measured on Sail Shelf — 46
 * components, every one `export const X = React.forwardRef<…, XProps>(function
 * X({…}, ref) {…})` with `export interface XProps extends Omit<React.HTMLAttributes<…>, …>`
 * and a JSDoc paragraph above the export — 13 components had ZERO props and
 * none had a description. The parser was a regex that required `{` to follow
 * the word `Props`, so every interface with an `extends` clause yielded
 * nothing, and the destructuring reader wanted `}: Type` where forwardRef
 * writes `}, ref)`. The model then bypassed ArticleHeader, StoryGrid,
 * FeaturedHero and SubscribeCTA for the exact prompts they exist for.
 *
 * Everything here is derived from the file, never from a naming convention:
 *
 *   WHICH TYPE   the component's own declaration names its props —
 *                `forwardRef<Ref, Props>`, `(props: Props) =>`, `FC<Props>`,
 *                `function X(props: Props)`. `<Name>Props` is consulted only
 *                when the declaration says nothing.
 *
 *   WHICH MEMBERS  the interface or alias, following `extends`, intersections,
 *                `Omit`/`Pick`/`Partial` and references into OTHER local files
 *                (`type BadgeVariant` imported from `../Badge`). A reference to
 *                React's own attribute types contributes no members but is
 *                RECORDED: `extends HTMLAttributes<HTMLElement>` means every
 *                standard attribute passes through, which is a fact the model
 *                should have without enumerating 200 of them.
 *
 *   EACH MEMBER  name, type text, optional flag, the string literals a union
 *                admits (through local aliases), JSDoc prose, `@default`,
 *                `@deprecated` — the same PropFact the npm reader produces, so
 *                every consumer downstream treats local and installed alike.
 *
 *   THE PROSE    the JSDoc block above the export, via the compiler's own
 *                `getJSDocCommentsAndTags`, first paragraph. That paragraph is
 *                the team explaining what the component is for.
 *
 * No TypeChecker and no module resolution beyond relative specifiers: a
 * relative import is a lookup into a file we can open, which is the boundary
 * the rest of the knowledge layer keeps.
 */

import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { mergeProps, readDoc, shortType, type PropFact } from './propExtractor.js';

export interface LocalComponentFacts {
  name: string;
  /** Absolute path of the file that declares it. */
  file: string;
  /** Exported from its file (directly, or via a trailing `export { X }`). */
  exported: boolean;
  /** Name of the props type the declaration points at, when it names one. */
  propsType?: string;
  props: PropFact[];
  /** First paragraph of the JSDoc above the export, markdown emphasis stripped. */
  doc?: string;
  /**
   * Standard attributes the props type extends and forwards, as written:
   * `React.HTMLAttributes<HTMLElement>`, `ButtonHTMLAttributes<HTMLButtonElement>`.
   * Absent when the props type does not extend one.
   */
  passthrough?: string;
}

/* ------------------------------------------------------------------ */
/* Parsing, memoised by content stamp                                  */
/* ------------------------------------------------------------------ */

interface ParsedFile {
  file: string;
  source: ts.SourceFile;
  /** Interface declarations and alias right-hand sides, by name. */
  namedTypes: Map<string, ts.Node>;
  /** `const X = ['a', 'b'] as const`, by name. */
  tuples: Map<string, string[]>;
  /** Local binding → { module specifier, name exported by that module }. */
  imports: Map<string, { spec: string; name: string }>;
  /** `export { A as B } from './x'` → exported name → { spec, original name }. */
  reexports: Map<string, { spec: string; name: string }>;
  /** `export * from './x'` specifiers. */
  starExports: string[];
  /** Names exported by a trailing `export { X }` or `export default X`. */
  exportedNames: Set<string>;
}

const parsedCache = new Map<string, { stamp: string; parsed: ParsedFile | null }>();

function stampOf(file: string): string | null {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

function parseFile(file: string): ParsedFile | null {
  const stamp = stampOf(file);
  if (!stamp) return null;
  const hit = parsedCache.get(file);
  if (hit && hit.stamp === stamp) return hit.parsed;

  let parsed: ParsedFile | null = null;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX
      : /\.ts$/.test(file) ? ts.ScriptKind.TS
      : /\.jsx$/.test(file) ? ts.ScriptKind.JSX
      : ts.ScriptKind.JS;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    parsed = indexFile(file, source);
  } catch {
    parsed = null;
  }
  parsedCache.set(file, { stamp, parsed });
  return parsed;
}

/** String literals inside a const tuple: `['a', 'b'] as const` / `readonly ['a']`. */
function stringLiteralsIn(node: ts.Node | undefined): string[] {
  if (!node) return [];
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) out.push(n.literal.text);
    else if (ts.isStringLiteral(n) && !ts.isImportDeclaration(n.parent)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function indexFile(file: string, source: ts.SourceFile): ParsedFile {
  const parsed: ParsedFile = {
    file, source,
    namedTypes: new Map(), tuples: new Map(), imports: new Map(),
    reexports: new Map(), starExports: [], exportedNames: new Set(),
  };
  for (const stmt of source.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      parsed.namedTypes.set(stmt.name.text, stmt);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      parsed.namedTypes.set(stmt.name.text, stmt.type);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const init = decl.initializer;
        // Only a literal array (possibly `as const`) is a tuple of values; a
        // component's initializer also contains strings and must not count.
        const arrayNode = init && ts.isAsExpression(init) ? init.expression : init;
        if (arrayNode && ts.isArrayLiteralExpression(arrayNode)) {
          const lits = stringLiteralsIn(arrayNode);
          if (lits.length) parsed.tuples.set(decl.name.text, lits);
        } else if (decl.type && ts.isTypeOperatorNode(decl.type)) {
          const lits = stringLiteralsIn(decl.type);
          if (lits.length) parsed.tuples.set(decl.name.text, lits);
        }
      }
    } else if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) parsed.imports.set(clause.name.text, { spec, name: 'default' });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          parsed.imports.set(el.name.text, { spec, name: (el.propertyName ?? el.name).text });
        }
      }
    } else if (ts.isExportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
      if (spec && !stmt.exportClause) {
        parsed.starExports.push(spec);
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const exported = el.name.text;
          const original = (el.propertyName ?? el.name).text;
          if (spec) parsed.reexports.set(exported, { spec, name: original });
          else parsed.exportedNames.add(original);
        }
      }
    } else if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      parsed.exportedNames.add(stmt.expression.text);
    }
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Relative module resolution — a lookup, not a resolver                */
/* ------------------------------------------------------------------ */

const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mts', '.mjs'];

/** The file a relative specifier names, or null for anything we cannot open. */
export function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (isFile(base) && SOURCE_EXTS.some(e => base.endsWith(e))) return base;
  const stripped = base.replace(/\.(m?js|jsx)$/, '');
  for (const e of SOURCE_EXTS) {
    if (isFile(stripped + e)) return stripped + e;
    if (isFile(base + e)) return base + e;
  }
  for (const e of SOURCE_EXTS) {
    const idx = path.join(base, 'index' + e);
    if (isFile(idx)) return idx;
  }
  return null;
}

const MAX_MODULE_HOPS = 4;

/** A named type (interface node or alias RHS) declared by, or re-exported from, a file. */
function lookupType(parsed: ParsedFile, name: string, hops = 0, seen = new Set<string>()): { node: ts.Node; parsed: ParsedFile } | null {
  const key = `${parsed.file}#${name}`;
  if (seen.has(key) || hops > MAX_MODULE_HOPS) return null;
  seen.add(key);

  const local = parsed.namedTypes.get(name);
  if (local) return { node: local, parsed };

  const imported = parsed.imports.get(name) ?? parsed.reexports.get(name);
  if (imported) {
    const file = resolveRelative(parsed.file, imported.spec);
    const target = file ? parseFile(file) : null;
    if (target) return lookupType(target, imported.name, hops + 1, seen);
    return null;
  }
  for (const spec of parsed.starExports) {
    const file = resolveRelative(parsed.file, spec);
    const target = file ? parseFile(file) : null;
    const hit = target ? lookupType(target, name, hops + 1, seen) : null;
    if (hit) return hit;
  }
  return null;
}

function lookupTuple(parsed: ParsedFile, name: string, hops = 0, seen = new Set<string>()): string[] | null {
  const key = `${parsed.file}#${name}`;
  if (seen.has(key) || hops > MAX_MODULE_HOPS) return null;
  seen.add(key);
  const local = parsed.tuples.get(name);
  if (local) return local;
  const imported = parsed.imports.get(name) ?? parsed.reexports.get(name);
  if (imported) {
    const file = resolveRelative(parsed.file, imported.spec);
    const target = file ? parseFile(file) : null;
    return target ? lookupTuple(target, imported.name, hops + 1, seen) : null;
  }
  for (const spec of parsed.starExports) {
    const file = resolveRelative(parsed.file, spec);
    const target = file ? parseFile(file) : null;
    const hit = target ? lookupTuple(target, name, hops + 1, seen) : null;
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Type shapes React owns                                              */
/* ------------------------------------------------------------------ */

/**
 * React's intrinsic-attribute types. Extending one means every standard
 * attribute of that element passes through — recorded as a fact, never
 * enumerated as members.
 */
const REACT_ATTRIBUTE_TYPE = /^(React\.)?([A-Z][A-Za-z]*HTMLAttributes|HTMLAttributes|AllHTMLAttributes|SVGAttributes|SVGProps|DOMAttributes|AriaAttributes|ComponentProps(WithRef|WithoutRef)?|HTMLProps|DetailedHTMLProps)$/;

/** Wrappers that carry a props type as their argument. */
const REACT_PROPS_WRAPPER = /^(React\.)?(PropsWithoutRef|PropsWithRef|PropsWithChildren|FC|FunctionComponent|VFC|VoidFunctionComponent|ForwardRefExoticComponent|MemoExoticComponent|ComponentType|NamedExoticComponent|ForwardRefRenderFunction)$/;

/** Intersection parts that describe React plumbing, not props. */
const REACT_PLUMBING = /^(React\.)?(RefAttributes|ClassAttributes|Attributes)$/;

const typeName = (n: ts.TypeReferenceNode, source: ts.SourceFile) => n.typeName.getText(source);

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

interface Resolution {
  passthrough?: string;
}

const MAX_TYPE_DEPTH = 8;

/** The string literals a type admits, following local aliases and imports. */
function literalOptions(
  node: ts.Node | undefined, parsed: ParsedFile, depth = 0, seen = new Set<string>(),
): { values: string[]; open: boolean } {
  const acc = { values: [] as string[], open: false };
  if (!node || depth > MAX_TYPE_DEPTH) return acc;
  const source = parsed.source;
  const merge = (sub: { values: string[]; open: boolean }) => { acc.values.push(...sub.values); acc.open ||= sub.open; };

  if (ts.isUnionTypeNode(node)) {
    for (const t of node.types) merge(literalOptions(t, parsed, depth + 1, seen));
    return acc;
  }
  if (ts.isParenthesizedTypeNode(node)) return literalOptions(node.type, parsed, depth + 1, seen);
  if (ts.isLiteralTypeNode(node)) {
    if (ts.isStringLiteral(node.literal)) acc.values.push(node.literal.text);
    return acc;
  }
  if (node.kind === ts.SyntaxKind.UndefinedKeyword || node.kind === ts.SyntaxKind.NullKeyword) return acc;
  // `(string & {})` — the widen-proof idiom: arbitrary strings are legal too.
  if (ts.isIntersectionTypeNode(node)) {
    if (node.types.some(t => t.kind === ts.SyntaxKind.StringKeyword)) acc.open = true;
    return acc;
  }
  if (ts.isIndexedAccessTypeNode(node)) {
    const obj = ts.isParenthesizedTypeNode(node.objectType) ? node.objectType.type : node.objectType;
    if (ts.isTypeQueryNode(obj)) {
      const tuple = lookupTuple(parsed, obj.exprName.getText(source));
      if (tuple) acc.values.push(...tuple); else acc.open = true;
      return acc;
    }
    return literalOptions(obj, parsed, depth + 1, seen);
  }
  if (ts.isTypeReferenceNode(node)) {
    const name = typeName(node, source);
    const key = `${parsed.file}#${name}`;
    if (seen.has(key)) return acc;
    const hit = lookupType(parsed, name);
    if (hit) {
      merge(literalOptions(hit.node, hit.parsed, depth + 1, new Set(seen).add(key)));
      return acc;
    }
    const tuple = lookupTuple(parsed, name);
    if (tuple) { acc.values.push(...tuple); return acc; }
    acc.open = true;
    return acc;
  }
  return acc;
}

/** Is this alias's right-hand side a plain union of literals? */
function isLiteralUnion(node: ts.Node): boolean {
  if (ts.isParenthesizedTypeNode(node)) return isLiteralUnion(node.type);
  if (ts.isLiteralTypeNode(node)) return true;
  if (ts.isUnionTypeNode(node)) return node.types.every(t => ts.isLiteralTypeNode(t) || t.kind === ts.SyntaxKind.UndefinedKeyword);
  return false;
}

const MAX_TYPE_TEXT = 80;

/**
 * The type as a reader would want it: a local alias that is nothing but a
 * short union of literals is shown expanded (`1 | 2 | 3 | 4 | 5 | 6`), since
 * the alias name alone (`HeadingLevel`) tells a model nothing it can type.
 */
function displayType(node: ts.TypeNode | undefined, parsed: ParsedFile): string | undefined {
  if (!node) return undefined;
  if (ts.isTypeReferenceNode(node) && !node.typeArguments) {
    const hit = lookupType(parsed, typeName(node, parsed.source));
    if (hit && !ts.isInterfaceDeclaration(hit.node) && isLiteralUnion(hit.node)) {
      const text = hit.node.getText(hit.parsed.source).replace(/\s+/g, ' ').trim();
      if (text.length <= MAX_TYPE_TEXT) return text;
    }
  }
  return shortType(node, parsed.source);
}

function readMembers(members: readonly ts.TypeElement[], parsed: ParsedFile): PropFact[] {
  const found: PropFact[] = [];
  for (const member of members) {
    if (!(ts.isPropertySignature(member) || ts.isMethodSignature(member)) || !member.name) continue;
    const name = member.name.getText(parsed.source).replace(/^['"]|['"]$/g, '');
    if (!/^[a-zA-Z_$][\w$-]*$/.test(name) || name.startsWith('_')) continue;
    if (ts.isMethodSignature(member)) {
      found.push({ name, type: 'function', required: !member.questionToken, ...readDoc(member, parsed.source) });
      continue;
    }
    const opts = literalOptions(member.type, parsed);
    const unique = [...new Set(opts.values)];
    found.push({
      name,
      type: displayType(member.type, parsed),
      required: !member.questionToken,
      ...readDoc(member, parsed.source),
      ...(unique.length > 1 && unique.length <= 24 ? { options: unique, ...(opts.open ? { optionsOpen: true } : {}) } : {}),
    });
  }
  return found;
}

/** Keys named by an `Omit<T, K>` / `Pick<T, K>` argument, when they are literals. */
function keyLiterals(node: ts.TypeNode | undefined, parsed: ParsedFile): Set<string> | null {
  if (!node) return null;
  const { values, open } = literalOptions(node, parsed);
  if (open && values.length === 0) return null;
  return new Set(values);
}

/**
 * Members reachable from a type node, following local references and
 * recording React attribute types as passthrough rather than as members.
 */
function membersOf(
  node: ts.Node, parsed: ParsedFile, res: Resolution, depth = 0, seen = new Set<string>(),
): PropFact[] {
  if (depth > MAX_TYPE_DEPTH) return [];
  const source = parsed.source;

  if (ts.isTypeLiteralNode(node)) return readMembers(node.members, parsed);
  if (ts.isParenthesizedTypeNode(node)) return membersOf(node.type, parsed, res, depth + 1, seen);

  if (ts.isInterfaceDeclaration(node)) {
    const own = readMembers(node.members, parsed);
    const inherited: PropFact[] = [];
    for (const clause of node.heritageClauses ?? []) {
      for (const expr of clause.types) {
        inherited.push(...referenceMembers(expr.expression.getText(source), expr.typeArguments, parsed, res, depth + 1, seen));
      }
    }
    // Own members win: a subtype that narrows a prop states the better answer.
    return inherited.length ? mergeProps(own, inherited) : own;
  }

  if (ts.isIntersectionTypeNode(node)) {
    let out: PropFact[] = [];
    for (const part of node.types) {
      if (ts.isTypeReferenceNode(part) && REACT_PLUMBING.test(typeName(part, source))) continue;
      out = mergeProps(out, membersOf(part, parsed, res, depth + 1, seen));
    }
    return out;
  }
  if (ts.isUnionTypeNode(node)) {
    // A discriminated union: every arm's members are legal on SOME instance,
    // and none is required across the whole type.
    let out: PropFact[] = [];
    for (const part of node.types) out = mergeProps(out, membersOf(part, parsed, res, depth + 1, seen));
    return out.map(p => ({ ...p, required: false }));
  }
  if (ts.isTypeReferenceNode(node)) {
    return referenceMembers(typeName(node, source), node.typeArguments, parsed, res, depth + 1, seen);
  }
  if (ts.isTypeQueryNode(node)) {
    // `typeof someProps` — a value, which this reader does not follow.
    return [];
  }
  return [];
}

function referenceMembers(
  name: string, args: readonly ts.TypeNode[] | undefined, parsed: ParsedFile, res: Resolution, depth: number, seen: Set<string>,
): PropFact[] {
  const source = parsed.source;
  const first = args?.[0];

  if (REACT_ATTRIBUTE_TYPE.test(name)) {
    const text = `${name}${args?.length ? `<${args.map(a => a.getText(source)).join(', ')}>` : ''}`;
    res.passthrough ??= text.replace(/\s+/g, ' ');
    return [];
  }
  if (REACT_PLUMBING.test(name)) return [];

  const bare = name.replace(/^React\./, '');
  if (bare === 'Omit' || bare === 'Pick') {
    if (!first) return [];
    const base = membersOf(first, parsed, res, depth + 1, seen);
    const keys = keyLiterals(args?.[1], parsed);
    if (!keys) return base;
    return bare === 'Omit' ? base.filter(p => !keys.has(p.name)) : base.filter(p => keys.has(p.name));
  }
  if (bare === 'Partial') return first ? membersOf(first, parsed, res, depth + 1, seen).map(p => ({ ...p, required: false })) : [];
  if (bare === 'Required') return first ? membersOf(first, parsed, res, depth + 1, seen).map(p => ({ ...p, required: true })) : [];
  if (bare === 'Readonly' || bare === 'NonNullable') return first ? membersOf(first, parsed, res, depth + 1, seen) : [];
  if (REACT_PROPS_WRAPPER.test(name)) {
    const inner = first ? membersOf(first, parsed, res, depth + 1, seen) : [];
    if (bare === 'PropsWithChildren' && !inner.some(p => p.name === 'children')) {
      inner.push({ name: 'children', type: 'React.ReactNode', required: false });
    }
    return inner;
  }
  // `VariantProps<typeof buttonVariants>` — the cva() map is read by sourceFacts.
  if (bare === 'VariantProps') return [];

  const key = `${parsed.file}#${name}`;
  if (seen.has(key)) return [];
  const hit = lookupType(parsed, name);
  if (!hit) return [];
  const next = new Set(seen).add(key);
  const members = membersOf(hit.node, hit.parsed, res, depth + 1, next);
  // A generic alias applied to a local argument: `Combine<Base, Own>` — the
  // arguments carry members too, the same way the npm reader treats them.
  const fromArgs: PropFact[] = [];
  for (const arg of args ?? []) fromArgs.push(...membersOf(arg, parsed, res, depth + 1, next));
  return fromArgs.length ? mergeProps(members, fromArgs) : members;
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

/** Strip the React wrappers a declared component type puts around its props. */
function unwrapPropsType(node: ts.TypeNode, source: ts.SourceFile): ts.TypeNode {
  if (ts.isParenthesizedTypeNode(node)) return unwrapPropsType(node.type, source);
  if (ts.isTypeReferenceNode(node) && REACT_PROPS_WRAPPER.test(typeName(node, source)) && node.typeArguments?.[0]) {
    return unwrapPropsType(node.typeArguments[0], source);
  }
  if (ts.isIntersectionTypeNode(node)) {
    const kept = node.types.filter(t => !(ts.isTypeReferenceNode(t) && REACT_PLUMBING.test(typeName(t, source))));
    if (kept.length === 1) return unwrapPropsType(kept[0], source);
  }
  return node;
}

/** The props type named by a function's first parameter, if annotated. */
function paramPropsType(fn: ts.SignatureDeclaration): ts.TypeNode | null {
  const p = fn.parameters[0];
  return p?.type ?? null;
}

/**
 * The props type a component initializer names.
 *
 *   React.forwardRef<Ref, Props>(function X({…}, ref) {…})   → Props
 *   forwardRef((props: Props, ref) => …)                     → Props
 *   memo(…)                                                   → recurse
 *   (props: Props) => … / function (props: Props) {…}         → Props
 *   OtherLocalConst                                           → follow, once
 */
function initializerPropsType(expr: ts.Expression | undefined, parsed: ParsedFile, depth = 0): ts.TypeNode | null {
  if (!expr || depth > 3) return null;
  const source = parsed.source;
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    return initializerPropsType(expr.expression, parsed, depth + 1);
  }
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return paramPropsType(expr);
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression.getText(source).replace(/^React\./, '');
    if (callee === 'forwardRef' && expr.typeArguments?.[1]) return expr.typeArguments[1];
    if (callee === 'memo' && expr.typeArguments?.[0]) {
      const arg = expr.typeArguments[0];
      // `memo<typeof Inner>` names a value, not a type.
      if (!ts.isTypeQueryNode(arg)) return unwrapPropsType(arg, source);
    }
    if (/^(forwardRef|memo|styled|observer|withTheme)$/.test(callee) || expr.arguments.length) {
      return initializerPropsType(expr.arguments[0], parsed, depth + 1);
    }
    return null;
  }
  if (ts.isIdentifier(expr)) {
    for (const stmt of source.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === expr.text) {
          if (decl.type) return unwrapPropsType(decl.type, source);
          return initializerPropsType(decl.initializer, parsed, depth + 1);
        }
      }
    }
  }
  return null;
}

/** Does this initializer look like a component at all? */
function looksLikeComponent(expr: ts.Expression | undefined, source: ts.SourceFile): boolean {
  if (!expr) return false;
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return looksLikeComponent(expr.expression, source);
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return true;
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression.getText(source).replace(/^React\./, '');
    return /^(forwardRef|memo|createContext|styled|observer|lazy|withTheme)/.test(callee) || expr.arguments.some(a => looksLikeComponent(a, source));
  }
  return false;
}

/** Markdown emphasis and code fences read as noise in a one-line description. */
function tidyProse(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_DOC = 300;

/**
 * First paragraph of the JSDoc block above a declaration, from the
 * compiler's own attachment rules rather than a comment-range guess.
 */
export function leadingJSDoc(node: ts.Node): string | undefined {
  let docs: ts.JSDoc[] = [];
  try {
    docs = ts.getJSDocCommentsAndTags(node).filter((d): d is ts.JSDoc => ts.isJSDoc(d));
  } catch { /* nodes without JSDoc support */ }
  if (!docs.length && ts.isVariableDeclaration(node)) {
    const stmt = node.parent?.parent;
    if (stmt && ts.isVariableStatement(stmt)) {
      try { docs = ts.getJSDocCommentsAndTags(stmt).filter((d): d is ts.JSDoc => ts.isJSDoc(d)); } catch { /* ignore */ }
    }
  }
  for (const doc of docs) {
    const text = ts.getTextOfJSDocComment(doc.comment) ?? '';
    const paragraph = text.split(/\n\s*\n/)[0] ?? '';
    const tidy = tidyProse(paragraph);
    if (tidy) return tidy.length > MAX_DOC ? `${tidy.slice(0, MAX_DOC - 1)}…` : tidy;
  }
  return undefined;
}

const hasExportModifier = (node: ts.Node): boolean =>
  !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));

const factsCache = new Map<string, { stamp: string; facts: LocalComponentFacts[] }>();

/**
 * Every component a source file declares, with what its own source states.
 *
 * Never throws; a file that cannot be read or parsed yields nothing, and a
 * component whose props type cannot be found yields its name and prose alone.
 */
export function readLocalComponents(file: string): LocalComponentFacts[] {
  const stamp = stampOf(file);
  if (!stamp) return [];
  const hit = factsCache.get(file);
  if (hit && hit.stamp === stamp) return hit.facts;

  const parsed = parseFile(file);
  const facts: LocalComponentFacts[] = [];
  if (!parsed) { factsCache.set(file, { stamp, facts }); return facts; }
  const source = parsed.source;

  const record = (name: string, docNode: ts.Node, propsNode: ts.TypeNode | null, exported: boolean) => {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return;
    // The declaration says nothing about its props: the file's own
    // `<Name>Props` is the one remaining statement worth reading.
    let typeNode: ts.Node | null = propsNode ? unwrapPropsType(propsNode, source) : null;
    let propsType: string | undefined;
    if (typeNode && ts.isTypeReferenceNode(typeNode)) propsType = typeName(typeNode, source);
    if (!typeNode) {
      const conventional = lookupType(parsed, `${name}Props`);
      if (conventional) { typeNode = conventional.node; propsType = `${name}Props`; }
    }
    const res: Resolution = {};
    let props: PropFact[] = [];
    if (typeNode) {
      try { props = membersOf(typeNode, parsed, res); } catch { props = []; }
    }
    facts.push({
      name,
      file,
      exported,
      ...(propsType ? { propsType } : {}),
      props,
      ...(res.passthrough ? { passthrough: res.passthrough } : {}),
      ...((): { doc?: string } => { const d = leadingJSDoc(docNode); return d ? { doc: d } : {}; })(),
    });
  };

  for (const stmt of source.statements) {
    if (ts.isVariableStatement(stmt)) {
      const exported = hasExportModifier(stmt);
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const annotated = decl.type ? unwrapPropsType(decl.type, source) : null;
        const fromInit = initializerPropsType(decl.initializer, parsed);
        const isComponent = looksLikeComponent(decl.initializer, source)
          || (decl.type ? REACT_PROPS_WRAPPER.test(decl.type.getText(source).split('<')[0]) : false);
        if (!isComponent) continue;
        record(name, decl, fromInit ?? (annotated && annotated !== decl.type ? annotated : null), exported || parsed.exportedNames.has(name));
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      record(stmt.name.text, stmt, paramPropsType(stmt), hasExportModifier(stmt) || parsed.exportedNames.has(stmt.name.text));
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      let propsNode: ts.TypeNode | null = null;
      for (const clause of stmt.heritageClauses ?? []) {
        for (const t of clause.types) {
          if (/(^|\.)(Component|PureComponent)$/.test(t.expression.getText(source)) && t.typeArguments?.[0]) propsNode = t.typeArguments[0];
        }
      }
      if (propsNode) record(stmt.name.text, stmt, propsNode, hasExportModifier(stmt) || parsed.exportedNames.has(stmt.name.text));
    }
  }

  factsCache.set(file, { stamp, facts });
  return facts;
}

/** One component's facts, by name; null when the file does not declare it. */
export function readLocalComponent(file: string, name: string): LocalComponentFacts | null {
  return readLocalComponents(file).find(c => c.name === name) ?? null;
}

/* ------------------------------------------------------------------ */
/* A source tree                                                       */
/* ------------------------------------------------------------------ */

/** Directories that hold output, tooling or vendored code — never a component's source. */
const TREE_SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'storybook-static', 'public', '__tests__', '__mocks__', 'test', 'tests', 'e2e', 'cypress']);

/** Source files under a root that could declare a component; bounded. */
export function findLocalSourceFiles(root: string, limit = 3000): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 8) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (TREE_SKIP.has(e.name) || e.name.startsWith('.')) continue;
        walk(full, depth + 1);
      } else if (/\.(tsx|ts|jsx|js|mts|mjs)$/.test(e.name)) {
        if (/\.(stories|story|test|spec|mock|config)\.[cm]?[jt]sx?$/.test(e.name) || /\.d\.[cm]?ts$/.test(e.name)) continue;
        out.push(full);
      }
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Every exported component under a local source root, keyed by name.
 *
 * The shape `propExtractor` returns for an installed package, so a caller
 * cannot tell a local design system from an npm one — which is the point.
 */
export function readLocalSourceTree(root: string): { components: Record<string, { name: string; props: PropFact[]; doc?: string; passthrough?: string; file: string }>; files: string[] } {
  const files = findLocalSourceFiles(root);
  const components: Record<string, { name: string; props: PropFact[]; doc?: string; passthrough?: string; file: string }> = {};
  for (const file of files) {
    for (const c of readLocalComponents(file)) {
      if (!c.exported) continue;
      if (c.props.length === 0 && !c.doc) continue;
      const prior = components[c.name];
      components[c.name] = prior
        ? { ...prior, props: mergeProps(prior.props, c.props), doc: prior.doc ?? c.doc, passthrough: prior.passthrough ?? c.passthrough }
        : { name: c.name, props: c.props, file, ...(c.doc ? { doc: c.doc } : {}), ...(c.passthrough ? { passthrough: c.passthrough } : {}) };
    }
  }
  return { components, files };
}
