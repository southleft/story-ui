/**
 * Does every prop the story passes exist on the component that receives it?
 *
 * Three design reviews, three libraries, one defect. Sail Shelf: `<Switch
 * onChange>` on a type that omits `onChange` — both switches dead, story
 * "Verified". `{...({ selectedValue, onValueChange, isChecked } as any)}` —
 * eight invented props per control, thirteen React "does not recognize the
 * prop" errors, still "Verified". MUI: `primaryTypographyProps`, `inputProps`,
 * `SelectProps`, `alignItems` on a Stack — v5 idioms removed several majors
 * ago, absent from the installed `.d.ts`, uncaught. Every one is a TS2322 the
 * project's own compiler would have reported. Nothing asked it.
 *
 * WHY THE TYPE CHECKER AND NOT THE EXTRACTED PROP LIST. The catalog's props
 * come from a syntactic reader that follows `extends` only through types the
 * package itself declares. A Mantine `TextInput` gets `checked` and `onChange`
 * through `ElementProps<'input'>`; an MUI `Button` gets `onClick` through
 * `ComponentPropsWithRef<'button'>`; a Sail Shelf `Switch` gets `disabled`
 * through `Omit<ButtonHTMLAttributes, 'onChange'>`. The reader records none of
 * those, so its list is a floor, never a ceiling — and rejecting a prop needs
 * the ceiling. Measured, judging against the reader's list flagged 6,097 of
 * 6,541 Mantine elements. The ceiling exists: it is the attributes type
 * TypeScript computes for the element, which is exactly what tsc checks the
 * story against. Asking for it costs ~0.5s to build a program over the story's
 * imports, then a few milliseconds per element. Derived from the library's
 * own types, following the project's own tsconfig, never inferred from a name.
 *
 * WHEN THIS DOES NOT FIRE — and says so. A component whose attributes type is
 * `any` or `unknown` (an import that did not resolve, an untyped JS component),
 * or which carries an index signature (`[key: string]: unknown`, Carbon's
 * `Column`), has no ceiling, and every element of it is skipped with the
 * reason recorded. A story where nothing resolved reports `ran: false`, so a
 * check that could not look never reads as a check that found nothing.
 *
 * Also here, because it is the same pass over the same tree: `(): JSX.Element`
 * fails under React 19 (TS2503, the global `JSX` namespace is gone); the
 * annotation is removed and other bare `JSX.` references are qualified.
 */

import ts from 'typescript';
import path from 'path';

export interface PropViolation {
  kind: 'unknown_prop' | 'hidden_props';
  component: string;
  /** The attribute name, for `unknown_prop`. */
  prop?: string;
  line: number;
  /** The declared prop this one most resembles, when anything does. */
  suggestion?: string;
  /**
   * A style-carrying prop this component DOES declare (`sx`, `css`, `style`).
   *
   * Present so a caller can move a CSS-named prop into it deterministically.
   * MUI removed `alignItems` and `justifyContent` from Stack's own props in
   * v6 — they belong in `sx` — and a twenty-prompt MUI run produced 28 of its
   * 29 first-round validation errors as exactly those two attributes, in half
   * the prompts. Naming the carrier here is what lets that be a move rather
   * than a retry.
   */
  styleCarrier?: string;
  /** A message that names the fix, not just the fault. */
  message: string;
}

export interface ComponentVerdict {
  tag: string;
  verdict: 'closed' | 'open' | 'unknown';
  /** Why, for the log: "index signature", "unresolved import", … */
  reason?: string;
  /** Size of the closed set, when there is one. */
  declared?: number;
}

export interface PropConformanceReport {
  violations: PropViolation[];
  /** JSX elements judged against a closed prop set. */
  judged: number;
  /** One verdict per distinct tag seen in the story. */
  components: ComponentVerdict[];
  /**
   * False when no checker could be built at all — no JSX type declarations
   * reachable from the stories directory. Distinct from "ran and found
   * nothing", which is `ran: true, violations: []`.
   */
  ran: boolean;
  reason?: string;
  ms: number;
}

export interface PropConformanceOptions {
  /**
   * Directory the story will be written to. Relative imports resolve from
   * here, exactly as Vite will resolve them, and the project's tsconfig is
   * found above it.
   */
  storiesDir: string;
  /** Name the story will have; only affects diagnostics. */
  fileName?: string;
}

/** Props every element accepts that no component's type need declare. */
const ALWAYS = new Set(['key', 'ref', 'children']);

