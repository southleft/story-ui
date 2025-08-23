import React, { useState } from 'react';
import { 
  Box, 
  Group, 
  Text, 
  ActionIcon, 
  NumberInput, 
  Select, 
  Stack,
  Paper,
  Tooltip,
  Switch
} from '@mantine/core';

interface SpacingControlProps {
  values: {
    m?: string | number;
    mt?: string | number;
    mr?: string | number;
    mb?: string | number;
    ml?: string | number;
    mx?: string | number;
    my?: string | number;
    p?: string | number;
    pt?: string | number;
    pr?: string | number;
    pb?: string | number;
    pl?: string | number;
    px?: string | number;
    py?: string | number;
  };
  onChange: (property: string, value: string | number | undefined) => void;
}

const SPACING_OPTIONS = ['0', 'xs', 'sm', 'md', 'lg', 'xl', 'auto'];

export const SpacingControl: React.FC<SpacingControlProps> = ({ values, onChange }) => {
  const [marginLocked, setMarginLocked] = useState(false);
  const [paddingLocked, setPaddingLocked] = useState(false);
  const [marginXLocked, setMarginXLocked] = useState(false);
  const [marginYLocked, setMarginYLocked] = useState(false);
  const [paddingXLocked, setPaddingXLocked] = useState(false);
  const [paddingYLocked, setPaddingYLocked] = useState(false);
  const [useNumbers, setUseNumbers] = useState(false);

  const handleChange = (property: string, value: string | number | null) => {
    const finalValue = value === null || value === '' ? undefined : value;
    onChange(property, finalValue);

    // Handle locked states
    if (marginLocked && property.startsWith('m') && !property.includes('x') && !property.includes('y')) {
      const props = ['mt', 'mr', 'mb', 'ml'];
      props.forEach(prop => {
        if (prop !== property) onChange(prop, finalValue);
      });
    }

    if (paddingLocked && property.startsWith('p') && !property.includes('x') && !property.includes('y')) {
      const props = ['pt', 'pr', 'pb', 'pl'];
      props.forEach(prop => {
        if (prop !== property) onChange(prop, finalValue);
      });
    }

    // Handle axis-specific locks
    if (marginXLocked && (property === 'ml' || property === 'mr')) {
      if (property === 'ml') onChange('mr', finalValue);
      if (property === 'mr') onChange('ml', finalValue);
    }

    if (marginYLocked && (property === 'mt' || property === 'mb')) {
      if (property === 'mt') onChange('mb', finalValue);
      if (property === 'mb') onChange('mt', finalValue);
    }

    if (paddingXLocked && (property === 'pl' || property === 'pr')) {
      if (property === 'pl') onChange('pr', finalValue);
      if (property === 'pr') onChange('pl', finalValue);
    }

    if (paddingYLocked && (property === 'pt' || property === 'pb')) {
      if (property === 'pt') onChange('pb', finalValue);
      if (property === 'pb') onChange('pt', finalValue);
    }
  };

  const renderSpacingInput = (property: string, placeholder: string) => {
    const value = values[property as keyof typeof values];
    
    if (useNumbers) {
      return (
        <Group gap={2}>
          <NumberInput
            value={typeof value === 'number' ? value : undefined}
            onChange={(val) => handleChange(property, val)}
            placeholder={placeholder}
            size="xs"
            w={50}
            min={0}
            hideControls
          />
          <ActionIcon
            size="xs"
            variant="light"
            onClick={() => {
              const currentVal = typeof value === 'number' ? value : 0;
              handleChange(property, currentVal + 4);
            }}
          >
+
          </ActionIcon>
          <ActionIcon
            size="xs"
            variant="light"
            onClick={() => {
              const currentVal = typeof value === 'number' ? value : 0;
              handleChange(property, Math.max(0, currentVal - 4));
            }}
          >
-
          </ActionIcon>
        </Group>
      );
    }

    return (
      <Select
        value={value ? String(value) : null}
        onChange={(val) => handleChange(property, val)}
        data={SPACING_OPTIONS}
        placeholder={placeholder}
        size="xs"
        w={75}
        clearable
        allowDeselect
        styles={{
          dropdown: { zIndex: 1000 }
        }}
      />
    );
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between" gap="xs">
        <Text size="xs" fw={500}>Spacing</Text>
        <Switch
          label="Numbers"
          size="xs"
          checked={useNumbers}
          onChange={(event) => setUseNumbers(event.currentTarget.checked)}
        />
      </Group>

      {/* Margin Section */}
      <Paper p={4} withBorder>
        <Group justify="space-between" mb={4} gap="xs">
          <Text size="xs" fw={500} c="blue">Margin</Text>
          <Group gap={2}>
            <Tooltip label="Lock X-axis (left & right)">
              <ActionIcon
                size="xs"
                variant={marginXLocked ? "filled" : "light"}
                color="blue"
                onClick={() => setMarginXLocked(!marginXLocked)}
              >
{marginXLocked ? '🔒' : '🔓'}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Lock Y-axis (top & bottom)">
              <ActionIcon
                size="xs"
                variant={marginYLocked ? "filled" : "light"}
                color="blue"
                onClick={() => setMarginYLocked(!marginYLocked)}
              >
{marginYLocked ? '🔒' : '🔓'}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Lock all sides">
              <ActionIcon
                size="xs"
                variant={marginLocked ? "filled" : "light"}
                color="blue"
                onClick={() => setMarginLocked(!marginLocked)}
              >
{marginLocked ? '🔒' : '🔓'}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Visual Box Model for Margin */}
        <Box
          style={{
            position: 'relative',
            border: '1px dashed #228be6',
            borderRadius: '4px',
            padding: '20px',
            minHeight: '120px'
          }}
        >
          {/* Margin Top */}
          <Box
            style={{
              position: 'absolute',
              top: '-8px',
              left: '50%',
              transform: 'translateX(-50%)'
            }}
          >
            {renderSpacingInput('mt', 'top')}
          </Box>

          {/* Margin Right */}
          <Box
            style={{
              position: 'absolute',
              right: '-32px',
              top: '50%',
              transform: 'translateY(-50%)'
            }}
          >
            {renderSpacingInput('mr', 'right')}
          </Box>

          {/* Margin Bottom */}
          <Box
            style={{
              position: 'absolute',
              bottom: '-8px',
              left: '50%',
              transform: 'translateX(-50%)'
            }}
          >
            {renderSpacingInput('mb', 'bottom')}
          </Box>

          {/* Margin Left */}
          <Box
            style={{
              position: 'absolute',
              left: '-32px',
              top: '50%',
              transform: 'translateY(-50%)'
            }}
          >
            {renderSpacingInput('ml', 'left')}
          </Box>

          {/* All margins input */}
          <Box ta="center">
            <Text size="xs" c="dimmed" mb={2}>All</Text>
            {renderSpacingInput('m', 'all')}
          </Box>
        </Box>

        {/* Axis shortcuts */}
        <Group justify="center" mt={4} gap="xs">
          <Box ta="center">
            <Text size="xs" c="dimmed">X</Text>
            {renderSpacingInput('mx', 'x')}
          </Box>
          <Box ta="center">
            <Text size="xs" c="dimmed">Y</Text>
            {renderSpacingInput('my', 'y')}
          </Box>
        </Group>
      </Paper>

      {/* Padding Section */}
      <Paper p={4} withBorder>
        <Group justify="space-between" mb={4} gap="xs">
          <Text size="xs" fw={500} c="green">Padding</Text>
          <Group gap={2}>
            <Tooltip label="Lock X-axis (left & right)">
              <ActionIcon
                size="xs"
                variant={paddingXLocked ? "filled" : "light"}
                color="green"
                onClick={() => setPaddingXLocked(!paddingXLocked)}
              >
{paddingXLocked ? '🔒' : '🔓'}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Lock Y-axis (top & bottom)">
              <ActionIcon
                size="xs"
                variant={paddingYLocked ? "filled" : "light"}
                color="green"
                onClick={() => setPaddingYLocked(!paddingYLocked)}
              >
{paddingYLocked ? '🔒' : '🔓'}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Lock all sides">
              <ActionIcon
                size="xs"
                variant={paddingLocked ? "filled" : "light"}
                color="green"
                onClick={() => setPaddingLocked(!paddingLocked)}
              >
{paddingLocked ? '🔒' : '🔓'}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Visual Box Model for Padding */}
        <Box
          style={{
            position: 'relative',
            border: '1px dashed #40c057',
            borderRadius: '4px',
            padding: '20px',
            minHeight: '120px'
          }}
        >
          {/* Padding Top */}
          <Box
            style={{
              position: 'absolute',
              top: '-8px',
              left: '50%',
              transform: 'translateX(-50%)'
            }}
          >
            {renderSpacingInput('pt', 'top')}
          </Box>

          {/* Padding Right */}
          <Box
            style={{
              position: 'absolute',
              right: '-32px',
              top: '50%',
              transform: 'translateY(-50%)'
            }}
          >
            {renderSpacingInput('pr', 'right')}
          </Box>

          {/* Padding Bottom */}
          <Box
            style={{
              position: 'absolute',
              bottom: '-8px',
              left: '50%',
              transform: 'translateX(-50%)'
            }}
          >
            {renderSpacingInput('pb', 'bottom')}
          </Box>

          {/* Padding Left */}
          <Box
            style={{
              position: 'absolute',
              left: '-32px',
              top: '50%',
              transform: 'translateY(-50%)'
            }}
          >
            {renderSpacingInput('pl', 'left')}
          </Box>

          {/* All paddings input */}
          <Box ta="center">
            <Text size="xs" c="dimmed" mb={2}>All</Text>
            {renderSpacingInput('p', 'all')}
          </Box>
        </Box>

        {/* Axis shortcuts */}
        <Group justify="center" mt={4} gap="xs">
          <Box ta="center">
            <Text size="xs" c="dimmed">X</Text>
            {renderSpacingInput('px', 'x')}
          </Box>
          <Box ta="center">
            <Text size="xs" c="dimmed">Y</Text>
            {renderSpacingInput('py', 'y')}
          </Box>
        </Group>
      </Paper>
    </Stack>
  );
};