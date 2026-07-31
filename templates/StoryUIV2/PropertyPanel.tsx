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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Flex, Select, Switch, Text, TextField } from '@radix-ui/themes';
import type { ElementTarget } from './elementTargeting';

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
  /** Called after a successful write so the canvas can reload. */
  onApplied: () => void;
  /** Escape hatch to the model for anything structural. */
  onAskInstead?: () => void;
  /**
   * Reports the server-resolved component name (null while unresolved), so
   * the composer chip can call the selection what the FILE calls it. The
   * clicked fiber is often a library internal — "UnstyledButton" on a chip
   * whose edits target `<Button>` reads as targeting the wrong element.
   */
  onResolved?: (name: string | null) => void;
}

export function PropertyPanel({ apiBase, target, fileName, onApplied, onAskInstead, onResolved }: PropertyPanelProps) {
  const [props, setProps] = useState<EditableProp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

  useEffect(() => {
    setResolved(null);
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
        if (fileName) params.set('fileName', fileName);
        const res = await fetch(`${apiBase}/mcp/editable-props?${params.toString()}`);
        if (!res.ok) throw new Error('lookup failed');
        const data = await res.json();
        if (!cancelled) {
          setProps(Array.isArray(data.props) ? data.props : []);
          setResolved(typeof data.component === 'string' && data.component ? data.component : null);
        }
      } catch {
        if (!cancelled) setError('Could not read this component’s properties.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, component, candidatesKey, fileName]);

  /** What the panel calls the component: the file's name for it, when known. */
  const displayName = resolved ?? component;

  const apply = useCallback(async (prop: string, value: string | number | boolean | null) => {
    if (!component || !fileName) return;
    setPending(prop);
    setNote(null);
    try {
      const res = await fetch(`${apiBase}/mcp/edit-prop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          // The server-resolved name when the lookup reported one — that is
          // the name the FILE contains, which is what an AST edit targets.
          // Otherwise the owner-sorted top candidate, never the raw clicked
          // fiber name: the server tries `component` first.
          component: resolved ?? candidates[0] ?? component,
          // Every component between the click and the story, owner-sorted:
          // implementation details after the component that owns them. The
          // server picks whichever actually appears in the file — the fiber
          // chain contains HOC wrappers that are not JSX elements.
          candidates: target?.sourceCandidates,
          /**
           * The clicked element's position among all instances of it, which is
           * what maps it to a JSX element in the source.
           *
           * OMITTED for a list-produced element. DOM order only corresponds to
           * source order when every match is a literal JSX element; with
           * `{rows.map(r => <Card/>)}` plus one literal `<Card/>`, the source
           * holds 2 and the DOM holds 4, so clicking the second row resolved to
           * source element 1 — the literal card — and edited the wrong thing
           * silently. One JSX element backs every row, so sending no occurrence
           * lets the server edit that single element, which is the correct target.
           */
          occurrence: target?.fromList
            ? undefined
            : target?.sourceOccurrence ?? target?.occurrence ?? 0,
          prop,
          value,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setNote(data?.error || 'That change could not be applied.'); return; }

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
      if (target?.fromList) {
        setNote(`Applied to every item in this list — one ${resolved ?? component} in the source renders all of them.`);
      } else if (typeof data.occurrencesInSource === 'number' && data.occurrencesInSource > 1) {
        setNote(`Applied. This ${resolved ?? component} appears ${data.occurrencesInSource} times in the source — check whether they all changed.`);
      }
      onApplied();
    } catch {
      setNote('That change could not be applied.');
    } finally {
      setPending(null);
    }
  }, [apiBase, component, candidates, resolved, fileName, target, onApplied]);

  if (!target) return null;

  if (!component) {
    return (
      <Flex direction="column" gap="2" p="3">
        <Text size="2" weight="medium">No component identified</Text>
        <Text size="1" color="gray">
          This element could not be traced to a design system component, so there are no
          properties to edit directly.
        </Text>
        {onAskInstead && (
          <Button size="1" variant="soft" onClick={onAskInstead}>Describe the change instead</Button>
        )}
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
          {typeof target.occurrence === 'number' && (
            <Text size="1" color="gray">#{target.occurrence + 1}</Text>
          )}
        </Flex>
        {onAskInstead && (
          <Button size="1" variant="ghost" onClick={onAskInstead}>Ask instead</Button>
        )}
      </Flex>

      {loading && <Text size="1" color="gray">Reading properties…</Text>}
      {error && <Text size="1" color="red">{error}</Text>}

      {!loading && !error && props.length === 0 && (
        <Text size="1" color="gray">
          This component declares no directly editable properties. Describe the change instead.
        </Text>
      )}

      {props.map(p => (
        <Flex key={p.name} direction="column" gap="1">
          <Text size="1" weight="medium">{p.name}</Text>
          {p.doc && <Text size="1" color="gray">{p.doc}</Text>}

          {p.kind === 'enum' && p.options && (
            <Select.Root
              disabled={pending === p.name}
              onValueChange={v => apply(p.name, v === '__default__' ? null : v)}
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
              disabled={pending === p.name}
              onCheckedChange={c => apply(p.name, c ? true : null)}
            />
          )}

          {(p.kind === 'number' || p.kind === 'string') && (
            <TextField.Root
              size="1"
              placeholder={p.defaultValue || (p.kind === 'number' ? 'number' : 'text')}
              disabled={pending === p.name}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                const raw = (e.target as HTMLInputElement).value.trim();
                // Empty means "reset", which is a removal rather than an
                // empty string — `size=""` is not the same as no size.
                if (!raw) { apply(p.name, null); return; }
                apply(p.name, p.kind === 'number' ? Number(raw) : raw);
              }}
            />
          )}
        </Flex>
      ))}

      {note && <Text size="1" color="gray">{note}</Text>}
    </Flex>
  );
}
