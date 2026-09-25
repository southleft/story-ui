import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  EMPTY_CANVAS_CODE, parseCanvas, setAttr, setText, insertChild, removeNode, describeNode, moveNode,
} from '../story-generator/voice/canvasTree.js';
import {
  templatesFromStorySource, templatesFromExamples, slotsOf, fillSlots, printTemplate, uniquifyIds, templatesFor,
} from '../story-generator/voice/templates.js';
import { spanCandidates, words, asDisplayText, valueSpans } from '../story-generator/voice/spans.js';
import { globalsFromPreviewSource } from '../story-generator/voice/storybookGlobals.js';
import { decideVoiceEdit, stripLeadingFiller, type CatalogComponent, type EditablePropInfo } from '../story-generator/voice/decide.js';
import type { JevQuestion, JevResponse } from '../story-generator/voice/jevClient.js';

// ────────────────────────────────────────────────────────────────
// canvasTree
// ────────────────────────────────────────────────────────────────

const CARD_CODE = `const Canvas = () => {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a teammate</CardTitle>
      </CardHeader>
      <CardContent>
        <Input type="email" placeholder="example@" />
        <Button variant="default" onClick={() => setOpen(true)}>Submit</Button>
      </CardContent>
    </Card>
  );
};

render(<Canvas />);
`;

describe('parseCanvas', () => {
  it('indexes every element the Canvas returns, in document order', () => {
    const tree = parseCanvas(CARD_CODE);
    expect(tree.nodes.map(n => n.tag)).toEqual(['Card', 'CardHeader', 'CardTitle', 'CardContent', 'Input', 'Button']);
    expect(tree.nodes[2].text).toBe('Invite a teammate');
    expect(tree.nodes[4].attrs).toEqual({ type: 'email', placeholder: 'example@' });
    // An expression-valued attribute is known to exist but has no literal value.
    expect(tree.nodes[5].attrs).toEqual({ variant: 'default' });
    expect(tree.nodes[5].attrRanges.onClick).toBeDefined();
  });

  it('reads an empty canvas as a fragment with no elements', () => {
    const tree = parseCanvas(EMPTY_CANVAS_CODE);
    expect(tree.root?.tag).toBe('');
    expect(tree.nodes).toHaveLength(1);
  });

  it('returns no root for code without a Canvas', () => {
    expect(parseCanvas('render(<div />)').root).toBeNull();
  });

  it('describes an element the way a person would name it', () => {
    const tree = parseCanvas(CARD_CODE);
    expect(describeNode(tree, tree.nodes[4])).toBe('Input (type="email", placeholder="example@") inside CardContent');
    expect(describeNode(tree, tree.nodes[5])).toContain('Button "Submit"');
  });
});

