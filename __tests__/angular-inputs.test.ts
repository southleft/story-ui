/**
 * What Angular declares about itself, read from the declarations its own
 * compiler emits.
 *
 * The resolution bench measured Angular Material at 0 of 309 components with
 * known props, against 78-100% everywhere else, and the 309 was itself wrong:
 * it counted NgModules, injection tokens and test harnesses as components. A
 * catalog in that state offers a model `<MatButtonModule>` and
 * `<MAT_BUTTON_CONFIG>` — things no template can write — while saying nothing
 * about the components beside them.
 *
 * Every judgement here is made on a shape Angular or the CDK defines:
 * `ɵcmp`/`ɵdir` for a component, `ɵmod` for a module, `InjectionToken` for a
 * token, `static hostSelector` for a harness, `typeof X` for an alias. None of
 * them looks at a name.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readAngularDeclarations } from '../story-generator/knowledge/angularInputs.js';

const parse = (code: string) =>
  readAngularDeclarations(ts.createSourceFile('t.d.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));

describe('readAngularDeclarations', () => {
  it('reads an input, its template name and whether it is required', () => {
    const out = parse(`
import * as i0 from '@angular/core';
declare class MatButton {
    /** Appearance of the button. */
    get appearance(): MatButtonAppearance | null;
    set appearance(value: MatButtonAppearance | '');
    static ɵcmp: i0.ɵɵComponentDeclaration<MatButton, "button[matButton]", ["matButton"], { "appearance": { "alias": "matButton"; "required": true; }; }, {}, never, never, true, never>;
}
`);
    expect(out).toHaveLength(1);
    const input = out[0].inputs[0];
    // The name a template writes is the ALIAS, not the class property.
    expect(input.name).toBe('matButton');
    expect(input.property).toBe('appearance');
    expect(input.required).toBe(true);
    expect(input.doc).toBe('Appearance of the button.');
    expect(out[0].selector).toBe('button[matButton]');
  });

  it('marks an NgModule, an injection token and a test harness as not writable', () => {
    const out = parse(`
import * as i0 from '@angular/core';
declare class MatButtonModule {
    static ɵmod: i0.ɵɵNgModuleDeclaration<MatButtonModule, never, never, never>;
}
declare const MAT_BUTTON_CONFIG: InjectionToken<unknown>;
declare class MatButtonHarness extends ContentContainerComponentHarness {
    static hostSelector: string;
}
`);
    expect(out.find(c => c.name === 'MatButtonModule')?.isModule).toBe(true);
    expect(out.find(c => c.name === 'MAT_BUTTON_CONFIG')?.notWritable).toBe(true);
    // The harness is two hops from ComponentHarness, so its base class says
    // nothing here; `static hostSelector` is the CDK's own contract and does.
    expect(out.find(c => c.name === 'MatButtonHarness')?.notWritable).toBe(true);
  });

  it('reports an alias so it can take the props of what it aliases', () => {
    // `export declare const MatAnchor: typeof MatButton` is a real component
    // under a second name; reading only classes left every one with no props.
    const out = parse(`
declare class MatButton {}
declare const MatAnchor: typeof MatButton;
`);
    expect(out.find(c => c.name === 'MatAnchor')?.aliasOf).toBe('MatButton');
  });

  it('yields nothing for a file that declares no Angular component', () => {
    // The same walk runs over every file in every project, React included.
    expect(parse('export interface ButtonProps { size?: string }')).toEqual([]);
  });
});
