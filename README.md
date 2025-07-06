# Story UI 🎨

*AI-powered Storybook story generator for any React component library*

[![npm version](https://badge.fury.io/js/%40tpitre%2Fstory-ui.svg)](https://badge.fury.io/js/%40tpitre%2Fstory-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Story UI revolutionizes component documentation by automatically generating Storybook stories through AI-powered conversations. Simply chat with the AI about your components and watch as comprehensive stories are created in real-time.

## ✨ Features

### 🎯 Core Features
- **AI-Powered Story Generation**: Chat with AI to create comprehensive Storybook stories
- **Real-time Documentation Access**: Integrated with [Context7](https://context7.com/) for up-to-date component docs
- **Multi-Component Library Support**: Works with any React component library
- **Real-time Story Updates**: See your stories appear in Storybook instantly
- **Intelligent Component Discovery**: Automatically finds and analyzes your components
- **TypeScript Support**: Full TypeScript integration with type-aware story generation

### 🚀 Context7 Integration (New!)
- **No Setup Required**: Documentation is fetched automatically via Context7
- **Always Current**: Real-time access to the latest component APIs
- **No Deprecated Components**: Context7 ensures only valid, current components are used
- **Rich Examples**: Access to curated examples and best practices

### 🎨 Advanced Features
- **Memory-Persistent Stories**: Stories are remembered across sessions
- **Git Integration**: Automatic gitignore management for generated files
- **Production Mode**: Clean deployment without generated stories
- **Multiple Instance Support**: Run different design systems in parallel
- **Hot Reload Integration**: Stories update automatically as you chat

## 🚀 Quick Start

```bash
# Install Story UI
npm install -D @tpitre/story-ui

# Add to your package.json scripts
"story-ui": "story-ui start"

# Start generating stories (Story UI will pick 4001 or the next free port)
npm run story-ui

# Need a custom port? Just pass the flag:
npm run story-ui -- --port 4005
```

Story UI will automatically:
- ✅ Connect to Context7 for real-time documentation
- ✅ Discover your components
- ✅ Set up the chat interface
- ✅ Generate stories as you type

## 📚 How It Works

Story UI leverages [Context7](https://context7.com/)'s comprehensive library documentation to ensure generated stories use only valid, current components. When you request a story:

1. **Component Discovery**: Story UI scans your codebase for available components
2. **Documentation Fetch**: Context7 provides real-time API documentation
3. **AI Generation**: Claude generates stories using only documented components
4. **Validation**: Stories are validated against the actual component library
5. **Hot Reload**: Stories appear instantly in your Storybook

## 🎯 Configuration

### Basic Configuration (`story-ui.config.js`)

```javascript
export default {
  // Component library import path
  importPath: '@shopify/polaris',

  // Component discovery patterns
  patterns: ['src/**/*.{ts,tsx,js,jsx}'],
  excludePatterns: [
    'src/**/*.stories.{ts,tsx,js,jsx}',
    'src/**/*.test.{ts,tsx,js,jsx}'
  ],

  // Output configuration
  storyPath: 'src/stories',
  outputPath: 'src/stories/generated',

  // Server configuration
  port: 4001,

  // Storybook integration
  storybook: {
    port: 6006,
    url: 'http://localhost:6006'
  }
};
```

## 🌟 Supported Design Systems

Story UI works with any React component library. Context7 provides enhanced documentation for:

| Design System | Package | Context7 Docs |
|--------------|---------|---------------|
| Shopify Polaris | `@shopify/polaris` | ✅ [Available](https://context7.com/shopify/polaris) |
| Material-UI | `@mui/material` | ✅ Available |
| Ant Design | `antd` | ✅ Available |
| Chakra UI | `@chakra-ui/react` | ✅ Available |
| Mantine | `@mantine/core` | ✅ Available |
| And many more... | | |

## 📱 Examples

### Simple Component Story

```
You: "Create a button story with different variants"

AI: "I'll create a comprehensive Button story with all available variants..."
```

Result:
```tsx
export const AllVariants = {
  render: () => (
    <BlockStack gap="400">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="tertiary">Tertiary</Button>
      <Button variant="plain">Plain</Button>
    </BlockStack>
  )
};
```

### Complex Layout Story

```
You: "Create a product card with image, title, price, and add to cart button"

AI: "I'll create a product card using Polaris components..."
```

The AI will use only valid, current components from the design system, automatically avoiding any deprecated components.

## 🔧 Advanced Features

### Context7 Documentation

Story UI automatically fetches documentation from Context7, providing:
- Component descriptions and props
- Valid variants and options
- Usage examples
- Best practices

No configuration needed - it just works!

### Component Validation

All generated stories are validated to ensure:
- ✅ Only existing components are imported
- ✅ Props match component interfaces
- ✅ No deprecated components are used
- ✅ Import paths are correct

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone and install
git clone https://github.com/southleft/story-ui.git
cd story-ui
npm install

# Build and link for development
npm run build
npm link

# Test in a project
cd your-project
npm link @tpitre/story-ui
```

## 📄 License

MIT © [Story UI Contributors](LICENSE)

## 🔗 Links

- [GitHub Repository](https://github.com/southleft/story-ui)
- [NPM Package](https://www.npmjs.com/package/@tpitre/story-ui)
- [Context7 Documentation](https://context7.com/)
- [Issues & Support](https://github.com/southleft/story-ui/issues)

---

*Story UI - Making component documentation delightful, one conversation at a time.* ✨

## ✨ Context7 Integration

Story UI includes **Context7 integration** for real-time, up-to-date component documentation:

- 🔄 **Real-time Documentation** - Always uses current component APIs and props
- 🚫 **Deprecated Component Prevention** - Automatically avoids outdated components
- 📚 **Multiple Story Variants** - Generates 5-12 story examples per component
- 🎯 **Library-Specific Props** - Uses correct props for each design system
- ⚡ **Enhanced Story Quality** - Modern CSF 3.0 format with TypeScript
- 🏗️ **Environment-Specific** - Each Storybook environment has its own Context7 configuration

### Supported Design Systems with Context7

- ✅ **Shopify Polaris** - Full Context7 integration
- ✅ **Mantine** - Enhanced component discovery
- ✅ **Ant Design** - Library-specific props and variants
- ✅ **Adobe Spectrum** - Real-time documentation integration
- ✅ **Material-UI** - Component API validation
- ✅ **Chakra UI** - Design token integration
- 🔧 **Custom Systems** - Environment-specific Context7 configuration support
- 🔄 **Chakra UI** - Coming soon

## Features

- 🤖 **AI-powered story generation** with Claude integration
- 📱 **Multi-instance support** for different component libraries
- 🎨 **Branded Storybook customization**
- 🔍 **Automatic component discovery**
- 📋 **Configurable component blacklisting**
- 🎯 **Design system specific layouts and patterns**
- 💾 **In-memory story management** for production environments
- 🔄 **Real-time Context7 documentation integration**

## Quick Start

```bash
# Install Story UI
npm install @tpitre/story-ui

# Initialize in your project
npx story-ui init

# Start the Story UI server
npm run story-ui

# Start Storybook with Story UI
npm run storybook-with-ui
```

## Configuration

### Basic Configuration

Create a `story-ui.config.js` file in your project root:

```javascript
module.exports = {
  importPath: '@your/component-library',
  generatedStoriesPath: './src/stories/generated',
  storyPrefix: 'Generated/',
  defaultAuthor: 'Your Team',

  // Enable Context7 integration (default: enabled)
  context7: {
    enabled: true,
    cacheEnabled: true,
    timeout: 10000
  },

  layoutRules: {
    multiColumnWrapper: 'Grid',
    columnComponent: 'GridItem',
    containerComponent: 'Container'
  }
};
```

### Context7 Configuration Options

```javascript
{
  context7: {
    enabled: true,           // Enable Context7 integration
    cacheEnabled: true,      // Cache documentation for performance
    timeout: 10000,          // API timeout in milliseconds
    apiUrl: 'custom-url'     // Custom Context7 API URL (optional)
  }
}
```

## Usage

### Story Generation with Context7

Context7 integration automatically:

1. **Fetches Real-time Documentation** - Gets current component APIs
2. **Validates Components** - Ensures only valid, non-deprecated components
3. **Generates Multiple Variants** - Creates comprehensive story examples
4. **Uses Correct Props** - Applies library-specific properties

### Example Generated Stories

**Mantine Button with Context7:**
```typescript
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@mantine/core';

const meta = {
  title: 'Generated/Button Variants',
  component: Button,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {
  args: { variant: 'filled', children: 'Filled Button' }
};

export const Outline: Story = {
  args: { variant: 'outline', children: 'Outline Button' }
};

export const Gradient: Story = {
  args: {
    variant: 'gradient',
    gradient: { from: 'blue', to: 'cyan', deg: 90 },
    children: 'Gradient Button'
  }
};

// ... 8 more variants automatically generated
```

**Ant Design Button with Context7:**
```typescript
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from 'antd';

const meta = {
  title: 'Generated/Button Types',
  component: Button,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { type: 'primary', children: 'Primary Button' }
};

export const Dashed: Story = {
  args: { type: 'dashed', children: 'Dashed Button' }
};

// ... more Ant Design specific variants
```

### Story UI Panel

Access the Story UI panel in Storybook to:
- Generate new stories with AI assistance
- Browse and manage existing stories
- Get real-time component documentation
- Preview Context7 enhanced suggestions

## Advanced Features

### Multi-Instance Support

Run multiple Story UI instances for different design systems:

```bash
# Terminal 1: Polaris (port 6006, MCP 4001)
cd polaris-project && npm run storybook-with-ui

# Terminal 2: Mantine (port 6007, MCP 4002)
cd mantine-project && story-ui start --port=4002 && storybook dev -p 6007

# Terminal 3: Ant Design (port 6008, MCP 4003)
cd antd-project && story-ui start --port=4003 && storybook dev -p 6008
```

### Production Deployment

Story UI automatically detects production environments and:
- Uses in-memory story generation
- Disables file system writes
- Provides read-only story browsing
- Maintains full Context7 integration

### Custom Prompts and Considerations

Create `story-ui-considerations.md` to guide AI generation:

```markdown
# Design System Considerations

## Component Usage
- Always use design tokens for spacing (e.g., `gap="size-200"`)
- Prefer semantic color names over hex values
- Include accessibility props (aria-label, alt text)

## Story Structure
- Create multiple variants showing different states
- Include edge cases (loading, error, empty states)
- Use realistic content and data
- Follow Context7 documentation patterns
```

## API Reference

### Context7Integration Class

```typescript
import { Context7Integration } from '@tpitre/story-ui';

const context7 = new Context7Integration({
  apiUrl: 'https://api.context7.com',
  timeout: 10000
});

// Get documentation for a library
const docs = await context7.getDocumentation('@mantine/core');

// Check if component is valid and current
const isValid = context7.isValidComponent('@mantine/core', 'Button');

// Get Storybook best practices
const storybookDocs = await context7.getStorybookDocumentation();
```

### Configuration Types

```typescript
interface Context7Config {
  enabled?: boolean;
  apiUrl?: string;
  timeout?: number;
  cacheEnabled?: boolean;
}

interface StoryUIConfig {
  // ... other config options
  context7?: Context7Config;
}
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Story UI** - Generate better stories faster with AI and real-time documentation integration.
