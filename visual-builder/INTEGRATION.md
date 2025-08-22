# Visual Builder Integration with Story UI

This document describes the integration between the Visual Builder and Story UI Panel that allows users to seamlessly move from AI-generated components to visual editing.

## Overview

The integration provides a complete workflow:

1. **AI Generation**: User describes a component in the Story UI chat
2. **Code Parsing**: AI-generated JSX is parsed into Visual Builder component structure
3. **Visual Editing**: User can switch to Visual Builder tab to edit visually
4. **Code Export**: User can export updated code back to Story UI or Storybook

## Components

### StoryUIPanel Enhancements

- Added tab navigation between "AI Chat" and "Visual Builder"
- "Send to Visual Builder" button appears after AI generates a component
- Automatic code extraction and storage for Visual Builder
- Integration with EmbeddedVisualBuilder component

### EmbeddedVisualBuilder

A compact version of the Visual Builder designed for embedding in other interfaces:

```tsx
<EmbeddedVisualBuilder
  initialCode={aiGeneratedCode}
  height="600px"
  showPalette={true}
  showProperties={true}
  onCodeExport={(code) => handleExportedCode(code)}
  compact={true}
/>
```

### AI Parser Utility

Converts AI-generated JSX code into Visual Builder's component structure:

```tsx
import { parseAIGeneratedCode } from './utils/aiParser';

const result = parseAIGeneratedCode(jsxCode);
// result.components - parsed component definitions
// result.errors - parsing errors
// result.warnings - compatibility warnings
```

## Parser Capabilities

The AI parser can handle:

- **Basic Components**: Button, TextInput, Text, Title, etc.
- **Layout Components**: Container, Group, Stack, Card
- **Props Extraction**: Automatically extracts component properties
- **Component Hierarchy**: Maintains parent-child relationships
- **Text Content**: Handles text content in components like Button and Text
- **Validation**: Warns about unknown components or properties

## Supported Patterns

### Simple Components
```jsx
<Button variant="filled" size="sm">Click me</Button>
```

### Layout Components
```jsx
<Stack gap="md">
  <TextInput label="Email" placeholder="Enter email" />
  <Button>Submit</Button>
</Stack>
```

### Complex Hierarchies
```jsx
<Card shadow="sm" padding="lg">
  <Stack gap="md">
    <Title order={2}>Form Title</Title>
    <Group justify="space-between">
      <Button variant="outline">Cancel</Button>
      <Button>Submit</Button>
    </Group>
  </Stack>
</Card>
```

## Integration Points

### 1. Code Storage
When AI generates a component, the code is stored in `lastGeneratedCode` state:

```tsx
if (data.code) {
  setLastGeneratedCode(data.code);
}
```

### 2. Tab Navigation
Users can switch between chat and visual editing:

```tsx
const [activeTab, setActiveTab] = useState<'chat' | 'visual'>('chat');
```

### 3. Visual Builder Loading
The EmbeddedVisualBuilder automatically loads AI-generated code:

```tsx
<EmbeddedVisualBuilder
  initialCode={lastGeneratedCode || undefined}
  onCodeExport={handleVisualBuilderExport}
/>
```

### 4. Code Export
Users can export edited code back to Story UI:

```tsx
const handleVisualBuilderExport = (code: string) => {
  // Could integrate with MCP API to update stories
  console.log('Exported code:', code);
};
```

## Error Handling

The integration includes robust error handling:

- **Parse Errors**: Show user-friendly error messages
- **Unknown Components**: Warn about components not in registry
- **Invalid Props**: Warn about unrecognized properties
- **Loading States**: Handle loading and error states gracefully

## Future Enhancements

1. **Bidirectional Sync**: Real-time sync between Visual Builder and generated stories
2. **Custom Components**: Support for user-defined component templates
3. **Style Extraction**: Parse CSS-in-JS and inline styles
4. **Component Library Integration**: Support for other component libraries
5. **Live Preview**: Real-time preview of changes in Storybook

## Usage Example

```tsx
// 1. User types in AI chat
"Create a login form with email, password fields and submit button"

// 2. AI generates code
const aiCode = `
<Card shadow="sm" padding="lg">
  <Stack gap="md">
    <Title order={2}>Login</Title>
    <TextInput label="Email" placeholder="Enter email" />
    <TextInput label="Password" type="password" />
    <Button>Login</Button>
  </Stack>
</Card>
`;

// 3. User clicks "Edit in Visual Builder"
// 4. Visual Builder loads with parsed components
// 5. User makes visual edits
// 6. Export updated code
```

## File Structure

```
visual-builder/
├── components/
│   ├── EmbeddedVisualBuilder.tsx    # Embeddable Visual Builder
│   └── VisualBuilder.tsx            # Enhanced main component
├── utils/
│   └── aiParser.ts                  # AI code parsing utility
├── store/
│   └── visualBuilderStore.ts        # Enhanced store with AI loading
├── example-integration.tsx          # Integration example
└── INTEGRATION.md                   # This documentation
```

## API Reference

### parseAIGeneratedCode(code: string)

Parses AI-generated JSX code into Visual Builder components.

**Returns:**
```tsx
{
  components: ComponentDefinition[];
  errors: string[];
  warnings: string[];
}
```

### EmbeddedVisualBuilder Props

- `initialCode?: string` - AI-generated code to load
- `height?: string | number` - Builder height (default: '600px')
- `showPalette?: boolean` - Show component palette (default: true)
- `showProperties?: boolean` - Show property editor (default: true)
- `onCodeExport?: (code: string) => void` - Export callback
- `compact?: boolean` - Compact mode for embedding (default: false)

### Visual Builder Store Actions

- `loadFromAI(components: ComponentDefinition[])` - Load parsed components
- `loadFromCode(code: string)` - Parse and load from JSX code
- Standard Visual Builder actions (add, remove, update components)