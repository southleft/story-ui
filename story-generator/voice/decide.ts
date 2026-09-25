/**
 * One spoken request → one canvas edit, decided by Jev and applied by code.
 *
 * TWO STAGES, each a single parallel Jev call:
 *
 *   1. WHAT and WHERE. The action (add, edit, remove, a command, or something
 *      only a generative model can do), the component an add names, the
 *      element the request is about, and where a new element belongs.
 *
 *   2. HOW. For an edit, which property of the chosen element changes and to
 *      what — asked for every property the component declares, with the
 *      declared values as options. For an add, which of the team's own story
 *      examples fits, and which of the person's words fill its text.
 *
 * Stage 2 cannot be asked speculatively for every element and component
 * without blowing through Jev's context budget, so it waits for stage 1. When
 * the person has pointed at an element the target is known up front and the
 * edit questions ride along in stage 1: one round trip.
 *
 * Nothing here writes JSX or text. Every value in the result is a declared
 * option, a template from the team's stories, or a verbatim span of what was
 * said. Anything that fits none of those — "make it full width" on a
 * Tailwind component, "rearrange this into two columns" — is handed back as a
 * FALLBACK for the LLM path, which is the right tool for it.
 */

import { askJev, JEV_USD_PER_INPUT_TOKEN, MAX_CHOICE_OPTIONS, type ChoiceAnswer, type JevAnswer, type JevQuestion, type JevResponse, type NoulAnswer } from './jevClient.js';
import { containers, describeNode, insertBeside, insertChild, moveNode, outlineCanvas, parseCanvas, removeNode, setAttr, setText, type CanvasNode, type CanvasTree, type MoveDirection } from './canvasTree.js';
import { attrsUsedInStories, fillSlots, printTemplate, slotsOf, summarizeTemplate, takesTextInStories, templatesFor, uniquifyIds, type Template, type TemplateNode, type TemplateSourceComponent } from './templates.js';
import { asDisplayText, NONE, valueSpans } from './spans.js';
import { saysMoreThanName } from '../knowledge/descriptionQuality.js';
import ts from 'typescript';
import type { StorybookGlobal } from './storybookGlobals.js';

// ── Public types ──────────────────────────────────────────────

export type VoiceCommandKind = 'undo' | 'redo' | 'clear' | 'save' | 'stop';

export interface DecisionStep {
  step: string;
  value: string;
  /** Who decided: Jev, or code reading a fact. */
  by: 'jev' | 'code';
  confidence?: number;
}

export interface DecisionStats {
  ms: number;
  calls: number;
  questions: number;
  inputTokens: number;
  usd: number;
  model?: string;
}

export type VoiceOutcome =
  | { kind: 'applied'; code: string; summary: string; touched: string | null; steps: DecisionStep[]; stats: DecisionStats }
  | { kind: 'command'; command: VoiceCommandKind; steps: DecisionStep[]; stats: DecisionStats }
  | { kind: 'fallback'; reason: string; steps: DecisionStep[]; stats: DecisionStats }
  | { kind: 'ignored'; reason: string; steps: DecisionStep[]; stats: DecisionStats }
  | { kind: 'incomplete'; reason: string; steps: DecisionStep[]; stats: DecisionStats }
  | { kind: 'setting'; globals: Record<string, string>; summary: string; steps: DecisionStep[]; stats: DecisionStats };

export interface CatalogComponent extends TemplateSourceComponent {
  description?: string;
}

export interface EditablePropInfo {
  name: string;
  kind: 'enum' | 'boolean' | 'number' | 'string' | 'other';
  options?: string[];
  doc?: string;
}

export interface VoiceContext {
  catalog: CatalogComponent[];
  /** What a component accepts, from its own types. */
  propsFor: (component: string) => Promise<EditablePropInfo[]>;
  /** Injected in tests. */
  ask?: typeof askJev;
  /** Minimum Jev confidence to act on a decision. */
  threshold?: number;
  /** The preview settings the project's Storybook declares (theme, …). */
  globals?: StorybookGlobal[];
}

