/**
 * What a container does to its children, read from the design system's own
 * stylesheet rather than assumed.
 *
 * Three of the six non-clean stories in a 20-prompt Carbon bench were one
 * defect: a control stretched by its parent — two buttons pulled to opposite
 * ends of a row, a tag rendered 121px wide. The prompt already carried a rule
 * about it, phrased as a convention ("a vertical stack stretches its
 * children"). The fact itself is one declaration in a file the token reader
 * already opens:
 *
 *     .cds--stack-vertical { display: grid; grid-auto-flow: row; }
 *
 * These tests pin the two things that make that derivation trustworthy: it
 * must find the real container, and it must stay silent rather than guess.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readLayoutBehaviour, formatLayoutBehaviour, layoutComponentsFrom } from '../story-generator/knowledge/stylingFacts.js';

let dir: string;
let sheet: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layoutcss-'));
  sheet = path.join(dir, 'styles.css');
  fs.writeFileSync(sheet, [
    // The real thing, copied from @carbon/styles.
    '.cds--stack-vertical { display: grid; grid-auto-flow: row; row-gap: var(--cds-stack-gap, 0); }',
    '.cds--stack-horizontal { display: inline-grid; grid-auto-flow: column; }',
    '.cds--css-grid { display: grid; grid-template-columns: repeat(16, 1fr); }',
    // Inner nodes that merely contain the component name.
    '.cds--modal-container { display: grid; grid-template-rows: auto 1fr auto; }',
    '.cds--toggletip-content { display: grid; }',
    '.cds--toggle__appearance { display: inline-grid; }',
    // A rule that is not a single class, and one with no layout at all.
    '.cds--btn .cds--btn__icon { display: flex; }',
    '.cds--tag { border-radius: 1rem; }',
  ].join('\n'));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const carbon = [
  { name: 'Stack', propTypes: ["'horizontal' | 'vertical'", 'string'],
    props: [{ name: 'orientation', type: "'horizontal' | 'vertical'" }, { name: 'gap', type: 'string' }] },
  { name: 'Grid', propTypes: ['boolean'] },
  { name: 'Modal', propTypes: ['boolean'] },
  { name: 'Toggletip', propTypes: ['boolean'] },
  { name: 'Toggle', propTypes: ['boolean'] },
  { name: 'Tag', propTypes: ['string'] },
];

describe('readLayoutBehaviour', () => {
  it('finds the container and reads its stretching from the declaration', () => {
    const out = readLayoutBehaviour([sheet], carbon);
    const stack = out.behaviours.find(b => b.component === 'Stack' && b.className === 'cds--stack-vertical');
    expect(stack).toBeDefined();
    expect(stack!.display).toBe('grid');
    expect(stack!.autoFlow).toBe('row');
    expect(stack!.stretchesChildren).toBe(true);
    // Flowing along the inline axis does not stretch a child's width.
    const horizontal = out.behaviours.find(b => b.className === 'cds--stack-horizontal');
    expect(horizontal!.stretchesChildren).toBe(false);
  });

  it('refuses a class that is an inner node rather than the component root', () => {
    // Each of these contains a component's name and declares display:grid, and
    // each names a box the story author never puts children into directly. The
    // first version of this reader emitted confident advice about all three.
    const out = readLayoutBehaviour([sheet], carbon);
    const named = out.behaviours.map(b => b.className);
    expect(named).not.toContain('cds--modal-container');
    expect(named).not.toContain('cds--toggletip-content');
    expect(named).not.toContain('cds--toggle__appearance');
    // The trailing segment is admitted only when the component declares it as
    // a value: Stack accepts orientation "vertical", Modal accepts no
    // "container".
    expect(named).toContain('cds--stack-vertical');
  });

  it('separates "matched nothing" from "read nothing"', () => {
    // A design system with hashed class names (CSS modules) matches nothing,
    // and that is a different fact from having no stylesheet at all. Both
    // produce no prompt text; only the log can tell them apart, so the log
    // line has to carry the difference.
    const hashed = path.join(dir, 'hashed.css');
    fs.writeFileSync(hashed, '.m-6d731127 { display: flex; flex-direction: column; }');
    const matchedNone = readLayoutBehaviour([hashed], carbon);
    expect(matchedNone.behaviours).toEqual([]);
    expect(matchedNone.rulesSeen).toBe(1);
    expect(matchedNone.source).toContain('1 single-class layout rule');

    const readNone = readLayoutBehaviour([], carbon);
    expect(readNone.rulesSeen).toBe(0);
    expect(readNone.source).toContain('no stylesheet was read');
    expect(formatLayoutBehaviour(readNone)).toBe('');
  });

  it('states the fact with the class it came from', () => {
    const text = formatLayoutBehaviour(readLayoutBehaviour([sheet], carbon));
    expect(text).toContain('<Stack>');
    expect(text).toContain('.cds--stack-vertical');
    expect(text).toContain('display: grid');
    expect(text).toContain('EVERY direct child stretches');
    // The second-order case: wrapping the controls in a row does not help,
    // because the row is a direct child too. Three measured failures were
    // exactly this, and the first version of this text recommended it.
    expect(text).toContain('Wrapping them in a row is NOT enough');
    expect(text).toContain("justifySelf: 'start'");
    // The rule alone was measured and was not enough: the model added the
    // stretch refusal only after the probe reported the defect, on three
    // prompts, every run. It copies examples more reliably than it applies
    // conditional prose, so the row it should copy carries the fix, written
    // with the prop the component itself declares.
    expect(text).toContain('COPY THIS for any row of controls inside <Stack>');
    expect(text).toContain(`<Stack orientation="horizontal" style={{ justifySelf: 'start' }}>`);
  });
});

describe('layoutComponentsFrom', () => {
  it('takes a prop\'s declared values from the catalog OR the extracted facts', () => {
    // The regression this exists to stop: two callers built this list
    // separately, one from a field that was populated and one from a field
    // that was not, so the same project derived Stack in the prompt and only
    // Grid in the pipeline — and the deterministic pass silently had nothing
    // to place for a whole run.
    const fromCatalog = layoutComponentsFrom(
      [{ name: 'Stack', propTypes: [{ name: 'orientation', type: "'horizontal' | 'vertical'" }] }],
    );
    expect(fromCatalog[0].props?.[0]).toMatchObject({ name: 'orientation' });
    expect(fromCatalog[0].propTypes).toContain("'horizontal' | 'vertical'");

    const fromFacts = layoutComponentsFrom(
      [{ name: 'Stack' }],
      { components: { Stack: { props: [{ name: 'orientation', options: ['horizontal', 'vertical'] }] } } },
    );
    expect(fromFacts[0].propValues).toEqual(['horizontal', 'vertical']);

    // Either source alone is enough to derive the horizontal row.
    for (const catalog of [fromCatalog, fromFacts]) {
      const out = readLayoutBehaviour([sheet], catalog);
      expect(out.behaviours.map(b => b.className)).toContain('cds--stack-horizontal');
    }
  });
});
