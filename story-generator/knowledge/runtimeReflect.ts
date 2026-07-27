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

export interface CompoundComponent {
  /** Parent export name, e.g. "Menu". */
  name: string;
  /** Sub-component names, e.g. ["Target", "Dropdown", "Item"]. */
  children: string[];
}

export interface ReflectedKnowledge {
  importPath: string;
  version?: string;
  /** Every PascalCase export, so we can tell a real component from a guess. */
  exports: string[];
  compound: CompoundComponent[];
  reflectedAt: string;
}

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

function cachePath(projectRoot: string, importPath: string, version?: string): string {
  const safe = importPath.replace(/[^a-z0-9]+/gi, '-');
  return path.join(projectRoot, '.story-ui', 'knowledge', `${safe}@${version || 'unknown'}.json`);
}

function readPackageVersion(req: NodeRequire, importPath: string): string | undefined {
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
        if (pkg?.name === pkgName && pkg.version) return pkg.version;
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
      return JSON.parse(fs.readFileSync(direct, 'utf-8')).version;
    }
  } catch {
    // give up; the cache simply keys on 'unknown'
  }
  return undefined;
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

  const version = readPackageVersion(req, importPath);
  const cacheFile = cachePath(projectRoot, importPath, version);

  if (!force && fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as ReflectedKnowledge;
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

  const exports = Object.keys(mod).filter(n => /^[A-Z]/.test(n));
  const compound: CompoundComponent[] = [];

  for (const name of exports) {
    const value = mod[name];
    if (!value || (typeof value !== 'function' && typeof value !== 'object')) continue;
    let children: string[];
    try {
      children = Object.keys(value).filter(
        k => /^[A-Z]/.test(k) && !NON_COMPONENT_STATICS.has(k) && isRenderable((value as any)[k]),
      );
    } catch {
      continue; // exotic proxy/getter
    }
    if (children.length > 0) compound.push({ name, children });
  }

  const knowledge: ReflectedKnowledge = {
    importPath,
    version,
    exports,
    compound,
    reflectedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(knowledge, null, 2), 'utf-8');
  } catch {
    // Cache is an optimisation; a read-only project is fine.
  }

  logger.log(
    `🧠 Reflected ${importPath}${version ? `@${version}` : ''}: ` +
    `${exports.length} exports, ${compound.length} compound components`,
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
