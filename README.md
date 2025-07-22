# Story UI 🎨

*AI-powered Storybook story generator for any React component library*

[![npm version](https://badge.fury.io/js/%40tpitre%2Fstory-ui.svg)](https://badge.fury.io/js/%40tpitre%2Fstory-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Story UI revolutionizes component documentation by automatically generating Storybook stories through AI-powered conversations. Simply chat with the AI about your components and watch as comprehensive stories are created in real-time.

## ✨ Features

### 🎯 Core Features
- **AI-Powered Story Generation**: Chat with AI to create comprehensive Storybook stories
- **Intelligent Iteration Support**: Modify existing stories without losing your work
- **Multi-Component Library Support**: Works with any React component library
- **Real-time Story Updates**: See your stories appear in Storybook instantly
- **Intelligent Component Discovery**: Automatically finds and analyzes your components
- **TypeScript Support**: Full TypeScript integration with type-aware story generation

### 📚 Documentation System (New!)
- **Auto-Generated Structure**: `npx story-ui init` creates a `story-ui-docs/` directory template
- **Directory-Based Documentation**: Organize design system docs in a structured directory
- **Multiple Format Support**: Markdown, JSON, HTML, and text files
- **Legacy Support**: Still supports single `story-ui-considerations.md` file
- **Auto-Discovery**: Automatically finds and loads documentation to enhance AI story generation

### 🎨 Advanced Features
- **Memory-Persistent Stories**: Stories are remembered across sessions
- **Git Integration**: Automatic gitignore management for generated files
- **Production Mode**: Clean deployment without generated stories
- **Auto Port Detection**: Automatically finds available ports
- **Hot Reload Integration**: Stories update automatically as you chat

## 🚀 Quick Start

```bash
# Install Story UI
npm install -D @tpitre/story-ui

# Initialize Story UI in your project
npx story-ui init

# Add to your package.json scripts
"story-ui": "story-ui start"

# Start generating stories (Story UI will pick 4001 or the next free port)
npm run story-ui

# Need a custom port? Just pass the flag:
npm run story-ui -- --port 4005
```

Story UI will automatically:
- ✅ Discover your components
- ✅ Set up the chat interface
- ✅ Create a `story-ui-docs/` directory structure for your design system documentation
- ✅ Generate stories as you type
- ✅ Load your design system documentation to enhance AI generation

## 📚 How It Works

Story UI uses advanced AI to understand your component library and generate appropriate stories:

1. **Component Discovery**: Story UI scans your codebase for available components
2. **Documentation Loading**: Reads your design system documentation (if available)
3. **AI Generation**: Claude generates stories using discovered components
4. **Iteration Support**: Previous code is preserved when modifying stories
5. **Hot Reload**: Stories appear instantly in your Storybook

## 🎯 Configuration

### Basic Configuration (`story-ui.config.js`)

```javascript
export default {
  // Component library import path
  importPath: 'your-component-library',
  
  // Path to your local components (for custom libraries)
  componentsPath: './src/components',
  
  // Generated stories location
  generatedStoriesPath: './src/stories/generated/',
  
  // Story configuration
  storyPrefix: 'Generated/',
  defaultAuthor: 'Story UI AI',
  
  // Layout rules for multi-column layouts
  layoutRules: {
    multiColumnWrapper: 'div',
    columnComponent: 'div',
    containerComponent: 'div'
  }
};
```

## 🌟 Officially Supported Design Systems

Story UI provides guided installation and automatic configuration for these design systems:

| Design System | Package | Auto Install | Pre-configured |
|--------------|---------|--------------|----------------|
| Ant Design | `antd` | ✅ Yes | ✅ Yes |
| Mantine | `@mantine/core` | ✅ Yes | ✅ Yes |
| Chakra UI | `@chakra-ui/react` | ✅ Yes | ✅ Yes |
| Custom | Any React library | ❌ Manual | ✅ Configurable |

When you run `npx story-ui init`, you can choose to automatically install and configure these design systems with optimized layout rules and component mappings.

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="tertiary">Tertiary</Button>
      <Button variant="plain">Plain</Button>
    </div>
  )
};
```

### Complex Layout Story

```
You: "Create a product card with image, title, price, and add to cart button"

AI: "I'll create a product card using your design system components..."
```

### Iterating on Existing Stories

```
You: "Make the buttons full width"

AI: "I'll modify the existing story to make the buttons full width..."
```

The AI will preserve your existing code and only modify what you requested!

## 📖 Documentation Support

### Directory-Based Documentation (Recommended)

Create a `story-ui-docs/` directory in your project root:

```
story-ui-docs/
├── README.md                    # Overview and getting started
├── guidelines/
│   ├── accessibility.md         # Accessibility guidelines
│   ├── responsive-design.md     # Responsive design rules
│   └── brand-guidelines.md      # Brand usage
├── tokens/
│   ├── colors.json             # Color tokens
│   ├── spacing.md              # Spacing system
│   └── typography.json         # Typography tokens
├── components/
│   ├── button.md               # Button documentation
│   └── forms.md                # Form component docs
└── patterns/
    ├── layouts.md              # Layout patterns
    └── data-tables.md          # Table patterns
```

Story UI will automatically discover and use this documentation to generate better stories.

### Legacy Single-File Documentation

You can still use a single `story-ui-considerations.md` file in your project root for simpler setups.

## 🔧 Advanced Features

### Story Version History

Every generated story is tracked with version history:
- Each iteration is saved with a timestamp
- Previous versions are linked for easy tracking
- History is stored in `.story-ui-history/` (git-ignored)

### Component Validation

All generated stories are validated to ensure:
- ✅ Only existing components are imported
- ✅ Props match component interfaces
- ✅ Import paths are correct
- ✅ TypeScript types are valid

### Production Mode

In production environments, Story UI operates in memory-only mode:
- No files are written to disk
- Stories are served from memory
- Clean deployment without generated files

## 🚀 CLI Commands

```bash
# Initialize Story UI in a new project
npx story-ui init

# Start the Story UI server
npx story-ui start

# Start on a specific port
npx story-ui start --port 4005

# Use a specific config file
npx story-ui start --config custom-config.js
```

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
- [Issues & Support](https://github.com/southleft/story-ui/issues)

---

*Story UI - Making component documentation delightful, one conversation at a time.* ✨