/**
 * Intrinsic elements whose attribute sets stand in for "standard HTML
 * attributes" when naming a component's OWN props in a message. `div` is the
 * generic set; the rest only widen the pool a suggestion is drawn from.
 */
const BASE_ELEMENTS = ['div', 'button', 'input', 'a', 'span', 'label', 'select', 'textarea', 'img', 'form', 'svg'];

const isAnyish = (t: ts.Type | undefined): boolean =>
  !t || !!(t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown));

/* ------------------------------------------------------------------ */
/* Compiler options: the project's own, minus anything about emitting  */
/* ------------------------------------------------------------------ */

function compilerOptionsFor(storiesDir: string): ts.CompilerOptions {
  const defaults: ts.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    esModuleInterop: true,
  };
  let options: ts.CompilerOptions = defaults;
  const cfgPath = ts.findConfigFile(storiesDir, ts.sys.fileExists);
  if (cfgPath) {
    const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (cfg.config) {
      const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
      options = { ...parsed.options };
      // A solution-style tsconfig may state nothing about JSX or resolution.
      options.jsx ??= defaults.jsx;
      options.moduleResolution ??= defaults.moduleResolution;
      options.module ??= defaults.module;
      options.target ??= defaults.target;
    }
  }
  // Nothing is emitted, and unused-variable rules are the project's business.
  for (const key of ['rootDir', 'outDir', 'outFile', 'composite', 'declaration', 'declarationDir', 'declarationMap',
    'emitDeclarationOnly', 'incremental', 'tsBuildInfoFile', 'sourceMap', 'inlineSourceMap', 'plugins'] as const) {
    delete (options as Record<string, unknown>)[key];
  }
  return { ...options, noEmit: true, skipLibCheck: true, allowJs: true, noUnusedLocals: false, noUnusedParameters: false };
}

function programOver(code: string, virtualFile: string, options: ts.CompilerOptions): ts.Program {
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile;
  const fileExists = host.fileExists;
  const readFile = host.readFile;
  host.getSourceFile = (name, lang, onError, shouldCreate) =>
    name === virtualFile
      ? ts.createSourceFile(name, code, lang, true, ts.ScriptKind.TSX)
      : getSourceFile.call(host, name, lang, onError, shouldCreate);
  host.fileExists = name => name === virtualFile || fileExists.call(host, name);
  host.readFile = name => (name === virtualFile ? code : readFile.call(host, name));
  return ts.createProgram([virtualFile], options, host);
}

/* ------------------------------------------------------------------ */
/* The attribute set of an element, as tsc sees it                     */
/* ------------------------------------------------------------------ */

interface Resolved {
  verdict: 'closed' | 'open' | 'unknown';
  reason?: string;
  names: Set<string>;
}

/**
 * The attribute set is read from a PROBE element — `<Tag />`, plus the tag's
 * own `component`/`as` when the story gives one — never from the element as
 * the story wrote it. Measured on MUI: with `alignItems="center"` present,
 * overload resolution on an `OverridableComponent` falls through to the
 * generic `component` signature, whose `ComponentPropsWithRef<ElementType>`
 * carries an index signature. The defect made the set look open, and the
 * element carrying it was the one skipped. A probe with only the polymorphic
 * attribute resolves the same type tsc would check a correct element against.
 */
function attributesOf(
  probe: ts.JsxSelfClosingElement, checker: ts.TypeChecker,
): Resolved {
  const tagType = checker.getTypeAtLocation(probe.tagName);
  if (isAnyish(tagType)) {
    return { verdict: 'unknown', reason: 'unresolved import, untyped component, or not visible at module scope', names: new Set() };
  }
  const propsType = checker.getContextualType(probe.attributes);
  if (isAnyish(propsType)) {
    return { verdict: 'unknown', reason: 'props type is any', names: new Set() };
  }
  const parts = propsType!.isUnion() ? propsType!.types : [propsType!];
  const names = new Set<string>();
  for (const part of parts) {
    if (isAnyish(part)) return { verdict: 'unknown', reason: 'props type is any', names: new Set() };
    if (checker.getIndexInfosOfType(part).length) {
      return { verdict: 'open', reason: 'index signature admits any prop', names: new Set() };
    }
    for (const sym of checker.getPropertiesOfType(part)) names.add(sym.name);
  }
  if (names.size === 0) return { verdict: 'unknown', reason: 'no props resolved', names };
  return { verdict: 'closed', names };
}

