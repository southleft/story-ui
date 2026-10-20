/**
 * A `module.exports` config in a `"type": "module"` project. Node 22+
 * require()s it as ESM and returns an empty namespace instead of throwing, so
 * the loader used the default config — importPath "your-component-library" —
 * and generation failed validation with the user's real config on disk.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Vitest's own require throws on this file, which hides the bug; plain Node
// returns the empty namespace, so the test reproduces Node.
vi.mock('module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('module')>();
  const createRequire = (from: string | URL) => {
    const real = actual.createRequire(from);
    const fake = ((id: string) => (id.endsWith('story-ui.config.js') ? {} : real(id))) as NodeJS.Require;
    return Object.assign(fake, { cache: real.cache, resolve: real.resolve });
  };
  return { ...actual, default: { ...actual, createRequire }, createRequire };
});

const { loadUserConfig } = await import('../story-generator/configLoader.js');

let root: string;
let prevCwd: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-esm-config-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' }));
  fs.mkdirSync(path.join(root, 'src/components'), { recursive: true });
  fs.writeFileSync(path.join(root, 'story-ui.config.js'),
    `module.exports = {\n  "importPath": "../../components",\n  "componentsPath": "./src/components",\n  "importStyle": "individual"\n};\n`);
  prevCwd = process.cwd();
  process.chdir(root);
});

afterAll(() => {
  process.chdir(prevCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('loadUserConfig in a "type": "module" project', () => {
  it('reads the module.exports object instead of falling back to defaults', () => {
    const config = loadUserConfig();
    expect(config.importPath).toBe('../../components');
    expect(config.componentsPath).toBe(path.join(fs.realpathSync(root), 'src/components'));
  });
});
