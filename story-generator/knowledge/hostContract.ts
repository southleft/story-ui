/**
 * What a design system needs AROUND its components before they render styled.
 *
 * A component library is not self-sufficient. Carbon needs a stylesheet import.
 * Fluent needs a provider and a theme object and ships no stylesheet at all.
 * Astryx needs three stylesheets AND an ancestor carrying
 * `data-astryx-theme="neutral"`, because its theme CSS is written with
 * `@scope ([data-astryx-theme="neutral"])` and every one of its 172 custom
 * properties is declared inside that scope. Six systems measured here, six
 * different shapes, no two sharing a mechanism.
 *
 * Today a human writes this into `.storybook/preview.tsx` from the README. I
 * wrote five of them by hand for this project's own test beds and got Astryx
 * wrong TWICE, and both failures were silent:
 *
 *   (a) `@astryxdesign/core/dist/astryx.css` is a real 127KB file that is NOT
 *       in the package's `exports` map. Vite fails the whole preview module for
 *       it and every story renders blank with no JavaScript error. The exported
 *       spelling is `@astryxdesign/core/astryx.css`.
 *   (b) Without the `data-astryx-theme` ancestor, components render with correct
 *       structure and no tokens at all — which looks exactly like a fidelity
 *       failure in the generator rather than a missing host attribute.
 *
 * Both were free to catch. `createRequire().resolve()` answers (a) in about a
 * millisecond and distinguishes THREE outcomes that mean different things; the
 * `@scope` gate in (b) is a literal string in a file we already read.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not guess a provider. Judging an
 * export by its name is how `/Provider$/` once deleted Shopify Polaris's
 * mandatory application root from the catalog, and Astryx's provider is called
 * `Theme`. Provider selection needs a value test and a measurement, and lives
 * in a later tier; what is here is only what a package STATES about itself.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/** A `@scope (...)` or attribute selector that gates a stylesheet's tokens. */
export interface ScopeGate {
  /** e.g. `data-astryx-theme` */
  attribute: string;
  /** e.g. `neutral` */
  value: string;
  source: '@scope' | 'selector';
  /** Custom properties that only resolve inside this gate — what is at stake. */
  propertiesBehindGate: number;
}

export interface CssRequirement {
  /** The specifier to write into a preview file. Proven to resolve. */
  specifier: string;
  /** Absolute path it resolved to — the proof. */
  resolvedTo: string;
  /** Custom properties this sheet declares. */
  declaredProperties: number;
  /** `@layer` names, which imply an intended import order. */
  layers: string[];
  gates: ScopeGate[];
}

/** A specifier we considered and rejected, and why. Never silently dropped. */
export interface RejectedSpecifier {
  specifier: string;
  /**
   * FORBIDDEN_BUT_PRESENT is the trap: the file is really on disk and the
   * package's exports map refuses that spelling. It is what you get by reading
   * `ls dist/` instead of the manifest, it is what took a Storybook preview
   * down with no JavaScript error, and it is indistinguishable from a typo if
   * you only look at the resolver's error code — Node reports
   * ERR_PACKAGE_PATH_NOT_EXPORTED for a nonexistent path too, once a package
   * declares an exports map. Only a disk check separates them.
   */
  reason: 'FORBIDDEN_BUT_PRESENT' | 'NOT_EXPORTED' | 'NOT_FOUND';
}

export type ContractStatus = 'satisfied' | 'not_applicable' | 'unknown';

export interface HostContract {
  schemaVersion: number;
  /** Packages examined, with the version each was read at. */
  packages: Array<{ name: string; version?: string; hasExportsMap: boolean }>;
  css: {
    /**
     * `not_applicable` is a DERIVED POSITIVE: this package ships no stylesheet,
     * verified by counting. It must never read the same as `unknown`, which
     * means we could not look. Conflating them is how every silent failure in
     * this project started.
     */
    status: ContractStatus;
    requirements: CssRequirement[];
    rejected: RejectedSpecifier[];
  };
  /** Attributes an ancestor must carry for tokens to resolve. */
  gates: { status: ContractStatus; required: ScopeGate[] };
  /** Sample of declared properties, for a runtime check that tokens applied. */
  tokenCanaries: string[];
}

export const HOST_CONTRACT_SCHEMA = 1;

