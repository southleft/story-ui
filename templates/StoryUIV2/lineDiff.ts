/**
 * Line diff — what an update did to the story, as hunks.
 *
 * Written here rather than pulled in: the consuming project would carry the
 * dependency, and the whole need is "which lines changed between two
 * versions of one short file". Myers' O(ND) algorithm on lines, after
 * trimming the common prefix and suffix, which for a targeted edit leaves
 * only the changed region to search.
 *
 * Two sources, one shape. When the completion carries `edits` (the exact
 * search/replace blocks the model answered with), each edit becomes a hunk —
 * that is what the model SAID it changed, unpolluted by any whitespace the
 * post-processors touched. Otherwise the two versions are diffed outright.
 */

export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the previous version; absent for added lines. */
  oldNo?: number;
  /** 1-based line number in the new version; absent for removed lines. */
  newNo?: number;
}

export interface DiffHunk {
  /**
   * Unified-diff coordinates. When a hunk has no lines on one side, the
   * start is the line BEFORE the change on that side, as `diff -u` does.
   * Absent when the hunk came from an edit block that could not be located
   * in the previous version — the change is known, its position is not.
   */
  oldStart?: number;
  oldCount: number;
  newStart?: number;
  newCount: number;
  lines: DiffLine[];
}

export interface LineDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

export interface SearchReplaceEdit {
  search: string;
  replace: string;
}

export const DEFAULT_CONTEXT = 3;

/** Split into lines, dropping the one empty "line" a trailing newline produces. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

interface Op {
  kind: DiffLineKind;
  text: string;
  /** Old lines consumed BEFORE this op (0-based), so an insertion knows where it sits. */
  oldIndex: number;
  newIndex: number;
}

/**
 * Myers' shortest-edit-script on two arrays of lines.
 *
 * Standard forward pass with a copy of the furthest-reaching vector kept per
 * step, then a backtrack from (n, m). Memory is (n+m)·D, which is why the
 * caller trims the common prefix and suffix first: for an edit that touches
 * six lines of a three-hundred-line file, D is a handful and the vectors are
 * short.
 */
function myers(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];

  const offset = max + 1;
  const width = 2 * max + 3;
  let v = new Int32Array(width);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v);
    v = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }

  // Backtrack, collecting ops in reverse.
  const reversed: Array<{ kind: DiffLineKind; x: number; y: number }> = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      reversed.push({ kind: 'context', x: x - 1, y: y - 1 });
      x--; y--;
    }
    if (d > 0) {
      if (x === prevX) reversed.push({ kind: 'add', x, y: prevY });
      else reversed.push({ kind: 'del', x: prevX, y });
    }
    x = prevX;
    y = prevY;
  }

  const ops: Op[] = [];
  for (let i = reversed.length - 1; i >= 0; i--) {
    const r = reversed[i];
    ops.push({
      kind: r.kind,
      text: r.kind === 'add' ? b[r.y] : a[r.x],
      oldIndex: r.x,
      newIndex: r.y,
    });
  }
  return ops;
}

/** The full op list for two line arrays, common ends trimmed before Myers runs. */
function diffOps(a: string[], b: string[]): Op[] {
  let prefix = 0;
  const maxPrefix = Math.min(a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(a.length, b.length) - prefix;
  while (suffix < maxSuffix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;

  const ops: Op[] = [];
  for (let i = 0; i < prefix; i++) ops.push({ kind: 'context', text: a[i], oldIndex: i, newIndex: i });
  const middle = myers(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix));
  for (const op of middle) {
    ops.push({ ...op, oldIndex: op.oldIndex + prefix, newIndex: op.newIndex + prefix });
  }
  const oldTail = a.length - suffix;
  const newTail = b.length - suffix;
  for (let i = 0; i < suffix; i++) {
    ops.push({ kind: 'context', text: a[oldTail + i], oldIndex: oldTail + i, newIndex: newTail + i });
  }
  return ops;
}

/**
 * Group ops into hunks: changes closer together than 2·context share a hunk,
 * and each hunk carries up to `context` unchanged lines on either side.
 * `base` offsets the line numbers, for a block that sits inside a larger file.
 */
function buildHunks(ops: Op[], context: number, base: { old: number; new: number } = { old: 0, new: 0 }): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const changed: number[] = [];
  ops.forEach((op, i) => { if (op.kind !== 'context') changed.push(i); });
  if (changed.length === 0) return hunks;

  let i = 0;
  while (i < changed.length) {
    const first = changed[i];
    let last = first;
    while (i + 1 < changed.length && changed[i + 1] - last <= 2 * context + 1) {
      i++;
      last = changed[i];
    }
    i++;
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, last + context);
    hunks.push(toHunk(ops.slice(from, to + 1), base));
  }
  return hunks;
}

function toHunk(ops: Op[], base: { old: number; new: number }): DiffHunk {
  const lines: DiffLine[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const op of ops) {
    const line: DiffLine = { kind: op.kind, text: op.text };
    if (op.kind !== 'add') { line.oldNo = base.old + op.oldIndex + 1; oldCount++; }
    if (op.kind !== 'del') { line.newNo = base.new + op.newIndex + 1; newCount++; }
    lines.push(line);
  }
  const first = ops[0];
  return {
    // For an empty side, unified format names the line before the change.
    oldStart: oldCount > 0 ? base.old + first.oldIndex + 1 : base.old + first.oldIndex,
    oldCount,
    newStart: newCount > 0 ? base.new + first.newIndex + 1 : base.new + first.newIndex,
    newCount,
    lines,
  };
}

