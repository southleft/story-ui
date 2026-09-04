/**
 * A component's props as TypeScript itself resolves them.
 *
 * Reading declarations syntactically gets most libraries most of the way, and
 * then stops dead at one shape:
 *
 *   export interface ButtonProps extends HTMLChakraProps<"button", ButtonBaseProps> {}
 *
 * An empty interface extending a generic instantiated in another file. Nothing
 * short of type resolution can follow it, and the resolution bench measured
 * what that costs: 90 of 754 components known on one library, 49 of 63 on
 * another, 28 of 33 on a third. A catalog that lists a component and nothing
 * about it is the condition under which a composition invents attributes.
 *
 * So this asks the compiler. It writes one throwaway module that imports the
 * library and probes each export as a JSX element, then reads the contextual
 * type of the attributes — the same question tsc answers when it type-checks a
 * story, and the same machinery the post-generation prop check already uses.
 *
 * WHY IT SUBTRACTS. Asking the compiler about a styling-props library returns
 * everything: Chakra's Button resolves to 1,139 props, of which 1,123 are the
 * CSS surface every component in that library shares. A catalog entry listing
 * them teaches nothing and crowds out the entry that matters. What a
 * composition needs is what THIS component adds — size, variant, loading,
 * loadingText — so a prop carried by nearly every component here is treated as
 * the library's shared base and left out.
 *
 * That subtraction is self-calibrating and needs no knowledge of any library:
 * where components share a styling base, the base is found and removed; where
 * they share nothing — Carbon, Material — no prop reaches the threshold and
 * nothing is removed. Nothing in this file names a design system.
 */

import ts from 'typescript';
import path from 'path';
import type { PropFact } from './propExtractor.js';

export type ExportKind =
  /** A component: a JSX probe resolved a definite attribute set. */
  | 'component'
  /** An object whose members are components — `Accordion.Root`, `Accordion.Item`. */
  | 'namespace'
  /** A React context: it has a Provider, and is not written as an element. */
  | 'context'
  /** Nothing resolved: a type-only export, or a value with no JSX signature. */
  | 'unknown';

export interface ResolvedComponent {
  name: string;
  /**
   * What this export actually is.
   *
   * Offering a namespace or a context to a model as though it were a component
   * is worse than saying nothing: it produces `<Accordion>` where the library
   * requires `<Accordion.Root>`, and the story renders wrong or not at all.
   * Both are recognised by their SHAPE — a namespace's members are themselves
   * components, a context has React's Provider — never by their names.
   */
  kind: ExportKind;
  /** For a namespace, the members that are components. */
  members?: string[];
  /** What this component adds beyond the library's shared base. */
  own: PropFact[];
  /** Everything the compiler resolved, including the shared base. */
  total: number;
  /**
   * `closed` — the compiler resolved a definite set, so anything outside it is
   * rejected. `open` — an index signature admits any prop. `unknown` — the
   * type resolved to any, or to nothing at all, which is what a type-only or
   * namespace export looks like.
   */
  verdict: 'closed' | 'open' | 'unknown';
}

export interface CheckerPropsResult {
  components: ResolvedComponent[];
  /** Props shared by nearly every component, treated as the library's base. */
  baseProps: string[];
  /** False when no program could be built; distinct from "resolved nothing". */
  ran: boolean;
  reason?: string;
  ms: number;
}

/** Present on every JSX element; listing it teaches nothing. */
const UNIVERSAL = new Set(['key', 'ref', 'children']);

/**
 * A prop on at least this share of the library's substantial components is its
 * shared base rather than any one component's API. 0.9 rather than a round 1.0
 * because a styling base is not applied with perfect uniformity — a handful of
 * components legitimately omit a few of its props.
 */
const BASE_SHARE = 0.9;

/**
 * A component whose resolved set is this large is a real component rather than
 * a namespace or a type export, and only those vote on what the base is. With
 * namespace exports in the denominator the threshold is never reached and the
 * base comes out empty, which is the bug this constant exists to avoid.
 */
const SUBSTANTIAL = 50;

