/**
 * Content fingerprints for the on-disk knowledge caches.
 *
 * The caches under `.story-ui/knowledge/` were keyed on the package VERSION
 * alone. Two cases never change version: a source-only workspace package
 * (`src/housekit`, a `@/components` alias, a monorepo `packages/ui`), and a
 * bare scope with no package.json at all (`@atlaskit` → `@unknown`, a 757KB
 * record served across every upgrade of every package under it). Both looked
 * like a cache; both were a frozen snapshot of a first read.
 *
 * The fingerprint is CHEAP — stat, never read:
 *
 *   installed, versioned copy   name, version, size+mtime of package.json and
 *   (realpath in node_modules)  of the declarations entry. An npm install
 *                               rewrites both.
 *
 *   anything else               the sorted list of (relative path, size, mtime)
 *   (workspace source, a scope) of the files the extractor actually reads, so
 *                               editing any one of them changes the key.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** `size:mtime` for a file, or `absent`. Never throws. */
export function statStamp(file: string): string {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return 'absent';
  }
}

/** A real path inside some node_modules: an installed, versioned copy rather than a workspace source tree. */
export function isInstalledCopy(root: string): boolean {
  // Through the symlink: `node_modules/@acme/ui` → `packages/ui` is a
  // workspace source tree however it was reached.
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* judge the path as given */ }
  return real.split(path.sep).includes('node_modules');
}

export function contentFingerprint(input: {
  root: string;
  version?: string;
  entryFile?: string | null;
  /** The files the consumer reads; called only when the cheap stamp does not apply. */
  files: () => string[];
}): string {
  const h = crypto.createHash('sha1');
  if (input.version && isInstalledCopy(input.root) && fs.existsSync(path.join(input.root, 'package.json'))) {
    h.update(`version:${input.version}\n`);
    h.update(`manifest:${statStamp(path.join(input.root, 'package.json'))}\n`);
    h.update(`entry:${input.entryFile ? statStamp(input.entryFile) : 'none'}\n`);
  } else {
    h.update('files\n');
    const stamps = input.files()
      .map(f => `${path.relative(input.root, f)}|${statStamp(f)}`)
      .sort();
    for (const s of stamps) h.update(`${s}\n`);
    h.update(`manifest:${statStamp(path.join(input.root, 'package.json'))}\n`);
  }
  return h.digest('hex').slice(0, 12);
}

/** Source and declaration files under a root, bounded, for consumers that read a whole tree. */
export function listSourceFiles(root: string, limit = 3000): string[] {
  const results: string[] = [];
  const skip = new Set(['node_modules', '__tests__', 'test', 'tests', 'coverage', 'storybook-static']);
  const walk = (dir: string, depth: number) => {
    if (results.length >= limit || depth > 6) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name) || e.name.startsWith('.')) continue;
        walk(full, depth + 1);
      } else if (/\.(m?js|cjs|jsx|ts|tsx|mts|d\.[cm]?ts|vue|svelte)$/.test(e.name)) {
        results.push(full);
      }
    }
  };
  walk(root, 0);
  return results;
}

/**
 * `<safe>@<version>.<fingerprint><suffix>` under the project's knowledge dir.
 */
export function knowledgeCacheFile(projectRoot: string, importPath: string, version: string | undefined, fingerprint: string, suffix: string): string {
  const safe = importPath.replace(/[^a-z0-9]+/gi, '-');
  return path.join(projectRoot, '.story-ui', 'knowledge', `${safe}@${version || 'unknown'}.${fingerprint}${suffix}`);
}

/**
 * Remove earlier records for the same package and suffix, so a workspace that
 * is edited daily does not accumulate one file per edit.
 */
export function pruneStaleKnowledge(projectRoot: string, importPath: string, keep: string, suffix: string): void {
  const safe = importPath.replace(/[^a-z0-9]+/gi, '-');
  const dir = path.join(projectRoot, '.story-ui', 'knowledge');
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === path.basename(keep)) continue;
    if (!name.startsWith(`${safe}@`) || !name.endsWith(suffix)) continue;
    // `-fx-ds@1.0.0.props.json` and `-fx-ds-button@...` share a prefix only up
    // to the `@`; the `@` anchors the package name exactly.
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* best effort */ }
  }
}
