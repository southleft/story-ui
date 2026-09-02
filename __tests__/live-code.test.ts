/**
 * The streamed code buffer.
 *
 * `llm_text` events with `phase: 'code'` carry the story file in deltas and
 * an empty `accumulated` (by contract — the client accumulates). The buffer
 * is closed by the next prose event and REPLACED by the file the server
 * actually wrote, which arrives on `preview_ready` and again on `completion`.
 * `applyLiveText` must leave code events alone: before the phase existed an
 * unknown phase fell through to `plan`.
 */

import { describe, it, expect } from 'vitest';
import { applyLiveCode, applyLiveText, type LiveCode, type LiveText } from '../templates/StoryUIV2/useGeneration.js';

const codeEvent = (delta: string, accumulated = '') =>
  ({ type: 'llm_text', data: { phase: 'code', delta, accumulated } });

describe('applyLiveCode', () => {
  it('starts from nothing and ignores events that do not touch the code', () => {
    expect(applyLiveCode(null, { type: 'progress', data: { phase: 'llm_thinking' } })).toBeNull();
    expect(applyLiveCode(null, { type: 'llm_text', data: { phase: 'plan', delta: 'I will' } })).toBeNull();
    expect(applyLiveCode(null, { type: 'started', data: {} })).toBeNull();
  });

  it('appends code deltas and reports the phase as live', () => {
    let code: LiveCode | null = null;
    code = applyLiveCode(code, codeEvent("import React from 'react';\n"));
    code = applyLiveCode(code, codeEvent("import { Table } from '@mantine/core';\n"));
    code = applyLiveCode(code, codeEvent('\nexport default'));
    expect(code).toEqual({
      text: "import React from 'react';\nimport { Table } from '@mantine/core';\n\nexport default",
      streaming: true,
    });
  });

  it('treats the contract’s empty accumulated as "client accumulates"', () => {
    let code = applyLiveCode(null, codeEvent('abc', ''));
    code = applyLiveCode(code, codeEvent('def', ''));
    expect(code?.text).toBe('abcdef');
  });

  it('adopts a longer server accumulated view and ignores a shorter stale one', () => {
    let code = applyLiveCode(null, codeEvent('abc', 'abc'));
    // A delta went missing; the server's view is ahead of ours.
    code = applyLiveCode(code, codeEvent('ghi', 'abcdefghi'));
    expect(code?.text).toBe('abcdefghi');
    code = applyLiveCode(code, codeEvent('j', 'abc'));
    expect(code?.text).toBe('abcdefghij');
  });

  it('closes the phase on the next prose event without losing the text', () => {
    let code = applyLiveCode(null, codeEvent('const a = 1;'));
    code = applyLiveCode(code, { type: 'llm_text', data: { phase: 'summary', delta: 'Built it.' } });
    expect(code).toEqual({ text: 'const a = 1;', streaming: false });
    // Same object back when nothing changes, so the hook can skip a render.
    expect(applyLiveCode(code, { type: 'llm_text', data: { phase: 'summary', delta: ' Done.' } })).toBe(code);
  });

  it('replaces the streamed text with the file the server wrote on preview_ready', () => {
    let code = applyLiveCode(null, codeEvent("import { Btn } from '@mantine/core';"));
    code = applyLiveCode(code, {
      type: 'preview_ready',
      data: { fileName: 'x.stories.tsx', code: "import { Button } from '@mantine/core';" },
    });
    expect(code).toEqual({ text: "import { Button } from '@mantine/core';", streaming: false });
  });

  it('takes the completion’s code as authoritative, and only ends streaming without one', () => {
    let code = applyLiveCode(null, codeEvent('draft'));
    expect(applyLiveCode(code, { type: 'completion', data: { code: 'final' } })).toEqual({ text: 'final', streaming: false });
    code = applyLiveCode(code, { type: 'completion', data: { success: false, code: '' } });
    expect(code).toEqual({ text: 'draft', streaming: false });
  });

  it('stays null when the file arrives for a run that streamed no code', () => {
    // Older servers send no code phase at all; preview_ready still lands.
    const code = applyLiveCode(null, { type: 'preview_ready', data: { code: 'the file' } });
    expect(code).toEqual({ text: 'the file', streaming: false });
    expect(applyLiveCode(null, { type: 'completion', data: {} })).toBeNull();
  });

  it('a new run starts from null, not from the previous run’s buffer', () => {
    // The hook resets the buffer to null at the start of `generate`; the
    // reducer has no memory of its own, so the first delta of a run is the
    // whole buffer.
    const fresh = applyLiveCode(null, codeEvent('new run'));
    expect(fresh?.text).toBe('new run');
  });
});

describe('applyLiveText and the code phase', () => {
  it('leaves the prose buffer untouched by code events', () => {
    const plan: LiveText = { phase: 'plan', text: 'I will build a table.' };
    expect(applyLiveText(plan, { phase: 'code', delta: 'import React' })).toBe(plan);
    expect(applyLiveText(null, { phase: 'code', delta: 'import React' })).toBeNull();
  });

  it('keeps plan, code and summary apart over a whole run', () => {
    const events = [
      { type: 'llm_text', data: { phase: 'thinking', delta: 'Table or cards?' } },
      { type: 'llm_text', data: { phase: 'plan', delta: 'I will build a table.', accumulated: 'I will build a table.' } },
      codeEvent("import React from 'react';\n"),
      codeEvent("export default { title: 'Generated/Team' };\n"),
      codeEvent('export const Default = () => <table />;\n'),
      { type: 'preview_ready', data: { fileName: 'team.stories.tsx', code: 'THE FILE ON DISK' } },
      { type: 'llm_text', data: { phase: 'summary', delta: 'A table with six rows.', accumulated: 'A table with six rows.' } },
      { type: 'completion', data: { code: 'THE FILE ON DISK' } },
    ];
    let live: LiveText | null = null;
    let code: LiveCode | null = null;
    const streamingSeen: boolean[] = [];
    for (const e of events) {
      code = applyLiveCode(code, e);
      streamingSeen.push(code?.streaming ?? false);
      if (e.type === 'llm_text' && e.data.phase !== 'code') live = applyLiveText(live, e.data);
    }
    expect(live).toEqual({ phase: 'summary', text: 'A table with six rows.' });
    expect(code).toEqual({ text: 'THE FILE ON DISK', streaming: false });
    // Live exactly during the three code deltas, and not before or after.
    expect(streamingSeen).toEqual([false, false, true, true, true, false, false, false]);
  });
});