/**
 * A library-wide base is only meaningful with a population to average over.
 *
 * A package-per-component library ships two to five closely related components
 * per package, and they legitimately share their whole API — so "carried by
 * nearly every component here" removed the very props that ARE the component.
 * Measured: Atlassian's Button came back with one own prop, `overlay`, having
 * lost appearance, spacing and the rest to a base computed over four
 * components. Below this count, no library base is inferred.
 */
const MIN_POPULATION = 8;

/**
 * The intrinsic DOM attributes, always subtracted.
 *
 * A React component that spreads the rest of its props onto an element
 * resolves to every attribute that element accepts. Those belong to React and
 * the DOM, not to the design system, and they are the same for every library —
 * so they come out regardless of how many components the package has. Read
 * from the project's own React types by probing plain elements, never from a
 * list written here.
 */


function compilerOptionsFor(dir: string): ts.CompilerOptions {
  const defaults: ts.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    esModuleInterop: true,
  };
  let options: ts.CompilerOptions = defaults;
  const cfgPath = ts.findConfigFile(dir, ts.sys.fileExists);
  if (cfgPath) {
    const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (cfg.config) {
      const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
      options = { ...parsed.options };
      options.jsx ??= defaults.jsx;
      options.moduleResolution ??= defaults.moduleResolution;
      options.module ??= defaults.module;
      options.target ??= defaults.target;
    }
  }
  for (const key of ['rootDir', 'outDir', 'outFile', 'composite', 'declaration', 'declarationDir',
    'declarationMap', 'emitDeclarationOnly', 'incremental', 'tsBuildInfoFile', 'sourceMap',
    'inlineSourceMap', 'plugins'] as const) {
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

/**
 * The name a default export carries in its own declaration.
 *
 * A package-per-component library exports its component as the default, and a
 * default export cannot be probed through a namespace — `<L.default />` is not
 * JSX. It appears in the module's exports as `default`, so its real name has
 * to come from what it is aliased to. Without this, every component in such a
 * library resolved to nothing: measured on one, Button and Tag among them.
 */
function defaultExportName(checker: ts.TypeChecker, moduleSymbol: ts.Symbol): string | null {
  const def = checker.getExportsOfModule(moduleSymbol).find(s => s.name === 'default');
  if (!def) return null;
  /**
   * Follow the whole chain. A package-per-component library re-exports its
   * default through two or three barrels, and stopping at the first hop leaves
   * a symbol still called `default` — which is how Atlassian's Tag resolved to
   * nothing while SimpleTag and RemovableTag beside it resolved fine.
   */
  let symbol: ts.Symbol = def;
  for (let hop = 0; hop < 8 && symbol.flags & ts.SymbolFlags.Alias; hop++) {
    try {
      const next = checker.getAliasedSymbol(symbol);
      if (!next || next === symbol) break;
      symbol = next;
    } catch { break; }
  }
  let name = symbol.getName();
  if (name === 'default' || !/^[A-Z][\w$]*$/.test(name)) {
    // `const Tag = …; export default Tag` — the value's own declaration names it.
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    const declared = declaration && (ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration)
      || ts.isClassDeclaration(declaration)) && declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text : null;
    if (declared) name = declared;
  }
  return name && /^[A-Z][\w$]*$/.test(name) ? name : null;
}

/** The module's own exported names, as the compiler resolves them. */
function exportedNames(code: string, virtual: string, options: ts.CompilerOptions): string[] {
  const program = programOver(code, virtual, options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(virtual);
  if (!source) return [];
  let moduleSymbol: ts.Symbol | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      moduleSymbol = checker.getSymbolAtLocation(node.moduleSpecifier) ?? moduleSymbol;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!moduleSymbol) return [];
  const names = checker.getExportsOfModule(moduleSymbol).map(s => s.name);
  const fallback = defaultExportName(checker, moduleSymbol);
  return fallback ? [...names, `default:${fallback}`] : names;
}

/** First sentence of a symbol's documentation, when it has one. */
function docOf(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
  const parts = symbol.getDocumentationComment(checker);
  const text = ts.displayPartsToString(parts).trim();
  if (!text) return undefined;
  return text.split(/\n/)[0].split(/(?<=\.)\s/)[0].trim();
}

