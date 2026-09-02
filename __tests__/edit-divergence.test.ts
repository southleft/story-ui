/**
 * A targeted edit must not become a rewrite.
 *
 * Reported from manual testing: with one button selected and the request "Red
 * background.", the tool returned an entirely different page — and the reply
 * asserted that "the Grid, Row, and Column layout structure remains
 * unchanged", because the model was describing the composition it had just
 * invented. Every existing gate passed it: the code compiled, rendered, and
 * verified clean. Nothing measured whether it was still the same page.
 */

import { describe, it, expect } from 'vitest';
import { editDivergence } from '../story-generator/postProcessStory.js';

const original = `
  <Section>
    <Heading>My Profile</Heading>
    <Tile>
      <Grid>
        <Column><TextInput /></Column>
        <Column><TextInput /></Column>
      </Grid>
      <Button>Save</Button>
      <Button>Publish</Button>
    </Tile>
  </Section>
`;

describe('editDivergence', () => {
  it('scores a property-only change as near zero', () => {
    // What "make this button red" should produce: one attribute added.
    const edited = original.replace('<Button>Publish</Button>', '<Button kind="danger">Publish</Button>');
    expect(editDivergence(original, edited).divergence).toBeLessThan(0.1);
  });

  it('tolerates a small addition', () => {
    const edited = original.replace('</Tile>', '  <Button>Cancel</Button>\n    </Tile>');
    expect(editDivergence(original, edited).divergence).toBeLessThan(0.2);
  });

  it('scores a pure addition as zero, however large', () => {
    // "Add a filters panel" keeps everything that existed. The failure being
    // guarded against is prior work destroyed, not new work added.
    const edited = original.replace('</Section>', `
      <Panel>
        <Heading>Filters</Heading>
        <Checkbox label="Active" />
        <Checkbox label="Archived" />
        <Select placeholder="Sort by" />
        <Button>Apply</Button>
      </Panel>
    </Section>`);
    expect(editDivergence(original, edited).divergence).toBe(0);
  });

  it('flags a rewrite that keeps the tags but replaces the content', () => {
    // The gap in the tag-only metric: the same six components, every word and
    // prop on them different, scored ~0 — the shape of the tree survived while
    // the page did not.
    const page = (title: string, tone: string, labels: string[]) => `
      <Section>
        <Heading>${title}</Heading>
        <Grid>
          ${labels.map(l => `<Card tone="${tone}" title="${l}"><Text>${l} details</Text></Card>`).join('\n          ')}
        </Grid>
      </Section>
    `;
    const before = page('Team overview', 'calm', ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']);
    const rewritten = page('Quarterly revenue', 'loud', ['North', 'South', 'East', 'West', 'Online', 'Retail']);
    // An identical tag multiset with all content replaced scores exactly the
    // content weight (0.65). The conversational guard limit (0.6) sits below
    // it so this exact failure — same components, entirely different page —
    // is blockable even without a selection.
    expect(editDivergence(before, rewritten).divergence).toBeGreaterThan(0.6);
  });

  it('is not fooled by reordering', () => {
    // Moving a section is not a rewrite. Comparing sequences positionally
    // would call this a total replacement and block a legitimate edit.
    const edited = `
      <Section>
        <Tile>
          <Button>Publish</Button>
          <Button>Save</Button>
          <Grid>
            <Column><TextInput /></Column>
            <Column><TextInput /></Column>
          </Grid>
        </Tile>
        <Heading>My Profile</Heading>
      </Section>
    `;
    expect(editDivergence(original, edited).divergence).toBeLessThan(0.1);
  });

  it('catches a wholesale replacement', () => {
    // The reported failure: a different page wearing the same title.
    const replaced = `
      <Section>
        <Heading>Carbon MySpace</Heading>
        <Stack>
          <Tabs><Tab /><Tab /><Tab /></Tabs>
          <AspectRatio><Image /></AspectRatio>
          <Tag /><Tag /><Tag />
          <ContainedList><ContainedListItem /><ContainedListItem /></ContainedList>
        </Stack>
      </Section>
    `;
    expect(editDivergence(original, replaced).divergence).toBeGreaterThan(0.5);
  });

  it('reports element counts so the message can be concrete', () => {
    const r = editDivergence(original, original);
    expect(r.before).toBe(r.after);
    expect(r.before).toBeGreaterThan(0);
    expect(r.divergence).toBe(0);
  });

  it('does not divide by zero on empty prior code', () => {
    expect(editDivergence('', '<Button />').divergence).toBe(0);
  });
});
