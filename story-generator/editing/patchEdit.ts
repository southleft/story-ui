/**
 * Search/replace edits: change what was asked, and nothing else.
 *
 * An update used to hand the whole file to the model and ask for the whole
 * file back "with only the requested change". Models rewrite as a matter of
 * style; the divergence guard catches the worst of it, and everything under
 * the threshold — a renamed handler, a reflowed prop list, a dropped
 * comment — still reached the file. "Center the pagination" must produce the
 * same file with the pagination centred.
 *
 * So an update asks the model for edit blocks instead:
 *
 *   <<<<<<< SEARCH
 *   (lines copied verbatim from the current file)
 *   =======
 *   (the replacement)
 *   >>>>>>> REPLACE
 *
 * Each block is applied to the current file deterministically. A SEARCH that
 * matches nothing, or more than one place, is a failure the model is told
 * about — never a guess. The model may still answer with a complete file
 * when the change is a restructure; that path is unchanged.
 */

export interface PatchBlock {
  search: string;
  replace: string;
}

export interface PatchFailure {
  block: PatchBlock;
  reason: 'not-found' | 'ambiguous';
  /** Nearest line in the file, to help the model correct its SEARCH. */
  hint?: string;
}

export interface PatchResult {
  code: string;
  applied: PatchBlock[];
  failures: PatchFailure[];
}

const BLOCK_RE = /<{7} SEARCH\r?\n([\s\S]*?)\r?\n?={7}\r?\n([\s\S]*?)\r?\n?>{7} REPLACE/g;

export function hasPatchBlocks(reply: string): boolean {
  return /<{7} SEARCH[\s\S]*?={7}[\s\S]*?>{7} REPLACE/.test(reply);
}

/** Pull every edit block out of a reply, in order. */
export function parsePatchBlocks(reply: string): PatchBlock[] {
  const blocks: PatchBlock[] = [];
  for (const m of reply.matchAll(BLOCK_RE)) {
    blocks.push({ search: m[1], replace: m[2] });
  }
  return blocks;
}

const normalise = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
const squash = (s: string) => normalise(s).replace(/\s+/g, ' ').trim();

/**
 * Find where a SEARCH sits in the file: exact first, then with trailing
 * whitespace ignored, then with all whitespace collapsed (indentation drift is
 * the common miss). Returns the [start, end) in the ORIGINAL text.
 */
function locate(code: string, search: string): { start: number; end: number }[] {
  const exact: { start: number; end: number }[] = [];
  let i = 0;
  while ((i = code.indexOf(search, i)) !== -1) { exact.push({ start: i, end: i + search.length }); i += search.length; }
  if (exact.length) return exact;

  // Line-based match ignoring trailing whitespace and indentation.
  const codeLines = code.split('\n');
  const want = normalise(search).split('\n').map(l => l.trim());
  while (want.length && want[want.length - 1] === '') want.pop();
  while (want.length && want[0] === '') want.shift();
  if (!want.length) return [];
  const hits: { start: number; end: number }[] = [];
  const offsets: number[] = [];
  let acc = 0;
  for (const l of codeLines) { offsets.push(acc); acc += l.length + 1; }
  for (let s = 0; s + want.length <= codeLines.length; s++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) {
      if (codeLines[s + k].trim() !== want[k]) { ok = false; break; }
    }
    if (ok) {
      const start = offsets[s];
      const lastIdx = s + want.length - 1;
      const end = offsets[lastIdx] + codeLines[lastIdx].length;
      hits.push({ start, end });
    }
  }
  if (hits.length) return hits;

  // Whole-block whitespace-collapsed match, as a last resort for reflowed JSX.
  const target = squash(search);
  if (!target) return [];
  const flat = squash(code);
  if (flat.split(target).length - 1 !== 1) return [];
  // Map back by scanning windows of the original that squash to the target.
  for (let a = 0; a < code.length; a++) {
    if (!/\S/.test(code[a])) continue;
    for (let b = a + target.length; b <= code.length && b <= a + search.length * 3 + 64; b++) {
      if (squash(code.slice(a, b)) === target) return [{ start: a, end: b }];
    }
  }
  return [];
}

