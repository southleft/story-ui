/**
 * Does a description say anything the component's NAME does not?
 *
 * Discovery labels every component it finds — `Chip component from Material
 * UI`, `Accordion component` — so that nothing is nameless. That placeholder
 * then behaves like knowledge: it is truthy, so any enrichment guarded on
 * "has no description yet" silently declines to run, and 32 real component
 * descriptions read out of MUI's own type declarations never reached the
 * catalog.
 *
 * It also cost context to say nothing. `Chip component from Material UI`
 * beside an entry already titled **Chip** is a line the model reads and learns
 * nothing from, times 254 components.
 *
 * The same predicate has to be used everywhere the question is asked —
 * enrichment, catalog rendering, and the bench that reports coverage.
 * Measuring with one definition while enriching with another is how a metric
 * reports 63% for a library whose real figure is zero.
 */

/** Words that carry no information about a specific component. */
const FILLER =
  /\b(component|from|the|a|an|for|of|and|ui|material|mantine|chakra|carbon|atlassian|atlaskit|vuetify|shoelace|ant|design|system|library|react|vue|angular|svelte)\b/g;

/**
 * True when `text` is absent or merely restates `name`.
 *
 * The residue test is deliberately crude: strip the component's own name and
 * the filler vocabulary, and see whether enough characters survive to be a
 * statement. Twelve is about one short clause — `Chips represent complex
 * entities` survives, `Chip component from Material UI` does not.
 */
export function isGenericDescription(name: string, text?: string): boolean {
  if (!text) return true;
  const residue = text
    .toLowerCase()
    .replace(new RegExp(escapeForRegExp(name.toLowerCase()), 'g'), '')
    .replace(FILLER, '')
    .replace(/[^a-z0-9]+/g, '');
  return residue.length < 12;
}

/** Inverse of {@link isGenericDescription}, for readable call sites. */
export function saysMoreThanName(name: string, text?: string): boolean {
  return !isGenericDescription(name, text);
}

/**
 * Component names are identifiers, but this has been handed arbitrary strings
 * before and a stray `(` in a RegExp constructor throws rather than failing to
 * match.
 */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
