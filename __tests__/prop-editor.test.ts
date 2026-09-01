/**
 * Changing a prop without asking a model.
 *
 * "Make this button red" has exactly one correct edit to exactly one attribute
 * of one element. Routing it through an LLM is how a request to change a
 * background colour returned an entirely different page — and it is slow and
 * costs money on top.
 *
 * These pin the property that makes the feature trustworthy: the edit touches
 * what it was pointed at and NOTHING else. A visual editor that occasionally
 * disturbs a neighbour is worse than no visual editor, because the whole point
 * is to be the safe path.
 */

import { describe, it, expect } from 'vitest';
import { editProp, occurrencesInSource, occurrencesWithinOwner, topLevelDeclarations } from '../story-generator/editing/propEditor.js';

const story = `import { Button, Tile, Column } from '@carbon/react';

export const Default = () => (
  <Tile>
    <Button kind="secondary" size="md">Save</Button>
    <Button>Publish</Button>
    <Column lg={5}><span>side</span></Column>
  </Tile>
);
`;

describe('occurrencesInSource', () => {
  it('counts JSX elements by name', () => {
    expect(occurrencesInSource(story, 'Button')).toBe(2);
    expect(occurrencesInSource(story, 'Column')).toBe(1);
    expect(occurrencesInSource(story, 'Nonexistent')).toBe(0);
  });

  it('counts self-closing and paired elements alike', () => {
    expect(occurrencesInSource('<A /><A></A><A/>', 'A')).toBe(3);
  });
});

describe('editProp', () => {
  it('adds a prop to the element that was pointed at, and only that one', () => {
    const r = editProp(story, { component: 'Button', occurrence: 1, prop: 'kind', value: 'danger' });
    expect(r.changed).toBe(true);
    expect(r.code).toContain('<Button kind="danger">Publish</Button>');
    // The neighbour must be untouched. This is the whole promise of the feature.
    expect(r.code).toContain('kind="secondary"');
  });

  it('replaces an existing value and reports what it was', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'kind', value: 'ghost' });
    expect(r.previous).toBe('"secondary"');
    expect(r.code).toContain('kind="ghost"');
    expect(r.code).not.toContain('kind="secondary"');
  });

  it('keeps other attributes on the edited element', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'kind', value: 'ghost' });
    expect(r.code).toContain('size="md"');
  });

  it('writes a number as an expression, not a string', () => {
    // `lg="8"` is not the same prop value as `lg={8}` and Carbon will not
    // accept it as a column span.
    const r = editProp(story, { component: 'Column', occurrence: 0, prop: 'lg', value: 8 });
    expect(r.code).toContain('lg={8}');
    expect(r.code).not.toContain('lg="8"');
  });

  it('writes a true boolean as a bare attribute', () => {
    const r = editProp(story, { component: 'Tile', occurrence: 0, prop: 'hasRoundedCorners', value: true });
    expect(r.code).toMatch(/<Tile hasRoundedCorners>/);
  });

  it('writes false explicitly, since a bare attribute would mean true', () => {
    const r = editProp(story, { component: 'Tile', occurrence: 0, prop: 'light', value: false });
    expect(r.code).toContain('light={false}');
  });

  it('removes a prop when the value is null, resetting it to its default', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'kind', value: null });
    expect(r.changed).toBe(true);
    expect(r.code).not.toContain('kind="secondary"');
    // Removing one attribute must not remove its neighbour.
    expect(r.code).toContain('size="md"');
  });

  it('refuses an occurrence that does not exist, and says how many there are', () => {
    const r = editProp(story, { component: 'Button', occurrence: 7, prop: 'kind', value: 'danger' });
    expect(r.changed).toBe(false);
    expect(r.code).toBe(story);
    expect(r.reason).toContain('has 2');
  });

  it('leaves the file byte-identical when it refuses', () => {
    // A failed edit that reformats is a change nobody asked for.
    const r = editProp(story, { component: 'Missing', occurrence: 0, prop: 'x', value: '1' });
    expect(r.code).toBe(story);
  });

  it('replaces an attribute where it already sits', () => {
    // Removing and re-appending moved every edited prop to the end of the tag,
    // turning `kind="tertiary" size="sm"` into `size="sm" kind="danger"`. The
    // result is correct and the diff is noise — and this writes to a file
    // someone else reviews.
    const before = '<Button kind="tertiary" size="sm" onClick={r}>Reset</Button>';
    const r = editProp(before, { component: 'Button', occurrence: 0, prop: 'kind', value: 'danger' });
    expect(r.code).toContain('<Button kind="danger" size="sm" onClick={r}>');
  });

  it('appends only when the attribute is new', () => {
    const before = '<Button kind="tertiary" size="sm">Reset</Button>';
    const r = editProp(before, { component: 'Button', occurrence: 0, prop: 'disabled', value: true });
    expect(r.code).toContain('kind="tertiary" size="sm" disabled');
  });

  it('survives an attribute value containing braces and elements', () => {
    // The reason this is an AST transform and not a regex. Every regex-based
    // edit in this codebase has eventually met a case like this.
    const tricky = `<Modal footer={<><Button onClick={() => save({ a: 1 })}>Go</Button></>}><p>x</p></Modal>`;
    const r = editProp(tricky, { component: 'Modal', occurrence: 0, prop: 'size', value: 'lg' });
    expect(r.changed).toBe(true);
    expect(r.code).toContain('size="lg"');
    expect(r.code).toContain('save({ a: 1 })');
  });
});