export interface VoiceRequest {
  transcript: string;
  code: string;
  /** Element id (from parseCanvas) the person is pointing at. */
  pointer?: string | null;
  /**
   * The element id the previous applied request added or changed, exactly as
   * `touched` came back with that code. "Update the text" straight after "add
   * a checkbox" means that checkbox's text — the way a person hearing it
   * would read it. Only meaningful for the code it came back with.
   */
  recent?: string | null;
  /** The person has stopped talking: decide even if the request looks unfinished. */
  final?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────

const ACTIONS: Record<string, string> = {
  add: 'Add a new element to the design, such as a button, an input, a checkbox, a heading or a card',
  edit: 'Change one element that is already on the canvas: its text, label, placeholder, variant, size, width, colour, checked or disabled state, or another single setting',
  remove: 'Delete an element that is on the canvas',
  move: 'Move one element up or down, or to the top or bottom, among the elements beside it',
  compose: 'Rearrange the whole layout (columns, centring, alignment), restyle several elements at once, change spacing between elements, or build a section with many parts',
  undo: 'Undo the last change',
  redo: 'Redo a change that was just undone',
  clear: 'Start over with an empty canvas',
  save: 'Save the design, or say that it looks good and is finished',
  stop: 'Stop listening to the microphone',
  none: 'Not a request to change the design: filler words, thinking aloud, or talking to someone else',
};

const COMMANDS = new Set<VoiceCommandKind>(['undo', 'redo', 'clear', 'save', 'stop']);

function choice(a: JevAnswer | undefined): ChoiceAnswer | null {
  return a && a.type === 'choice' ? a : null;
}
function noul(a: JevAnswer | undefined): NoulAnswer | null {
  return a && a.type === 'noul' ? a : null;
}

/** Which of the person's words are the new `field` of `subject`. */
function valueQuestion(transcript: string, tag: string, field: string, subject: string): JevQuestion {
  const what = field === 'text' ? 'text' : field;
  return spanQuestion(
    `\`request\` tells ${subject} what its new ${what} should be. Which words are that new ${what}, quoted as the person would want it shown?`,
    valueSpans(transcript, tag, field),
  );
}

function spanQuestion(instructions: unknown, spans: string[]): JevQuestion {
  const criteria: Record<string, null | string> = {};
  for (const s of spans) criteria[s] = null;
  criteria[NONE] = 'The request does not say';
  return { type: 'choice', instructions: instructions as never, criteria };
}

function componentChoices(catalog: CatalogComponent[], transcript: string): CatalogComponent[] {
  let list = catalog.filter(c => /^[A-Z]/.test(c.name));
  const limit = MAX_CHOICE_OPTIONS - 1;
  if (list.length > limit) {
    // Compound parts (CardTitle beside Card) are added by their parent's
    // template, so drop them first — but only a name that extends another
    // entry by a whole capitalised word.
    const names = new Set(list.map(c => c.name));
    list = list.filter(c => ![...names].some(n => n !== c.name && c.name.startsWith(n) && /^[A-Z]/.test(c.name.slice(n.length))));
  }
  if (list.length > limit) {
    const said = new Set(transcript.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
    const score = (c: CatalogComponent) => {
      const n = c.name.toLowerCase();
      let s = 0;
      for (const w of said) if (n === w || n === `${w}s` || w === `${n}s`) s += 10; else if (n.includes(w) || w.includes(n)) s += 3;
      return s;
    };
    list = [...list].sort((a, b) => score(b) - score(a)).slice(0, limit);
  }
  return list;
}

function describeComponent(c: CatalogComponent): string | null {
  if (!c.description || !saysMoreThanName(c.name, c.description)) return null;
  return c.description.length > 140 ? `${c.description.slice(0, 139)}…` : c.description;
}

function parsesCleanly(code: string): boolean {
  const sf = ts.createSourceFile('canvas.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? [];
  return diags.length === 0 && parseCanvas(code).root !== null;
}

class Tally {
  stats: DecisionStats = { ms: 0, calls: 0, questions: 0, inputTokens: 0, usd: 0 };
  constructor(private ask: typeof askJev) {}
  async run(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
    const r = await this.ask(state, questions);
    this.stats.ms += r.ms;
    this.stats.calls += 1;
    this.stats.questions += Object.keys(questions).length;
    this.stats.inputTokens += r.usage?.input_tokens ?? 0;
    this.stats.usd = this.stats.inputTokens * JEV_USD_PER_INPUT_TOKEN;
    this.stats.model = r.model;
    return r;
  }
  /** Several calls at once: wall-clock is the slowest, not the sum. */
  async runAll(calls: Array<[unknown, Record<string, JevQuestion>]>): Promise<JevResponse[]> {
    const started = this.stats.ms;
    const results = await Promise.all(calls.map(([state, q]) => this.ask(state, q)));
    for (const [i, r] of results.entries()) {
      this.stats.calls += 1;
      this.stats.questions += Object.keys(calls[i][1]).length;
      this.stats.inputTokens += r.usage?.input_tokens ?? 0;
      this.stats.model = r.model;
    }
    this.stats.ms = started + Math.max(...results.map(r => r.ms));
    this.stats.usd = this.stats.inputTokens * JEV_USD_PER_INPUT_TOKEN;
    return results;
  }
}

// ── Edit questions for one element ────────────────────────────

interface EditPlan {
  questions: Record<string, JevQuestion>;
  props: EditablePropInfo[];
  hasText: boolean;
}

async function editQuestions(
  node: CanvasNode,
  transcript: string,
  ctx: VoiceContext,
  prefix: string,
): Promise<EditPlan> {
  const name = node.tag.split('.')[0];
  const intrinsic = INTRINSIC.test(node.tag);
  const all = intrinsic ? [] : await ctx.propsFor(name);
  const declaresChildren = all.some(p => p.name === 'children');
  const declared = all.filter(p => p.kind !== 'other' && p.kind !== 'number' && p.name !== 'children');
  const props: EditablePropInfo[] = [...declared];
  const add = (n: string, kind: 'string' | 'boolean') => {
    if (!props.some(p => p.name === n)) props.push({ name: n, kind });
  };
  // What the code states: attributes this element already has, and the ones
  // the component's own stories set on it.
  const entry = ctx.catalog.find(c => c.name === name);
  const templates = entry && !intrinsic ? templatesFor(entry, new Set(ctx.catalog.map(c => c.name))) : [];
  for (const [k, kind] of attrsUsedInStories(templates, name)) add(k, kind);
  for (const [k, v] of Object.entries(node.attrs)) {
    if (/^(className|class|id|htmlFor|key|style)$/.test(k)) continue;
    if (typeof v === 'boolean') add(k, 'boolean');
    else if (typeof v === 'string') add(k, 'string');
  }
  // Internal props (`__clearable`) are nobody's to dictate. Then rank what
  // the request names and what the element already sets ahead of the rest:
  // Mantine's TextInput offers 26, and a flat cap of 24 cut `placeholder`.
  const said = new Set(transcriptWords(transcript));
  const rank = (p: EditablePropInfo) =>
    (nameWords(p.name).every(w => said.has(w)) ? 0 : 2) + (p.name in node.attrs ? 0 : 1);
  const ranked = props.filter(p => !p.name.startsWith('__')).sort((a, b) => rank(a) - rank(b));
  props.length = 0;
  props.push(...ranked.slice(0, 32));
  // Text is on offer when the element has some, or when the component takes
  // children and nothing here says it only holds elements.
  const acceptsChildren = intrinsic
    || declaresChildren
    || takesTextInStories(templates, name)
    || (entry?.props ? entry.props.includes('children') : templates.length === 0);
  const hasText = !!node.text || (node.children.length === 0 && acceptsChildren);

  const changeCriteria: Record<string, string> = {};
  if (hasText) changeCriteria.text = `The words shown on it${node.text ? ` (now "${node.text.slice(0, 60)}")` : ''}`;
  for (const p of props) {
    const current = node.attrs[p.name];
    const bits = [p.doc?.split('\n')[0]?.slice(0, 120)];
    if (p.kind === 'enum' && p.options) bits.push(`one of: ${p.options.slice(0, 12).join(', ')}`);
    if (p.kind === 'boolean') bits.push('on or off');
    if (current !== undefined) bits.push(`now ${JSON.stringify(current)}`);
    changeCriteria[`prop:${p.name}`] = `${p.name}${bits.filter(Boolean).length ? ` — ${bits.filter(Boolean).join('; ')}` : ''}`;
  }
  changeCriteria.other = 'Something not listed here, such as width, spacing, colour, layout or position';

  const questions: Record<string, JevQuestion> = {
    [`${prefix}change`]: {
      type: 'choice',
      instructions: 'Which part of `target` does `request` ask to change?',
      criteria: changeCriteria,
    },
  };
  if (hasText) {
    questions[`${prefix}text`] = valueQuestion(transcript, node.tag, 'text', '`target`');
  }
  for (const p of props) {
    if (p.kind === 'enum' && p.options?.length) {
      const criteria: Record<string, null> = {};
      for (const o of p.options.slice(0, MAX_CHOICE_OPTIONS)) criteria[o] = null;
      questions[`${prefix}v:${p.name}`] = { type: 'choice', instructions: `Which ${p.name} does \`request\` ask \`target\` to use?`, criteria };
    } else if (p.kind === 'boolean') {
      questions[`${prefix}v:${p.name}`] = {
        type: 'choice',
        instructions: `Does \`request\` ask for ${p.name} on \`target\` to be on or off?`,
        criteria: { on: `${p.name} is true: turned on, enabled, checked, shown`, off: `${p.name} is false: turned off, disabled, unchecked, hidden` },
      };
    } else if (p.kind === 'string') {
      questions[`${prefix}v:${p.name}`] = valueQuestion(transcript, node.tag, p.name, '`target`');
    }
  }
  return { questions, props, hasText };
}

const INTRINSIC = /^[a-z][a-z0-9-]*$/;

/**
 * Words shown AS a label or title get a capital; words that are data — a
 * placeholder hint, a default value, alt text — stay as they were said.
 */
const SPOKEN_AS_IS = /^(placeholder|defaultValue|value|alt|name|href|src)$/;
const shown = (field: string, span: string) => (SPOKEN_AS_IS.test(field) ? span : asDisplayText(span));

function applyEdit(
  tree: CanvasTree,
  node: CanvasNode,
  plan: EditPlan,
  answers: Record<string, JevAnswer>,
  prefix: string,
  threshold: number,
  steps: DecisionStep[],
  transcript: string,
): { code: string; summary: string } | { fallback: string } {
  const change = choice(answers[`${prefix}change`]);
  // The request quotes one of the element's current values — "make EMAIL
  // ADDRESS say phone number", "where it says PARTNER ONE NAME" — so that is
  // the property being changed, whatever Jev leaned to (it chose the
  // placeholder once, while the words quoted were the label).
  const quoted = quotedField(node, transcript);
  if (quoted && change && change.choice !== quoted) {
    steps.push({ step: 'Change', value: `${quoted.replace(/^prop:/, '')} (the request quotes its current value)`, by: 'code' });
    change.choice = quoted;
    change.confidence = Math.max(change.confidence, threshold);
  }
  if (!change || change.confidence < threshold) return { fallback: 'Not sure which part of the element to change' };
  steps.push({ step: 'Change', value: change.choice.replace(/^prop:/, ''), by: 'jev', confidence: change.confidence });
  if (change.choice === 'other') {
    // "Add the LABEL location": Jev reads the position words as a move, but
    // the request names a declared text prop outright and its value is clear.
    const said = new Set(transcriptWords(transcript));
    const named = plan.props.filter(p => p.kind === 'string' && nameWords(p.name).every(w => said.has(w)));
    const valued = named
      .map(p => ({ p, v: choice(answers[`${prefix}v:${p.name}`]) }))
      .filter(x => x.v && x.v.choice !== NONE && x.v.confidence >= 0.7);
    if (valued.length === 1) {
      const { p, v } = valued[0];
      const value = shown(p.name, v!.choice);
      steps.push({ step: 'Value', value: `${p.name} = ${JSON.stringify(value)} (named in the request)`, by: 'code', confidence: v!.confidence });
      return { code: setAttr(tree, node.id, p.name, value), summary: `Set ${p.name} on ${describeNode(tree, node)} to ${JSON.stringify(value)}` };
    }
    return { fallback: 'That change is not a single property the component declares' };
  }

  const label = describeNode(tree, node);
  if (change.choice === 'text') {
    const span = choice(answers[`${prefix}text`]);
    if (!span || span.choice === NONE || span.confidence < threshold) return { fallback: 'Could not tell which words are the new text' };
    const text = asDisplayText(span.choice);
    steps.push({ step: 'Value', value: `"${text}"`, by: 'jev', confidence: span.confidence });
    return { code: setText(tree, node.id, text), summary: `Set ${label} text to "${text}"` };
  }

  const propName = change.choice.slice('prop:'.length);
  const prop = plan.props.find(p => p.name === propName);
  const value = choice(answers[`${prefix}v:${propName}`]);
  if (!prop || !value || value.confidence < threshold || value.choice === NONE) {
    return { fallback: `Could not tell what ${propName} should be` };
  }
  let v: string | boolean = prop.kind === 'string' ? shown(prop.name, value.choice) : value.choice;
  if (prop.kind === 'boolean') v = value.choice === 'on';
  steps.push({ step: 'Value', value: `${propName} = ${JSON.stringify(v)}`, by: 'jev', confidence: value.confidence });
  return { code: setAttr(tree, node.id, propName, v), summary: `Set ${propName} on ${label} to ${JSON.stringify(v)}` };
}

// ── Placement: where a new element goes inside its parent ─────

/**
 * Which part of `parentTag` hosts `childTag`, according to the parent's own
 * stories — CardFooter for a Button, CardContent for an Input. Returns null
 * when the parent's examples show no such part.
 */
function hostingPart(parent: CatalogComponent | undefined, childTag: string, known: Set<string>): string | null {
  if (!parent) return null;
  const templates = templatesFor(parent, known, 12).filter(t => t.name !== 'bare');
  const direct: Array<{ tag: string; hosts: Set<string> }> = [];
  const gather = (n: TemplateNode, into: Set<string>) => {
    for (const c of n.children) if (typeof c !== 'string') { into.add(c.tag); gather(c, into); }
  };
  for (const t of templates) {
    if (t.root.tag !== parent.name) continue;
    for (const c of t.root.children) {
      if (typeof c === 'string' || !c.tag.startsWith(parent.name)) continue;
      const hosts = new Set<string>();
      gather(c, hosts);
      direct.push({ tag: c.tag, hosts });
    }
  }
  const byChild = direct.find(d => d.hosts.has(childTag));
  if (byChild) return byChild.tag;
  // The part that holds the most non-part content is the parent's body.
  const scored = direct
    .map(d => ({ tag: d.tag, n: [...d.hosts].filter(h => !h.startsWith(parent.name)).length }))
    .sort((a, b) => b.n - a.n);
  return scored[0]?.n ? scored[0].tag : null;
}

// ── Add questions for one component ───────────────────────────

interface AddPlan {
  templates: Template[];
  bare: boolean;
  bareSlots: Array<{ role: string; field: string }>;
  questions: Record<string, JevQuestion>;
  /** A bare element that shows an image by `src` — empty, it renders nothing. */
  imageSource?: boolean;
}

const addPrefix = (name: string) => `add:${name}.`;

async function addPlan(
  entry: CatalogComponent,
  transcript: string,
  ctx: VoiceContext,
  known: Set<string>,
  prefix: string,
): Promise<AddPlan> {
  const templates = templatesFor(entry, known);
  const bare = templates.length === 1 && templates[0].name === 'bare';
  // Nothing documents this component, so its own declared text props are the
  // only slots it has: `label`, `description`, `placeholder`, its children.
  const bareSlots: Array<{ role: string; field: string }> = [];
  let imageSource = false;
  if (bare) {
    const declared = await ctx.propsFor(entry.name);
    if (declared.some(p => p.name === 'children') || entry.props?.includes('children')) bareSlots.push({ role: `${entry.name}.text`, field: 'text' });
    for (const p of declared) {
      // Addresses are not words anyone dictates.
      if (p.kind === 'string' && !/^(children|src|srcSet|href|id|className)$/.test(p.name)) bareSlots.push({ role: `${entry.name}.${p.name}`, field: p.name });
    }
    if (declared.some(p => p.name === 'src')) imageSource = true;
    bareSlots.splice(8);
    templates[0] = { name: 'bare', root: { tag: entry.name, attrs: [], children: [] } };
  }
  const questions: Record<string, JevQuestion> = {};
  if (bare && bareSlots.some(b => b.field === 'text')) {
    questions[`${prefix}multi`] = {
      type: 'noul',
      instructions: `Does \`request\` give the new ${entry.name} more than one piece of text, such as both a title and a description?`,
    };
  }
  if (templates.length > 1) {
    const criteria: Record<string, string> = {};
    templates.forEach((t, i) => { criteria[`t${i}`] = summarizeTemplate(t.root) || t.name; });
    questions[`${prefix}template`] = {
      type: 'choice',
      instructions: `\`request\` asks to add a ${entry.name}. Which example is closest to what it describes? When it gives no detail, choose the example that shows the ${entry.name} the way it is normally used, with its label or text.`,
      criteria,
    };
  }
  const roles = new Map<string, { tag: string; field: string }>();
  for (const t of templates) for (const sl of slotsOf(t.root)) if (!roles.has(sl.role)) roles.set(sl.role, sl);
  for (const sl of bareSlots) roles.set(sl.role, { tag: entry.name, field: sl.field });
  for (const [role, sl] of roles) {
    const part = sl.tag || 'element';
    const subject = part === entry.name ? `the new ${entry.name}` : `the ${part} of the new ${entry.name}`;
    questions[`${prefix}slot:${role}`] = valueQuestion(transcript, part, sl.field, subject);
    questions[`${prefix}said:${role}`] = {
      type: 'noul',
      instructions: sl.field === 'text'
        ? `Does \`request\` say what ${subject} should say (its label or text)?`
        : `Does \`request\` say what the ${sl.field} of ${subject} should be?`,
    };
  }
  return { templates, bare, bareSlots, questions, imageSource };
}

/**
 * Components the request names outright — "add a CHECKBOX" — whose add
 * questions can ride along in the first call. Matched on the component's own
 * name, word for word; a wrong guess costs a few questions, never a wrong
 * edit, because the answers are only used when Jev's component choice agrees.
 */
function namedComponents(catalog: CatalogComponent[], transcript: string, limit = 2): CatalogComponent[] {
  const text = ` ${transcript.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ')} `;
  return catalog
    .filter(c => /^[A-Z]/.test(c.name))
    .map(c => {
      const phrase = c.name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      return { c, hit: text.includes(` ${phrase} `) || text.includes(` ${phrase}s `), words: phrase.split(' ').length };
    })
    .filter(x => x.hit)
    // The longest name wins: "card title" before "card".
    .sort((a, b) => b.words - a.words)
    .slice(0, limit)
    .map(x => x.c);
}

// ── The decision ──────────────────────────────────────────────

export async function decideVoiceEdit(req: VoiceRequest, ctx: VoiceContext): Promise<VoiceOutcome> {
  const threshold = ctx.threshold ?? Number(process.env.STORY_UI_VOICE_CONFIDENCE || 0.5);
  const tally = new Tally(ctx.ask ?? askJev);
  const steps: DecisionStep[] = [];
  const transcript = stripLeadingFiller(req.transcript);
  const tree = parseCanvas(req.code);
  if (!tree.root) {
    return { kind: 'fallback', reason: 'The canvas code has no Canvas element to edit', steps, stats: tally.stats };
  }

  const outline = outlineCanvas(tree);
  const known = new Set(ctx.catalog.map(c => c.name));
  const choices = componentChoices(ctx.catalog, transcript);
  const pointed = req.pointer ? tree.nodes.find(n => n.id === req.pointer && n.tag) ?? null : null;

  const state: Record<string, unknown> = {
    request: transcript,
    canvas: outline.length ? outline : 'empty',
  };
  if (pointed) state.target = describeNode(tree, pointed);
  // The subtree the last request touched, when the person is not pointing.
  const recentRoot = !pointed && req.recent ? tree.nodes.find(n => n.id === req.recent && n.tag) ?? null : null;
  // Design-system elements only: the layout <div> a template wraps them in is
  // never what "change the text" is about.
  const recentAll = recentRoot ? subtree(tree, recentRoot).filter(n => n.tag) : [];
  const recentDs = recentAll.filter(n => !INTRINSIC.test(n.tag));
  const recentNodes = recentDs.length ? recentDs : recentAll;

  // ── Stage 1 ──
  // `action` is added last, once the preview settings are known.
  const q1: Record<string, JevQuestion> = {};
  if (choices.length) {
    const criteria: Record<string, string | null> = {};
    for (const c of choices) criteria[c.name] = describeComponent(c);
    criteria[NONE] = 'No component is named';
    q1.component = { type: 'choice', instructions: 'Which component does `request` ask to add?', criteria };
  }
  const elements = tree.nodes.filter(n => n.tag);
  if (elements.length && !pointed) {
    const criteria: Record<string, string> = {};
    for (const n of elements.slice(0, MAX_CHOICE_OPTIONS - 1)) criteria[n.id] = describeNode(tree, n);
    criteria[NONE] = 'No element on the canvas';
    q1.target = { type: 'choice', instructions: 'Which element on `canvas` does `request` refer to?', criteria };
    if (recentNodes.length) {
      // Two literal questions, combined in code — rather than one question
      // that asks Jev to apply a rule about when to use the other.
      q1.names_element = {
        type: 'noul',
        instructions: 'Does `request` name or describe which element it is about, such as "the button", "the checkbox" or "the email field"?',
      };
      q1.singles_out = {
        type: 'noul',
        instructions: 'Does `request` say WHICH one it means when there are several of the same kind — by its words, label, colour or position (such as "the Send Invite button" or "the second card")? Just "the button" does not.',
      };
      if (recentNodes.length > 1) {
        const rc: Record<string, string> = {};
        for (const n of recentNodes) rc[n.id] = describeNode(tree, n);
        q1.recent_target = { type: 'choice', instructions: 'Which of these elements does `request` change?', criteria: rc };
      }
    }
  }
  const hosts = containers(tree).filter(n => n.tag);
  if (hosts.length) {
    const criteria: Record<string, string> = { top: 'At the top level of the design, after everything else' };
    for (const n of hosts.slice(0, MAX_CHOICE_OPTIONS - 1)) criteria[n.id] = `Inside ${describeNode(tree, n)}`;
    q1.parent = { type: 'choice', instructions: 'If `request` adds something, where on `canvas` does the new element belong?', criteria };
  }
  let pointedPlan: EditPlan | null = null;
  if (pointed) {
    pointedPlan = await editQuestions(pointed, transcript, ctx, 'edit.');
    Object.assign(q1, pointedPlan.questions);
  }
  // Speculative fan-out (TypeSafe's own pattern): questions whose answers are
  // only USED if stage 1 agrees, asked now so the likely cases need one round
  // trip. More questions barely move Jev's latency; a second call doubles it.
  // Add questions need only the words said. They go in a parallel call with
  // the request alone as state: with the canvas outline beside it, Jev's
  // pick of "send" for a new button's text fell from 0.90 to 0.76 —
  // unrelated state is a distractor (Jev 1.13's documented jagged edge).
  const specs = new Map<string, AddPlan>();
  const qAdd: Record<string, JevQuestion> = {};
  for (const c of namedComponents(ctx.catalog, transcript)) {
    const plan = await addPlan(c, transcript, ctx, known, addPrefix(c.name));
    specs.set(c.name, plan);
    Object.assign(qAdd, plan.questions);
  }
  const recentPlans = new Map<string, EditPlan>();
  for (const n of recentNodes.slice(0, 3)) {
    const plan = await editQuestions(n, transcript, ctx, `recent:${n.id}.`);
    recentPlans.set(n.id, plan);
    Object.assign(q1, plan.questions);
  }
  // An add of one component is Jev's; a section of several is the model's.
  // Asked as its own literal question — the action Choice alone put "a
  // newsletter with an input and three checkboxes" down as one add.
  q1.several = {
    type: 'noul',
    instructions: 'Does `request` ask for a whole section, form, page or layout, or for several separate new elements at once (such as "three cards" or "an input and two checkboxes")? A single element with its own title or text counts as one.',
  };
  q1.instruction = {
    type: 'noul',
    instructions: 'Is `request` an instruction to change the design (add, remove, move, edit or restyle something), rather than a comment, a question, or talk to another person?',
  };
  q1.move_dir = {
    type: 'choice',
    instructions: 'If `request` asks to move an element, which way?',
    criteria: {
      up: 'earlier / higher / above the one before it',
      down: 'later / lower / below the one after it',
      first: 'to the very top or start',
      last: 'to the very bottom or end',
      none: 'It does not ask to move anything',
    },
  };
  q1.place = {
    type: 'choice',
    instructions: 'If `request` adds something, where does it go relative to the element it mentions?',
    criteria: {
      inside: 'inside it (for example "add an image to the card")',
      before: 'just above or before it ("above the title")',
      after: 'just below or after it ("below the image")',
      unsaid: 'It does not say where',
    },
  };
  q1.new_element = {
    type: 'noul',
    instructions: 'Does `request` ask to put a NEW element on `canvas` that is not there yet (not changing, labelling or restyling one that is)?',
  };
  q1.complete = {
    type: 'noul',
    instructions: 'Is `request` a complete instruction, rather than one cut off in the middle (for example ending in "to say", "called" or "and")?',
  };

  // Preview settings the project declares — "dark mode" is one of these, not
  // a restyle, wherever the toolbar offers it.
  const globals = ctx.globals ?? [];
  const actions: Record<string, string> = { ...ACTIONS };
  if (globals.length) {
    const offered = globals.map(g => `${g.title || g.name} (${g.items.map(i => i.title || i.value).join(', ')})`).join('; ');
    actions.setting = `Switch how the whole preview is shown: ${offered}`;
    const criteria: Record<string, string> = {};
    for (const g of globals) for (const i of g.items) criteria[`${g.name}=${i.value}`] = `${g.description || g.title || g.name}: ${i.title || i.value}`;
    q1.setting = { type: 'choice', instructions: 'Which preview setting does `request` ask for?', criteria };
  }
  q1.action = { type: 'choice', instructions: 'What does `request` ask to do to the design on `canvas`?', criteria: actions };

  const [main, adds] = Object.keys(qAdd).length
    ? await tally.runAll([[state, q1], [{ request: transcript }, qAdd]])
    : [await tally.run(state, q1), null];
  const r1: JevResponse = { ...main, answers: { ...main.answers, ...(adds?.answers ?? {}) } };
  const action = choice(r1.answers.action);
  if (!action) return { kind: 'fallback', reason: 'Jev returned no action', steps, stats: tally.stats };
  const complete = noul(r1.answers.complete);
  // Only a clearly unfinished request waits; "a third text field for
  // location" read as unfinished at 0.40 and cost three seconds.
  if (!req.final && complete && complete.noul < 0.3) {
    // Speech arrives in pieces; applying half a sentence is how "update the
    // title to say" went to the model with nothing to say.
    steps.push({ step: 'Read request', value: 'Waiting for the rest of the sentence', by: 'jev', confidence: 1 - complete.noul });
    return { kind: 'incomplete', reason: 'The request stops mid-sentence', steps, stats: tally.stats };
  }
  steps.push({ step: 'Choose action', value: action.choice, by: 'jev', confidence: action.confidence });

  // Add or edit, unsure between them: one literal question settles it.
  // Measured: edits 0.02–0.09, adds 0.82–0.97 on "is this a NEW element?".
  const addOrEdit = (action.probabilities.add ?? 0) + (action.probabilities.edit ?? 0);
  const fresh = noul(r1.answers.new_element);
  if (action.confidence < threshold && (action.choice === 'add' || action.choice === 'edit') && addOrEdit >= 0.7 && fresh) {
    const decided = fresh.noul >= 0.3 ? 'add' : 'edit';
    steps.push({ step: 'Add or edit', value: decided === 'add' ? 'a new element' : 'an existing element', by: 'jev', confidence: decided === 'add' ? fresh.noul : 1 - fresh.noul });
    action.choice = decided;
    action.confidence = Math.max(action.confidence, threshold);
  }
  // Talk that is not an instruction never reaches the model. Measured:
  // conversation 0.05–0.21, instructions 0.88–0.97. Commands and settings
  // ("save it", "dark mode") are exempt — they are instructions of their own.
  const instruction = noul(r1.answers.instruction);
  if (instruction && instruction.noul < 0.4 && !COMMANDS.has(action.choice as VoiceCommandKind) && action.choice !== 'setting') {
    return { kind: 'ignored', reason: 'Not a design instruction', steps, stats: tally.stats };
  }
  // A move Jev is sure of, whatever the action vote says.
  const dir = choice(r1.answers.move_dir);
  if (dir && dir.choice !== NONE && dir.confidence >= 0.8 && action.choice !== 'move') {
    steps.push({ step: 'Move', value: dir.choice, by: 'jev', confidence: dir.confidence });
    action.choice = 'move';
    action.confidence = Math.max(action.confidence, threshold);
  }
  if (action.confidence < threshold) {
    const top = Object.entries(action.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, p]) => `${k} ${p.toFixed(2)}`).join(', ');
    return { kind: 'fallback', reason: `Unsure what was asked (${top}; confidence ${action.confidence.toFixed(2)})`, steps, stats: tally.stats };
  }
  if (COMMANDS.has(action.choice as VoiceCommandKind)) {
    return { kind: 'command', command: action.choice as VoiceCommandKind, steps, stats: tally.stats };
  }
  if (action.choice === 'none') return { kind: 'ignored', reason: 'Not a design instruction', steps, stats: tally.stats };
  if (action.choice === 'setting') {
    const set = choice(r1.answers.setting);
    if (!set || set.confidence < threshold) return { kind: 'fallback', reason: 'Could not tell which setting', steps, stats: tally.stats };
    const [name, value] = set.choice.split('=');
    steps.push({ step: 'Setting', value: `${name} = ${value}`, by: 'jev', confidence: set.confidence });
    steps.push({ step: 'Result', value: `Preview ${name} set to ${value}`, by: 'code' });
    return { kind: 'setting', globals: { [name]: value }, summary: `Preview ${name} set to ${value}`, steps, stats: tally.stats };
  }
  if (action.choice === 'compose') return { kind: 'fallback', reason: 'Needs the generative model', steps, stats: tally.stats };

  // Resolve the element the request is about.
  let target: CanvasNode | null = pointed;
  if (pointed) {
    steps.push({ step: 'Resolve target', value: describeNode(tree, pointed), by: 'code' });
  } else if (action.choice !== 'add') {
    const t = choice(r1.answers.target);
    const named = noul(r1.answers.names_element);
    if (recentNodes.length && named && named.noul < 0.5) {
      // Nothing named: the element just added or changed.
      const rt = choice(r1.answers.recent_target);
      target = recentNodes.length === 1 ? recentNodes[0] : tree.nodes.find(n => n.id === rt?.choice) ?? null;
      if (target) steps.push({ step: 'Resolve target', value: `${describeNode(tree, target)} (just changed)`, by: recentNodes.length === 1 ? 'code' : 'jev', confidence: rt?.confidence });
    }
    if (!target && recentNodes.length && (!t || t.choice === NONE || t.confidence < threshold)) {
      // Two similar elements and no way to tell them apart: the one just
      // added or changed, as a person would assume. Within that group Jev
      // still picks when there is more than one candidate.
      const rt = choice(r1.answers.recent_target);
      target = recentNodes.length === 1 ? recentNodes[0] : tree.nodes.find(n => n.id === rt?.choice) ?? null;
      if (target) steps.push({ step: 'Resolve target', value: `${describeNode(tree, target)} (unsure — the one just changed)`, by: 'code', confidence: t?.confidence });
    }
    if (!target) {
      if (!t || t.choice === NONE || t.confidence < threshold) {
        return { kind: 'fallback', reason: 'Could not tell which element was meant', steps, stats: tally.stats };
      }
      target = tree.nodes.find(n => n.id === t.choice) ?? null;
      if (!target) return { kind: 'fallback', reason: 'Jev chose an element that is not on the canvas', steps, stats: tally.stats };
      // "The button" with three buttons on the canvas: Jev picks one, not
      // surely. The one just added or changed is what a person means.
      const sameKind = recentNodes.find(n => n.tag === target!.tag && n.id !== target!.id);
      const singled = noul(r1.answers.singles_out);
      // Said its words ("the CANCEL button") — named, whatever the Noul thinks.
      const saidItsText = !!target.text && transcript.toLowerCase().includes(target.text.toLowerCase());
      if (sameKind && !saidItsText && (t.confidence < 0.8 || (singled && singled.noul < 0.5))) {
        target = sameKind;
        steps.push({ step: 'Resolve target', value: `${describeNode(tree, target)} (the ${target.tag} just changed)`, by: 'code', confidence: t.confidence });
      } else {
        steps.push({ step: 'Resolve target', value: describeNode(tree, target), by: 'jev', confidence: t.confidence });
      }
    }
  }

  // ── Remove ──
  if (action.choice === 'remove') {
    if (!target!.parent) return { kind: 'command', command: 'clear', steps, stats: tally.stats };
    const code = removeNode(tree, target!.id);
    return finish(code, `Removed ${describeNode(tree, target!)}`, null);
  }

  // ── Move ──
  if (action.choice === 'move') {
    if (!dir || dir.choice === NONE) return { kind: 'fallback', reason: 'Could not tell which way to move it', steps, stats: tally.stats };
    let code: string;
    try {
      code = moveNode(tree, target!.id, dir.choice as MoveDirection);
    } catch (e) {
      return { kind: 'fallback', reason: e instanceof Error ? e.message : String(e), steps, stats: tally.stats };
    }
    return finish(code, `Moved ${describeNode(tree, target!)} ${dir.choice}`, null);
  }

  // ── Edit ──
  if (action.choice === 'edit') {
    let plan = pointedPlan;
    let answers = r1.answers;
    let prefix = 'edit.';
    if (!pointed && recentPlans.has(target!.id)) {
      plan = recentPlans.get(target!.id)!;
      prefix = `recent:${target!.id}.`;
      steps.push({ step: 'Details', value: 'asked in the same call', by: 'code' });
    } else if (!plan || target !== pointed) {
      plan = await editQuestions(target!, transcript, ctx, '');
      const r2 = await tally.run({ ...state, target: describeNode(tree, target!) }, plan.questions);
      answers = r2.answers;
      prefix = '';
    }
    const result = applyEdit(tree, target!, plan, answers, prefix, threshold, steps, transcript);
    if ('fallback' in result) return { kind: 'fallback', reason: result.fallback, steps, stats: tally.stats };
    // An attribute or text edit never reorders elements, so the id holds.
    return finish(result.code, result.summary, target!.id);
  }

  // ── Add ──
  const several = noul(r1.answers.several);
  // A request that names one component outright ("add a card titled …") is
  // one add unless Jev is sure it is a section; one that names none needs
  // less evidence. Measured: single adds 0.09–0.59, sections 0.64–0.93.
  const namesOne = specs.size > 0;
  if (several && several.noul >= (namesOne ? 0.8 : 0.55)) {
    steps.push({ step: 'Scope', value: 'several elements — a composition', by: 'jev', confidence: several.noul });
    return { kind: 'fallback', reason: 'Asks for a section of several parts', steps, stats: tally.stats };
  }
  const comp = choice(r1.answers.component);
  if (!comp || comp.choice === NONE || comp.confidence < threshold) {
    return { kind: 'fallback', reason: 'Could not tell which component to add', steps, stats: tally.stats };
  }
  const entry = ctx.catalog.find(c => c.name === comp.choice);
  if (!entry) return { kind: 'fallback', reason: `${comp.choice} is not in the catalog`, steps, stats: tally.stats };
  steps.push({ step: 'Component', value: entry.name, by: 'jev', confidence: comp.confidence });

  // Where it goes: the pointed-at container, Jev's choice, or the top.
  let parentNode: CanvasNode | null = null;
  let wrapPart: string | null = null;
  let besideAnchor: { node: CanvasNode; where: 'before' | 'after' } | null = null;
  if (pointed && !pointed.text) {
    parentNode = pointed;
  } else {
    // Where the request points: the element it mentions ("to that CARD",
    // "above the TITLE"), else the one just added — "that card component I
    // just added" put three images at the bottom of the canvas, out of view,
    // because an unsure placement fell back to the top level.
    const place = choice(r1.answers.place);
    const t = choice(r1.answers.target);
    let anchor = t && t.choice !== NONE && t.confidence >= threshold ? tree.nodes.find(n => n.id === t.choice) ?? null : null;
    // Only when the request says where ("to that card", "above that"):
    // "add a send button" after a checkbox must not nest inside the checkbox.
    if (!anchor && recentRoot && place && place.choice !== 'unsaid' && place.confidence >= threshold) anchor = recentRoot;
    // The request names the kind of element it means ("to that CARD", "below
    // the existing IMAGE"): an element of that component beats Jev's pick of
    // a look-alike (it chose the newsletter's Paper for "that card"). The
    // component being added counts only when placing beside ("another image
    // below the image"). Among several, the one just changed, else the last.
    const beside = place && (place.choice === 'before' || place.choice === 'after') && place.confidence >= threshold;
    const namedTags = new Set(namedComponents(ctx.catalog, transcript, 5).map(c => c.name).filter(n => n !== entry.name || beside));
    if (namedTags.size && !(anchor && namedTags.has(anchor.tag))) {
      const ofKind = tree.nodes.filter(n => namedTags.has(n.tag));
      const pick = ofKind.find(n => recentNodes.some(r => r.id === n.id)) ?? ofKind[ofKind.length - 1];
      if (pick) anchor = pick;
    }
    if (anchor && place && (place.choice === 'before' || place.choice === 'after') && place.confidence >= threshold && anchor.parent) {
      besideAnchor = { node: anchor, where: place.choice };
    } else if (anchor && (
      // Said "inside" ("to that card"): even a container holding a word of
      // placeholder text — a bare <Card>Card</Card> — takes it.
      (place?.choice === 'inside' && place.confidence >= threshold)
      || (!anchor.text && (!choice(r1.answers.parent) || choice(r1.answers.parent)!.confidence < threshold))
    )) {
      parentNode = anchor;
    }
    const p = choice(r1.answers.parent);
    if (!parentNode && !besideAnchor && p && p.choice !== 'top' && p.confidence >= threshold) parentNode = tree.nodes.find(n => n.id === p.choice) ?? null;
    // One design on the canvas (a card, a form): an unsure placement goes
    // inside it, not beside it. Only a confident "top" puts it next to it.
    const topLevel = (tree.root?.children ?? []).map(id => tree.nodes.find(n => n.id === id)!).filter(n => n?.tag);
    if (!parentNode && !besideAnchor && topLevel.length === 1 && !topLevel[0].text && !(p?.choice === 'top' && p.confidence >= 0.8)) {
      parentNode = topLevel[0];
    }
  }
  // The parent's own stories say which of its parts hosts this component.
  if (parentNode) {
    const part = hostingPart(ctx.catalog.find(c => c.name === parentNode!.tag), entry.name, known);
    if (part) {
      const existing = parentNode.children.map(id => tree.nodes.find(n => n.id === id)!).find(n => n.tag === part);
      if (existing) parentNode = existing;
      else wrapPart = part;
      steps.push({ step: 'Placement', value: existing ? `the existing ${part}` : `a new ${part}`, by: 'code' });
    }
  }
  steps.push(besideAnchor
    ? { step: 'Place', value: `${besideAnchor.where} ${describeNode(tree, besideAnchor.node)}`, by: 'jev' }
    : { step: 'Place inside', value: parentNode ? describeNode(tree, parentNode) : 'the design', by: parentNode && !pointed ? 'jev' : 'code' });

  // Nothing documents this component AND nothing is known about its props:
  // building it blind is a guess. Mantine's Image resolved no props here and
  // went on the canvas without a src — it rendered nothing, and the request
  // looked ignored. The model knows the component; let it build this one.
  if (templatesFor(entry, known).every(t => t.name === 'bare') && !(entry.props?.length) && (await ctx.propsFor(entry.name)).length === 0) {
    return { kind: 'fallback', reason: `Nothing documents ${entry.name}'s props or usage`, steps, stats: tally.stats };
  }
  let plan = specs.get(entry.name) ?? null;
  let ans = r1.answers;
  const pfx = plan ? addPrefix(entry.name) : '';
  if (!plan) plan = await addPlan(entry, transcript, ctx, known, '');
  const { templates, bare, bareSlots } = plan;

  let chosen: Template = templates[0];
  const values: Record<string, string> = {};
  if (Object.keys(plan.questions).length) {
    if (!pfx) {
      const r2 = await tally.run({ request: transcript }, plan.questions);
      ans = r2.answers;
    } else {
      steps.push({ step: 'Details', value: 'asked in the same call', by: 'code' });
    }
    const t = choice(ans[`${pfx}template`]);
    // Unsure which example fits → the story file's first one, which is the
    // canonical example by convention. A 19% guess put the "Subscribed"
    // state of a newsletter form on the canvas.
    if (t && t.choice.startsWith('t') && t.confidence >= threshold) chosen = templates[Number(t.choice.slice(1))] ?? chosen;
    if (t) steps.push({ step: 'Example', value: chosen.name, by: t.confidence >= threshold ? 'jev' : 'code', confidence: t.confidence });
    // Each span of speech fills at most one slot — the one Jev is surest of.
    // Otherwise a description said once lands in the CardDescription AND in
    // the paragraph the template happens to have below it.
    const candidates = bare
      ? bareSlots.map(b => ({ role: b.role, tag: entry.name, field: b.field, example: '' }))
      : slotsOf(chosen.root);
    const stated = candidates.filter(s => (noul(ans[`${pfx}said:${s.role}`])?.noul ?? 0) >= 0.5).length;
    const multi = noul(ans[`${pfx}multi`]);
    if (bare && bareSlots.some(b => b.field === 'text') && (stated > 1 || (multi && multi.noul >= 0.5))) {
      // "A card titled X with a description Y" on a container nobody has
      // documented: its parts are a composition, which is the model's job.
      return { kind: 'fallback', reason: `${entry.name} has no documented example to hold that content`, steps, stats: tally.stats };
    }
    const filled = candidates
      .map(s => ({ s, said: noul(ans[`${pfx}said:${s.role}`]), span: choice(ans[`${pfx}slot:${s.role}`]) }))
      // Filled when Jev says the words were given, or when it is sure which
      // words they are and does not deny they were given ("add a SEND button").
      .filter(x => x.said && x.span && x.span.choice !== NONE && x.span.confidence >= threshold
        && (x.said.noul >= 0.5 || (x.span.confidence >= 0.8 && x.said.noul >= 0.3)))
      .sort((a, b) => b.span!.confidence - a.span!.confidence);
    const used = new Set<string>();
    for (const { s, span } of filled) {
      const key = span!.choice.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      values[s.role] = shown(s.field, span!.choice);
      steps.push({ step: `Text: ${s.role}`, value: `"${values[s.role]}"`, by: 'jev', confidence: span!.confidence });
    }
  }

  let root = bare
    ? {
        tag: entry.name,
        attrs: [
          // A bare image with no source renders nothing — it looked as if the
          // request had been ignored. Stable picsum seeds, as the model uses.
          ...(plan.imageSource ? [['src', `https://picsum.photos/seed/${imageSeed(transcript, tree.code)}/800/400`] as [string, string]] : []),
          ...bareSlots.filter(b => b.field !== 'text' && values[b.role] !== undefined).map((b): [string, string] => [b.field, values[b.role]]),
        ],
        children: values[`${entry.name}.text`] !== undefined
          ? [values[`${entry.name}.text`]]
          : bareSlots.some(b => b.field === 'text') ? [entry.name] : [],
      }
    : fillSlots(chosen.root, values);
  root = uniquifyIds(root, tree.code);
  if (wrapPart) root = { tag: wrapPart, attrs: [], children: [root] };
  const jsx = printTemplate(root);
  const code = besideAnchor
    ? insertBeside(tree, besideAnchor.node.id, jsx, besideAnchor.where)
    : insertChild(tree, parentNode?.id ?? null, jsx);
  // The new element is the last child of the element it went into.
  const inserted = (() => {
    const after = parseCanvas(code);
    if (besideAnchor) {
      // The new element sits right before or after the anchor in document order.
      const start = besideAnchor.where === 'before' ? besideAnchor.node.start : besideAnchor.node.end + 1;
      return after.nodes.filter(n => n.start >= start).sort((a, b) => a.start - b.start)[0]?.id ?? null;
    }
    const host = parentNode ? after.nodes.find(n => n.id === parentNode!.id) : after.root;
    return host?.children[host.children.length - 1] ?? null;
  })();
  const where = besideAnchor
    ? ` ${besideAnchor.where === 'before' ? 'above' : 'below'} ${describeNode(tree, besideAnchor.node)}`
    : parentNode ? ` inside ${parentNode.tag}` : '';
  return finish(code, `Added ${entry.name}${where}`, inserted);

  function finish(code: string, summary: string, touched: string | null): VoiceOutcome {
    if (!parsesCleanly(code)) {
      return { kind: 'fallback', reason: 'The edit produced code that does not parse', steps, stats: tally.stats };
    }
    steps.push({ step: 'Result', value: summary, by: 'code' });
    return { kind: 'applied', code, summary, touched, steps, stats: tally.stats };
  }
}

function subtree(tree: CanvasTree, root: CanvasNode): CanvasNode[] {
  const out: CanvasNode[] = [root];
  for (const id of root.children) {
    const child = tree.nodes.find(n => n.id === id);
    if (child) out.push(...subtree(tree, child));
  }
  return out;
}

/**
 * Continuous speech arrives as "and make the button say submit", "and then
 * add an image", "okay so add a checkbox". The joining words carry no
 * instruction and pulled Jev's add/edit split to a coin toss (0.53 / 0.47).
 */
export function stripLeadingFiller(transcript: string): string {
  let t = transcript.trim();
  const FILLER = /^(and then|and also|and|then|also|so|okay|ok|um+|uh+|now|next|alright|all right)\b[\s,.]*/i;
  for (let i = 0; i < 4 && FILLER.test(t); i++) {
    const next = t.replace(FILLER, '').trim();
    if (!next) break;
    t = next;
  }
  return t;
}

const nameWords = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const transcriptWords = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const normalizeSaid = (t: string) => ` ${transcriptWords(t).map(w => NUMBER_WORDS[w] ?? w).join(' ')} `;

/**
 * Which field of `node` the request quotes by its current value: `text`, or
 * `prop:<name>` for a string attribute. Only a unique match of at least two
 * words counts.
 */
function quotedField(node: CanvasNode, transcript: string): string | null {
  const said = normalizeSaid(transcript);
  const fields: Array<[string, string]> = [];
  if (node.text) fields.push(['text', node.text]);
  for (const [k, v] of Object.entries(node.attrs)) {
    if (typeof v === 'string' && !/^(className|class|id|htmlFor|type|name|src|href|style|variant|size|color)$/.test(k)) fields.push([`prop:${k}`, v]);
  }
  const hits = fields.filter(([, value]) => {
    const v = normalizeSaid(value);
    const words = v.trim().split(' ').filter(Boolean);
    // Two words at least: "the SUBMIT button" names the element by its text,
    // it does not quote the value being changed.
    return words.length >= 2 && said.includes(v);
  });
  return hits.length === 1 ? hits[0][0] : null;
}

/** A stable picsum seed from the request's own words, distinct per image on the canvas. */
function imageSeed(transcript: string, code: string): string {
  const skip = new Set(['add', 'an', 'a', 'the', 'image', 'picture', 'photo', 'to', 'of', 'and', 'then', 'now', 'that', 'this', 'another', 'above', 'below', 'component', 'card', 'with', 'in', 'on']);
  const word = transcriptWords(transcript).find(w => w.length > 3 && !skip.has(w)) ?? 'canvas';
  const n = (code.match(/picsum\.photos\/seed\//g) ?? []).length + 1;
  return `${word}${n}`;
}