/** The indentation of the first non-empty line in a span. */
function indentOf(text: string): string {
  const line = text.split('\n').find(l => l.trim().length > 0) ?? '';
  return line.match(/^[ \t]*/)?.[0] ?? '';
}

/**
 * Re-indent a replacement so it sits at the same depth as what it replaces,
 * when the model wrote it flush-left. Relative indentation inside the
 * replacement is preserved.
 */
function reindent(replace: string, toIndent: string, fromIndent: string): string {
  if (!toIndent || indentOf(replace) === toIndent) return replace;
  const lines = replace.split('\n');
  const base = indentOf(replace);
  return lines.map(l => (l.trim().length ? toIndent + (l.startsWith(base) ? l.slice(base.length) : l.replace(/^[ \t]*/, '')) : l)).join('\n')
    .replace(/^\s+/, toIndent) // first line
    .replace(new RegExp(`^${toIndent}${toIndent}`), toIndent);
}

export function applyPatches(code: string, blocks: PatchBlock[]): PatchResult {
  let current = code;
  const applied: PatchBlock[] = [];
  const failures: PatchFailure[] = [];
  for (const block of blocks) {
    const search = block.search.replace(/\r\n/g, '\n');
    if (!search.trim()) { failures.push({ block, reason: 'not-found', hint: 'SEARCH was empty' }); continue; }
    const hits = locate(current, search);
    if (hits.length === 0) {
      const firstLine = search.split('\n').find(l => l.trim())?.trim() ?? '';
      const near = current.split('\n').find(l => firstLine && l.includes(firstLine.slice(0, Math.min(24, firstLine.length))));
      failures.push({ block, reason: 'not-found', hint: near ? `nearest line in the file: ${near.trim()}` : undefined });
      continue;
    }
    if (hits.length > 1) {
      failures.push({ block, reason: 'ambiguous', hint: `matches ${hits.length} places — include more surrounding lines` });
      continue;
    }
    const { start, end } = hits[0];
    const original = current.slice(start, end);
    const replacement = reindent(block.replace.replace(/\r\n/g, '\n'), indentOf(original), indentOf(block.replace));
    current = current.slice(0, start) + replacement + current.slice(end);
    applied.push(block);
  }
  return { code: current, applied, failures };
}

/** What to tell the model when a block could not be applied. */
export function describePatchFailures(failures: PatchFailure[]): string {
  return failures.map((f, i) => {
    const head = f.block.search.split('\n').slice(0, 3).join('\n');
    return `${i + 1}. SEARCH ${f.reason === 'ambiguous' ? 'matched more than one place' : 'was not found in the file'}` +
      `${f.hint ? ` (${f.hint})` : ''}:\n${head}${f.block.search.split('\n').length > 3 ? '\n…' : ''}`;
  }).join('\n\n');
}

/** The instructions an update prompt carries. Kept here so tests and prompt agree. */
export const PATCH_INSTRUCTIONS = [
  'HOW TO ANSWER AN UPDATE: do not rewrite the file. Reply with one or more edit blocks,',
  'each changing only the lines the request needs:',
  '',
  '<<<<<<< SEARCH',
  '(lines copied EXACTLY from PREVIOUS GENERATED CODE — same indentation, same text)',
  '=======',
  '(the replacement lines)',
  '>>>>>>> REPLACE',
  '',
  'Rules: every SEARCH must be verbatim from the current file and match exactly one',
  'place — include a line or two of context when a fragment repeats. Put the blocks',
  'inside one ```edit fence. Do not include the rest of the file. Only when the request',
  'is a restructure that touches most of the file may you instead return the complete',
  'file in a single ```tsx block.',
].join('\n');
