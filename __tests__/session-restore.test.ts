/**
 * Restoring a conversation from the manifest.
 *
 * The manifest is shared with the V1 panel, so its stored reply format is V1's:
 * `[SUCCESS] **Created: "Title"**` followed by the model's prose. V2 renders
 * prose directly, which made a restored conversation the one place that marker
 * appeared — the same reply read one way when generated and another way when
 * reopened.
 *
 * Presentation-only by necessity: rewriting the stored format would break V1.
 */

import { describe, it, expect } from 'vitest';
import { cleanReply } from '../templates/StoryUIV2/useSessions.js';
import { resolveIndexedStoryId } from '../templates/StoryUIV2/useGeneration.js';

describe('cleanReply', () => {
  it('drops the created header, keeping the prose', () => {
    const stored = '[SUCCESS] **Created: "Dashboard Overview"**\n\nI put together a dashboard with stat tiles.';
    expect(cleanReply(stored)).toBe('I put together a dashboard with stat tiles.');
  });

  it('drops the updated header too', () => {
    const stored = '[SUCCESS] **Updated: "Dashboard Overview"**\n\nDone! The button is full width now.';
    expect(cleanReply(stored)).toBe('Done! The button is full width now.');
  });

  it('keeps failure text, dropping only the token', () => {
    // Losing the message would leave the user with a blank turn and no idea
    // what went wrong.
    expect(cleanReply('[ERROR] The model returned no code')).toBe('The model returned no code');
  });

  it('leaves a plain reply untouched', () => {
    expect(cleanReply('I added a mute switch at the top.')).toBe('I added a mute switch at the top.');
  });

  it('does not strip a bracketed phrase from the middle of a reply', () => {
    const stored = 'I used Badge for the [SUCCESS] state indicator.';
    expect(cleanReply(stored)).toBe(stored);
  });
});

describe('resolveIndexedStoryId', () => {
  const entries = {
    'dashboard-overview-ab80cbab--docs': { type: 'docs', title: 'Generated/Dashboard Overview' },
    'dashboard-overview-ab80cbab--default': { type: 'story', title: 'Generated/Dashboard Overview' },
    'generated-notification-settings-panel--default': { type: 'story', title: 'Generated/Notification Settings Panel' },
  };

  it('prefers the story entry over the docs entry', () => {
    expect(resolveIndexedStoryId(entries, 'dashboard-overview-ab80cbab'))
      .toBe('dashboard-overview-ab80cbab--default');
  });

  it('falls back to the title-derived id when the filename slug was ignored', () => {
    // Storybook derives ids from the title when the meta declares none.
    expect(resolveIndexedStoryId(entries, 'notification-settings-panel-addff419', 'Notification Settings Panel'))
      .toBe('generated-notification-settings-panel--default');
  });

  it('returns null rather than guessing when nothing matches', () => {
    // A wrong guess here would open somebody else's story in the canvas.
    expect(resolveIndexedStoryId(entries, 'nothing-like-this', 'Nothing Like This')).toBeNull();
  });
});
