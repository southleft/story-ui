import { describe, it, expect } from 'vitest';
import {
  targetComponentFromSelection, elementRanges, repairWithinTarget, scopedCritiqueRequest, repairScopeNote,
} from '../story-generator/editing/repairScope';

const story = `import { Box, SimpleGrid } from '@mantine/core';
import { Statlet } from '../../housekit/Statlet';

export const Default = () => (
  <Box p="xl" mih="100vh">
    <SimpleGrid cols={4}>
      {stats.map(s => (
        <Statlet
          key={s.label}
          label={s.label}
          value={s.value}
          style={{ padding: '8px' }}
        />
      ))}
    </SimpleGrid>
    <Statlet label="Solo" value="1">
      <span>child</span>
    </Statlet>
  </Box>
);
`;

describe('target component from a selection description', () => {
  it('reads the component name past a system label and before the anchor', () => {
    expect(targetComponentFromSelection('a Statlet containing the text "OPEN INCIDENTS" (item 2 of 4) inside SimpleGrid > Dashboard')).toBe('Statlet');
    expect(targetComponentFromSelection('a Mantine Button containing the text "Save"')).toBe('Button');
    expect(targetComponentFromSelection('a Card.Section (item 1 of 2)')).toBe('Card.Section');
  });
  it('is null for a native tag', () => {
    expect(targetComponentFromSelection('a <div> containing the text "hello"')).toBeNull();
  });
});

describe('element ranges', () => {
  it('spans a multi-line self-closing element with braces in attributes, and a paired one', () => {
    const r = elementRanges(story, 'Statlet');
    expect(r).toEqual([{ start: 8, end: 13 }, { start: 16, end: 18 }]);
  });
  it('does not match a longer name with the same prefix', () => {
    expect(elementRanges('<StatletGroup />\n<Statlet />', 'Statlet')).toEqual([{ start: 2, end: 2 }]);
  });
});

describe('repair scope guard', () => {
  it('accepts a block inside the selected element', () => {
    const v = repairWithinTarget(story, [{ search: "          style={{ padding: '8px' }}", replace: "          style={{ padding: '12px' }}" }], 'Statlet');
    expect(v.ok).toBe(true);
  });
  it('rejects the block that painted the page container', () => {
    const v = repairWithinTarget(story, [{ search: '  <Box p="xl" mih="100vh">', replace: '  <Box p="xl" bg="orange.5" mih="100vh">' }], 'Statlet');
    expect(v.ok).toBe(false);
    expect(v.outside).toEqual(['<Box p="xl" mih="100vh">']);
  });
  it('tolerates indentation drift like the patcher does', () => {
    const v = repairWithinTarget(story, [{ search: 'label={s.label}\nvalue={s.value}', replace: 'label={s.label}\nvalue={String(s.value)}' }], 'Statlet');
    expect(v.ok).toBe(true);
  });
  it('rejects everything when the selected element is not in the file', () => {
    expect(repairWithinTarget(story, [{ search: '<span>child</span>', replace: '<b>child</b>' }], 'Missing').ok).toBe(false);
  });
});

describe('prompt text', () => {
  it('tells the critic and the repair model that only the selection changed', () => {
    expect(scopedCritiqueRequest('change the background to orange', 'a Statlet containing "Open"')).toContain('Only that element was meant to change');
    expect(repairScopeNote('a Statlet containing "Open"')).toContain('ALREADY been applied');
  });
});
