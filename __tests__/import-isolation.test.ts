import { describe, it, expect } from 'vitest';
import { validateImportIsolation } from '../mcp-server/routes/generationCore.js';

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
