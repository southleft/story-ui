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
  Card,
  Badge,
  Anchor,
  Image,
  Divider,
  Paper,
  Alert,
  PasswordInput,
  Textarea,
  Select,
  MultiSelect,
  NumberInput,
  Checkbox,
  Radio,
  Switch,
  Flex,
  Grid,
  GridCol,
  SimpleGrid,
  Code,
  Mark,
  Blockquote,
  Avatar,
  Indicator,
  Breadcrumbs,
  Tabs,
  Loader,
  Progress,
  RingProgress,
  Tooltip,
  Popover
} from '@mantine/core';
import type { ComponentDefinition } from '../../types/index';
import { useSelection } from '../../hooks/useSelection';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { CONTAINER_COMPONENTS, MANTINE_COMPONENTS } from '../../config/componentRegistry';

// Helper function to extract spacing props from component props
const extractSpacingProps = (props: Record<string, any>) => {
  const spacingProps: Record<string, any> = {};
  
  // Extract spacing properties and filter out undefined values
  ['m', 'mt', 'mr', 'mb', 'ml', 'mx', 'my', 'p', 'pt', 'pr', 'pb', 'pl', 'px', 'py'].forEach(key => {
    if (props[key] !== undefined && props[key] !== null && props[key] !== '') {
      spacingProps[key] = props[key];
    }
  });
  
  return spacingProps;
};

interface ComponentRendererProps {
  component: ComponentDefinition;
  index?: number;
  isChild?: boolean;
  parentId?: string | null;
  preserveOriginalLayout?: boolean; // New prop to preserve parsed story layouts
}

interface DropZoneProps {
  parentId: string | null;
  insertIndex: number;
  isVisible: boolean;
}

const DropZone: React.FC<DropZoneProps> = ({ parentId, insertIndex, isVisible }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `dropzone-${parentId || 'root'}-${insertIndex}`,
    data: {
      isInsertionPoint: true,
      parentId,
      insertIndex,
      insertPosition: 'before'
    }
  });

  if (!isVisible) return null;

  return (
    <Box
      ref={setNodeRef}
      style={{
        height: isOver ? '8px' : '2px',
        backgroundColor: isOver ? '#3b82f6' : 'transparent',
        border: isOver ? '2px dashed #3b82f6' : '1px dashed #e5e7eb',
        borderRadius: '2px',
        margin: '2px 0',
        transition: 'all 0.2s ease-in-out',
        opacity: isOver ? 1 : 0.5
      }}
    />
  );
};

