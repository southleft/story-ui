/**
 * A relative import that does not resolve is a story that cannot be served.
 *
 * Vite answers "Failed to resolve import '../../components'" and Storybook
 * paints its red overlay in the preview, in the thumbnail, and in the
 * verification screenshot. Observed on a library whose barrel is
 * `src/index.ts` while the config's importPath named `src/components`, a
 * directory with no index: three stories in a row, every one unservable, and
 * no check refused them because the named-import validator treated an
 * unresolvable path as "someone else's fault" and said nothing.
 *
 * Two answers, both deterministic. Where discovery knows the file a
 * component lives in, the import is rewritten to that file before validation
 * runs — the answer is on disk, no model needed. Where it does not, the
 * import is reported as unresolvable with the path that would work, and the
 * healing loop gets an instruction rather than a mystery.
 */

import fs from 'fs';
import path from 'path';

export const LOCAL_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.vue', '.svelte'];

/** The file a relative specifier names from `fromDir`, or null. */
export function resolveLocalModule(specifier: string, fromDir: string): string | null {
  const base = path.resolve(fromDir, specifier);
  for (const ext of LOCAL_EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of LOCAL_EXTENSIONS) {
    const indexFile = path.join(base, `index${ext}`);
    if (fs.existsSync(indexFile)) return indexFile;
  }
  try {
    return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
  } catch {
    return null;
  }
}

/** `fromDir` → `file` as an import specifier: relative, forward slashes, no extension. */
export function relativeSpecifier(fromDir: string, file: string): string {
  let rel = path.relative(fromDir, file).split(path.sep).join('/');
  rel = rel.replace(/\.(tsx|ts|jsx|js|mjs)$/, '').replace(/\/index$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

export interface ComponentHome {
  name: string;
  /** Absolute path on disk, for local components. */
  filePath?: string;
  /** A specifier discovery already knows (npm subpath or a declared path). */
  __componentPath?: string;
}

export interface RelocationResult {
  code: string;
  /** `Badge: '../../components' → '../../components/Badge/Badge'` */
  relocated: string[];
  /** Imports that still do not resolve, with the bindings they carry. */
  unresolved: Array<{ specifier: string; bindings: string[] }>;
}

const IMPORT_RE = /^[ \t]*import\s+(type\s+)?([^'";]*?)\s*from\s*['"](\.[^'"]+)['"];?[ \t]*$/gm;

/**
 * Rewrite every relative import that does not resolve from `generatedDir`
 * to the files discovery knows the bindings live in. Bindings with no known
 * home stay on their original line so validation can name them.
 */
export function relocateUnresolvableImports(
  code: string,
  generatedDir: string,
  components: ComponentHome[],
  resolve: (specifier: string, fromDir: string) => string | null = resolveLocalModule,
): RelocationResult {
  const relocated: string[] = [];
  const unresolved: Array<{ specifier: string; bindings: string[] }> = [];
  const homeOf = (name: string): string | null => {
    const c = components.find(x => x.name === name);
    if (!c) return null;
    if (c.filePath) return relativeSpecifier(generatedDir, c.filePath);
    if (c.__componentPath && c.__componentPath.includes('/')) return c.__componentPath;
    return null;
  };

  const out = code.replace(IMPORT_RE, (line, typeKw: string | undefined, clause: string, specifier: string) => {
    if (resolve(specifier, generatedDir)) return line;
    const braced = clause.match(/\{([^}]*)\}/);
    const defaultName = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    const named = braced
      ? braced[1].split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const byHome = new Map<string, string[]>();
    const left: string[] = [];
    for (const entry of named) {
      const local = entry.split(/\s+as\s+/)[0].trim();
      const home = homeOf(local);
      if (home && home !== specifier) {
        byHome.set(home, [...(byHome.get(home) || []), entry]);
        relocated.push(`${local}: '${specifier}' → '${home}'`);
      } else {
        left.push(entry);
      }
    }
    const lines: string[] = [];
    const indent = line.match(/^[ \t]*/)?.[0] ?? '';
    const t = typeKw ? 'type ' : '';
    for (const [home, names] of byHome) lines.push(`${indent}import ${t}{ ${names.join(', ')} } from '${home}';`);
    // A default import binds any name; move it only when the name is a known component.
    if (defaultName) {
      const home = homeOf(defaultName);
      if (home && home !== specifier) {
        lines.push(`${indent}import ${t}${defaultName} from '${home}';`);
        relocated.push(`${defaultName}: '${specifier}' → '${home}'`);
      } else {
        left.unshift(defaultName);
      }
    }
    if (left.length) {
      const leftNamed = left.filter(n => named.includes(n));
      const leftDefault = left.find(n => n === defaultName);
      const parts = [leftDefault, leftNamed.length ? `{ ${leftNamed.join(', ')} }` : ''].filter(Boolean).join(', ');
      lines.push(`${indent}import ${t}${parts} from '${specifier}';`);
      unresolved.push({ specifier, bindings: left.map(n => n.split(/\s+as\s+/)[0].trim()) });
    }
    return lines.join('\n');
  });

  return { code: out, relocated, unresolved };
}

/** Every relative import in `code` that does not resolve from `generatedDir`. */
export function unresolvedRelativeImports(
  code: string,
  generatedDir: string,
  resolve: (specifier: string, fromDir: string) => string | null = resolveLocalModule,
): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
    if (!resolve(m[1], generatedDir)) out.add(m[1]);
  }
  return [...out];
}
