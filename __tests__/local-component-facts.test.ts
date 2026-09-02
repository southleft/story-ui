/**
 * A local component's own source is the only statement of its API.
 *
 * The reader this replaces was a regex that required `{` to follow the word
 * `Props`, so every `interface XProps extends …` yielded nothing, and its
 * destructuring reader wanted `}: Type` where `forwardRef(function X({…},
 * ref)` writes `}, ref)`. Measured on a 46-component system: 13 components
 * with zero props and no descriptions at all. Each test below pins one shape
 * that system actually uses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readLocalComponents,
  readLocalComponent,
  readLocalSourceTree,
  resolveRelative,
} from '../story-generator/knowledge/localComponentFacts.js';

let root: string;
const write = (rel: string, text: string) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-facts-'));

  // A sibling exporting an alias through a barrel, the way `type BadgeVariant`
  // reaches ArticleCard: `import { type BadgeVariant } from '../Badge'`.
  write('components/Badge/Badge.tsx', `
import * as React from 'react';
export type BadgeVariant = 'neutral' | 'brand' | 'accent';
export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  children: React.ReactNode;
  /** @default 'neutral' */
  variant?: BadgeVariant;
}
/** A compact, **non-interactive** label. */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge({ children, variant = 'neutral', ...rest }, ref) {
  return <span ref={ref} {...rest}>{children}</span>;
});
`);
  write('components/Badge/index.ts', `export { Badge } from './Badge';\nexport type { BadgeProps, BadgeVariant } from './Badge';\n`);

  write('components/Heading/Heading.tsx', `
