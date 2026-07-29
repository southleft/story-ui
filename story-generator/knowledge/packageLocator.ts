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
