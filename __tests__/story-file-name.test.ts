/**
 * A client-supplied story file name must be a bare name in the generated
 * directory. The generation routes were the one write path that took the name
 * straight to path.join.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSafeStoryFileName, writeStoryArtifacts, UnsafeStoryFileNameError } from '../story-generator/storyArtifacts.js';

describe('isSafeStoryFileName', () => {
  it('accepts the names the pipeline itself produces', () => {
    expect(isSafeStoryFileName('pricing-plans-88ce9386.stories.tsx')).toBe(true);
    expect(isSafeStoryFileName('Card.stories.vue')).toBe(true);
    expect(isSafeStoryFileName('hero_1.stories.svelte')).toBe(true);
    // A bare stem is allowed; the pipeline appends the framework extension.
    expect(isSafeStoryFileName('pricing-plans-88ce9386')).toBe(true);
  });

  it('rejects anything that could leave the generated directory', () => {
    for (const bad of [
      '../../.storybook/preview.tsx',
      '../x.stories.tsx',
      'sub/dir.stories.tsx',
      '..\\x.stories.tsx',
      '/etc/passwd',
      '.env',
      'x.stories.tsx\0.txt',
      '',
      undefined,
      null,
      42,
    ]) {
      expect(isSafeStoryFileName(bad), String(bad)).toBe(false);
    }
  });

  it('rejects non-story extensions even inside the directory', () => {
    expect(isSafeStoryFileName('preview.tsx')).toBe(false);
    expect(isSafeStoryFileName('main.ts')).toBe(false);
    expect(isSafeStoryFileName('notes.md')).toBe(false);
  });
});

describe('writeStoryArtifacts', () => {
  it('refuses to write an unsafe name even if a caller forgot to check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sui-write-'));
    expect(() =>
      writeStoryArtifacts({ dir, fileName: '../escaped.stories.tsx', code: 'export default {};' }),
    ).toThrow(UnsafeStoryFileNameError);
    expect(fs.existsSync(path.join(dir, '..', 'escaped.stories.tsx'))).toBe(false);
  });
});
