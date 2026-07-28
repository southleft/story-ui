/**
 * Who is a defect actually charged to?
 *
 * A design system's own Datagrid renders a sortable `<th>` with
 * `cursor: pointer`, an onClick, and no tabIndex. That is three genuine
 * keyboard blockers, and the composition can fix none of them — the only
 * repair available to a model told to fix them is to STOP USING the component,
 * which turns a story built from the design system into one that avoids it.
 *
 * The old attribution matched class-name shapes (`mantine-Slider-thumb`,
 * `MuiSlider-thumb`), so by construction it could not see a library that
 * styles inline or with Tailwind — exactly the private design systems this
 * tool exists to serve. React's fiber names the component that rendered the
 * node, and that is a fact rather than a pattern.
 */

import { describe, it, expect } from 'vitest';
import { censusFindings } from '../story-generator/verify/verifyStory.js';
import { blockers, repairable } from '../story-generator/verify/findings.js';

type Problem = Parameters<typeof censusFindings>[0][number];

const clickable = (over: Partial<Problem> = {}): Problem => ({
  kind: 'clickable_non_button',
  message: 'Element looks clickable but cannot be reached or activated by keyboard',
  evidence: 'has cursor:pointer but is not focusable',
  selector: 'table > thead > tr > th',
  ...over,
} as Problem);

describe('censusFindings attribution', () => {
  it('demotes a defect rendered by a design system component', () => {
    const findings = censusFindings([clickable({ owner: 'Datagrid', ownedByLibrary: true })]);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].repairable).toBe(false);
    expect(blockers(findings)).toHaveLength(0);
    expect(repairable(findings)).toHaveLength(0);
  });

  it('still reports it, and names the component so the address is unambiguous', () => {
    // A design system team should see this. It is their bug, not nothing.
    const findings = censusFindings([clickable({ owner: 'Datagrid', ownedByLibrary: true })]);
    expect(findings[0].message).toContain('Datagrid');
    expect(findings[0].evidence).toContain('not fixable from the composition');
  });

  it('keeps a defect the story itself authored as a repairable blocker', () => {
    const findings = censusFindings([clickable({ owner: 'ServiceHealthDashboard', ownedByLibrary: false })]);
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].repairable).toBe(true);
  });

  it('blocks when ownership could not be determined', () => {
    // Fail safe. An unattributed finding must behave exactly as it did before
    // attribution existed — silently suppressing what we cannot explain would
    // be far worse than a false blocker.
    const findings = censusFindings([clickable()]);
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].repairable).toBe(true);
  });

  it('demotes the consequence when every affordance behind it is the library\'s', () => {
    // `no_focusables` fires BECAUSE of the clickable elements above it. If they
    // belong to the library, so does it — the story cannot make a library's
    // markup focusable.
    const findings = censusFindings([
      clickable({ owner: 'Datagrid', ownedByLibrary: true }),
      {
        kind: 'no_focusables',
        message: 'The story presents interactive affordances but nothing can be focused or operated',
        evidence: '412 elements rendered, 0 focusable',
        owner: 'Datagrid',
        ownedByLibrary: true,
      } as Problem,
    ]);
    expect(blockers(findings)).toHaveLength(0);
  });

  it('does not demote a mixed set — the story\'s own defect still blocks', () => {
    const findings = censusFindings([
      clickable({ owner: 'Datagrid', ownedByLibrary: true }),
      clickable({ owner: 'MyStory', ownedByLibrary: false, selector: 'div.hand-rolled' }),
    ]);
    const b = blockers(findings);
    expect(b).toHaveLength(1);
    expect(b[0].selector).toBe('div.hand-rolled');
  });

  it('leaves non-attributed kinds behaving as before', () => {
    const findings = censusFindings([{
      kind: 'static_only',
      message: 'Nothing in this story is focusable',
      evidence: '20 elements rendered, 0 focusable',
    } as Problem]);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].repairable).toBe(false);
  });
});
