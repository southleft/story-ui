/**
 * Keep a targeted turn targeted, all the way through verification.
 *
 * Observed: the user selected one stat tile and asked for an orange
 * background. The edit was right — one block, the tile tinted. Then the
 * visual critic, told only "change the background color to orange", looked at
 * the screenshot, saw a white page, and filed a blocker: request not
 * delivered. The repair model, handed that blocker and the raw request,
 * painted the page container orange in both stories. Every step was locally
 * reasonable; the request had simply lost its scope between the edit and the
 * verification that judged it.
 *
 * Three things fix that, and this module holds the pure parts of all three:
 *   1. the critic is told what was selected and that ONLY that changed;
 *   2. the repair model is told the request is already applied;
 *   3. a repair on a targeted turn may only touch the selected element —
 *      enforced on the edit blocks, not requested in the prompt.
 */

import type { PatchBlock } from './patchEdit.js';

/**
 * The component name inside a selection description such as
 *   `a Statlet containing the text "OPEN INCIDENTS" (item 2 of 4) inside …`
 *   `a Mantine Button containing the text "Save"`
 *   `a <div> containing the text "…"`
 * Null for a native tag: there is no element name to scope by.
 */
export function targetComponentFromSelection(selection: string): string | null {
  const head = selection.split(/ containing | \(item | inside /)[0].trim();
  if (/^an? </.test(head)) return null;
  const words = head.replace(/^an? /, '').split(/\s+/);
  const name = words[words.length - 1];
  return /^[A-Z][\w.]*$/.test(name) ? name : null;
}

export interface LineRange { start: number; end: number }

/**
 * Line ranges (1-based, inclusive) of every `<Component …>` element in the
 * code, from its opening `<` to its `/>` or its matching `</Component>`.
 * Attribute braces and strings are skipped so a `>` inside a JSX expression
 * does not end the tag early.
 */
export function elementRanges(code: string, component: string): LineRange[] {
  const ranges: LineRange[] = [];
  const open = new RegExp(`<${component.replace(/\./g, '\\.')}(?=[\\s/>])`, 'g');
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;
  let m: RegExpExecArray | null;
  while ((m = open.exec(code))) {
    const start = m.index;
    let i = start + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    let selfClosing = false;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (quote) { if (ch === quote && code[i - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (depth === 0 && ch === '/' && code[i + 1] === '>') { selfClosing = true; i += 2; break; }
      else if (depth === 0 && ch === '>') { i += 1; break; }
    }
    let end = i;
    if (!selfClosing) {
      const closeTag = `</${component}>`;
      let nested = 1;
      let j = i;
      while (nested > 0 && j < code.length) {
        const nextOpen = code.indexOf(`<${component}`, j);
        const nextClose = code.indexOf(closeTag, j);
        if (nextClose === -1) { j = code.length; break; }
        if (nextOpen !== -1 && nextOpen < nextClose && /[\s/>]/.test(code[nextOpen + component.length + 1] || '')) {
          nested++; j = nextOpen + 1;
        } else {
          nested--; j = nextClose + closeTag.length;
        }
      }
      end = j;
    }
    ranges.push({ start: lineOf(start), end: lineOf(Math.max(start, end - 1)) });
  }
  return ranges;
}

/** Where a SEARCH block sits in the code, by the same tolerant matching the patcher uses. */
function locateLines(code: string, search: string): LineRange | null {
  const norm = search.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  let index = code.indexOf(norm);
  if (index === -1) {
    // Line-trimmed: indentation drift is the patcher's most common tolerance.
    const lines = code.split('\n');
    const want = norm.split('\n').map(l => l.trim()).filter(Boolean);
    if (!want.length) return null;
    for (let i = 0; i < lines.length; i++) {
      let k = 0; let j = i;
      while (j < lines.length && k < want.length) {
        const t = lines[j].trim();
        if (!t) { j++; continue; }
        if (t !== want[k]) break;
        k++; j++;
      }
      if (k === want.length) return { start: i + 1, end: j };
    }
    return null;
  }
  const start = code.slice(0, index).split('\n').length;
  return { start, end: start + norm.split('\n').length - 1 };
}

export interface ScopeVerdict {
  ok: boolean;
  /** First lines of each block that landed outside the selected element. */
  outside: string[];
}

/**
 * Every applied block must overlap one of the selected element's ranges
 * (with a small margin for the wrapping line above or below). A block whose
 * location cannot be determined is treated as outside: silently allowing what
 * cannot be explained is the failure this guard exists to stop.
 */
export function repairWithinTarget(
  code: string,
  applied: PatchBlock[],
  component: string,
  margin = 2,
): ScopeVerdict {
  const ranges = elementRanges(code, component);
  if (ranges.length === 0) return { ok: false, outside: applied.map(b => firstLine(b.search)) };
  const outside: string[] = [];
  for (const block of applied) {
    const at = locateLines(code, block.search);
    const inside = at && ranges.some(r => at.start <= r.end + margin && at.end >= r.start - margin);
    if (!inside) outside.push(firstLine(block.search));
  }
  return { ok: outside.length === 0, outside };
}

function firstLine(text: string): string {
  return (text.split('\n').map(l => l.trim()).find(Boolean) || '').slice(0, 80);
}

/** What the visual critic is asked to judge on a targeted turn. */
export function scopedCritiqueRequest(prompt: string, selection: string): string {
  return [
    'This is a modification of an existing story, not a new composition.',
    `The user selected ${selection} and asked: "${prompt}".`,
    'Only that element was meant to change. Judge whether THAT element shows the change',
    'and whether the composition still renders well. Do not require the request to apply',
    'to anything else on the page — the rest was already correct and was deliberately left alone.',
  ].join('\n');
}

/** Told to the repair model on a targeted turn, above the findings. */
export function repairScopeNote(selection: string): string {
  return [
    `SCOPE: the user's request has ALREADY been applied, and it applied only to ${selection}.`,
    'Do not apply or reinterpret the request again. Fix only the findings listed below, and',
    'change only that element or the lines immediately around it. An edit block anywhere',
    'else in the file will be rejected.',
  ].join('\n');
}
