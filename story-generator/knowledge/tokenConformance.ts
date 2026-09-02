/**
 * Does every `var(--token)` in the generated code exist in this project?
 *
 * A CBDS data table came back with `--cbds-fg-secondary` and
 * `--cbds-weight-bold` — plausible names, both invented (the real one is
 * `--cbds-font-weight-bold`). The browser resolves an unknown custom property
 * to nothing, so the text rendered in the default weight and colour and the
 * page looked broken in a way no validator noticed: the code was valid, the
 * imports resolved, the story mounted. The token list is a fact the project
 * states in its own stylesheets; this checks the code against it.
 *
 * Deliberately absent: any opinion about WHICH token to use. That is the
 * model's judgement; this only refuses names the project does not declare.
 */

export interface TokenViolation {
  line: number;
  name: string;
  nearest?: string;
  message: string;
}

const VAR_RE = /var\(\s*--([a-zA-Z][\w-]*)/g;

/** Edit distance, bounded — names are short and the set is a few hundred. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/** The declared token closest to an invented one, if anything is close. */
export function nearestToken(name: string, known: Iterable<string>): string | undefined {
  let best: { name: string; d: number } | undefined;
  const lower = name.toLowerCase();
  for (const candidate of known) {
    const d = distance(lower, candidate.toLowerCase());
    if (!best || d < best.d) best = { name: candidate, d };
  }
  // A suggestion further than this is noise: `--fg-secondary` → `--radius-1`
  // helps nobody, and the model would take it as an instruction.
  return best && best.d <= Math.max(3, Math.floor(name.length / 3)) ? best.name : undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param code    the generated story
 * @param known   token names WITHOUT the leading `--`, as `readDesignTokens` reports them
 */
export function checkTokenUsage(code: string, known: Set<string>): TokenViolation[] {
  if (known.size === 0) return [];
  const violations: TokenViolation[] = [];
  const seen = new Set<string>();
  const lines = code.split('\n');
  lines.forEach((text, index) => {
    for (const m of text.matchAll(VAR_RE)) {
      const name = m[1];
      if (known.has(name) || seen.has(name)) continue;
      // A property the story itself declares (`style={{ '--gap': ... }}` or a
      // `<style>` block) is not invented; it is defined right there.
      if (new RegExp(`--${escapeRe(name)}\\s*['"]?\\s*:`).test(code)) continue;
      seen.add(name);
      const nearest = nearestToken(name, known);
      violations.push({
        line: index + 1,
        name,
        nearest,
        message: `var(--${name}) is not a design token in this project` +
          (nearest
            ? ` — did you mean --${nearest}?`
            : '. Use a token from the list you were given, or a component that already carries this styling.'),
      });
    }
  });
  return violations;
}

export function formatTokenErrors(violations: TokenViolation[]): string[] {
  return violations.map(v => `Line ${v.line}: ${v.message}`);
}