import * as React from 'react';
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level: HeadingLevel;
}
export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(function Heading({ level, ...rest }, ref) {
  const Tag = \`h\${level}\` as 'h1';
  return <Tag ref={ref} {...rest} />;
});
`);
  write('components/Heading/index.ts', `export * from './Heading';\n`);

  write('components/ArticleCard/ArticleCard.tsx', `
import * as React from 'react';
import { Badge, type BadgeVariant } from '../Badge';
import { type HeadingLevel } from '../Heading';

export interface ArticleCardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  headline: string;
  href: string;
  /**
   * Heading level for the headline.
   * @default 3
   */
  headingLevel?: HeadingLevel;
  categoryVariant?: BadgeVariant;
  /** @deprecated use \`dek\` instead */
  summary?: string;
  /** @default 'vertical' */
  layout?: 'vertical' | 'horizontal';
  onSelect?: (id: string) => void;
}

/**
 * A linked summary of one story — the workhorse of a publication.
 *
 * Accessibility:
 * - The headline is the link, not the whole card.
 */
export const ArticleCard = React.forwardRef<HTMLElement, ArticleCardProps>(function ArticleCard(
  { headline, href, headingLevel = 3, categoryVariant = 'brand', layout = 'vertical', className, ...rest },
  ref,
) {
  return <article ref={ref} className={className} {...rest}><a href={href}>{headline}</a><Badge variant={categoryVariant}>x</Badge></article>;
});
`);
  write('components/ArticleCard/ArticleCard.stories.tsx', `export default { title: 'X' }; export const Default = {};`);

  // A type alias with an intersection over a local base, Omit filtering that
  // base, and a trailing `export { X }` instead of an inline export.
  write('components/Field/Field.tsx', `
import * as React from 'react';
type FieldBase = { label: string; hint?: string; secret?: boolean };
export type FieldProps = Omit<FieldBase, 'secret'> & { size?: 'sm' | 'md' | (string & {}) };
const Field = (props: FieldProps) => <label>{props.label}</label>;
/** Not exported: an internal helper that also takes props. */
const Inner = ({ x }: { x: number }) => <i>{x}</i>;
export { Field };
`);

  // A plain function component whose props type is only named by convention.
  write('components/Spinner.tsx', `
/** Indicates that something is loading. */
export function Spinner({ size = 'md' }: SpinnerProps) { return <span>{size}</span>; }
export interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; }
`);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readLocalComponents', () => {
  it('reads an interface with an extends clause, the shape the regex could not', () => {
    const [card] = readLocalComponents(path.join(root, 'components/ArticleCard/ArticleCard.tsx'));
    expect(card.name).toBe('ArticleCard');
    expect(card.exported).toBe(true);
    expect(card.propsType).toBe('ArticleCardProps');
    const names = card.props.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(['headline', 'href', 'headingLevel', 'categoryVariant', 'summary', 'layout', 'onSelect']));
  });

  it('records the required flag from the question mark', () => {
    const card = readLocalComponent(path.join(root, 'components/ArticleCard/ArticleCard.tsx'), 'ArticleCard')!;
    const by = Object.fromEntries(card.props.map(p => [p.name, p]));
    expect(by.headline.required).toBe(true);
    expect(by.headingLevel.required).toBe(false);
  });

  it('reads JSDoc prose, @default and @deprecated from each member', () => {
    const card = readLocalComponent(path.join(root, 'components/ArticleCard/ArticleCard.tsx'), 'ArticleCard')!;
    const by = Object.fromEntries(card.props.map(p => [p.name, p]));
    expect(by.headingLevel.doc).toBe('Heading level for the headline.');
    expect(by.headingLevel.defaultValue).toBe('3');
    expect(by.layout.defaultValue).toBe("'vertical'");
    expect(by.summary.deprecated).toMatch(/use `dek` instead/);
  });

  it('resolves union options through an alias imported from a sibling barrel', () => {
    const card = readLocalComponent(path.join(root, 'components/ArticleCard/ArticleCard.tsx'), 'ArticleCard')!;
    const by = Object.fromEntries(card.props.map(p => [p.name, p]));
    expect(by.categoryVariant.options).toEqual(['neutral', 'brand', 'accent']);
    expect(by.layout.options).toEqual(['vertical', 'horizontal']);
  });

  it('shows a literal-union alias expanded as the type text, so the model can type it', () => {
    const card = readLocalComponent(path.join(root, 'components/ArticleCard/ArticleCard.tsx'), 'ArticleCard')!;
    const by = Object.fromEntries(card.props.map(p => [p.name, p]));
    // Numeric literals are not `options` (those are strings a picker can
    // write); the expanded type carries them instead.
    expect(by.headingLevel.type).toBe('1 | 2 | 3 | 4 | 5 | 6');
    expect(by.headingLevel.options).toBeUndefined();
  });

  it('keeps only declared members for extends HTMLAttributes and notes the passthrough', () => {
    const card = readLocalComponent(path.join(root, 'components/ArticleCard/ArticleCard.tsx'), 'ArticleCard')!;
    expect(card.passthrough).toBe('React.HTMLAttributes<HTMLElement>');
    // Nothing from React's attribute set leaked in as a member.
    expect(card.props.map(p => p.name)).not.toContain('className');
    expect(card.props.map(p => p.name)).not.toContain('onClick');
  });

  it('takes the first paragraph of the JSDoc above the export as the description', () => {
    const card = readLocalComponent(path.join(root, 'components/ArticleCard/ArticleCard.tsx'), 'ArticleCard')!;
    expect(card.doc).toBe('A linked summary of one story — the workhorse of a publication.');
    const badge = readLocalComponent(path.join(root, 'components/Badge/Badge.tsx'), 'Badge')!;
    // Markdown emphasis is furniture in a one-line description.
    expect(badge.doc).toBe('A compact, non-interactive label.');
  });

  it('follows a type alias through Omit and an intersection, and marks (string & {}) open', () => {
    const field = readLocalComponent(path.join(root, 'components/Field/Field.tsx'), 'Field')!;
    expect(field.exported).toBe(true); // via the trailing `export { Field }`
    const by = Object.fromEntries(field.props.map(p => [p.name, p]));
    expect(Object.keys(by).sort()).toEqual(['hint', 'label', 'size']);
    expect(by.label.required).toBe(true);
    expect(by.size.options).toEqual(['sm', 'md']);
    expect(by.size.optionsOpen).toBe(true);
  });

  it('reports an internal helper as not exported', () => {
    const inner = readLocalComponent(path.join(root, 'components/Field/Field.tsx'), 'Inner');
    expect(inner?.exported).toBe(false);
  });

  it('falls back to <Name>Props only when the declaration names nothing', () => {
    const spinner = readLocalComponent(path.join(root, 'components/Spinner.tsx'), 'Spinner')!;
    expect(spinner.propsType).toBe('SpinnerProps');
    expect(spinner.props[0].options).toEqual(['sm', 'md', 'lg']);
    expect(spinner.doc).toBe('Indicates that something is loading.');
  });

  it('never throws for a file that does not exist or cannot be parsed', () => {
    expect(readLocalComponents(path.join(root, 'nope.tsx'))).toEqual([]);
    const bad = write('components/Bad.tsx', 'export const = {{{');
    expect(() => readLocalComponents(bad)).not.toThrow();
  });
});

describe('resolveRelative', () => {
  it('finds a directory index and an extensionless sibling', () => {
    const from = path.join(root, 'components/ArticleCard/ArticleCard.tsx');
    expect(resolveRelative(from, '../Badge')).toBe(path.join(root, 'components/Badge/index.ts'));
    expect(resolveRelative(from, './ArticleCard')).toBe(from);
    expect(resolveRelative(from, 'react')).toBeNull();
  });
});

describe('readLocalSourceTree', () => {
  it('keys exported components by name and skips stories and internals', () => {
    const { components, files } = readLocalSourceTree(path.join(root, 'components'));
    expect(Object.keys(components).sort()).toEqual(['ArticleCard', 'Badge', 'Field', 'Heading', 'Spinner']);
    expect(components.Inner).toBeUndefined();
    expect(files.some(f => f.endsWith('.stories.tsx'))).toBe(false);
    expect(components.ArticleCard.doc).toMatch(/workhorse/);
    expect(components.ArticleCard.passthrough).toBe('React.HTMLAttributes<HTMLElement>');
  });
});