describe('canvas edits', () => {
  it('replaces one attribute and nothing else', () => {
    const tree = parseCanvas(CARD_CODE);
    const out = setAttr(tree, 'e4', 'placeholder', 'email address');
    expect(out).toContain('<Input type="email" placeholder="email address" />');
    expect(out.replace('email address', 'example@')).toBe(CARD_CODE);
  });

  it('adds, sets boolean and removes attributes', () => {
    const tree = parseCanvas(CARD_CODE);
    const added = setAttr(tree, 'e4', 'disabled', true);
    expect(added).toContain('<Input disabled type="email"');
    const off = setAttr(parseCanvas(added), 'e4', 'disabled', false);
    expect(off).toContain('<Input disabled={false} type="email"');
    const removed = setAttr(parseCanvas(off), 'e4', 'disabled', null);
    expect(removed).toBe(CARD_CODE);
  });

  it('replaces text, including on a self-closing element', () => {
    const tree = parseCanvas(CARD_CODE);
    expect(setText(tree, 'e5', 'Send')).toContain('setOpen(true)}>Send</Button>');
    const withSelf = parseCanvas(CARD_CODE.replace('<Button variant="default" onClick={() => setOpen(true)}>Submit</Button>', '<Button variant="default" />'));
    expect(setText(withSelf, 'e5', 'Go')).toContain('<Button variant="default">Go</Button>');
  });

  it('refuses to set text on an element that holds elements', () => {
    expect(() => setText(parseCanvas(CARD_CODE), 'e3', 'x')).toThrow(/holds elements/);
  });

  it('inserts a child with the parent\'s indentation', () => {
    const out = insertChild(parseCanvas(CARD_CODE), 'e3', '<Checkbox id="terms" />');
    expect(out).toContain('        <Button variant="default" onClick={() => setOpen(true)}>Submit</Button>\n        <Checkbox id="terms" />\n      </CardContent>');
    expect(parseCanvas(out).nodes.map(n => n.tag)).toContain('Checkbox');
  });

  it('inserts into an empty canvas', () => {
    const out = insertChild(parseCanvas(EMPTY_CANVAS_CODE), null, '<Card>\n  <CardTitle>Hi</CardTitle>\n</Card>');
    const tree = parseCanvas(out);
    expect(tree.nodes.map(n => n.tag)).toEqual(['', 'Card', 'CardTitle']);
    expect(out).toContain('    <>\n      <Card>\n        <CardTitle>Hi</CardTitle>\n      </Card>\n    </>');
  });

  it('moves an element among its siblings', () => {
    const three = insertChild(parseCanvas(CARD_CODE), 'e3', '<Checkbox id="terms" />');
    // CardContent (e3): Input e4, Button e5, Checkbox e6
    const up = moveNode(parseCanvas(three), 'e5', 'up');
    expect(parseCanvas(up).nodes.filter(n => n.parent === 'e3').map(n => n.tag)).toEqual(['Button', 'Input', 'Checkbox']);
    const first = moveNode(parseCanvas(three), 'e6', 'first');
    expect(parseCanvas(first).nodes.filter(n => n.parent === 'e3').map(n => n.tag)).toEqual(['Checkbox', 'Input', 'Button']);
    const last = moveNode(parseCanvas(three), 'e4', 'last');
    expect(parseCanvas(last).nodes.filter(n => n.parent === 'e3').map(n => n.tag)).toEqual(['Button', 'Checkbox', 'Input']);
    expect(() => moveNode(parseCanvas(three), 'e4', 'up')).toThrow(/already first/);
  });

  it('removes an element and its line', () => {
    const out = removeNode(parseCanvas(CARD_CODE), 'e4');
    expect(out).not.toContain('Input');
    expect(out).toContain('<CardContent>\n        <Button');
  });
});

// ────────────────────────────────────────────────────────────────
// templates
// ────────────────────────────────────────────────────────────────

const CHECKBOX_STORIES = `
import type { Meta, StoryObj } from '@storybook/react'
import { Check } from 'lucide-react'
import { Checkbox } from './checkbox'
import { Label } from '@/components/label/label'

const meta: Meta<typeof Checkbox> = { title: 'Form/Checkbox', component: Checkbox, args: { disabled: false } }
export default meta
type Story = StoryObj<typeof Checkbox>

export const Default: Story = {}
export const Checked: Story = { args: { defaultChecked: true } }
export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="terms" onCheckedChange={() => {}} />
      <Label htmlFor="terms">Accept terms and conditions</Label>
      <Check />
    </div>
  ),
}
export const Spread: Story = {
  args: { disabled: true },
  render: (args) => <Checkbox {...args} id="s" />,
}
`;

describe('templatesFromStorySource', () => {
  const known = new Set(['Checkbox', 'Label']);
  const templates = templatesFromStorySource(CHECKBOX_STORIES, 'Checkbox', known);

  it('reads args stories and render stories, keeping only portable parts', () => {
    const printed = templates.map(t => printTemplate(t.root));
    // A default restated in meta args (disabled: false) is not part of the example.
    expect(printed).toContain('<Checkbox defaultChecked />');
    expect(printed.join('\n')).not.toContain('disabled={false}');
    // The icon from another package and the handler are dropped; the layout div stays.
    expect(printed).toContain('<div className="flex items-center gap-2">\n  <Checkbox id="terms" />\n  <Label htmlFor="terms">Accept terms and conditions</Label>\n</div>');
    // {...args} is resolved from the story's literal args.
    expect(printed).toContain('<Checkbox id="s" disabled />');
  });

  it('skips a story with nothing to render', () => {
    expect(templates.find(t => t.name === 'Default')).toBeDefined(); // meta args only
  });

  it('reads config example strings', () => {
    const t = templatesFromExamples(['<Button variant="secondary">Secondary</Button>'], 'Button', new Set(['Button']));
    expect(printTemplate(t[0].root)).toBe('<Button variant="secondary">Secondary</Button>');
  });
});

