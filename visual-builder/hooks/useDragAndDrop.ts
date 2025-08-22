import { useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useVisualBuilderStore } from '../store/visualBuilderStore';
import { ComponentDefinition } from '../types';
import { getComponentConfig } from '../config/componentRegistry';

export const useDragAndDrop = () => {
  const {
    setDraggedComponent,
    addComponent,
    moveComponent,
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

  const handleDragOver = useCallback((event: DragOverEvent) => {
    // Handle drag over for visual feedback
    // Could add hover effects here
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
          children: config.type === 'Container' || config.type === 'Group' || 
                   config.type === 'Stack' || config.type === 'Card' ? [] : undefined
        };

        // Add to canvas or as child of container
        const targetId = dropData?.isContainer ? dropData.componentId : undefined;
        addComponent(component, targetId);
        
        // Auto-select the new component
        selectComponent({
          id: component.id,
          type: component.type,
          props: component.props
        });
      }
    } else if (dragData?.component && dropData?.componentId) {
      // Reordering existing components
      moveComponent(dragData.component.id, dropData.componentId);
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