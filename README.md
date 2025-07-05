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

# Start generating stories
npm run story-ui
```

That's it! Story UI will automatically:
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
  port: 4000,

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
