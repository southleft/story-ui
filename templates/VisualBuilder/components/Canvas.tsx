import React from 'react';
import { useBuilderStore } from '../store/builderStore';
import { renderNode } from '../utils/componentRegistry';

function Tree({ nodeId }: { nodeId: string }) {
  const { nodes, selectedId, selectNode } = useBuilderStore(s => ({ nodes: s.nodes, selectedId: s.selectedId, selectNode: s.selectNode }));
  const node = nodes.get(nodeId)!;
  const children = node.children.map(id => <Tree key={id} nodeId={id} />);
  const element = renderNode(node, <>{children}</>);

  const outline = selectedId === nodeId ? '2px solid #4c6ef5' : '1px dashed #ddd';
  return (
    <div style={{ position: 'relative', outline, padding: 4, margin: 4 }} onClick={(e) => { e.stopPropagation(); selectNode(nodeId); }}>
      {element}
    </div>
  );
}

export function Canvas() {
  const { rootId } = useBuilderStore(s => ({ rootId: s.rootId }));
  return (
    <div style={{ flex: 1, padding: 12, background: '#fafafa', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()}>
        <Tree nodeId={rootId} />
      </div>
    </div>
  );
}
