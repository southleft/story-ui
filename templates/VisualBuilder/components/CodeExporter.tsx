import React, { useMemo, useState } from 'react';
import { useBuilderStore } from '../store/builderStore';
import { generateCode } from '../utils/codeGenerator';

export function CodeExporter() {
  const { nodes, rootId } = useBuilderStore(s => ({ nodes: s.nodes, rootId: s.rootId }));
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    const root = nodes.get(rootId)!;
    return generateCode(root, nodes).code;
  }, [nodes, rootId]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ padding: 8, borderTop: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Exported JSX</strong>
        <button onClick={copy} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre style={{ maxHeight: 240, overflow: 'auto', background: '#0b0f19', color: '#cbd5e1', padding: 12, borderRadius: 6 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
