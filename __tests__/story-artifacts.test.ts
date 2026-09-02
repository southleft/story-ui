import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  writeStoryArtifacts,
  removeStoryArtifacts,
  sweepOrphanedArtifacts,
  stylesheetNameFor,
  storyBaseName,
  extractStylesheet,
  isGeneratedStylesheet,
  rewriteStylesheetImport,
  GENERATED_CSS_MARKER,
  CSS_IMPORT_PLACEHOLDER,
} from '../story-generator/storyArtifacts.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sui-artifacts-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const STORY = 'pricing-card-a1b2.stories.tsx';

describe('naming', () => {
  it('derives the base name across story extensions', () => {
    expect(storyBaseName('x.stories.tsx')).toBe('x');
    expect(storyBaseName('x.stories.ts')).toBe('x');
    expect(storyBaseName('x.stories.svelte')).toBe('x');
  });

  it('pairs a stylesheet with its story deterministically', () => {
    expect(stylesheetNameFor(STORY)).toBe('pricing-card-a1b2.module.css');
  });
});

describe('writeStoryArtifacts', () => {
  it('writes the story alone when there is no stylesheet', () => {
    const { storyPath, stylesheetPath } = writeStoryArtifacts({ dir, fileName: STORY, code: 'export const x = 1;' });
    expect(fs.existsSync(storyPath)).toBe(true);
    expect(stylesheetPath).toBeUndefined();
  });

  it('rewrites the placeholder import to the real sibling', () => {
    // The model cannot know the hashed filename, so it always writes the
    // placeholder and we point it at the real file here.
    const code = `import classes from '${CSS_IMPORT_PLACEHOLDER}';\nexport const x = 1;`;
    const { storyPath, stylesheetPath } = writeStoryArtifacts({
      dir, fileName: STORY, code, css: '.root { color: red; }',
    });
    const written = fs.readFileSync(storyPath, 'utf-8');
    expect(written).toContain("'./pricing-card-a1b2.module.css'");
    expect(written).not.toContain(CSS_IMPORT_PLACEHOLDER);
    expect(fs.existsSync(stylesheetPath!)).toBe(true);
  });

  it('marks generated stylesheets so a sweep can identify them', () => {
    const { stylesheetPath } = writeStoryArtifacts({
      dir, fileName: STORY, code: `import c from '${CSS_IMPORT_PLACEHOLDER}';`, css: '.a{}',
    });
    expect(fs.readFileSync(stylesheetPath!, 'utf-8').startsWith(GENERATED_CSS_MARKER)).toBe(true);
  });

  it('drops a stale stylesheet when a regeneration no longer needs one', () => {
    writeStoryArtifacts({ dir, fileName: STORY, code: `import c from '${CSS_IMPORT_PLACEHOLDER}';`, css: '.a{}' });
    const cssPath = path.join(dir, stylesheetNameFor(STORY));
    expect(fs.existsSync(cssPath)).toBe(true);

    writeStoryArtifacts({ dir, fileName: STORY, code: 'export const x = 1;' });
    // Otherwise the story would keep an import resolving to dead rules.
    expect(fs.existsSync(cssPath)).toBe(false);
  });
});

describe('deletion safety', () => {
  it('removes the sibling stylesheet with the story', () => {
    writeStoryArtifacts({ dir, fileName: STORY, code: `import c from '${CSS_IMPORT_PLACEHOLDER}';`, css: '.a{}' });
    const storyPath = path.join(dir, STORY);
    fs.unlinkSync(storyPath);
    removeStoryArtifacts(storyPath);
    expect(fs.existsSync(path.join(dir, stylesheetNameFor(STORY)))).toBe(false);
  });

  it('sweeps orphans left by delete paths that know nothing about stylesheets', () => {
    // This is the real guarantee: nineteen call sites remove story files and
    // none of them were taught about siblings.
    writeStoryArtifacts({ dir, fileName: STORY, code: `import c from '${CSS_IMPORT_PLACEHOLDER}';`, css: '.a{}' });
    fs.unlinkSync(path.join(dir, STORY));
    expect(sweepOrphanedArtifacts(dir)).toBe(1);
    expect(fs.existsSync(path.join(dir, stylesheetNameFor(STORY)))).toBe(false);
  });

  it('never deletes a hand-written stylesheet', () => {
    const handWritten = path.join(dir, 'theme.module.css');
    fs.writeFileSync(handWritten, '.brand { color: rebeccapurple; }');
    expect(isGeneratedStylesheet(handWritten)).toBe(false);
    expect(sweepOrphanedArtifacts(dir)).toBe(0);
    expect(fs.existsSync(handWritten)).toBe(true);
  });

  it('leaves stylesheets whose story still exists', () => {
    writeStoryArtifacts({ dir, fileName: STORY, code: `import c from '${CSS_IMPORT_PLACEHOLDER}';`, css: '.a{}' });
    expect(sweepOrphanedArtifacts(dir)).toBe(0);
    expect(fs.existsSync(path.join(dir, stylesheetNameFor(STORY)))).toBe(true);
  });
});

describe('rewriteStylesheetImport', () => {
  const TARGET = './pricing-card-a1b2.module.css';

  it('rewrites a default import', () => {
    const out = rewriteStylesheetImport(`import classes from '${CSS_IMPORT_PLACEHOLDER}';`, TARGET);
    expect(out).toBe(`import classes from '${TARGET}';`);
  });

  it('rewrites a side-effect import and double quotes', () => {
    expect(rewriteStylesheetImport(`import "${CSS_IMPORT_PLACEHOLDER}";`, TARGET)).toContain(TARGET);
  });

  it('rewrites require()', () => {
    expect(rewriteStylesheetImport(`const c = require('${CSS_IMPORT_PLACEHOLDER}');`, TARGET)).toContain(TARGET);
  });

  it('leaves the same string alone when it is story content, not an import', () => {
    // A generated file browser legitimately listed 'styles.module.css' as sample
    // data; a blind global replace would have rewritten the user's content.
    const code = [
      `import classes from '${CSS_IMPORT_PLACEHOLDER}';`,
      `const files = [{ name: '${CSS_IMPORT_PLACEHOLDER}', type: 'css' }];`,
    ].join('\n');
    const out = rewriteStylesheetImport(code, TARGET);
    expect(out).toContain(`import classes from '${TARGET}';`);
    expect(out).toContain(`{ name: '${CSS_IMPORT_PLACEHOLDER}', type: 'css' }`);
  });

  it('is a no-op when the placeholder is absent', () => {
    const code = `import x from './other.css';`;
    expect(rewriteStylesheetImport(code, TARGET)).toBe(code);
  });
});

describe('extractStylesheet', () => {
  const withImport = `import classes from '${CSS_IMPORT_PLACEHOLDER}';`;

  it('extracts a css block when the story imports one', () => {
    const response = 'text\n```tsx\ncode\n```\n```css\n.root { color: red; }\n```';
    expect(extractStylesheet(response, withImport)).toBe('.root { color: red; }');
  });

  it('ignores a css block the story never imports', () => {
    const response = '```css\n.root { color: red; }\n```';
    expect(extractStylesheet(response, 'export const x = 1;')).toBeNull();
  });

  it('returns null when there is no css block', () => {
    expect(extractStylesheet('```tsx\ncode\n```', withImport)).toBeNull();
  });

  it('ignores an empty css block', () => {
    expect(extractStylesheet('```css\n\n```', withImport)).toBeNull();
  });
});
