/**
 * Where a component is imported from, by the project's own account.
 *
 * One rule, shared by everything that writes an import line: the prompt's
 * component catalog, the story pipeline's repairs, and the Voice Canvas save
 * (which for a long time imported every capitalised JSX tag from
 * `config.importPath` without asking — a canvas that used a component of a
 * local design system saved as a story whose import did not resolve).
 *
 * Precedence, most authoritative first:
 *   1. `config.components[].importPath` — the project wrote it down.
 *   2. `__componentPath` — discovery recorded a subpath or a declared module.
 *   3. a local source file — the real relative path from the generated dir.
 *   4. the npm package discovery found it in, when that is not the base path.
 *   5. `config.importPath`, and a note when the style says paths are per file.
 */

import * as fs from 'fs';
import * as nodePath from 'path';
import type { StoryUIConfig } from '../../story-ui.config.js';
import type { DiscoveredComponent } from '../componentDiscovery.js';

/**
 * The relative import path for a component discovered from local source
 * (custom, non-npm component libraries). Null for npm package components.
 */
export function localImportSpecifier(
  component: DiscoveredComponent,
  config: StoryUIConfig,
): string | null {
  const filePath = component.filePath;
  if (!filePath || filePath.includes('node_modules')) return null;
  if (!nodePath.isAbsolute(filePath) || !fs.existsSync(filePath)) return null;

  const generatedDir = nodePath.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated/');
  let relative = nodePath.relative(generatedDir, filePath).split(nodePath.sep).join('/');
  relative = relative.replace(/\.(tsx|jsx|ts|js|vue|svelte)$/, '');
  if (!relative.startsWith('.')) relative = './' + relative;
  return relative;
}

/** The module a story should import `component` from. */
export function importSpecifierFor(
  component: DiscoveredComponent,
  config: StoryUIConfig,
): string {
  // What the PROJECT says, before anything we infer.
  //
  // story-ui.config.js can declare each component with its real import
  // specifier, and college-town does exactly that for 22 components —
  // `CardHeader -> '@/components/card/card'` — under a comment reading
  // "REQUIRED for proper story generation". Nothing read it. The convention
  // guess below produced `@/components/card-header` instead, which is not a
  // module, so 41% of that project's generated imports 404'd and roughly
  // three quarters of its stories rendered blank.
  //
  // A declared path is a fact about the codebase. An inferred one is a guess
  // about its conventions. The fact wins.
  const declared = (config.components || []).find(c => c.name === component.name);
  if (declared?.importPath) {
    return declared.importPath;
  }

  if (component.__componentPath) {
    return component.__componentPath;
  }

  // Custom in-project components (discovered from local source files, not an
  // npm package) must be imported via their real relative path from the
  // generated-stories directory — never via the library import path.
  const localPath = localImportSpecifier(component, config);
  if (localPath) {
    return localPath;
  }

  /**
   * The package a component was actually discovered in.
   *
   * For a per-component-package design system the kebab guess below invented
   * a package: `Layer`, re-exported from @atlaskit/popper, became
   * `@atlaskit/layer`, which is not installed. Discovery already recorded
   * where it found the component, and that is the answer.
   */
  const discoveredIn = (component as any).source;
  if (discoveredIn?.type === 'npm' && discoveredIn.path && discoveredIn.path !== config.importPath) {
    return discoveredIn.path;
  }

  const basePath = config.importPath || 'unknown';

  /**
   * No formula. This used to kebab-case the component name onto the base
   * path for `importStyle: 'individual'` (`AlertDialog` → `alert-dialog`),
   * which is one library's convention and wrong for the next. Every
   * individual-import library this tool has met declares its paths: in
   * `config.components[].importPath`, in discovery's `source.path`, or as a
   * local file the relative-path branch above already resolved. When none
   * of those exist the honest answer is the base path with a note, not a
   * guess that fails at build time.
   */
  if (config.importStyle === 'individual') {
    (component as any).__importPathUnknown = true;
  }
  return basePath;
}

export interface ImportHome {
  specifier: string;
  defaultExport: boolean;
}

/**
 * A lookup from component name to import home, for code that writes import
 * lines without the model: one entry per discovered component.
 */
export function importHomeResolver(
  components: DiscoveredComponent[],
  config: StoryUIConfig,
): (name: string) => ImportHome | undefined {
  const byName = new Map(components.map(c => [c.name, c] as const));
  return (name: string) => {
    const component = byName.get(name);
    if (!component) return undefined;
    return {
      specifier: importSpecifierFor(component, config),
      defaultExport: (component as any).__defaultExport === true,
    };
  };
}
