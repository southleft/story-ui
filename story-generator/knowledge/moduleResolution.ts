/**
 * Does an import specifier name a module this project can actually serve?
 *
 * Answered from the project's own files: a relative path against the
 * generated-stories directory, an alias through `tsconfig.json`'s `paths`,
 * the declared `importPath` → `componentsPath` pairing in story-ui.config,
 * and a bare package through `node_modules/<pkg>/package.json` (its
 * `exports` map when it has one, the file on disk when it does not).
 *
 * Why this exists: the validator used to treat every specifier that began
 * with the configured `importPath` plus a slash as a "deep/incorrect path"
 * and collapse it onto the barrel. That is right for the case it was written
 * for (`vuetify/components/lib/components/VAlert` is not a module) and wrong
 * for a local design system whose catalog said, per component, "import from
 * '@/components/alert/alert'" — a path the project itself declared, which
 * resolves, and which the barrel does not always cover. The model obeyed the
 * catalog; the validator undid it; the story imported names the barrel did
 * not export and rendered blank. Whether a path resolves is a fact on disk,
 * so ask the disk.
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import { resolveLocalModule } from '../editing/relocateImports.js';

export interface ResolveOptions {
  /** The project root: where tsconfig.json and node_modules live. */
  projectRoot: string;
  /** The directory the story is written to; relative specifiers resolve from here. */
  fromDir: string;
  /** story-ui.config `importPath`, when declared. */
  importPath?: string;
  /** story-ui.config `componentsPath`, when declared: the directory `importPath` names. */
  componentsPath?: string;
}

export type ResolutionHow =
  | 'relative'
  | 'tsconfig-paths'
  | 'components-path'
  | 'package-exports'
  | 'package-file'
  | 'package-root';

export interface Resolution {
  /** The file or package directory the specifier names, or null. */
  file: string | null;
  /** Which fact answered. `unresolved` names what was looked at and not found. */
  how: ResolutionHow | 'unresolved';
  /** For `unresolved`: what was checked, so a log line can say it. */
  detail?: string;
  /**
   * The specifier matched a project alias (tsconfig `paths` or the declared
   * importPath → componentsPath pairing), so it names a LOCAL module whether
   * or not the file exists — a bare npm specifier never sets this.
   */
  aliasMatched?: boolean;
}

interface PathsConfig {
  baseDir: string;
  paths: Record<string, string[]>;
}

const pathsCache = new Map<string, { mtime: number; config: PathsConfig | null }>();

/**
 * `compilerOptions.paths` (with its `baseUrl`) from the project's tsconfig,
 * following `extends` and project `references` — a root tsconfig that only
 * lists references still commonly carries the alias itself.
 */
export function readTsconfigPaths(projectRoot: string): PathsConfig | null {
  const rootFile = path.join(projectRoot, 'tsconfig.json');
  let mtime = 0;
  try { mtime = fs.statSync(rootFile).mtimeMs; } catch { return null; }
  const cached = pathsCache.get(rootFile);
  if (cached && cached.mtime === mtime) return cached.config;

  const seen = new Set<string>();
  const found: PathsConfig[] = [];
  const visit = (file: string) => {
    const abs = path.resolve(file);
    if (seen.has(abs) || !fs.existsSync(abs)) return;
    seen.add(abs);
    const read = ts.readConfigFile(abs, f => fs.readFileSync(f, 'utf-8'));
    const json = read.config;
    if (!json || typeof json !== 'object') return;
    const dir = path.dirname(abs);
    const co = json.compilerOptions;
    if (co && co.paths && typeof co.paths === 'object') {
      found.push({
        baseDir: co.baseUrl ? path.resolve(dir, co.baseUrl) : dir,
        paths: co.paths,
      });
    }
    const ext = json.extends;
    for (const e of Array.isArray(ext) ? ext : ext ? [ext] : []) {
      if (typeof e === 'string' && (e.startsWith('.') || e.startsWith('/'))) {
        visit(e.endsWith('.json') ? path.resolve(dir, e) : path.resolve(dir, e + '.json'));
      }
    }
    for (const ref of Array.isArray(json.references) ? json.references : []) {
      if (ref && typeof ref.path === 'string') {
        const p = path.resolve(dir, ref.path);
        visit(p.endsWith('.json') ? p : path.join(p, 'tsconfig.json'));
      }
    }
  };
  visit(rootFile);

  // The root's own mapping first; a referenced project's mapping fills gaps.
  const config: PathsConfig | null = found.length
    ? { baseDir: found[0].baseDir, paths: Object.assign({}, ...found.slice().reverse().map(f => f.paths)) }
    : null;
  pathsCache.set(rootFile, { mtime, config });
  return config;
}

function matchPathsAlias(specifier: string, cfg: PathsConfig): string[] {
  const out: string[] = [];
  for (const [key, targets] of Object.entries(cfg.paths)) {
    if (!Array.isArray(targets)) continue;
    const star = key.indexOf('*');
    let rest: string | null = null;
    if (star === -1) {
      if (specifier === key) rest = '';
    } else {
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= key.length - 1) {
        rest = specifier.slice(prefix.length, specifier.length - suffix.length);
      }
    }
    if (rest === null) continue;
    for (const t of targets) {
      if (typeof t !== 'string') continue;
      out.push(path.resolve(cfg.baseDir, t.replace('*', rest)));
    }
  }
  return out;
}

