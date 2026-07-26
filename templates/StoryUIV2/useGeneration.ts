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
 * the reload kills the in-flight SSE connection mid-generation. So progress is
 * mirrored to sessionStorage and the server persists the final reply; on remount
 * we recover rather than showing the user an empty chat.
 */

import { useCallback, useRef, useState } from 'react';

export type StepState = 'active' | 'done';

export interface GenStep {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  /** When this step became active, so the UI can show elapsed time. */
  startedAt: number;
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
}

export interface GenerationRequest {
  prompt: string;
  images?: Array<{ type: 'base64'; data: string; mediaType: string }>;
  provider?: string;
  model?: string;
  considerations?: string;
  fileName?: string;
  isUpdate?: boolean;
  conversation?: Array<{ role: 'user' | 'ai'; content: string }>;
}

const PENDING_KEY = 'story-ui-v2-pending';

/**
 * Human labels for every phase the server emits.
 *
 * Must cover all of them: an unmapped phase falls through to the raw server
 * message, and those carry trailing ellipses ("Processing generated code...")
 * which read as a different voice sitting next to these. Verified against
 * generationCore's onProgress calls.
 */
const PHASE_LABEL: Record<string, string> = {
  config_loaded: 'Reading your project',
  components_discovered: 'Reading your design system',
  prompt_built: 'Planning the composition',
  llm_thinking: 'Writing the story',
  code_extracted: 'Reading the result',
  validating: 'Checking the code',
  post_processing: 'Tidying imports and titles',
  saving: 'Saving',
  verifying: 'Rendering it in the browser',
};

export function useGeneration(apiBase: string) {
  const [steps, setSteps] = useState<GenStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(0);

  const reset = useCallback(() => {
    setSteps([]);
    setError(null);
  }, []);

  const pushStep = useCallback((id: string, label: string, detail?: string) => {
    setSteps(prev => {
      // Close out whatever was running; only one step is ever active.
      const closed = prev.map(s => (s.state === 'active' ? { ...s, state: 'done' as const } : s));
      const existing = closed.findIndex(s => s.id === id);
      if (existing >= 0) {
        const next = [...closed];
        next[existing] = { ...next[existing], label, detail, state: 'active' };
        return next;
      }
      return [...closed, { id, label, detail, state: 'active', startedAt: Date.now() }];
    });
  }, []);

  const finishSteps = useCallback(() => {
    setSteps(prev => prev.map(s => ({ ...s, state: 'done' as const })));
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const generate = useCallback(
    async (request: GenerationRequest): Promise<GenerationResult | null> => {
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
          JSON.stringify({ prompt: request.prompt, startedAt: startedRef.current }),
        );
      } catch { /* private mode */ }

      let completion: any = null;
      let failure: string | null = null;

      try {
        const res = await fetch(`${apiBase}/mcp/generate-story-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!res.ok) {
          // A rejected payload will be rejected again by any retry, so report it
          // rather than silently degrading the request.
          const detail = res.status === 413
            ? 'That image is too large for the server to accept. Try a smaller one.'
            : `Generation request failed (${res.status})`;
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

            switch (event.type) {
              case 'progress': {
                const label = PHASE_LABEL[data.phase] || data.message || 'Working';
                pushStep(data.phase || `step-${data.step}`, label);
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
              case 'error':
                failure = data.message || 'Generation failed';
                break;
            }
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          setBusy(false);
          return null;
        }
        failure = e?.message || String(e);
      } finally {
        try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        abortRef.current = null;
      }

      finishSteps();
      setBusy(false);

      if (failure && !completion) {
        setError(failure);
        return null;
      }
      if (!completion) {
        setError('The generation ended without producing a story.');
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
        verification: completion.verification,
        elapsedMs: Date.now() - startedRef.current,
      };
    },
    [apiBase, pushStep, finishSteps, reset],
  );

  return { generate, cancel, steps, busy, error, reset };
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
