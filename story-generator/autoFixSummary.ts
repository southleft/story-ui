/**
 * What an automatic fix actually changed, in words.
 *
 * The validator rewrites code it can repair deterministically — an import
 * path collapsed onto the configured barrel, a React import added or
 * removed, a truncated file closed — and reports only that it did. The panel
 * then told every Vue user "Minor syntax issues were automatically
 * corrected", when the fix was three import paths and there was no syntax
 * issue at all. The description is read from the before/after text, which
 * is the one record of what happened that cannot drift from the fixers.
 */

const IMPORT_LINE = /^\s*import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/;
const REACT_IMPORT = /import\s+(?:\*\s+as\s+)?React\b[^;'"]*from\s*['"]react['"]/;

function importBindings(code: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of code.split('\n')) {
    const m = line.match(IMPORT_LINE);
    if (m) out.set(m[1].replace(/\s+/g, ' ').trim(), m[2]);
  }
  return out;
}

/**
 * One clause per kind of change, most specific first. Empty when the text
 * did not change — the caller shows nothing for that, because there is
 * nothing to tell.
 */
export function describeAutoFix(before: string, after: string, errors: string[] = []): string[] {
  if (before === after) return [];
  const details: string[] = [];

  const hadReact = REACT_IMPORT.test(before);
  const hasReact = REACT_IMPORT.test(after);
  if (!hadReact && hasReact) details.push('added the missing React import');
  if (hadReact && !hasReact) details.push('removed a React import this framework does not use');

  // Import paths: the same bindings, sent to a different specifier.
  const from = importBindings(before);
  const to = importBindings(after);
  const rewrites = new Map<string, string[]>();
  for (const [binding, spec] of from) {
    const next = to.get(binding);
    if (next && next !== spec) {
      const list = rewrites.get(next) ?? [];
      list.push(spec);
      rewrites.set(next, list);
    }
  }
  for (const [target, sources] of rewrites) {
    details.push(
      sources.length === 1
        ? `rewrote the import path '${sources[0]}' to '${target}'`
        : `rewrote ${sources.length} import paths to '${target}'`,
    );
  }

  if (details.length) return details;

  // Nothing recognisable: say how much changed and what it was for.
  const a = before.split('\n');
  const b = after.split('\n');
  let changed = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) changed++;
  const why = errors.find(e => e && e.trim());
  const reason = why ? `: ${why.replace(/\s+/g, ' ').trim().slice(0, 100)}` : '';
  details.push(`corrected ${changed} line${changed === 1 ? '' : 's'}${reason}`);
  return details;
}
