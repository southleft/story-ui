/**
 * Generation hook — the streaming protocol, with no opinion about the UI.
 *
 * Pulled out of the panel deliberately: the old component mixed SSE parsing,
 * story-index recovery and rendering in one 3,000-line file, which made both
 * halves untestable. Everything here is transport; everything visual lives in
 * components.
 *
 * Known failure mode this must survive: writing the story file makes Vite reload
 * the Storybook preview iframe, and because the panel lives INSIDE that iframe,
 * the reload kills the in-flight SSE connection mid-generation.
 *
 * The two halves of surviving it: `generate` stashes the in-flight request
 * under PENDING_KEY before opening the stream, and `readPendingGeneration`
 * hands the stash to whichever workspace remounts. The server persists the
 * completed reply to the manifest whether or not the socket survived, so the
 * remounted workspace polls the manifest for an entry newer than the stash's
 * startedAt and rebuilds the finished turn from its conversation and
 * `metadata.lastCompletion` (see pollForCompletedEntry in useSessions).
 */

import { apiFetch } from './api';
import { useCallback, useRef, useState } from 'react';

/**
 * A step that failed is not a step that finished.
 *
 * `finishSteps()` used to mark every step `done` unconditionally, and it was
 * called on the SSE error path too — so a run that died during verification
 * rendered a full column of ticks beside a red banner. That is the same
 * "absent looks like success" shape the pipeline was just fixed for, in the
 * one place the user actually looks.
 */
export type StepState = 'active' | 'done' | 'failed' | 'warn';

/**
 * Phases whose arrival IS the verdict, and the verdict is negative.
 *
 * These used to be pushed as `active` and then closed as `done` by whatever
 * came next — so "The crash could not be fixed automatically" wore a grey
 * finished-dot and read as a step that had been completed successfully.
 * `warn` is for "could not check" (amber), `failed` for "checked and it is
 * wrong" (red). Neither is ever flipped back to done by a later phase: only
 * `active` steps are closed out.
 */
export const FAILED_PHASES: ReadonlySet<string> = new Set([
  'runtime_heal_failed',
  'verify_repair_failed',
  'verify_issues',
]);
export const WARN_PHASES: ReadonlySet<string> = new Set(['verify_inconclusive']);

export function stepStateForPhase(phase: string | undefined): StepState {
  if (!phase) return 'active';
  if (FAILED_PHASES.has(phase)) return 'failed';
  if (WARN_PHASES.has(phase)) return 'warn';
  return 'active';
}

/**
 * Render a progress event's `details` as a step detail, when it carries one
 * the user can read. Currently only the streaming character count.
 */
export function detailFromProgress(details: unknown): string | undefined {
  const chars = (details as { charsWritten?: unknown } | undefined)?.charsWritten;
  if (typeof chars !== 'number' || !Number.isFinite(chars)) return undefined;
  return `${Math.max(0, Math.floor(chars)).toLocaleString()} characters written`;
}

/**
 * The step-list reducer, pure so it can be tested without React.
 *
 *  - Whatever was `active` is closed as `done`; only one step is ever active.
 *  - A terminal state (`failed` / `warn`) is never revisited by a later push.
 *  - Re-emitting the CURRENTLY ACTIVE step (the server re-sends `llm_thinking`
 *    about once a second while the model streams) updates only its detail:
 *    the clock and label stay, or the elapsed counter would reset to 0s every
 *    second for the whole writing phase.
 *  - Re-activating a step that had finished (`validating` on every healing
 *    attempt) resets the clock, so the counter measures THIS attempt.
 */
export function applyStep(
  prev: GenStep[],
  step: { id: string; label: string; detail?: string; state?: StepState },
  now: number = Date.now(),
): GenStep[] {
  const state: StepState = step.state ?? 'active';
  const existingIdx = prev.findIndex(s => s.id === step.id);
  const existing = existingIdx >= 0 ? prev[existingIdx] : null;

  if (existing && existing.state === 'active' && state === 'active') {
    const next = [...prev];
    next[existingIdx] = { ...existing, detail: step.detail ?? existing.detail };
    return next;
  }

  const closed = prev.map(s => (s.state === 'active' ? { ...s, state: 'done' as const } : s));
  if (existingIdx >= 0) {
    const next = [...closed];
    next[existingIdx] = { ...next[existingIdx], label: step.label, detail: step.detail, state, startedAt: now };
    return next;
  }
  return [...closed, { id: step.id, label: step.label, detail: step.detail, state, startedAt: now }];
}