function packageDirFor(pkgName: string, fromDir: string, projectRoot: string): string | null {
  let dir = path.resolve(fromDir);
  const stop = path.parse(dir).root;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', pkgName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const atRoot = path.join(projectRoot, 'node_modules', pkgName);
  return fs.existsSync(path.join(atRoot, 'package.json')) ? atRoot : null;
}

/** Does `exports` name `subpath` (`.` for the root)? Undefined when the map is not subpath-keyed. */
function exportsNames(exportsField: unknown, subpath: string): boolean | undefined {
  if (exportsField === undefined || exportsField === null) return undefined;
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) return subpath === '.';
  if (typeof exportsField !== 'object') return undefined;
  const keys = Object.keys(exportsField as Record<string, unknown>);
  const subpathKeyed = keys.some(k => k.startsWith('.'));
  if (!subpathKeyed) return subpath === '.'; // conditions object: root only
  for (const key of keys) {
    if (!key.startsWith('.')) continue;
    const value = (exportsField as Record<string, unknown>)[key];
    if (value === null) continue; // an explicit block
    const star = key.indexOf('*');
    if (star === -1) {
      if (key === subpath) return true;
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= key.length - 1) return true;
  }
  return false;
}

/**
 * Resolve `specifier` the way the project's tooling would, as far as the
 * facts on disk allow. Never guesses: an alias with no tsconfig entry, a
 * package subpath absent from its `exports`, or a file that is not there all
 * come back `unresolved` with what was checked.
 */
export function resolveSpecifier(specifier: string, opts: ResolveOptions): Resolution {
  const spec = specifier.trim();
  if (!spec) return { file: null, how: 'unresolved', detail: 'empty specifier' };

  if (spec.startsWith('.') || spec.startsWith('/')) {
    const file = resolveLocalModule(spec, opts.fromDir);
    return file
      ? { file, how: 'relative' }
      : { file: null, how: 'unresolved', detail: `no file for '${spec}' from ${opts.fromDir}` };
  }

  const checked: string[] = [];
  let aliasMatched = false;

  // tsconfig `paths`: the project's own alias table.
  const paths = readTsconfigPaths(opts.projectRoot);
  if (paths) {
    for (const target of matchPathsAlias(spec, paths)) {
      aliasMatched = true;
      const file = resolveLocalModule(path.basename(target), path.dirname(target));
      if (file) return { file, how: 'tsconfig-paths', aliasMatched };
      checked.push(`tsconfig paths → ${target}`);
    }
  }

  // story-ui.config's declared pairing: `importPath` names `componentsPath`.
  if (opts.importPath && opts.componentsPath && (spec === opts.importPath || spec.startsWith(opts.importPath + '/'))) {
    aliasMatched = true;
    const rest = spec.slice(opts.importPath.length).replace(/^\//, '');
    const base = path.resolve(opts.projectRoot, opts.componentsPath);
    const target = rest ? path.join(base, rest) : base;
    const file = resolveLocalModule(path.basename(target), path.dirname(target));
    if (file) return { file, how: 'components-path', aliasMatched };
    checked.push(`componentsPath → ${target}`);
  }
  // An alias names a local module; do not go looking for it in node_modules.
  if (aliasMatched) return { file: null, how: 'unresolved', detail: checked.join('; '), aliasMatched };

  // A bare package: node_modules/<pkg>, then its exports map or the file.
  const m = spec.match(/^(@[^/]+\/[^/]+|[^@][^/]*)(?:\/(.*))?$/);
  if (m) {
    const pkgName = m[1];
    const sub = m[2] ? `./${m[2]}` : '.';
    const dir = packageDirFor(pkgName, opts.fromDir, opts.projectRoot);
    if (!dir) {
      checked.push(`no node_modules/${pkgName}`);
      return { file: null, how: 'unresolved', detail: checked.join('; ') };
    }
    let pkgJson: any = {};
    try { pkgJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')); } catch { /* unreadable: fall through to files */ }
    const named = exportsNames(pkgJson.exports, sub);
    if (named === true) return { file: sub === '.' ? dir : path.join(dir, sub), how: sub === '.' ? 'package-root' : 'package-exports' };
    if (named === false) {
      checked.push(`${pkgName}/package.json exports does not name '${sub}'`);
      return { file: null, how: 'unresolved', detail: checked.join('; ') };
    }
    if (sub === '.') return { file: dir, how: 'package-root' };
    const target = path.join(dir, sub);
    const file = resolveLocalModule(path.basename(target), path.dirname(target))
      || (fs.existsSync(path.join(target, 'package.json')) ? path.join(target, 'package.json') : null);
    if (file) return { file, how: 'package-file' };
    checked.push(`no file at ${target}`);
  }

  return { file: null, how: 'unresolved', detail: checked.join('; ') || `nothing to check for '${spec}'` };
}

/** True when the specifier names something the project can serve. */
export function specifierResolves(specifier: string, opts: ResolveOptions): boolean {
  return resolveSpecifier(specifier, opts).file !== null;
}

/** The resolver's options from a story-ui config, for callers that only hold the config. */
export function resolveOptionsFrom(config: any, projectRoot: string = process.cwd()): ResolveOptions {
  return {
    projectRoot,
    fromDir: path.resolve(projectRoot, config?.generatedStoriesPath || './src/stories/generated'),
    importPath: typeof config?.importPath === 'string' ? config.importPath : undefined,
    componentsPath: typeof config?.componentsPath === 'string' ? config.componentsPath : undefined,
  };
}
