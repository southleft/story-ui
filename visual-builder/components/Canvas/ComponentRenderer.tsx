import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { 
  Box, 
  Button, 
  TextInput, 
  Text, 
  Title, 
  Container, 
  Group, 
  Stack, 
  Card 
} from '@mantine/core';

// Destructure Card.Section for use
const CardSection = Card.Section;
import { ComponentDefinition } from '../../types';
import { useSelection } from '../../hooks/useSelection';

// Canvas-specific styling constants
const CANVAS_STYLES = {
  dropIndicator: {
    border: '2px dashed #3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.05)'
  },
  selectedIndicator: {
    border: '2px solid #3b82f6'
  },
  emptyIndicator: {
    border: '1px dashed #e9ecef'
  },
  overlay: {
    position: 'absolute' as const,
    pointerEvents: 'none' as const,
    zIndex: 0
  }
};

interface ComponentRendererProps {
  component: ComponentDefinition;
  index?: number;
  isChild?: boolean;
}

export const ComponentRenderer: React.FC<ComponentRendererProps> = ({
  component,
  index = 0,
  isChild = false
}) => {
  const { handleComponentSelect, isSelected } = useSelection();
  const selected = isSelected(component.id);

  // Draggable setup for existing components
  const {
    attributes,
    listeners,
    setNodeRef: dragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: component.id,
    data: {
      component,
      isFromCanvas: true
    }
  });

  // Droppable setup for container components
  const isContainer = ['Container', 'Group', 'Stack', 'Card', 'Card.Section', 'CardSection'].includes(component.type);
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `${component.id}-drop`,
    data: {
      isContainer: true,
      componentId: component.id
    },
    disabled: !isContainer
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  const renderComponent = () => {
    const { type, props, children } = component;

    // Separate canvas-specific behavior from component styling
    const canvasInteraction = {
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        handleComponentSelect(component);
      }
    };

    // Keep component styling pure for better consistency with generated output
    const componentStyle = {
      cursor: 'pointer',
      ...props.style
    };

    switch (type) {
      case 'Button':
        return (
          <Button
            {...canvasInteraction}
            variant={props.variant}
            size={props.size}
            color={props.color}
            disabled={props.disabled}
            style={componentStyle}
          >
            {props.children}
          </Button>
        );

      case 'TextInput':
        return (
          <TextInput
            {...canvasInteraction}
            placeholder={props.placeholder}
            label={props.label}
            size={props.size}
            disabled={props.disabled}
            style={componentStyle}
          />
        );

      case 'Text':
        return (
          <Text
            {...canvasInteraction}
            size={props.size}
            fw={props.weight === 'bold' ? 700 : props.weight === 'lighter' ? 300 : 400}
            c={props.color || undefined}
            style={componentStyle}
          >
            {props.children}
          </Text>
        );

      case 'Title':
        return (
          <Title
            {...canvasInteraction}
            order={Number(props.order) as 1 | 2 | 3 | 4 | 5 | 6}
            c={props.color || undefined}
            style={componentStyle}
          >
            {props.children}
          </Title>
        );

      case 'Container':
        return (
          <Container
            {...canvasInteraction}
            size={props.size}
            fluid={props.fluid}
            ref={dropRef}
            style={{
              ...componentStyle,
              // Canvas-specific visual aids (these don't affect generated code)
              position: 'relative',
              minHeight: children?.length === 0 ? '100px' : 'auto'
            }}
            // Apply canvas visual indicators as overlay
            data-canvas-container="true"
          >
            {children?.map((child, idx) => (
              <ComponentRenderer
                key={child.id}
                component={child}
                index={idx}
                isChild={true}
              />
            ))}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center" style={{ position: 'relative', zIndex: 1 }}>
                Drop components here
              </Text>
            )}
            {/* Canvas-specific visual indicators */}
            {(isOver || selected || children?.length === 0) && (
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  border: isOver ? '2px dashed #3b82f6' : selected ? '2px solid #3b82f6' : '1px dashed #e9ecef',
                  borderRadius: '8px',
                  backgroundColor: isOver ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                  pointerEvents: 'none',
                  zIndex: 0
                }}
              />
            )}
          </Container>
        );

      case 'Group':
        return (
          <Group
            {...canvasInteraction}
            justify={props.justify}
            align={props.align}
            gap={props.gap}
            ref={dropRef}
            style={{
              ...componentStyle,
              position: 'relative',
              minHeight: children?.length === 0 ? '80px' : 'auto'
            }}
            data-canvas-container="true"
          >
            {children?.map((child, idx) => (
              <ComponentRenderer
                key={child.id}
                component={child}
                index={idx}
                isChild={true}
              />
            ))}
            {children?.length === 0 && (
              <Text c="dimmed" style={{ position: 'relative', zIndex: 1 }}>
                Drop components here
              </Text>
            )}
            {/* Canvas-specific visual indicators */}
            {(isOver || selected || children?.length === 0) && (
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  border: isOver ? '2px dashed #3b82f6' : selected ? '2px solid #3b82f6' : '1px dashed #e9ecef',
                  borderRadius: '8px',
                  backgroundColor: isOver ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                  pointerEvents: 'none',
                  zIndex: 0
                }}
              />
            )}
          </Group>
        );

      case 'Stack':
        return (
          <Stack
            {...canvasInteraction}
            gap={props.gap}
            align={props.align}
            ref={dropRef}
            style={{
              ...componentStyle,
              position: 'relative',
              minHeight: children?.length === 0 ? '100px' : 'auto'
            }}
            data-canvas-container="true"
          >
            {children?.map((child, idx) => (
              <ComponentRenderer
                key={child.id}
                component={child}
                index={idx}
                isChild={true}
              />
            ))}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center" style={{ position: 'relative', zIndex: 1 }}>
                Drop components here
              </Text>
            )}
            {/* Canvas-specific visual indicators */}
            {(isOver || selected || children?.length === 0) && (
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  border: isOver ? '2px dashed #3b82f6' : selected ? '2px solid #3b82f6' : '1px dashed #e9ecef',
                  borderRadius: '8px',
                  backgroundColor: isOver ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                  pointerEvents: 'none',
                  zIndex: 0
                }}
              />
            )}
          </Stack>
        );

      case 'Card':
        return (
          <Card
            {...canvasInteraction}
            shadow={props.shadow}
            padding={props.padding}
            radius={props.radius}
            withBorder={props.withBorder}
            ref={dropRef}
            style={{
              ...componentStyle,
              position: 'relative',
              minHeight: children?.length === 0 ? '120px' : 'auto'
            }}
            data-canvas-container="true"
          >
            {children?.map((child, idx) => (
              <ComponentRenderer
                key={child.id}
                component={child}
                index={idx}
                isChild={true}
              />
            ))}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center" style={{ position: 'relative', zIndex: 1 }}>
                Drop components here
              </Text>
            )}
            {/* Canvas-specific visual indicators - only show when needed and don't override Card border */}
            {(isOver || selected) && (
              <Box
                style={{
                  position: 'absolute',
                  top: -2,
                  left: -2,
                  right: -2,
                  bottom: -2,
                  border: isOver ? '2px dashed #3b82f6' : '2px solid #3b82f6',
                  borderRadius: 'calc(var(--mantine-radius-md) + 2px)',
                  backgroundColor: isOver ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                  pointerEvents: 'none',
                  zIndex: 0
                }}
              />
            )}
            {/* Empty state indicator for Cards without withBorder */}
            {children?.length === 0 && !props.withBorder && (
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  border: '1px dashed #e9ecef',
                  borderRadius: 'var(--mantine-radius-md)',
                  pointerEvents: 'none',
                  zIndex: 0
                }}
              />
            )}
          </Card>
        );

      case 'Card.Section':
      case 'CardSection': // Handle both variants for backward compatibility
        return (
          <CardSection
            {...canvasInteraction}
            inheritPadding={props.inheritPadding}
            withBorder={props.withBorder}
            ref={dropRef}
            style={{
              ...componentStyle,
              position: 'relative',
              minHeight: children?.length === 0 ? '80px' : 'auto'
            }}
            data-canvas-container="true"
          >
            {children?.map((child, idx) => (
              <ComponentRenderer
                key={child.id}
                component={child}
                index={idx}
                isChild={true}
              />
            ))}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center" style={{ position: 'relative', zIndex: 1 }}>
                Drop card content here
              </Text>
            )}
            {/* Canvas-specific visual indicators */}
            {(isOver || selected || children?.length === 0) && (
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  border: isOver ? '2px dashed #3b82f6' : selected ? '2px solid #3b82f6' : '1px dashed #e9ecef',
                  borderRadius: '4px',
                  backgroundColor: isOver ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                  pointerEvents: 'none',
                  zIndex: 0
                }}
              />
            )}
          </CardSection>
        );

      default:
        return (
          <Box {...canvasInteraction} style={componentStyle}>
            Unknown component: {type}
          </Box>
        );
    }
  };

  return (
    <Box
      ref={dragRef}
      style={{
        ...style,
        border: selected && !isContainer ? '2px solid #3b82f6' : 'none',
        borderRadius: selected ? '4px' : '0',
        padding: selected && !isContainer ? '2px' : '0',
        outline: 'none'
      }}
      {...attributes}
      {...listeners}
    >
      {renderComponent()}
    </Box>
  );
};