export interface GenStep {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  /** When this step became active, so the UI can show elapsed time. */
  startedAt: number;
}

/**
 * The model's own words, streamed while it works.
 *
 * `thinking` comes first: a running summary of the model's reasoning, for
 * models that reason for 30-60s before their first visible token — without
 * it the bubble sat empty for exactly that long. `plan` arrives BEFORE the
 * code: two to four sentences about what it is going to build and which
 * components it will use. `summary` may arrive after the write. The step
 * list narrates the pipeline; this narrates the model — it is the difference
 * between watching a progress bar and watching someone think.
 *
 * Thinking is shown and then REPLACED by the plan; it never reaches the
 * finished turn. It is scaffolding, not the answer.
 */
export type LiveTextPhase = 'thinking' | 'plan' | 'summary';

export interface LiveText {
  phase: LiveTextPhase;
  text: string;
}

/**
 * The story file as the model writes it.
 *
 * `llm_text` events with `phase: 'code'` carry the file in deltas (~every
 * 150 ms) and an EMPTY `accumulated`, deliberately — the code is the bulk of
 * every run and resending the whole of it per frame would swamp the stream.
 * So this buffer is the only copy the client has until `preview_ready` or
 * `completion` hands over the authoritative text, which replaces it: what
 * the pipeline wrote to disk can differ from what the model streamed
 * (import repair, title fixes), and the file is what counts.
 *
 * `streaming` is true from the first code delta until the phase ends — the
 * next non-code prose event, or the file landing. Null before the first
 * delta of a run, and cleared when the next run starts.
 */
export interface LiveCode {
  text: string;
  streaming: boolean;
}

/**
 * The code-buffer reducer, pure so it can be tested without React. Fed
 * EVERY stream event; it only reacts to the ones that touch the code.
 */
export function applyLiveCode(
  prev: LiveCode | null,
  event: { type?: unknown; data?: { phase?: unknown; delta?: unknown; accumulated?: unknown; code?: unknown } | null },
): LiveCode | null {
  const data = event.data ?? {};
  switch (event.type) {
    case 'llm_text': {
      if (data.phase !== 'code') {
        // Prose after code (the summary) means the file is finished.
        return prev?.streaming ? { ...prev, streaming: false } : prev;
      }
      const delta = typeof data.delta === 'string' ? data.delta : '';
      const accumulated = typeof data.accumulated === 'string' ? data.accumulated : '';
      let text = (prev?.text ?? '') + delta;
      // The contract sends none, but a server that does is trusted on the
      // same terms as the prose phases: at least as long as ours, or stale.
      if (accumulated && accumulated.length >= text.length) text = accumulated;
      return { text, streaming: true };
    }
    case 'preview_ready':
    case 'completion': {
      const code = typeof data.code === 'string' && data.code ? data.code : null;
      if (code !== null) return { text: code, streaming: false };
      return prev?.streaming ? { ...prev, streaming: false } : prev;
    }
    default:
      return prev;
  }
}

/**
 * The live-text reducer, pure so it can be tested without React.
 *
 * Deltas are appended; a phase change starts a fresh buffer (so the first
 * `plan` delta clears the thinking text outright). For `plan` and `summary`,
 * `accumulated` is the server's view of the whole text so far and is
 * authoritative: it replaces the local buffer whenever it is at least as long
 * (a delta lost to a parse failure leaves the buffer short, and no longer a
 * prefix); a shorter one is stale and ignored. For `thinking`, `accumulated`
 * is a capped sliding tail (up to ~2000 chars) and REPLACES the text on
 * every event, shorter or not. The two are only ever compared, never both
 * shown.
 *
 * `code` events belong to `applyLiveCode` and leave this buffer untouched:
 * before that phase existed an unknown phase fell through to `plan`, which
 * would have appended the whole story file to the plan bubble.
 */
