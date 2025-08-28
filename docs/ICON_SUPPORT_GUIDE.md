# Icon Library Support Guide

Story UI now includes comprehensive, universal icon library support that works with ANY design system's icons.

## Overview

The new icon system can automatically detect and handle icons from various sources:
- **React Components** (lucide-react, @heroicons/react, react-icons)
- **Data Objects** (@workday/canvas-system-icons-web)
- **SVG Files** (feather-icons)
- **Font Icons** (bootstrap-icons, fontawesome)
- **Icon Sprites** (custom sprite sheets)

## Features

### Auto-Detection
Story UI automatically detects icon libraries in your `package.json` and configures them appropriately.

### Universal Support
Works with any icon library structure without requiring library-specific code.

### Smart Import Handling
Generates correct import statements based on icon type (component, data, SVG, etc.).

### Intelligent Suggestions
Provides fuzzy matching and suggestions for mistyped icon names.

### Caching
Caches discovered icons for faster subsequent loads.

## Setup

### 1. Install Your Icon Library

```bash
# Examples
npm install @heroicons/react
npm install lucide-react
npm install @workday/canvas-system-icons-web
npm install react-icons
```

### 2. Run Story UI

The icon discovery will happen automatically:

```bash
npx story-ui
```

You'll see output like:
```
🎨 Discovering icon libraries...
✅ Detected icon library: @heroicons/react (component icons)
✅ Detected icon library: lucide-react (component icons)
📦 Found 264 icons in @heroicons/react
📦 Found 287 icons in lucide-react
✅ Total icons loaded: 551 from 2 libraries
```

### 3. Use Icons in Your Stories

Icons are available with the `Icon:` prefix:

```javascript
// In your prompt to Story UI
"Create a button with Icon:ChevronRight"
"Add Icon:Settings to the navigation"
"Use Icon:CheckCircle for success state"
```

## Configuration (Optional)

While auto-detection works for most cases, you can provide custom configuration:

### Create `.story-ui/icon-config.json`

```json
{
  "iconLibraries": [
    {
      "packageName": "@workday/canvas-system-icons-web",
      "type": "data",
      "wrapper": "SystemIcon",
      "wrapperImport": "@workday/canvas-kit-react/icon"
    }
  ],
  "customIconSources": [
    {
      "name": "Project Icons",
      "path": "./src/icons",
      "type": "svg",
      "pattern": "*.svg"
    }
  ],
  "iconAliases": {
    "check": "CheckIcon",
    "close": "XIcon"
  }
}
```

## Icon Types

### Component Icons (React Components)

Libraries like `lucide-react`, `@heroicons/react`:

```jsx
import { ChevronRight } from 'lucide-react';
<ChevronRight size={24} color="currentColor" />
```

### Data Icons (Objects)

Libraries like Canvas Kit icons:

```jsx
import { checkIcon } from '@workday/canvas-system-icons-web';
import { SystemIcon } from '@workday/canvas-kit-react/icon';
<SystemIcon icon={checkIcon} size={24} />
```

### SVG Icons

Direct SVG imports:

```jsx
import CheckSvg from './icons/check.svg';
<img src={CheckSvg} alt="Check" width={24} height={24} />
```

### Font Icons

CSS-based icons:

```jsx
<i className="bi bi-check-circle" style={{ fontSize: '24px' }}></i>
```

## Common Icon Libraries

### Supported Out-of-the-Box

| Library | Type | Import Example |
|---------|------|----------------|
| @workday/canvas-system-icons-web | Data | `import { checkIcon } from '@workday/canvas-system-icons-web/dist/svg'` |
| @heroicons/react | Component | `import { CheckIcon } from '@heroicons/react/24/solid'` |
| lucide-react | Component | `import { Check } from 'lucide-react'` |
| react-icons | Component | `import { FaCheck } from 'react-icons/fa'` |
| @tabler/icons-react | Component | `import { IconCheck } from '@tabler/icons-react'` |
| @mui/icons-material | Component | `import CheckIcon from '@mui/icons-material/Check'` |
| @ant-design/icons | Component | `import { CheckOutlined } from '@ant-design/icons'` |
| phosphor-react | Component | `import { Check } from 'phosphor-react'` |
| feather-icons | SVG | `import feather from 'feather-icons'` |
| bootstrap-icons | Font | CSS classes like `bi-check` |

### Adding Custom Icon Libraries