/** Attribute names of the intrinsic elements in BASE_ELEMENTS: `div` alone, and the union. */
function intrinsicAttributes(checker: ts.TypeChecker, at: ts.SourceFile): { generic: Set<string>; any: Set<string> } | null {
  const symbols = checker.getJsxIntrinsicTagNamesAt(at);
  if (!symbols.length) return null;
  const generic = new Set<string>();
  const any = new Set<string>();
  for (const sym of symbols) {
    if (!BASE_ELEMENTS.includes(sym.name)) continue;
    const t = checker.getTypeOfSymbolAtLocation(sym, at);
    for (const p of checker.getPropertiesOfType(t)) {
      any.add(p.name);
      if (sym.name === 'div') generic.add(p.name);
    }
  }
  return { generic, any };
}

/* ------------------------------------------------------------------ */
/* Nearest declared prop                                               */
/* ------------------------------------------------------------------ */

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/** `onCheckedChange` → ["on", "checked", "change"]. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .map(w => w.toLowerCase())
    .filter(Boolean);
}

/**
 * The declared prop an invented one most resembles.
 *
 * Invented props are almost always another library's name for the same thing
 * — `isChecked` for `checked`, `onValueChange` for `onChange`, `selectedValue`
 * for `value` — so they share WORDS with the right answer far more often than
 * they are a few letters from it. Shared words rank first, edit distance
 * breaks ties, and a component's own props are preferred over the HTML
 * attributes it also accepts.
 */
export function nearestProp(name: string, own: Iterable<string>, rest: Iterable<string> = []): string | undefined {
  const target = words(name);
  const targetSet = new Set(target);
  const lower = name.toLowerCase();
  const score = (candidate: string, byWords: boolean) => {
    const cw = new Set(words(candidate));
    let shared = 0;
    for (const w of targetSet) if (cw.has(w)) shared++;
    const union = new Set([...targetSet, ...cw]).size;
    const jaccard = byWords && union ? shared / union : 0;
    const d = distance(lower, candidate.toLowerCase());
    const close = d <= Math.max(2, Math.floor(name.length / 3));
    return jaccard >= 0.25 || close ? { jaccard, d } : null;
  };
  const best = (pool: Iterable<string>, byWords: boolean) => {
    let top: { name: string; jaccard: number; d: number } | undefined;
    for (const candidate of pool) {
      if (candidate === name) continue;
      const s = score(candidate, byWords);
      if (!s) continue;
      if (!top || s.jaccard > top.jaccard || (s.jaccard === top.jaccard && s.d < top.d)) top = { name: candidate, ...s };
    }
    return top?.name;
  };
  // A standard attribute is only ever suggested as a near-typo (`classname`,
  // `ariaLabel`): sharing a word with one is how `justifyContent` was
  // steered to RDFa's `content`.
  return best(own, true) ?? best(rest, false);
}

/* ------------------------------------------------------------------ */
/* Casts that hide props                                               */
/* ------------------------------------------------------------------ */

/** `x as any`, `<any>x`, `x as unknown as T`, `x as never` — anywhere in the chain. */
function castThatDefeatsTheType(expr: ts.Expression): boolean {
  let node: ts.Expression = expr;
  for (let depth = 0; depth < 8; depth++) {
    if (ts.isParenthesizedExpression(node)) { node = node.expression; continue; }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const k = node.type.kind;
      if (k === ts.SyntaxKind.AnyKeyword || k === ts.SyntaxKind.UnknownKeyword || k === ts.SyntaxKind.NeverKeyword) return true;
      node = node.expression;
      continue;
    }
    return false;
  }
  return false;
}

function innermost(expr: ts.Expression): ts.Expression {
  let node: ts.Expression = expr;
  for (let depth = 0; depth < 8; depth++) {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
      node = node.expression;
      continue;
    }
    break;
  }
  return node;
}

