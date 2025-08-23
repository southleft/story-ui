import { useCallback } from 'react';
import { useVisualBuilderStore } from '../store/visualBuilderStore';
import type { ComponentDefinition } from '../types/index';

export const useSelection = () => {
  const { selectedComponent, selectComponent } = useVisualBuilderStore();

  const handleComponentSelect = useCallback((component: ComponentDefinition) => {
    selectComponent({
      id: component.id,
      type: component.type,
      props: component.props
    });
  }, [selectComponent]);

  const handleCanvasClick = useCallback((event: React.MouseEvent) => {
    // If clicking on empty canvas area, deselect
    if (event.target === event.currentTarget) {
      selectComponent(null);
    }
  }, [selectComponent]);

  const isSelected = useCallback((componentId: string) => {
    return selectedComponent?.id === componentId;
  }, [selectedComponent]);

  return {
    selectedComponent,
    handleComponentSelect,
    handleCanvasClick,
    isSelected
  };
};