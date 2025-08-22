# Visual Builder MVP

A drag-and-drop visual builder for React components using Mantine UI library.

## Features

- **Drag & Drop Interface**: Drag components from palette to canvas
- **Live Preview**: See components render in real-time
- **Property Editor**: Edit component properties with a visual interface
- **Code Export**: Generate clean React/JSX code
- **Nested Components**: Support for container components with children
- **Component Selection**: Click to select and edit components

## Components Included

### Layout
- Container - Responsive container with size options
- Group - Horizontal layout with flex properties
- Stack - Vertical layout with gap controls
- Card - Card container with shadow and border options

### Inputs
- Button - Interactive button with variants and sizes
- TextInput - Text input field with label and validation

### Typography
- Text - Text display with size and weight controls
- Title - Heading elements (h1-h6)

## Installation

Make sure you have the required dependencies:

```bash
npm install @mantine/core @mantine/hooks @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities zustand
```

## Usage

```tsx
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { VisualBuilder } from './visual-builder';

function App() {
  return (
    <MantineProvider>
      <VisualBuilder height="100vh" />
    </MantineProvider>
  );
}
```

## File Structure

```
visual-builder/
├── components/
│   ├── VisualBuilder.tsx          # Main component
│   ├── Canvas/
│   │   ├── Canvas.tsx             # Drop area and component rendering
│   │   └── ComponentRenderer.tsx  # Individual component renderer
│   ├── ComponentPalette/
│   │   ├── ComponentPalette.tsx   # Component selector sidebar
│   │   └── ComponentPaletteItem.tsx # Draggable component items
│   ├── PropertyEditor/
│   │   ├── PropertyEditor.tsx     # Property editing sidebar
│   │   └── PropertyForm.tsx       # Form controls for properties
│   └── CodeExporter/
│       ├── CodeExporter.tsx       # Code export modal
│       └── codeGenerator.ts       # JSX code generation logic
├── config/
│   └── componentRegistry.ts       # Component definitions and properties
├── hooks/
│   ├── useDragAndDrop.ts         # Drag and drop logic
│   └── useSelection.ts           # Component selection logic
├── store/
│   └── visualBuilderStore.ts     # Zustand state management
├── types/
│   └── index.ts                  # TypeScript interfaces
└── index.ts                      # Main exports
```

## Technical Details

- **State Management**: Zustand for simple, performant state management
- **Drag & Drop**: @dnd-kit for accessible drag and drop
- **UI Library**: Mantine for consistent, modern components
- **Code Generation**: Clean JSX output with proper formatting
- **TypeScript**: Full type safety throughout

## Extending

To add new components:

1. Add component config to `componentRegistry.ts`
2. Add rendering logic to `ComponentRenderer.tsx`
3. Define property definitions for the property editor

The system is designed to be easily extensible with new component types and properties.