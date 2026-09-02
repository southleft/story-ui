/**
 * Nearest names in a catalog, by string similarity.
 *
 * Replaces three hand-written suggestion tables (`'stack' → BlockStack,
 * InlineStack, LegacyStack`; `'CustomCard' → Box, Card`) that were Polaris and
 * Primer vocabulary, and answered wrongly for every other design system. The
 * catalog itself is the only vocabulary a suggestion may come from.
 */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1, 1 being identical (case-insensitive). Substring containment scores at least 0.6. */
export function nameSimilarity(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 1;
  const edit = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  if (x.includes(y) || y.includes(x)) return Math.max(edit, 0.6 + 0.4 * (Math.min(x.length, y.length) / Math.max(x.length, y.length)));
  return edit;
}

/**
 * The closest catalog names to `target`, best first. Only names clearing
 * `threshold` are returned, so an invented name with no real neighbour yields
 * nothing rather than a misleading guess.
 */
export function nearestNames(target: string, candidates: Iterable<string>, limit = 3, threshold = 0.5): string[] {
  if (!target) return [];
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of candidates) {
    if (!name || name === target) continue;
    const score = nameSimilarity(target, name);
    if (score >= threshold) scored.push({ name, score });
  }
  return scored
    .sort((p, q) => q.score - p.score || p.name.localeCompare(q.name))
    .slice(0, limit)
    .map(s => s.name);
}
