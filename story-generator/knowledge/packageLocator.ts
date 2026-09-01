/**
 * Where a package actually lives — one answer, used everywhere.
 *
 * `path.join(projectRoot, 'node_modules', name)` is not a resolution, it is a
 * guess about layout, and it is wrong for every monorepo. Measured on two real
 * workspace fixtures, the guess fails through OPPOSITE doors:
 *
 *   npm workspaces, symlink hoisted to the repo root
 *     existsSync(app/node_modules/@acme/ui) = false      require.resolve = OK
 *   pnpm-style, symlink local to the consuming app
 *     existsSync(app/node_modules/@acme/ui) = true       require.resolve = MODULE_NOT_FOUND
 *
 * So neither check alone is sufficient, and the codebase was using the weaker
 * one in six places. Both fixtures reported ZERO components — an internal
 * design system in a workspace, which is how most organisations ship one, was
 * entirely invisible.
 *
 * The working resolver already existed, inside propExtractor.packageRoot: walk
 * up from a resolved entry to the package.json whose `name` matches. It was the
 * only resolver in the repo that survived both layouts, and it was private to
 * one module. This is that logic, shared, with a node_modules chain walk added
 * for packages that declare no importable entry at all.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
export function packageNameOf(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

/**
 * Resolve a package to its directory on disk, or null.
 *
 * Three strategies, cheapest first. Each is a genuinely different question, and
 * a real project answers only some of them:
 *
 *   1. the node_modules CHAIN, walking up from the project — finds a hoisted
 *      workspace symlink that a single literal join misses
 *   2. require.resolve, then walk up to the matching package.json — finds a
 *      package whose files live somewhere unrelated to its specifier, and is
 *      the only strategy that works when the entry is re-exported
 *   3. require.resolve of `<name>/package.json` — works for packages that
 *      export their manifest but no importable entry (source-only workspace
 *      packages routinely have no `main` at all)
 */
export function packageDirFor(projectRoot: string, specifier: string): string | null {
  const name = packageNameOf(specifier);
  const segments = name.split('/');

  // 1. Walk the node_modules chain upward, as Node itself does.
  let dir = path.resolve(projectRoot);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, 'node_modules', ...segments);
    // A symlink resolves through existsSync; a broken one does not, which is
    // the right answer — a dangling link is not an installed package.
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Ask Node, then find the package root above whatever it resolved.
  try {
    const req = createRequire(path.join(projectRoot, 'package.json'));
    let cur = path.dirname(req.resolve(name));
    for (let i = 0; i < 8; i++) {
      const manifest = path.join(cur, 'package.json');
      if (fs.existsSync(manifest)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
          if (pkg?.name === name) return cur;
        } catch { /* unreadable manifest; keep walking */ }
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  } catch { /* not resolvable as a module; strategy 3 may still work */ }

  // 3. The manifest itself, for packages with no importable entry.
  try {
    const req = createRequire(path.join(projectRoot, 'package.json'));
    return path.dirname(req.resolve(`${name}/package.json`));
  } catch { /* genuinely not installed */ }

  return null;
}

/** Read a package's manifest, or null. Never throws. */
export function readManifest(pkgDir: string): any | null {
  try { return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')); } catch { return null; }
}

/**
 * The import specifier for a file inside a package, read from its `exports`.
 *
 * `${pkgName}/${relativePath}` is a guess, and a package with an exports map
 * rejects it: Vuetify maps `./components/*` → `./lib/components/*\/index.js`,
 * so the file `lib/components/VApp` is imported as `vuetify/components/VApp`,
 * and `vuetify/components/lib/components/VApp` — what string concatenation
 * produced — does not exist. Shoelace's manifest names `components/alert/
 * alert.js` while the exported path is `dist/components/alert/alert.js`.
 *
 * `relativePath` may name a file or a directory (an `index.*` is tried). When
 * the package has no exports map every path is importable, so the plain join
 * is returned. When it has one and nothing maps to the file, null: the caller
 * must not invent a path.
 */
export function specifierForPackageFile(pkgName: string, pkgDir: string, relativePath: string): string | null {
  const rel = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  let pkg: any;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')); } catch { pkg = null; }
  const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

  if (!pkg?.exports || typeof pkg.exports === 'string') return `${pkgName}/${rel}`;

  // Every target string an exports entry can resolve to, conditions flattened.
  const targets = (node: unknown, out: string[] = [], depth = 0): string[] => {
    if (depth > 5 || node == null) return out;
    if (typeof node === 'string') { out.push(node); return out; }
    if (Array.isArray(node)) { node.forEach(n => targets(n, out, depth + 1)); return out; }
    if (typeof node === 'object') for (const v of Object.values(node as Record<string, unknown>)) targets(v, out, depth + 1);
    return out;
  };

  // Files the relative path may denote.
  const candidates = [rel, ...['.js', '.mjs', '.cjs', '/index.js', '/index.mjs', '/index.cjs'].map(e => rel + e)]
    .filter(c => isFile(path.join(pkgDir, c)));
  if (candidates.length === 0) candidates.push(rel);

  const entries = Object.entries(pkg.exports as Record<string, unknown>).filter(([k]) => k.startsWith('./'));
  const candidateExists = candidates.some(c => isFile(path.join(pkgDir, c)));

  // Exact keys and pattern keys whose target IS one of the candidate files.
  for (const [key, value] of entries) {
    for (const target of targets(value)) {
      const t = target.replace(/^\.\//, '');
      if (!key.includes('*')) {
        if (candidates.includes(t)) return `${pkgName}/${key.slice(2)}`;
        continue;
      }
      const star = t.indexOf('*');
      if (star < 0) continue;
      const pre = t.slice(0, star);
      const post = t.slice(star + 1);
      for (const c of candidates) {
        if (c.startsWith(pre) && c.endsWith(post) && c.length > pre.length + post.length) {
          return `${pkgName}/${key.slice(2).replace('*', c.slice(pre.length, c.length - post.length))}`;
        }
      }
    }
  }

  // The path exists but no exports entry names it: it is not importable, and
  // no other file may stand in for it.
  if (candidateExists) return null;

  // The path does NOT exist under the package: a manifest wrote it relative to
  // another root (Shoelace's `components/alert/alert.js` lives under `dist/`).
  // Find the pattern key whose target contains the longest trailing part of it.
  let bestSpecifier: string | null = null;
  let bestLength = 0;
  for (const [key, value] of entries) {
    if (!key.includes('*')) continue;
    for (const target of targets(value)) {
      const t = target.replace(/^\.\//, '');
      const star = t.indexOf('*');
      if (star < 0) continue;
      const pre = t.slice(0, star);
      const post = t.slice(star + 1);
      const segs = rel.split('/');
      for (let i = 0; i < Math.min(segs.length, 6); i++) {
        const suffix = segs.slice(i).join('/');
        if (post && !suffix.endsWith(post)) continue;
        const starPart = post ? suffix.slice(0, suffix.length - post.length) : suffix;
        if (!starPart || starPart.length <= bestLength) continue;
        if (isFile(path.join(pkgDir, pre + starPart + post))) {
          bestSpecifier = `${pkgName}/${key.slice(2).replace('*', starPart)}`;
          bestLength = starPart.length;
        }
      }
    }
  }
  return bestSpecifier;
}
