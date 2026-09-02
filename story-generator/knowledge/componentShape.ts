/**
 * Is this export a component? Answered from what it IS, never from what it is
 * called.
 *
 * Two questions, one answer each:
 *
 *   looksLikeComponentValue   a RUNTIME value is in hand (the package imported)
 *   declaredComponentExports  only DECLARATIONS are in hand (.d.ts or source)
 *
 * WHY. Before this module, discovery judged exports by the shape of their
 * name: `/Value$/`, `/Config$/`, `/^get[A-Z]/`, `Styled*`, `*Context`,
 * `*Options`, `*State`, ALL_CAPS. Every one of those is a guess about a
 * convention, and every convention is violated by some design system. A real
 * `EmptyState`, `ThemeConfig`, `SelectOptions` or `StyledLink` component was
 * invisible, and a `.d.ts` that re-exported two thousand prop TYPES through
 * plain `export { ButtonProps }` was invisible in the other direction.
 *
 * The runtime value states what it is: React tags its wrappers with
 * `$$typeof`, a context object carries `Symbol(react.context)`, a Vue
 * component has `setup`/`render`, a custom element extends `HTMLElement`, an
 * Angular component carries `ɵcmp`. A declaration states what it is: `FC<`,
 * `ForwardRefExoticComponent<`, `DefineComponent<`, `=> JSX.Element`,
 * `extends LitElement`, `ɵɵComponentDeclaration`; and a `type`, `interface`,
 * `enum` or primitive `const` is provably not renderable.
 *
 * Name-based tests survive in exactly ONE place and are documented there: a
 * PascalCase FUNCTION whose body we will not call. Its name being PascalCase is
 * a fact of the JSX grammar (a lowercase tag is an intrinsic element), and the
 * function's body is opaque; there is nothing else to read.
 */

import fs from 'fs';
import path from 'path';
import { packageDirFor, packageNameOf } from './packageLocator.js';
import { logger } from '../logger.js';

export type ComponentVerdict = 'component' | 'not-component' | 'unknown';

/* ------------------------------------------------------------------------- */
/*  Runtime values                                                            */
/* ------------------------------------------------------------------------- */

/** `Symbol(react.forward_ref)` → `react.forward_ref`; anything else undefined. */
function reactTag(value: any): string | undefined {
  let tag: unknown;
  try { tag = value.$$typeof; } catch { return undefined; }
  if (typeof tag === 'symbol') return tag.description;
  // React < 16.0 tagged elements with the number 0xeac7. Nothing else.
  if (typeof tag === 'number') return tag === 0xeac7 ? 'react.element' : 'react.unknown';
  return undefined;
}

/**
 * Can this runtime value be written as a component?
 *
 * Every branch is a fact about the value, in this order:
 *
 *   1. grammar gate — a JSX tag or SFC template tag starting lowercase is an
 *      intrinsic element, so a lowercase export can never be a component
 *      however it is defined. This is the grammar, not a naming preference.
 *   2. primitives — a string, number, boolean, symbol or bigint mounts nothing.
 *   3. React's own tag — `$$typeof` names forwardRef/memo/lazy wrappers (element
 *      types) and names contexts, elements and portals (not element types).
 *      A context is excluded by its SYMBOL, not by ending in "Context".
 *   4. functions — class heritage and statics: `isReactComponent`, a `render`
 *      prototype method, Svelte's `$set/$destroy`, an `HTMLElement` ancestor,
 *      Angular's `ɵcmp`. A class with none of those mounts nothing. A PLAIN
 *      function is the one case with no more evidence available without
 *      calling it; it is admitted because it passed the grammar gate.
 *   5. objects — a Vue component carries `setup`/`render`/`template`; a
 *      namespace (Base UI's `Menu`) holds at least one member that is itself a
 *      component; any other plain object mounts nothing.
 */
export function looksLikeComponentValue(value: unknown, name: string, depth = 0): boolean {
  if (!/^[A-Z]/.test(name)) return false;                       // 1
  if (value === null || value === undefined) return false;      // 2
  const t = typeof value;
  if (t !== 'function' && t !== 'object') return false;         // 2
  const v = value as any;

  const tag = reactTag(v);                                       // 3
  if (tag !== undefined) {
    if (/^react\.(forward_ref|memo|lazy|provider|consumer)$/.test(tag)) return true;
    if (t === 'object') return false; // context, element, portal, or a tag we do not know: not an element type
  }

  if (t === 'function') return functionIsComponent(v);           // 4
  return objectIsComponent(v, depth);                            // 5
}

