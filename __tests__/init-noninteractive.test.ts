/**
 * An agent running init has no terminal. A prompt there hangs forever with
 * nothing on screen, so no-TTY, CI and an explicit env var all mean "answer
 * from flags and detection".
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isNonInteractive, detectLocalComponentLibrary } from '../cli/setup.js';

describe('isNonInteractive', () => {
  it('is interactive only with a TTY and no flags', () => {
    expect(isNonInteractive({}, {}, true)).toBe(false);
    expect(isNonInteractive({}, {}, false)).toBe(true);
    expect(isNonInteractive({}, { CI: 'true' }, true)).toBe(true);
    expect(isNonInteractive({}, { STORY_UI_NONINTERACTIVE: 'true' }, true)).toBe(true);
    expect(isNonInteractive({ yes: true }, {}, true)).toBe(true);
    expect(isNonInteractive({ designSystem: 'mantine' }, {}, true)).toBe(true);
  });
});

describe('detectLocalComponentLibrary', () => {
  it('finds the directory with component files and derives the import path from the stories directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sui-local-'));
    fs.mkdirSync(path.join(root, 'src/components/Button'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/components/Button/Button.tsx'), 'export const Button = () => null;');
    fs.writeFileSync(path.join(root, 'src/components/Button/Button.stories.tsx'), '');
    fs.mkdirSync(path.join(root, 'src/components/Alert'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/components/Alert/Alert.tsx'), 'export const Alert = () => null;');
    const found = detectLocalComponentLibrary(root, './src/stories/generated/');
    expect(found).toEqual({ componentsPath: './src/components', importPath: '../../components', count: 2 });
  });

  it('returns null when nothing looks like a component library', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sui-none-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    expect(detectLocalComponentLibrary(root, './src/stories/generated/')).toBeNull();
  });
});
