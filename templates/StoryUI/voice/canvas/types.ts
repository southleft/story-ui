// Canvas types — design-system agnostic component tree representation

export type NodeId = string;

/** A single node in the component tree */
export interface ComponentNode {
  id: NodeId;
  /** Component name as known by the design system (e.g. "Card", "Button", "Card.Section") */
  component: string;
  /** Component props — must be JSON-serializable */
  props: Record<string, unknown>;
  /** Ordered child nodes */
  children: ComponentNode[];
  /** Text content for leaf nodes (alternative to children) */
  textContent?: string;
}

/** Full canvas state */
export interface CanvasState {
  root: ComponentNode[];
  version: number;
}

// ── Canvas Operations (LLM tool outputs) ────────────────────

export interface AddComponentOp {
  type: 'add_component';
  parentId: NodeId | null;
  position: number | 'end';
  node: ComponentNodeInput;
}

export interface RemoveComponentOp {
  type: 'remove_component';
  targetId: NodeId;
}

export interface UpdatePropsOp {
  type: 'update_props';
  targetId: NodeId;
  props: Record<string, unknown>;
  removeProps?: string[];
}

export interface MoveComponentOp {
  type: 'move_component';
  targetId: NodeId;
  newParentId: NodeId | null;
  position: number | 'end';
}

export interface ReplaceTreeOp {
  type: 'replace_tree';
  root: ComponentNodeInput[];
}

export interface SetTextOp {
  type: 'set_text';
  targetId: NodeId;
  textContent: string;
}

export type CanvasOperation =
  | AddComponentOp
  | RemoveComponentOp
  | UpdatePropsOp
  | MoveComponentOp
  | ReplaceTreeOp
  | SetTextOp;

/** Input shape for nodes (no id — assigned during apply) */
export interface ComponentNodeInput {
  component: string;
  props?: Record<string, unknown>;
  children?: ComponentNodeInput[];
  textContent?: string;
}

// ── Canvas History (undo/redo) ──────────────────────────────

export interface CanvasHistory {
  past: CanvasState[];
  present: CanvasState;
  future: CanvasState[];
}

export type CanvasAction =
  | { type: 'APPLY_OPERATIONS'; operations: CanvasOperation[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; state: CanvasState };

// ── Intent API types ────────────────────────────────────────

export interface IntentRequest {
  transcript: string;
  currentState: CanvasState;
  conversationHistory: Array<{ role: string; content: string }>;
  availableComponents?: string[];
}

export interface IntentResponse {
  operations: CanvasOperation[];
  explanation: string;
}
