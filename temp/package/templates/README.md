# Story UI Templates

This directory contains template files that are copied to your project during the Story UI setup process.

## Contents

### StoryUI/
- `StoryUIPanel.tsx` - The main Story UI interface component
- `StoryUIPanel.stories.tsx` - Storybook story configuration
- `index.tsx` - Export file for cleaner imports

## Installation

These files are automatically copied to your project when you run:

```bash
npx story-ui init
```

They will be installed to your configured stories directory (default: `./src/stories/generated/StoryUI/`).

## Customization

After installation, you can customize these components to match your design system:

1. Update the styles in `StoryUIPanel.tsx` to match your theme
2. Modify the story configuration in `StoryUIPanel.stories.tsx`
3. Add additional features or integrations as needed

## Note

These files are automatically added to your `.gitignore` during setup since they're part of the Story UI installation and can be regenerated.