describe('candidate resolution', () => {
  /**
   * The browser can only offer a hypothesis about which component the source
   * contains. A fiber chain includes names that are not JSX elements at all —
   * Carbon wraps its components in a `hookified` HOC, and clicking a Dropdown
   * resolves to the `ListBox` inside it. No list of wrapper names could cover
   * every design system, so the FILE decides.
   */
  const file = `<Tile><Button kind="ghost">Remove</Button></Tile>`;

  it('finds the candidate the source actually contains', () => {
    const candidates = ['hookified', 'ListBox', 'Button'];
    const resolved = candidates.find(c => occurrencesInSource(file, c) > 0);
    expect(resolved).toBe('Button');
  });

  it('prefers the innermost real element over its container', () => {
    // Both Tile and Button are in the file; innermost-first order means the
    // element clicked wins rather than the largest container on the page.
    const candidates = ['Button', 'Tile'];
    expect(candidates.find(c => occurrencesInSource(file, c) > 0)).toBe('Button');
  });

  it('resolves nothing when no candidate is real', () => {
    const candidates = ['hookified', 'ListBox'];
    expect(candidates.find(c => occurrencesInSource(file, c) > 0)).toBeUndefined();
  });

  /**
   * The owners-aware rule (resolveComponentInSource with `owners`), mirrored:
   * prefer the first candidate that appears in the file AND whose fiber-
   * reported OWNER the file declares; fall back to plain first-appears.
   *
   * MEASURED (Mantine 8, live): clicking the LABEL inside a Button puts an
   * internal Box at the head of the chain — owner `Button`, different DOM
   * node, a shape no ordering rule can demote, because Button legitimately
   * owns two chain entries there (exactly what a page composing content looks
   * like). The file settles it: the internal's owner is IMPORTED, the
   * authored Button's owner (PricingPage) is DECLARED.
   */
  describe('authored-owner preference (measured Mantine label-click chain)', () => {
    const resolveWithOwners = (
      source: string, ordered: string[], owners: Record<string, string | undefined>,
    ) => {
      const declared = topLevelDeclarations(source);
      return ordered.find(n => {
        const o = owners[n];
        return o && declared.has(o) && occurrencesInSource(source, n) > 0;
      }) ?? ordered.find(n => occurrencesInSource(source, n) > 0);
    };

    const pricing = `
const PromoBanner = () => (<Box mb={48}><Button>Claim discount</Button></Box>);
const PricingPage = () => (<div><PromoBanner /><Card><Button>Start free trial</Button></Card></div>);
`;

    it('declares what the file declares', () => {
      const d = topLevelDeclarations(pricing);
      expect(d.has('PromoBanner')).toBe(true);
      expect(d.has('PricingPage')).toBe(true);
      expect(d.has('Button')).toBe(false);
      expect(d.has('UnstyledButton')).toBe(false);
    });

    it('resolves the label click to Button, past the internal Box the file also contains', () => {
      // The measured span-click chain, verbatim: [Box, UnstyledButton,
      // Button, …] with owners Box→Button, UnstyledButton→Button,
      // Button→PricingPage. The story authors a <Box> too, so plain
      // first-appears picked Box — the wrong element.
      const ordered = ['Box', 'UnstyledButton', 'Button', 'Paper', 'Card', 'SimpleGrid', 'PricingPage'];
      const owners = {
        Box: 'Button', UnstyledButton: 'Button', Button: 'PricingPage',
        Paper: 'Card', Card: 'PricingPage', SimpleGrid: 'PricingPage', PricingPage: 'hookified',
      };
      expect(resolveWithOwners(pricing, ordered, owners)).toBe('Button');
    });

    it('still resolves an authored Box when its owner is declared', () => {
      const ordered = ['Box', 'PromoBanner', 'PricingPage'];
      const owners = { Box: 'PromoBanner', PromoBanner: 'PricingPage', PricingPage: 'hookified' };
      expect(resolveWithOwners(pricing, ordered, owners)).toBe('Box');
    });

    it('falls back to first-appears when no owner is declared in the file', () => {
      // A story-render arrow owns its elements under an anonymous name; the
      // old contract must hold exactly.
      const ordered = ['Box', 'Button'];
      const owners = { Box: 'unboundStoryFn', Button: 'unboundStoryFn' };
      expect(resolveWithOwners(pricing, ordered, owners)).toBe('Box');
    });
  });
});

