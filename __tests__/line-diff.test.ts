/**
 * The line diff behind the workspace's Changes view.
 *
 * `diffLines` is Myers on lines with 3 lines of context; `diffFromEdits`
 * renders the model's own search/replace blocks as hunks, located in the
 * previous version when it is known. Both produce the same shape, and the
 * summary strings are what the toolbar and the assistant turn print.
 */

import { describe, it, expect } from 'vitest';
import {
  diffLines,
  diffFromEdits,
  diffForUpdate,
  splitLines,
  summarizeDiff,
  describeDiff,
  hunkHeader,
  type LineDiff,
} from '../templates/StoryUIV2/lineDiff.js';

const lines = (...ls: string[]) => ls.join('\n') + '\n';

/** Rebuild the new version from a diff's hunks plus the untouched lines of the old one. */
function applyDiff(before: string, diff: LineDiff): string {
  const old = splitLines(before);
  const out: string[] = [];
  let cursor = 0; // next old line (0-based) not yet emitted
  for (const h of diff.hunks) {
    const start = h.oldCount > 0 ? h.oldStart! - 1 : h.oldStart!;
    while (cursor < start) out.push(old[cursor++]);
    for (const l of h.lines) {
      if (l.kind === 'del') { cursor++; continue; }
      if (l.kind === 'context') cursor++;
      out.push(l.text);
    }
  }
  while (cursor < old.length) out.push(old[cursor++]);
  return out.join('\n') + '\n';
}

describe('splitLines', () => {
  it('does not invent an empty last line from a trailing newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['']);
  });
});

