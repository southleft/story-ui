/**
 * The model's streamed narration, and the turn it becomes.
 *
 * Two pure functions: `applyLiveText` appends `llm_text` deltas into a
 * per-phase buffer, and `composeAssistantText` puts the plan at the top of
 * the finished turn without repeating a sentence the summary restates.
 */

import { describe, it, expect } from 'vitest';
import { applyLiveText, composeAssistantText, type LiveText } from '../templates/StoryUIV2/useGeneration.js';

describe('applyLiveText', () => {
  it('appends deltas character by character within a phase', () => {
    let live: LiveText | null = null;
    for (const ch of 'I will build a pricing table.') {
      live = applyLiveText(live, { delta: ch, phase: 'plan' });
    }
    expect(live).toEqual({ phase: 'plan', text: 'I will build a pricing table.' });
  });

  it('starts a fresh buffer when the phase changes', () => {
    let live = applyLiveText(null, { delta: 'Plan text.', phase: 'plan' });
    live = applyLiveText(live, { delta: 'Done: ', phase: 'summary' });
    live = applyLiveText(live, { delta: 'three tiers.', phase: 'summary' });
    expect(live).toEqual({ phase: 'summary', text: 'Done: three tiers.' });
  });

  it('adopts the server accumulated text when the local buffer fell behind it', () => {
    let live = applyLiveText(null, { delta: 'I will', accumulated: 'I will', phase: 'plan' });
    // A delta went missing; the next event's accumulated view is ahead.
    live = applyLiveText(live, { delta: ' table.', accumulated: 'I will build a table.', phase: 'plan' });
    expect(live?.text).toBe('I will build a table.');
  });

  it('never replaces a longer local buffer with a shorter, stale accumulated one', () => {
    const live = applyLiveText({ phase: 'plan', text: 'Hello world' }, { delta: '!', accumulated: 'Hello', phase: 'plan' });
    expect(live?.text).toBe('Hello world!');
  });

  it('appends purely from deltas when the server sends no accumulated view', () => {
    let live = applyLiveText(null, { delta: 'a', phase: 'plan' });
    live = applyLiveText(live, { delta: 'b', phase: 'plan' });
    expect(live?.text).toBe('ab');
  });

  it('shows thinking first, then REPLACES it with the first plan delta', () => {
    let live = applyLiveText(null, { delta: 'Considering a three-column grid', phase: 'thinking' });
    live = applyLiveText(live, { delta: ' versus a table.', phase: 'thinking' });
    expect(live).toEqual({ phase: 'thinking', text: 'Considering a three-column grid versus a table.' });
    live = applyLiveText(live, { delta: 'I will', accumulated: 'I will', phase: 'plan' });
    expect(live).toEqual({ phase: 'plan', text: 'I will' });
    expect(live?.text).not.toContain('Considering');
  });

  it('replaces thinking text with the server tail on every event, even a shorter one', () => {
    let live = applyLiveText(null, { delta: 'Considering a grid.', accumulated: 'Considering a grid.', phase: 'thinking' });
    // The cap has slid: the tail no longer starts where the buffer did and is shorter.
    live = applyLiveText(live, { delta: ' Table it is.', accumulated: 'grid. Table it is.', phase: 'thinking' });
    expect(live).toEqual({ phase: 'thinking', text: 'grid. Table it is.' });
  });

  it('falls back to appending thinking deltas when no tail is sent', () => {
    let live = applyLiveText(null, { delta: 'a', phase: 'thinking' });
    live = applyLiveText(live, { delta: 'b', phase: 'thinking' });
    expect(live?.text).toBe('ab');
  });

  it('treats an unknown phase as plan and an empty first event as nothing', () => {
    expect(applyLiveText(null, { phase: 'nonsense' })).toBeNull();
    expect(applyLiveText(null, { delta: 'x', phase: 'nonsense' })).toEqual({ phase: 'plan', text: 'x' });
  });
});

describe('composeAssistantText', () => {
  const plan = 'I will build a pricing table with three tiers using Card and Button.';

  it('starts the turn with the plan, then the summary when it says something new', () => {
    const out = composeAssistantText(plan, 'The Pro tier is highlighted with a jade border.', 'Created X.');
    expect(out.startsWith(plan)).toBe(true);
    expect(out).toBe(`${plan}\n\nThe Pro tier is highlighted with a jade border.`);
  });

  it('does not show the same sentence twice when the summary restates the plan', () => {
    const summary = `${plan} The Pro tier is highlighted.`;
    const out = composeAssistantText(plan, summary, 'Created X.');
    expect(out).toBe(summary);
    expect(out.split(plan).length - 1).toBe(1);
  });

  it('dedupes by prefix regardless of whitespace differences', () => {
    const summary = `I  will build a pricing table\nwith three tiers using Card and Button. Done.`;
    const out = composeAssistantText(plan, summary, 'Created X.');
    expect(out).toBe(summary);
  });

  it('keeps the plan alone when the summary is only its opening', () => {
    expect(composeAssistantText(plan, 'I will build a pricing table', 'Created X.')).toBe(plan);
  });

  it('never carries thinking text into the finished turn', () => {
    // The hook hands only the plan buffer to composeAssistantText; a run
    // that produced thinking and no plan therefore composes from nothing.
    let live = applyLiveText(null, { delta: 'Weighing Card against Table.', phase: 'thinking' });
    const planText = live?.phase === 'plan' ? live.text : '';
    expect(composeAssistantText(planText || undefined, 'Built a pricing table.', 'Created X.'))
      .toBe('Built a pricing table.');
    live = applyLiveText(live, { delta: plan, phase: 'plan' });
    const planAfter = live?.phase === 'plan' ? live.text : '';
    expect(composeAssistantText(planAfter, 'Built a pricing table.', 'Created X.'))
      .toBe(`${plan}\n\nBuilt a pricing table.`);
  });

  it('falls back through summary to the caller text when nothing streamed', () => {
    expect(composeAssistantText(undefined, 'Built it.', 'Created X.')).toBe('Built it.');
    expect(composeAssistantText('  ', undefined, 'Created X.')).toBe('Created X.');
    expect(composeAssistantText(plan, undefined, 'Created X.')).toBe(plan);
  });
});

describe('proseBeforeFence', () => {
  it('keeps what the model said before its code, and nothing of the code', async () => {
    const { proseBeforeFence } = await import('../mcp-server/routes/generationCore');
    expect(proseBeforeFence('Below is a settings card built from Card, Badge and Button.\n\n```tsx\nexport const A = 1;\n```\nDone.'))
      .toBe('Below is a settings card built from Card, Badge and Button.');
    expect(proseBeforeFence('```tsx\nexport const A = 1;\n```')).toBe('');
    expect(proseBeforeFence('')).toBe('');
  }, 30_000);
});
