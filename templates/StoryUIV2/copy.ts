/**
 * Turning internal notation into words people read.
 *
 * Three strings reached the thread and the dialogs exactly as the server
 * wrote them for machines: a prop-pin's `Button[0].variant = "light"`, a
 * version's `Set Button[0].variant = "light"`, and a title with the quotes
 * the manifest escaped (`Alert \"Warning\" banner`). Each is a fact worth
 * showing; none is a sentence. Pure, so each can be tested as one.
 */

/**
 * `Button[0].variant = "light"` → `Button · variant = light`.
 * The occurrence is shown only when it is not the first — `Button #2 ·
 * variant = light` — which is the same convention the composer chip uses.
 */
const PROP_PATH_RE = /\b([A-Z][\w.]*)\[(\d+)\]\.([\w-]+)(\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+))?/g;

/** Strip one layer of JSON-style quoting from a value. */
function plainValue(raw: string): string {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try { return JSON.parse(s.startsWith("'") ? `"${s.slice(1, -1).replace(/"/g, '\\"')}"` : s); } catch { return s.slice(1, -1); }
  }
  return s;
}

/** Rewrite every `Name[i].prop = value` in a sentence as `Name · prop = value`. */
export function humanizePropPath(text: string): string {
  if (!text) return text;
  return text.replace(PROP_PATH_RE, (_m, name: string, idx: string, prop: string, _assign: string | undefined, value: string | undefined) => {
    const n = Number(idx);
    const who = n > 0 ? `${name} #${n + 1}` : name;
    return value !== undefined ? `${who} · ${prop} = ${plainValue(value)}` : `${who} · ${prop}`;
  });
}

/** A pin, as the "Kept your hand-set props" line lists it. */
export function describePinForPeople(pin: string): string {
  return humanizePropPath(pin);
}

/**
 * A title as it should be displayed, whatever a manifest or a model did to
 * its quotes. Titles are sanitised server-side now; display must not depend
 * on it, because entries written before that fix are still in manifests.
 */
export function unescapeTitle(title: string | null | undefined): string {
  if (!title) return '';
  return title
    .replace(/\\(["'`])/g, '$1')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();
}