export function applyLiveText(
  prev: LiveText | null,
  data: { delta?: unknown; accumulated?: unknown; phase?: unknown },
): LiveText | null {
  if (data.phase === 'code') return prev;
  const phase: LiveTextPhase =
    data.phase === 'summary' ? 'summary' : data.phase === 'thinking' ? 'thinking' : 'plan';
  const delta = typeof data.delta === 'string' ? data.delta : '';
  const accumulated = typeof data.accumulated === 'string' ? data.accumulated : null;

  const base = prev && prev.phase === phase ? prev.text : '';
  let text = base + delta;
  if (phase === 'thinking') {
    // A capped SLIDING TAIL of the reasoning, not a prefix: the server's
    // `accumulated` replaces whatever was shown, however long that was.
    if (accumulated !== null) text = accumulated;
  } else if (accumulated !== null && accumulated.length >= text.length) {
    text = accumulated;
  }
  if (!text && !prev) return null;
  return { phase, text };
}

const normalizeProse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The text of the finished assistant turn: the streamed plan first, then the
 * completion's summary — unless one already contains the other, in which
 * case the longer one stands alone. The model is asked for the plan and
 * then, separately, for a summary, and it often opens the summary by
 * restating the plan; showing that sentence twice reads as a stutter.
 */
export function composeAssistantText(
  plan: string | undefined,
  summary: string | undefined,
  fallback: string,
): string {
  const p = plan?.trim() ?? '';
  const s = summary?.trim() ?? '';
  if (!p && !s) return fallback;
  if (!p) return s;
  if (!s) return p;
  const np = normalizeProse(p);
  const ns = normalizeProse(s);
  if (ns.startsWith(np)) return s;
  if (np.startsWith(ns)) return p;
  return `${p}\n\n${s}`;
}

export interface VerificationFinding {
  id: string;
  severity: 'blocker' | 'warning' | 'info';
  class: string;
  message: string;
  evidence?: string;
  selector?: string;
}

export interface Verification {
  outcome: 'verified' | 'issues' | 'not_verified';
  reason?: string;
  findings: VerificationFinding[];
  metrics?: Record<string, number | string | boolean>;
}

export interface GenerationResult {
  success: boolean;
  title?: string;
  fileName?: string;
  storybookId?: string;
  code?: string;
  chatSummary?: string;
  suggestions?: string[];
  verification?: Verification;
  elapsedMs: number;
  /** Advice to read, never a chip to click. */
  notice?: string;
  /** Hand-set props re-applied after the model's rewrite. */
  pins?: { applied: string[]; kept: string[]; lost: string[] };
  /** What the model said it would build, streamed before the code. */
  planText?: string;
  /**
   * For an update answered with edit blocks: exactly what the model searched
   * for and replaced. The Changes view prefers these to a computed diff.
   */
  edits?: Array<{ search: string; replace: string }>;
}

/** The error the run ended on, with whatever the server said to do about it. */
export interface ErrorInfo {
  message: string;
  suggestion?: string;
  recoverable?: boolean;
  /** The request never reached a server (fetch threw), so re-probe it. */
  network: boolean;
}

export interface GenerationRequest {
  prompt: string;
  images?: Array<{ type: 'base64'; data: string; mediaType: string }>;
  /**
   * Documents attached beside the prompt: `data` is the text itself for
   * text-like files (md, txt, csv, json) and raw base64 for PDFs. A server
   * that predates the field ignores it.
   */
  files?: Array<{ name: string; mediaType: string; data: string }>;
  provider?: string;
  model?: string;
  considerations?: string;
  fileName?: string;
  isUpdate?: boolean;
  /**
   * The title of the story being edited. Without it the server re-derives a
   * title from the conversation, so pointing at one icon renamed a whole
   * dashboard — and spent an extra LLM call doing it.
   */
  originalTitle?: string;
  conversation?: Array<{
    role: 'user' | 'ai';
    content: string;
    /**
     * Small data-URL previews of the images attached to this turn (the
     * composer thumbnails, never the full-size base64 payload). The server
     * persists these to the manifest, which is where recovery and openSession
     * read them back — without this field a reference image survived exactly
     * until the first iframe reload.
     */
    thumbnails?: string[];
  }>;
  /**
   * `updatedAt` of the manifest entry being updated, as known when this
   * request was sent. Recovery uses it to require the completed entry to be
   * STRICTLY newer — otherwise resending an identical prompt to the same file
   * matches the previous completion and restores a stale conversation.
   * Client-side only; stripped before the request goes over the wire.
   */
  knownUpdatedAt?: string;
  /**
   * A description of the element the instruction points at, when the user
   * selected one in the preview. Prose rather than a selector: the model edits
   * source, and a compiled class hash appears nowhere in it.
   */
  selection?: string;
  /** Storybook origin; defaults to this page's origin, since the workspace lives inside Storybook. */
  storybookUrl?: string;
}

