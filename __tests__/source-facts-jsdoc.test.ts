/**
 * A local component's own JSDoc becomes its description, and the inventory
 * says so honestly.
 *
 * sourceFacts read only a story's `parameters.docs.description.component`, so
 * a design system documented above its exports — the ordinary way — reported
 * 0 descriptions while every component carried one. And the inventory route
 * never applied source facts at all, so it disagreed with the catalog the
 * model was shown. Absent and present must look different in both places.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readSourceFacts,
  enrichWithSourceFacts,
  mergePropFactsFromSource,
} from '../story-generator/knowledge/sourceFacts.js';
import { saysMoreThanName } from '../story-generator/knowledge/descriptionQuality.js';
import { shapeInventory } from '../mcp-server/routes/components.js';

let root: string;
const write = (rel: string, text: string) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
};

const BUTTON = `
import * as React from 'react';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Button label. Write it in sentence case. */
  children: React.ReactNode;
  /**
   * Visual emphasis.
   * @default 'primary'
   */
  variant?: ButtonVariant;
  /** Stretch to the container's width. */
  fullWidth?: boolean;
  /** @deprecated use \`variant="ghost"\` */
  flat?: boolean;
}
/**
 * The primary action control.
 *
 * Interaction states are pseudo-classes, not props.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ children, ...rest }, ref) {
  return <button ref={ref} {...rest}>{children}</button>;
});
`;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-facts-jsdoc-'));
  write('src/components/Button/Button.tsx', BUTTON);
  // The same component beside a story that carries its own docs block.
  write('src/components/Storied/Storied.tsx', BUTTON.replace(/Button/g, 'Storied'));
  write('src/components/Storied/Storied.stories.tsx', `
export default {
  title: 'Storied',
  parameters: { docs: { description: { component: 'The story explains it differently.' } } },
  argTypes: { variant: { description: 'From the story argTypes.' } },
};
`);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readSourceFacts with a component name', () => {
  it('takes the description from the JSDoc above the export when no story documents it', () => {
    const facts = readSourceFacts(path.join(root, 'src/components/Button/Button.tsx'), 'Button');
    expect(facts.description).toBe('The primary action control.');
    expect(facts.declaredProps?.map(p => p.name)).toEqual(['children', 'variant', 'fullWidth', 'flat']);
    expect(facts.passthrough).toBe('React.ButtonHTMLAttributes<HTMLButtonElement>');
  });

  it('lets a story docs block win, and fills prop docs the argTypes did not write', () => {
    const facts = readSourceFacts(path.join(root, 'src/components/Storied/Storied.tsx'), 'Storied');
    expect(facts.description).toBe('The story explains it differently.');
    expect(facts.propDocs?.variant).toBe('From the story argTypes.');
    expect(facts.propDocs?.fullWidth).toBe("Stretch to the container's width.");
  });
});

describe('mergePropFactsFromSource', () => {
  it('fills every field from the declaration when there are no package declarations', () => {
    const facts = readSourceFacts(path.join(root, 'src/components/Button/Button.tsx'), 'Button');
    const merged = mergePropFactsFromSource([], facts);
    const variant = merged.find(p => p.name === 'variant')!;
    expect(variant.options).toEqual(['primary', 'secondary', 'ghost']);
    expect(variant.defaultValue).toBe("'primary'");
    expect(merged.find(p => p.name === 'flat')?.deprecated).toMatch(/ghost/);
  });
});

describe('enrichWithSourceFacts', () => {
  const component = () => ({
    name: 'Button',
    filePath: path.join(root, 'src/components/Button/Button.tsx'),
    description: 'Button component',
    props: ['children', 'variant', 'fullWidth', 'flat', 'disabled'],
  });

  it('replaces the placeholder with the JSDoc, judged by the shared predicate', () => {
    const c: any = component();
    expect(saysMoreThanName(c.name, c.description)).toBe(false);
    enrichWithSourceFacts([c]);
    // The deprecated `flat` earns the same DO-NOT-USE note the npm path appends.
    expect(c.description).toMatch(/^The primary action control\. — DO NOT USE these deprecated props: flat/);
    expect(saysMoreThanName(c.name, c.description)).toBe(true);
  });

  it('never overwrites a description that already says something', () => {
    const c: any = { ...component(), description: 'Declared in story-ui.config.js by the team.' };
    enrichWithSourceFacts([c]);
    expect(c.description).toMatch(/^Declared in story-ui\.config\.js by the team\./);
  });

  it('renders the declaration as catalog lines, withholds deprecated props, keeps story-only names', () => {
    const c: any = component();
    enrichWithSourceFacts([c]);
    expect(c.props).toContain('children (React.ReactNode) REQUIRED');
    expect(c.props).toContain("variant? [primary|secondary|ghost] ='primary'");
    expect(c.props.some((p: string) => p.startsWith('flat'))).toBe(false);
    expect(c.props).toContain('disabled');
    expect(c.passthroughAttributes).toBe('React.ButtonHTMLAttributes<HTMLButtonElement>');
    expect(c.__propDocs.fullWidth).toBe("Stretch to the container's width.");
  });
});

describe('inventory honesty', () => {
  it('reports hasDescription false for the placeholder and true once the JSDoc is applied', () => {
    const raw: any = {
      name: 'Button',
      filePath: path.join(root, 'src/components/Button/Button.tsx'),
      description: 'Button component',
      props: ['variant'],
    };
    const before = shapeInventory([raw], '@acme/ui').components[0];
    expect(before.hasDescription).toBe(false);
    enrichWithSourceFacts([raw]);
    const after = shapeInventory([raw], '@acme/ui').components[0];
    expect(after.hasDescription).toBe(true);
    expect(after.description).toMatch(/^The primary action control\./);
    expect(after.source).toBe('local');
  });
});
