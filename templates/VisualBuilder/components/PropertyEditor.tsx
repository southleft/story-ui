import React from 'react';
import { useBuilderStore } from '../store/builderStore';
import { registry } from '../utils/componentRegistry';

export function PropertyEditor() {
  const { nodes, selectedId, updateProps } = useBuilderStore(s => ({ nodes: s.nodes, selectedId: s.selectedId, updateProps: s.updateProps }));

  const selected = selectedId ? nodes.get(selectedId) : null;
  const schema = selected ? registry[selected.type].propSchema : [];

  if (!selected) return (
    <div style={{ width: 280, borderLeft: '1px solid #eee', padding: 12 }}>
      <div style={{ color: '#999' }}>Select a component to edit its properties</div>
    </div>
  );

  return (
    <div style={{ width: 280, borderLeft: '1px solid #eee', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 600 }}>{selected.type}</div>
      {schema.map(field => {
        const value = selected.props?.[field.key];
        const onChange = (val: any) => updateProps(selected.id, { [field.key]: val });

        if (field.type === 'string' || field.type === 'color') {
          return (
            <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>{field.label ?? field.key}</span>
              <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
            </label>
          );
        }
        if (field.type === 'number') {
          return (
            <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>{field.label ?? field.key}</span>
              <input type="number" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} style={{ padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
            </label>
          );
        }
        if (field.type === 'boolean') {
          return (
            <label key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
              <span style={{ fontSize: 12, color: '#555' }}>{field.label ?? field.key}</span>
            </label>
          );
        }
        if (field.type === 'enum' && field.options) {
          return (
            <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>{field.label ?? field.key}</span>
              <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #ddd' }}>
                <option value="">(none)</option>
                {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </label>
          );
        }
        return null;
      })}
    </div>
  );
}
