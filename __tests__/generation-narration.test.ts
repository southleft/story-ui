/**
 * Narration of the late pipeline phases.
 *
 * The incident this guards: a generated story compiled but CRASHED at runtime
 * ("Error: Invalid currency code : $"), the runtime-healing pass regenerated
 * it, verification re-checked it — and the user watched a red error story with
 * no narration, because everything after "Saving" was silent. The pipeline now
 * emits progress events for the post-write phases, and the client renders them
 * as live steps.
 *
 * Two sides must agree without a shared constant: generationCore emits phase
 * strings, useGeneration maps them to labels (or deliberately falls through to
 * the server's message when it carries facts a static label cannot — the issue
 * count, the reason the original was kept). These tests read both sides and
 * fail when they drift, which is cheaper than discovering the drift as a raw
 * `verify_repair_failed` token in the step list.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PHASE_LABEL } from '../templates/StoryUIV2/useGeneration.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSource = fs.readFileSync(
  path.join(here, '..', 'mcp-server', 'routes', 'generationCore.ts'),
  'utf8',
);
const streamTypesSource = fs.readFileSync(
  path.join(here, '..', 'mcp-server', 'routes', 'streamTypes.ts'),
  'utf8',
);

/** Phases whose text is fixed — the client owns the label. */
const FIXED_PHASES = [
  'config_loaded',
  'components_discovered',
  'prompt_built',
  'llm_thinking',
  'code_extracted',
  'validating',
  'post_processing',
  'saving',
  'runtime_check',
  'runtime_healing',
  'runtime_healed',
  'runtime_heal_failed',
  'verifying',
  'verify_repaired',
  'verified',
  'verify_inconclusive',
];

/**
 * Phases whose server message carries facts a static label cannot — the issue
 * count ("Verification found 2 issues — repairing") and why the original was
 * kept. The client must NOT map these: a map entry would shadow the fact.
 */
const DYNAMIC_PHASES = ['verify_repairing', 'verify_repair_failed', 'verify_issues'];

describe('phase → label map', () => {
  it('labels every fixed-text phase the server emits', () => {
    for (const phase of FIXED_PHASES) {
      expect(PHASE_LABEL[phase], `PHASE_LABEL is missing '${phase}'`).toBeTruthy();
    }
  });

  it('leaves the fact-carrying phases unmapped so the server message shows', () => {
    for (const phase of DYNAMIC_PHASES) {
      expect(PHASE_LABEL[phase], `'${phase}' must render the server's message, not a static label`)
        .toBeUndefined();
    }
  });

  it('speaks in one voice — no trailing ellipses in labels', () => {
    for (const [phase, label] of Object.entries(PHASE_LABEL)) {
      expect(label.endsWith('...') || label.endsWith('…'), `'${phase}' label ends with an ellipsis`)
        .toBe(false);
    }
  });

  it('never claims success for anything but the final clean verdict', () => {
    // "Verified" language is reserved for the one phase emitted after repair
    // has fully resolved — a pending repair must never read as a pass.
    for (const [phase, label] of Object.entries(PHASE_LABEL)) {
      if (phase === 'verified') continue;
      expect(/^verified/i.test(label), `'${phase}' label claims verification`).toBe(false);
    }
  });
});

describe('server emits every post-write phase', () => {
  // Source-text check, deliberately: these phases are emitted deep inside
  // conditional branches (crash detected, repair attempted, budget exhausted)
  // that a unit test cannot cheaply reach. Renaming a phase on one side is the
  // realistic regression, and this catches it in milliseconds.
  const POST_WRITE_PHASES = [
    'runtime_check',
    'runtime_healing',
    'runtime_healed',
    'runtime_heal_failed',
    'verifying',
    'verify_repairing',
    'verify_repaired',
    'verify_repair_failed',
    'verified',
    'verify_issues',
    'verify_inconclusive',
  ];

  it.each(POST_WRITE_PHASES)('emits %s through onProgress', phase => {
    const emitted = new RegExp(`onProgress\\?\\.\\([^)]*'${phase}'`).test(coreSource);
    expect(emitted, `generationCore never emits '${phase}'`).toBe(true);
  });

  it.each(POST_WRITE_PHASES)('declares %s in the stream types', phase => {
    expect(streamTypesSource.includes(`'${phase}'`), `streamTypes is missing '${phase}'`).toBe(true);
  });
});