function tally(hunks: DiffHunk[]): LineDiff {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') added++;
      else if (l.kind === 'del') removed++;
    }
  }
  return { hunks, added, removed };
}

/** Diff two versions of a file, line by line. */
export function diffLines(before: string, after: string, context: number = DEFAULT_CONTEXT): LineDiff {
  return tally(buildHunks(diffOps(splitLines(before), splitLines(after)), context));
}

const countNewlines = (s: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};

/**
 * Hunks from the model's own edit blocks.
 *
 * Each edit is located in `before` so it can be widened to whole lines and
 * given real line numbers and context; an edit that cannot be located (no
 * previous version, or a search string that does not appear in it) is still
 * rendered — search lines removed, replace lines added — just without
 * coordinates. Inside a block the two sides are diffed too, so the lines the
 * edit merely repeated read as context rather than as churn.
 */
export function diffFromEdits(
  edits: SearchReplaceEdit[],
  before: string | null,
  context: number = DEFAULT_CONTEXT,
): LineDiff {
  const beforeLines = before != null ? splitLines(before) : null;
  const located: Array<{ oldStart0: number; oldBlock: string[]; newBlock: string[] }> = [];
  const floating: DiffHunk[] = [];

  for (const edit of edits) {
    const search = typeof edit?.search === 'string' ? edit.search : '';
    const replace = typeof edit?.replace === 'string' ? edit.replace : '';
    if (!search && !replace) continue;

    const at = before != null && search ? before.indexOf(search) : -1;
    if (before == null || at < 0) {
      const ops = diffOps(splitLines(search), splitLines(replace));
      // Everything in the block is the hunk; the context trimming is for
      // surrounding lines, which an unlocated edit does not have.
      if (ops.some(op => op.kind !== 'context')) {
        const hunk = toHunk(ops, { old: 0, new: 0 });
        floating.push({
          ...hunk,
          oldStart: undefined,
          newStart: undefined,
          // Numbers relative to a block of unknown position would read as
          // positions in the file.
          lines: hunk.lines.map(({ kind, text }) => ({ kind, text })),
        });
      }
      continue;
    }

    // Widen to whole lines: a sub-line search ("color=\"red\"") is shown as
    // the line it lives on, before and after.
    const end = at + search.length;
    const lineStart = before.lastIndexOf('\n', at - 1) + 1;
    const endProbe = end > at && before[end - 1] === '\n' ? end - 1 : end;
    let lineEnd = before.indexOf('\n', endProbe);
    if (lineEnd < 0) lineEnd = before.length;
    const oldBlock = before.slice(lineStart, lineEnd);
    const newBlock = before.slice(lineStart, at) + replace + before.slice(end, lineEnd);
    located.push({
      oldStart0: countNewlines(before.slice(0, lineStart)),
      oldBlock: splitLines(oldBlock),
      newBlock: splitLines(newBlock),
    });
  }

  located.sort((a, b) => a.oldStart0 - b.oldStart0);
  const hunks: DiffHunk[] = [];
  let drift = 0;
  for (const { oldStart0, oldBlock, newBlock } of located) {
    // Surrounding lines from the previous version, which the new version
    // shares by construction (the edit did not touch them).
    const ctxBefore = beforeLines!.slice(Math.max(0, oldStart0 - context), oldStart0);
    const afterIdx = oldStart0 + oldBlock.length;
    const ctxAfter = beforeLines!.slice(afterIdx, afterIdx + context);
    const a = [...ctxBefore, ...oldBlock, ...ctxAfter];
    const b = [...ctxBefore, ...newBlock, ...ctxAfter];
    const ops = diffOps(a, b);
    if (!ops.some(op => op.kind !== 'context')) continue;
    const base = { old: oldStart0 - ctxBefore.length, new: oldStart0 - ctxBefore.length + drift };
    for (const h of buildHunks(ops, context, base)) hunks.push(h);
    drift += newBlock.length - oldBlock.length;
  }

  return tally([...hunks, ...floating]);
}

/**
 * The diff for an update: the model's edit blocks when the completion
 * carried them, otherwise the two versions compared.
 */
export function diffForUpdate(
  before: string | null,
  after: string,
  edits?: SearchReplaceEdit[] | null,
  context: number = DEFAULT_CONTEXT,
): LineDiff | null {
  if (Array.isArray(edits) && edits.length > 0) return diffFromEdits(edits, before, context);
  if (before == null) return null;
  return diffLines(before, after, context);
}

const places = (n: number) => `${n} place${n === 1 ? '' : 's'}`;

/** "+12 −4 in 2 places" — the toolbar/summary line. */
export function summarizeDiff(diff: LineDiff): string {
  if (diff.hunks.length === 0) return 'No changes';
  return `+${diff.added} −${diff.removed} in ${places(diff.hunks.length)}`;
}

/** "Changed 16 lines in 2 places" — the line under the assistant's reply. */
export function describeDiff(diff: LineDiff): string {
  if (diff.hunks.length === 0) return 'No lines changed';
  const n = diff.added + diff.removed;
  return `Changed ${n} line${n === 1 ? '' : 's'} in ${places(diff.hunks.length)}`;
}

/** "@@ -12,4 +12,6 @@", or "Edit 2" when the hunk has no coordinates. */
export function hunkHeader(hunk: DiffHunk, index: number): string {
  if (hunk.oldStart === undefined || hunk.newStart === undefined) return `Edit ${index + 1}`;
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
}
