/**
 * Property panel — direct manipulation for changes that have one right answer.
 *
 * Selecting a button and asking a model to "make it red" costs twenty seconds,
 * real money, and — measured — occasionally the whole page. The component's
 * own type declarations already say exactly which values that prop accepts, so
 * the change can be applied as an AST edit in milliseconds with no model in
 * the path and no possibility of touching anything else.
 *
 * Deliberately NOT a style editor. Every control here writes a real prop with
 * a value the component declares, so nothing it can produce is invalid and
 * nothing it produces is off-system. Offering a colour wheel or a pixel field
 * would reintroduce exactly the raw values the rest of this codebase works to
 * eliminate.
 */

import { apiFetch } from './api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Flex, IconButton, Select, Switch, Text, TextField } from '@radix-ui/themes';
import type { ElementTarget } from './elementTargeting';
import { XIcon } from './icons';
import {
  appliedLabel,
  draftDiffers,
  echoValue,
  undoValue,
  type EditStatus,
  type PropKind,
  type PropValue,
} from './propEditStatus';

interface EditableProp {
  name: string;
  kind: 'enum' | 'boolean' | 'number' | 'string' | 'other';
  options?: string[];
  doc?: string;
  defaultValue?: string;
  deprecated?: string;
}

interface PropertyPanelProps {
  apiBase: string;
  target: ElementTarget | null;
  fileName?: string;
  /**
   * Called after a successful write so the canvas can reload. Carries the
   * file's new contents when the server returns them, so the code view shows
   * the edit without another round trip.
   */
  onApplied: (code?: string) => void;
  /** The × in the inspector's header. Closing also clears the selection. */
  onClose?: () => void;
  /**
   * Reports the server-resolved component name (null while unresolved), so
   * the composer chip can call the selection what the FILE calls it. The
   * clicked fiber is often a library internal — "UnstyledButton" on a chip
   * whose edits target `<Button>` reads as targeting the wrong element.
   */
  onResolved?: (name: string | null) => void;
}

