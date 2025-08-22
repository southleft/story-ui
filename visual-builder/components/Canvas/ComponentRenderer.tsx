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
  const isContainer = ['Container', 'Group', 'Stack', 'Card', 'Card.Section'].includes(component.type);
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

    const commonProps = {
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        handleComponentSelect(component);
      },
      style: {
        cursor: 'pointer',
        ...props.style
      }
    };

    switch (type) {
      case 'Button':
        return (
          <Button
            {...commonProps}
            variant={props.variant}
            size={props.size}
            color={props.color}
            disabled={props.disabled}
          >
            {props.children}
          </Button>
        );

      case 'TextInput':
        return (
          <TextInput
            {...commonProps}
            placeholder={props.placeholder}
            label={props.label}
            size={props.size}
            disabled={props.disabled}
          />
        );

      case 'Text':
        return (
          <Text
            {...commonProps}
            size={props.size}
            fw={props.weight === 'bold' ? 700 : props.weight === 'lighter' ? 300 : 400}
            c={props.color || undefined}
          >
            {props.children}
          </Text>
        );

      case 'Title':
        return (
          <Title
            {...commonProps}
            order={Number(props.order) as 1 | 2 | 3 | 4 | 5 | 6}
            c={props.color || undefined}
          >
            {props.children}
          </Title>
        );

      case 'Container':
        return (
          <Container
            {...commonProps}
            size={props.size}
            fluid={props.fluid}
            ref={dropRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '100px' : 'auto',
              border: isOver ? '2px dashed #3b82f6' : selected ? '2px solid #3b82f6' : '1px dashed #e9ecef',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: isOver ? '#f0f9ff' : 'transparent'
            }}
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
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Container>
        );

      case 'Group':
        return (
          <Group
            {...commonProps}
            justify={props.justify}
            align={props.align}
            gap={props.gap}
            ref={dropRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '80px' : 'auto',
              border: isOver ? '2px dashed #3b82f6' : selected ? '2px solid #3b82f6' : '1px dashed #e9ecef',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: isOver ? '#f0f9ff' : 'transparent'
            }}
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
              <Text c="dimmed">Drop components here</Text>
            )}
          </Group>
        );

      case 'Stack':
        return (
          <Stack
            {...commonProps}
            gap={props.gap}
            align={props.align}
            ref={dropRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '100px' : 'auto',
              border: isOver ? '2px dashed #3b82f6' : selected ? '2px solid #3b82f6' : '1px dashed #e9ecef',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: isOver ? '#f0f9ff' : 'transparent'
            }}
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
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Stack>
        );

      case 'Card':
        return (
          <Card
            {...commonProps}
            shadow={props.shadow}
            padding={props.padding}
            radius={props.radius}
            withBorder={props.withBorder}
            ref={dropRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '120px' : 'auto',
              border: isOver ? '2px dashed #3b82f6' : 
                     selected ? '2px solid #3b82f6' : 
                     props.withBorder ? undefined : '1px dashed #e9ecef'
            }}
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
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Card>
        );

      case 'Card.Section':
        return (
          <CardSection
            {...commonProps}
            inheritPadding={props.inheritPadding}
            withBorder={props.withBorder}
            ref={dropRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '80px' : 'auto',
              border: isOver ? '2px dashed #3b82f6' : 
                     selected ? '2px solid #3b82f6' : undefined,
              padding: props.inheritPadding ? undefined : '1rem'
            }}
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
              <Text c="dimmed" ta="center">Drop card content here</Text>
            )}
          </CardSection>
        );

      default:
        return (
          <Box {...commonProps}>
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