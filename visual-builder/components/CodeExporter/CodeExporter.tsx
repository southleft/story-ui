import React from 'react';
import { Modal, Button, Group, Code, ScrollArea, Text, Box } from '@mantine/core';
import { useVisualBuilderStore } from '../../store/visualBuilderStore';
import { generateJSXCode } from './codeGenerator';

export const CodeExporter: React.FC = () => {
  const { isCodeModalOpen, closeCodeModal, components } = useVisualBuilderStore();
  const jsxCode = generateJSXCode(components);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(jsxCode);
      // You could add a notification here
      console.log('Code copied to clipboard');
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <Modal
      opened={isCodeModalOpen}
      onClose={closeCodeModal}
      title="Export React Code"
      size="xl"
    >
      <Box>
        <Group justify="space-between" mb="md">
          <Text size="sm" c="dimmed">
            Generated React/JSX code for your components
          </Text>
          <Button size="xs" onClick={handleCopyCode}>
            Copy Code
          </Button>
        </Group>

        <ScrollArea h={400}>
          <Code
            block
            style={{
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              backgroundColor: '#f8f9fa',
              padding: '1rem',
              borderRadius: '6px'
            }}
          >
            {jsxCode}
          </Code>
        </ScrollArea>

        <Group justify="flex-end" mt="md">
          <Button variant="outline" onClick={closeCodeModal}>
            Close
          </Button>
        </Group>
      </Box>
    </Modal>
  );
};