/**
 * An internal design system in a monorepo — the shape most organisations ship.
 *
 * Measured before these fixes, on real npm-workspace and pnpm-style fixtures:
 * ZERO components. Not degraded — invisible. Three independent defects, each
 * individually fatal, so fixing any one alone still produced nothing usable.
 *
 *   1. the package directory was a literal path.join under the project's own
 *      node_modules, which is a guess about layout rather than a resolution
 *   2. `export * from './Button'` was not followed, so a package that WAS found
 *      and opened reported empty
 *   3. only `.d.ts` counted as declaration-bearing, so a source-only package
 *      consumed without a build step yielded no props at all
 *
 * The two workspace layouts fail the first check through OPPOSITE doors, which
 * is why neither existsSync nor require.resolve is sufficient on its own:
 *
 *   npm workspaces, symlink hoisted to the repo root
 *     existsSync(app/node_modules/@acme/ui) = false   require.resolve = OK
 *   pnpm-style, symlink local to the consuming app
 *     existsSync(app/node_modules/@acme/ui) = true    require.resolve = MODULE_NOT_FOUND
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { packageDirFor, packageNameOf } from '../story-generator/knowledge/packageLocator.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-'));
  roots.push(root);
  return root;
}

function writePkg(dir: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
}

describe('locating a workspace package', () => {
  it('finds a symlink HOISTED to the repo root (npm workspaces)', () => {
    const root = scratch();
    const app = path.join(root, 'apps', 'storybook');
    writePkg(app, { name: 'app' });
    writePkg(path.join(root, 'packages', 'ui'), { name: '@acme/ui', version: '1.0.0' });
    fs.mkdirSync(path.join(root, 'node_modules', '@acme'), { recursive: true });
    fs.symlinkSync(path.join(root, 'packages', 'ui'), path.join(root, 'node_modules', '@acme', 'ui'));
    writePkg(root, { name: 'monorepo' });

    // The literal guess the old code made — nothing there.
    expect(fs.existsSync(path.join(app, 'node_modules', '@acme', 'ui'))).toBe(false);
    // Walking the chain finds it.
    expect(packageDirFor(app, '@acme/ui')).not.toBeNull();
  });

  it('finds a symlink LOCAL to the consuming app (pnpm-style)', () => {
    const root = scratch();
    const app = path.join(root, 'apps', 'storybook');
    writePkg(app, { name: 'app' });
    writePkg(path.join(root, 'packages', 'ui'), { name: '@acme/ui', version: '1.0.0' });
    fs.mkdirSync(path.join(app, 'node_modules', '@acme'), { recursive: true });
    fs.symlinkSync(path.join(root, 'packages', 'ui'), path.join(app, 'node_modules', '@acme', 'ui'));

    expect(packageDirFor(app, '@acme/ui')).not.toBeNull();
  });

  it('finds a package whose manifest declares no entry point at all', () => {
    // A source-only workspace package often has only name/version/type.
    const root = scratch();
    const app = path.join(root, 'app');
    writePkg(app, { name: 'app' });
    fs.mkdirSync(path.join(app, 'node_modules', '@acme'), { recursive: true });
    writePkg(path.join(app, 'node_modules', '@acme', 'ui'), { name: '@acme/ui', version: '1.0.0', type: 'module' });

    expect(packageDirFor(app, '@acme/ui')).not.toBeNull();
  });

  it('returns null for a package that is genuinely not installed', () => {
    const root = scratch();
    writePkg(root, { name: 'app' });
    expect(packageDirFor(root, '@acme/nope')).toBeNull();
  });

  it('reduces a subpath specifier to its package', () => {
    expect(packageNameOf('@fluentui/react-components/unstable')).toBe('@fluentui/react-components');
    expect(packageNameOf('vuetify/components')).toBe('vuetify');
    expect(packageNameOf('@atlaskit')).toBe('@atlaskit');
  });

  it('does not follow a dangling symlink', () => {
    const root = scratch();
    const app = path.join(root, 'app');
    writePkg(app, { name: 'app' });
    fs.mkdirSync(path.join(app, 'node_modules', '@acme'), { recursive: true });
    fs.symlinkSync(path.join(root, 'does-not-exist'), path.join(app, 'node_modules', '@acme', 'ui'));
    expect(packageDirFor(app, '@acme/ui')).toBeNull();
  });
});
