import { create } from 'zustand';
import { nanoid } from '../../test-storybooks/mantine-storybook/src/utils/nanoid';
import type { ComponentNode, ComponentTypeName } from '../types';
import { registry } from '../utils/componentRegistry';

interface BuilderState {
  nodes: Map<string, ComponentNode>;
  rootId: string;
  selectedId: string | null;
  addNode: (parentId: string, type: ComponentTypeName, index?: number) => string;
  moveNode: (nodeId: string, newParentId: string, index?: number) => void;
  updateProps: (nodeId: string, newProps: Partial<ComponentNode['props']>) => void;
  deleteNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  clear: () => void;
}

function createInitialState(): { nodes: Map<string, ComponentNode>; rootId: string } {
  const rootId = 'root';
  const root: ComponentNode = {
    id: rootId,
    type: 'Stack',
    props: { gap: 'md' },
    children: [],
  };
  return { nodes: new Map([[rootId, root]]), rootId };
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  ...createInitialState(),
  selectedId: null,

  addNode: (parentId, type, index) => {
    const id = nanoid();
    set(state => {
      const nodes = new Map(state.nodes);
      const parent = nodes.get(parentId);
      if (!parent) return state;
      const defaults = registry[type]?.defaults ?? {};
      const child: ComponentNode = { id, type, props: { ...defaults }, children: [], parentId };
      nodes.set(id, child);
      const newChildren = [...parent.children];
      if (index !== undefined && index >= 0 && index <= newChildren.length) {
        newChildren.splice(index, 0, id);
      } else {
        newChildren.push(id);
      }
      nodes.set(parentId, { ...parent, children: newChildren });
      return { ...state, nodes, selectedId: id };
    });
    return id;
  },

  moveNode: (nodeId, newParentId, index) => {
    set(state => {
      const nodes = new Map(state.nodes);
      const node = nodes.get(nodeId);
      const newParent = nodes.get(newParentId);
      if (!node || !newParent) return state;

      // Remove from old parent
      if (node.parentId) {
        const oldParent = nodes.get(node.parentId);
        if (oldParent) {
          nodes.set(node.parentId, {
            ...oldParent,
            children: oldParent.children.filter(id => id !== nodeId),
          });
        }
      }

      // Add to new parent
      const newChildren = [...newParent.children];
      if (index !== undefined && index >= 0 && index <= newChildren.length) {
        newChildren.splice(index, 0, nodeId);
      } else {
        newChildren.push(nodeId);
      }
      nodes.set(newParentId, { ...newParent, children: newChildren });
      nodes.set(nodeId, { ...node, parentId: newParentId });

      return { ...state, nodes };
    });
  },

  updateProps: (nodeId, newProps) => {
    set(state => {
      const nodes = new Map(state.nodes);
      const node = nodes.get(nodeId);
      if (!node) return state;
      nodes.set(nodeId, { ...node, props: { ...node.props, ...newProps } });
      return { ...state, nodes };
    });
  },

  deleteNode: (nodeId) => {
    set(state => {
      const nodes = new Map(state.nodes);
      const node = nodes.get(nodeId);
      if (!node) return state;

      // Prevent deleting root
      if (nodeId === state.rootId) return state;

      // Remove from parent
      if (node.parentId) {
        const parent = nodes.get(node.parentId);
        if (parent) {
          nodes.set(node.parentId, {
            ...parent,
            children: parent.children.filter(id => id !== nodeId),
          });
        }
      }

      // Recursively delete children
      const stack = [nodeId];
      while (stack.length) {
        const current = stack.pop()!;
        const currentNode = nodes.get(current);
        if (currentNode) {
          stack.push(...currentNode.children);
          nodes.delete(current);
        }
      }

      const selectedId = state.selectedId === nodeId ? null : state.selectedId;
      return { ...state, nodes, selectedId };
    });
  },

  selectNode: (nodeId) => set({ selectedId: nodeId }),

  clear: () => set(createInitialState()),
}));