If your icon library isn't auto-detected, add it to the configuration:

```json
{
  "iconLibraries": [
    {
      "packageName": "your-icon-library",
      "type": "component", // or "data", "svg", "font"
      "importPattern": "your-icon-library/icons",
      "iconNamePattern": "^Icon" // Optional regex pattern
    }
  ]
}
```

## Using Icons in Generated Stories

When Story UI generates stories with icons, it will:

1. **Detect the icon type** from your library
2. **Generate correct imports** based on the type
3. **Create appropriate JSX** for rendering
4. **Add suitable controls** in Storybook

Example generated story with icons:

```jsx
import type { Meta, StoryObj } from '@storybook/react';
import { CheckCircle } from 'lucide-react';

export const Success: Story = {
  args: {
    icon: <CheckCircle size={20} />,
    message: 'Operation completed successfully'
  }
};
```

## Troubleshooting

### Icons Not Detected

1. Check that the icon library is in your `package.json`
2. Run `npm install` to ensure it's installed
3. Clear the cache: `rm -rf .story-ui/icon-manifest.json`
4. Restart Story UI

### Wrong Icon Type

If icons are detected but not rendering correctly:

1. Check the icon library documentation for the correct import method
2. Add explicit configuration in `.story-ui/icon-config.json`
3. Specify the correct `type` (component, data, svg, font)

### Performance Issues

For projects with many icons:

1. The first load will scan all icons (this is cached)
2. Subsequent loads use the cached manifest
3. You can limit discovery to specific packages in configuration

## Migration from Canvas-Specific Code

If you were using Canvas Kit-specific icon code:

### Before (Canvas-specific):
```javascript
// Only worked with Canvas Kit icons
import { checkIcon } from '@workday/canvas-system-icons-web';
```

### After (Universal):
```javascript
// Works with ANY icon library
// Canvas Kit icons
"Use Icon:checkIcon from Canvas"

// Heroicons
"Use Icon:CheckIcon from Heroicons"

// Lucide
"Use Icon:Check from Lucide"
```

## Advanced Usage

### Custom Icon Wrappers

For design systems with custom icon components:

```json
{
  "iconLibraries": [
    {
      "packageName": "your-design-system",
      "type": "data",
      "wrapper": "YourIconComponent",
      "wrapperImport": "your-design-system/components/Icon",
      "transformProps": {
        "size": "dimension",
        "color": "fill"
      }
    }
  ]
}
```

### Icon Categories

Organize icons by category:

```json
{
  "iconCategories": {
    "navigation": ["Home", "Menu", "Search"],
    "actions": ["Save", "Delete", "Edit"],
    "status": ["Success", "Warning", "Error"]
  }
}
```

### Batch Icon Stories

Generate stories for multiple icons at once:

```javascript
// In your prompt
"Create a story showcasing all navigation icons: Icon:Home, Icon:Menu, Icon:Search"
```

## Best Practices

1. **Use semantic names**: `Icon:Save` instead of `Icon:FloppyDisk`
2. **Consistent sizing**: Stick to a size scale (16, 20, 24, 32, etc.)
3. **Accessibility**: Always provide alt text or aria-labels
4. **Performance**: Use icon fonts or sprites for large icon sets
5. **Organization**: Group related icons in stories

## API Reference

### IconLibraryDiscovery

Main class for icon discovery:

```typescript
class IconLibraryDiscovery {
  constructor(projectRoot: string)
  async autoDetectLibraries(): Promise<IconLibraryConfig[]>
  async loadAllIcons(): Promise<void>
  hasIcon(name: string): boolean
  getIcon(name: string): IconMetadata | null
  getSuggestions(name: string, limit?: number): string[]
}
```

### IconMetadata

Icon information structure:

```typescript
interface IconMetadata {
  name: string
  type: 'component' | 'data' | 'svg' | 'font' | 'sprite'
  importPath?: string
  category?: string
  aliases?: string[]
  keywords?: string[]
}
```

## Contributing

To add support for a new icon library:

1. Add detection pattern in `iconLibraryDiscovery.ts`
2. Add type detection in `detectIconTypeFromPackage()`
3. Add import/render logic in `iconStoryRenderer.ts`
4. Submit a PR with the changes

## Support

For issues or questions about icon support:
- Open an issue on GitHub
- Check existing icon configurations in `templates/icon-config-example.json`
- Review the troubleshooting section above