/** The string literals of a union type, when every member is one. */
function literalValues(type: ts.Type): string[] | undefined {
  const parts = type.isUnion() ? type.types : [type];
  const out: string[] = [];
  for (const p of parts) {
    if (p.isStringLiteral()) out.push(p.value);
    else if (p.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
    else return undefined;
  }
  return out.length > 1 && out.length <= 24 ? out : undefined;
}


/**
 * What an export that is not usable as an element actually is.
 *
 * Read from the value's own shape: a React context carries a Provider, and a
 * compound-component namespace carries capitalised members that are themselves
 * usable as elements. Both are common in modern libraries and both are
 * routinely admitted as components by name-based discovery, which then offers
 * the model something it cannot write.
 */
function classifyValue(
  name: string, checker: ts.TypeChecker, source: ts.SourceFile,
): { kind: ExportKind; members?: string[] } {
  let symbol: ts.Symbol | undefined;
  const find = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === name) {
      symbol = checker.getSymbolAtLocation(node) ?? symbol;
    }
    ts.forEachChild(node, find);
  };
  find(source);
  if (!symbol) return { kind: 'unknown' };
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!declaration) return { kind: 'unknown' };
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const props = checker.getPropertiesOfType(type);
  const names = new Set(props.map(p => p.name));
  if (names.has('Provider') && (names.has('Consumer') || names.has('displayName'))) {
    return { kind: 'context' };
  }
  const members = props.filter(p => /^[A-Z]/.test(p.name)).map(p => p.name);
  return members.length >= 2 ? { kind: 'namespace', members } : { kind: 'unknown' };
}

/**
 * Resolve the props of a package's components with the compiler.
 *
 * React only: the probe is a JSX element, which is the question tsc can answer
 * about a React component and cannot answer about a Vue, Angular or Lit one.
 * Those frameworks declare their inputs outright and are read directly.
 */
