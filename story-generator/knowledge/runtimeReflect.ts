/**
 * Runtime reflection — learn a design system's real structure by importing it.
 *
 * The component catalog handed to the model is a flat list of names, so
 * compound components arrive as unrelated siblings: `Menu`, `MenuTarget`,
 * `MenuDropdown`, `MenuItem`. Nothing conveys that they compose, and the model
 * has to fall back on whatever it remembers about the library — which is
 * exactly the knowledge that is wrong for a private or recently-changed system.
 *
 * Importing the installed package and reading static properties recovers that
 * structure from the version the project actually has. It is the cheapest
 * accurate metadata available: no type parsing, no docgen, no network.
 *
 * Framework scope: this reads the React convention of attaching sub-components
 * as static properties (`Menu.Target`). Vue/Angular/Svelte express composition
 * differently, so extraction returns empty for them rather than guessing.
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger.js';
import { contentFingerprint, knowledgeCacheFile, listSourceFiles, pruneStaleKnowledge } from './cacheKey.js';

export interface CompoundComponent {
  /** Parent export name, e.g. "Menu". */
  name: string;
  /** Sub-component names, e.g. ["Target", "Dropdown", "Item"]. */
  children: string[];
  /**
   * Can the parent itself be rendered?
   *
   * True for statics on a real component (`Card` with `Card.Header`). False for
   * a namespace object (Base UI's `Menu`), where `<Menu>` throws. The
   * difference decides whether the model may write `<Menu>…</Menu>`.
   */
  parentRenderable?: boolean;
  /**
   * Each child's OWN name according to the runtime, keyed by its static key.
   *
   * The key into prop knowledge is not parent+child. Measured across Base UI's
   * 266 sub-components: naive concatenation is wrong 51 times, the runtime name
   * 7. `Menu.Separator` is "Separator", not "MenuSeparator"; `AlertDialog.Close`
   * is literally "DialogClose", because AlertDialog reuses Dialog's parts.
   */
  childRuntimeNames?: Record<string, string>;
}

export interface ReflectedKnowledge {
  /** Reflector schema that produced this record; see REFLECT_SCHEMA. */
  schema?: number;
  importPath: string;
  version?: string;
  /** Every PascalCase export, so we can tell a real component from a guess. */
  exports: string[];
  compound: CompoundComponent[];
  /**
   * Exports that are namespace objects: real, importable, and NOT renderable.
   *
   * `import { Menu } from '@base-ui/react'` then `<Menu.Root>`. `<Menu>` itself
   * throws — it is a plain object. Dropping these loses the library (29 of Base
   * UI's 40 exports, including every interactive composite); marking them
   * renderable invites the throw. They are a third state.
   */
  namespaces?: string[];
  reflectedAt: string;
}

/**
 * Bump when reflection learns to record something new.
 *
 * The cache was keyed on the library version alone and had no schema field, so
 * every new field would be invisible on any machine with a warm cache until the
 * design system itself published a release. Exactly the failure already fixed
 * in propExtractor, which is why it is fixed here before adding fields rather
 * than after.
 */
const REFLECT_SCHEMA = 1;

/**
 * Statics that are React/library plumbing rather than sub-components.
 *
 * `Provider` and `Consumer` are deliberately NOT here. In Radix-derived systems
 * — Radix itself, shadcn/ui, Ark, Chakra v3, Base UI — `Tooltip.Provider` and
 * `Toast.Provider` are required composition members, not context plumbing.
 * Stripping them by name told the model to use dot notation while hiding the
 * one child without which the component throws.
 *
 * Whether a static is a component is decided below by what it IS, not by what
 * it is called.
 */
const NON_COMPONENT_STATICS = new Set([
  'displayName', 'propTypes', 'defaultProps', 'contextType', 'contextTypes',
  'childContextTypes', 'extend', 'withProps', 'classes',
]);

