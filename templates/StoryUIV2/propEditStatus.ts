/**
 * The pure parts of the inspector's feedback: what to say after a change,
 * and what "Undo" must send to put the previous value back.
 *
 * `current[prop]` is the attribute's source text before the change, or
 * undefined when the attribute was not set. The edit route removes an
 * attribute when it is sent null, so "undo to unset" is "send null".
 */

export type PropKind = 'enum' | 'boolean' | 'number' | 'string' | 'other';
export type PropValue = string | number | boolean | null;

export interface AppliedStatus {
  kind: 'applied';
  prop: string;
  value: PropValue;
  /** Source text before the change; undefined when the attribute was absent. */
  previous: string | undefined;
  /** The control's kind, so Undo can send a number or boolean back typed. */
  kindOfProp?: PropKind;
  /** False after an undo: undoing an undo is not offered. */
  canUndo: boolean;
}

export type EditStatus = { kind: 'applying'; prop: string } | AppliedStatus | null;

/** "color = violet", "color = default". */
export function appliedLabel(prop: string, value: PropValue): string {
  return `${prop} = ${value === null ? 'default' : String(value)}`;
}

/** The value to re-apply so the attribute reads as it did before the change. */
export function undoValue(kind: PropKind, previous: string | undefined): PropValue {
  if (previous === undefined || previous === '') return null;
  if (kind === 'number') {
    const n = Number(previous);
    return Number.isFinite(n) ? n : previous;
  }
  if (kind === 'boolean') return previous === 'true' || previous === '' ? true : previous === 'false' ? null : true;
  return previous;
}

/** What the local echo stores for a value the server just accepted. */
export function echoValue(value: PropValue): string | undefined {
  return value === null ? undefined : String(value);
}

/** True when a typed draft would change the attribute if committed. */
export function draftDiffers(draft: string | undefined, current: string | undefined): boolean {
  if (draft === undefined) return false;
  return draft.trim() !== (current ?? '');
}