describe('slots', () => {
  const root = templatesFromStorySource(CHECKBOX_STORIES, 'Checkbox', new Set(['Checkbox', 'Label']))
    .find(t => t.name === 'WithLabel')!.root;

  it('finds the words a request can supply, and not ids or classes', () => {
    expect(slotsOf(root)).toEqual([{ role: 'Label.text', tag: 'Label', field: 'text', example: 'Accept terms and conditions' }]);
  });

  it('fills slots by role', () => {
    expect(printTemplate(fillSlots(root, { 'Label.text': 'Send welcome email' }))).toContain('<Label htmlFor="terms">Send welcome email</Label>');
  });

  it('keeps ids unique across repeated adds', () => {
    const renamed = uniquifyIds(root, '<Checkbox id="terms" />');
    const printed = printTemplate(renamed);
    expect(printed).toContain('id="terms-2"');
    expect(printed).toContain('htmlFor="terms-2"');
  });
});

// ────────────────────────────────────────────────────────────────
// spans
// ────────────────────────────────────────────────────────────────

describe('spanCandidates', () => {
  it('lists every contiguous run of words, shortest first', () => {
    expect(spanCandidates('make it send')).toEqual(['make', 'it', 'send', 'make it', 'it send', 'make it send']);
  });

  it('strips punctuation at word edges and keeps apostrophes', () => {
    expect(words('Say "hello, world!" — don\'t.')).toEqual(['Say', 'hello', 'world', 'don\'t']);
  });

  it('caps to fit a Choice', () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    expect(spanCandidates(long).length).toBeLessThanOrEqual(254);
  });

  it('rules out spans that name the field or element, and the whole request', () => {
    const v = valueSpans('The text should be send', 'Button', 'text');
    expect(v).toContain('send');
    expect(v).not.toContain('The text should be send');
    expect(v.some(s => /\btext\b/i.test(s))).toBe(false);
    expect(valueSpans('Add a send button', 'Button', 'text')).not.toContain('send button');
    expect(valueSpans('Change the placeholder text to email address', 'Input', 'placeholder')).toContain('email address');
    // A one- or two-word request can be its own value.
    expect(valueSpans('Send', 'Button', 'text')).toEqual(['Send']);
  });

  it('capitalises only the first letter for display', () => {
    expect(asDisplayText('send welcome email')).toBe('Send welcome email');
  });
});

// ────────────────────────────────────────────────────────────────
// decideVoiceEdit — the demo script, with Jev scripted
// ────────────────────────────────────────────────────────────────

/**
 * A stand-in for Jev: answers the questions named in `script` confidently and
 * everything else with low confidence, the way an unstated question comes back.
 */
