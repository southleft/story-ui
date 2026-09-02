/**
 * updatedAt means activity.
 *
 * Opening the classic panel seeds a synthetic conversation into every entry
 * that lacks one, and the manifest stamped updatedAt on every write — so
 * every older story jumped to "4m ago" in the workspace's Recent work. Only
 * a real change to the story or its conversation may move the timestamp.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { touchesUpdatedAt, sameConversation, ManifestManager } from '../story-generator/manifestManager.js';

const base = {
  id: 'card-abc123',
  title: 'Card',
  source: 'panel' as const,
  permanent: undefined,
  conversation: [{ role: 'user' as const, content: 'A card' }, { role: 'ai' as const, content: 'Done' }],
  metadata: { prompt: 'A card', provider: 'claude' },
};

describe('sameConversation', () => {
  it('compares role, content and thumbnails, message by message', () => {
    expect(sameConversation(base.conversation, [...base.conversation])).toBe(true);
    expect(sameConversation(base.conversation, base.conversation.slice(0, 1))).toBe(false);
    expect(sameConversation([{ role: 'user', content: 'a', thumbnails: ['x'] }], [{ role: 'user', content: 'a' }])).toBe(false);
    expect(sameConversation(undefined, [])).toBe(true);
  });
});

describe('touchesUpdatedAt', () => {
  it('leaves a no-op upsert alone', () => {
    expect(touchesUpdatedAt(base, { ...base, conversation: [...base.conversation] })).toBe(false);
  });

  it('leaves a backfilled conversation alone', () => {
    const empty = { ...base, conversation: [] };
    const seeded = { ...base, metadata: { ...base.metadata, backfilled: true } };
    expect(touchesUpdatedAt(empty, seeded, true)).toBe(false);
  });

  it('ignores the backfill marker itself when comparing metadata', () => {
    const marked = { ...base, metadata: { ...base.metadata, backfilled: true } };
    expect(touchesUpdatedAt(marked, base)).toBe(false);
    expect(touchesUpdatedAt(base, marked)).toBe(false);
  });

  it('bumps for a new message', () => {
    const next = { ...base, conversation: [...base.conversation, { role: 'user' as const, content: 'Make it red' }] };
    expect(touchesUpdatedAt(base, next)).toBe(true);
  });

  it('bumps for a title, source, id, permanence or metadata change', () => {
    expect(touchesUpdatedAt(base, { ...base, title: 'Pricing card' })).toBe(true);
    expect(touchesUpdatedAt(base, { ...base, source: 'workspace' as any })).toBe(true);
    expect(touchesUpdatedAt(base, { ...base, id: 'other' })).toBe(true);
    expect(touchesUpdatedAt(base, { ...base, permanent: true })).toBe(true);
    expect(touchesUpdatedAt(base, { ...base, metadata: { ...base.metadata, model: 'claude-opus-5' } })).toBe(true);
  });

  it('a backfill is bookkeeping in every field — adopting an mcp-external entry as panel does not count', () => {
    const reconciled = { ...base, source: 'mcp-external' as const, conversation: [] };
    const adopted = { ...base, source: 'panel' as const, metadata: { ...base.metadata, backfilled: true } };
    expect(touchesUpdatedAt(reconciled, adopted, true)).toBe(false);
    // The same write without the marker is a real change.
    expect(touchesUpdatedAt(reconciled, { ...adopted, metadata: base.metadata })).toBe(true);
  });
});

describe('ManifestManager.upsert / updateConversation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-manifest-'));
  const file = 'card-abc123.stories.tsx';

  it('stamps a new entry, keeps the stamp through seeds and no-ops, moves it for real activity', async () => {
    const m = new ManifestManager(dir);
    const created = m.upsert(file, { id: 'card-abc123', title: 'Card', source: 'mcp-external', metadata: { prompt: 'A card' } });
    expect(created.updatedAt).toBeTruthy();

    // Clock has to be able to move for the assertions to mean anything.
    await new Promise(r => setTimeout(r, 5));

    // What the classic panel actually sends on open: adopt the reconciled
    // entry as its own, with the conversation it reconstructed.
    const seeded = m.upsert(file, {
      id: 'card-abc123', title: 'Card', source: 'panel',
      conversation: [{ role: 'user', content: 'A card' }, { role: 'ai', content: 'Story generated: "Card"' }],
      metadata: { backfilled: true },
    });
    expect(seeded.source).toBe('panel');
    expect(seeded.conversation).toHaveLength(2);
    expect(seeded.updatedAt).toBe(created.updatedAt);

    await new Promise(r => setTimeout(r, 5));
    const again = m.upsert(file, { id: 'card-abc123', title: 'Card', source: 'panel' });
    expect(again.updatedAt).toBe(created.updatedAt);

    m.updateConversation(file, seeded.conversation);
    expect(m.get(file)!.updatedAt).toBe(created.updatedAt);

    await new Promise(r => setTimeout(r, 5));
    m.updateConversation(file, [...seeded.conversation, { role: 'user', content: 'Make it red' }]);
    expect(m.get(file)!.updatedAt).not.toBe(created.updatedAt);
  });
});
