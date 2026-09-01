/**
 * Pinned props: what the user set by hand survives what the model rewrites.
 *
 * A property-panel edit is one attribute on one element. A chat edit hands
 * the whole file to a model, and the model — told to keep everything else
 * identical — still rewrites props as a matter of style: `variant="outline"`
 * became `variant={plan.variant}` on a request that only asked for a new FAQ
 * section (observed, react-mantine, 1 Sept 2026). The version history kept
 * the edit; the file did not.
 *
 * So the panel's edits are recorded as pins, and after every model rewrite
 * the pins are re-applied deterministically with the same AST editor that
 * made them. A pin whose element no longer exists is reported as lost, not
 * silently dropped.
 */

import { readProps, editProp } from './propEditor.js';

export interface PropPin {
  /** JSX element name, e.g. `Button`. */
  component: string;
  /** Occurrence in source order, 0-based — the same index the panel edits by. */
  occurrence: number;
  prop: string;
  value: string | number | boolean;
  /** ISO time the user set it. */
  setAt: string;
}

export interface ReapplyResult {
  code: string;
  /** Pins the model had changed and that were restored. */
  applied: PropPin[];
  /** Pins the model preserved on its own. */
  kept: PropPin[];
  /** Pins whose element or attribute could not be found any more. */
  lost: PropPin[];
}

const pinKey = (p: Pick<PropPin, 'component' | 'occurrence' | 'prop'>) =>
  `${p.component}[${p.occurrence}].${p.prop}`;

/** Replace or add a pin; a `null` value (reset to default) removes it. */
export function upsertPin(
  pins: PropPin[] | undefined,
  pin: { component: string; occurrence: number; prop: string; value: string | number | boolean | null },
): PropPin[] {
  const rest = (pins ?? []).filter(p => pinKey(p) !== pinKey(pin));
  if (pin.value === null) return rest;
  return [...rest, { component: pin.component, occurrence: pin.occurrence, prop: pin.prop, value: pin.value, setAt: new Date().toISOString() }];
}

/** What readProps reports for a pinned value, so the two can be compared. */
function asSourceText(value: string | number | boolean): string {
  return typeof value === 'string' ? value : String(value);
}

export function reapplyPins(code: string, pins: PropPin[] | undefined): ReapplyResult {
  const applied: PropPin[] = [];
  const kept: PropPin[] = [];
  const lost: PropPin[] = [];
  let current = code;
  for (const pin of pins ?? []) {
    const props = readProps(current, pin.component, pin.occurrence);
    if (props === null) { lost.push(pin); continue; }
    if (props[pin.prop] === asSourceText(pin.value)) { kept.push(pin); continue; }
    const result = editProp(current, {
      component: pin.component, occurrence: pin.occurrence, prop: pin.prop, value: pin.value,
    });
    if (result.changed) { current = result.code; applied.push(pin); }
    else lost.push(pin);
  }
  return { code: current, applied, kept, lost };
}

export function describePin(p: PropPin): string {
  return `${pinKey(p)} = ${JSON.stringify(p.value)}`;
}

/**
 * Prompt text telling the model what the user set by hand. Re-application is
 * the guarantee; this only reduces the churn it has to undo.
 */
export function pinsForPrompt(pins: PropPin[] | undefined): string {
  if (!pins?.length) return '';
  return [
    '📌 PINNED PROPS — the user set these by hand in the property panel. Keep each',
    'attribute exactly as written on exactly that element; do not move it into',
    'data, a variable, or a conditional:',
    ...pins.map(p => `  ${describePin(p)}`),
  ].join('\n');
}
