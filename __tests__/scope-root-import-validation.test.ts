/**
 * A bare scope is not an importable package, so nothing "deeper" than it is a
 * mistake.
 *
 * Atlassian ships one package per component, so its config names the scope
 * (`@atlaskit`) because there is no single path to point at. Correct generated
 * code imports `@atlaskit/primitives` — which starts with `@atlaskit/`, and so
 * tripped a check written for Vuetify-style deep-path errors
 * (`vuetify/components/lib/components/VAlert`).
 *
 * The advice it emitted was the damaging part: "import from '@atlaskit'" names
 * a package that cannot resolve. The pipeline runs splitScopeImports elsewhere
 * specifically to REPAIR that spelling, so two parts of the engine were
 * demanding opposite things — the same shape as the fabricated-path bug where
 * correct imports were rewritten into packages that do not exist.
 *
 * Observed on a real generation: correct code, reported as an import error.
 */

import { describe, it, expect } from 'vitest';
import { validateStoryCode } from '../story-generator/validateStory.js';

const story = (importLine: string) => [
  `import React from 'react';`,
  `import type { Meta, StoryObj } from '@storybook/react-vite';`,
  importLine,
  `const meta: Meta = { title: 'Generated/T', component: () => null };`,
  `export default meta;`,
  `export const Default: StoryObj = { render: () => <Box /> };`,
].join('\n');

const importErrors = (code: string, config: any) =>
  validateStoryCode(code, 'story.tsx', config).errors.filter(e => /Import path error/.test(e));

describe('deep-path import check against a scope-root config', () => {
  const atlassian = { importPath: '@atlaskit', componentFramework: 'react', importStyle: 'individual' };

  it('accepts a real package under the configured scope', () => {
    const errs = importErrors(story(`import { Box } from '@atlaskit/primitives';`), atlassian);
    expect(errs).toEqual([]);
  });

  it('accepts a subpath export under that scope', () => {
    const errs = importErrors(story(`import Button from '@atlaskit/button/new';`), atlassian);
    expect(errs).toEqual([]);
  });

  it('never advises importing from the bare scope', () => {
    const all = validateStoryCode(story(`import { Box } from '@atlaskit/primitives';`), 'story.tsx', atlassian);
    // The advice itself is what caused damage — assert it is absent whatever
    // else the validator decides to say.
    expect(all.errors.join('\n')).not.toContain(`from '@atlaskit'`);
  });
});

describe('the deep-path check still works where the configured path is a real package', () => {
  const vuetify = { importPath: 'vuetify/components', componentFramework: 'react' };

  it('still catches a genuinely wrong deep path', () => {
    const errs = importErrors(
      story(`import { VAlert } from 'vuetify/components/lib/components/VAlert';`),
      vuetify,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('vuetify/components');
  });

  it('accepts the configured path itself', () => {
    const errs = importErrors(story(`import { VAlert } from 'vuetify/components';`), vuetify);
    expect(errs).toEqual([]);
  });

  it('a scoped package that is NOT a bare scope keeps the check', () => {
    // `@mantine/core` is importable, so a deeper path under it is still an error.
    const mantine = { importPath: '@mantine/core', componentFramework: 'react' };
    const errs = importErrors(story(`import { Button } from '@mantine/core/lib/Button';`), mantine);
    expect(errs.length).toBeGreaterThan(0);
  });
});
