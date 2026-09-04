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

export interface ResolvedComponent {
  name: string;
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
  return checker.getExportsOfModule(moduleSymbol).map(s => s.name);
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
  const probes = names.filter(n => /^[A-Z]/.test(n)).slice(0, opts.limit ?? 1200);
  if (!probes.length) {
    return { components: [], baseProps: [], ran: false, ms: Date.now() - started, reason: `no capitalised exports resolved from ${opts.importPath}` };
  }

  const code = `import * as L from '${spec}';\n`
    + probes.map((n, i) => `export const __p${i} = <L.${n} />;`).join('\n') + '\n';
  const program = programOver(code, virtual, options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(virtual);
  if (!source) {
    return { components: [], baseProps: [], ran: false, ms: Date.now() - started, reason: 'probe module did not compile' };
  }

  /** Everything resolved per component, before the base is subtracted. */
  const resolved = new Map<string, { symbols: Map<string, ts.Symbol>; open: boolean }>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source).replace(/^L\./, '');
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
  const baseProps = substantial.length >= 3
    ? [...frequency.entries()].filter(([, n]) => n >= substantial.length * BASE_SHARE).map(([n]) => n)
    : [];
  const base = new Set(baseProps);

  const components: ResolvedComponent[] = [];
  for (const [name, r] of resolved) {
    const ownNames = [...r.symbols.keys()].filter(n => !base.has(n) && !UNIVERSAL.has(n));
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
    components.push({
      name,
      own,
      total: r.symbols.size,
      verdict: r.symbols.size <= 1 ? 'unknown' : r.open ? 'open' : 'closed',
    });
  }

  return { components, baseProps, ran: true, ms: Date.now() - started };
}
