export type ComponentTypeName = 'Text' | 'Button' | 'Group' | 'Stack' | 'Card';

export interface ComponentNode {
  id: string;
  type: ComponentTypeName;
  props: Record<string, any>;
  children: string[];
  parentId?: string;
}