/** The server wrote the file. Everything after this is background work. */
export interface PreviewReadyInfo {
  fileName: string;
  title: string;
  storybookId?: string;
  isUpdate: boolean;
  code: string;
}

const PENDING_KEY = 'story-ui-v2-pending';

/** What `generate` stashes before opening the stream — enough to find the
 *  finished entry in the manifest and to redraw the user's turn meanwhile. */
export interface PendingGeneration {
  prompt: string;
  fileName: string | null;
  title: string | null;
  startedAt: number;
  /**
   * `updatedAt` of the entry this request was updating, when there was one.
   * Recovery requires the finished entry to be strictly newer than this, so
   * an identical resubmit can never match the entry the PREVIOUS run wrote.
   * Null (or absent, in stashes written before the field existed) for a
   * brand-new story.
   */
  baselineUpdatedAt?: string | null;
}

/**
 * How long recovery waits on no evidence. A generation that has not landed in
 * the manifest after this long — and that the server does not claim to still
 * be running — is not landing. This is the BASE window: the poller extends
 * past it only while `/story-ui/active-generations` proves the generation is
 * still in flight (see pollForCompletedEntry in useSessions).
 */
export const RECOVERY_WINDOW_MS = 4 * 60_000;

/**
 * Absolute cap on recovery, evidence or no evidence. Verification-repair
 * passes legitimately run long past the base window — the active-generations
 * list proves the server is still working and the poller keeps waiting on
 * that proof — but never forever.
 */
export const RECOVERY_HARD_CEILING_MS = 15 * 60_000;

export function readPendingGeneration(): PendingGeneration | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(PENDING_KEY); } catch { return null; }
  if (!raw) return null;
  let pending: PendingGeneration;
  try { pending = JSON.parse(raw); } catch {
    clearPendingGeneration();
    return null;
  }
  // Staleness is judged against the HARD ceiling, not the base window: a
  // long verification-repair pass writes the story file mid-flight, Vite
  // reloads the iframe again, and the stash reaches this remount many
  // minutes after startedAt while the server is still legitimately working.
  // The poller decides whether that is true; a stash older than anything the
  // poller could still accept is abandoned-tab garbage.
  if (!pending?.prompt || !pending.startedAt || Date.now() - pending.startedAt > RECOVERY_HARD_CEILING_MS) {
    clearPendingGeneration();
    return null;
  }
  return pending;
}