export const ComponentRenderer: React.FC<ComponentRendererProps> = ({
  component,
  index: _index,
  parentId = null,
  preserveOriginalLayout = false
}) => {
  const { handleComponentSelect, isSelected } = useSelection();
  const { draggedComponent } = useVisualBuilderStore();
  const selected = isSelected(component.id);
  const isDraggedComponent = draggedComponent?.id === component.id;

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
      isFromCanvas: true,
      parentId
    }
  });

  // Droppable setup for container components
  const isContainer = CONTAINER_COMPONENTS.includes(component.type);
  
  // Get all component types for accepts array
  const allComponentTypes = MANTINE_COMPONENTS.map(comp => comp.type);
  
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `${component.id}-drop`,
    data: {
      isContainer: true,
      componentId: component.id,
      accepts: allComponentTypes
    },
    disabled: !isContainer
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging || isDraggedComponent ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  } : { opacity: isDraggedComponent ? 0.5 : 1 };

  // Show drop zones when dragging
  const showDropZones = Boolean(draggedComponent && !isDraggedComponent);

  const renderComponent = () => {
    const { type, props, children } = component;
    
    // Extract spacing props for all components
    const spacingProps = extractSpacingProps(props);

    // Ensure style is an object, not a string
    let styleObject: Record<string, any> = {};
    if (props.style) {
      if (typeof props.style === 'string') {
        // If style is still a string, try to parse it
        try {
          // Handle case where style might be a stringified object
          if (props.style.startsWith('{') && props.style.endsWith('}')) {
            const styleStr = props.style.slice(1, -1);
            const pairs = styleStr.split(',');
            styleObject = {};
            
            for (const pair of pairs) {
              const colonIndex = pair.indexOf(':');
              if (colonIndex > -1) {
                const key = pair.substring(0, colonIndex).trim().replace(/['"]/g, '');
                const value = pair.substring(colonIndex + 1).trim().replace(/['"]/g, '');
                styleObject[key] = value;
              }
            }
          }
        } catch (e) {
          console.warn('Failed to parse style string:', props.style);
        }
      } else if (typeof props.style === 'object' && !Array.isArray(props.style)) {
        styleObject = props.style;
      }
    }

    const commonProps = {
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        handleComponentSelect(component);
      },
      style: {
        cursor: 'pointer',
        ...styleObject
      },
      ...spacingProps
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
            fullWidth={props.fullWidth}
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
            fw={
              typeof props.weight === 'number' ? props.weight :
              typeof props.fw === 'number' ? props.fw :
              props.weight === 'bold' ? 700 :
              props.weight === 'semibold' ? 600 :
              props.weight === 'medium' ? 500 :
              props.weight === 'normal' ? 400 :
              props.weight === 'lighter' ? 300 :
              props.fw || props.weight || 400
            }
            c={props.c || props.color || undefined}
          >
            {props.children}
          </Text>
        );

      case 'Title':
        return (
          <Title
            {...commonProps}
            order={Number(props.order) as 1 | 2 | 3 | 4 | 5 | 6}
            fw={props.fw || props.weight || undefined}
            c={props.color || undefined}
          >
            {props.children}
          </Title>
        );

      case 'Container':
        const containerRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <Container
            {...commonProps}
            size={props.size}
            fluid={props.fluid}
            ref={containerRef}
            style={{
              ...commonProps.style,
              ...(preserveOriginalLayout ? {} : {
                minHeight: children?.length === 0 ? '100px' : 'auto',
                borderWidth: isOver || selected ? '2px' : '1px',
                borderStyle: isOver || !selected ? 'dashed' : 'solid',
                borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
                borderRadius: '8px',
                padding: '1rem',
                backgroundColor: isOver ? '#f0f9ff' : 'transparent'
              })
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Container>
        );

      case 'Group':
        const groupRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <Group
            {...commonProps}
            justify={props.justify}
            align={props.align}
            gap={props.gap}
            ref={groupRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '80px' : 'auto',
              borderWidth: isOver || selected ? '2px' : '1px',
              borderStyle: isOver || !selected ? 'dashed' : 'solid',
              borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: isOver ? '#f0f9ff' : 'transparent'
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed">Drop components here</Text>
            )}
          </Group>
        );

      case 'Stack':
        const stackRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <Stack
            {...commonProps}
            gap={props.gap}
            align={props.align}
            ref={stackRef}
            style={{
              ...commonProps.style,
              ...(preserveOriginalLayout ? {} : {
                minHeight: children?.length === 0 ? '100px' : 'auto',
                borderWidth: isOver || selected ? '2px' : '1px',
                borderStyle: isOver || !selected ? 'dashed' : 'solid',
                borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
                borderRadius: '8px',
                padding: '1rem',
                backgroundColor: isOver ? '#f0f9ff' : 'transparent'
              })
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Stack>
        );

      case 'Card':
        const cardRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        // Use specific border properties to avoid conflicts
        const cardStyles: React.CSSProperties = {
          ...commonProps.style,
          ...(preserveOriginalLayout ? {} : { minHeight: children?.length === 0 ? '120px' : 'auto' })
        };
        
        // Only apply editor styling when not preserving original layout
        if (!preserveOriginalLayout) {
          // Only apply border styles when withBorder is false
          if (!props.withBorder) {
            if (isOver) {
              cardStyles.borderWidth = '2px';
              cardStyles.borderStyle = 'dashed';
              cardStyles.borderColor = '#3b82f6';
            } else if (selected) {
              cardStyles.borderWidth = '2px';
              cardStyles.borderStyle = 'solid';
              cardStyles.borderColor = '#3b82f6';
            } else {
              cardStyles.borderWidth = '1px';
              cardStyles.borderStyle = 'dashed';
              cardStyles.borderColor = '#e9ecef';
            }
          } else if (selected || isOver) {
            // When withBorder is true, use outline for selection
            if (isOver) {
              cardStyles.outline = '2px dashed #3b82f6';
            } else if (selected) {
              cardStyles.outline = '2px solid #3b82f6';
            }
            cardStyles.outlineOffset = '1px';
          }
        }
        
        return (
          <Card
            {...commonProps}
            shadow={props.shadow}
            padding={props.padding}
            radius={props.radius}
            withBorder={props.withBorder}
            ref={cardRef}
            style={cardStyles}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Card>
        );

      case 'CardSection':
        const cardSectionRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <Card.Section
            {...commonProps}
            withBorder={props.withBorder}
            inheritPadding={props.inheritPadding}
            ref={cardSectionRef}
            style={{
              ...commonProps.style,
              ...(preserveOriginalLayout ? {} : {
                minHeight: children?.length === 0 ? '80px' : 'auto',
                borderWidth: isOver || selected ? '2px' : '1px',
                borderStyle: isOver || !selected ? 'dashed' : 'solid',
                borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
                padding: props.inheritPadding ? undefined : '1rem',
                backgroundColor: isOver ? '#f0f9ff' : 'transparent'
              })
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Card.Section>
        );

      case 'Badge':
        return (
          <Badge
            {...commonProps}
            variant={props.variant}
            color={props.color}
            size={props.size}
          >
            {props.children}
          </Badge>
        );

      case 'Anchor':
        return (
          <Anchor
            {...commonProps}
            href={props.href}
            size={props.size}
            underline={props.underline}
          >
            {props.children}
          </Anchor>
        );

      case 'Image':
        // Convert aspect ratio to style
        const getAspectRatioStyle = (aspectRatio: string) => {
          const ratios: Record<string, string> = {
            '16:9': '16 / 9',
            '4:3': '4 / 3', 
            '1:1': '1 / 1',
            '3:2': '3 / 2',
            '21:9': '21 / 9'
          };
          return ratios[aspectRatio] || '16 / 9';
        };

        // Extract height from props if it exists
        const imageHeight = props.height || props.h;
        
        const imageStyle: React.CSSProperties = {
          ...commonProps.style,
          width: '100%',
          objectFit: (props.fit || 'cover') as React.CSSProperties['objectFit']
        };
        
        // Apply aspect ratio only if no explicit height is set
        if (!imageHeight && props.aspectRatio) {
          imageStyle.aspectRatio = getAspectRatioStyle(props.aspectRatio);
        }

        return (
          <Image
            {...commonProps}
            src={props.src}
            alt={props.alt}
            radius={props.radius}
            height={imageHeight}
            style={imageStyle}
          />
        );

      case 'Divider':
        return (
          <Divider
            {...commonProps}
            size={props.size}
            orientation={props.orientation}
            label={props.label || undefined}
            labelPosition={props.labelPosition}
          />
        );

      case 'Paper':
        const paperRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        // Use specific border properties to avoid conflicts
        const paperStyles: React.CSSProperties = {
          ...commonProps.style,
          minHeight: children?.length === 0 ? '100px' : 'auto',
        };
        
        // Only apply border styles when withBorder is false
        if (!props.withBorder) {
          if (isOver) {
            paperStyles.borderWidth = '2px';
            paperStyles.borderStyle = 'dashed';
            paperStyles.borderColor = '#3b82f6';
          } else if (selected) {
            paperStyles.borderWidth = '2px';
            paperStyles.borderStyle = 'solid';
            paperStyles.borderColor = '#3b82f6';
          } else {
            paperStyles.borderWidth = '1px';
            paperStyles.borderStyle = 'dashed';
            paperStyles.borderColor = '#e9ecef';
          }
        } else if (selected || isOver) {
          // When withBorder is true, use outline for selection
          if (isOver) {
            paperStyles.outline = '2px dashed #3b82f6';
          } else if (selected) {
            paperStyles.outline = '2px solid #3b82f6';
          }
          paperStyles.outlineOffset = '1px';
        }
        
        return (
          <Paper
            {...commonProps}
            shadow={props.shadow}
            radius={props.radius}
            p={props.p}
            withBorder={props.withBorder}
            ref={paperRef}
            style={paperStyles}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Paper>
        );

      case 'Alert':
        return (
          <Alert
            {...commonProps}
            title={props.title}
            color={props.color}
            variant={props.variant}
          >
            {props.children}
          </Alert>
        );

      // Additional Input Components
      case 'PasswordInput':
        return (
          <PasswordInput
            {...commonProps}
            placeholder={props.placeholder}
            label={props.label}
            size={props.size}
            visible={props.visible}
            disabled={props.disabled}
          />
        );

      case 'Textarea':
        return (
          <Textarea
            {...commonProps}
            placeholder={props.placeholder}
            label={props.label}
            size={props.size}
            rows={props.rows}
            autosize={props.autosize}
            disabled={props.disabled}
          />
        );

      case 'Select':
        return (
          <Select
            {...commonProps}
            placeholder={props.placeholder}
            label={props.label}
            size={props.size}
            data={props.data || ['Option 1', 'Option 2', 'Option 3']}
            searchable={props.searchable}
            clearable={props.clearable}
            disabled={props.disabled}
          />
        );

      case 'MultiSelect':
        return (
          <MultiSelect
            {...commonProps}
            placeholder={props.placeholder}
            label={props.label}
            size={props.size}
            data={props.data || ['Option 1', 'Option 2', 'Option 3']}
            searchable={props.searchable}
            clearable={props.clearable}
            disabled={props.disabled}
          />
        );

      case 'NumberInput':
        return (
          <NumberInput
            {...commonProps}
            placeholder={props.placeholder}
            label={props.label}
            size={props.size}
            min={props.min}
            max={props.max}
            step={props.step}
            disabled={props.disabled}
          />
        );

      case 'Checkbox':
        return (
          <Checkbox
            {...commonProps}
            label={props.label}
            size={props.size}
            color={props.color}
            indeterminate={props.indeterminate}
            disabled={props.disabled}
          />
        );

      case 'Radio':
        return (
          <Radio
            {...commonProps}
            label={props.label}
            size={props.size}
            color={props.color}
            disabled={props.disabled}
          />
        );

      case 'Switch':
        return (
          <Switch
            {...commonProps}
            label={props.label}
            size={props.size}
            color={props.color}
            disabled={props.disabled}
          />
        );

      // Layout Components
      case 'Box':
        const boxRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <Box
            {...commonProps}
            bg={props.bg}
            c={props.c}
            ref={boxRef}
            style={{
              ...commonProps.style,
              ...(preserveOriginalLayout ? {} : {
                minHeight: children?.length === 0 ? '100px' : 'auto',
                borderWidth: isOver || selected ? '2px' : '1px',
                borderStyle: isOver || !selected ? 'dashed' : 'solid',
                borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
                borderRadius: '8px',
                padding: '1rem',
                backgroundColor: isOver ? '#f0f9ff' : props.bg || 'transparent'
              })
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Box>
        );

      case 'Flex':
        const flexRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <Flex
            {...commonProps}
            direction={props.direction}
            justify={props.justify}
            align={props.align}
            wrap={props.wrap}
            gap={props.gap}
            ref={flexRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '100px' : 'auto',
              borderWidth: isOver || selected ? '2px' : '1px',
              borderStyle: isOver || !selected ? 'dashed' : 'solid',
              borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: isOver ? '#f0f9ff' : 'transparent'
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </Flex>
        );

      case 'Grid':
        const gridRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <Grid
            {...commonProps}
            columns={props.columns}
            gutter={props.gutter}
            grow={props.grow}
            ref={gridRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '100px' : 'auto',
              borderWidth: isOver || selected ? '2px' : '1px',
              borderStyle: isOver || !selected ? 'dashed' : 'solid',
              borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: isOver ? '#f0f9ff' : 'transparent'
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop GridCol components here</Text>
            )}
          </Grid>
        );

      case 'GridCol':
        const gridColRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <GridCol
            {...commonProps}
            span={props.span}
            offset={props.offset}
            ref={gridColRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '80px' : 'auto',
              borderWidth: isOver || selected ? '2px' : '1px',
              borderStyle: isOver || !selected ? 'dashed' : 'solid',
              borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: isOver ? '#f0f9ff' : 'transparent'
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </GridCol>
        );

      case 'SimpleGrid':
        const simpleGridRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <SimpleGrid
            {...commonProps}
            cols={props.cols}
            spacing={props.spacing}
            verticalSpacing={props.verticalSpacing}
            ref={simpleGridRef}
            style={{
              ...commonProps.style,
              ...(preserveOriginalLayout ? {} : {
                minHeight: children?.length === 0 ? '100px' : 'auto',
                borderWidth: isOver || selected ? '2px' : '1px',
                borderStyle: isOver || !selected ? 'dashed' : 'solid',
                borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
                borderRadius: '8px',
                padding: '1rem',
                backgroundColor: isOver ? '#f0f9ff' : 'transparent'
              })
            }}
          >
            {children?.map((child, idx) => (
              <React.Fragment key={child.id}>
                <DropZone 
                  parentId={component.id} 
                  insertIndex={idx} 
                  isVisible={showDropZones && isContainer}
                />
                <ComponentRenderer
                  component={child}
                  index={idx}
                  isChild={true}
                  parentId={component.id}
                  preserveOriginalLayout={preserveOriginalLayout}
                />
              </React.Fragment>
            ))}
            {showDropZones && isContainer && (
              <DropZone 
                parentId={component.id} 
                insertIndex={children?.length || 0} 
                isVisible={true}
              />
            )}
            {children?.length === 0 && (
              <Text c="dimmed" ta="center">Drop components here</Text>
            )}
          </SimpleGrid>
        );

      // Typography Components
      case 'Code':
        return (
          <Code
            {...commonProps}
            color={props.color}
            block={props.block}
          >
            {props.children}
          </Code>
        );

      case 'Mark':
        return (
          <Mark
            {...commonProps}
            color={props.color}
          >
            {props.children}
          </Mark>
        );

      case 'Blockquote':
        return (
          <Blockquote
            {...commonProps}
            cite={props.cite}
            color={props.color}
          >
            {props.children}
          </Blockquote>
        );

      // Display Components
      case 'Avatar':
        return (
          <Avatar
            {...commonProps}
            src={props.src}
            alt={props.alt}
            size={props.size}
            radius={props.radius}
            color={props.color}
          />
        );

      case 'Indicator':
        return (
          <Indicator
            {...commonProps}
            label={props.label}
            size={props.size}
            color={props.color}
            position={props.position}
          >
            <Box p="md" bg="gray.1">
              {props.children}
            </Box>
          </Indicator>
        );

      // Navigation Components
      case 'Breadcrumbs':
        return (
          <Breadcrumbs
            {...commonProps}
            separator={props.separator}
          >
            {(props.children || ['Home', 'Products', 'Current']).map((item: string, idx: number) => (
              <Anchor key={idx} href="#">{item}</Anchor>
            ))}
          </Breadcrumbs>
        );

      case 'Tabs':
        const tabsRef = (node: HTMLDivElement | null) => {
          dropRef(node);
        };
        
        return (
          <Tabs
            {...commonProps}
            variant={props.variant}
            color={props.color}
            orientation={props.orientation}
            defaultValue="tab1"
            ref={tabsRef}
            style={{
              ...commonProps.style,
              minHeight: children?.length === 0 ? '120px' : 'auto',
              borderWidth: isOver || selected ? '2px' : '1px',
              borderStyle: isOver || !selected ? 'dashed' : 'solid',
              borderColor: isOver || selected ? '#3b82f6' : '#e9ecef',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: isOver ? '#f0f9ff' : 'transparent'
            }}
          >
            <Tabs.List>
              <Tabs.Tab value="tab1">Tab 1</Tabs.Tab>
              <Tabs.Tab value="tab2">Tab 2</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="tab1">
              {children?.map((child, idx) => (
                <React.Fragment key={child.id}>
                  <DropZone 
                    parentId={component.id} 
                    insertIndex={idx} 
                    isVisible={showDropZones && isContainer}
                  />
                  <ComponentRenderer
                    component={child}
                    index={idx}
                    isChild={true}
                    parentId={component.id}
                  />
                </React.Fragment>
              ))}
              {showDropZones && isContainer && (
                <DropZone 
                  parentId={component.id} 
                  insertIndex={children?.length || 0} 
                  isVisible={true}
                />
              )}
              {children?.length === 0 && (
                <Text c="dimmed" ta="center">Drop components here</Text>
              )}
            </Tabs.Panel>
            <Tabs.Panel value="tab2">
              <Text>Tab 2 content</Text>
            </Tabs.Panel>
          </Tabs>
        );

      // Feedback Components
      case 'Loader':
        return (
          <Loader
            {...commonProps}
            size={props.size}
            color={props.color}
            variant={props.variant}
          />
        );

      case 'Progress':
        return (
          <Progress
            {...commonProps}
            value={props.value}
            size={props.size}
            color={props.color}
            radius={props.radius}
            striped={props.striped}
            animated={props.animated}
          />
        );

      case 'RingProgress':
        return (
          <RingProgress
            {...commonProps}
            size={props.size}
            thickness={props.thickness}
            sections={props.sections || [{ value: 40, color: 'blue' }]}
            label={props.label && <Text ta="center" size="xs">{props.label}</Text>}
          />
        );

      // Overlay Components
      case 'Tooltip':
        return (
          <Tooltip
            label={props.label}
            position={props.position}
            color={props.color}
          >
            <Box {...commonProps}>
              {props.children}
            </Box>
          </Tooltip>
        );

      case 'Popover':
        return (
          <Popover position={props.position} width={props.width} shadow={props.shadow}>
            <Popover.Target>
              <Button {...commonProps}>{props.children}</Button>
            </Popover.Target>
            <Popover.Dropdown>
              <Text size="sm">Popover content</Text>
            </Popover.Dropdown>
          </Popover>
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
        // Only apply selection styling when NOT preserving original layout
        ...(preserveOriginalLayout ? {} : {
          borderWidth: selected && !isContainer ? '2px' : '0',
          borderStyle: selected && !isContainer ? 'solid' : 'none',
          borderColor: selected && !isContainer ? '#3b82f6' : 'transparent',
          borderRadius: selected ? '4px' : '0',
          padding: selected && !isContainer ? '2px' : '0',
        }),
        outline: 'none',
        position: 'relative'
      }}
      {...attributes}
      {...listeners}
    >
      {renderComponent()}
    </Box>
  );
};