export function resolvePropsWithChecker(opts: {
  projectRoot: string;
  importPath: string;
  /** Where a story would live; the tsconfig above it governs resolution. */
  storiesDir?: string;
  /** Cap on how many exports are probed, so an enormous package stays bounded. */
  limit?: number;
}): CheckerPropsResult {
  const started = Date.now();
  const dir = opts.storiesDir && opts.storiesDir.length ? opts.storiesDir : opts.projectRoot;
  const virtual = path.join(dir, '__story_ui_prop_probe__.tsx');
  const options = compilerOptionsFor(dir);
  const spec = opts.importPath.replace(/'/g, "\\'");

  let names: string[];
  try {
    names = exportedNames(`import * as L from '${spec}';\nexport const __lib = L;\n`, virtual, options);
  } catch (error) {
    return { components: [], baseProps: [], ran: false, ms: Date.now() - started, reason: `module could not be resolved: ${error instanceof Error ? error.message : String(error)}` };
  }
  const defaultMarker = names.find(n => n.startsWith('default:'));
  const defaultName = defaultMarker ? defaultMarker.slice('default:'.length) : null;
  const probes = names.filter(n => /^[A-Z]/.test(n)).slice(0, opts.limit ?? 2500);
  if (!probes.length && !defaultName) {
    return { components: [], baseProps: [], ran: false, ms: Date.now() - started, reason: `no capitalised exports resolved from ${opts.importPath}` };
  }

  const code = `import * as L from '${spec}';\n`
    + (defaultName ? `import __D from '${spec}';\nexport const __d = <__D />;\n` : '')
    + probes.map((n, i) => `export const __p${i} = <L.${n} />;`).join('\n') + '\n';
  const program = programOver(code, virtual, options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(virtual);
  if (!source) {
    return { components: [], baseProps: [], ran: false, ms: Date.now() - started, reason: 'probe module did not compile' };
  }

  /** Everything resolved per component, before the base is subtracted. */
  const resolved = new Map<string, { symbols: Map<string, ts.Symbol>; open: boolean }>();
  /**
   * Every attribute React's own types give any intrinsic element.
   *
   * A component that spreads its rest props onto an element resolves to all of
   * them, and they belong to React and the DOM rather than to the design
   * system — the same set for every library. Taken from the project's own React
   * types, never from a list written here. Where a library really does declare
   * one of them (a checkbox's `checked`), the syntactic pass has already read
   * it from that library's declaration and the merge keeps it.
   */
  const intrinsic = new Set<string>();
  /**
   * WHERE React's attributes are declared, not what they are called.
   *
   * Subtracting by name lost props a design system genuinely owns: a
   * checkbox's `checked`, an accordion item's `value`, a link's `href` are all
   * DOM attribute names and all real parts of a component's API. The
   * distinction is not in the name, it is in the declaration — React's
   * attributes are declared in React's own type files, a library's in its own.
   * The compiler knows both, so the files that declare intrinsic attributes
   * are collected here and a prop is dropped only when its declaration lives
   * in one of them.
   */
  const reactTypeFiles = new Set<string>();
  for (const symbol of checker.getJsxIntrinsicTagNamesAt(source)) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, source);
    for (const p of checker.getPropertiesOfType(type)) {
      intrinsic.add(p.name);
      for (const d of p.declarations ?? []) reactTypeFiles.add(d.getSourceFile().fileName);
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node)) {
      const raw = node.tagName.getText(source);
      const tag = raw === '__D' && defaultName ? defaultName : raw.replace(/^L\./, '');
      const type = checker.getContextualType(node.attributes);
      const symbols = new Map<string, ts.Symbol>();
      let open = false;
      if (type && !(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) {
        for (const part of type.isUnion() ? type.types : [type]) {
          if (checker.getIndexInfosOfType(part).length) open = true;
          for (const s of checker.getPropertiesOfType(part)) if (!symbols.has(s.name)) symbols.set(s.name, s);
        }
      }
      resolved.set(tag, { symbols, open });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // What nearly every substantial component here shares is the library's base.
  const substantial = [...resolved.values()].filter(r => r.symbols.size > SUBSTANTIAL);
  const frequency = new Map<string, number>();
  for (const r of substantial) for (const name of r.symbols.keys()) frequency.set(name, (frequency.get(name) ?? 0) + 1);
  const baseProps = substantial.length >= MIN_POPULATION
    ? [...frequency.entries()].filter(([, n]) => n >= substantial.length * BASE_SHARE).map(([n]) => n)
    : [];
  const base = new Set(baseProps);
  /** A prop whose only declaration sits in a file that declares DOM attributes. */
  const isDomAttribute = (symbol: ts.Symbol): boolean => {
    const declarations = symbol.declarations ?? [];
    if (!declarations.length) return false;
    return declarations.every(d => reactTypeFiles.has(d.getSourceFile().fileName));
  };

  const components: ResolvedComponent[] = [];
  for (const [name, r] of resolved) {
    const ownNames = [...r.symbols.keys()].filter(n =>
      !base.has(n) && !UNIVERSAL.has(n) && !isDomAttribute(r.symbols.get(n)!));
    const own: PropFact[] = ownNames.map(propName => {
      const symbol = r.symbols.get(propName)!;
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      const type = declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : undefined;
      const values = type ? literalValues(type) : undefined;
      const text = type ? checker.typeToString(type) : undefined;
      const doc = docOf(symbol, checker);
      return {
        name: propName,
        required: !(symbol.flags & ts.SymbolFlags.Optional),
        ...(text && text.length <= 120 ? { type: text } : {}),
        ...(values ? { options: values } : {}),
        ...(doc ? { doc } : {}),
      };
    });
    const verdict = r.symbols.size <= 1 ? 'unknown' : r.open ? 'open' : 'closed';
    let kind: ExportKind = verdict === 'unknown' ? 'unknown' : 'component';
    let members: string[] | undefined;
    if (verdict === 'unknown') {
      const shape = classifyValue(name, checker, source);
      kind = shape.kind;
      members = shape.members;
    }
    components.push({
      name,
      kind,
      ...(members?.length ? { members } : {}),
      own,
      total: r.symbols.size,
      verdict,
    });
  }

  return { components, baseProps, ran: true, ms: Date.now() - started };
}
