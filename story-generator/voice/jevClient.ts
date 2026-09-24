/**
 * TypeSafe's System One endpoint, called directly.
 *
 * Jev does not generate. It reads a `state` once and answers a map of typed
 * questions in parallel — a Choice from options we list, a Noul (probability
 * a statement is true), or a Score on a rubric — in roughly half a second.
 * That is the shape of a parametric voice edit: which element, which prop,
 * which of the values the component declares. The model picks; code owns
 * every value it could pick from.
 *
 * One endpoint and three question shapes do not justify a dependency, so this
 * is plain fetch. Retries follow the API's guidance: 429 and 529 back off,
 * everything else fails immediately so the caller can fall back to the LLM
 * path rather than wait.
 */

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

type Structured = string | Record<string, unknown> | unknown[];

export interface ChoiceQuestion {
  type: 'choice';
  instructions: Structured;
  /** option → description (null when the option needs none). Max 255. */
  criteria: Record<string, Structured | null>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: Structured;
  criteria?: { true?: Structured; false?: Structured };
}

export interface ScoreQuestion {
  type: 'score';
  instructions: Structured;
  criteria: Structured[];
}

export type JevQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface ScoreAnswer {
  type: 'score';
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  /** Wall-clock for the HTTP round trip, measured here. */
  ms: number;
}

/** Jev's per-choice option ceiling. */
export const MAX_CHOICE_OPTIONS = 255;

/** Price per input token (output is free) — jev-1.13, $0.042 per Mtok. */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export class JevError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'JevError';
  }
}

export function jevConfigured(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

export function jevModel(): string {
  return process.env.TYPESAFE_MODEL || 'jev-latest';
}

export interface AskOptions {
  timeoutMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Ask Jev a set of questions about one state.
 *
 * Throws `JevError` on anything the caller should treat as "no decision":
 * no key, a validation error, a timeout, or retries exhausted.
 */
export async function askJev(
  state: unknown,
  questions: Record<string, JevQuestion>,
  options: AskOptions = {},
): Promise<JevResponse> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new JevError('TYPESAFE_API_KEY is not set');
  if (Object.keys(questions).length === 0) throw new JevError('no questions to ask');

  for (const [id, q] of Object.entries(questions)) {
    if (q.type === 'choice' && Object.keys(q.criteria).length > MAX_CHOICE_OPTIONS) {
      throw new JevError(`question ${id} has ${Object.keys(q.criteria).length} options; Jev accepts ${MAX_CHOICE_OPTIONS}`);
    }
  }

  const doFetch = options.fetchImpl ?? fetch;
  const body = JSON.stringify({ state, model: jevModel(), questions });
  const started = Date.now();
  const attempts = 3;

  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    let res: Response;
    try {
      res = await doFetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new JevError(aborted ? 'Jev timed out' : `Jev request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    clearTimeout(timer);

    if ((res.status === 429 || res.status === 529) && attempt < attempts) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** attempt;
      await new Promise(r => setTimeout(r, Math.min(wait, 2000)));
      continue;
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 400); } catch { /* body unreadable */ }
      throw new JevError(`Jev returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
    const json = await res.json() as Omit<JevResponse, 'ms'>;
    return { ...json, ms: Date.now() - started };
  }
}
