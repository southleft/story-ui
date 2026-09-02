/**
 * "Center the pagination" must produce the same file with the pagination
 * centred. Search/replace blocks make the change deterministic.
 */
import { describe, it, expect } from 'vitest';
import { applyPatches, parsePatchBlocks, hasPatchBlocks, describePatchFailures } from '../story-generator/editing/patchEdit.js';
import { editDivergence } from '../story-generator/postProcessStory.js';

const file = `import { Table, Pagination, Group } from '@mantine/core';

export const Default = () => (
  <div>
    <Table>
      <Table.Tbody>{rows}</Table.Tbody>
    </Table>
    <Pagination total={5} value={page} onChange={setPage} mt="md" />
    <Group mt="lg">
      <Button variant="outline">Export</Button>
    </Group>
  </div>
);
`;

const reply = `I'll wrap the pagination in a centred Group.

\`\`\`edit
<<<<<<< SEARCH
    <Pagination total={5} value={page} onChange={setPage} mt="md" />
=======
    <Group justify="center" mt="md">
      <Pagination total={5} value={page} onChange={setPage} />
    </Group>
>>>>>>> REPLACE
\`\`\`
`;

describe('patch edits', () => {
  it('detects and parses edit blocks', () => {
    expect(hasPatchBlocks(reply)).toBe(true);
    expect(hasPatchBlocks('```tsx\nconst x = 1;\n```')).toBe(false);
    const blocks = parsePatchBlocks(reply);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].search).toContain('<Pagination');
  });

  it('applies the block and changes nothing else', () => {
    const r = applyPatches(file, parsePatchBlocks(reply));
    expect(r.failures).toHaveLength(0);
    expect(r.code).toContain('<Group justify="center" mt="md">');
    expect(r.code).toContain('<Button variant="outline">Export</Button>');
    const { divergence } = editDivergence(file, r.code);
    expect(divergence).toBeLessThan(0.15);
  });

  it('matches when the model dropped the indentation', () => {
    const flush = reply.replace(/\n    <Pagination/, '\n<Pagination');
    const r = applyPatches(file, parsePatchBlocks(flush));
    expect(r.failures).toHaveLength(0);
    expect(r.code).toContain('    <Group justify="center" mt="md">');
  });

  it('refuses a SEARCH that matches nothing, with a hint', () => {
    const bad = reply.replace('total={5}', 'total={9}');
    const r = applyPatches(file, parsePatchBlocks(bad));
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].reason).toBe('not-found');
    expect(r.code).toBe(file);
    expect(describePatchFailures(r.failures)).toContain('was not found');
  });

  it('refuses an ambiguous SEARCH instead of guessing', () => {
    const twice = file.replace('</div>', '  <Group mt="lg">\n    </Group>\n  </div>');
    const r = applyPatches(twice, [{ search: '    <Group mt="lg">', replace: '    <Group mt="xl">' }]);
    expect(r.failures[0]?.reason).toBe('ambiguous');
  });

  it('applies several blocks in order', () => {
    const r = applyPatches(file, [
      { search: 'variant="outline">Export', replace: 'variant="filled">Download' },
      { search: 'total={5}', replace: 'total={10}' },
    ]);
    expect(r.applied).toHaveLength(2);
    expect(r.code).toContain('variant="filled">Download');
    expect(r.code).toContain('total={10}');
  });
});