function scripted(given: Record<string, string | number>) {
  // Requests are complete sentences unless a test says otherwise.
  const script: Record<string, string | number> = { complete: 0.95, instruction: 0.95, ...given };
  const calls: Array<Record<string, JevQuestion>> = [];
  const ask = async (_state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> => {
    calls.push(questions);
    const answers: JevResponse['answers'] = {};
    for (const [id, q] of Object.entries(questions)) {
      const want = script[id];
      if (q.type === 'noul') {
        answers[id] = { type: 'noul', noul: typeof want === 'number' ? want : 0.1 };
      } else if (q.type === 'choice') {
        const options = Object.keys(q.criteria);
        if (typeof want === 'string' && !options.includes(want)) throw new Error(`${id}: "${want}" is not an option (${options.slice(0, 8).join(', ')}…)`);
        const pick = typeof want === 'string' ? want : options.includes('none') ? 'none' : options[0];
        answers[id] = { type: 'choice', choice: pick, probabilities: { [pick]: 0.9 }, confidence: typeof want === 'string' ? 0.9 : 0.3 };
      }
    }
    return { model: 'jev-test', answers, usage: { input_tokens: 1000, output_tokens: 10 }, ms: 5 };
  };
  return { ask, calls };
}

describe('decideVoiceEdit', () => {
  let dir: string;
  let catalog: CatalogComponent[];
  const props: Record<string, EditablePropInfo[]> = {
    Button: [{ name: 'variant', kind: 'enum', options: ['default', 'secondary', 'destructive'] }, { name: 'disabled', kind: 'boolean' }],
    Input: [{ name: 'placeholder', kind: 'string' }, { name: 'disabled', kind: 'boolean' }],
    Checkbox: [{ name: 'defaultChecked', kind: 'boolean' }, { name: 'disabled', kind: 'boolean' }],
  };
  const ctx = (ask: any) => ({ catalog, propsFor: async (n: string) => props[n] ?? [], ask, threshold: 0.5 });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));
    const write = (name: string, source: string, stories?: string) => {
      fs.mkdirSync(path.join(dir, name), { recursive: true });
      fs.writeFileSync(path.join(dir, name, `${name}.tsx`), source);
      if (stories) fs.writeFileSync(path.join(dir, name, `${name}.stories.tsx`), stories);
      return path.join(dir, name, `${name}.tsx`);
    };
    catalog = [
      {
        name: 'Card', description: 'Container for grouped content', filePath: write('card', 'export const Card = () => null', `
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card'
import { Button } from '@/components/button/button'
import { Input } from '@/components/input/input'
const meta = { component: Card }
export default meta
export const Default = { render: () => (
  <Card>
    <CardHeader>
      <CardTitle>Create project</CardTitle>
      <CardDescription>Deploy in one click.</CardDescription>
    </CardHeader>
    <CardContent><Input placeholder="Name" /></CardContent>
    <CardFooter><Button>Deploy</Button></CardFooter>
  </Card>
) }`),
      },
      { name: 'CardHeader', filePath: path.join(dir, 'card', 'card.tsx') },
      { name: 'CardTitle', filePath: path.join(dir, 'card', 'card.tsx') },
      { name: 'CardDescription', filePath: path.join(dir, 'card', 'card.tsx') },
      { name: 'CardContent', filePath: path.join(dir, 'card', 'card.tsx') },
      { name: 'CardFooter', filePath: path.join(dir, 'card', 'card.tsx') },
      { name: 'Button', description: 'Interactive button', examples: ['<Button>Submit</Button>'] },
      { name: 'Input', description: 'Text input field', props: ['type', 'placeholder'], examples: ['<Input type="email" placeholder="example@" />'] },
      { name: 'Label', examples: ['<Label>Label</Label>'] },
      { name: 'Checkbox', description: 'Checkbox input', filePath: write('checkbox', 'export const Checkbox = () => null', CHECKBOX_STORIES) },
    ];
  });

  it('adds a card from the team\'s story, with the title and description the person said', async () => {
    const said = 'Add a card titled Invite a teammate and a description saying give someone access to your account';
    // "card" is said outright, so the Card's questions ride in the first call.
    const { ask, calls } = scripted({
      action: 'add', component: 'Card',
      'add:Card.slot:CardTitle.text': 'Invite a teammate', 'add:Card.said:CardTitle.text': 0.95,
      'add:Card.slot:CardDescription.text': 'give someone access to your account', 'add:Card.said:CardDescription.text': 0.95,
    });
    const out = await decideVoiceEdit({ transcript: said, code: EMPTY_CANVAS_CODE }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind !== 'applied') return;
    expect(out.code).toContain('<CardTitle>Invite a teammate</CardTitle>');
    expect(out.code).toContain('<CardDescription>Give someone access to your account</CardDescription>');
    // Unstated slots keep the team's example text rather than inventing any.
    expect(out.code).toContain('<Button>Deploy</Button>');
    // Two calls, in parallel: the add questions carry only the words said,
    // so the canvas outline cannot distract them. Wall-clock is one round trip.
    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[1]).every(k => k.startsWith('add:Card.'))).toBe(true);
    expect(out.stats.ms).toBe(5);
  });

  it('puts a new input in the part of the card its stories put inputs in', async () => {
    const code = insertChild(parseCanvas(EMPTY_CANVAS_CODE), null, '<Card>\n  <CardHeader>\n    <CardTitle>Invite</CardTitle>\n  </CardHeader>\n</Card>');
    const { ask } = scripted({ action: 'add', component: 'Input', parent: 'e1' });
    const out = await decideVoiceEdit({ transcript: 'Add an email input', code }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind !== 'applied') return;
    expect(out.code).toMatch(/<CardContent>\s*<Input type="email" placeholder="example@" \/>\s*<\/CardContent>/);
    expect(out.steps.find(s => s.step === 'Placement')?.value).toBe('a new CardContent');
  });

  it('changes a placeholder to the words that were said', async () => {
    const { ask } = scripted({ action: 'edit', target: 'e4', change: 'prop:placeholder', 'v:placeholder': 'email address' });
    const out = await decideVoiceEdit({ transcript: 'Change the placeholder text to email address', code: CARD_CODE }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).toContain('placeholder="email address"');
  });

  it('asks the edit questions in the same call when the person is pointing', async () => {
    const { ask, calls } = scripted({ action: 'edit', 'edit.change': 'text', 'edit.text': 'send' });
    const out = await decideVoiceEdit({ transcript: 'The text should be send', code: CARD_CODE, pointer: 'e5' }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).toContain('>Send</Button>');
    expect(calls).toHaveLength(1);
    expect(calls[0].target).toBeUndefined();
  });

  it('turns a boolean on', async () => {
    const code = insertChild(parseCanvas(CARD_CODE), 'e3', '<Checkbox id="terms" />');
    const { ask } = scripted({ action: 'edit', target: 'e6', change: 'prop:defaultChecked', 'v:defaultChecked': 'on' });
    const out = await decideVoiceEdit({ transcript: 'Check the box by default', code }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).toContain('<Checkbox defaultChecked id="terms" />');
  });

  it('edits an attribute the stories use even when the types declare nothing', async () => {
    // Checkbox's declared props are empty in this catalog (Radix primitive),
    // but its own stories set defaultChecked — the code states it works.
    const code = insertChild(parseCanvas(CARD_CODE), 'e3', '<Checkbox id="terms" />');
    const { ask, calls } = scripted({ action: 'edit', target: 'e6', change: 'prop:defaultChecked', 'v:defaultChecked': 'on' });
    const out = await decideVoiceEdit({ transcript: 'Check the box by default', code }, { ...ctx(ask), propsFor: async () => [] });
    expect(out.kind).toBe('applied');
    expect(Object.keys((calls[1].change as any).criteria)).toContain('prop:defaultChecked');
    // A Checkbox is never given text of its own: no story does it.
    expect(Object.keys((calls[1].change as any).criteria)).not.toContain('text');
  });

  it('offers the attributes an element already has', async () => {
    const { ask, calls } = scripted({ action: 'edit', target: 'e4', change: 'prop:placeholder', 'v:placeholder': 'email address' });
    const out = await decideVoiceEdit({ transcript: 'Change the placeholder to email address', code: CARD_CODE }, { ...ctx(ask), propsFor: async () => [] });
    expect(out.kind).toBe('applied');
    // Input's catalog props omit children, so its text is not on offer.
    expect(Object.keys((calls[1].change as any).criteria)).not.toContain('text');
  });

  it('fills each spoken phrase into one slot only', async () => {
    const stories = `
const meta = { component: Card }
export default meta
export const Default = { render: () => (
  <Card><CardHeader><CardTitle>T</CardTitle><CardDescription>D</CardDescription></CardHeader><CardContent><p>Body</p></CardContent></Card>
) }`;
    const file = path.join(dir, 'card2', 'card2.tsx');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    fs.writeFileSync(path.join(dir, 'card2', 'card2.stories.tsx'), stories);
    const cat = [{ name: 'Card', filePath: file }, { name: 'CardHeader' }, { name: 'CardTitle' }, { name: 'CardDescription' }, { name: 'CardContent' }];
    const phrase = 'give someone access';
    const { ask } = scripted({
      action: 'add', component: 'Card',
      'add:Card.slot:CardDescription.text': phrase, 'add:Card.said:CardDescription.text': 0.9,
      'add:Card.slot:p.text': phrase, 'add:Card.said:p.text': 0.9,
    });
    const out = await decideVoiceEdit({ transcript: `add a card saying ${phrase}`, code: EMPTY_CANVAS_CODE }, { catalog: cat, propsFor: async () => [], ask });
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code.match(/Give someone access/g)).toHaveLength(1);
  });

  it('reads an unnamed element as the one just changed, and reports what it touched', async () => {
    const added = insertChild(parseCanvas(CARD_CODE), 'e3', '<div>\n  <Checkbox id="terms" />\n  <Label htmlFor="terms">Accept terms</Label>\n</div>');
    // e6 is the div just added; its Label is e8.
    // The just-added subtree's edit questions are asked in the same call.
    const { ask, calls } = scripted({ action: 'edit', target: 'e2', names_element: 0.1, recent_target: 'e8', 'recent:e8.change': 'text', 'recent:e8.text': 'send welcome email' });
    const out = await decideVoiceEdit({ transcript: 'Update the text to say send welcome email', code: added, recent: 'e6' }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind !== 'applied') return;
    expect(out.code).toContain('<Label htmlFor="terms">Send welcome email</Label>');
    expect(out.touched).toBe('e8');
    expect(calls).toHaveLength(1);
  });

  it('prefers the element the request names over the one just changed', async () => {
    const { ask } = scripted({ action: 'edit', target: 'e4', names_element: 0.9, recent_target: 'e5', 'recent:e4.change': 'prop:placeholder', 'recent:e4.v:placeholder': 'email address' });
    const out = await decideVoiceEdit({ transcript: 'Change the email field placeholder to email address', code: CARD_CODE, recent: 'e3' }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).toContain('placeholder="email address"');
  });

  it('waits when the request stops mid-sentence, and decides when told the person is done', async () => {
    const half = await decideVoiceEdit({ transcript: 'update the title to say', code: CARD_CODE }, ctx(scripted({ action: 'edit', complete: 0.1 }).ask));
    expect(half.kind).toBe('incomplete');
    const done = await decideVoiceEdit({ transcript: 'update the title to say', code: CARD_CODE, final: true }, ctx(scripted({ action: 'edit', complete: 0.1 }).ask));
    expect(done.kind).not.toBe('incomplete');
  });

  it('switches a preview setting the project declares, with no code change', async () => {
    const globals = [{ name: 'theme', items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }] }];
    const { ask, calls } = scripted({ action: 'setting', setting: 'theme=dark' });
    const out = await decideVoiceEdit({ transcript: 'Black UI', code: CARD_CODE }, { ...ctx(ask), globals });
    expect(out).toMatchObject({ kind: 'setting', globals: { theme: 'dark' } });
    expect(Object.keys((calls[0].action as any).criteria)).toContain('setting');
  });

  it('offers no setting action when the project declares none', async () => {
    const { calls } = scripted({ action: 'none' });
    const s = scripted({ action: 'none' });
    await decideVoiceEdit({ transcript: 'dark mode', code: CARD_CODE }, ctx(s.ask));
    expect(Object.keys((s.calls[0].action as any).criteria)).not.toContain('setting');
    expect(calls).toHaveLength(0);
  });

  it('reads an ambiguous "the button" as the button just added', async () => {
    const code = insertChild(parseCanvas(CARD_CODE), 'e3', '<Button>Send</Button>');
    // e5 is the existing Submit button; e6 the Send button just added. Jev
    // leans to the wrong one, unsurely — the recent one of the same kind wins.
    const { ask } = scripted({ action: 'edit', target: 'e5', names_element: 0.9, 'recent:e6.change': 'prop:disabled', 'recent:e6.v:disabled': 'on' });
    const fixed = await decideVoiceEdit({ transcript: 'Disable the button', code, recent: 'e6' }, ctx(async (st: unknown, q: any) => {
      const r = await ask(st, q);
      if (r.answers.target?.type === 'choice') (r.answers.target as any).confidence = 0.68;
      return r;
    }));
    expect(fixed.kind).toBe('applied');
    if (fixed.kind === 'applied') {
      expect(fixed.code).toContain('<Button disabled>Send</Button>');
      expect(fixed.code).toContain('setOpen(true)}>Submit</Button>');
    }
  });

  it('keeps the element a request names by its own words', async () => {
    const code = insertChild(parseCanvas(CARD_CODE), 'e3', '<Button>Send</Button>');
    const { ask } = scripted({ action: 'edit', target: 'e5', names_element: 0.9, singles_out: 0.3, change: 'prop:disabled', 'v:disabled': 'on' });
    const out = await decideVoiceEdit({ transcript: 'Disable the submit button', code, recent: 'e6' }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).toContain('<Button disabled variant="default"');
  });

  it('hands an undocumented container given several texts to the model', async () => {
    const cat = [{ name: 'Panel', props: ['children'] }];
    const { ask } = scripted({ action: 'add', component: 'Panel', 'add:Panel.multi': 0.9, 'add:Panel.slot:Panel.text': 'Invite', 'add:Panel.said:Panel.text': 0.9 });
    const out = await decideVoiceEdit({ transcript: 'add a panel titled Invite with a description saying hello', code: EMPTY_CANVAS_CODE }, { catalog: cat, propsFor: async () => [], ask });
    expect(out).toMatchObject({ kind: 'fallback' });
  });

  it('strips the joining words continuous speech starts with', () => {
    expect(stripLeadingFiller('and then add an image above the title')).toBe('add an image above the title');
    expect(stripLeadingFiller('okay so, add a checkbox')).toBe('add a checkbox');
    expect(stripLeadingFiller('and')).toBe('and');
    expect(stripLeadingFiller('Android button')).toBe('Android button');
  });

  it('settles an unsure add-or-edit with the new-element question', async () => {
    const edit = scripted({ action: 'edit', new_element: 0.05, target: 'e5', change: 'text', text: 'submit' });
    const out = await decideVoiceEdit({ transcript: 'and make the button say submit', code: CARD_CODE }, ctx(async (st: unknown, q: any) => {
      const r = await edit.ask(st, q);
      const a = r.answers.action as any;
      if (a) { a.confidence = 0.48; a.probabilities = { edit: 0.53, add: 0.47 }; }
      return r;
    }));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).toContain('>Submit</Button>');
  });

  it('sets a text prop the request names even when Jev calls the change "other"', async () => {
    const { ask } = scripted({ action: 'edit', target: 'e4', change: 'other', 'v:placeholder': 'your email' });
    const out = await decideVoiceEdit({ transcript: 'add the placeholder your email above the field', code: CARD_CODE }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).toContain('placeholder="your email"');
  });

  it('moves the element a request names, with no model', async () => {
    const { ask } = scripted({ action: 'compose', move_dir: 'up', target: 'e5' });
    const out = await decideVoiceEdit({ transcript: 'move the submit button up', code: CARD_CODE }, ctx(async (st: unknown, q: any) => {
      const r = await ask(st, q);
      if (r.answers.move_dir) (r.answers.move_dir as any).confidence = 0.99;
      return r;
    }));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code.indexOf('<Button')).toBeLessThan(out.code.indexOf('<Input'));
  });

  it('ignores conversation instead of sending it to the model', async () => {
    const { ask } = scripted({ action: 'edit', instruction: 0.1, target: 'e5' });
    const out = await decideVoiceEdit({ transcript: 'check out the logs and let me know what you think', code: CARD_CODE }, ctx(ask));
    expect(out.kind).toBe('ignored');
  });

  it('still runs a command that is not a design instruction', async () => {
    const { ask } = scripted({ action: 'save', instruction: 0.1 });
    expect((await decideVoiceEdit({ transcript: 'save it', code: CARD_CODE }, ctx(ask))).kind).toBe('command');
  });

  it('changes the field whose current value the request quotes', async () => {
    const code = CARD_CODE.replace('<Input type="email" placeholder="example@" />', '<Input label="Partner 1 Name" placeholder="Jordan Reyes" />');
    const { ask } = scripted({ action: 'edit', target: 'e4', change: 'prop:placeholder', 'v:label': 'my first name', 'v:placeholder': 'my first name' });
    const props = async () => [{ name: 'label', kind: 'string' as const }, { name: 'placeholder', kind: 'string' as const }];
    const out = await decideVoiceEdit({ transcript: "where it says partner one name make it say my first name", code }, { ...ctx(ask), propsFor: props });
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') {
      expect(out.code).toContain('label="My first name"');
      expect(out.code).toContain('placeholder="Jordan Reyes"');
    }
  });

  it('adds inside the card the request points at, and above an element when asked', async () => {
    const two = insertChild(parseCanvas(EMPTY_CANVAS_CODE), null, '<Card>\n  <CardHeader>\n    <CardTitle>One</CardTitle>\n  </CardHeader>\n</Card>\n<Card>\n  <CardHeader>\n    <CardTitle>Two</CardTitle>\n  </CardHeader>\n</Card>');
    // e1 Card(One) e2 header e3 title; e4 Card(Two) e5 header e6 title
    const inside = await decideVoiceEdit({ transcript: 'add an image to that card component', code: two, recent: 'e4' },
      ctx(scripted({ action: 'add', component: 'Input', place: 'inside' }).ask));
    expect(inside.kind).toBe('applied');
    if (inside.kind === 'applied') expect(inside.code.indexOf('<Input')).toBeGreaterThan(inside.code.indexOf('Two'));
    const above = await decideVoiceEdit({ transcript: 'add an input above the title', code: two },
      ctx(scripted({ action: 'add', component: 'Input', target: 'e3', place: 'before' }).ask));
    expect(above.kind).toBe('applied');
    if (above.kind === 'applied') {
      expect(above.code.indexOf('<Input')).toBeLessThan(above.code.indexOf('<CardTitle>One'));
      expect(above.code.indexOf('<Input')).toBeGreaterThan(above.code.indexOf('<CardHeader>'));
    }
  });

  it('gives a bare image a source, so it shows something', async () => {
    const cat = [{ name: 'Image' }];
    const { ask } = scripted({ action: 'add', component: 'Image' });
    const out = await decideVoiceEdit({ transcript: 'add an image of pasta', code: EMPTY_CANVAS_CODE },
      { catalog: cat, propsFor: async () => [{ name: 'src', kind: 'string' as const }, { name: 'alt', kind: 'string' as const }], ask });
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).toMatch(/<Image src="https:\/\/picsum\.photos\/seed\/pasta1\/800\/400"/);
  });

  it('hands a change no declared prop covers to the generative model', async () => {
    const { ask } = scripted({ action: 'edit', target: 'e5', change: 'other' });
    const out = await decideVoiceEdit({ transcript: 'Make the button full width', code: CARD_CODE }, ctx(ask));
    expect(out).toMatchObject({ kind: 'fallback' });
  });

  it('falls back when Jev is unsure what was asked', async () => {
    const { ask } = scripted({});
    const out = await decideVoiceEdit({ transcript: 'hmm', code: CARD_CODE }, ctx(ask));
    expect(out.kind).toBe('fallback');
  });

  it('returns commands and ignores chatter', async () => {
    expect((await decideVoiceEdit({ transcript: 'undo that', code: CARD_CODE }, ctx(scripted({ action: 'undo' }).ask))).kind).toBe('command');
    expect((await decideVoiceEdit({ transcript: 'uh let me think', code: CARD_CODE }, ctx(scripted({ action: 'none' }).ask))).kind).toBe('ignored');
    expect((await decideVoiceEdit({ transcript: 'two columns please', code: CARD_CODE }, ctx(scripted({ action: 'compose' }).ask))).kind).toBe('fallback');
  });

  it('removes the element the request names', async () => {
    const { ask } = scripted({ action: 'remove', target: 'e4' });
    const out = await decideVoiceEdit({ transcript: 'Remove the email field', code: CARD_CODE }, ctx(ask));
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.code).not.toContain('<Input');
  });

  it('offers at most 255 components, dropping compound parts first', async () => {
    const big: CatalogComponent[] = Array.from({ length: 300 }, (_, i) => ({ name: `Widget${String.fromCharCode(65 + (i % 26))}${i}` }));
    big.push({ name: 'Card' }, ...Array.from({ length: 10 }, (_, i) => ({ name: `CardPart${i}` })));
    const { ask, calls } = scripted({ action: 'none' });
    await decideVoiceEdit({ transcript: 'add a card', code: EMPTY_CANVAS_CODE }, { catalog: big, propsFor: async () => [], ask });
    const options = Object.keys((calls[0].component as any).criteria);
    expect(options.length).toBeLessThanOrEqual(255);
    expect(options).toContain('Card');
  });

  it('templatesFor falls back to the bare element only when nothing documents it', () => {
    const t = templatesFor({ name: 'Mystery', props: ['children'] }, new Set(['Mystery']));
    expect(printTemplate(t[0].root)).toBe('<Mystery>Mystery</Mystery>');
  });
});

describe('globalsFromPreviewSource', () => {
  it('reads toolbar globals with a closed set of items', () => {
    const src = `
const preview = {
  globalTypes: {
    theme: { description: 'Global theme', toolbar: { title: 'Theme', items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }] } },
    locale: { toolbar: { items: ['en', 'fr'] } },
    single: { toolbar: { items: ['only'] } },
  },
};
export default preview;`;
    expect(globalsFromPreviewSource(src)).toEqual([
      { name: 'theme', description: 'Global theme', title: 'Theme', items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }] },
      { name: 'locale', description: undefined, title: undefined, items: [{ value: 'en' }, { value: 'fr' }] },
    ]);
  });
});
