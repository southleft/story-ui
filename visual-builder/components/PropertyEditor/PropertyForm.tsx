import React, { useState, useEffect } from 'react';
import { Box, TextInput, Select, Switch, Text, Divider, Accordion, Group, Badge } from '@mantine/core';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { getComponentConfig } from '../../config/componentRegistry';
import { useDebouncedCallback } from '@mantine/hooks';
import { SpacingControl } from './SpacingControl';

interface PropertyFormProps {
  componentId: string;
  componentType: string;
  currentProps: Record<string, any>;
}

export const PropertyForm: React.FC<PropertyFormProps> = ({
  componentId,
  componentType,
  currentProps
}) => {
  const { updateComponent } = useVisualBuilderStore();
  const config = getComponentConfig(componentType);
  
  // Local state for inputs to prevent focus loss
  const [localValues, setLocalValues] = useState<Record<string, any>>({});

  // Sync local values when currentProps changes
  useEffect(() => {
    setLocalValues(currentProps);
  }, [currentProps]);

  if (!config) {
    return (
      <Text c="dimmed" ta="center">
        No properties available for this component
      </Text>
    );
  }

  // Debounced update to store for text inputs
  const debouncedUpdate = useDebouncedCallback((propertyName: string, value: any) => {
    updateComponent(componentId, {
      props: {
        ...currentProps,
        [propertyName]: value
      }
    });
  }, 300);

  // Immediate update for non-text inputs
  const handleImmediatePropertyChange = (propertyName: string, value: any) => {
    const newProps = { ...currentProps, [propertyName]: value };
    setLocalValues(newProps);
    updateComponent(componentId, {
      props: newProps
    });
  };

  // Handle text input changes with debouncing
  const handleTextPropertyChange = (propertyName: string, value: any) => {
    const newProps = { ...currentProps, [propertyName]: value };
    setLocalValues(newProps);
    debouncedUpdate(propertyName, value);
  };

  // Handle blur events to ensure immediate update
  const handleTextBlur = (propertyName: string, value: any) => {
    updateComponent(componentId, {
      props: {
        ...currentProps,
        [propertyName]: value
      }
    });
  };

  // Group properties by category
  const groupedProperties = config.properties.reduce((acc, property) => {
    const category = property.category || 'general';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(property);
    return acc;
  }, {} as Record<string, typeof config.properties>);

  const renderPropertyInput = (property: typeof config.properties[0]) => {
    // Skip individual spacing properties as they'll be handled by SpacingControl
    const spacingProps = ['m', 'mt', 'mr', 'mb', 'ml', 'mx', 'my', 'p', 'pt', 'pr', 'pb', 'pl', 'px', 'py'];
    if (spacingProps.includes(property.name)) {
      return null;
    }

    return (
      <Box key={property.name} mb="md">
        <Group justify="space-between" mb="xs">
          <Text size="sm" fw={500}>
            {property.name.charAt(0).toUpperCase() + property.name.slice(1)}
          </Text>
          {property.category && (
            <Badge size="xs" variant="light" color="gray">
              {property.category}
            </Badge>
          )}
        </Group>
        
        {property.description && (
          <Text size="xs" c="dimmed" mb="xs">
            {property.description}
          </Text>
        )}

        {property.type === 'string' && (
          <TextInput
            value={localValues[property.name] || ''}
            onChange={(e) => handleTextPropertyChange(property.name, e.target.value)}
            onBlur={(e) => handleTextBlur(property.name, e.target.value)}
            placeholder={`Enter ${property.name}...`}
            size="sm"
          />
        )}

        {property.type === 'number' && (
          <TextInput
            type="number"
            value={localValues[property.name] || 0}
            onChange={(e) => handleTextPropertyChange(property.name, Number(e.target.value))}
            onBlur={(e) => handleTextBlur(property.name, Number(e.target.value))}
            placeholder={`Enter ${property.name}...`}
            size="sm"
          />
        )}

        {property.type === 'boolean' && (
          <Switch
            checked={Boolean(localValues[property.name])}
            onChange={(e) => handleImmediatePropertyChange(property.name, e.target.checked)}
            label={property.description || `Enable ${property.name}`}
            size="sm"
          />
        )}

        {property.type === 'select' && property.options && (
          <Select
            value={String(localValues[property.name] !== undefined ? localValues[property.name] : property.defaultValue)}
            onChange={(value) => {
              // Convert back to number if needed
              const finalValue = property.name === 'order' && value ? Number(value) : value;
              handleImmediatePropertyChange(property.name, finalValue);
            }}
            data={property.options.map(option => ({
              value: String(option),
              label: String(option)
            }))}
            placeholder={`Select ${property.name}...`}
            size="sm"
            clearable={true}
            allowDeselect={true}
          />
        )}

        {property.type === 'color' && (
          <TextInput
            value={localValues[property.name] || ''}
            onChange={(e) => handleTextPropertyChange(property.name, e.target.value)}
            onBlur={(e) => handleTextBlur(property.name, e.target.value)}
            placeholder="Enter color (hex, rgb, or name)..."
            size="sm"
          />
        )}
      </Box>
    );
  };

  const categoryOrder = ['content', 'appearance', 'spacing', 'behavior'];
  const orderedCategories = categoryOrder.filter(cat => groupedProperties[cat]);
  const remainingCategories = Object.keys(groupedProperties).filter(cat => !categoryOrder.includes(cat));
  const allCategories = [...orderedCategories, ...remainingCategories];

  return (
    <Box>
      <Accordion multiple defaultValue={['content', 'appearance', 'spacing']}>
        {allCategories.map((category) => (
          <Accordion.Item key={category} value={category}>
            <Accordion.Control>
              <Group justify="space-between">
                <Text fw={600} tt="capitalize">
                  {category}
                </Text>
                <Badge size="xs" variant="light">
                  {groupedProperties[category].length}
                </Badge>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              {category === 'spacing' ? (
                <SpacingControl
                  values={localValues}
                  onChange={handleImmediatePropertyChange}
                />
              ) : (
                groupedProperties[category]
                  .map((property, propertyIndex) => {
                    const renderedInput = renderPropertyInput(property);
                    if (!renderedInput) return null;
                    
                    return (
                      <Box key={property.name}>
                        {renderedInput}
                        {propertyIndex < groupedProperties[category].length - 1 && (
                          <Divider mb="md" />
                        )}
                      </Box>
                    );
                  })
                  .filter(Boolean)
              )}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Box>
  );
};