describe('diffLines', () => {
  it('reports no hunks for identical input', () => {
    const d = diffLines('a\nb\nc\n', 'a\nb\nc\n');
    expect(d.hunks).toEqual([]);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  it('finds a one-line change and surrounds it with three lines of context', () => {
    const before = lines('1', '2', '3', '4', '5', '6', '7', '8', '9');
    const after = lines('1', '2', '3', '4', 'five', '6', '7', '8', '9');
    const d = diffLines(before, after);
    expect(d.hunks).toHaveLength(1);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    const h = d.hunks[0];
    expect(h.oldStart).toBe(2);
    expect(h.oldCount).toBe(7);
    expect(h.newStart).toBe(2);
    expect(h.newCount).toBe(7);
    expect(h.lines.map(l => `${l.kind[0]}:${l.text}`)).toEqual([
      'c:2', 'c:3', 'c:4', 'd:5', 'a:five', 'c:6', 'c:7', 'c:8',
    ]);
    expect(hunkHeader(h, 0)).toBe('@@ -2,7 +2,7 @@');
  });

  it('numbers lines on the side they belong to', () => {
    const d = diffLines(lines('a', 'b', 'c'), lines('a', 'x', 'y', 'c'));
    const h = d.hunks[0];
    expect(h.lines).toEqual([
      { kind: 'context', text: 'a', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'b', oldNo: 2 },
      { kind: 'add', text: 'x', newNo: 2 },
      { kind: 'add', text: 'y', newNo: 3 },
      { kind: 'context', text: 'c', oldNo: 3, newNo: 4 },
    ]);
  });

  it('splits distant changes into separate hunks and merges nearby ones', () => {
    const before = lines(...Array.from({ length: 30 }, (_, i) => `line ${i + 1}`));
    const far = before.replace('line 3\n', 'LINE 3\n').replace('line 25\n', 'LINE 25\n');
    expect(diffLines(before, far).hunks).toHaveLength(2);
    const near = before.replace('line 3\n', 'LINE 3\n').replace('line 8\n', 'LINE 8\n');
    // Four unchanged lines between them, under the 2·context threshold.
    expect(diffLines(before, near).hunks).toHaveLength(1);
    const justFar = before.replace('line 3\n', 'LINE 3\n').replace('line 11\n', 'LINE 11\n');
    // Seven unchanged lines between them: context 3 on each side leaves a gap.
    expect(diffLines(before, justFar).hunks).toHaveLength(2);
  });

  it('handles a pure insertion at the top and a pure deletion at the bottom', () => {
    const top = diffLines(lines('a', 'b'), lines('new', 'a', 'b'));
    expect(top.hunks[0].oldStart).toBe(1);
    expect(top.hunks[0].newStart).toBe(1);
    expect(top.added).toBe(1);
    expect(top.removed).toBe(0);
    const bottom = diffLines(lines('a', 'b', 'c'), lines('a', 'b'));
    expect(bottom.added).toBe(0);
    expect(bottom.removed).toBe(1);
    expect(bottom.hunks[0].lines.at(-1)).toEqual({ kind: 'del', text: 'c', oldNo: 3 });
  });

  it('handles an empty side', () => {
    const grow = diffLines('', lines('a', 'b'));
    expect(grow.added).toBe(2);
    expect(grow.hunks[0].oldStart).toBe(0);
    expect(grow.hunks[0].oldCount).toBe(0);
    expect(hunkHeader(grow.hunks[0], 0)).toBe('@@ -0,0 +1,2 @@');
    const shrink = diffLines(lines('a', 'b'), '');
    expect(shrink.removed).toBe(2);
    expect(shrink.hunks[0].newCount).toBe(0);
  });

  it('produces a script that rebuilds the new version, for a realistic story edit', () => {
    const before = [
      "import React from 'react';",
      "import { Button, Card, Table } from '@mantine/core';",
      '',
      'const meta = { title: "Generated/Team members table" };',
      'export default meta;',
      '',
      'export const Default = () => (',
      '  <Card>',
      '    <Table>',
      '      <Table.Thead>',
      '        <Table.Tr><Table.Th>Name</Table.Th><Table.Th>Role</Table.Th></Table.Tr>',
      '      </Table.Thead>',
      '    </Table>',
      '    <Button color="red">Remove</Button>',
      '  </Card>',
      ');',
    ].join('\n') + '\n';
    const after = before
      .replace("import { Button, Card, Table }", "import { Badge, Button, Card, Table }")
      .replace('<Table.Th>Role</Table.Th>', '<Table.Th>Role</Table.Th><Table.Th>Status</Table.Th>')
      .replace('<Button color="red">Remove</Button>', '<Button color="red" variant="light">Remove</Button>\n    <Badge>3 members</Badge>');
    const d = diffLines(before, after);
    expect(applyDiff(before, d)).toBe(after);
    expect(d.added).toBe(4);
    expect(d.removed).toBe(3);
    expect(summarizeDiff(d)).toBe(`+4 −3 in ${d.hunks.length} place${d.hunks.length === 1 ? '' : 's'}`);
  });

  it('rebuilds the new version when the whole file is rewritten', () => {
    const before = lines(...Array.from({ length: 40 }, (_, i) => `old ${i}`));
    const after = lines(...Array.from({ length: 35 }, (_, i) => (i % 5 === 0 ? `old ${i}` : `new ${i}`)));
    const d = diffLines(before, after);
    expect(applyDiff(before, d)).toBe(after);
  });

  it('rebuilds the new version for moved and duplicated lines', () => {
    const before = lines('a', 'b', 'c', 'd', 'e', 'f');
    const after = lines('c', 'd', 'a', 'b', 'a', 'f', 'g');
    const d = diffLines(before, after);
    expect(applyDiff(before, d)).toBe(after);
  });
});

describe('diffFromEdits', () => {
  const before = [
    'export const Default = () => (',
    '  <Stack>',
    '    <Title order={2}>Team</Title>',
    '    <Button color="red">Remove</Button>',
    '    <Text>Six members</Text>',
    '  </Stack>',
    ');',
  ].join('\n') + '\n';

  it('locates a whole-line edit and gives it line numbers and context', () => {
    const d = diffFromEdits(
      [{ search: '    <Button color="red">Remove</Button>\n', replace: '    <Button color="blue">Remove</Button>\n' }],
      before,
    );
    expect(d.hunks).toHaveLength(1);
    const h = d.hunks[0];
    expect(h.oldStart).toBe(1);
    expect(h.newStart).toBe(1);
    expect(h.lines.map(l => `${l.kind[0]}:${l.text.trim()}`)).toEqual([
      'c:export const Default = () => (',
      'c:<Stack>',
      'c:<Title order={2}>Team</Title>',
      'd:<Button color="red">Remove</Button>',
      'a:<Button color="blue">Remove</Button>',
      'c:<Text>Six members</Text>',
      'c:</Stack>',
      'c:);',
    ]);
    expect(h.lines[3].oldNo).toBe(4);
    expect(h.lines[4].newNo).toBe(4);
  });

  it('widens a sub-line search to the line it lives on', () => {
    const d = diffFromEdits([{ search: 'color="red"', replace: 'color="grape"' }], before);
    const del = d.hunks[0].lines.find(l => l.kind === 'del');
    const add = d.hunks[0].lines.find(l => l.kind === 'add');
    expect(del?.text).toBe('    <Button color="red">Remove</Button>');
    expect(add?.text).toBe('    <Button color="grape">Remove</Button>');
    expect(del?.oldNo).toBe(4);
  });

  it('shows the lines an edit repeated unchanged as context, not churn', () => {
    const d = diffFromEdits(
      [{
        search: '    <Title order={2}>Team</Title>\n    <Button color="red">Remove</Button>\n    <Text>Six members</Text>\n',
        replace: '    <Title order={2}>Team</Title>\n    <Button color="red">Remove</Button>\n    <Text>Seven members</Text>\n',
      }],
      before,
    );
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });

  it('keeps new-side numbers honest across several edits', () => {
    const d = diffFromEdits(
      [
        { search: '  <Stack>\n', replace: '  <Stack gap="md">\n    <Badge>New</Badge>\n' },
        { search: '    <Text>Six members</Text>\n', replace: '    <Text>Seven members</Text>\n' },
      ],
      before,
      1,
    );
    expect(d.hunks).toHaveLength(2);
    // The first edit added one line, so the second hunk's new-side start is one further down.
    expect(d.hunks[1].oldStart).toBe(4);
    expect(d.hunks[1].newStart).toBe(5);
    const text = d.hunks[1].lines.find(l => l.kind === 'add');
    expect(text?.newNo).toBe(6);
  });

  it('renders an edit it cannot locate, without coordinates', () => {
    const d = diffFromEdits([{ search: 'not in the file', replace: 'something else' }], before);
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].oldStart).toBeUndefined();
    expect(hunkHeader(d.hunks[0], 0)).toBe('Edit 1');
    expect(d.hunks[0].lines).toEqual([
      { kind: 'del', text: 'not in the file' },
      { kind: 'add', text: 'something else' },
    ]);
    // No previous version at all: same treatment.
    expect(diffFromEdits([{ search: 'a\n', replace: 'b\n' }], null).hunks[0].oldStart).toBeUndefined();
  });

  it('skips an edit that changes nothing and ignores malformed entries', () => {
    const d = diffFromEdits([
      { search: '  <Stack>\n', replace: '  <Stack>\n' },
      { search: '', replace: '' },
      { search: 'color="red"', replace: 'color="teal"' },
    ], before);
    expect(d.hunks).toHaveLength(1);
  });
});

