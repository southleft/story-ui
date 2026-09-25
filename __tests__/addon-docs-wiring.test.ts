import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureAddonDocsRegistered, missingAddonDocs } from '../cli/setup.js';

function project(main: string | null, deps: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'addon-docs-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', devDependencies: deps }));
  if (main !== null) {
    fs.mkdirSync(path.join(dir, '.storybook'));
    fs.writeFileSync(path.join(dir, '.storybook', 'main.ts'), main);
  }
  return dir;
}

describe('addon-docs wiring (the panel entry is MDX)', () => {
  it('registers addon-docs in an empty addons array', () => {
    const dir = project(`export default {\n  "addons": [],\n  framework: { name: '@storybook/react-vite' },\n};\n`);
    expect(ensureAddonDocsRegistered(dir)).toBe(true);
    expect(fs.readFileSync(path.join(dir, '.storybook', 'main.ts'), 'utf8')).toContain(`"addons": ['@storybook/addon-docs'],`);
  });

  it('prepends to a non-empty addons array', () => {
    const dir = project(`export default {\n  addons: [\n    '@storybook/addon-a11y',\n  ],\n};\n`);
    expect(ensureAddonDocsRegistered(dir)).toBe(true);
    expect(fs.readFileSync(path.join(dir, '.storybook', 'main.ts'), 'utf8')).toContain(`addons: ['@storybook/addon-docs',\n    '@storybook/addon-a11y',`);
  });

  it('leaves a config that already has it, or has essentials, alone', () => {
    expect(ensureAddonDocsRegistered(project(`export default { addons: ['@storybook/addon-docs'] };`))).toBe(false);
    expect(ensureAddonDocsRegistered(project(`export default { addons: ['@storybook/addon-essentials'] };`))).toBe(false);
    expect(ensureAddonDocsRegistered(project(null))).toBe(false);
  });

  it('asks for addon-docs only when it is neither declared nor installed', () => {
    expect(missingAddonDocs(project(null, { '@storybook/addon-docs': '^9.1.3' }), { '@storybook/addon-docs': '^9.1.3' })).toBeNull();
    const missing = missingAddonDocs(project(null), {});
    expect(missing?.name).toBe('@storybook/addon-docs');
  });
});
