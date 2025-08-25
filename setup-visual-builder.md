# Visual Builder Setup for Fresh Storybook Installation

## Quick Setup Instructions

### 1. Prerequisites
- Story UI installed and linked (`npm link @tpitre/story-ui`)
- Story UI built (`npm run build` in Story UI directory)
- Story UI dev mode running (`npm run dev` in Story UI directory)

### 2. Create Required Files

In your Mantine Storybook, create these files:

#### `src/stories/StoryUI/StoryUIPanel.tsx`
Copy the entire file from the working installation, or create with this content:
- This file imports `EmbeddedVisualBuilder` from Story UI
- Key import line should be:
  ```typescript
  import { EmbeddedVisualBuilder } from '@tpitre/story-ui/dist/visual-builder';
  ```

#### `src/stories/StoryUI/StoryUIPanel.stories.tsx`
This creates the Story UI story in Storybook's sidebar:
```typescript
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import StoryUIPanel from './StoryUIPanel';

const meta = {
  title: 'Story UI',
  component: StoryUIPanel,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof StoryUIPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Generator: Story = {};
```

### 3. Verify Visual Builder Import

The Visual Builder is accessed through:
```typescript
import { EmbeddedVisualBuilder } from '@tpitre/story-ui/dist/visual-builder';
```

If you get import errors, check:
1. Is Story UI built? (`npm run build` in Story UI)
2. Is the npm link working? (`npm ls @tpitre/story-ui` in your Storybook)
3. Does the dist folder exist in Story UI?

### 4. Run Your Storybook

```bash
npm run storybook
```

You should now see:
- "Story UI" in the Storybook sidebar
- Generated stories have "Edit in Visual Builder" button
- Visual Builder opens when clicking the button

### 5. Troubleshooting

If Visual Builder doesn't appear:
1. Check browser console for errors
2. Verify Story UI MCP server is running (port 4001)
3. Make sure Story UI is built and linked correctly
4. Check that StoryUIPanel files are in the right location

### File Structure Required
```
your-mantine-storybook/
└── src/
    └── stories/
        └── StoryUI/
            ├── StoryUIPanel.tsx      # Main Story UI component
            └── StoryUIPanel.stories.tsx  # Storybook story definition
```