/**
 * Is this value something React can render?
 *
 * A function, or a forwardRef/memo wrapper object. The runtime value is in
 * hand, so there is no reason to guess from a name.
 */
export function isRenderableForTest(value: any): boolean {
  return isRenderable(value);
}

function isRenderable(value: any): boolean {
  if (!value) return false;
  if (typeof value === 'function') return true;
  if (typeof value === 'object') {
    // forwardRef and memo expose $$typeof plus a render/type payload.
    return Boolean(value.$$typeof || value.render || value.type || value.displayName);
  }
  return false;
}

/** Version plus a content fingerprint, for the same reason as propExtractor: version alone never moves for a workspace package. */
function cachePath(projectRoot: string, importPath: string, version: string | undefined, fingerprint: string): string {
  return knowledgeCacheFile(projectRoot, importPath, version, fingerprint, '.json');
}

function locatePackage(req: NodeRequire, importPath: string): { version?: string; root?: string } {
  const pkgName = importPath.startsWith('@')
    ? importPath.split('/').slice(0, 2).join('/')
    : importPath.split('/')[0];

  // Most modern packages declare an `exports` map that deliberately does NOT
  // expose ./package.json — Mantine included, which fails with
  // ERR_PACKAGE_PATH_NOT_EXPORTED. So resolve the main entry and walk up to the
  // package root instead of asking for a path the package refuses to export.
  try {
    let dir = path.dirname(req.resolve(pkgName));
    for (let depth = 0; depth < 8; depth++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (pkg?.name === pkgName) return { version: pkg.version || undefined, root: dir };
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through to the direct lookup below
  }

  // Last resort: the conventional location.
  try {
    const direct = path.join(process.cwd(), 'node_modules', ...pkgName.split('/'), 'package.json');
    if (fs.existsSync(direct)) {
      return { version: JSON.parse(fs.readFileSync(direct, 'utf-8')).version || undefined, root: path.dirname(direct) };
    }
  } catch {
    // give up; the cache simply keys on 'unknown'
  }
  return {};
}

/**
 * Import the design system and reflect on its exports.
 *
 * Cached on disk keyed by package version, because importing a large UI library
 * costs a few hundred milliseconds and the answer only changes when the
 * dependency does.
 */
export async function reflectDesignSystem(
  importPath: string,
  projectRoot: string = process.cwd(),
  options: { framework?: string; force?: boolean } = {},
): Promise<ReflectedKnowledge | null> {
  const { framework = 'react', force = false } = options;

  // Static sub-component properties are a React idiom. Other frameworks would
  // need their own extractor; returning null is more honest than guessing.
  if (!framework.includes('react')) return null;

  const anchor = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(anchor)) return null;
  const req = createRequire(anchor);

  const { version, root } = locatePackage(req, importPath);
  let entryFile: string | null = null;
  try { entryFile = req.resolve(importPath); } catch { /* the import below reports it */ }
  const fingerprint = contentFingerprint({
    root: root ?? projectRoot,
    version,
    entryFile,
    files: () => (root ? listSourceFiles(root) : []),
  });
  const cacheFile = cachePath(projectRoot, importPath, version, fingerprint);

  if (!force && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as ReflectedKnowledge;
      // A record from an older reflector lacks fields this one produces.
      if (cached.schema === REFLECT_SCHEMA) return cached;
    } catch {
      // Corrupt cache — fall through and rebuild.
    }
  }

  let mod: Record<string, any>;
  try {
    // Resolve from the HOST project so we reflect the installed copy.
    const entry = req.resolve(importPath);
    // pathToFileURL rather than string concatenation: `file://${abs}` is
    // malformed on Windows and for paths with spaces or unicode.
    mod = await import(pathToFileURL(entry).href);
  } catch (error) {
    logger.log(`ℹ️ Could not import ${importPath} for reflection: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  /**
   * Unwrap the CJS interop namespace before looking for components.
   *
   * A CommonJS package imported from ESM arrives as `{ __esModule, default }`.
   * Neither key is PascalCase, so filtering the top level returned ZERO exports
   * and zero compound components — silently, for every CJS-published library.
   * Measured: `@fluentui/react-components` has 0 PascalCase keys at the top and
   * 1,209 under `.default`; Material Tailwind, 0 versus 126.
   *
   * Preferring whichever level actually has components, rather than testing for
   * `__esModule`, also covers packages that legitimately export both.
   */
  const pascalCount = (o: any) => {
    try { return Object.keys(o).filter(n => /^[A-Z]/.test(n)).length; } catch { return 0; }
  };
  const inner = (mod as any)?.default;
  const surface: Record<string, any> =
    inner && typeof inner === 'object' && pascalCount(inner) > pascalCount(mod) ? inner : mod;

  const exports = Object.keys(surface).filter(n => /^[A-Z]/.test(n));
  const compound: CompoundComponent[] = [];
  const namespaces: string[] = [];

  for (const name of exports) {
    const value = surface[name];
    if (!value || (typeof value !== 'function' && typeof value !== 'object')) continue;
    let children: string[];
    try {
      children = Object.keys(value).filter(
        k => /^[A-Z]/.test(k) && !NON_COMPONENT_STATICS.has(k) && isRenderable((value as any)[k]),
      );
    } catch {
      continue; // exotic proxy/getter
    }
    if (children.length === 0) continue;

    /**
     * Ask the VALUE whether the parent can render, rather than its name.
     *
     * A namespace object has renderable members and is not itself renderable —
     * Base UI's `Menu` is a plain object, and `<Menu>` throws. Recording that
     * as a third state is what lets the catalog offer `Menu.Root` while
     * refusing `<Menu>`.
     */
    const parentRenderable = isRenderable(value);
    if (!parentRenderable) namespaces.push(name);

    // The library's own name for each part, which is not parent+child.
    const childRuntimeNames: Record<string, string> = {};
    for (const k of children) {
      const child = (value as any)[k];
      const runtime = child?.displayName
        || (typeof child === 'function' ? child.name : undefined)
        || child?.render?.displayName
        || child?.type?.displayName;
      if (runtime && typeof runtime === 'string') childRuntimeNames[k] = runtime;
    }

    compound.push({ name, children, parentRenderable, childRuntimeNames });
  }

  const knowledge: ReflectedKnowledge = {
    schema: REFLECT_SCHEMA,
    importPath,
    version,
    exports,
    compound,
    namespaces,
    reflectedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(knowledge, null, 2), 'utf-8');
    pruneStaleKnowledge(projectRoot, importPath, cacheFile, '.json');
  } catch {
    // Cache is an optimisation; a read-only project is fine.
  }

  logger.log(
    `🧠 Reflected ${importPath}${version ? `@${version}` : ''}: ` +
    `${exports.length} exports, ${compound.length} compound` +
    (namespaces.length ? `, ${namespaces.length} namespace-only (not renderable on their own)` : '') +
    (surface !== mod ? ' [read through the CJS default export]' : '') +
    // Zero exports after a SUCCESSFUL import is a real signal, not a non-event:
    // it means the package resolved, loaded, and exposed nothing we recognise.
    (exports.length === 0 ? ' — imported successfully but exposed no PascalCase exports' : ''),
  );
  return knowledge;
}

/**
 * Render compound structure for the prompt.
 *
 * Kept compact deliberately — this competes for space with the component
 * catalog, and the goal is to convey composition shape, not documentation.
 */
export function formatCompoundReference(knowledge: ReflectedKnowledge): string {
  if (knowledge.compound.length === 0) return '';

  const lines = knowledge.compound
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `- ${c.name}: ${c.children.map(k => `${c.name}.${k}`).join(', ')}`);

  return [
    '# Compound components (verified against the installed package)',
    '',
    'These are sub-components, not separate imports. The available-components list',
    'shows them as flat names; import ONLY the parent and use dot notation.',
    '',
    ...lines,
  ].join('\n');
}
