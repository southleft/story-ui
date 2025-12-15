# Story UI

*AI-powered Storybook story generator for any JavaScript framework*

[![npm version](https://badge.fury.io/js/%40tpitre%2Fstory-ui.svg)](https://badge.fury.io/js/%40tpitre%2Fstory-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Story UI revolutionizes component documentation by automatically generating Storybook stories through AI-powered conversations. Works with **any framework** (React, Vue, Angular, Svelte, Web Components) and **any LLM provider** (Claude, OpenAI, Gemini).

## Why Story UI?

- **Framework Agnostic**: Works with React, Vue, Angular, Svelte, and Web Components
- **Multi-Provider AI**: Choose between Claude, OpenAI, or Google Gemini - always using the latest models
- **Design System Aware**: Learns your component library and generates appropriate code
- **Production Ready**: Deploy as a standalone web app with full MCP integration
- **Zero Lock-in**: Use any component library - Mantine, Vuetify, Angular Material, Shoelace, or your own

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

### Core Capabilities
- **AI-Powered Story Generation**: Describe what you want in natural language
- **Intelligent Iteration**: Modify existing stories without losing your work
- **Real-time Preview**: See generated stories instantly in Storybook
- **TypeScript Support**: Full type-aware story generation
- **Vision Support**: Attach screenshots for visual component requests

### Story Management
- **Edit Existing Stories**: Modify any generated story through conversation
- **Delete Stories**: Remove stories directly from the Story UI panel
- **Orphan Detection**: Find and clean up stories without associated chat history
- **Full MCP Integration**: Manage stories via Claude Desktop or any MCP-compatible client

### Multi-Framework Support

| Framework | Design Systems | Status |
|-----------|---------------|--------|
| React | Mantine, Chakra UI, Material UI, Custom | Fully Supported |
| Vue | Vuetify, Custom | Fully Supported |
| Angular | Angular Material, Custom | Fully Supported |
| Svelte | Flowbite-Svelte, Custom | Fully Supported |
| Web Components | Shoelace, Custom | Fully Supported |

### Multi-Provider LLM Support

| Provider | Models | Best For |
|----------|--------|----------|
| **Claude** (Anthropic) | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5 | Complex reasoning, code quality |
| **GPT** (OpenAI) | gpt-5.2, gpt-5.1, gpt-4o, gpt-4o-mini | Versatility, latest capabilities |
| **Gemini** (Google) | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash | Fast generation, cost efficiency |

### Production Deployment
- **Railway**: Node.js backend with file-based story persistence
- **MCP Integration**: Connect AI clients directly to production

---

## Installation Options

### Option 1: Interactive Setup (Recommended)

```bash
npx story-ui init
```

The interactive installer will ask:

1. **Framework Selection**
   ```
   ? Which JavaScript framework are you using?
     > React
       Vue
       Angular
       Svelte
       Web Components
   ```

2. **Design System Selection** (varies by framework)
   ```
   # For React:
   ? Choose a design system:
     > Mantine - Most Popular
       Chakra UI
       Material UI
       Custom

   # For Vue:
   ? Choose a design system:
     > Vuetify - Most Popular
       Custom

   # For Angular:
   ? Choose a design system:
     > Angular Material - Most Popular
       Custom
   ```

3. **AI Provider Selection**
   ```
   ? Which AI provider do you prefer?
     > Claude (Anthropic) - Recommended
       OpenAI
       Google Gemini

   ? Enter your API key:
   ```

### Option 2: Manual Configuration

Create `story-ui.config.js` in your project root:

```javascript
export default {
  // Framework: 'react' | 'vue' | 'angular' | 'svelte' | 'web-components'
  framework: 'react',

  // Component library import path
  importPath: '@mantine/core',

  // Path to custom components
  componentsPath: './src/components',

  // Generated stories location
  generatedStoriesPath: './src/stories/generated/',

  // LLM provider configuration
  llmProvider: 'claude', // 'claude' | 'openai' | 'gemini'

  // Story configuration
  storyPrefix: 'Generated/',
  defaultAuthor: 'Story UI AI'
};
```

---

## Usage

### Basic Story Generation

Start the Story UI server:
```bash
npm run story-ui
```

Then describe what you want:
```
You: "Create a product card with image, title, price, and add to cart button"
```

Story UI generates:
```tsx
export const ProductCard = {
  render: () => (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Card.Section>
        <Image src="https://example.com/product.jpg" height={160} alt="Product" />
      </Card.Section>
      <Group justify="space-between" mt="md" mb="xs">
        <Text fw={500}>Product Name</Text>
        <Badge color="pink">On Sale</Badge>
      </Group>
      <Text size="sm" c="dimmed">$29.99</Text>
      <Button color="blue" fullWidth mt="md" radius="md">
        Add to Cart
      </Button>
    </Card>
  )
};
```

### Iterating on Stories

Continue the conversation to refine:
```
You: "Make the button green and add a quantity selector"
```

Story UI modifies only what you requested, preserving the rest.

### Using with Different Frameworks

**Vue Example:**
```
You: "Create a user profile card with avatar, name, and edit button"
```

Generates Vue template:
```vue
<template>
  <v-card class="mx-auto" max-width="400">
    <v-card-item>
      <v-avatar size="80">
        <v-img src="https://example.com/avatar.jpg" alt="User" />
      </v-avatar>
      <v-card-title>John Doe</v-card-title>
      <v-card-subtitle>Software Engineer</v-card-subtitle>
    </v-card-item>
    <v-card-actions>
      <v-btn color="primary" variant="outlined">Edit Profile</v-btn>
    </v-card-actions>
  </v-card>
</template>
```

**Angular Example:**
```
You: "Create a data table with sorting and pagination"
```

Generates Angular component:
```typescript
@Component({
  selector: 'app-data-table',
  template: `
    <mat-table [dataSource]="dataSource" matSort>
      <ng-container matColumnDef="name">
        <mat-header-cell *matHeaderCellDef mat-sort-header>Name</mat-header-cell>
        <mat-cell *matCellDef="let element">{{element.name}}</mat-cell>
      </ng-container>
      <!-- Additional columns -->
    </mat-table>
    <mat-paginator [pageSizeOptions]="[5, 10, 25]" showFirstLastButtons />
  `
})
export class DataTableComponent { }
```

---

## MCP Server Integration

Story UI includes a Model Context Protocol (MCP) server, allowing direct integration with AI clients like Claude Desktop and Claude Code.

### Claude Desktop Integration (Recommended)

The easiest way to connect is via Claude Desktop's built-in connector UI:

1. Open **Claude Desktop**
2. Go to **Settings** → **Connectors**
3. Click **"Add custom connector"**
4. Enter:
   - **Name**: `Story UI React` (or any descriptive name)
   - **URL**: Your deployed Railway URL + `/mcp-remote/mcp`
     - Example: `https://your-app-name.up.railway.app/mcp-remote/mcp`
5. Click **Add**
6. **Restart Claude Desktop**

> **Note**: The URL will be your own Railway deployment URL. See [Production Deployment](#production-deployment) to set up your instance.

**Multiple Projects**: If you have multiple Storybook projects, add a separate connector for each:
- `Story UI React` → `https://my-react-app.up.railway.app/mcp-remote/mcp`
- `Story UI Vue` → `https://my-vue-app.up.railway.app/mcp-remote/mcp`

Once connected, you'll have access to all Story UI tools directly in your Claude conversations:
- `generate-story` - Generate Storybook stories from natural language
- `list-components` - Discover available components
- `list-stories` - View existing stories
- `get-story` / `update-story` / `delete-story` - Manage stories
- `get-component-props` - Get component property information
- `test-connection` - Verify MCP connection

### Claude Code Integration

Connect via Claude Code's built-in MCP support:

```bash
# Add your production Railway deployment
claude mcp add --transport http story-ui-react https://your-react-app.up.railway.app/mcp-remote/mcp

# Add another project (if needed)
claude mcp add --transport http story-ui-vue https://your-vue-app.up.railway.app/mcp-remote/mcp

# For local development (default port is 4001)
claude mcp add --transport http story-ui-local http://localhost:4001/mcp-remote/mcp
```

### Manual Configuration (Advanced)

For running multiple local Story UI instances with different ports, configure your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "story-ui-react": {
      "command": "npx",
      "args": ["@tpitre/story-ui", "start", "--port", "4001"]
    },
    "story-ui-vue": {
      "command": "npx",
      "args": ["@tpitre/story-ui", "start", "--port", "4002"]
    },
    "story-ui-angular": {
      "command": "npx",
      "args": ["@tpitre/story-ui", "start", "--port", "4003"]
    }
  }
}
```

> **Note**: When using Claude Desktop, API keys are managed through your Anthropic account - no need to configure them in the MCP server.

### Starting the Local MCP Server

```bash
# Start with default port (4001)
npx story-ui start

# Or specify a custom port
npx story-ui start --port 4002
```

This starts the Story UI HTTP server with MCP endpoint at `http://localhost:<port>/mcp-remote/mcp`.

### Available MCP Commands

Once connected, you can use these commands in Claude Desktop:
- "Use Story UI to create a hero section with a CTA button"
- "List all available components in Story UI"
- "Generate a dashboard layout with sidebar navigation"
- "Show me the stories I've generated"

---

## Production Deployment

Story UI can be deployed as a standalone web application accessible from anywhere. We recommend Railway for its ease of use, but any Node.js hosting platform will work.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Deployment (e.g., Railway)           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Express MCP Server (Node.js)                ││
│  │  - Serves Storybook with Story UI addon                  ││
│  │  - API routes for story generation                       ││
│  │  - Multi-provider LLM support (Claude, OpenAI, Gemini)   ││
│  │  - File-based story persistence                          ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Deploy to Railway (Recommended)

Railway provides a straightforward deployment experience with automatic HTTPS and file-based story persistence.

**Quick Start:**

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

# Initialize and deploy from your Storybook project
railway init
railway up
```

**Environment Variables (set in Railway Dashboard):**
- `ANTHROPIC_API_KEY` - Required for Claude models
- `OPENAI_API_KEY` - Optional, for OpenAI models
- `GEMINI_API_KEY` - Optional, for Gemini models

**After Deployment:**

Your Railway app will have a URL like `https://your-app-name.up.railway.app`. Use this URL to connect MCP clients:

```bash
# In Claude Code
claude mcp add --transport http story-ui https://your-app-name.up.railway.app/mcp-remote/mcp
```

Or add it to Claude Desktop via **Settings** → **Connectors** → **Add custom connector**.

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions and troubleshooting.

---

## Design System Documentation

Story UI can learn your design system conventions to generate better stories.

### Directory-Based Documentation (Recommended)

Create a `story-ui-docs/` directory:

```
story-ui-docs/
├── README.md                    # Overview
├── guidelines/
│   ├── accessibility.md         # A11y guidelines
│   ├── responsive-design.md     # Responsive rules
│   └── brand-guidelines.md      # Brand usage
├── tokens/
│   ├── colors.json             # Color tokens
│   ├── spacing.md              # Spacing system
│   └── typography.json         # Typography
├── components/
│   ├── button.md               # Button documentation
│   └── forms.md                # Form patterns
└── patterns/
    ├── layouts.md              # Layout patterns
    └── data-tables.md          # Table patterns
```

### Single-File Documentation

For simpler setups, use `story-ui-considerations.md`:

```markdown
# Design System Considerations

## Color Usage
- Primary actions: blue.6
- Destructive actions: red.6
- Success states: green.6

## Component Preferences
- Use Button with variant="filled" for primary actions
- Use Card with shadow="sm" for content containers
```

---

## CLI Reference

```bash
# Initialize Story UI in your project
npx story-ui init

# Start the MCP server (default port: 4001)
npx story-ui start
npx story-ui start --port 4002  # Custom port

# Run MCP STDIO server (for Claude Desktop local integration)
npx story-ui mcp
```

---

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/story-ui/providers` | List available LLM providers and models |
| `POST` | `/story-ui/claude` | Generate with Claude |
| `POST` | `/story-ui/openai` | Generate with OpenAI |
| `POST` | `/story-ui/gemini` | Generate with Gemini |
| `GET` | `/story-ui/considerations` | Get design system context |

### Request Format

```typescript
{
  prompt: string;           // User's request
  model?: string;           // Specific model to use
  previousCode?: string;    // For iterations
  history?: Message[];      // Conversation history
  imageData?: string;       // Base64 image for vision
}
```

---

## Upgrading from v2

Story UI v4 is backwards compatible with previous configurations. However, to take advantage of new features:

1. **Multi-Provider Support**: Add `llmProvider` to your config
2. **Framework Detection**: Add `framework` to your config for non-React projects
3. **Production Deployment**: Use `npx story-ui deploy` for one-command deployment

No breaking changes - existing stories and configurations will continue to work.

---

## Contributing

We welcome contributions! See our [Contributing Guide](CONTRIBUTING.md).

### Development Setup

```bash
git clone https://github.com/southleft/story-ui.git
cd story-ui
npm install
npm run build
npm link

# Test in a project
cd your-project
npm link @tpitre/story-ui
```

---

## License

MIT © [Story UI Contributors](LICENSE)

---

## Links

- [GitHub Repository](https://github.com/southleft/story-ui)
- [NPM Package](https://www.npmjs.com/package/@tpitre/story-ui)
- [Issues & Support](https://github.com/southleft/story-ui/issues)
- [MCP Integration Guide](docs/MCP_INTEGRATION.md)
- [Deployment Guide](DEPLOYMENT.md)

---

*Story UI - Making component documentation delightful, one conversation at a time.*
