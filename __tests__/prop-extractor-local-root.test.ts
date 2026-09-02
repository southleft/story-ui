/**
 * A path given as the "package" is local source, never node_modules.
 *
 * `'/abs/src/components'.split('/')[0]` is the empty string, and
 * `path.join(projectRoot, 'node_modules', '')` is node_modules itself — so the
 * extractor walked every installed package, reported 609 "components"
 * including Storybook's template Button, and wrote a 175KB cache. Each test
 * here pins one way a project names its own source.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractProps } from '../story-generator/knowledge/propExtractor.js';

let root: string;
const write = (rel: string, text: string) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'prop-extractor-local-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@acme/ui', version: '0.1.0' }));
  fs.writeFileSync(path.join(root, 'story-ui.config.js'), `module.exports = {
  generatedStoriesPath: './src/stories/generated',
  importPath: '../../components',
  componentsPath: './src/components',
};`);
  write('src/components/Button/Button.tsx', `
import * as React from 'react';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** @default 'primary' */
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
}
/** The primary action control. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  return <button ref={ref} {...props} />;
});
`);
  write('src/stories/generated/.keep', '');
  // Installed code that must never be read as the project's design system.
  write('node_modules/some-lib/Junk.tsx', `
export interface JunkProps { junk?: boolean }
export function Junk(props: JunkProps) { return null; }
`);
  write('node_modules/some-lib/package.json', JSON.stringify({ name: 'some-lib', version: '1.0.0', types: 'Junk.tsx' }));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('extractProps on local source', () => {
  it('reads an absolute directory with the AST, and never node_modules', async () => {
    const out = await extractProps(path.join(root, 'src/components'), root, { force: true });
    expect(out).not.toBeNull();
    expect(out!.source).toBe('local');
    expect(Object.keys(out!.components)).toEqual(['Button']);
    expect(out!.components.Junk).toBeUndefined();
    const variant = out!.components.Button.props.find(p => p.name === 'variant')!;
    expect(variant.options).toEqual(['primary', 'secondary']);
    expect(variant.defaultValue).toBe("'primary'");
    expect(out!.components.Button.doc).toBe('The primary action control.');
  });

  it('writes a small cache under .story-ui/knowledge, not a dump of node_modules', async () => {
    await extractProps(path.join(root, 'src/components'), root, { force: true });
    const dir = path.join(root, '.story-ui', 'knowledge');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.props.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(text.length).toBeLessThan(20_000);
      expect(text).not.toContain('Junk');
    }
  });

  it('resolves a relative importPath against the generated stories directory', async () => {
    const out = await extractProps('../../components', root, { force: true });
    expect(out?.source).toBe('local');
    expect(out?.root).toBe(path.join(root, 'src/components'));
    expect(Object.keys(out!.components)).toEqual(['Button']);
  });

  it("reads the project's own source when importPath is its own package name", async () => {
    const out = await extractProps('@acme/ui', root, { force: true });
    expect(out?.source).toBe('local');
    expect(out?.root).toBe(path.join(root, 'src'));
    expect(Object.keys(out!.components)).toEqual(['Button']);
  });

  it('falls back to the configured componentsPath for the init placeholder', async () => {
    const out = await extractProps('your-component-library', root, { force: true });
    expect(out?.source).toBe('local');
    expect(out?.root).toBe(path.join(root, 'src/components'));
  });

  it('returns null for a path that is not on disk rather than guessing', async () => {
    expect(await extractProps('/definitely/not/here', root, { force: true })).toBeNull();
    expect(await extractProps('./nowhere', root, { force: true })).toBeNull();
  });

  it('still reads an installed package by name', async () => {
    const out = await extractProps('some-lib', root, { force: true });
    expect(out?.source).toBeUndefined();
    expect(out?.components.Junk?.props.map(p => p.name)).toEqual(['junk']);
  });
});
