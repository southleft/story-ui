/**
 * Voice Canvas fast path — a spoken request decided by Jev, applied as an edit.
 *
 * POST /mcp/canvas-voice
 * Body:    { transcript, canvasCode?, pointer? }
 * Returns: VoiceOutcome — `applied` (new canvasCode), `command`, `ignored`,
 *          or `fallback`, which tells the client to send the same request to
 *          /mcp/canvas-generate (the LLM path) instead.
 *
 * `fallback` is the normal answer whenever Jev is not configured, not
 * confident, or the request is compositional. The canvas works exactly as it
 * did before this route existed in every one of those cases; this only makes
 * the parametric ones fast.
 */

import type { Request, Response } from 'express';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { logger } from '../../story-generator/logger.js';
import { decideVoiceEdit, type EditablePropInfo, type VoiceOutcome } from '../../story-generator/voice/decide.js';
import { EMPTY_CANVAS_CODE } from '../../story-generator/voice/canvasTree.js';
import { jevConfigured, JevError } from '../../story-generator/voice/jevClient.js';
import { readStorybookGlobals } from '../../story-generator/voice/storybookGlobals.js';
import { ensureReactLive, ensureVoiceCanvasStory, getCanvasComponents, ReactLiveMissingError, voiceCanvasStorySource } from './canvasGenerate.js';
import { classifyProp, panelWorthy, resolveComponentKnowledge } from './editProp.js';

const PROPS_TTL = 300_000;

/**
 * Standard form attributes and the kind of value each takes — React's own DOM
 * types, not any design system's. Offered only where the compiler confirms
 * the component accepts the attribute (`facts.acceptedNames`): Mantine's
 * Checkbox passes `defaultChecked` to its input; that is a fact about
 * Mantine, and this table only says what kind of value it is.
 */
const DOM_ATTRIBUTES: Record<string, 'boolean' | 'string'> = {
  checked: 'boolean', defaultChecked: 'boolean', disabled: 'boolean', required: 'boolean',
  readOnly: 'boolean', multiple: 'boolean', autoFocus: 'boolean',
  placeholder: 'string', defaultValue: 'string', alt: 'string', src: 'string',
};
const propsCache = new Map<string, { at: number; props: EditablePropInfo[] }>();

/**
 * What a voice edit may change on `component`. Exported so the bench measures
 * THIS function rather than a copy of it — a bench with its own lookup once
 * reported no change for a fix it was never running.
 */
export async function voicePropsFor(config: ReturnType<typeof loadUserConfig>, component: string): Promise<EditablePropInfo[]> {
  const hit = propsCache.get(component);
  if (hit && Date.now() - hit.at < PROPS_TTL) return hit.props;
  const { props, facts } = await resolveComponentKnowledge(config, component);
  const editable: EditablePropInfo[] = props.map(classifyProp).filter(panelWorthy);
  // A ReactNode prop (Mantine's `label`, `description`) holds words a person
  // dictates; a panel cannot offer a control for it, but a voice edit can.
  // `children` is reported too, as the fact that the component takes text.
  for (const p of props) {
    if (p.deprecated || editable.some(e => e.name === p.name)) continue;
    if (/^(React\.)?ReactNode$/.test((p.type || '').trim())) editable.push({ name: p.name, kind: 'string', doc: p.doc });
  }
  for (const name of facts?.acceptedNames ?? []) {
    const kind = DOM_ATTRIBUTES[name];
    if (kind && !editable.some(e => e.name === name)) editable.push({ name, kind });
  }
  propsCache.set(component, { at: Date.now(), props: editable });
  return editable;
}

const emptyStats = { ms: 0, calls: 0, questions: 0, inputTokens: 0, usd: 0 };

/**
 * Jev refused the account (no credits, bad key): stop asking for a while.
 *
 * Every request paid a failed round trip before falling back, and the only
 * trace was one line in the Decisions panel — a live demo ran entirely on the
 * model with no visible reason. While paused, requests go straight to the
 * model and say why; after the pause Jev is tried again, so topping up
 * credits recovers without a restart.
 */