function functionIsComponent(fn: any): boolean {
  let proto: any;
  try { proto = fn.prototype; } catch { proto = undefined; }

  if (proto && typeof proto === 'object') {
    if (proto.isReactComponent) return true;                     // React.Component / PureComponent heritage
    if (typeof proto.render === 'function') return true;         // class with a render method
    if (typeof proto.$set === 'function' && typeof proto.$destroy === 'function') return true; // Svelte 4 class API
    for (let p = Object.getPrototypeOf(proto); p; p = Object.getPrototypeOf(p)) {
      const ctor = p.constructor;
      if (!ctor) continue;
      if (ctor === (globalThis as any).HTMLElement) return true; // custom element
      if (ctor.name === 'HTMLElement') return true;              // custom element under a DOM shim
    }
  }
  try { if (fn.ɵcmp) return true; } catch { /* throwing getter */ } // Angular compiled component

  let source = '';
  try { source = Function.prototype.toString.call(fn); } catch { /* exotic */ }
  // A class with no render, no React/Svelte heritage, no element ancestor and
  // no Angular definition: nothing can mount it.
  if (/^class[\s{]/.test(source)) return false;
  // The same class compiled to ES5: a function whose prototype carries its
  // own instance methods (`AnalyticsEvent.prototype.clone = …`). A function
  // component's prototype holds nothing but `constructor`.
  try {
    if (proto && Object.getOwnPropertyNames(proto).some(k => k !== 'constructor')) return false;
  } catch { /* exotic prototype */ }

  // A plain function that passed the grammar gate. Its body is opaque and we
  // will not call it; there is no further fact to read. This is the single
  // name-dependent admission in the predicate.
  return true;
}

function objectIsComponent(obj: any, depth: number): boolean {
  if (Array.isArray(obj)) return false;
  try {
    if (typeof obj.setup === 'function' || typeof obj.render === 'function' || typeof obj.template === 'string') return true; // Vue options / compiled SFC
    if (obj.__vccOpts) return true;                              // Vue class-style SFC
  } catch { return false; }
  if (depth >= 2) return false;

  // A namespace: at least one PascalCase member that is itself a component.
  let keys: string[];
  try { keys = Object.keys(obj); } catch { return false; }
  for (const k of keys) {
    if (!/^[A-Z]/.test(k)) continue;
    let member: unknown;
    try { member = obj[k]; } catch { continue; }
    if (looksLikeComponentValue(member, k, depth + 1)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------- */
/*  Declarations                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Type text that states "this is a component".
 *
 * Framework-provided component types by name, any library's own
 * `XxxComponent<…>` alias (the declaration is naming its kind), a call
 * signature returning an element, Vue's expanded instance shape, Svelte's
 * component classes, custom-element constructors, Angular's declaration.
 */
const COMPONENT_TYPE = new RegExp([
  '\\b(?:React\\.)?(?:FC|VFC|FunctionComponent|VoidFunctionComponent|ForwardRefExoticComponent|ForwardRefRenderFunction|NamedExoticComponent|ExoticComponent|MemoExoticComponent|LazyExoticComponent|ComponentType|ComponentClass|ElementType|JSXElementConstructor)\\b',
  '\\b[A-Za-z_$][\\w$]*Component(?:Typed|Dev)?\\s*<',
  '(?:=>|\\)\\s*:)\\s*(?:React\\.|import\\([^)]*\\)\\.)?(?:JSX\\.)?(?:Element|ReactElement|ReactNode|ReactPortal|VNode|TemplateResult)\\b',
  '\\bJSX\\.Element\\b',
  '\\bReact(?:\\.)?Element\\b',
  '\\bDefineComponent\\b', '\\bFunctionalComponent\\b', '\\bComponentInternalInstance\\b', '\\$props\\b',
  '\\bSvelteComponent(?:Typed|Dev)?\\b',
  '\\btypeof HTMLElement\\b', '\\bCustomElementConstructor\\b',
  'ɵɵComponentDeclaration',
].join('|'));

/** A return type that is something renderable. */
const RENDERABLE_RETURN = /(?:JSX\.)?(?:Element|ReactElement|ReactNode|ReactPortal|VNode|TemplateResult)\b/;

/** Class heritage that makes a component. The base class itself is not in hand, only its name in the clause. */
const COMPONENT_HERITAGE = /\b(?:Component|PureComponent|HTMLElement|LitElement|ReactiveElement|SvelteComponent(?:Typed|Dev)?)\b|\w+Element\b|\w+Component\b/;

/** Initializers that produce a component (source files, not .d.ts). */
const COMPONENT_INIT = /^(?:React\.)?(?:forwardRef|memo|lazy|createReactClass|defineComponent|defineAsyncComponent|createComponent)\s*[<(]|^styled(?:\.[\w$]+|\s*\()|^\(|^(?:async\s+)?function\b|^[A-Za-z_$][\w$]*\s*=>|^<|^(?:React\.)?createElement\(/;
/** Initializers that provably are not. */
const NON_COMPONENT_INIT = /^(?:React\.)?createContext\s*[<(]|^[{\[]|^['"`]|^-?\d|^(?:true|false|null|undefined)\b|^new\s|^Symbol\b|^Object\.freeze\(\s*[{\[]/;

interface Decl {
  kind: 'const' | 'function' | 'class' | 'type';
  exported: boolean;
  typeText?: string;
  initText?: string;
  retText?: string | null;
  heritage?: string;
  body?: string;
}

interface Parsed {
  decls: Map<string, Decl[]>;
  named: Array<{ exported: string; local: string; from?: string; typeOnly: boolean }>;
  stars: string[];
  starAs: Array<{ name: string; from: string }>;
  defaultExport: { local?: string; text?: string } | null;
  imports: Map<string, { from: string; imported: string; typeOnly: boolean }>;
}

/**
 * The remainder of a statement from `start`: up to the first `;` at bracket
 * depth zero, skipping strings, template literals and comments. Bounded.
 */
function sliceStatement(content: string, start: number, max = 6000): string {
  let depth = 0;
  let i = start;
  const end = Math.min(content.length, start + max);
  while (i < end) {
    const c = content[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < end && content[i] !== q) { if (content[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '/' && content[i + 1] === '*') { const j = content.indexOf('*/', i + 2); i = j < 0 ? end : j + 2; continue; }
    if (c === '/' && content[i + 1] === '/') { const j = content.indexOf('\n', i); i = j < 0 ? end : j; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth < 0) break; }
    else if (c === '<' && content[i - 1] !== '=' && !/[\s=]/.test(content[i + 1] ?? '')) depth++;
    else if (c === '>' && content[i - 1] !== '=' && depth > 0 && /[\w$>\])"'\s]/.test(content[i - 1] ?? '')) depth--;
    else if (c === ';' && depth === 0) break;
    else if (c === '\n' && depth === 0 && /^\s*(?:export|declare|import|type|interface|class|function|const|let|var|enum|namespace|module)\b/.test(content.slice(i + 1, i + 40))) break;
    i++;
  }
  return content.slice(start, i).trim();
}

/** Balanced `{ … }` starting at `open`, or '' when unbalanced. Bounded. */
function balancedBlock(content: string, open: number, max = 40000): string {
  if (content[open] !== '{') return '';
  let depth = 0;
  const end = Math.min(content.length, open + max);
  for (let i = open; i < end; i++) {
    const c = content[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return content.slice(open, i + 1); }
  }
  return content.slice(open, end);
}

/** Split `: TYPE = INIT` / `= INIT` / `: TYPE` at the first top-level `=`. */
function splitConst(rest: string): { typeText?: string; initText?: string } {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
    else if (c === '=' && depth <= 0 && rest[i + 1] !== '>' && rest[i + 1] !== '=' && !/[!<>=]/.test(rest[i - 1] ?? '')) {
      const left = rest.slice(0, i).trim();
      const right = rest.slice(i + 1).trim();
      return { typeText: left.startsWith(':') ? left.slice(1).trim() : undefined, initText: right || undefined };
    }
  }
  const t = rest.trim();
  return t.startsWith(':') ? { typeText: t.slice(1).trim() } : {};
}

function parse(content: string): Parsed {
  const decls = new Map<string, Decl[]>();
  const add = (name: string, d: Decl) => { const list = decls.get(name) ?? []; list.push(d); decls.set(name, list); };

  const declRe = /(^|[\s;}])((?:export\s+)?(?:default\s+)?)(?:declare\s+)?(?:abstract\s+)?(const\s+enum|const|let|var|async\s+function\*?|function\*?|class|type|interface|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(content)) !== null) {
    // `export default class Button` declares Button but exports it as `default`;
    // a consumer cannot write `import { Button }`. Only a plain `export` is named.
    const exported = /export/.test(m[2]) && !/default/.test(m[2]);
    const kindWord = m[3];
    const name = m[4];
    const after = m.index + m[0].length;
    if (/^(const|let|var)$/.test(kindWord)) {
      const { typeText, initText } = splitConst(sliceStatement(content, after));
      add(name, { kind: 'const', exported, typeText, initText });
    } else if (/function/.test(kindWord)) {
      // Skip type parameters, then the parameter list, then read a return annotation.
      let i = after;
      while (i < content.length && /\s/.test(content[i])) i++;
      if (content[i] === '<') { let d = 0; for (; i < content.length; i++) { if (content[i] === '<') d++; else if (content[i] === '>') { d--; if (d === 0) { i++; break; } } } }
      while (i < content.length && /\s/.test(content[i])) i++;
      if (content[i] === '(') { let d = 0; for (; i < content.length; i++) { if (content[i] === '(') d++; else if (content[i] === ')') { d--; if (d === 0) { i++; break; } } } }
      const tail = content.slice(i, i + 400);
      const ret = tail.match(/^\s*:\s*([^{;]+)/);
      add(name, { kind: 'function', exported, retText: ret ? ret[1].trim() : null });
    } else if (kindWord === 'class') {
      const open = content.indexOf('{', after);
      const heritage = open > 0 ? content.slice(after, open) : '';
      const body = open > 0 ? balancedBlock(content, open) : '';
      add(name, { kind: 'class', exported, heritage, body });
    } else {
      // type / interface / enum / namespace / module. Keep an alias's text so
      // `const Button: ButtonComponent` can be followed one hop.
      const rest = sliceStatement(content, after, 4000);
      const open = content.indexOf('{', after);
      const body = /^(interface|namespace|module)$/.test(kindWord) && open > 0 ? balancedBlock(content, open, 8000) : undefined;
      add(name, { kind: 'type', exported, typeText: rest.replace(/^[^=]*=\s*/, ''), body });
    }
  }

  const named: Parsed['named'] = [];
  const stars: string[] = [];
  const starAs: Parsed['starAs'] = [];
  let defaultExport: Parsed['defaultExport'] = null;

  const bracedRe = /export\s*(type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g;
  while ((m = bracedRe.exec(content)) !== null) {
    const allTypes = Boolean(m[1]);
    for (const raw of m[2].split(',')) {
      let entry = raw.trim();
      if (!entry) continue;
      let typeOnly = allTypes;
      if (/^type\s/.test(entry)) { typeOnly = true; entry = entry.replace(/^type\s+/, ''); }
      const parts = entry.split(/\s+as\s+/).map(p => p.trim());
      const local = parts[0];
      const exported = parts[parts.length - 1];
      if (!local || !exported) continue;
      named.push({ exported, local, from: m[3], typeOnly });
    }
  }
  const starRe = /export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/g;
  while ((m = starRe.exec(content)) !== null) {
    if (m[1]) starAs.push({ name: m[1], from: m[2] }); else stars.push(m[2]);
  }
  const defRe = /export\s+default\s+(?!(?:async\s+)?function\b|class\b|interface\b|abstract\b)([A-Za-z_$][\w$]*)?/;
  const def = content.match(defRe);
  if (def) {
    if (def[1] && !/^(function|class|async|new|typeof)$/.test(def[1])) defaultExport = { local: def[1] };
    else defaultExport = { text: sliceStatement(content, def.index! + def[0].length, 400) };
  }
  // `export default function Name` / `export default class Name` register a
  // declaration above; point the default at it.
  const defNamed = content.match(/export\s+default\s+(?:abstract\s+)?(?:(?:async\s+)?function\*?|class)\s+([A-Za-z_$][\w$]*)/);
  if (defNamed) defaultExport = { local: defNamed[1] };
  else if (!defaultExport) {
    const anon = content.match(/export\s+default\s+((?:async\s+)?function\b|class\b|\()/);
    if (anon) defaultExport = { text: anon[1] };
  }

  const imports = new Map<string, { from: string; imported: string; typeOnly: boolean }>();
  const importRe = /import\s+(type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s*as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(content)) !== null) {
    const typeOnly = Boolean(m[1]);
    const from = m[5];
    if (m[2]) imports.set(m[2], { from, imported: 'default', typeOnly });
    if (m[3]) imports.set(m[3], { from, imported: '*', typeOnly });
    if (m[4]) {
      for (const raw of m[4].split(',')) {
        let entry = raw.trim();
        if (!entry) continue;
        let t = typeOnly;
        if (/^type\s/.test(entry)) { t = true; entry = entry.replace(/^type\s+/, ''); }
        const parts = entry.split(/\s+as\s+/).map(p => p.trim());
        imports.set(parts[parts.length - 1], { from, imported: parts[0], typeOnly: t });
      }
    }
  }

  return { decls, named, stars, starAs, defaultExport, imports };
}

const best = (a: ComponentVerdict | undefined, b: ComponentVerdict): ComponentVerdict => {
  if (a === 'component' || b === 'component') return 'component';
  if (a === 'not-component' || b === 'not-component') return 'not-component';
  return 'unknown';
};

interface Ctx {
  projectRoot: string;
  cache: Map<string, Map<string, ComponentVerdict>>;
  inProgress: Set<string>;
  filesLeft: number;
  followBare: boolean;
}

const DECL_EXTS = ['.d.ts', '.d.mts', '.d.cts', '.ts', '.tsx', '.mts'];

/** Where a specifier's declarations live, or null. `.vue`/`.svelte` files are returned as themselves. */
function resolveSpec(spec: string, fromFile: string, ctx: Ctx): string | null {
  const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const base = path.resolve(path.dirname(fromFile), spec);
    if (/\.(vue|svelte)$/.test(base) && isFile(base)) return base;
    if (/\.(vue|svelte)$/.test(base)) { for (const e of ['.d.ts', '.ts']) if (isFile(base + e)) return base + e; }
    const stripped = base.replace(/\.(m?js|cjs|jsx)$/, '');
    const candidates = [
      ...(stripped !== base ? DECL_EXTS.map(e => stripped + e) : []),
      ...DECL_EXTS.map(e => base + e),
      base,
      ...DECL_EXTS.map(e => path.join(base, 'index' + e)),
      path.join(base, 'index.vue'), path.join(base, 'index.svelte'),
    ];
    for (const c of candidates) if (isFile(c) && /\.(ts|tsx|mts|cts|vue|svelte)$/.test(c)) return c;
    return null;
  }
  if (!ctx.followBare) return null;
  const pkgName = packageNameOf(spec);
  const dir = packageDirFor(ctx.projectRoot, pkgName);
  if (!dir) return null;
  const subpath = spec.length > pkgName.length ? spec.slice(pkgName.length + 1) : '';
  return typesEntryFor(dir, subpath);
}

/**
 * The declarations entry a package names for a subpath (or its root).
 *
 * Walks `exports` because the answer nests behind conditions; falls back to
 * `types`/`typings`, then to the `main`/`module` file's `.d.ts` twin, then to
 * `index.d.ts`. A source-only workspace package pointing `types` at
 * `src/index.ts` is accepted as-is.
 */
export function typesEntryFor(pkgDir: string, subpath = ''): string | null {
  let pkg: any;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')); } catch { pkg = null; }
  const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const candidates: string[] = [];
  const declLike = (s: string) => /\.(d\.[cm]?ts|ts|tsx|mts)$/.test(s);
  const walk = (node: unknown, depth = 0) => {
    if (depth > 5 || node == null) return;
    if (typeof node === 'string') { candidates.push(node); return; }
    if (Array.isArray(node)) return node.forEach(n => walk(n, depth + 1));
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (typeof obj.types === 'string') candidates.push(obj.types);
      for (const [k, v] of Object.entries(obj)) if (k !== 'types') walk(v, depth + 1);
    }
  };
  if (pkg?.exports) {
    const key = subpath ? `./${subpath}` : '.';
    if (typeof pkg.exports === 'string') { if (!subpath) candidates.push(pkg.exports); }
    else walk(pkg.exports[key] ?? (subpath ? undefined : pkg.exports));
  }
  if (!subpath) {
    for (const k of ['types', 'typings', 'main', 'module']) if (typeof pkg?.[k] === 'string') candidates.push(pkg[k]);
    candidates.push('index.d.ts', 'index.ts', 'index.tsx', 'src/index.ts', 'src/index.tsx');
  } else {
    candidates.push(`${subpath}/index.d.ts`, `${subpath}.d.ts`, `${subpath}/index.ts`, `${subpath}/index.tsx`, `${subpath}.ts`, `${subpath}.tsx`);
    // A subpath that is itself a package (`@scope/pkg/sub/package.json`).
    const nested = path.join(pkgDir, subpath);
    if (isFile(path.join(nested, 'package.json'))) { const inner = typesEntryFor(nested, ''); if (inner) return inner; }
  }
  const ordered = [...candidates.filter(declLike), ...candidates.filter(c => !declLike(c))];
  for (const rel of ordered) {
    const full = path.join(pkgDir, rel);
    if (declLike(rel) && isFile(full)) return full;
    // A JS entry: its declaration twin, if the package ships one beside it.
    const twin = full.replace(/\.(m?js|cjs|jsx)$/, '');
    if (twin !== full) for (const e of ['.d.ts', '.d.mts', '.d.cts']) if (isFile(twin + e)) return twin + e;
  }
  return null;
}

function classifyConst(d: Decl, parsed: Parsed, hop: number): ComponentVerdict {
  if (d.typeText) {
    const t = d.typeText;
    if (COMPONENT_TYPE.test(t)) return 'component';
    // `typeof X` — the same file's X decides.
    const typeofRef = t.match(/^typeof\s+([A-Za-z_$][\w$]*)\s*$/);
    if (typeofRef && hop < 2) return verdictOfLocal(typeofRef[1], parsed, hop + 1);
    // A bare alias — follow it one hop within the file.
    const alias = t.match(/^([A-Za-z_$][\w$]*)(?:<[^]*>)?\s*$/);
    if (alias && hop < 2) {
      const target = parsed.decls.get(alias[1]);
      if (target) {
        for (const td of target) {
          if (td.kind !== 'type') continue;
          const text = `${td.typeText ?? ''} ${td.body ?? ''}`;
          if (COMPONENT_TYPE.test(text) || /\(\s*props?\b[^)]*\)\s*:\s*[^;{]*?(?:Element|ReactNode|VNode)\b/.test(text)) return 'component';
        }
        return 'not-component';
      }
      return 'unknown';
    }
    // A primitive, a literal object type, a union of literals, an array: not renderable.
    return 'not-component';
  }
  if (d.initText) {
    const init = d.initText;
    if (NON_COMPONENT_INIT.test(init)) return 'not-component';
    if (COMPONENT_INIT.test(init)) return 'component';
    const ref = init.match(/^([A-Za-z_$][\w$]*)\s*[;]?$/);
    if (ref && hop < 2) return verdictOfLocal(ref[1], parsed, hop + 1);
    // `Foo.bar(...)`, `withStyles(...)(Base)`, `Object.assign(Base, {...})`: a call whose result we cannot see.
    return 'unknown';
  }
  return 'unknown';
}

function classifyFunction(d: Decl): ComponentVerdict {
  if (d.retText === null || d.retText === undefined) return 'component'; // source function, PascalCase (grammar gate), body opaque
  if (RENDERABLE_RETURN.test(d.retText)) return 'component';
  if (/^(?:void|string|number|boolean|bigint|symbol|undefined|null|never|object|any|unknown|Promise\b|Record\b|Array\b|Map\b|Set\b|\w+\[\]|readonly\b|\{|\[|['"`])/.test(d.retText)) return 'not-component';
  if (/^[A-Z]\w*(?:\.\w+)*\s*(?:<[^]*>)?$/.test(d.retText)) return 'unknown'; // named type we did not resolve
  return 'not-component';
}

function classifyClass(d: Decl): ComponentVerdict {
  const body = d.body ?? '';
  if (/ɵcmp\b|ɵɵComponentDeclaration|\bisReactComponent\b/.test(body)) return 'component';
  if (/(?:^|[\s;{])render\s*\(/.test(body)) return 'component';
  const ext = (d.heritage ?? '').match(/extends\s+([^{]+)/);
  if (ext) return COMPONENT_HERITAGE.test(ext[1]) ? 'component' : 'unknown';
  return 'not-component';
}

function verdictOfDecls(list: Decl[], parsed: Parsed, hop: number): ComponentVerdict {
  let v: ComponentVerdict | undefined;
  let sawValue = false;
  for (const d of list) {
    if (d.kind === 'type') continue; // a namespace/interface merged onto a value does not decide
    sawValue = true;
    v = best(v, d.kind === 'const' ? classifyConst(d, parsed, hop) : d.kind === 'function' ? classifyFunction(d) : classifyClass(d));
    if (v === 'component') return v;
  }
  if (!sawValue) return 'not-component'; // only type / interface / enum / namespace declarations
  return v ?? 'unknown';
}

function verdictOfLocal(name: string, parsed: Parsed, hop: number): ComponentVerdict {
  const list = parsed.decls.get(name);
  if (list?.length) return verdictOfDecls(list, parsed, hop);
  return 'unknown';
}

function exportsOf(file: string, ctx: Ctx): Map<string, ComponentVerdict> {
  const cached = ctx.cache.get(file);
  if (cached) return cached;
  const out = new Map<string, ComponentVerdict>();
  if (ctx.inProgress.has(file) || ctx.filesLeft <= 0) return out;
  ctx.inProgress.add(file);
  ctx.filesLeft--;

  // A single-file component IS a component: the file format says so.
  if (/\.(vue|svelte)$/.test(file)) {
    out.set('default', 'component');
    ctx.cache.set(file, out);
    ctx.inProgress.delete(file);
    return out;
  }

  let content = '';
  try { content = fs.readFileSync(file, 'utf-8'); } catch { ctx.cache.set(file, out); ctx.inProgress.delete(file); return out; }
  const parsed = parse(content);

  const resolveName = (name: string): ComponentVerdict => {
    const local = parsed.decls.get(name);
    if (local?.length) return verdictOfDecls(local, parsed, 0);
    const imp = parsed.imports.get(name);
    if (imp) {
      if (imp.typeOnly) return 'not-component';
      const target = resolveSpec(imp.from, file, ctx);
      if (!target) return 'unknown';
      const targetExports = exportsOf(target, ctx);
      if (imp.imported === '*') return [...targetExports.values()].includes('component') ? 'component' : 'unknown';
      return targetExports.get(imp.imported) ?? 'unknown';
    }
    return 'unknown';
  };

  // Direct `export const/function/class/type Name`.
  for (const [name, list] of parsed.decls) {
    if (!list.some(d => d.exported)) continue;
    out.set(name, best(out.get(name), verdictOfDecls(list, parsed, 0)));
  }
  // Braced exports.
  for (const n of parsed.named) {
    if (n.typeOnly) { out.set(n.exported, best(out.get(n.exported), 'not-component')); continue; }
    let v: ComponentVerdict;
    if (n.from) {
      const target = resolveSpec(n.from, file, ctx);
      v = target ? (exportsOf(target, ctx).get(n.local) ?? 'unknown') : 'unknown';
    } else {
      v = resolveName(n.local);
    }
    out.set(n.exported, best(out.get(n.exported), v));
  }
  for (const spec of parsed.stars) {
    const target = resolveSpec(spec, file, ctx);
    if (!target) continue;
    for (const [name, v] of exportsOf(target, ctx)) if (name !== 'default') out.set(name, best(out.get(name), v));
  }
  for (const s of parsed.starAs) {
    const target = resolveSpec(s.from, file, ctx);
    const v: ComponentVerdict = target && [...exportsOf(target, ctx).values()].includes('component') ? 'component' : 'unknown';
    out.set(s.name, best(out.get(s.name), v));
  }
  if (parsed.defaultExport) {
    const de = parsed.defaultExport;
    let v: ComponentVerdict = 'unknown';
    if (de.local) v = resolveName(de.local);
    else if (de.text) v = NON_COMPONENT_INIT.test(de.text) ? 'not-component' : COMPONENT_INIT.test(de.text) || /^(?:async\s+)?function\b|^class\b/.test(de.text) ? 'component' : 'unknown';
    out.set('default', best(out.get('default'), v));
  }

  ctx.cache.set(file, out);
  ctx.inProgress.delete(file);
  return out;
}

export interface DeclaredExports {
  /** Names whose declaration states they are components. */
  components: string[];
  /** Names whose declaration states they are NOT (types, interfaces, enums, primitives, contexts). */
  excluded: string[];
  /** Names for which no declaration could be reached. Admitted by callers, and logged, because absence of evidence is not evidence. */
  unknown: string[];
  /** The default export's verdict, when the file has one. */
  defaultExport?: ComponentVerdict;
  /** Local name of `export default Name`, when it is a named value. */
  defaultLocalName?: string;
  /** True when the walk stopped at its file budget, so `unknown` may be inflated. */
  truncated: boolean;
}

/**
 * Every export of a declarations file (or source entry), classified.
 *
 * Follows `export * from`, `export { X } from`, `import … from` + `export { … }`
 * — relative targets always, bare specifiers into installed packages when
 * `followBare` is set — with a shared cache, a cycle guard and a file budget.
 */
export function declaredComponentExports(
  entryFile: string,
  options: { projectRoot?: string; followBare?: boolean; fileBudget?: number } = {},
): DeclaredExports {
  const ctx: Ctx = {
    projectRoot: options.projectRoot ?? process.cwd(),
    cache: new Map(),
    inProgress: new Set(),
    filesLeft: options.fileBudget ?? 400,
    followBare: options.followBare ?? true,
  };
  const map = exportsOf(entryFile, ctx);
  const components: string[] = [];
  const excluded: string[] = [];
  const unknown: string[] = [];
  for (const [name, v] of map) {
    if (name === 'default') continue;
    if (!/^[A-Z][\w$]*$/.test(name)) continue; // grammar gate: not writable as a tag
    (v === 'component' ? components : v === 'not-component' ? excluded : unknown).push(name);
  }
  let defaultLocalName: string | undefined;
  try {
    const m = fs.readFileSync(entryFile, 'utf-8').match(/export\s+default\s+(?:abstract\s+)?(?:(?:async\s+)?function\*?\s+|class\s+)?([A-Z][\w$]*)\b(?!\s*\.)/);
    if (m) defaultLocalName = m[1];
  } catch { /* unreadable */ }
  return {
    components,
    excluded,
    unknown,
    defaultExport: map.get('default'),
    defaultLocalName,
    truncated: ctx.filesLeft <= 0,
  };
}

/**
 * Does a package's declared surface include a component?
 *
 * `component` when its types entry declares at least one; `not-component`
 * when declarations were reached and none is; `unknown` when the package has
 * no declarations entry to read, or every export was unreachable.
 */
export function packageComponentVerdict(
  pkgDir: string,
  projectRoot: string,
): { verdict: ComponentVerdict; entry: string | null; components: string[]; excluded: string[]; unknown: string[] } {
  const entry = typesEntryFor(pkgDir, '');
  if (!entry) return { verdict: 'unknown', entry: null, components: [], excluded: [], unknown: [] };
  const found = declaredComponentExports(entry, { projectRoot, followBare: false });
  const hasDefaultComponent = found.defaultExport === 'component';
  const verdict: ComponentVerdict =
    found.components.length > 0 || hasDefaultComponent ? 'component'
      : found.excluded.length > 0 && found.unknown.length === 0 && found.defaultExport !== 'unknown' ? 'not-component'
        : 'unknown';
  return { verdict, entry, components: found.components, excluded: found.excluded, unknown: found.unknown };
}

/** One log line per decision that removed something, so an exclusion is never silent. */
export function logDeclarationVerdicts(label: string, found: DeclaredExports): void {
  const sample = (xs: string[]) => xs.slice(0, 8).join(', ') + (xs.length > 8 ? `, …${xs.length - 8} more` : '');
  if (found.excluded.length) logger.log(`🧾 ${label}: ${found.excluded.length} export(s) declared as types/values, not components — ${sample(found.excluded)}`);
  if (found.unknown.length) logger.log(`🧾 ${label}: ${found.unknown.length} export(s) admitted WITHOUT a reachable declaration — ${sample(found.unknown)}`);
  if (found.truncated) logger.log(`🧾 ${label}: declaration walk hit its file budget; some exports were judged without their source`);
}
