import React from 'react';
import { MantineProvider, createTheme } from '@mantine/core';
import { VisualBuilder } from './components/VisualBuilder';

const theme = createTheme({
  /** Put your mantine theme override here */
});

/**
 * Example usage of the Visual Builder component
 * 
 * This demonstrates how to integrate the Visual Builder into your React application.
 * The Visual Builder provides a complete drag-and-drop interface for building UI components.
 */
export const VisualBuilderExample: React.FC = () => {
  return (
    <MantineProvider theme={theme}>
      <div style={{ height: '100vh', width: '100vw' }}>
        <VisualBuilder />
      </div>
    </MantineProvider>
  );
};

/**
 * Standalone Visual Builder for development/testing
 */
export const StandaloneVisualBuilder: React.FC = () => {
  return (
    <MantineProvider>
      <VisualBuilder 
        height="100vh"
        style={{ 
          fontFamily: 'system-ui, sans-serif' 
        }}
      />
    </MantineProvider>
  );
};