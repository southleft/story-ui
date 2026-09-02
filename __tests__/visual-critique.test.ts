/**
 * The critique CONTRACT, which matters more than the critique.
 *
 * An unmeasured critic makes things worse. Vague aesthetic feedback fed back
 * into a generator produces drift: the model rewrites working code to satisfy
 * an opinion nobody can check, and each pass moves further from what was
 * asked for. That is the same shape as the targeted edit that replaced a whole
 * page — a change nobody requested, described as an improvement.
 *
 * So the parser enforces what the prompt merely requests. A rule that is only
 * asked for is a rule that eventually gets ignored.
 */

import { describe, it, expect } from 'vitest';
import { parseCritique } from '../story-generator/verify/probes/visualCritic.js';

const wrap = (findings: unknown) => JSON.stringify({ findings });

describe('parseCritique', () => {
  it('keeps a finding that names something and states a change', () => {
    const out = parseCritique(wrap([{
      issue: 'The Save and Publish buttons are identical weight, so the primary action is ambiguous',
      element: 'the action row',
      severity: 'blocker',
      fix: 'Make Publish primary and Save secondary',
    }]));
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('blocker');
  });

  it('drops opinion phrased as a suggestion', () => {
    // "Consider" is the tell. These rewrite working code to satisfy taste.
    const out = parseCritique(wrap([
      { issue: 'Consider adding more whitespace between the sections', severity: 'warning' },
      { issue: 'You might improve the visual hierarchy of the header', severity: 'warning' },
      { issue: 'The layout could be cleaner overall', severity: 'warning' },
    ]));
    expect(out).toEqual([]);
  });

  it('drops a vague fix even when the issue reads concrete', () => {
    const out = parseCritique(wrap([{
      issue: 'The metric tiles are inconsistent in height across the top row',
      severity: 'warning',
      fix: 'Consider polishing the spacing',
    }]));
    expect(out).toEqual([]);
  });

  it('accepts an empty list as a normal answer', () => {
    // Most well-formed output should produce this. A critic that always finds
    // something is noise, and noise costs a regeneration.
    expect(parseCritique(wrap([]))).toEqual([]);
  });

  it('survives prose and code fences around the JSON', () => {
    const raw = 'Here is my review:\n```json\n' + wrap([{
      issue: 'The filters panel is empty — the request asked for role and status filters',
      severity: 'blocker',
      fix: 'Render the role dropdown and status checkboxes inside the panel',
    }]) + '\n```\nHope that helps.';
    expect(parseCritique(raw)).toHaveLength(1);
  });

  it('returns nothing rather than throwing on unusable output', () => {
    // A confused critic must never block a generation that otherwise verified.
    expect(parseCritique('')).toEqual([]);
    expect(parseCritique('I could not see the image.')).toEqual([]);
    expect(parseCritique('{not json at all')).toEqual([]);
  });

  it('rejects a one-word finding', () => {
    expect(parseCritique(wrap([{ issue: 'Bad', severity: 'blocker' }]))).toEqual([]);
  });

  it('treats an unknown severity as a warning, never a blocker', () => {
    // Only a blocker earns a repair attempt, so the default must be the safe one.
    const out = parseCritique(wrap([{
      issue: 'The header text overflows its container and is clipped on the right',
      severity: 'catastrophic',
    }]));
    expect(out[0].severity).toBe('warning');
  });

  it('caps how many findings can reach the repair loop', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      issue: `The section ${i} heading overlaps the content beneath it and is unreadable`,
      severity: 'blocker',
    }));
    expect(parseCritique(wrap(many)).length).toBeLessThanOrEqual(6);
  });
});
