import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateImportIsolation } from '../mcp-server/routes/generationCore.js';

/**
 * A throwaway project with a real node_modules, since scope-existence is
 * answered from disk. Returns the packages it created.
 */
function fakeProject(installed: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-iso-'));
  for (const pkg of installed) {
    fs.mkdirSync(path.join(root, 'node_modules', pkg), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  return root;
}

const mantineConfig = {
  importPath: '@mantine/core',
  additionalImports: [],
} as any;

describe('validateImportIsolation', () => {
  it('allows the configured library, framework runtime, and Storybook', () => {
    const code = `
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button, Card } from '@mantine/core';
import { useHover } from '@mantine/hooks';
`;
    expect(validateImportIsolation(code, mantineConfig, 'react', '')).toEqual([]);
  });

  it('rejects foreign UI kits and utility libraries', () => {
    const code = `
import { Button } from 'antd';
import { motion } from 'framer-motion';
import clsx from 'clsx';
`;
    const errors = validateImportIsolation(code, mantineConfig, 'react', '');
    expect(errors.length).toBe(3);
    expect(errors[0]).toContain('antd');
  });

  it('permits packages explicitly named in the considerations file', () => {
    const code = `import { IconCheck } from '@tabler/icons-react';`;
    const considerations = 'Import icons from @tabler/icons-react when icons are needed';
    expect(validateImportIsolation(code, mantineConfig, 'react', considerations)).toEqual([]);
    expect(validateImportIsolation(code, mantineConfig, 'react', '').length).toBe(1);
  });

  it('rejects side-effect imports of foreign packages', () => {
    const code = `import 'animate.css';`;
    expect(validateImportIsolation(code, mantineConfig, 'react', '').length).toBe(1);
  });

  it('allows deep side-effect imports within the configured library', () => {
    const wcConfig = { importPath: '@shoelace-style/shoelace' } as any;
    const code = `
import { html } from 'lit';
import '@shoelace-style/shoelace/dist/components/button/button.js';
`;
    expect(validateImportIsolation(code, wcConfig, 'web-components', '')).toEqual([]);
  });

  it('allows relative imports', () => {
    const code = `import { LocalThing } from './LocalThing';`;
    expect(validateImportIsolation(code, mantineConfig, 'react', '')).toEqual([]);
  });

  it('flags Tailwind utility classes when Tailwind is not part of the project', () => {
    const code = `export const x = () => <div className="flex gap-4 p-8 items-center rounded-lg">hi</div>;`;
    const errors = validateImportIsolation(code, mantineConfig, 'react', '');
    expect(errors.some(e => e.includes('Tailwind'))).toBe(true);
  });

  it('does not flag Tailwind classes when considerations permit Tailwind', () => {
    const code = `export const x = () => <div className="flex gap-4 p-8 items-center rounded-lg">hi</div>;`;
    const errors = validateImportIsolation(code, mantineConfig, 'react', 'This project uses Tailwind utilities.');
    expect(errors.some(e => e.includes('Tailwind'))).toBe(false);
  });

  /**
   * Scope membership is not existence.
   *
   * Atlassian ships one package per component, and the model kebab-cases a
   * component name into a package it invented — `@atlaskit/grid` for a Grid
   * that lives in `@atlaskit/primitives`. That type-checks, imports nothing,
   * and renders an empty story: no build error, no runtime error, no clue.
   */
  describe('within the design system scope', () => {
    const cwd = process.cwd();
    afterEach(() => process.chdir(cwd));

    const atlas = { importPath: '@atlaskit/button' } as any;
    const components = [
      { name: 'Grid', __componentPath: '@atlaskit/primitives' },
      { name: 'Button', __componentPath: '@atlaskit/button/new' },
    ];

    it('rejects a package that is not installed, and names the real home', () => {
      process.chdir(fakeProject(['@atlaskit/button', '@atlaskit/primitives']));
      const code = `
import Button from '@atlaskit/button/new';
import { Grid } from '@atlaskit/grid';
`;
      const errors = validateImportIsolation(code, atlas, 'react', '', components);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('@atlaskit/grid');
      expect(errors[0]).toContain('@atlaskit/primitives');
    });

    it('names only the components THAT import binds', () => {
      // Button is in the catalog and appears in the file, but it came from a
      // different, valid import. Redirecting it would be actively wrong.
      process.chdir(fakeProject(['@atlaskit/button', '@atlaskit/primitives']));
      const code = `
import Button from '@atlaskit/button/new';
import { Grid } from '@atlaskit/grid';
`;
      expect(validateImportIsolation(code, atlas, 'react', '', components)[0])
        .not.toContain('Import Button from');
    });

    it('allows sibling packages that are installed', () => {
      process.chdir(fakeProject(['@atlaskit/button', '@atlaskit/primitives', '@atlaskit/avatar']));
      const code = `
import { Grid } from '@atlaskit/primitives';
import Avatar from '@atlaskit/avatar';
`;
      expect(validateImportIsolation(code, atlas, 'react', '', components)).toEqual([]);
    });

    it('rejects an import from the SCOPE itself, which is not a package', () => {
      // `@atlaskit` names a directory in node_modules. It is the configured
      // importPath, so it sat in allowedRoots and every check waved it through
      // while the model collapsed eleven components onto it. Resolves to
      // nothing, renders nothing.
      process.chdir(fakeProject(['@atlaskit/avatar', '@atlaskit/primitives']));
      const code = "import { Avatar, Box } from '@atlaskit';";
      const errors = validateImportIsolation(code, atlas, 'react', '', components);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('npm SCOPE');
    });

    it('names the real package for each component on a scope import', () => {
      process.chdir(fakeProject(['@atlaskit/avatar', '@atlaskit/primitives']));
      const errors = validateImportIsolation(
        "import { Grid } from '@atlaskit';", atlas, 'react', '', components,
      );
      expect(errors[0]).toContain('@atlaskit/primitives');
    });

    it('allows a scope name that IS a real package', () => {
      // Some scopes ship a package at the root. Rejecting by shape alone would
      // break them, so the check asks node_modules rather than assuming.
      const root = fakeProject(['@atlaskit/avatar']);
      fs.mkdirSync(path.join(root, 'node_modules', '@atlaskit'), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules', '@atlaskit', 'package.json'), '{"name":"@atlaskit"}');
      process.chdir(root);
      expect(validateImportIsolation("import { Avatar } from '@atlaskit';", atlas, 'react', '', components)).toEqual([]);
    });

    it('stays silent when cwd is not the consumer project', () => {
      // The check rejects, so it must not fire on a guess. With the design
      // system itself absent, this cwd cannot speak to its scope at all —
      // otherwise every unit run and every host that starts the server from
      // elsewhere invents import errors.
      process.chdir(fakeProject([]));
      const code = `import { Grid } from '@atlaskit/grid';`;
      expect(validateImportIsolation(code, atlas, 'react', '', components)).toEqual([]);
    });
  });

  it('allows Angular family packages for angular framework', () => {
    const ngConfig = { importPath: '@angular/material' } as any;
    const code = `
import { moduleMetadata } from '@storybook/angular';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
`;
    expect(validateImportIsolation(code, ngConfig, 'angular', '')).toEqual([]);
  });
});
