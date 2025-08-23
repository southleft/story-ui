import { useCallback } from 'react';
import {
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import { useVisualBuilderStore } from '../store/visualBuilderStore';
import type { ComponentDefinition } from '../types/index';
import { getComponentConfig, CONTAINER_COMPONENTS } from '../config/componentRegistry';

export const useDragAndDrop = () => {
  const {
    setDraggedComponent,
    addComponent,
    moveComponent,
    moveComponentBetweenContainers,
    selectComponent
  } = useVisualBuilderStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const dragData = active.data.current;
    
    if (dragData?.isFromPalette) {
      // Dragging from component palette
      const config = getComponentConfig(dragData.componentType);
      if (config) {
        const component: ComponentDefinition = {
          id: `temp-${Date.now()}`,
          type: config.type,
          displayName: config.displayName,
          category: config.category,
          props: { ...config.defaultProps },
          children: []
        };
        setDraggedComponent(component);
      }
    } else {
      // Dragging existing component (reordering)
      setDraggedComponent(dragData?.component || null);
    }
  }, [setDraggedComponent]);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Handle drag over for visual feedback
    // Add visual feedback logic here if needed
    // This could include highlighting valid drop zones
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) {
      setDraggedComponent(null);
      return;
    }

    const dragData = active.data.current;
    const dropData = over.data.current;

    if (dragData?.isFromPalette) {
      // Adding new component from palette
      const config = getComponentConfig(dragData.componentType);
      if (config) {
        const component: ComponentDefinition = {
          id: `${config.type}-${Date.now()}`,
          type: config.type,
          displayName: config.displayName,
          category: config.category,
          props: { ...config.defaultProps },
          children: CONTAINER_COMPONENTS.includes(config.type) ? [] : undefined
        };

        // Determine the target for drop
        let targetId: string | undefined = undefined;
        let insertIndex: number | undefined = undefined;
        
        // Check if dropped on an insertion point
        if (dropData?.isInsertionPoint) {
          // Insert at specific index in specific parent (or root)
          targetId = dropData.parentId || undefined; // null means root level
          insertIndex = dropData.insertIndex;
        }
        // Check if dropped on a container drop zone
        else if (dropData?.isContainer && dropData?.componentId) {
          targetId = dropData.componentId;
          insertIndex = dropData.insertIndex; // Append to end
        }
        // Check if dropped on canvas
        else if (dropData?.isCanvas || over.id === 'canvas') {
          targetId = undefined; // Root level
        }
        // Check if over.id ends with '-drop' (container drop zone)
        else if (typeof over.id === 'string' && over.id.endsWith('-drop')) {
          targetId = over.id.replace('-drop', '');
        }

        addComponent(component, targetId, insertIndex);
        
        // Auto-select the new component
        selectComponent({
          id: component.id,
          type: component.type,
          props: component.props
        });
      }
    } else if (dragData?.component) {
      // Reordering existing components
      const componentId = dragData.component.id;
      
      if (dropData?.isInsertionPoint) {
        // Handle insertion point drops for precise positioning
        const targetParentId = dropData.parentId;
        const insertIndex = dropData.insertIndex;
        
        // Move to the specific insertion point
        moveComponentBetweenContainers(componentId, dragData.parentId || null, targetParentId, insertIndex);
      } else if (dropData?.isContainer && dropData?.componentId) {
        // Move to container - determine if it's between containers or within same container
        const targetContainerId = dropData.componentId;
        const insertIndex = dropData.insertIndex;
        
        // Use the enhanced move function for better container handling
        moveComponentBetweenContainers(componentId, dragData.parentId || null, targetContainerId, insertIndex);
      } else if (dropData?.isCanvas || over.id === 'canvas') {
        // Move to root level (canvas)
        moveComponentBetweenContainers(componentId, dragData.parentId || null, null, undefined);
      } else if (typeof over.id === 'string' && over.id.endsWith('-drop')) {
        // Handle container drop zones
        const containerId = over.id.replace('-drop', '');
        moveComponentBetweenContainers(componentId, dragData.parentId || null, containerId, undefined);
      } else {
        // Default: try to move relative to the over component
        const overComponentId = typeof over.id === 'string' ? over.id : String(over.id);
        if (overComponentId !== componentId) {
          moveComponent(componentId, overComponentId, undefined, 'after');
        }
      }
    }

    setDraggedComponent(null);
  }, [setDraggedComponent, addComponent, moveComponent, selectComponent]);

  const handleDragCancel = useCallback(() => {
    setDraggedComponent(null);
  }, [setDraggedComponent]);

  return {
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel
  };
};