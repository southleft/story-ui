import React from 'react';
import { Box, TextInput, Select, Switch, Text, Divider, Stack, Accordion } from '@mantine/core';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { getComponentConfig } from '../../config/componentRegistry';
import { SpacingEditor } from './SpacingEditor';

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

  // Check if component has layout properties
  const hasLayoutProps = ['Container', 'Group', 'Stack', 'Card', 'Box'].includes(componentType);

  return (
    <Stack gap="md">
      {/* Basic Properties */}
      <Accordion defaultValue="properties">
        <Accordion.Item value="properties">
          <Accordion.Control>Properties</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              {config.properties.map((property) => (
                <Box key={property.name}>
                  <Text size="sm" fw={500} mb={4}>
                    {property.name.charAt(0).toUpperCase() + property.name.slice(1)}
                  </Text>
                  
                  {property.description && (
                    <Text size="xs" c="dimmed" mb={4}>
                      {property.description}
                    </Text>
                  )}

                  {property.type === 'string' && (
                    <TextInput
                      value={currentProps[property.name] || ''}
                      onChange={(e) => handlePropertyChange(property.name, e.target.value)}
                      placeholder={`Enter ${property.name}...`}
                      size="xs"
                    />
                  )}

                  {property.type === 'number' && (
                    <TextInput
                      type="number"
                      value={currentProps[property.name] || 0}
                      onChange={(e) => handlePropertyChange(property.name, Number(e.target.value))}
                      placeholder={`Enter ${property.name}...`}
                      size="xs"
                    />
                  )}

                  {property.type === 'boolean' && (
                    <Switch
                      checked={Boolean(currentProps[property.name])}
                      onChange={(e) => handlePropertyChange(property.name, e.target.checked)}
                      label={property.description || `Enable ${property.name}`}
                      size="xs"
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
                      size="xs"
                    />
                  )}

                  {property.type === 'color' && (
                    <TextInput
                      value={currentProps[property.name] || ''}
                      onChange={(e) => handlePropertyChange(property.name, e.target.value)}
                      placeholder="Enter color (hex, rgb, or name)..."
                      size="xs"
                    />
                  )}
                </Box>
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Spacing Properties - Only show for layout components */}
        {hasLayoutProps && (
          <Accordion.Item value="spacing">
            <Accordion.Control>Spacing</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <SpacingEditor
                  type="margin"
                  values={currentProps.margin || {}}
                  onChange={(values) => handlePropertyChange('margin', values)}
                />
                <SpacingEditor
                  type="padding"
                  values={currentProps.padding || {}}
                  onChange={(values) => handlePropertyChange('padding', values)}
                />
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
    </Stack>
  );
};