/**
 * Editable props for a LOCAL-SOURCE design system.
 *
 * GET /mcp/editable-props used to read only `extractProps(config.importPath)`
 * — the npm-declarations channel. For a project whose components live in its
 * own `src/` behind a path alias (college-town: `importPath: '@/components'`),
 * that path names no installable package, so the route answered `props: []`
 * for a Button whose cva() map declares nine variants and six sizes. The
 * generation pipeline already read those maps via knowledge/sourceFacts; the
 * route now resolves knowledge the same way — package declarations AND source
 * facts, merged field-wise.
 *
 * Runs against a throwaway fixture project shaped like college-town: config
 * declaring components with aliased import paths, a cva() component on disk,
 * and a generated story that uses it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { editablePropsHandler } from '../../mcp-server/routes/editProp.js';
import { mergePropFactsFromSource, readSourceFacts } from '../../story-generator/knowledge/sourceFacts.js';
import type { PropFact } from '../../story-generator/knowledge/propExtractor.js';

const STORY_FILE = 'campus-events-fixture1.stories.tsx';

/** A cva() component in the college-town shape: variants + defaultVariants. */
const BUTTON_SOURCE = `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center",
  {
    variants: {
      variant: {
        default: "bg-primary",
        destructive: "bg-destructive",
        success: "bg-success",
        outline: "border",
        ghost: "hover:bg-accent",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3",
        lg: "h-10 px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({ variant = "default", size = "default", asChild = false, ...props }:
  React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  return <button data-variant={variant} data-size={size} {...props} />;
}

export { Button, buttonVariants };
`;

const BUTTON_STORY = `import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';

const meta = {
  title: 'Components/Button',
  component: Button,
  argTypes: {
    variant: { description: 'Visual style variant of the button' },
  },
} satisfies Meta<typeof Button>;
export default meta;
export const Default: StoryObj<typeof meta> = { args: { children: 'Click' } };
`;

const GENERATED_STORY = `import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/components/button/button';

const meta = { title: 'Generated/Campus Events' } as Meta;
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div>
      <Button variant="default">Register</Button>
    </div>
  ),
};
`;

let root: string;
let originalCwd: string;

beforeAll(() => {
  originalCwd = process.cwd();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-local-src-'));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'local-source-fixture',
    private: true,
    dependencies: { react: '^19.0.0' },
    devDependencies: { '@storybook/react-vite': '^10.0.0' },
  }, null, 2));

  // College-town's shape: an aliased importPath that is NOT an npm package,
  // components declared in config, source under componentsPath.
  fs.writeFileSync(path.join(root, 'story-ui.config.js'), `module.exports = {
  importPath: '@/components',
  componentsPath: './src/components',
  importStyle: 'individual',
  componentFramework: 'react',
  generatedStoriesPath: './stories/generated/',
  storyPrefix: 'Generated/',
  llmProvider: 'claude',
  components: [
    {
      name: 'Button',
      importPath: '@/components/button/button',
      props: ['variant', 'size', 'asChild', 'className', 'children'],
      description: 'Interactive button with multiple variants and sizes',
      category: 'form',
    },
  ],
};
`);

  const buttonDir = path.join(root, 'src', 'components', 'button');
  fs.mkdirSync(buttonDir, { recursive: true });
  fs.writeFileSync(path.join(buttonDir, 'button.tsx'), BUTTON_SOURCE);
  fs.writeFileSync(path.join(buttonDir, 'button.stories.tsx'), BUTTON_STORY);

  const generatedDir = path.join(root, 'stories', 'generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, STORY_FILE), GENERATED_STORY);

  process.chdir(root);
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
}

describe('editable props for a local cva() component', () => {
  it('serves the cva variant and size enums, closed, with their defaults', async () => {
    const res = mockRes();
    // The fiber chain names wrappers (Slot) the story never contains — the
    // candidate list resolves to the element the file has, as the live
    // request did.
    await editablePropsHandler(
      { query: {
          component: 'Button',
          candidates: 'Button,SlotClone,Slot',
          fileName: STORY_FILE,
      } } as any,
      res as any,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.component).toBe('Button');

    const byName = Object.fromEntries(res.body.props.map((p: any) => [p.name, p]));

    // The cva map is the component's own lookup table: a CLOSED set.
    expect(byName.variant).toMatchObject({
      kind: 'enum',
      options: ['default', 'destructive', 'success', 'outline', 'ghost'],
      defaultValue: 'default',
    });
    expect(byName.variant.open).toBeUndefined();

    expect(byName.size).toMatchObject({
      kind: 'enum',
      options: ['default', 'sm', 'lg'],
      defaultValue: 'default',
    });
    expect(byName.size.open).toBeUndefined();

    // The team's own prop prose, read from the co-located story's argTypes.
    expect(byName.variant.doc).toBe('Visual style variant of the button');
  });

  it('answers [] (not a crash) for a component with no source facts and no declarations', async () => {
    const res = mockRes();
    await editablePropsHandler({ query: { component: 'Nonexistent' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body.component).toBe('Nonexistent');
    expect(res.body.props).toEqual([]);
  });
});

describe('mergePropFactsFromSource', () => {
  const cvaFacts = () => readSourceFacts(path.join(root, 'src', 'components', 'button', 'button.tsx'));

  it('reads the fixture cva() map from disk', () => {
    const facts = cvaFacts();
    expect(facts.variants?.options.variant).toEqual(['default', 'destructive', 'success', 'outline', 'ghost']);
    expect(facts.variants?.defaults).toEqual({ variant: 'default', size: 'default' });
  });

  it('creates closed enum facts for props declarations never mentioned', () => {
    const merged = mergePropFactsFromSource([], cvaFacts());
    const variant = merged.find(p => p.name === 'variant');
    expect(variant?.options).toEqual(['default', 'destructive', 'success', 'outline', 'ghost']);
    expect(variant?.optionsOpen).toBeUndefined();
    expect(variant?.defaultValue).toBe('default');
  });

  it('is field-wise: a declaration that already answered wins, gaps are filled', () => {
    const declared: PropFact[] = [
      // Declaration knows the options (and marked them open) — source must not
      // overwrite, but its default fills the gap.
      { name: 'variant', required: false, type: 'string', options: ['a', 'b'], optionsOpen: true },
      // Declaration knows the type only — source supplies options and default.
      { name: 'size', required: false, type: 'ButtonSize' },
    ];
    const merged = mergePropFactsFromSource(declared, cvaFacts());

    const variant = merged.find(p => p.name === 'variant');
    expect(variant?.options).toEqual(['a', 'b']);
    expect(variant?.optionsOpen).toBe(true);
    expect(variant?.defaultValue).toBe('default');

    const size = merged.find(p => p.name === 'size');
    expect(size?.type).toBe('ButtonSize');
    expect(size?.options).toEqual(['default', 'sm', 'lg']);
    expect(size?.optionsOpen).toBeUndefined();
    expect(size?.defaultValue).toBe('default');
  });

  it('fills prop docs from story argTypes without inventing props', () => {
    const merged = mergePropFactsFromSource(
      [{ name: 'variant', required: false, doc: undefined }],
      { propDocs: { variant: 'From the story', ghost: 'Doc for a prop nobody declared' } },
    );
    expect(merged.find(p => p.name === 'variant')?.doc).toBe('From the story');
    expect(merged.find(p => p.name === 'ghost')).toBeUndefined();
  });
});