const PAUSE_MS = 5 * 60_000;
let jevPausedUntil = 0;
let jevPauseReason = '';

export function jevPause(): { paused: boolean; reason: string } {
  return Date.now() < jevPausedUntil ? { paused: true, reason: jevPauseReason } : { paused: false, reason: '' };
}

function describeRefusal(error: JevError): string {
  if (error.status === 402) return 'TypeSafe credits ran out — add credits at console.typesafe.ai/settings/billing';
  if (error.status === 401 || error.status === 403) return 'TypeSafe rejected the API key';
  return error.message;
}

export async function canvasVoiceHandler(req: Request, res: Response) {
  const { transcript, canvasCode, pointer, recent, final } = req.body ?? {};
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript is required' });
  }
  if (!jevConfigured()) {
    const out: VoiceOutcome = { kind: 'fallback', reason: 'TYPESAFE_API_KEY is not set', steps: [], stats: emptyStats };
    return res.json(out);
  }

  const pause = jevPause();
  if (pause.paused) {
    const out = { kind: 'fallback', reason: pause.reason, jevUnavailable: pause.reason, steps: [], stats: emptyStats };
    return res.json(out);
  }

  try {
    const config = loadUserConfig();
    if (config.componentFramework && config.componentFramework !== 'react') {
      return res.status(400).json({ error: 'Voice Canvas is only available for React-based Storybook projects.' });
    }
    try {
      await ensureReactLive();
    } catch (err) {
      if (err instanceof ReactLiveMissingError) {
        return res.status(424).json({ success: false, error: err.message, code: 'REACT_LIVE_MISSING' });
      }
      throw err;
    }
    const components = await getCanvasComponents(config);
    ensureVoiceCanvasStory(config.generatedStoriesPath || './src/stories/generated/', voiceCanvasStorySource(config, components));

    const code = typeof canvasCode === 'string' && canvasCode.trim() ? canvasCode.slice(0, 50_000) : EMPTY_CANVAS_CODE;
    const started = Date.now();
    const outcome = await decideVoiceEdit(
      {
        transcript: transcript.slice(0, 1000),
        code,
        pointer: typeof pointer === 'string' ? pointer : null,
        recent: typeof recent === 'string' ? recent.slice(0, 300) : null,
        final: final === true,
      },
      { catalog: components as never, propsFor: name => voicePropsFor(config, name), globals: readStorybookGlobals(process.cwd()) },
    );
    const s = outcome.stats;
    logger.log(
      `🎙️ [canvas-voice] "${transcript.slice(0, 60)}" → ${outcome.kind}` +
      `${outcome.kind === 'applied' || outcome.kind === 'setting' ? `: ${outcome.summary}` : outcome.kind === 'command' ? `: ${outcome.command}` : `: ${outcome.reason}`}` +
      ` · ${s.calls} Jev call(s), ${s.questions} questions, ${s.ms}ms Jev / ${Date.now() - started}ms total, $${s.usd.toFixed(6)}`,
    );
    return res.json(outcome.kind === 'applied' ? { ...outcome, canvasCode: outcome.code } : outcome);
  } catch (error) {
    // A Jev failure is never fatal to the canvas: the client falls back.
    if (error instanceof JevError && (error.status === 401 || error.status === 402 || error.status === 403)) {
      jevPausedUntil = Date.now() + PAUSE_MS;
      jevPauseReason = describeRefusal(error);
      logger.warn(`[canvas-voice] Jev refused the account (${error.status}); pausing Jev for ${PAUSE_MS / 60_000} min: ${jevPauseReason}`);
      return res.json({ kind: 'fallback', reason: jevPauseReason, jevUnavailable: jevPauseReason, steps: [], stats: emptyStats });
    }
    const reason = error instanceof JevError ? error.message : `Voice decision failed: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn(`[canvas-voice] ${reason}`);
    const out: VoiceOutcome = { kind: 'fallback', reason, steps: [], stats: emptyStats };
    return res.json(out);
  }
}
