/**
 * `story-ui init` used to unlink any Button/Header/Page file in the stories
 * folder by name. A project whose own components share those names lost them.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanupDefaultStorybookComponents, isStorybookScaffold } from '../cli/setup.js';

const SCAFFOLD_BUTTON = `import React from 'react';
import './button.css';
/** Primary UI component for user interaction */
export const Button = ({ primary = false, label, ...props }) => {
  const mode = primary ? 'storybook-button--primary' : 'storybook-button--secondary';
  return <button className={['storybook-button', mode].join(' ')} {...props}>{label}</button>;
};`;

const USER_BUTTON = `import { cva } from 'class-variance-authority';
export const Button = ({ variant = 'primary', ...props }) => <button data-variant={variant} {...props} />;`;

describe('isStorybookScaffold', () => {
  it('recognises the scaffold by its own markers', () => {
    expect(isStorybookScaffold(SCAFFOLD_BUTTON)).toBe(true);
    expect(isStorybookScaffold(`// More on how to set up stories at: https://storybook.js.org/docs\nexport default { title: 'Example/Button' };`)).toBe(true);
    expect(isStorybookScaffold('.storybook-button { font-weight: 700; }')).toBe(true);
  });
  it('does not mistake a project component for it', () => {
    expect(isStorybookScaffold(USER_BUTTON)).toBe(false);
  });
});

describe('cleanupDefaultStorybookComponents', () => {
  it('removes the scaffold and keeps the user’s own file of the same name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sui-init-'));
    const stories = path.join(root, 'src', 'stories');
    fs.mkdirSync(stories, { recursive: true });
    fs.writeFileSync(path.join(stories, 'Header.tsx'), SCAFFOLD_BUTTON.replace(/button/g, 'header'));
    fs.writeFileSync(path.join(stories, 'Button.tsx'), USER_BUTTON);
    fs.writeFileSync(path.join(stories, 'Page.tsx'), 'export const Page = () => <main>My real page</main>;');

    const cwd = process.cwd();
    process.chdir(root);
    try {
      cleanupDefaultStorybookComponents();
    } finally {
      process.chdir(cwd);
    }

    expect(fs.existsSync(path.join(stories, 'Header.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(stories, 'Button.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(stories, 'Page.tsx'))).toBe(true);
  });
});
