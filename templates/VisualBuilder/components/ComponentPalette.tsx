import React, { useMemo, useState } from 'react';
import { registry } from '../utils/componentRegistry';
import type { ComponentTypeName } from '../types';

interface Props {
  onAdd: (type: ComponentTypeName) => void;
}

export function ComponentPalette({ onAdd }: Props) {
  const [query, setQuery] = useState('');
  const items = useMemo(() => Object.entries(registry).map(([key, entry]) => ({ key: key as ComponentTypeName, ...entry })), []);
  const filtered = items.filter(i => i.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ width: 260, borderRight: '1px solid #eee', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        placeholder="Search components"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ padding: 8, borderRadius: 6, border: '1px solid #ddd' }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
        {filtered.map(item => (
          <button key={item.key}
            onClick={() => onAdd(item.key)}
            style={{ textAlign: 'left', padding: 8, borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
