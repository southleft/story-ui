// Pure functions for applying canvas operations to an immutable tree.
// No framework dependencies — testable standalone.

import type {
  CanvasState,
  CanvasOperation,
  ComponentNode,
  ComponentNodeInput,
  NodeId,
  CanvasHistory,
  CanvasAction,
} from './types';

// ── ID generation ───────────────────────────────────────────

let counter = 0;
export function generateNodeId(): NodeId {
  return `n_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

// ── Assign IDs to an input tree ─────────────────────────────

export function hydrateNode(input: ComponentNodeInput): ComponentNode {
  return {
    id: (input as any).id || generateNodeId(),
    component: input.component,
    props: input.props || {},
    children: (input.children || []).map(hydrateNode),
    textContent: input.textContent,
  };
}

// ── Tree traversal helpers ──────────────────────────────────

function findNode(
  nodes: ComponentNode[],
  id: NodeId
): ComponentNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function mapTree(
  nodes: ComponentNode[],
  fn: (node: ComponentNode) => ComponentNode | null
): ComponentNode[] {
  const result: ComponentNode[] = [];
  for (const node of nodes) {
    const mapped = fn(node);
    if (mapped) {
      result.push({
        ...mapped,
        children: mapTree(mapped.children, fn),
      });
    }
  }
  return result;
}

function removeFromTree(nodes: ComponentNode[], targetId: NodeId): ComponentNode[] {
  return nodes
    .filter(n => n.id !== targetId)
    .map(n => ({ ...n, children: removeFromTree(n.children, targetId) }));
}

function insertChild(
  nodes: ComponentNode[],
  parentId: NodeId | null,
  position: number | 'end',
  newNode: ComponentNode
): ComponentNode[] {
  // Insert at root level
  if (parentId === null) {
    const copy = [...nodes];
    if (position === 'end' || position >= copy.length) {
      copy.push(newNode);
    } else {
      copy.splice(Math.max(0, position), 0, newNode);
    }
    return copy;
  }

  // Insert into a parent's children
  return nodes.map(node => {
    if (node.id === parentId) {
      const children = [...node.children];
      if (position === 'end' || position >= children.length) {
        children.push(newNode);
      } else {
        children.splice(Math.max(0, position), 0, newNode);
      }
      return { ...node, children };
    }
    return { ...node, children: insertChild(node.children, parentId, position, newNode) };
  });
}

// ── Apply a single operation ────────────────────────────────

function applySingle(state: CanvasState, op: CanvasOperation): CanvasState {
  switch (op.type) {
    case 'replace_tree': {
      return {
        root: op.root.map(hydrateNode),
        version: state.version + 1,
      };
    }

    case 'add_component': {
      const newNode = hydrateNode(op.node);
      return {
        root: insertChild(state.root, op.parentId, op.position, newNode),
        version: state.version + 1,
      };
    }

    case 'remove_component': {
      return {
        root: removeFromTree(state.root, op.targetId),
        version: state.version + 1,
      };
    }

    case 'update_props': {
      const root = mapTree(state.root, node => {
        if (node.id !== op.targetId) return node;
        const newProps = { ...node.props, ...op.props };
        if (op.removeProps) {
          for (const key of op.removeProps) {
            delete newProps[key];
          }
        }
        return { ...node, props: newProps };
      });
      return { root, version: state.version + 1 };
    }

    case 'move_component': {
      const target = findNode(state.root, op.targetId);
      if (!target) return state;
      const withoutTarget = removeFromTree(state.root, op.targetId);
      return {
        root: insertChild(withoutTarget, op.newParentId, op.position, target),
        version: state.version + 1,
      };
    }

    case 'set_text': {
      const root = mapTree(state.root, node => {
        if (node.id !== op.targetId) return node;
        return { ...node, textContent: op.textContent };
      });
      return { root, version: state.version + 1 };
    }

    default:
      return state;
  }
}

// ── Apply multiple operations sequentially ──────────────────

export function applyOperations(
  state: CanvasState,
  operations: CanvasOperation[]
): CanvasState {
  return operations.reduce(applySingle, state);
}

// ── Empty state ─────────────────────────────────────────────

export function emptyState(): CanvasState {
  return { root: [], version: 0 };
}

export function emptyHistory(): CanvasHistory {
  return {
    past: [],
    present: emptyState(),
    future: [],
  };
}

// ── Reducer for useReducer ──────────────────────────────────

export function canvasReducer(state: CanvasHistory, action: CanvasAction): CanvasHistory {
  switch (action.type) {
    case 'APPLY_OPERATIONS': {
      if (action.operations.length === 0) return state;
      const newPresent = applyOperations(state.present, action.operations);
      return {
        past: [...state.past, state.present].slice(-50), // cap undo at 50
        present: newPresent,
        future: [],
      };
    }

    case 'UNDO': {
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    }

    case 'CLEAR':
      return emptyHistory();

    case 'LOAD':
      return {
        past: [],
        present: action.state,
        future: [],
      };

    default:
      return state;
  }
}
