import React, { useEffect } from 'react';
import { ComponentPalette } from './components/ComponentPalette';
import { Canvas } from './components/Canvas';
import { PropertyEditor } from './components/PropertyEditor';
import { CodeExporter } from './components/CodeExporter';
import { useBuilderStore } from './store/builderStore';

export default function VisualBuilder() {
  const addToRoot = useBuilderStore(s => (type: any) => s.addNode(s.rootId, type));
  const clear = useBuilderStore(s => s.clear);
  const deleteNode = useBuilderStore(s => s.deleteNode);
  const selectedId = useBuilderStore(s => s.selectedId);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteNode(selectedId);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, deleteNode]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #eee', display: 'flex', gap: 8 }}>
        <button onClick={() => clear()} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Clear</button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <ComponentPalette onAdd={addToRoot as any} />
        <Canvas />
        <PropertyEditor />
      </div>
      <CodeExporter />
    </div>
  );
}