describe('occurrencesWithinOwner', () => {
  /**
   * Shaped like the MEASURED college-town failure (campus-events story): the
   * banner component is DEFINED first but RENDERED last, so whole-page DOM
   * order and whole-file source order disagree — the live census reported the
   * banner's Button at DOM position 8 in a file holding 3. The fiber's
   * `_debugOwner` names the component that authored the click
   * (VolunteerBanner / CampusEventsPage), and the FILE states where each
   * declaration begins and ends, so "the Nth <Button> inside <owner>" is
   * derivable without any whole-page assumption.
   */
  const campus = `
const VolunteerBanner = () => (
  <Alert>
    <Button variant="secondary">Sign Up to Volunteer</Button>
  </Alert>
);

function CampusEventsPage() {
  return (
    <div>
      {EVENTS.map((event) => (
        <Card key={event.id}>
          <CardFooter>
            <Button variant="secondary">Register</Button>
          </CardFooter>
        </Card>
      ))}
      <VolunteerBanner />
    </div>
  );
}

export const SportsFilterApplied = {
  render: () => <div><Button>Register</Button></div>,
};
`;

  it('narrows to the Button each owner authored, by whole-file index', () => {
    expect(occurrencesInSource(campus, 'Button')).toBe(3);
    expect(occurrencesWithinOwner(campus, 'Button', 'VolunteerBanner')).toEqual([0]);
    expect(occurrencesWithinOwner(campus, 'Button', 'CampusEventsPage')).toEqual([1]);
    // The story-object's Button belongs to the exported const declaration.
    expect(occurrencesWithinOwner(campus, 'Button', 'SportsFilterApplied')).toEqual([2]);
  });

  it('returns [] for an owner the file does not declare — absence, not "first one"', () => {
    // The route must treat this as "cannot place" and 409 with the count.
    // Interpreting a within-owner position as a whole-file position is how a
    // click on a Register button edited the Alert's button.
    expect(occurrencesWithinOwner(campus, 'Button', 'render')).toEqual([]);
    expect(occurrencesWithinOwner(campus, 'Button', 'SomethingElse')).toEqual([]);
  });

  it('finds every occurrence inside one owner, in file order', () => {
    const promo = `
const PromoBanner = () => (
  <Box mb={48}>
    <Box bg="blue.8"><Text>save 20%</Text></Box>
    <Box bg="yellow.5"><Button>Claim discount</Button></Box>
  </Box>
);
const PricingPage = () => (<div><PromoBanner /><Button>Start free trial</Button></div>);
`;
    // Matches the live Mantine measurement: the yellow Box is the third
    // authored Box inside PromoBanner (index 2), and the browser's
    // owner-scoped census reported occurrence 2 for it.
    expect(occurrencesWithinOwner(promo, 'Box', 'PromoBanner')).toEqual([0, 1, 2]);
    expect(occurrencesWithinOwner(promo, 'Button', 'PromoBanner')).toEqual([0]);
    expect(occurrencesWithinOwner(promo, 'Button', 'PricingPage')).toEqual([1]);
  });

  it('returned indices drive editProp directly', () => {
    const scoped = occurrencesWithinOwner(campus, 'Button', 'CampusEventsPage');
    const r = editProp(campus, { component: 'Button', occurrence: scoped[0], prop: 'variant', value: 'destructive' });
    expect(r.changed).toBe(true);
    // The list's Button changed; the banner's did not.
    expect(r.code).toContain('<Button variant="destructive">Register</Button>');
    expect(r.code).toContain('<Button variant="secondary">Sign Up to Volunteer</Button>');
  });
});