/** Keys an object literal states, when it states them all. */
function literalKeys(obj: ts.ObjectLiteralExpression, source: ts.SourceFile): Array<{ name: string; node: ts.Node }> | null {
  const out: Array<{ name: string; node: ts.Node }> = [];
  for (const p of obj.properties) {
    if (ts.isShorthandPropertyAssignment(p)) out.push({ name: p.name.text, node: p });
    else if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name && !ts.isComputedPropertyName(p.name)) {
      out.push({ name: p.name.getText(source).replace(/^['"]|['"]$/g, ''), node: p });
    } else return null;   // a nested spread or computed key: not fully stated
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Probes: one `<Tag />` per distinct tag (and polymorphic target)     */
/* ------------------------------------------------------------------ */

const PROBE_PREFIX = '__storyUiPropProbe';
const POLYMORPHIC = new Set(['component', 'as']);

/** `<Tag component="a">` and `<Tag component="a">` share a probe; `<Tag>` has its own. */
function probeKeyOf(el: ts.JsxOpeningLikeElement, source: ts.SourceFile): string {
  const tag = el.tagName.getText(source);
  const poly: string[] = [];
  for (const attr of el.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    if (!POLYMORPHIC.has(attr.name.text) || !attr.initializer) continue;
    // Only a value legible at module scope can be copied; a local identifier
    // resolves to nothing there, and the probe reports "unknown" for it.
    poly.push(` ${attr.name.text}=${attr.initializer.getText(source)}`);
  }
  return `<${tag}${poly.join('')} />`;
}

/** Distinct probe keys in source order, from a cheap syntactic parse. */
function collectProbeKeys(code: string, fileName: string): string[] {
  const keys: string[] = [];
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch {
    return keys;
  }
  const seen = new Set<string>();
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && !isIntrinsicTag(node, source)) {
      const key = probeKeyOf(node, source);
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}

/** `<div>` is HTML; a typo there is TypeScript's to report, not ours. */
function isIntrinsicTag(el: ts.JsxOpeningLikeElement, source: ts.SourceFile): boolean {
  return ts.isIdentifier(el.tagName) && /^[a-z]/.test(el.tagName.getText(source));
}

/* ------------------------------------------------------------------ */
/* The check                                                           */
/* ------------------------------------------------------------------ */

export function checkPropConformance(code: string, opts: PropConformanceOptions): PropConformanceReport {
  const started = Date.now();
  const storiesDir = path.resolve(opts.storiesDir);
  const virtualFile = path.join(storiesDir, opts.fileName || '__story_ui_prop_check__.stories.tsx');
  const report: PropConformanceReport = { violations: [], judged: 0, components: [], ran: false, ms: 0 };

  // The story, followed by one probe element per distinct tag. Appended, so
  // every position and line in the story's own region is unchanged.
  const probeKeys = collectProbeKeys(code, virtualFile);
  const augmented = `${code}\n${probeKeys.map((k, i) => `export const ${PROBE_PREFIX}${i} = ${k};`).join('\n')}\n`;

  let program: ts.Program;
  let source: ts.SourceFile | undefined;
  try {
    program = programOver(augmented, virtualFile, compilerOptionsFor(storiesDir));
    source = program.getSourceFile(virtualFile);
  } catch (error) {
    report.reason = `type checker could not start: ${error instanceof Error ? error.message : String(error)}`;
    report.ms = Date.now() - started;
    return report;
  }
  if (!source) {
    report.reason = 'story could not be parsed';
    report.ms = Date.now() - started;
    return report;
  }
  const checker = program.getTypeChecker();
  const intrinsic = intrinsicAttributes(checker, source);
  if (!intrinsic) {
    report.reason = 'no JSX type declarations reachable from the stories directory (is @types/react installed?)';
    report.ms = Date.now() - started;
    return report;
  }
  report.ran = true;

  // Resolve each probe once; every element with the same key reads its result.
  const resolvedByKey = new Map<string, Resolved>();
  for (const st of source.statements) {
    if (!ts.isVariableStatement(st)) continue;
    const decl = st.declarationList.declarations[0];
    if (!decl || !ts.isIdentifier(decl.name) || !decl.name.text.startsWith(PROBE_PREFIX)) continue;
    const index = Number(decl.name.text.slice(PROBE_PREFIX.length));
    const probe = decl.initializer;
    if (!Number.isInteger(index) || !probe || !ts.isJsxSelfClosingElement(probe)) continue;
    resolvedByKey.set(probeKeys[index], attributesOf(probe, checker));
  }

  const verdicts = new Map<string, ComponentVerdict>();
  const lineOf = (node: ts.Node) => source!.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const describe = (tag: string, names: Set<string>, first?: string): string => {
    const own = [...names].filter(n => !intrinsic.generic.has(n) && !ALWAYS.has(n) && !n.startsWith('aria-') && !n.startsWith('data-')).sort();
    let genericHits = 0;
    for (const n of intrinsic.generic) if (names.has(n)) genericHits++;
    const passthrough = genericHits >= intrinsic.generic.size / 2;
    const ordered = first && own.includes(first) ? [first, ...own.filter(n => n !== first)] : own;
    const shown = ordered.slice(0, 16);
    const more = ordered.length > shown.length ? `, … (${ordered.length - shown.length} more)` : '';
    const list = shown.length ? shown.map(n => `\`${n}\``).join(', ') + more : '(none of its own)';
    return `${tag} declares: ${list}${passthrough ? ', plus standard HTML attributes' : ''}`;
  };

  const judgeName = (tag: string, resolved: Resolved, name: string, node: ts.Node, viaCast = false): boolean => {
    if (ALWAYS.has(name) || name.startsWith('data-') || name.startsWith('aria-') || name.includes(':')) return true;
    if (resolved.names.has(name)) return true;
    const own = [...resolved.names].filter(n => !intrinsic.generic.has(n));
    const suggestion = nearestProp(name, own, resolved.names);
    if (!viaCast) {
      const styleCarrier = ['sx', 'css', 'style'].find(c => resolved.names.has(c));
      report.violations.push({
        kind: 'unknown_prop', component: tag, prop: name, line: lineOf(node), suggestion, styleCarrier,
        message: `<${tag} ${name}> is not a prop this component declares`
          + (suggestion ? ` — did you mean \`${suggestion}\`?` : '.')
          + ` ${describe(tag, resolved.names, suggestion)}.`,
      });
    }
    return false;
  };

  const visit = (node: ts.Node) => {
    // The probes sit past the story's end and are not the story's elements.
    if (node.getStart(source) >= code.length) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (!isIntrinsicTag(node, source!)) {
        const resolved = resolvedByKey.get(probeKeyOf(node, source!))
          ?? { verdict: 'unknown' as const, reason: 'no probe resolved', names: new Set<string>() };
        const prior = verdicts.get(tag);
        if (!prior || (prior.verdict === 'closed' && resolved.verdict !== 'closed')) {
          verdicts.set(tag, {
            tag, verdict: resolved.verdict,
            ...(resolved.reason ? { reason: resolved.reason } : {}),
            ...(resolved.verdict === 'closed' ? { declared: resolved.names.size } : {}),
          });
        }
        if (resolved.verdict === 'closed') {
          report.judged++;
          for (const attr of node.attributes.properties) {
            if (ts.isJsxAttribute(attr)) {
              judgeName(tag, resolved, attr.name.getText(source), attr);
              continue;
            }
            // A spread. Cast away, it exists to defeat the type — say so.
            // An inline literal states its keys; judge them as attributes.
            const expr = attr.expression;
            const inner = innermost(expr);
            const keys = ts.isObjectLiteralExpression(inner) ? literalKeys(inner, source!) : null;
            if (castThatDefeatsTheType(expr)) {
              const hidden = keys
                ? keys.filter(k => !judgeName(tag, resolved, k.name, k.node, true)).map(k => k.name)
                : [];
              const own = [...resolved.names].filter(n => !intrinsic.generic.has(n));
              const named = hidden.length
                ? ` Of those, ${hidden.map(h => {
                  const s = nearestProp(h, own, resolved.names);
                  return `\`${h}\`${s ? ` (did you mean \`${s}\`?)` : ''}`;
                }).join(', ')} ${hidden.length === 1 ? 'is not a prop' : 'are not props'} of ${tag}.`
                : '';
              report.violations.push({
                kind: 'hidden_props', component: tag, line: lineOf(attr),
                message: `<${tag} {...(… as ${castKeyword(expr)})}> — props are declared on the component; do not hide them behind a cast. `
                  + `Write each prop as a plain attribute and drop the spread.${named} ${describe(tag, resolved.names)}.`,
              });
            } else if (keys) {
              for (const k of keys) judgeName(tag, resolved, k.name, k.node);
            }
            // Any other spread (`{...props}`) is a type TypeScript widens, not a
            // stated set of names, and is left alone.
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  report.components = [...verdicts.values()];
  report.ms = Date.now() - started;
  return report;
}

function castKeyword(expr: ts.Expression): string {
  let node: ts.Expression = expr;
  for (let depth = 0; depth < 8; depth++) {
    if (ts.isParenthesizedExpression(node)) { node = node.expression; continue; }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const k = node.type.kind;
      if (k === ts.SyntaxKind.AnyKeyword) return 'any';
      if (k === ts.SyntaxKind.UnknownKeyword) return 'unknown';
      if (k === ts.SyntaxKind.NeverKeyword) return 'never';
      node = node.expression;
      continue;
    }
    break;
  }
  return 'any';
}

/** Violations as the self-healing loop consumes them. */
export function formatPropConformanceErrors(report: PropConformanceReport): string[] {
  return report.violations.map(v => `Line ${v.line}: ${v.message}`);
}

/**
 * One line for the log that makes "skipped" and "found nothing" look different.
 */
export function summarisePropConformance(report: PropConformanceReport): string {
  if (!report.ran) return `could not run — ${report.reason ?? 'unknown reason'}; skipped, not passed`;
  const closed = report.components.filter(c => c.verdict === 'closed');
  const skipped = report.components.filter(c => c.verdict !== 'closed');
  const skippedText = skipped.length
    ? `; skipped ${skipped.slice(0, 8).map(c => `${c.tag} (${c.verdict}: ${c.reason})`).join(', ')}${skipped.length > 8 ? `, +${skipped.length - 8} more` : ''}`
    : '';
  if (!closed.length) {
    return `no component resolved to a closed prop set (${report.components.length} seen)${skippedText} — skipped, not passed (${report.ms}ms)`;
  }
  return `${report.judged} element(s) judged against ${closed.length} component(s) with closed prop sets, `
    + `${report.violations.length} violation(s)${skippedText} (${report.ms}ms)`;
}

/* ------------------------------------------------------------------ */
/* `(): JSX.Element` under React 19                                    */
/* ------------------------------------------------------------------ */

export interface JsxNamespaceRewrite {
  code: string;
  /** Return annotations removed. */
  removed: number;
  /** Other bare `JSX.` type references qualified as `React.JSX.`. */
  qualified: number;
}

/**
 * The global `JSX` namespace is gone in @types/react 19; `(): JSX.Element`
 * is TS2503 in every such project. Ten of Sail Shelf's twenty-five stories
 * carried it. A React component needs no return annotation, so the annotation
 * goes; a `JSX.` reference in any other type position is qualified to
 * `React.JSX.` when the story binds `React`, which both 18 and 19 declare.
 */
export function rewriteGlobalJsxNamespace(code: string, fileName = 'story.tsx'): JsxNamespaceRewrite {
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch {
    return { code, removed: 0, qualified: 0 };
  }
  const isBareJsx = (t: ts.TypeNode): boolean =>
    ts.isTypeReferenceNode(t) && ts.isQualifiedName(t.typeName)
    && ts.isIdentifier(t.typeName.left) && t.typeName.left.text === 'JSX';
  /** `JSX.Element`, or `JSX.Element | null | undefined`. */
  const isJsxReturn = (t: ts.TypeNode): boolean =>
    isBareJsx(t) || (ts.isUnionTypeNode(t) && t.types.some(isBareJsx)
      && t.types.every(u => isBareJsx(u) || u.kind === ts.SyntaxKind.NullKeyword || u.kind === ts.SyntaxKind.UndefinedKeyword
        || (ts.isLiteralTypeNode(u) && u.literal.kind === ts.SyntaxKind.NullKeyword)));

  let bindsReact = false;
  for (const st of source.statements) {
    if (ts.isImportDeclaration(st) && st.importClause) {
      if (st.importClause.name?.text === 'React') bindsReact = true;
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamespaceImport(nb) && nb.name.text === 'React') bindsReact = true;
    }
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node))
      && node.type && isJsxReturn(node.type)) {
      // From the `:` after the parameter list to the end of the type.
      const colon = code.lastIndexOf(':', node.type.getStart(source));
      if (colon > node.parameters.end - 1) {
        edits.push({ start: colon, end: node.type.end, text: '' });
        return;   // the annotation is gone; nothing beneath it to qualify
      }
    }
    if (ts.isTypeReferenceNode(node) && isBareJsx(node) && bindsReact) {
      edits.push({ start: node.typeName.getStart(source), end: node.typeName.getStart(source), text: 'React.' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!edits.length) return { code, removed: 0, qualified: 0 };

  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return {
    code: out,
    removed: edits.filter(e => e.text === '').length,
    qualified: edits.filter(e => e.text !== '').length,
  };
}