export function clearPendingGeneration(): void {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

/**
 * Human labels for every FIXED-text phase the server emits.
 *
 * Must cover all of them: an unmapped phase falls through to the raw server
 * message, and those carry trailing ellipses ("Processing generated code...")
 * which read as a different voice sitting next to these. Verified against
 * generationCore's onProgress calls.
 *
 * Deliberately absent: `verify_repairing`, `verify_repair_failed` and
 * `verify_issues`. Their server messages carry facts a static label cannot —
 * the issue count, and WHY the original was kept — so those render the server
 * message verbatim (written ellipsis-free, in this same voice).
 *
 * The post-write entries exist because the pipeline's late phases were silent:
 * a story that crashed at runtime, was regenerated, and then repaired read as
 * one long "Saving" while the user watched a red error story. The step list
 * now narrates that timeline, and never claims success while a repair is
 * pending — "Verified in browser" is only ever the final verdict.
 */
export const PHASE_LABEL: Record<string, string> = {
  config_loaded: 'Reading your project',
  components_discovered: 'Reading your design system',
  prompt_built: 'Planning the composition',
  llm_thinking: 'Writing the story',
  code_extracted: 'Reading the result',
  validating: 'Checking the code',
  post_processing: 'Tidying imports and titles',
  saving: 'Saving',
  runtime_check: 'Checking the story renders',
  runtime_healing: 'The story crashed when it rendered — fixing it',
  runtime_healed: 'Fixed — the story renders now',
  runtime_heal_failed: 'The crash could not be fixed automatically',
  verifying: 'Rendering it in the browser',
  verify_repaired: 'Repaired and re-checked',
  verified: 'Verified in browser',
  verify_inconclusive: 'Could not verify in a browser',
};

export function useGeneration(apiBase: string) {
  const [steps, setSteps] = useState<GenStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the server said to do about the error, when it said anything.
   *
   * The SSE error event has always carried `suggestion` and `recoverable`;
   * the hook kept only `message`, so "Add an API key to .env" reached the log
   * and never the person who needed it. `network` is set when the request
   * itself failed (fetch rejects with a TypeError) — the caller re-probes the
   * server on that, since the header badge is otherwise only checked once.
   */
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  /**
   * Something the user should know that is not a failure — currently only
   * "you stopped this, but the server did not". Kept apart from `error` so a
   * deliberate action is not painted as a fault.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /** The model's streamed narration for the run in flight; null between runs. */
  const [liveText, setLiveText] = useState<LiveText | null>(null);
  /** The story file as it streams, for the run in flight; null until the first code delta. */
  const [liveCode, setLiveCode] = useState<LiveCode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(0);
  /** Server-side id for the in-flight generation, so Stop can cancel it. */
  const generationIdRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setSteps([]);
    setError(null);
    setErrorInfo(null);
    setNotice(null);
    setLiveText(null);
    setLiveCode(null);
  }, []);

  const pushStep = useCallback((id: string, label: string, detail?: string, state?: StepState) => {
    setSteps(prev => applyStep(prev, { id, label, detail, state }));
  }, []);

  const finishSteps = useCallback((ok: boolean = true) => {
    setSteps(prev => prev.map(s => {
      if (s.state !== 'active') return { ...s, state: s.state };
      // Whatever was still running when the generation died is the step that
      // failed; everything before it genuinely did complete.
      return { ...s, state: ok ? ('done' as const) : ('failed' as const) };
    }));
  }, []);

  /**
   * Stop.
   *
   * Aborting the fetch only closes OUR end. Ask the server to stand down too,
   * best-effort — without that the generation runs to completion, writes the
   * story and persists the reply, so a story would appear in Storybook half a
   * minute after the user thought they had cancelled.
   */
  const cancel = useCallback(() => {
    const id = generationIdRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    if (id) {
      apiFetch(`${apiBase}/story-ui/active-generations/${encodeURIComponent(id)}`, { method: 'DELETE' })
        .catch(() => { /* best effort; the notice already warns it may finish */ });
    }
  }, [apiBase]);

  const generate = useCallback(
    async (request: GenerationRequest, onPreviewReady?: (preview: PreviewReadyInfo) => void): Promise<GenerationResult | null> => {
      reset();
      setBusy(true);
      startedRef.current = Date.now();

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Stash enough to recover if the preview iframe reloads under us.
      try {
        sessionStorage.setItem(
          PENDING_KEY,
          JSON.stringify({
            prompt: request.prompt,
            fileName: request.fileName ?? null,
            title: request.originalTitle ?? null,
            startedAt: startedRef.current,
            baselineUpdatedAt: request.knownUpdatedAt ?? null,
          } satisfies PendingGeneration),
        );
      } catch { /* private mode */ }

      // knownUpdatedAt is recovery bookkeeping for THIS client, not part of
      // the generation contract — keep it off the wire.
      const { knownUpdatedAt: _knownUpdatedAt, ...rest } = request;
      /**
       * The workspace lives inside Storybook, so it knows the origin. Without
       * this the server falls back to STORYBOOK_URL / STORYBOOK_PORT, which
       * `init` never writes, and then to port 6006 — so on a fresh install
       * verification looked at whatever was on 6006 instead of this Storybook.
       */
      const payload = {
        ...rest,
        storybookUrl: rest.storybookUrl ?? (typeof window !== 'undefined' ? window.location.origin : undefined),
      };

      let completion: any = null;
      let failure: string | null = null;
      /**
       * Kept locally as well as in state: the state is for rendering the
       * bubble, this is for handing the plan to the finished turn — reading
       * it back through a closure would see whatever render last committed.
       */
      let live: LiveText | null = null;
      let code: LiveCode | null = null;
      let planText = '';
      let failureInfo: Omit<ErrorInfo, 'message'> = { network: false };
      /** True only for a rejection that means the server never started work. */
      let neverStarted = false;
      generationIdRef.current = null;

      try {
        const res = await apiFetch(`${apiBase}/mcp/generate-story-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!res.ok) {
          // A rejected payload will be rejected again by any retry, so report it
          // rather than silently degrading the request.
          const detail = res.status === 413
            ? 'That image is too large for the server to accept. Try a smaller one.'
            : `Generation request failed (${res.status})`;
          neverStarted = true;
          throw Object.assign(new Error(detail), { status: res.status });
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response stream');
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event: any;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            const data = event.data ?? {};

            // The code buffer watches every event: code deltas fill it, the
            // next prose event closes it, and the file's arrival replaces it.
            const nextCode = applyLiveCode(code, event);
            if (nextCode !== code) {
              code = nextCode;
              setLiveCode(code);
            }

            switch (event.type) {
              case 'progress': {
                const label = PHASE_LABEL[data.phase] || data.message || 'Working';
                pushStep(
                  data.phase || `step-${data.step}`,
                  label,
                  detailFromProgress(data.details),
                  stepStateForPhase(data.phase),
                );
                break;
              }
              case 'retry':
                pushStep('retry', 'Fixing issues it found', data.reason);
                break;
              case 'validation':
                if (data.isValid === false) {
                  pushStep('validation', 'Correcting the code');
                }
                break;
              case 'completion':
                completion = data;
                break;
              case 'llm_text':
                if (data.phase === 'code') break; // handled by applyLiveCode above
                live = applyLiveText(live, data);
                // Only the plan is kept for the turn; thinking is never shown
                // again once the plan replaces it.
                if (live?.phase === 'plan') planText = live.text;
                setLiveText(live);
                break;
              case 'started':
                // The server names the run so Stop can cancel it.
                if (data.generationId) generationIdRef.current = data.generationId;
                break;
              case 'preview_ready':
                // Show the story now; verification keeps narrating in the rail.
                if (data.fileName) {
                  try { onPreviewReady?.(data as PreviewReadyInfo); } catch { /* the caller's problem */ }
                }
                break;
              case 'error':
                failure = data.message || 'Generation failed';
                failureInfo = {
                  suggestion: typeof data.suggestion === 'string' && data.suggestion ? data.suggestion : undefined,
                  recoverable: typeof data.recoverable === 'boolean' ? data.recoverable : undefined,
                  network: false,
                };
                break;
            }
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          // Stopping used to render as nothing at all: the step list is gated
          // on `busy`, so it vanished, no error was set, and no turn was
          // appended — then the story appeared in Storybook anyway.
          finishSteps(false);
          setNotice('Stopped. The server was asked to stand down — if it had already finished, the story will appear in Recent work.');
          setBusy(false);
          setLiveText(null);
          setLiveCode(null);
          try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
          abortRef.current = null;
          return null;
        }
        failure = e?.message || String(e);
        // fetch rejects with a TypeError when the request never reached a
        // server — the case where the connection badge is now wrong.
        failureInfo = { network: e instanceof TypeError && !neverStarted };
      } finally {
        /**
         * Keep the stash unless we KNOW there is nothing to recover.
         *
         * Clearing unconditionally is right for the hazard this was built for
         * — the preview iframe reloading kills the JS context before `finally`
         * can run, so the stash survives on its own. It is wrong for every
         * other disconnect: a proxy idle timeout or a dropped socket during
         * the silent stretch of an LLM call would throw away the only record
         * of a generation that in fact completed.
         */
        if (completion || neverStarted) {
          try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        }
        abortRef.current = null;
        generationIdRef.current = null;
      }

      finishSteps(!!completion);
      setBusy(false);
      // The bubble's job is done; the plan lives on at the top of the turn,
      // and the code in the completion.
      setLiveText(null);
      setLiveCode(null);

      if (failure && !completion) {
        setError(failure);
        setErrorInfo({ message: failure, ...failureInfo });
        return null;
      }
      if (!completion) {
        const message = 'The generation ended without producing a story.';
        setError(message);
        setErrorInfo({ message, network: false });
        return null;
      }

      return {
        success: !!completion.success,
        title: completion.title,
        fileName: completion.fileName,
        storybookId: completion.storybookId,
        code: completion.code,
        chatSummary: completion.chatSummary,
        suggestions: completion.suggestions,
        notice: completion.notice,
        pins: completion.pins,
        verification: completion.verification,
        elapsedMs: Date.now() - startedRef.current,
        planText: planText.trim() || undefined,
        edits: Array.isArray(completion.edits) && completion.edits.length ? completion.edits : undefined,
      };
    },
    [apiBase, pushStep, finishSteps, reset],
  );

  return {
    generate, cancel, steps, busy, error, errorInfo, notice, liveText, reset,
    liveCode,
    /** True from the first code delta until the file is finished or on disk. */
    codeStreaming: liveCode?.streaming ?? false,
  };
}

/**
 * Wait for a story to appear in Storybook's index and return its real entry id.
 *
 * Matching on the server's storyId alone is not enough. Generated stories only
 * SOMETIMES declare an explicit `id:` in their meta; when they don't, Storybook
 * derives the id from the title instead. So a file named
 * `notifications-list-ce0528fd.stories.tsx` can index as
 * `generated-notifications-list`, and polling for the filename slug never
 * resolves — the canvas stays empty and verification reports "not verified"
 * for a story that rendered perfectly well.
 *
 * Title is authoritative, so it is tried as well.
 *
 * Returns null rather than hanging when Storybook's watcher has stopped
 * delivering events, so the caller can say so instead of blaming the story.
 */
/**
 * Resolve a generated story to the id Storybook actually indexed it under.
 *
 * Matching on the server's storyId alone is not enough. Generated stories only
 * SOMETIMES declare an explicit `id:` in their meta; when they don't, Storybook
 * derives the id from the title instead. So a file named
 * `notifications-list-ce0528fd.stories.tsx` can index as
 * `generated-notifications-list`. Title is authoritative, so it is tried too.
 *
 * Shared by the canvas (which needs the id to render) and the recent-work list
 * (which needs it to open a story), so the two can never disagree.
 */
export function resolveIndexedStoryId(
  entries: Record<string, any>,
  storyIdPrefix?: string,
  title?: string,
): string | null {
  const ids = Object.keys(entries);
  const candidates = [storyIdPrefix];
  if (title) candidates.push(`generated-${slugify(title)}`, slugify(title));

  for (const prefix of candidates) {
    if (!prefix) continue;
    const story = ids.find(id => id.startsWith(`${prefix}--`) && entries[id].type === 'story');
    if (story) return story;
    const any = ids.find(id => id.startsWith(`${prefix}--`));
    if (any) return any;
  }

  // Last resort: the entry's own title, which no id-derivation rule can distort.
  if (title) {
    const byTitle = ids.find(
      id => entries[id].type === 'story' &&
        typeof entries[id].title === 'string' &&
        entries[id].title.replace(/^Generated\//, '').toLowerCase() === title.toLowerCase(),
    );
    if (byTitle) return byTitle;
  }
  return null;
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Fetch Storybook's index, or an empty map when it is unreachable. */
export async function fetchStoryIndex(): Promise<Record<string, any>> {
  try {
    const res = await fetch(`/index.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json())?.entries ?? {};
  } catch {
    return {};
  }
}

/**
 * Wait for a story to appear in Storybook's index and return its real entry id.
 *
 * Returns null rather than hanging when Storybook's watcher has stopped
 * delivering events, so the caller can say so instead of blaming the story.
 */
export async function waitForStory(
  storyIdPrefix: string,
  title?: string,
  timeoutMs = 20000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = resolveIndexedStoryId(await fetchStoryIndex(), storyIdPrefix, title);
    if (found) return found;
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}
