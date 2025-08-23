import React from 'react';
import { Box, Text, Button, Group } from '@mantine/core';
import { PropertyForm } from './PropertyForm';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';

export const PropertyEditor: React.FC = () => {
  const { selectedComponent, removeComponent } = useVisualBuilderStore();

  if (!selectedComponent) {
    return (
      <Box p="sm">
        <Text c="dimmed" ta="center" mt="xl">
          Select a component to edit its properties
        </Text>
      </Box>
    );
  }

  const handleDelete = () => {
    if (selectedComponent) {
      removeComponent(selectedComponent.id);
    }
  };

  return (
    <Box p="sm">
      <Box mb="lg">
        <Group justify="space-between" align="center" mb="sm">
          <Text fw={600} size="sm">
            {selectedComponent.type}
          </Text>
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={handleDelete}
          >
            Delete
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Component ID: {selectedComponent.id}
        </Text>
      </Box>

      <PropertyForm
        componentId={selectedComponent.id}
        componentType={selectedComponent.type}
        currentProps={selectedComponent.props}
      />
    </Box>
  );
};