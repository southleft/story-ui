import React, { useState } from 'react';
import { 
  Box, 
  Text, 
  NumberInput, 
  SegmentedControl, 
  Switch, 
  Group,
  Stack,
  Paper
} from '@mantine/core';

interface SpacingEditorProps {
  type: 'margin' | 'padding';
  values: {
    top?: number | string;
    right?: number | string;
    bottom?: number | string;
    left?: number | string;
    all?: number | string;
  };
  onChange: (values: any) => void;
}

export const SpacingEditor: React.FC<SpacingEditorProps> = ({
  type,
  values = {},
  onChange
}) => {
  const [unit, setUnit] = useState<'px' | 'rem' | '%'>('px');
  const [useUniform, setUseUniform] = useState(true);
  
  const handleValueChange = (side: string, value: number | string) => {
    if (useUniform && side === 'all') {
      onChange({
        top: value,
        right: value,
        bottom: value,
        left: value,
        all: value
      });
    } else {
      onChange({
        ...values,
        [side]: value
      });
    }
  };

  const currentValue = useUniform 
    ? values.all || values.top || 0
    : null;

  return (
    <Paper p="xs" withBorder>
      <Stack gap="xs">
        {/* Header */}
        <Group justify="space-between">
          <Text size="sm" fw={500} c={type === 'margin' ? 'blue.6' : 'green.6'}>
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </Text>
          <SegmentedControl
            size="xs"
            value={unit}
            onChange={(value) => setUnit(value as 'px' | 'rem' | '%')}
            data={[
              { label: 'px', value: 'px' },
              { label: 'rem', value: 'rem' },
              { label: '%', value: '%' }
            ]}
          />
        </Group>

        {/* Uniform toggle */}
        <Switch
          size="xs"
          label="Uniform spacing"
          checked={useUniform}
          onChange={(e) => setUseUniform(e.currentTarget.checked)}
        />

        {/* Spacing controls */}
        {useUniform ? (
          <NumberInput
            size="xs"
            label="All sides"
            value={currentValue as number}
            onChange={(value) => handleValueChange('all', value)}
            suffix={unit}
            min={0}
          />
        ) : (
          <Box>
            <Group gap="xs" mb="xs">
              <NumberInput
                size="xs"
                label="Top"
                value={values.top as number || 0}
                onChange={(value) => handleValueChange('top', value)}
                suffix={unit}
                min={0}
                style={{ flex: 1 }}
              />
              <NumberInput
                size="xs"
                label="Right"
                value={values.right as number || 0}
                onChange={(value) => handleValueChange('right', value)}
                suffix={unit}
                min={0}
                style={{ flex: 1 }}
              />
            </Group>
            <Group gap="xs">
              <NumberInput
                size="xs"
                label="Bottom"
                value={values.bottom as number || 0}
                onChange={(value) => handleValueChange('bottom', value)}
                suffix={unit}
                min={0}
                style={{ flex: 1 }}
              />
              <NumberInput
                size="xs"
                label="Left"
                value={values.left as number || 0}
                onChange={(value) => handleValueChange('left', value)}
                suffix={unit}
                min={0}
                style={{ flex: 1 }}
              />
            </Group>
          </Box>
        )}
      </Stack>
    </Paper>
  );
};