export function PropertyPanel({ apiBase, target, fileName, onApplied, onClose, onResolved }: PropertyPanelProps) {
  const [props, setProps] = useState<EditableProp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /**
   * What the last change did, and how to take it back. The panel used to
   * apply every change silently — an AST edit in ~80ms, preview reloaded —
   * and nothing on screen said so, which read as "does this do anything?".
   */
  const [status, setStatus] = useState<EditStatus>(null);
  /** The control that just changed, highlighted for a moment. */
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  /**
   * Text typed into a string/number field but not yet committed. Blur
   * commits, but a blur is invisible, so a field whose draft differs from
   * the source shows an Apply button as well.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const component = target?.component ?? null;

  /**
   * The component whose props are actually shown — resolved by the SERVER.
   *
   * The click lands on whatever fiber rendered the pixel, and that is often a
   * library internal: a Mantine Button reports `UnstyledButton`, which the
   * story file never mentions and which declares nothing editable — a dead
   * end. The fiber chain is a hypothesis; the file is authoritative. So the
   * whole candidate chain goes up, the server keeps the first name that
   * appears in the story file, and reports it back as `component`. Null until
   * the lookup answers, and null on an older server that does not report it —
   * then the clicked name stands, which is exactly the old behaviour.
   */
  const [resolved, setResolved] = useState<string | null>(null);

  /** The chip and placeholder follow this, so the whole panel agrees. */
  useEffect(() => { onResolved?.(resolved); }, [resolved, onResolved]);

  /**
   * Every name between the click and the story, owner-sorted (implementation
   * details after the component that owns them — see orderSourceCandidates).
   * The chain already contains the clicked component, in its sorted place;
   * appending the raw clicked name keeps it as a FALLBACK, not a leader —
   * leading with it re-created the defect this ordering fixes whenever a
   * story authored the internal's name (an intentional <UnstyledButton>)
   * while the user clicked a component built on it. Deduped because the
   * class-name fallback and the fiber chain can agree.
   */
  const candidates = useMemo(() => {
    const list = [...(target?.sourceCandidates ?? []), component];
    return [...new Set(list.filter((n): n is string => !!n))];
  }, [component, target]);
  const candidatesKey = candidates.join(',');

  /**
   * Each candidate's fiber-reported AUTHOR, keyed by name. The server prefers
   * a candidate whose owner the file DECLARES — that is what tells `<Button>`
   * (owner PricingPage, declared) from the internal Box a label click lands
   * on (owner Button, imported). And once the server names the winner, its
   * detail carries the occurrence and owner the edit must use — the TOP
   * candidate's numbers describe a different element entirely.
   */
  const detailByName = useMemo(() => {
    const map: Record<string, { owner?: string; occurrence?: number; fromList?: boolean }> = {};
    for (const d of target?.sourceCandidateDetails ?? []) {
      if (d?.name && !(d.name in map)) map[d.name] = d;
    }
    return map;
  }, [target]);
  const ownersKey = candidates.map(n => detailByName[n]?.owner ?? '').join(',');
  /**
   * The attributes the element already carries, keyed by prop name.
   *
   * Every control below binds to this. Without it they were uncontrolled: a
   * Select showed "choose…" for a prop the source explicitly set, and a Switch
   * rendered off for a boolean that was already on — so applying a change and
   * failing to apply one looked exactly the same.
   */
  const [current, setCurrent] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    setResolved(null);
    setStatus(null);
    setNote(null);
    setDrafts({});
    if (!component) { setProps([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // The server tries `component` FIRST, so it must carry the best
        // hypothesis — the owner-sorted top candidate, which is the element
        // the story authored. The raw clicked name rides at the end of the
        // candidate list as a fallback.
        const params = new URLSearchParams({ component: candidates[0] || component });
        // Owner-sorted; the server resolves the first that appears in the
        // story file. An older server ignores both and answers for `component`
        // alone — same request, same fallback rendering.
        if (candidatesKey) params.set('candidates', candidatesKey);
        // Positional with `candidates`: each one's fiber-reported author, so
        // the server can prefer the candidate the STORY wrote. An older
        // server ignores it.
        if (candidatesKey && ownersKey.replace(/,/g, '')) params.set('owners', ownersKey);
        if (fileName) params.set('fileName', fileName);
        // The occurrence the edit would use, so the values shown describe the
        // element that would actually change rather than the first of its name.
        const occ = detailByName[candidates[0] || component]?.occurrence
          ?? target?.sourceOccurrence ?? target?.occurrence;
        if (occ !== undefined && occ !== null) params.set('occurrence', String(occ));
        const res = await apiFetch(`${apiBase}/mcp/editable-props?${params.toString()}`);
        if (!res.ok) {
          // The server explains itself — a 501 says property editing is
          // React-only and names the project's framework. Throwing that
          // away left a Vue user with "could not read", which reads as a bug.
          const body = await res.json().catch(() => ({}));
          throw new Error(
            res.status === 501
              ? (body.error || `Property editing is available for React projects only${body.framework ? ` — this project is ${body.framework}` : ''}.`)
              : (body.error || 'lookup failed'),
          );
        }
        const data = await res.json();
        if (!cancelled) {
          setProps(Array.isArray(data.props) ? data.props : []);
          setResolved(typeof data.component === 'string' && data.component ? data.component : null);
          // Absent on an older server, which simply means "no current values
          // to show" — the controls fall back to their placeholders.
          setCurrent(data.current && typeof data.current === 'object' ? data.current : {});
        }
      } catch (err) {
        const reason = err instanceof Error && err.message && err.message !== 'lookup failed' ? err.message : null;
        if (!cancelled) setError(reason ?? 'Could not read this component’s properties.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, component, candidatesKey, ownersKey, fileName]);

  /** What the panel calls the component: the file's name for it, when known. */
  const displayName = resolved ?? component;

  const apply = useCallback(async (
    prop: string,
    value: PropValue,
    opts: { kind?: PropKind; isUndo?: boolean } = {},
  ) => {
    if (!component || !fileName) {
      // Reachable: "New" does not clear the selection or close this panel, so
      // you can sit on the home screen with a live chip over a story that is
      // no longer active. Returning silently made every control look broken.
      setNote('No story is open to edit — pick one from Recent work first.');
      return;
    }
    setPending(prop);
    setNote(null);
    setStatus({ kind: 'applying', prop });
    // What Undo must put back: the source text before THIS change.
    const previous = current[prop];
    /**
     * The element the edit targets — the server-resolved name when the lookup
     * reported one (the name the FILE contains), else the owner-sorted top
     * candidate. Its DETAIL carries the owner and occurrence for THAT
     * element: a label click resolves past an internal Box to `Button`, and
     * sending the Box's numbers with Button's name would edit the wrong one.
     */
    const targetName = resolved ?? candidates[0] ?? component;
    const detail = detailByName[targetName];
    const isList = detail ? !!detail.fromList : !!target?.fromList;
    try {
      const res = await apiFetch(`${apiBase}/mcp/edit-prop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          component: targetName,
          // Every component between the click and the story, owner-sorted:
          // implementation details after the component that owns them. The
          // server picks whichever actually appears in the file — the fiber
          // chain contains HOC wrappers that are not JSX elements.
          candidates: target?.sourceCandidates,
          /**
           * Each candidate's fiber-reported author, so the server prefers a
           * candidate the STORY wrote (owner declared in the file) and can
           * re-derive the right owner if its resolution differs from ours.
           */
          owners: Object.keys(detailByName).length
            ? Object.fromEntries(Object.entries(detailByName).map(([n, d]) => [n, d.owner]))
            : undefined,
          /**
           * The component whose render authored the target element. The
           * server locates this name's declaration in the file and reads
           * `occurrence` as a position INSIDE it — the only region where DOM
           * order and JSX order are known to agree. Measured without it: a
           * banner component defined first but rendered last put its Button
           * at whole-page DOM position 8 in a file holding 3 Buttons.
           */
          owner: detail?.owner ?? target?.sourceOwner,
          /**
           * The target element's position among elements of the same name
           * with the same owner. A whole `.map()` list counts ONCE, so the
           * number stays meaningful for list rows: clicking any row maps to
           * the single JSX element that renders them all. (Omitting the
           * occurrence for lists let the server default to the FIRST element
           * of that name in the file — measured editing the Alert's button
           * when a Register button inside a list was clicked.)
           *
           * OMITTED, never defaulted, when the browser could not compute it;
           * the server answers ambiguity with a 409 carrying the count.
           */
          occurrence: detail
            ? detail.occurrence
            : target?.sourceOccurrence ?? target?.occurrence,
          prop,
          value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        /**
         * A 409 is the server refusing to GUESS, and it hands back the count
         * it refused to guess between. That number was read only on the
         * success branch, so the one case the server was carefully built to
         * detect reached the user as a bare error with no way forward.
         */
        const ambiguous = typeof data?.occurrencesInSource === 'number' && data.occurrencesInSource > 1;
        setNote(
          ambiguous
            ? `${data.error || 'That change is ambiguous.'} Click the exact ${targetName} you mean in the preview and try again.`
            : (data?.error || 'That change could not be applied.'),
        );
        setStatus(null);
        return;
      }

      // Optimistic local echo so the control shows the new value immediately;
      // the authoritative values arrive with the next fetch.
      setCurrent(prev => ({ ...prev, [prop]: echoValue(value) }));
      setDrafts(prev => {
        if (!(prop in prev)) return prev;
        const next = { ...prev };
        delete next[prop];
        return next;
      });
      setStatus({
        kind: 'applied',
        prop,
        value,
        previous,
        kindOfProp: opts.kind,
        canUndo: !opts.isUndo,
      });
      setFlash(prop);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 1500);

      /**
       * Say when one edit affects several elements.
       *
       * Two different reasons this happens, and the `.map()` one used to go
       * unmentioned. A list is ONE JSX element and many DOM nodes, so
       * `occurrencesInSource` is 1 and this notice stayed silent for precisely
       * the case where the user is most likely to be surprised — they clicked
       * one row and every row changed. React's `key` on the fiber tells us,
       * before the request, that we are in a list.
       */
      if (isList) {
        setNote(`Applied to every item in this list — one ${targetName} in the source renders all of them.`);
      } else if (typeof data.occurrencesInSource === 'number' && data.occurrencesInSource > 1) {
        setNote(`Applied. This ${targetName} appears ${data.occurrencesInSource} times in the source — check whether they all changed.`);
      }
      // The ordinary case is the status line at the bottom of the panel.
      onApplied(typeof data?.code === 'string' ? data.code : undefined);
    } catch {
      setNote('That change could not be applied.');
      setStatus(null);
    } finally {
      setPending(null);
    }
  }, [apiBase, component, candidates, detailByName, resolved, fileName, target, onApplied, current]);

  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  /** Put the previous value back. Undoing an undo is not offered. */
  const undo = useCallback(() => {
    if (!status || status.kind !== 'applied' || !status.canUndo) return;
    const kind = status.kindOfProp ?? 'string';
    void apply(status.prop, undoValue(kind, status.previous), { kind, isUndo: true });
  }, [status, apply]);

  /**
   * Commit a text/number field, on Enter OR blur, and only when it changed.
   *
   * Enter-only was a silent dead end: type a value, click elsewhere, nothing
   * happens and nothing says why. Comparing against the current value keeps a
   * blur from re-sending an unchanged prop on every focus change.
   */
  const commitText = (p: { name: string; kind: PropKind }, raw: string) => {
    const next = raw.trim();
    const now = current[p.name] ?? '';
    if (next === now) return;
    if (!next) { apply(p.name, null, { kind: p.kind }); return; }   // empty means reset, not ""
    apply(p.name, p.kind === 'number' ? Number(next) : next, { kind: p.kind });
  };

  if (!target) return null;

  if (!component) {
    return (
      <Flex direction="column" gap="2" p="3">
        <Text size="2" weight="medium">No component identified</Text>
        <Text size="1" color="gray">
          This element could not be traced to a design system component, so there are no
          properties to edit directly. Describe the change in the chat instead.
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="3" p="3">
      <Flex align="center" justify="between">
        <Flex align="center" gap="2">
          {/* The RESOLVED name — the user clicked "a button" and should read
              "Button", not the UnstyledButton internal the fiber happened to
              report. Falls back to the clicked name while the lookup runs and
              on servers that do not resolve. */}
          <Badge color="green" variant="soft">{displayName}</Badge>
          {/* The RESOLVED element's position, not the clicked fiber's: a
              label click resolves past an internal Box whose own count is a
              different (and wrong-looking) number — measured "#3" beside a
              Button the file holds once. */}
          {(() => {
            const d = displayName ? detailByName[displayName] : undefined;
            // A detail for the resolved name is authoritative even when it
            // holds no occurrence — falling back to the top candidate's
            // number would reintroduce the wrong "#3".
            const at = d ? d.occurrence : target.sourceOccurrence ?? target.occurrence;
            return typeof at === 'number'
              ? <Text size="1" color="gray">#{at + 1}</Text>
              : null;
          })()}
        </Flex>
        {onClose && (
          <IconButton size="1" variant="ghost" color="gray" aria-label="Close inspector" onClick={onClose}>
            <XIcon size={14} />
          </IconButton>
        )}
      </Flex>

      {/* The one sentence that answers "do I submit this?". */}
      <Text size="1" color="gray" className="suiw-inspector-hint">
        Changes apply to the story immediately. For anything else, describe it in the chat.
      </Text>

      {loading && <Text size="1" color="gray">Reading properties…</Text>}
      {error && <Text size="1" color="red">{error}</Text>}

      {!loading && !error && props.length === 0 && (
        <Text size="1" color="gray">
          This component declares no directly editable properties. Describe the change instead.
        </Text>
      )}

      {props.map(p => (
        <Flex
          key={p.name}
          direction="column"
          gap="1"
          className={`suiw-prop${flash === p.name ? ' suiw-prop--flash' : ''}`}
          data-prop={p.name}
        >
          <Text size="1" weight="medium">{p.name}</Text>
          {p.doc && <Text size="1" color="gray">{p.doc}</Text>}

          {p.kind === 'enum' && p.options && (
            <Select.Root
              // Controlled: show what the source actually says. `undefined`
              // falls back to the placeholder, which now genuinely means
              // "this prop is not set" rather than "we did not look".
              value={current[p.name] ?? undefined}
              disabled={pending === p.name}
              onValueChange={v => apply(p.name, v === '__default__' ? null : v, { kind: 'enum' })}
            >
              <Select.Trigger placeholder={p.defaultValue ? `default: ${p.defaultValue}` : 'choose…'} />
              <Select.Content>
                {/* Removing the attribute is how a prop returns to its default,
                    and there is no other way to express that in a picker. */}
                <Select.Item value="__default__">— default —</Select.Item>
                {p.options.map(o => <Select.Item key={o} value={o}>{o}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          )}

          {p.kind === 'boolean' && (
            <Switch
              // A bare `<X loading />` reads back as the string "true".
              checked={current[p.name] === 'true' || current[p.name] === p.name}
              disabled={pending === p.name}
              onCheckedChange={c => apply(p.name, c ? true : null, { kind: 'boolean' })}
            />
          )}

          {(p.kind === 'number' || p.kind === 'string') && (
            <Flex align="center" gap="2">
              <TextField.Root
                size="1"
                style={{ flex: '1 1 auto', minWidth: 0 }}
                value={drafts[p.name] ?? current[p.name] ?? ''}
                placeholder={p.defaultValue || (p.kind === 'number' ? 'number' : 'text')}
                disabled={pending === p.name}
                aria-label={p.name}
                onChange={e => setDrafts(prev => ({ ...prev, [p.name]: e.target.value }))}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  commitText(p, (e.target as HTMLInputElement).value);
                }}
                // Committing on blur too. Enter-only meant typing a value and
                // clicking away did nothing, with no hint that it would.
                onBlur={e => commitText(p, e.target.value)}
              />
              {/* A blur commit is invisible; the button says the draft is
                  not yet in the file. */}
              {draftDiffers(drafts[p.name], current[p.name]) && (
                <Button
                  size="1"
                  variant="soft"
                  disabled={pending === p.name}
                  onMouseDown={e => e.preventDefault()} /* keep the field's blur from firing first */
                  onClick={() => commitText(p, drafts[p.name] ?? '')}
                >
                  Apply
                </Button>
              )}
            </Flex>
          )}
        </Flex>
      ))}

      {note && <Text size="1" color="gray">{note}</Text>}

      {status && (
        <Flex align="center" gap="3" className="suiw-inspector-status" role="status" aria-live="polite">
          {status.kind === 'applying' ? (
            <Text size="1" color="gray">Applying…</Text>
          ) : (
            <>
              <Text size="1" color="green">Applied · {appliedLabel(status.prop, status.value)}</Text>
              {status.canUndo && (
                <Button size="1" variant="ghost" color="gray" onClick={undo} disabled={pending !== null}>
                  Undo
                </Button>
              )}
            </>
          )}
        </Flex>
      )}
    </Flex>
  );
}
