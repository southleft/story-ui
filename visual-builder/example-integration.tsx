import React from 'react';
import { StoryUIPanel } from '../templates/StoryUI/StoryUIPanel';

/**
 * Example integration showing how the Visual Builder integrates with Story UI Panel
 * 
 * This demonstrates the complete workflow:
 * 1. User describes a component in the AI chat
 * 2. AI generates component code
 * 3. User can click "Edit in Visual Builder" 
 * 4. Visual Builder loads the generated code and allows visual editing
 * 5. User can export the updated code
 */
export const IntegrationExample = () => {
  return (
    <div style={{ height: '100vh' }}>
      <StoryUIPanel />
    </div>
  );
};

/**
 * Example AI-generated code that the parser should handle well
 */
export const sampleAICode = `
import React from 'react';
import { Button, TextInput, Stack, Card, Title, Group } from '@mantine/core';

export const LoginForm = () => {
  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="md">
        <Title order={2}>Login</Title>
        <TextInput
          label="Email"
          placeholder="Enter your email"
          required
        />
        <TextInput
          label="Password"
          placeholder="Enter your password"
          type="password"
          required
        />
        <Group justify="space-between">
          <Button variant="outline">Cancel</Button>
          <Button>Login</Button>
        </Group>
      </Stack>
    </Card>
  );
};
`;

/**
 * Test the parser with sample code
 */
export const testParser = () => {
  const { parseAIGeneratedCode } = require('./utils/aiParser');
  const result = parseAIGeneratedCode(sampleAICode);
  
  console.log('Parse Result:', result);
  console.log('Errors:', result.errors);
  console.log('Warnings:', result.warnings);
  console.log('Components:', result.components);
  
  return result;
};