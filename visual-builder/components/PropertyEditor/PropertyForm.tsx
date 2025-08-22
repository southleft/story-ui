import React from 'react';
import { Box, TextInput, Select, Switch, Text, Divider } from '@mantine/core';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { getComponentConfig } from '../../config/componentRegistry';

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

  if (!config) {
    return (
      <Text c="dimmed" ta="center">
        No properties available for this component
      </Text>
    );
  }

  const handlePropertyChange = (propertyName: string, value: any) => {
    updateComponent(componentId, {
      props: {
        ...currentProps,
        [propertyName]: value
      }
    });
  };

  return (
    <Box>
      {config.properties.map((property, index) => (
        <Box key={property.name} mb="md">
          {index > 0 && <Divider mb="md" />}
          
          <Text size="sm" fw={500} mb="xs">
            {property.name.charAt(0).toUpperCase() + property.name.slice(1)}
          </Text>
          
          {property.description && (
            <Text size="xs" c="dimmed" mb="xs">
              {property.description}
            </Text>
          )}

          {property.type === 'string' && (
            <TextInput
              value={currentProps[property.name] || ''}
              onChange={(e) => handlePropertyChange(property.name, e.target.value)}
              placeholder={`Enter ${property.name}...`}
              size="sm"
            />
          )}

          {property.type === 'number' && (
            <TextInput
              type="number"
              value={currentProps[property.name] || 0}
              onChange={(e) => handlePropertyChange(property.name, Number(e.target.value))}
              placeholder={`Enter ${property.name}...`}
              size="sm"
            />
          )}

          {property.type === 'boolean' && (
            <Switch
              checked={Boolean(currentProps[property.name])}
              onChange={(e) => handlePropertyChange(property.name, e.target.checked)}
              label={property.description || `Enable ${property.name}`}
              size="sm"
            />
          )}

          {property.type === 'select' && property.options && (
            <Select
              value={String(currentProps[property.name] || property.defaultValue)}
              onChange={(value) => {
                // Convert back to number if needed
                const finalValue = property.name === 'order' && value ? Number(value) : value;
                handlePropertyChange(property.name, finalValue);
              }}
              data={property.options.map(option => ({
                value: String(option),
                label: String(option)
              }))}
              placeholder={`Select ${property.name}...`}
              size="sm"
            />
          )}

          {property.type === 'color' && (
            <TextInput
              value={currentProps[property.name] || ''}
              onChange={(e) => handlePropertyChange(property.name, e.target.value)}
              placeholder="Enter color (hex, rgb, or name)..."
              size="sm"
            />
          )}
        </Box>
      ))}
    </Box>
  );
};