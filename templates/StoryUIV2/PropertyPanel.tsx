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

import React, { useCallback, useEffect, useState } from 'react';
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
}

export function PropertyPanel({ apiBase, target, fileName, onApplied, onAskInstead }: PropertyPanelProps) {
  const [props, setProps] = useState<EditableProp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const component = target?.component ?? null;

  useEffect(() => {
    if (!component) { setProps([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${apiBase}/mcp/editable-props?component=${encodeURIComponent(component)}`);
        if (!res.ok) throw new Error('lookup failed');
        const data = await res.json();
        if (!cancelled) setProps(Array.isArray(data.props) ? data.props : []);
      } catch {
        if (!cancelled) setError('Could not read this component’s properties.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, component]);

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
          component,
          // The clicked element's position among all instances of this
          // component, which is what maps it to a JSX element in the source.
          occurrence: target?.occurrence ?? 0,
          prop,
          value,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setNote(data?.error || 'That change could not be applied.'); return; }

      /**
       * Say when one edit affects several elements.
       *
       * A list rendered with `.map()` is one JSX element and many DOM nodes,
       * so changing "this row's" prop changes every row. That is usually what
       * someone wants and always what they should be told, rather than
       * discovering it from the canvas.
       */
      if (typeof data.occurrencesInSource === 'number' && data.occurrencesInSource > 1) {
        setNote(`Applied. This ${component} appears ${data.occurrencesInSource} times in the source — check whether they all changed.`);
      }
      onApplied();
    } catch {
      setNote('That change could not be applied.');
    } finally {
      setPending(null);
    }
  }, [apiBase, component, fileName, target, onApplied]);

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
          <Badge color="green" variant="soft">{component}</Badge>
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
