import React from 'react';
import type { ComponentNode, CanvasState } from './types';

/** Maps component string names to actual React components */
export type ComponentRegistry = Record<string, React.ComponentType<any>>;

interface RendererProps {
  state: CanvasState;
  registry: ComponentRegistry;
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

interface NodeRendererProps {
  node: ComponentNode;
  registry: ComponentRegistry;
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

// ── Error Boundary ──────────────────────────────────────────

interface ErrorBoundaryState { error: Error | null; componentName: string }

class NodeErrorBoundary extends React.Component<
  { componentName: string; children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentName: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          border: '1px dashed hsl(30 80% 50% / 0.6)',
          borderRadius: 4,
          padding: 8,
          margin: 4,
          fontSize: 12,
          color: 'hsl(30 80% 50%)',
          background: 'hsl(30 80% 50% / 0.05)',
        }}>
          Render error in <strong>{this.props.componentName}</strong>: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Component Resolution ────────────────────────────────────

/** Resolve a component name like "Card.Section" from the registry */
function resolveComponent(
  registry: ComponentRegistry,
  name: string
): React.ComponentType<any> | null {
  // Direct lookup first
  if (registry[name]) return registry[name];

  // Dot-notation: "Card.Section" → registry["Card"]["Section"]
  if (name.includes('.')) {
    const parts = name.split('.');
    let current: any = registry[parts[0]];
    for (let i = 1; i < parts.length && current; i++) {
      current = current[parts[i]];
    }
    if (current) return current;
  }

  return null;
}

// ── Node Renderer ───────────────────────────────────────────

function NodeRenderer({ node, registry, onNodeClick, selectedNodeId }: NodeRendererProps) {
  const Component = resolveComponent(registry, node.component);

  if (!Component) {
    return (
      <div style={{
        border: '1px dashed hsl(0 60% 50% / 0.5)',
        borderRadius: 4,
        padding: 8,
        margin: 4,
        fontSize: 12,
        color: 'hsl(0 60% 60%)',
        background: 'hsl(0 60% 50% / 0.05)',
      }}>
        Unknown component: <strong>{node.component}</strong>
      </div>
    );
  }

  // Build children: either nested ComponentNodes or text content
  let children: React.ReactNode = undefined;
  if (node.children.length > 0) {
    children = node.children.map(child => (
      <NodeRenderer
        key={child.id}
        node={child}
        registry={registry}
        onNodeClick={onNodeClick}
        selectedNodeId={selectedNodeId}
      />
    ));
  } else if (node.textContent !== undefined) {
    children = node.textContent;
  }

  // Strip reserved React props that could come from LLM output
  const safeProps = { ...node.props };
  delete (safeProps as any).key;
  delete (safeProps as any).ref;

  const element = (
    <NodeErrorBoundary componentName={node.component}>
      {React.createElement(Component, safeProps, children)}
    </NodeErrorBoundary>
  );

  // Wrap in a selection overlay if onNodeClick is provided
  if (onNodeClick) {
    return (
      <div
        onClick={(e) => { e.stopPropagation(); onNodeClick(node.id); }}
        style={{
          position: 'relative',
          outline: selectedNodeId === node.id ? '2px solid hsl(210 100% 50% / 0.6)' : undefined,
          outlineOffset: 2,
          borderRadius: 2,
          cursor: 'pointer',
        }}
      >
        {element}
      </div>
    );
  }

  return element;
}

// ── Top-Level Renderer ──────────────────────────────────────

/** Top-level canvas renderer — renders the full component tree */
export function ComponentRenderer({ state, registry, onNodeClick, selectedNodeId }: RendererProps) {
  if (state.root.length === 0) {
    return null;
  }

  return (
    <>
      {state.root.map(node => (
        <NodeRenderer
          key={node.id}
          node={node}
          registry={registry}
          onNodeClick={onNodeClick}
          selectedNodeId={selectedNodeId}
        />
      ))}
    </>
  );
}
