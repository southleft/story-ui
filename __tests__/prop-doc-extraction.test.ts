/**
 * What a design system says about its own props.
 *
 * Two facts here are worth more than the prose beside them and were both being
 * discarded: that a prop is DEPRECATED (the fastest way for generated code to
 * be rejected by the team that owns the system) and what it DEFAULTS to (a
 * restated default reads as someone who did not know the API). Neither is
 * recoverable from a model prior — both are specific to the installed version.
 *
 * The reader is exercised through real files rather than the exported
 * extractProps, which is bound to node_modules layout and a disk cache.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractProps } from '../story-generator/knowledge/propExtractor.js';
import { isGenericDescription, saysMoreThanName } from '../story-generator/knowledge/descriptionQuality.js';

/** A minimal installed package, since extraction resolves through node_modules. */
function fakePackage(name: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-props-'));
  const pkgDir = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(pkgDir, 'index.js'), '');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { [name]: '1.0.0' } }));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(pkgDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const roots: string[] = [];
const make = (name: string, files: Record<string, string>) => {
  const r = fakePackage(name, files);
  roots.push(r);
  return r;
};
afterAll(() => {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
});

describe('prop extraction from type declarations', () => {
  let facts: any;

  beforeAll(async () => {
    const root = make('@fixture/ds', {
      'lozenge.d.ts': `
        export interface LozengeProps {
          /** The appearance type. */
          appearance?: 'default' | 'success';
          /**
           * Determines whether to apply the bold style or not.
           * @deprecated Will be removed in a future major release. Use Tag instead.
           */
          isBold?: boolean;
          /**
           * The visual weight.
           * @default 'subtle'
           */
          weight?: string;
          /** Required content. */
          children: string;
        }
        /**
         * Highlights the status of an item to make it stand out in a list.
         */
        export declare const Lozenge: (props: LozengeProps) => JSX.Element;
      `,
    });
    facts = await extractProps('@fixture/ds', root, { force: true });
  });

  const prop = (name: string) => facts.components.Lozenge.props.find((p: any) => p.name === name);

  it('keeps the deprecation notice and the replacement it names', () => {
    expect(prop('isBold').deprecated).toContain('Use Tag instead');
  });

  it('keeps the declared default', () => {
    expect(prop('weight').defaultValue).toBe("'subtle'");
  });

  it('still reads the prose, without the tags trailing it', () => {
    expect(prop('isBold').doc).toBe('Determines whether to apply the bold style or not.');
    expect(prop('weight').doc).toBe('The visual weight.');
  });

  it('marks a prop with no question token as required', () => {
    expect(prop('children').required).toBe(true);
    expect(prop('appearance').required).toBe(false);
  });

  it('reads prose from the component declaration, not only its props', () => {
    expect(facts.components.Lozenge.doc).toContain('Highlights the status of an item');
  });
});

describe('component prose that is not prose', () => {
  it('rejects a doc block that is only documentation links', async () => {
    // MUI writes exactly this and nothing else. Recorded as a description it
    // would report full coverage while handing the model a URL.
    const root = make('@fixture/links', {
      'button.d.ts': `
        export interface ButtonProps { children?: string }
        /**
         *
         * Demos:
         *
         * - [Button](https://mui.com/material-ui/react-button/)
         *
         * API:
         *
         * - [Button API](https://mui.com/material-ui/api/button/)
         */
        export declare const Button: (props: ButtonProps) => JSX.Element;
      `,
    });
    const facts = await extractProps('@fixture/links', root, { force: true });
    expect(facts.components.Button?.doc).toBeUndefined();
  });

  it('rejects a block that opens with a tag', async () => {
    // `@ignore - internal component.` is an instruction to tooling. Splitting
    // on a SPACE before the tag missed it, so it was stored as documentation.
    const root = make('@fixture/ignored', {
      'ctx.d.ts': `
        export interface ThingProps { a?: string }
        /**
         * @ignore - internal component.
         */
        export declare const Thing: (props: ThingProps) => JSX.Element;
      `,
    });
    const facts = await extractProps('@fixture/ignored', root, { force: true });
    expect(facts.components.Thing?.doc).toBeUndefined();
  });

  it('keeps a sentence that merely contains a link, dropping the address', async () => {
    const root = make('@fixture/inline', {
      'c.d.ts': `
        export interface CollapseProps { a?: string }
        /**
         * The Collapse transition is used by the [Vertical Stepper](https://mui.com/x) component.
         */
        export declare const Collapse: (props: CollapseProps) => JSX.Element;
      `,
    });
    const facts = await extractProps('@fixture/inline', root, { force: true });
    expect(facts.components.Collapse.doc).toBe(
      'The Collapse transition is used by the Vertical Stepper component.',
    );
  });
});

describe('propTypes, for design systems that ship JavaScript', () => {
  it('reads prose and deprecations from Component.propTypes', async () => {
    // Carbon's Tile.js carries 49 JSDoc blocks; its Tile.d.ts carries none.
    // Reading only declarations reported that library as undocumented.
    const root = make('@fixture/js-ds', {
      'Tile.js': `
        const Tile = () => null;
        Tile.displayName = "Tile";
        Tile.propTypes = {
          /** The child nodes. */
          children: prop_types.default.node,
          /**
           * Specify the size of the tile.
           * @deprecated please use \`size\` instead.
           */
          small: prop_types.default.bool,
          /** The identifier. */
          id: prop_types.default.string.isRequired,
        };
      `,
    });
    const facts = await extractProps('@fixture/js-ds', root, { force: true });
    const props = facts.components.Tile.props;
    expect(props.find((p: any) => p.name === 'children').doc).toBe('The child nodes.');
    expect(props.find((p: any) => p.name === 'small').deprecated).toContain('use `size` instead');
    expect(props.find((p: any) => p.name === 'id').required).toBe(true);
  });

  it('combines the type from declarations with the prose from propTypes', async () => {
    // Same component described twice, each source holding what the other
    // lacks. First-wins-by-name silently discarded whichever arrived second,
    // so a prop could be typed OR documented depending on file order.
    const root = make('@fixture/both', {
      'Card.d.ts': `
        export interface CardProps {
          elevation?: number;
        }
      `,
      'Card.js': `
        const Card = () => null;
        Card.propTypes = {
          /** How far the card lifts off the surface. */
          elevation: prop_types.default.number,
        };
      `,
    });
    const facts = await extractProps('@fixture/both', root, { force: true });
    const elevation = facts.components.Card.props.find((p: any) => p.name === 'elevation');
    expect(elevation.type).toBe('number');
    expect(elevation.doc).toBe('How far the card lifts off the surface.');
  });
});

describe('props types that are not named after the component', () => {
  it('follows a local alias to the type that holds the members', async () => {
    // Atlassian declares the members under a neutral name and exports the
    // component's type as an application of it. Reading only literal members
    // filed Checkbox's props under the component name "Own".
    const root = make('@fixture/indirect', {
      'types.d.ts': `
        type OwnProps = {
          /** Sets whether the checkbox is checked. */
          isChecked?: boolean;
          isDisabled?: boolean;
        };
        type Combine<First, Second> = Omit<First, keyof Second> & Second;
        export type CheckboxProps = Combine<Omit<React.InputHTMLAttributes<HTMLInputElement>, 'x'>, OwnProps>;
      `,
    });
    const facts = await extractProps('@fixture/indirect', root, { force: true });
    const names = facts.components.Checkbox.props.map((p: any) => p.name);
    expect(names).toContain('isChecked');
    expect(names).toContain('isDisabled');
    expect(facts.components.Checkbox.props.find((p: any) => p.name === 'isChecked').doc)
      .toBe('Sets whether the checkbox is checked.');
  });

  it('reads the props type the declaration names, across files', async () => {
    // `<Name>Props` is a convention, not a rule. Avatar takes
    // `AvatarPropTypes` — singular Prop — and it is declared elsewhere.
    const root = make('@fixture/declared', {
      'types.d.ts': `
        export interface AvatarPropTypes {
          /** Provides a URL for the avatar image. */
          src?: string;
          size?: 'small' | 'large';
        }
      `,
      'avatar.d.ts': `
        import type { AvatarPropTypes } from './types';
        declare const Avatar: React.ForwardRefExoticComponent<
          React.PropsWithoutRef<AvatarPropTypes> & React.RefAttributes<HTMLElement>>;
        export default Avatar;
      `,
    });
    const facts = await extractProps('@fixture/declared', root, { force: true });
    expect(facts.components.Avatar.props.map((p: any) => p.name)).toEqual(
      expect.arrayContaining(['src', 'size']),
    );
  });

  it('never lets a linked type displace props read directly', async () => {
    // Type names are not unique across a package — two files may each declare
    // `OwnProps`. A link is trusted only as far as it cannot overwrite a
    // better answer.
    const root = make('@fixture/nodisplace', {
      'real.d.ts': `
        export interface WidgetProps {
          /** The real one. */
          realProp?: string;
        }
      `,
      'decl.d.ts': `
        export interface OtherPropTypes { wrongProp?: string }
        declare const Widget: React.FC<OtherPropTypes>;
      `,
    });
    const facts = await extractProps('@fixture/nodisplace', root, { force: true });
    const names = facts.components.Widget.props.map((p: any) => p.name);
    expect(names).toContain('realProp');
    expect(names).not.toContain('wrongProp');
  });
});

describe('description quality', () => {
  it('treats discovery placeholders as absent', () => {
    // These are truthy strings, so any `!description` guard reads them as
    // knowledge and declines to replace them with the real thing.
    expect(isGenericDescription('Chip', 'Chip component from Material UI')).toBe(true);
    expect(isGenericDescription('Accordion', 'Accordion component')).toBe(true);
    expect(isGenericDescription('Tile', undefined)).toBe(true);
  });

  it('accepts a description that states something', () => {
    expect(saysMoreThanName('Chip', 'Chips represent complex entities in small blocks.')).toBe(true);
    expect(saysMoreThanName('Lozenge', 'Highlights the status of an item in a list.')).toBe(true);
  });

  it('survives a name containing regex metacharacters', () => {
    expect(() => isGenericDescription('Foo(Bar', 'anything at all here')).not.toThrow();
  });
});
