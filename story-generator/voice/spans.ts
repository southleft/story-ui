/**
 * The words a request can supply, as a closed set.
 *
 * Jev picks; it does not write. "Add a card titled Invite a teammate" names
 * its title in words the person already said, so the candidates for the title
 * are the contiguous runs of those words and Jev chooses which run plays the
 * role. The string that lands in the code is a verbatim copy of speech, never
 * a model's paraphrase of it (TypeSafe's "pre-parsed value extraction").
 */

export const NONE = 'none';

/** Word-level tokens with edge punctuation stripped. */
export function words(transcript: string): string[] {
  return transcript
    .split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, ''))
    .filter(Boolean);
}

/**
 * Every contiguous run of 1..maxWords words, shortest first, deduped, capped
 * so a Choice built from them — plus its `none` option — fits Jev's limit.
 */
export function spanCandidates(transcript: string, maxWords = 10, limit = 254): string[] {
  const w = words(transcript);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let len = 1; len <= Math.min(maxWords, w.length); len++) {
    for (let i = 0; i + len <= w.length; i++) {
      const span = w.slice(i, i + len).join(' ');
      const key = span.toLowerCase();
      if (seen.has(key) || key === NONE) continue;
      seen.add(key);
      out.push(span);
    }
  }
  // Shortest first means a cap drops the longest runs, which are the least
  // likely to be a label and the most likely to be the whole sentence.
  return out.slice(0, limit);
}

/** Text as it should appear on screen: first letter capitalised, nothing else touched. */
export function asDisplayText(span: string): string {
  return span ? span[0].toUpperCase() + span.slice(1) : span;
}

/** `CardTitle` → `card title`, `defaultChecked` → `default checked`. */
function nameWords(s: string): string[] {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * The spans that could be a new VALUE for `field` on `tag`.
 *
 * Jev reads literally: asked which words of "The text should be send" are the
 * new text, it picks the whole sentence. Two facts rule candidates out before
 * it chooses, both read from the question itself rather than from English:
 * a span that names the field or the element ("text", "placeholder",
 * "button") is the reference, not the value; and a request longer than two
 * words is never, in full, its own value.
 */
export function valueSpans(transcript: string, tag: string, field: string): string[] {
  const banned = new Set([...nameWords(tag), ...nameWords(field)]);
  const total = words(transcript).length;
  return spanCandidates(transcript).filter(s => {
    const w = nameWords(s);
    return !w.some(x => banned.has(x)) && (total <= 2 || w.length < total);
  });
}