/** Resolve a specifier the way the consuming project's bundler would. */
function tryResolve(projectRoot: string, specifier: string): { path?: string; reason?: RejectedSpecifier['reason'] } {
  try {
    const req = createRequire(path.join(projectRoot, 'package.json'));
    return { path: req.resolve(specifier) };
  } catch (err: any) {
    const code = String(err?.code || '');
    if (code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') return { reason: 'NOT_FOUND' };
    // Node gives the same code whether the target exists or not, so ask the
    // disk. A file that IS there and is still refused is the actionable case:
    // the specifier is wrong, not the setup.
    const onDisk = path.join(projectRoot, 'node_modules', ...specifier.split('/'));
    return { reason: fs.existsSync(onDisk) ? 'FORBIDDEN_BUT_PRESENT' : 'NOT_EXPORTED' };
  }
}

/**
 * Stylesheet specifiers a package DECLARES, from its `exports` map.
 *
 * Where an exports map exists it is an authoritative CLOSED list — anything
 * absent from it is not importable, whatever is on disk. Where it does not
 * (Carbon and Atlassian ship none), there is no closed list and any real path
 * is legal, so convention is the only remaining signal.
 *
 * Keys are enumerated rather than resolved values, because keys are
 * condition-independent: a package may gate CSS behind a `style` or `browser`
 * condition that `require.resolve` would not select.
 */
function declaredCssSpecifiers(pkgName: string, pkgRoot: string): string[] {
  let pkg: any;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8')); } catch { return []; }
  const out: string[] = [];

  const targetsCss = (node: unknown, depth = 0): boolean => {
    if (depth > 5 || node == null) return false;
    if (typeof node === 'string') return /\.(css|scss)$/.test(node);
    if (Array.isArray(node)) return node.some(n => targetsCss(n, depth + 1));
    if (typeof node === 'object') return Object.values(node as any).some(v => targetsCss(v, depth + 1));
    return false;
  };

  for (const [key, target] of Object.entries<any>(pkg?.exports ?? {})) {
    if (key === '.' || !key.startsWith('.')) continue;
    const isCssKey = /\.(css|scss)$/.test(key);
    if (!isCssKey && !targetsCss(target)) continue;
    if (key.includes('*')) continue;   // per-component fragments, not a host sheet
    out.push(path.posix.join(pkgName, key.replace(/^\.\//, '')));
  }

  // Pre-exports-map packages state it in `style`/`sass`, or not at all.
  if (out.length === 0) {
    for (const field of ['style', 'sass']) {
      const v = pkg?.[field];
      if (typeof v === 'string' && /\.(css|scss)$/.test(v)) out.push(path.posix.join(pkgName, v.replace(/^\.\//, '')));
    }
  }
  return out;
}

/** Conventional locations, for packages that declare nothing. */
const CONVENTIONAL_CSS = ['css/styles.css', 'styles.css', 'dist/styles.css', 'index.css', 'dist/index.css'];

/** Custom properties, `@layer` names and `@scope` gates in one stylesheet. */
function readSheet(file: string): { properties: string[]; layers: string[]; gates: ScopeGate[] } {
  let css: string;
  try { css = fs.readFileSync(file, 'utf-8'); } catch { return { properties: [], layers: [], gates: [] }; }

  // Unanchored: a minified sheet has no lines. See stylingFacts for the 813KB
  // single-line Carbon file that reported 0 of 839 properties.
  const properties = [...new Set([...css.matchAll(/--([a-zA-Z][\w-]*)\s*:/g)].map(m => m[1]))];
  const layers = [...new Set([...css.matchAll(/@layer\s+([\w-]+)/g)].map(m => m[1]))];

  const gates: ScopeGate[] = [];
  const seen = new Set<string>();
  /**
   * `@scope ([data-astryx-theme="neutral"]) to ([data-astryx-theme])`
   *
   * Counting the properties inside the scope body is what makes this
   * actionable: a gate holding 172 tokens is a hard requirement, and one
   * holding none is decoration.
   */
  for (const m of css.matchAll(/@scope\s*\(\s*\[([\w-]+)\s*=\s*["']([^"']+)["']\s*\]/g)) {
    const key = `${m[1]}=${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const body = css.slice(m.index ?? 0, (m.index ?? 0) + 20000);
    gates.push({
      attribute: m[1], value: m[2], source: '@scope',
      propertiesBehindGate: [...new Set([...body.matchAll(/--([a-zA-Z][\w-]*)\s*:/g)].map(x => x[1]))].length,
    });
  }
  return { properties, layers, gates };
}

function packageDir(projectRoot: string, name: string): string | null {
  const dir = path.join(projectRoot, 'node_modules', ...name.split('/'));
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Derive what a project must set up before this design system renders styled.
 *
 * Deterministic, no browser, no model, no network. Every specifier reported is
 * one that RESOLVED — a specifier that did not is recorded as rejected with its
 * reason, never written and never silently dropped.
 */
export function deriveHostContract(projectRoot: string, importPath: string): HostContract {
  const pkgName = importPath.startsWith('@')
    ? importPath.split('/').slice(0, 2).join('/')
    : importPath.split('/')[0];
  const scope = pkgName.startsWith('@') ? pkgName.split('/')[0] : null;

  // Candidate packages: the configured one, plus everything installed under
  // its scope. Astryx's tokens live in @astryxdesign/theme-neutral; Carbon's
  // live in @carbon/styles. Neither is the configured package.
  const candidates = [pkgName];
  if (scope) {
    try {
      for (const entry of fs.readdirSync(path.join(projectRoot, 'node_modules', scope), { withFileTypes: true })) {
        const name = `${scope}/${entry.name}`;
        if (name !== pkgName) candidates.push(name);
      }
    } catch { /* unscoped or not installed */ }
  }

  const packages: HostContract['packages'] = [];
  const requirements: CssRequirement[] = [];
  const rejected: RejectedSpecifier[] = [];
  const gates: ScopeGate[] = [];
  let sawAnyPackage = false;

  for (const name of candidates) {
    const root = packageDir(projectRoot, name);
    if (!root) continue;
    sawAnyPackage = true;

    let version: string | undefined;
    let hasExportsMap = false;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
      version = pkg.version;
      hasExportsMap = !!pkg.exports;
    } catch { /* recorded below as best we can */ }
    packages.push({ name, version, hasExportsMap });

    /**
     * Declared AND conventional, unioned — not one or the other.
     *
     * Measured: `@carbon/react` declares `index.scss` through its exports map,
     * so treating a non-empty declaration as complete stopped the search and
     * missed `@carbon/styles/css/styles.css` — the sheet carrying every one of
     * that system's tokens, and the one a human writes by hand.
     */
    const specifiers = [...new Set([
      ...declaredCssSpecifiers(name, root),
      ...CONVENTIONAL_CSS
        .filter(rel => fs.existsSync(path.join(root, rel)))
        .map(rel => path.posix.join(name, rel)),
    ])];

    for (const specifier of specifiers) {
      const resolved = tryResolve(projectRoot, specifier);
      if (!resolved.path) {
        rejected.push({ specifier, reason: resolved.reason ?? 'NOT_FOUND' });
        continue;
      }
      const { properties, layers, gates: sheetGates } = readSheet(resolved.path);

      /**
       * Is this a HOST stylesheet, or an internal one?
       *
       * A sheet declaring custom properties is a token source, whoever ships
       * it — that is what finds `@carbon/styles`. A sheet declaring none is
       * kept only when it belongs to the configured package and is plain CSS:
       * Astryx's `reset.css` carries no tokens and is genuinely required, while
       * `@fluentui/react-icons`' two icon-font sheets are a sibling's internals
       * and belong in nobody's preview file. `.scss` is excluded from that
       * allowance because it needs a preprocessor the project may not have —
       * Carbon's `index.scss` is a source entry, not a drop-in import.
       */
      const isTokenSource = properties.length > 0;
      const isOwnPlainCss = name === pkgName && specifier.endsWith('.css');
      if (!isTokenSource && !isOwnPlainCss) continue;

      requirements.push({
        specifier,
        resolvedTo: resolved.path,
        declaredProperties: properties.length,
        layers,
        gates: sheetGates,
      });
      for (const g of sheetGates) {
        if (!gates.some(x => x.attribute === g.attribute && x.value === g.value)) gates.push(g);
      }
    }
  }

  const anyTokens = requirements.some(r => r.declaredProperties > 0);
  const canaries = requirements
    .filter(r => r.declaredProperties > 0)
    .flatMap(r => readSheet(r.resolvedTo).properties.slice(0, 12))
    .slice(0, 24);

  return {
    schemaVersion: HOST_CONTRACT_SCHEMA,
    packages,
    css: {
      // Three genuinely different answers, and they must not collapse.
      status: !sawAnyPackage ? 'unknown' : requirements.length ? 'satisfied' : 'not_applicable',
      requirements,
      rejected,
    },
    gates: {
      status: !sawAnyPackage ? 'unknown' : gates.length ? 'satisfied' : 'not_applicable',
      required: gates.filter(g => g.propertiesBehindGate > 0),
    },
    tokenCanaries: anyTokens ? canaries : [],
  };
}
