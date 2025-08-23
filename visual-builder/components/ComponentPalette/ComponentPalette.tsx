import React from 'react';
import { Box, Text, Accordion } from '@mantine/core';
import { ComponentPaletteItem } from './ComponentPaletteItem';
import { getComponentsByCategory } from '../../config/componentRegistry';

export const ComponentPalette: React.FC = () => {
  const componentsByCategory = getComponentsByCategory();

  return (
    <Box p="sm">
      <Accordion defaultValue={['Layout', 'Inputs', 'Typography']} multiple>
        {Object.entries(componentsByCategory).map(([category, components]) => (
          <Accordion.Item key={category} value={category}>
            <Accordion.Control>
              <Text fw={500} size="sm">
                {category}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Box style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {components.map((component) => (
                  <ComponentPaletteItem
                    key={component.type}
                    config={component}
                  />
                ))}
              </Box>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Box>
  );
};