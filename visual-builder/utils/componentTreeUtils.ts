import type { ComponentDefinition } from '../types/index';

export interface ComponentWithParent {
  component: ComponentDefinition;
  parent: ComponentDefinition | null;
  index: number;
}

/**
 * Find a component and its parent in the component tree
 */
export const findComponentWithParent = (
  components: ComponentDefinition[], 
  targetId: string, 
  parent: ComponentDefinition | null = null
): ComponentWithParent | null => {
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    
    if (component.id === targetId) {
      return {
        component,
        parent,
        index: i
      };
    }
    
    if (component.children && component.children.length > 0) {
      const result = findComponentWithParent(component.children, targetId, component);
      if (result) {
        return result;
      }
    }
  }
  
  return null;
};

/**
 * Remove a component from the tree and return the updated tree and removed component
 */
export const removeComponentFromTree = (
  components: ComponentDefinition[], 
  targetId: string
): { 
  components: ComponentDefinition[], 
  removed: ComponentDefinition | null 
} => {
  for (let i = 0; i < components.length; i++) {
    if (components[i].id === targetId) {
      const removed = components[i];
      return {
        components: [...components.slice(0, i), ...components.slice(i + 1)],
        removed
      };
    }
    
    if (components[i].children && components[i].children!.length > 0) {
      const result = removeComponentFromTree(components[i].children!, targetId);
      if (result.removed) {
        return {
          components: components.map(comp => 
            comp.id === components[i].id 
              ? { ...comp, children: result.components }
              : comp
          ),
          removed: result.removed
        };
      }
    }
  }
  
  return { components, removed: null };
};

/**
 * Insert a component at a specific location in the tree
 */
export const insertComponentInTree = (
  components: ComponentDefinition[], 
  component: ComponentDefinition, 
  parentId: string | null, 
  index?: number
): ComponentDefinition[] => {
  if (!parentId) {
    // Insert at root level
    if (index !== undefined) {
      return [...components.slice(0, index), component, ...components.slice(index)];
    }
    return [...components, component];
  }

  // Insert into specific parent
  return components.map(comp => {
    if (comp.id === parentId) {
      const children = comp.children || [];
      const newChildren = index !== undefined 
        ? [...children.slice(0, index), component, ...children.slice(index)]
        : [...children, component];
      return { ...comp, children: newChildren };
    }
    
    if (comp.children) {
      return { 
        ...comp, 
        children: insertComponentInTree(comp.children, component, parentId, index) 
      };
    }
    
    return comp;
  });
};

/**
 * Check if a component is a container (can accept children)
 */
export const isContainerComponent = (componentType: string): boolean => {
  const containerTypes = [
    'Container', 'Group', 'Stack', 'Card', 'Paper', 'Box', 
    'Flex', 'Grid', 'GridCol', 'SimpleGrid', 'Tabs'
  ];
  return containerTypes.includes(componentType);
};

/**
 * Get all parent IDs of a component (path from root to component)
 */
export const getComponentPath = (
  components: ComponentDefinition[], 
  targetId: string,
  path: string[] = []
): string[] | null => {
  for (const component of components) {
    if (component.id === targetId) {
      return path;
    }
    
    if (component.children && component.children.length > 0) {
      const result = getComponentPath(component.children, targetId, [...path, component.id]);
      if (result) {
        return result;
      }
    }
  }
  
  return null;
};

/**
 * Check if one component is a descendant of another
 */
export const isDescendant = (
  components: ComponentDefinition[], 
  ancestorId: string, 
  descendantId: string
): boolean => {
  const path = getComponentPath(components, descendantId);
  return path ? path.includes(ancestorId) : false;
};