/**
 * The viteFinal that `init` emits must keep the V2 workspace mountable.
 *
 * Excluding '@tpitre/story-ui' from optimizeDeps makes Vite serve its ESM —
 * and everything it imports — unbundled, and the optimizer never scans inside
 * an excluded package. '@radix-ui/themes' imports CJS-only 'classnames', so
 * without the '>' chain include the browser receives raw CommonJS and the
 * workspace fails to mount with "does not provide an export named 'default'"
 * (reproduced deterministically on react-mantine). These pin the emitted
 * config, and the warning for user-authored viteFinals init must not rewrite.
 */
import { describe, it, expect } from 'vitest';
import {
  STORY_UI_VITE_CJS_INCLUDES,
  viteFinalConfigSnippet,
  missingViteCjsIncludes,
} from '../cli/setup.js';

const wrap = (body: string) => `const config = {\n  stories: ['../src/**/*.mdx'],\n  ${body}\n};\nexport default config;`;

/** The exact shape init used to emit — exclude only, the broken config. */
const LEGACY_VITE_FINAL = wrap(`viteFinal: async (config) => {
    config.optimizeDeps = {
      ...config.optimizeDeps,
      exclude: [
        ...(config.optimizeDeps?.exclude || []),
        '@tpitre/story-ui'
      ]
    };
    return config;
  },`);

describe('viteFinalConfigSnippet', () => {
  it('excludes the package AND pre-bundles its CJS-only transitive deps', () => {
    const snippet = viteFinalConfigSnippet();
    expect(snippet).toContain(`'@tpitre/story-ui'`);
    expect(snippet).toContain('exclude: [');
    expect(snippet).toContain('include: [');
    for (const chain of STORY_UI_VITE_CJS_INCLUDES) {
      expect(snippet).toContain(`'${chain}'`);
    }
    // The known chain is present verbatim — the one that fixed react-mantine.
    expect(STORY_UI_VITE_CJS_INCLUDES).toContain('@tpitre/story-ui > @radix-ui/themes > classnames');
  });

  it('says WHY, in the emitted file itself', () => {
    // The comment is the difference between a future maintainer keeping the
    // include and deleting it as cruft.
    expect(viteFinalConfigSnippet()).toMatch(/does not provide an export named/);
  });

  it('is self-consistent: a config built from the snippet needs no warning', () => {
    expect(missingViteCjsIncludes(wrap(viteFinalConfigSnippet()))).toEqual([]);
  });
});

describe('missingViteCjsIncludes', () => {
  it('names every missing chain for the legacy exclude-only viteFinal', () => {
    expect(missingViteCjsIncludes(LEGACY_VITE_FINAL)).toEqual(STORY_UI_VITE_CJS_INCLUDES);
  });

  it('is empty when the chains are already present', () => {
    const fixed = LEGACY_VITE_FINAL.replace(
      `'@tpitre/story-ui'\n      ]`,
      `'@tpitre/story-ui'\n      ],\n      include: [${STORY_UI_VITE_CJS_INCLUDES.map(c => `'${c}'`).join(', ')}]`,
    );
    expect(missingViteCjsIncludes(fixed)).toEqual([]);
  });

  it('is empty when the config never excludes @tpitre/story-ui', () => {
    const noExclude = wrap(`viteFinal: async (config) => {\n    return config;\n  },`);
    expect(missingViteCjsIncludes(noExclude)).toEqual([]);
  });

  it('ignores mentions of the package outside an optimizeDeps exclude', () => {
    const unrelated = `import { something } from '@tpitre/story-ui';\n` +
      wrap(`viteFinal: async (config) => {\n    config.optimizeDeps = { ...config.optimizeDeps, include: ['lodash'] };\n    return config;\n  },`);
    expect(missingViteCjsIncludes(unrelated)).toEqual([]);
  });

  it('catches a hand-written direct exclude too', () => {
    const direct = wrap(`viteFinal: async (config) => {
    config.optimizeDeps = { exclude: ['@tpitre/story-ui'] };
    return config;
  },`);
    expect(missingViteCjsIncludes(direct)).toEqual(STORY_UI_VITE_CJS_INCLUDES);
  });
});