describe('diffForUpdate', () => {
  it('prefers the edit blocks when the completion carries them', () => {
    const before = 'a\nb\nc\n';
    const d = diffForUpdate(before, 'a\nB\nc\n', [{ search: 'b\n', replace: 'B\n' }]);
    expect(d?.hunks[0].lines.filter(l => l.kind !== 'context')).toEqual([
      { kind: 'del', text: 'b', oldNo: 2 },
      { kind: 'add', text: 'B', newNo: 2 },
    ]);
  });

  it('falls back to comparing the versions when there are no edits', () => {
    expect(diffForUpdate('a\nb\n', 'a\nc\n', [])?.removed).toBe(1);
    expect(diffForUpdate('a\nb\n', 'a\nc\n', undefined)?.added).toBe(1);
  });

  it('has nothing to show without a previous version or edits', () => {
    expect(diffForUpdate(null, 'a\n')).toBeNull();
  });
});

describe('summaries', () => {
  it('prints the toolbar line and the turn line', () => {
    const d = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(summarizeDiff(d)).toBe('+2 −1 in 1 place');
    expect(describeDiff(d)).toBe('Changed 3 lines in 1 place');
    const one = diffLines('a\nb\n', 'a\n');
    expect(describeDiff(one)).toBe('Changed 1 line in 1 place');
    const none = diffLines('a\n', 'a\n');
    expect(summarizeDiff(none)).toBe('No changes');
    expect(describeDiff(none)).toBe('No lines changed');
  });
});
