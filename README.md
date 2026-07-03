# Story UI

*AI-powered Storybook story generator for any JavaScript framework and design system*

[![npm version](https://badge.fury.io/js/%40tpitre%2Fstory-ui.svg)](https://badge.fury.io/js/%40tpitre%2Fstory-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Story UI generates working Storybook stories from natural language. Describe what you want, and the AI writes production-ready story code using your design system's actual components. Works with **any framework** and **any component library**.

## Why Story UI?

- **Design-System Agnostic**: React, Vue, Angular, Svelte, Web Components — bring your own component library
- **Multi-Provider AI**: Claude, OpenAI, or Gemini with automatic model selection
- **Self-Healing Generation**: Validates generated code with TypeScript AST parsing and auto-corrects errors through an LLM retry loop
- **Voice Canvas**: Speak your component ideas and see them rendered live in Storybook
- **Storybook MCP Integration**: Fetches component docs and story patterns from Storybook's MCP addon for higher-quality output
- **Zero Lock-in**: Use Mantine, Vuetify, Angular Material, Shoelace, shadcn/ui, or your own components

---

## Quick Start

```bash
# Install Story UI
npm install -D @tpitre/story-ui

# Initialize in your project
npx story-ui init

# Start generating stories
npm run story-ui
```

Story UI will guide you through:
1. Selecting your JavaScript framework
2. Choosing a design system (or using your own)
3. Configuring your preferred AI provider
4. Setting up component discovery

---

## Features

### AI-Powered Story Generation
Describe what you want in natural language. Story UI generates complete, working Storybook stories using your design system's components with proper imports, props, and TypeScript types.

### Self-Healing Code Generation
When generated code has syntax errors, invalid imports, or forbidden patterns, Story UI automatically:
1. Validates with TypeScript AST parsing and pattern checking
2. Sends errors back to the LLM with correction context
3. Retries up to 3 times, tracking error history to detect stuck loops
4. Selects the best attempt if all retries fail

### Import Isolation (No Hallucinated Dependencies)
Every generated story is deterministically validated against an import allowlist: your design system's package (including scoped siblings and subpaths), the framework runtime, Storybook packages, and your configured icon package. The AI cannot introduce Tailwind, shadcn/ui, Radix, or any other library on its own — the **only** way to permit an additional package is to name it explicitly in `story-ui-considerations.md` (e.g. "Allowed additional imports: `@tabler/icons-react`"). Violations are caught before the file is written and routed through self-healing.

### Voice Canvas
A live playground mode where you speak component ideas and see them rendered instantly in Storybook. Uses browser speech recognition with auto-submit, streams generated code into the canvas in real time as the LLM produces it, and renders output through an iframe with `react-live`.

### Conversational Iteration
The panel is a real back-and-forth chat: the AI summarizes what it built, offers follow-up suggestions, and you refine in plain language. Generated stories appear in Storybook's sidebar without a page reload — click **Open in Storybook** to jump straight to the new story while keeping your conversation intact.

It works in the other direction too: when viewing any generated story, an **Edit in Story UI** button in Storybook's toolbar takes you back to that story's chat, ready to keep iterating (Storybook 9+).

### Vision Support
Attach screenshots or mockups to your prompt. The AI uses them as reference when generating components.

### Story Management
- Edit, delete, and organize generated stories from the panel
- Orphan detection for stories without chat history
- File-based manifest system for tracking generated assets

### Multi-Framework Support

| Framework | Design Systems | Status |
|-----------|---------------|--------|
| React | Mantine, Chakra UI, Material UI, shadcn/ui, Custom | Fully Supported |
| Vue | Vuetify, Custom | Fully Supported |
| Angular | Angular Material, Custom | Fully Supported |
| Svelte | Flowbite-Svelte, Custom | Fully Supported |
| Web Components | Shoelace, Custom | Fully Supported |

**Reference showcase environments** — the combinations we develop and test
against, chosen for component breadth so Story UI can compose virtually any
layout for any industry (fintech dashboards, e-commerce, marketing pages):

| Framework | Showcase Library | Why |
|-----------|-----------------|-----|
| React | [Mantine](https://mantine.dev) | 100+ components incl. charts, dates, dropzone — the broadest single-library surface |
| Vue 3 | [Vuetify](https://vuetifyjs.com) | The most complete Vue component suite |
| Angular | [Angular Material](https://material.angular.dev) | The canonical Angular library + CDK |
| Svelte 5 | [Flowbite-Svelte](https://flowbite-svelte.com) | Broad, actively maintained Svelte 5 components |
| Web Components | [Shoelace](https://shoelace.style) | The reference framework-agnostic component library |

### Custom Component Libraries (no npm package required)

Story UI is not limited to published packages. Components in local project
directories (`src/components`, `src/ui`, or a configured `componentsPath`) are
discovered automatically — including their prop types, extracted straight from
your source — listed to the AI as first-class "custom project components", and
imported into generated stories via their real relative paths. Off-the-shelf
and custom components compose together in the same story.

### Multi-Provider LLM Support

| Provider | Models | Default |
|----------|--------|---------|
| **Claude** (Anthropic) | Claude Opus 4.8, Claude Sonnet 5, Claude Haiku 4.5 | `claude-sonnet-5` |
| **GPT** (OpenAI) | GPT-5.5, GPT-5.4 Mini, GPT-5.4 Nano | `gpt-5.5` |
| **Gemini** (Google) | Gemini 3.1 Pro, Gemini 3.5 Flash, Gemini 3.1 Flash-Lite | `gemini-3.1-pro` |

---

## Installation

### Interactive Setup (Recommended)

```bash
npx story-ui init
```

The installer prompts for:
1. **Framework** — React, Vue, Angular, Svelte, or Web Components
2. **Design System** — framework-specific options (Mantine, Vuetify, Angular Material, etc.)
3. **AI Provider** — Claude (recommended), OpenAI, or Gemini
4. **Configuration** — paths, ports, and API keys

### Manual Configuration

Create `story-ui.config.js` in your project root:

```javascript
module.exports = {
  // Framework: 'react' | 'vue' | 'angular' | 'svelte' | 'web-components'
  componentFramework: 'react',

  // Component library import path
  importPath: '@mantine/core',

  // Generated stories location
  generatedStoriesPath: './src/stories/generated/',

  // LLM provider: 'claude' | 'openai' | 'gemini'
  llmProvider: 'claude',

  // Import style: 'barrel' (default) or 'individual'
  // Use 'individual' for libraries without barrel exports (shadcn/ui, Radix Vue, Angular Material)
  // Use 'barrel' for libraries with index.ts barrel exports (Mantine, Chakra, Vuetify)
  importStyle: 'barrel',

  // Story configuration
  storyPrefix: 'Generated/',
  defaultAuthor: 'Story UI AI',

  // Layout rules for multi-component compositions
  layoutRules: {
    multiColumnWrapper: 'SimpleGrid',
    columnComponent: 'div',
    containerComponent: 'Container',
  },
};
```

### Import Examples (Web Components / Custom Libraries)

For component libraries with non-standard import paths, use `importExamples` to teach the AI your patterns:

```javascript
module.exports = {
  framework: 'web-components',
  importPath: '../../../components',

  importExamples: [
    "import '../../../components/button/button'; // For <my-button>",
    "import '../../../components/card/card'; // For <my-card>",
  ],
};
```

---

## Usage

### Generating Stories

Start the Story UI server:
```bash
npm run story-ui
```

Open Storybook and navigate to the Story UI panel. Describe what you want:

```
Create a product card with image, title, price, and add to cart button
```

Story UI generates a complete `.stories.tsx` file using your design system's components, writes it to your generated stories directory, and Storybook indexes it live — no page reload. The chat replies with a summary of what was built and an **Open in Storybook** link that navigates directly to the new story.

### Iterating

Continue the conversation to refine:
```
Make the button green and add a quantity selector
```

Story UI modifies only what you requested, preserving the rest of the story.

Coming back later? Open any generated story and click **Edit in Story UI** in the toolbar — the panel opens with that story's conversation loaded.

### Voice Canvas

Switch to Voice Canvas mode in the panel header. Speak your component ideas and see them rendered live. The canvas uses `react-live` for instant rendering without page reloads.

---

## Storybook MCP Integration

Story UI can connect to [Storybook MCP](https://github.com/storybookjs/addon-mcp) (`@storybook/addon-mcp`) to fetch component documentation, UI building guidelines, and existing story patterns. This enhances generation quality by ensuring output matches your codebase.

### Setup

1. Install `@storybook/addon-mcp` and enable `experimentalComponentsManifest` in `.storybook/main.js`:

```javascript
export default {
  features: {
    experimentalComponentsManifest: true,
  },
  addons: [
    '@storybook/addon-mcp',
    // ... other addons
  ],
};
```

2. Add the Storybook URL to `story-ui.config.js`:

```javascript
module.exports = {
  // ... other config
  storybookMcpUrl: 'http://localhost:6006',
  storybookMcpTimeout: 5000,
};
```

When both Story UI and Storybook are running, context is fetched automatically during generation, resulting in more accurate component usage and consistent code style.

> **Zero-config option**: the panel's "Storybook MCP" toggle sends your Storybook's own URL with each request, so the addon works without setting `storybookMcpUrl` at all. With `experimentalComponentsManifest` enabled, Story UI also pulls the components manifest — curated story snippets and extracted props per component — which is the deepest knowledge source available for compiled component libraries.

---

## MCP Server Integration

Story UI includes a Model Context Protocol (MCP) server for direct integration with AI clients like Claude Desktop and Claude Code.

### Claude Desktop

1. Open **Claude Desktop** > **Settings** > **Connectors**
2. Click **Add custom connector**
3. Enter your deployment URL + `/mcp-remote/mcp`
4. Restart Claude Desktop

### Claude Code

```bash
# Production deployment
claude mcp add --transport http story-ui https://your-app.up.railway.app/mcp-remote/mcp

# Local development
claude mcp add --transport http story-ui-local http://localhost:4001/mcp-remote/mcp
```

### Available MCP Tools

Once connected, these tools are available in Claude conversations:
- `generate-story` — Generate Storybook stories from natural language
- `list-components` — Discover available components
- `list-stories` — View existing generated stories
- `get-story` / `update-story` / `delete-story` — Manage stories
- `get-component-props` — Get component property information
- `test-connection` — Verify MCP connection

### Local STDIO Server

For Claude Desktop local integration without a deployed server:

```json
{
  "mcpServers": {
    "story-ui": {
      "command": "npx",
      "args": ["@tpitre/story-ui", "mcp"]
    }
  }
}
```

This requires the HTTP server running on port 4001 (`npm run story-ui`).

---

## Production Deployment

Story UI can be deployed as a standalone web application. Railway is recommended for its simplicity.

### Deploy to Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

**Environment Variables:**
- `ANTHROPIC_API_KEY` — Required for Claude models
- `OPENAI_API_KEY` — Optional, for OpenAI models
- `GEMINI_API_KEY` — Optional, for Gemini models
- `STORYBOOK_PROXY_ENABLED` — Enable Storybook proxy mode for live demos
- `STORYBOOK_PROXY_PORT` — Internal Storybook port (default: 6006)

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions and troubleshooting.

---

## Teaching the AI Your Design System

Story UI reads two knowledge sources before every generation. They serve different purposes:

| Source | Answers | Examples |
|--------|---------|----------|
| `story-ui-docs/` | *What is this design system?* | Design tokens, component usage docs, brand guidelines |
| `story-ui-considerations.md` | *How should the AI use it?* | "Always use `size='sm'` for buttons in forms", "Never use raw hex colors", allowed extra imports |

### `story-ui-docs/` — Design System Documentation

Create a `story-ui-docs/` directory with guidelines, tokens, and component documentation. Story UI ingests **Markdown, MDX, JSON, YAML, XML, HTML, and plain text** — drop in exported design tokens or docs in whatever format you already have:

```
story-ui-docs/
├── guidelines/
│   ├── accessibility.md
│   └── responsive-design.md
├── tokens/
│   ├── colors.yaml
│   └── spacing.json
└── components/
    ├── button.md
    └── forms.mdx
```

Large files are truncated to a per-file budget with a total cap, and the cache invalidates automatically when any nested file changes.

### `story-ui-considerations.md` — AI Rules

Rules for how the AI must treat your design system: component preferences, prop conventions, things to avoid. This file is also the **only mechanism for permitting imports outside your design system** — a package mentioned here (e.g. `@tabler/icons-react`) passes import isolation; anything unmentioned is rejected.

---

## CLI Reference

```bash
npx story-ui init          # Initialize Story UI in your project
npx story-ui start         # Start the MCP server (default port: 4001)
npx story-ui mcp           # Start STDIO MCP server for Claude Desktop
npx story-ui status        # Check installation status and version
npx story-ui update        # Update Story UI files to latest version
```

---

## Environment Variables

```bash
# .env
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...         # optional
GEMINI_API_KEY=...            # optional
VITE_STORY_UI_PORT=4001
```

---

## API Reference

### Story Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/mcp/generate-story` | Generate story from prompt |
| `POST` | `/mcp/generate-story-stream` | Streaming story generation |
| `POST` | `/mcp/canvas-generate` | Generate + write voice canvas story |
| `POST` | `/mcp/canvas-save` | Save canvas to named story file |

### Component Discovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/mcp/components` | List discovered components |
| `GET` | `/mcp/props` | Get component props |
| `GET` | `/mcp/frameworks` | List supported frameworks |
| `GET` | `/mcp/frameworks/detect` | Detect current project framework |

### Story Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/mcp/stories` | List generated stories |
| `GET` | `/mcp/stories/:storyId` | Get a specific story |
| `GET` | `/mcp/stories/:storyId/content` | Get story file content |
| `DELETE` | `/mcp/stories/:storyId` | Delete a story |

### Provider Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/mcp/providers` | List available LLM providers |
| `GET` | `/mcp/providers/models` | List models per provider |
| `POST` | `/mcp/providers/configure` | Configure a provider |
| `POST` | `/mcp/providers/validate` | Validate an API key |
| `POST` | `/mcp/providers/model` | Set active model |

### Manifest

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/story-ui/manifest` | Get story manifest |
| `GET` | `/story-ui/manifest/poll` | Poll for manifest changes |
| `POST` | `/story-ui/manifest/reconcile` | Reconcile manifest with filesystem |
| `DELETE` | `/story-ui/manifest/:fileName` | Remove entry from manifest |

All endpoints are also available under the `/story-ui/` prefix.

### Request Format

```typescript
{
  prompt: string;           // User's request
  provider?: string;        // 'claude' | 'openai' | 'gemini'
  model?: string;           // Specific model ID
  previousCode?: string;    // For iterations
  history?: Message[];      // Conversation history
  imageData?: string;       // Base64 image for vision
}
```

---

## Contributing

We welcome contributions! See our [Contributing Guide](CONTRIBUTING.md).

### Development Setup

```bash
git clone https://github.com/southleft/story-ui.git
cd story-ui
npm install
npm run build

# Test in a consumer project (important: run from the consumer directory)
cd /path/to/your-storybook-project
PORT=4001 node /path/to/story-ui/dist/mcp-server/index.js
```

---

## License

MIT - [Story UI Contributors](LICENSE)

---

## Links

- [GitHub Repository](https://github.com/southleft/story-ui)
- [NPM Package](https://www.npmjs.com/package/@tpitre/story-ui)
- [Deployment Guide](DEPLOYMENT.md)
- [MCP Integration Guide](docs/MCP_INTEGRATION.md)
- [Issues & Support](https://github.com/southleft/story-ui/issues)
