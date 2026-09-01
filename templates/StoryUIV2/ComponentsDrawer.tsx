/**
 * What "your design system" means here, listed.
 *
 * The home screen says "Composed from Mantine" and nothing else; a first-time
 * user has no way to learn which components the server actually found, where
 * they come from, or how much is known about them — so they cannot tell a
 * component the model ignored from one it never had. This is the inventory,
 * read from the same discovery the generator uses.
 *
 * Inventory only. Excluding components is a later change.
 */

import { apiFetch } from './api';
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Dialog, Flex, ScrollArea, Text, TextField } from '@radix-ui/themes';

export interface InventoryRow {
  name: string;
  importPath: string;
  category: string;
  propCount: number;
  hasDescription: boolean;
  description: string;
  source: 'npm' | 'local';
}

interface ComponentsDrawerProps {
  apiBase: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with a component name the user clicked, to put in the composer. */
  onInsert: (name: string) => void;
}

export const ComponentsDrawer: React.FC<ComponentsDrawerProps> = ({ apiBase, open, onOpenChange, onInsert }) => {
  const [rows, setRows] = useState<InventoryRow[] | null>(null);
  const [importPath, setImportPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const res = await apiFetch(`${apiBase}/mcp/components/inventory`);
        if (!res.ok) throw new Error(res.status === 404
          ? 'This server does not list its components yet — update @tpitre/story-ui and restart it.'
          : `The server could not list components (${res.status}).`);
        const data = await res.json();
        if (cancelled) return;
        setRows(Array.isArray(data?.components) ? data.components : []);
        setImportPath(typeof data?.importPath === 'string' ? data.importPath : '');
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not reach the server.');
      }
    })();
    return () => { cancelled = true; };
  }, [open, apiBase]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q));
  }, [rows, query]);

  const localCount = rows?.filter(r => r.source === 'local').length ?? 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px" className="suiw-components">
        <Dialog.Title>Components</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {rows
            ? `${rows.length} discovered${importPath ? ` from ${importPath}` : ''}${localCount ? ` · ${localCount} local` : ''}. Click a name to use it in your prompt.`
            : 'What the server discovered in this project.'}
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="3">
          <TextField.Root
            size="2"
            placeholder="Search by name, category or description"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search components"
            autoFocus
          />

          {error && <Text size="2" color="red">{error}</Text>}
          {!error && !rows && <Text size="2" color="gray">Reading the design system…</Text>}
          {rows && rows.length === 0 && (
            <Text size="2" color="gray">
              Nothing was discovered. Check `importPath` in story-ui.config.js and that the package is installed.
            </Text>
          )}
          {rows && rows.length > 0 && filtered.length === 0 && (
            <Text size="2" color="gray">No component matches “{query.trim()}”.</Text>
          )}

          {filtered.length > 0 && (
            <ScrollArea style={{ maxHeight: '52vh' }}>
              <div role="list" aria-label="Discovered components">
                {filtered.map(r => (
                  <div key={`${r.importPath}:${r.name}`} className="suiw-inventory-row" role="listitem">
                    <Flex direction="column" gap="1" minWidth="0">
                      <Flex align="center" gap="2">
                        <span
                          className={`suiw-inventory-dot${r.hasDescription ? '' : ' suiw-inventory-dot--empty'}`}
                          title={r.hasDescription ? 'Has a description' : 'No description found'}
                          aria-hidden
                        />
                        <button
                          type="button"
                          className="suiw-inventory-name"
                          onClick={() => onInsert(r.name)}
                          title={`Add “using ${r.name}” to your prompt`}
                        >
                          <Text size="2" weight="medium">{r.name}</Text>
                        </button>
                        {r.source === 'local' && (
                          <Badge size="1" color="jade" variant="soft">local</Badge>
                        )}
                      </Flex>
                      {r.hasDescription && (
                        <Text size="1" color="gray" className="suiw-ellipsis" title={r.description}>
                          {r.description}
                        </Text>
                      )}
                    </Flex>
                    <Text size="1" color="gray">{r.category}</Text>
                    <Text size="1" color="gray" style={{ whiteSpace: 'nowrap' }}>
                      {r.propCount} prop{r.propCount === 1 ? '' : 's'}
                    </Text>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {rows && rows.length > 0 && (
            <Text size="1" color="gray">
              {filtered.length === rows.length ? `${rows.length} components` : `${filtered.length} of ${rows.length}`}
              {' · '}a dot marks a component the server has a description for.
            </Text>
          )}
        </Flex>

        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button size="2" variant="soft" color="gray">Close</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default ComponentsDrawer;
