import { describe, it, expect } from 'vitest';
import { alignStorybookTypesImport } from '../mcp-server/routes/generationCore.js';

/**
 * Prompt examples teach the generic `@storybook/react`, but a Vite project only
 * declares `@storybook/react-vite`. The generic package resolves transitively
 * inside Storybook and then fails the moment an engineer lifts the file into the
 * app — which is the workflow this tool exists to serve.
 */
describe('alignStorybookTypesImport', () => {
  it('rewrites the generic react package to the project framework', () => {
    const code = `import type { Meta, StoryObj } from '@storybook/react';`;
    expect(alignStorybookTypesImport(code, '@storybook/react-vite')).toBe(
      `import type { Meta, StoryObj } from '@storybook/react-vite';`,
    );
  });

  it('handles double quotes', () => {
    const code = `import type { Meta } from "@storybook/react";`;
    expect(alignStorybookTypesImport(code, '@storybook/react-vite')).toContain('@storybook/react-vite');
  });

  it('rewrites every occurrence in a file', () => {
    const code = [
      `import type { Meta } from '@storybook/react';`,
      `import type { StoryObj } from '@storybook/react';`,
    ].join('\n');
    const out = alignStorybookTypesImport(code, '@storybook/react-vite');
    expect(out.match(/@storybook\/react-vite/g)).toHaveLength(2);
    expect(out).not.toContain(`'@storybook/react'`);
  });

  it('covers the other framework packages', () => {
    expect(alignStorybookTypesImport(`from '@storybook/vue3'`, '@storybook/vue3-vite')).toContain('vue3-vite');
    expect(alignStorybookTypesImport(`from '@storybook/svelte'`, '@storybook/svelte-vite')).toContain('svelte-vite');
    expect(alignStorybookTypesImport(`from '@storybook/web-components'`, '@storybook/web-components-vite'))
      .toContain('web-components-vite');
  });

  it('leaves an already-specific import alone', () => {
    const code = `import type { Meta } from '@storybook/react-vite';`;
    expect(alignStorybookTypesImport(code, '@storybook/react-vite')).toBe(code);
  });

  it('does not touch unrelated storybook imports', () => {
    const code = [
      `import { expect } from 'storybook/test';`,
      `import type { Meta } from '@storybook/react';`,
      `import { addons } from '@storybook/addon-docs';`,
    ].join('\n');
    const out = alignStorybookTypesImport(code, '@storybook/react-vite');
    expect(out).toContain(`from 'storybook/test'`);
    expect(out).toContain(`from '@storybook/addon-docs'`);
    expect(out).toContain(`from '@storybook/react-vite'`);
  });

  it('is a no-op when the framework is unknown or absent', () => {
    const code = `import type { Meta } from '@storybook/react';`;
    expect(alignStorybookTypesImport(code, undefined)).toBe(code);
    expect(alignStorybookTypesImport(code, '@storybook/something-invented')).toBe(code);
  });
});
