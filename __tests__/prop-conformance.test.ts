/**
 * A prop the component does not declare is rejected; one it might declare
 * is never rejected.
 *
 * The attribute set comes from the project's own TypeScript — the same type
 * tsc checks the element against — so `Omit<ButtonHTMLAttributes, 'onChange'>`
 * really omits `onChange` while keeping `disabled`, `className`, `onClick`.
 * A component whose props are `any` or carry an index signature has no
 * ceiling and is skipped, with the reason recorded, never silently passed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import {
  checkPropConformance, formatPropConformanceErrors, summarisePropConformance, nearestProp, rewriteGlobalJsxNamespace,
} from '../story-generator/knowledge/propConformance.js';

const require = createRequire(import.meta.url);

let root: string;
let storiesDir: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-prop-conformance-'));
  storiesDir = path.join(root, 'src', 'stories', 'generated');
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  fs.mkdirSync(storiesDir, { recursive: true });

  // React's types, from this repo's node_modules, by path — the fixture has
  // no node_modules of its own.
  const reactTypes = path.dirname(require.resolve('@types/react/package.json'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      jsx: 'react-jsx', strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      skipLibCheck: true, noEmit: true, types: [],
      paths: {
        react: [path.join(reactTypes, 'index.d.ts')],
        'react/jsx-runtime': [path.join(reactTypes, 'jsx-runtime.d.ts')],
      },
    },
    include: ['src'],
  }));

  fs.writeFileSync(path.join(root, 'src', 'components', 'Switch.tsx'), `import * as React from 'react';
export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange'> {
  label: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(props, ref) {
  return <button ref={ref} role="switch" />;
});
`);
  fs.writeFileSync(path.join(root, 'src', 'components', 'Loose.tsx'), `import * as React from 'react';
export interface LooseProps { title: string; [key: string]: unknown }
export const Loose: React.FC<LooseProps> = () => null;
export const Untyped = (props: any) => <div {...props} />;
export const Menu = { Item: (props: { value: string; disabled?: boolean }) => <li>{props.value}</li> };
export function Poly<C extends React.ElementType = 'div'>(props: { as?: C } & Omit<React.ComponentPropsWithoutRef<C>, 'as'>) { return null; }
`);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const story = (body: string) => `import * as React from 'react';
import { Switch } from '../../components/Switch';
import { Loose, Untyped, Menu, Poly } from '../../components/Loose';
export default { title: 'X' };
export const Default = () => (
  <div>
${body}
  </div>
);
`;

const check = (body: string) => checkPropConformance(story(body), { storiesDir });

describe('checkPropConformance', () => {
  it('rejects a prop the component omits, and names the declared one', () => {
    const r = check(`<Switch label="Tide alerts" checked onChange={() => {}} />`);
    expect(r.ran).toBe(true);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ kind: 'unknown_prop', component: 'Switch', prop: 'onChange', suggestion: 'onCheckedChange' });
    expect(r.violations[0].message).toContain('did you mean `onCheckedChange`');
    expect(r.violations[0].message).toContain('plus standard HTML attributes');
    expect(formatPropConformanceErrors(r)[0]).toMatch(/^Line \d+: <Switch onChange>/);
  });

  it('accepts the HTML attributes the props type extends, and key/ref/data-*/aria-*', () => {
    const r = check(`<Switch key="a" label="x" checked onCheckedChange={() => {}} className="c" style={{}} id="i" disabled onClick={() => {}} aria-label="x" data-testid="t" tabIndex={0} />`);
    expect(r.violations).toEqual([]);
    expect(r.judged).toBe(1);
    expect(r.components.find(c => c.tag === 'Switch')?.verdict).toBe('closed');
  });

  it('rejects a spread hidden behind a cast, naming the invented keys', () => {
    const r = check(`<Switch label="x" {...({ checked: true, isChecked: true, onValueChange: () => {} } as any)} />`);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].kind).toBe('hidden_props');
    expect(r.violations[0].message).toContain('props are declared on the component; do not hide them behind a cast');
    expect(r.violations[0].message).toContain('`isChecked` (did you mean `checked`?)');
    expect(r.violations[0].message).toContain('`onValueChange` (did you mean `onCheckedChange`?)');
    expect(r.violations[0].message).not.toContain('`checked` (');
  });

  it('treats `as unknown as` and `as never` as the same cast', () => {
    expect(check(`<Switch label="x" {...({ isChecked: true } as unknown as object)} />`).violations[0]?.kind).toBe('hidden_props');
    expect(check(`<Switch label="x" {...({ isChecked: true } as never)} />`).violations[0]?.kind).toBe('hidden_props');
  });

  it('judges the keys of an uncast inline object spread, and leaves an identifier spread alone', () => {
    const r = check(`<Switch label="x" {...{ selected: true }} />`);
    expect(r.violations.map(v => v.prop)).toEqual(['selected']);
    const ok = check(`<Switch label="x" checked onCheckedChange={() => {}} {...rest} />`);
    expect(ok.violations).toEqual([]);
  });

  it('skips an open prop set (index signature) and says so', () => {
    const r = check(`<Loose title="t" anything="goes" />`);
    expect(r.violations).toEqual([]);
    expect(r.judged).toBe(0);
    expect(r.components).toEqual([{ tag: 'Loose', verdict: 'open', reason: expect.stringContaining('index signature') }]);
    expect(summarisePropConformance(r)).toContain('skipped Loose (open');
    expect(summarisePropConformance(r)).toContain('skipped, not passed');
  });

  it('skips a component whose props are any, and an import that does not resolve', () => {
    const r = check(`<Untyped whatever />`);
    expect(r.violations).toEqual([]);
    expect(r.components[0]).toMatchObject({ tag: 'Untyped', verdict: 'unknown' });

    const missing = checkPropConformance(`import { Ghost } from './nowhere';\nexport const S = () => <Ghost foo />;`, { storiesDir });
    expect(missing.ran).toBe(true);
    expect(missing.violations).toEqual([]);
    expect(missing.components[0]).toMatchObject({ tag: 'Ghost', verdict: 'unknown' });
  });

  it('judges a compound tag by its member', () => {
    const r = check(`<Menu.Item value="a" disabled selected />`);
    expect(r.violations.map(v => `${v.component}.${v.prop}`)).toEqual(['Menu.Item.selected']);
  });

  it('resolves a polymorphic component for the element it renders as', () => {
    // `href` is legal on <Poly as="a">, not on a bare <Poly>.
    expect(check(`<Poly as="a" href="/x" />`).violations).toEqual([]);
    expect(check(`<Poly href="/x" />`).violations.map(v => v.prop)).toEqual(['href']);
  });

  it('reads the ceiling from the tag, not from the attributes the story wrote', () => {
    // A bad prop must not push overload resolution onto an open signature
    // and hide itself: the bad prop and a correct one are judged the same way.
    const bad = check(`<Poly as="a" href="/x" alignItems="center" />`);
    expect(bad.violations.map(v => v.prop)).toEqual(['alignItems']);
    expect(bad.components[0].verdict).toBe('closed');
  });

  it('leaves intrinsic elements to TypeScript', () => {
    expect(check(`<div notAThing="x"><span alsoNot /></div>`).violations).toEqual([]);
  });

  it('reports that it could not run when no JSX types are reachable', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-no-react-'));
    try {
      fs.writeFileSync(path.join(bare, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', types: [], noLib: true } }));
      const r = checkPropConformance(`export const S = () => <Thing x />;`, { storiesDir: bare });
      expect(r.ran).toBe(false);
      expect(r.reason).toMatch(/JSX type declarations/);
      expect(summarisePropConformance(r)).toContain('could not run');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('nearestProp', () => {
  const own = ['label', 'checked', 'onCheckedChange', 'value', 'isSelected', 'slotProps', 'primary'];
  it('prefers a declared prop that shares words', () => {
    expect(nearestProp('onChange', own)).toBe('onCheckedChange');
    expect(nearestProp('isChecked', own)).toBe('checked');
    expect(nearestProp('selectedValue', own)).toBe('value');
    expect(nearestProp('selected', own)).toBe('isSelected');
    expect(nearestProp('inputProps', own)).toBe('slotProps');
  });
  it('suggests a standard attribute only as a near-typo', () => {
    const html = ['className', 'aria-label', 'content', 'onClick'];
    expect(nearestProp('classname', [], html)).toBe('className');
    expect(nearestProp('ariaLabel', [], html)).toBe('aria-label');
    expect(nearestProp('justifyContent', [], html)).toBeUndefined();
  });
  it('says nothing when nothing is close', () => {
    expect(nearestProp('alignItems', own)).toBeUndefined();
  });
});

describe('rewriteGlobalJsxNamespace', () => {
  it('removes `: JSX.Element` return annotations on every function form', () => {
    const src = `import React from 'react';
const A = (): JSX.Element => <div />;
function B(): JSX.Element | null { return null; }
const C = function (): JSX.Element { return <div />; };
const D = { render(): JSX.Element { return <div />; } };
`;
    const r = rewriteGlobalJsxNamespace(src);
    expect(r.removed).toBe(4);
    expect(r.code).not.toContain('JSX.Element');
    expect(r.code).toContain('const A = () => <div />;');
    expect(r.code).toContain('function B() { return null; }');
    expect(r.code).toContain('render() { return <div />; }');
  });

  it('qualifies other bare JSX references when React is bound, and leaves React.JSX alone', () => {
    const r = rewriteGlobalJsxNamespace(`import * as React from 'react';
type Row = { icon: JSX.Element; render: () => React.JSX.Element };
const cell = (): React.JSX.Element => <td />;
`);
    expect(r.qualified).toBe(1);
    expect(r.removed).toBe(0);
    expect(r.code).toContain('icon: React.JSX.Element');
    expect(r.code).toContain('() => React.JSX.Element');
    expect(r.code).not.toContain('React.React.');
  });

  it('is a no-op on code that needs nothing', () => {
    const src = `import React from 'react';\nexport const A = () => <div />;\n`;
    expect(rewriteGlobalJsxNamespace(src)).toEqual({ code: src, removed: 0, qualified: 0 });
  });
});