describe('ambiguity is refused, never defaulted', () => {
  /**
   * Mirrors the route's resolution rule (editPropHandler): with several
   * matches in the file and no occurrence, the answer is a 409 carrying the
   * count — `Number(undefined) || 0` silently editing element[0] is the
   * measured wrong-element edit this exists to prevent.
   */
  const resolveTarget = (
    code: string, component: string,
    req: { occurrence?: number; owner?: string },
  ): number | { refuse: string } => {
    const total = occurrencesInSource(code, component);
    if (total <= 1) return 0;
    if (req.owner) {
      const scoped = occurrencesWithinOwner(code, component, req.owner);
      if (!scoped.length) return { refuse: `no owner ${req.owner} to narrow by (${total} in file)` };
      if (req.occurrence === undefined) {
        return scoped.length === 1 ? scoped[0] : { refuse: `${scoped.length} inside ${req.owner}` };
      }
      return req.occurrence >= 0 && req.occurrence < scoped.length
        ? scoped[req.occurrence]
        : { refuse: `no position ${req.occurrence} inside ${req.owner}` };
    }
    if (req.occurrence !== undefined) return req.occurrence;
    return { refuse: `${total} in file, none specified` };
  };

  const file = `<A/><B/><A/>`;

  it('a single match needs no occurrence', () => {
    expect(resolveTarget(file, 'B', {})).toBe(0);
  });

  it('several matches with no occurrence and no owner is a refusal with the count', () => {
    expect(resolveTarget(file, 'A', {})).toEqual({ refuse: '2 in file, none specified' });
  });

  it('an owner that narrows to one match resolves without an occurrence', () => {
    const code = `const Banner = () => <A/>;\nconst Page = () => (<div><Banner/><A/></div>);`;
    expect(resolveTarget(code, 'A', { owner: 'Page' })).toBe(1);
    expect(resolveTarget(code, 'A', { owner: 'Banner' })).toBe(0);
  });

  it('an unknown owner refuses rather than falling back to whole-file counting', () => {
    const code = `const Banner = () => <A/>;\nconst Page = () => (<div><Banner/><A/></div>);`;
    expect(resolveTarget(code, 'A', { owner: 'render', occurrence: 0 }))
      .toEqual({ refuse: 'no owner render to narrow by (2 in file)' });
  });
});

/**
 * A one-attribute change must produce a one-attribute diff.
 *
 * The editor printed the whole file from the transformed AST, and
 * TypeScript's printer normalises formatting — so setting `size="xl"` on one
 * Button also collapsed a ten-line import block onto a single line. Measured
 * live. This writes to a file someone else reviews, and a change that
 * rewrites a hundred lines it did not need to touch is a change nobody can
 * review.
 */
describe('minimal diff', () => {
  const story = [
    "import React from 'react';",
    "import {",
    "  Button,",
    "  Card,",
    "  Text,",
    "} from '@mantine/core';",
    "",
    "// A comment that must survive.",
    "export const Default = () => (",
    "  <Card padding=\"lg\">",
    "    <Button variant=\"outline\">Save</Button>",
    "  </Card>",
    ");",
  ].join('\n');

  const linesChanged = (before: string, after: string) => {
    const a = before.split('\n');
    const b = after.split('\n');
    let n = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
    return n;
  };

  it('changes exactly one line when replacing a prop value', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'variant', value: 'filled' });
    expect(r.changed).toBe(true);
    expect(r.code).toContain('<Button variant="filled">Save</Button>');
    expect(linesChanged(story, r.code)).toBe(1);
  });

  it('changes exactly one line when adding a prop', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'size', value: 'xl' });
    expect(r.code).toContain('<Button variant="outline" size="xl">Save</Button>');
    expect(linesChanged(story, r.code)).toBe(1);
  });

  it('keeps the multi-line import block intact', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'size', value: 'xl' });
    // The exact regression: the printer collapsed this onto one line.
    expect(r.code).toContain("import {\n  Button,\n  Card,\n  Text,\n} from '@mantine/core';");
  });

  it('keeps comments', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'size', value: 'xl' });
    expect(r.code).toContain('// A comment that must survive.');
  });

  it('writes a boolean as the shorthand every design system uses', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'disabled', value: true });
    expect(r.code).toContain('<Button variant="outline" disabled>Save</Button>');
  });

  it('removes an attribute and the space in front of it', () => {
    const r = editProp(story, { component: 'Button', occurrence: 0, prop: 'variant', value: null });
    // Not `<Button  >` — the leading whitespace goes with the attribute.
    expect(r.code).toContain('<Button>Save</Button>');
    expect(linesChanged(story, r.code)).toBe(1);
  });

  it('adds to a self-closing element without breaking it', () => {
    const selfClosing = '<TextInput label="Email" />';
    const r = editProp(selfClosing, { component: 'TextInput', occurrence: 0, prop: 'required', value: true });
    expect(r.code).toBe('<TextInput label="Email" required />');
  });

  it('adds to an element that has no attributes yet', () => {
    const bare = '<Button>Go</Button>';
    const r = editProp(bare, { component: 'Button', occurrence: 0, prop: 'size', value: 'sm' });
    expect(r.code).toBe('<Button size="sm">Go</Button>');
  });
});

