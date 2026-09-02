/**
 * Internal notation never reaches the thread as-is.
 *
 * A prop pin, a version's description and an escaped title all carried the
 * server's machine spelling into the UI. Each rewrite is a pure function.
 */

import { describe, it, expect } from 'vitest';
import { humanizePropPath, describePinForPeople, unescapeTitle } from '../templates/StoryUIV2/copy.js';
import { summarizeVerification, verificationFromCompletion } from '../templates/StoryUIV2/useSessions.js';

describe('humanizePropPath', () => {
  it('renders a pin as name · prop = value', () => {
    expect(describePinForPeople('Button[0].variant = "light"')).toBe('Button · variant = light');
  });

  it('names a later occurrence the way the composer chip does', () => {
    expect(describePinForPeople('Button[2].size = "lg"')).toBe('Button #3 · size = lg');
  });

  it('rewrites the path inside a version description', () => {
    expect(humanizePropPath('Set Button[0].variant = "light"')).toBe('Set Button · variant = light');
    expect(humanizePropPath('Reset Button[0].variant to its default')).toBe('Reset Button · variant to its default');
  });

  it('keeps non-string values and dotted component names', () => {
    expect(humanizePropPath('Set Menu.Item[0].disabled = true')).toBe('Set Menu.Item · disabled = true');
    expect(humanizePropPath('Set Grid[1].span = 6')).toBe('Set Grid #2 · span = 6');
  });

  it('leaves prose without a path alone', () => {
    expect(humanizePropPath('Make the header bigger')).toBe('Make the header bigger');
    expect(humanizePropPath('')).toBe('');
  });
});

describe('unescapeTitle', () => {
  it('drops backslash escapes a manifest or a model left in', () => {
    expect(unescapeTitle('Alert \\"Warning\\" banner')).toBe('Alert "Warning" banner');
    expect(unescapeTitle("User\\'s profile")).toBe("User's profile");
  });

  it('collapses whitespace and tolerates nothing', () => {
    expect(unescapeTitle('  Two   words \n')).toBe('Two words');
    expect(unescapeTitle(undefined)).toBe('');
    expect(unescapeTitle(null)).toBe('');
  });
});

describe('warnings on the badge', () => {
  it('counts warnings from a live report', () => {
    const s = summarizeVerification({
      outcome: 'verified',
      findings: [
        { id: 'a', severity: 'warning', class: 'a11y', message: 'x' },
        { id: 'b', severity: 'warning', class: 'a11y', message: 'y' },
        { id: 'c', severity: 'info', class: 'a11y', message: 'z' },
      ],
    });
    expect(s?.warnings).toBe(2);
    expect(s?.blockers).toBe(0);
  });

  it('reads the persisted count back, and leaves it absent when the entry predates it', () => {
    expect(verificationFromCompletion({ verification: { outcome: 'verified', blockers: 0, warnings: 3 } })?.warnings).toBe(3);
    expect(verificationFromCompletion({ verification: { outcome: 'verified', blockers: 0 } })?.warnings).toBeUndefined();
  });
});
