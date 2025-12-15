# Story UI - AI Assistant Project Guide

> **Last Updated**: December 14, 2025
> **Current Version**: 4.4.1
> **Production URL**: https://app-production-16de.up.railway.app (Vue/Vuetify example)
> **Repository**: https://github.com/southleft/story-ui

This document provides comprehensive context for AI assistants working on the Story UI codebase. It captures what the project is, how it works, architecture decisions, and development workflows to minimize token consumption during codebase analysis.

---

## What is Story UI?

**Story UI is an AI-powered Storybook story generator that works with ANY component library.** Users describe components in natural language, and the AI generates working Storybook stories using their design system's actual components.

### Core Value Proposition

- **Design-System Agnostic**: Works with React (Mantine, Chakra, MUI), Vue (Vuetify), Angular (Material), Svelte (Flowbite), Web Components (Shoelace)
- **Natural Language Interface**: "Create a card with a header, image, and action buttons"
- **Live Preview**: Generated stories appear instantly in Storybook
- **Multi-Provider LLM**: Supports Claude, OpenAI, and Gemini
- **Self-Healing Code Generation**: Validates generated code and auto-corrects errors via LLM retry loop

---

## Quick Reference

### Important Files

| Purpose | Location |
|---------|----------|
| MCP Server (Express) | `mcp-server/index.ts` |
| STDIO MCP Server | `mcp-server/mcp-stdio-server.ts` |
| Story Generation | `mcp-server/routes/generateStory.ts` |
| Streaming Generation | `mcp-server/routes/generateStoryStream.ts` |
| Self-Healing Loop | `story-generator/selfHealingLoop.ts` |
| Component Discovery | `story-generator/componentDiscovery.ts` |
| LLM Providers | `story-generator/llm-providers/` |
| Framework Adapters | `story-generator/framework-adapters/` |
| Storybook Panel | `templates/StoryUI/StoryUIPanel.tsx` |
| MDX Wrapper | `templates/StoryUI/StoryUIPanel.mdx` |
| CLI Entry | `cli/index.ts` |
| CLI Setup | `cli/setup.ts` |

### Quick Commands

```bash
# Build the package
npm run build

# Start MCP server locally
npm run story-ui

# Watch mode for development
npm run dev

# Run in test environment
cd /path/to/test-storybooks/react-mantine
PORT=4101 node /path/to/story-ui/dist/mcp-server/index.js
```

---

## Test Storybook Environments

Development and testing uses five framework-specific Storybook instances (create these in a sibling directory to story-ui):

| Directory | Framework | Design System | Storybook Port | MCP Port |
|-----------|-----------|---------------|----------------|----------|
| `react-mantine` | React 19 | Mantine 8.x | 6101 | 4101 |
| `angular-material` | Angular 21 | Material 21 | (ng run) | 4102 |
| `vue-vuetify` | Vue 3 | Vuetify 3.x | 6103 | 4103 |
| `svelte-flowbite` | Svelte 5 | Flowbite + Tailwind | 6104 | 4104 |
| `web-components-shoelace` | Lit 3 | Shoelace 2.x | 6105 | 4105 |

### Starting a Test Environment

```bash
# Example: React Mantine
cd ../test-storybooks/react-mantine

# Terminal 1: Start MCP server
PORT=4101 node ../story-ui/dist/mcp-server/index.js

# Terminal 2: Start Storybook
npm run storybook -- --port 6101
```

### Port Convention

- **Storybook**: 6100 series (6101, 6102, 6103, 6104, 6105)
- **MCP Server**: 4100 series (4101, 4102, 4103, 4104, 4105)

---

## MCP Server Architecture

### Two Operation Modes

**1. HTTP Server** (Primary for web/local development)
```
npm run story-ui  →  Express server on PORT (default: 4001)
                  →  Serves API endpoints
                  →  Optional Storybook proxy mode
```

**2. STDIO Server** (For Claude Desktop integration)
```
npm run mcp  →  MCP Server using stdio transport
             →  Makes HTTP calls to local HTTP server
             →  Requires HTTP server running on port 4001
```

### Server Startup Flow

```
1. Load .env configuration
2. Create Express app
3. Apply CORS middleware
4. Register API routes:
   - /mcp/generate-story (POST) - Story generation
   - /mcp/generate-story-stream (POST) - Streaming generation
   - /mcp/components (GET) - Component discovery
   - /mcp/providers (GET) - Available LLM providers
   - /story-ui/* - Aliased routes (proxy to /mcp/*)
   - /mcp-remote/* - Claude Desktop MCP endpoint
5. Load user configuration (story-ui.config.js)
6. Optional: Configure Storybook proxy (if STORYBOOK_PROXY_ENABLED=true)
7. Start listening on PORT
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp/components` | GET | List discovered components |
| `/mcp/generate-story` | POST | Generate story from prompt |
| `/mcp/generate-story-stream` | POST | Streaming story generation |
| `/mcp/providers` | GET | List available LLM providers |
| `/mcp/providers/models` | GET | List models per provider |
| `/story-ui/stories` | GET/POST | Story file management |
| `/mcp-remote/*` | POST | Claude Desktop MCP endpoint |

### Port Configuration Priority

The `StoryUIPanel.tsx` determines MCP server URL in this order:
1. `VITE_STORY_UI_EDGE_URL` - Cloud deployment
2. `window.__STORY_UI_EDGE_URL__` - Runtime override
3. Railway hostname detection - Same origin
4. `VITE_STORY_UI_PORT` - From .env file
5. `window.__STORY_UI_PORT__` - Legacy override
6. `window.STORY_UI_MCP_PORT` - MDX wrapper override
7. Default: `http://localhost:4001`

---

## Installation & Initialization Process

### What `npx story-ui init` Does

1. **Validates Project Structure**
   - Checks for `package.json`
   - Detects Storybook framework
   - Auto-detects design system from dependencies

2. **Interactive Setup** (prompts user for):
   - Design system selection (Mantine, Chakra, Vuetify, etc.)
   - Package installation confirmation
   - Generated stories path
   - Component prefix
   - MCP server port
   - LLM provider (Claude, OpenAI, Gemini)
   - API key (optional)

3. **Creates Files**:
   ```
   project-root/
   ├── story-ui.config.js          # Configuration file
   ├── .env                         # API keys and port
   ├── story-ui-considerations.md   # AI guidelines template
   ├── story-ui-docs/               # Documentation directory
   └── src/stories/
       ├── generated/               # AI-generated stories go here
       └── StoryUI/
           ├── StoryUIPanel.tsx     # Main panel component
           └── StoryUIPanel.mdx     # Cross-framework wrapper
   ```

4. **Updates package.json**:
   ```json
   {
     "scripts": {
       "story-ui": "story-ui start --port 4001",
       "storybook-with-ui": "concurrently \"npm run storybook\" \"npm run story-ui\""
     }
   }
   ```

5. **Sets up Storybook Preview** (creates `.storybook/preview.tsx` with provider wrapper)

6. **Cleans up** default Storybook template stories (Button, Header, Page)

### Configuration File Format

```javascript
// story-ui.config.js
module.exports = {
  importPath: "@mantine/core",
  componentPrefix: "",
  generatedStoriesPath: "./src/stories/generated/",
  storyPrefix: "Generated/",
  defaultAuthor: "Story UI AI",
  componentFramework: "react",
  storybookFramework: "@storybook/react-vite",
  llmProvider: "claude",
  layoutRules: {
    multiColumnWrapper: "SimpleGrid",
    columnComponent: "div",
    containerComponent: "Container"
  }
};
```

---

## Story Generation Flow

### Request → Response Pipeline

```
1. User submits prompt via StoryUIPanel
2. POST /mcp/generate-story with { prompt, provider, model }
3. Server loads configuration:
   - story-ui.config.js (paths, import path, layout rules)
   - Component discovery (available components from project)
   - Design considerations (AI guidelines from story-ui-docs/)
4. Build system prompt:
   - Universal best practices (responsive, accessible)
   - Design system considerations
   - Available components list
   - User's prompt
   - Conversation history (for iterations)
5. Call LLM API (Claude/OpenAI/Gemini)
6. Validate generated code:
   - TypeScript AST validation (syntax errors)
   - Pattern validation (forbidden patterns like UNSAFE_style)
   - Import validation (component exists in design system)
7. If errors: Self-healing loop (up to 3 retries)
8. Write .stories.tsx file to generatedStoriesPath
9. Return { storyId, fileName, title, story }
10. Storybook auto-detects new file via file watcher
```

### Self-Healing Loop (New Feature)

When validation fails, the system:
1. Aggregates errors (syntax, pattern, import)
2. Builds correction prompt with error details
3. Sends to LLM for fix
4. Validates again
5. Repeats up to 3 times or until no errors
6. Tracks error history to detect when LLM is stuck (same errors repeating)
7. If all attempts fail, selects best attempt (lowest error count)

**Key Files**:
- `story-generator/selfHealingLoop.ts` - Core utilities
- `story-generator/validateStory.ts` - TypeScript AST validation
- `story-generator/storyValidator.ts` - Pattern validation

---

## Codebase Structure

```
story-ui/
├── cli/                          # CLI commands
│   ├── index.ts                  # Main CLI entry (commands: init, start, deploy, mcp)
│   ├── setup.ts                  # Project setup utilities (~1150 lines)
│   └── deploy.ts                 # Deployment commands
│
├── mcp-server/                   # Express MCP server
│   ├── index.ts                  # Express app, routes, proxy setup
│   ├── mcp-stdio-server.ts       # STDIO server for Claude Desktop
│   └── routes/
│       ├── generateStory.ts      # Non-streaming generation with self-healing
│       ├── generateStoryStream.ts # Streaming generation with self-healing
│       ├── providers.ts          # LLM provider management
│       ├── components.ts         # Component discovery endpoints
│       ├── frameworks.ts         # Framework detection
│       └── mcpRemote.ts          # Claude Desktop MCP endpoint
│
├── story-generator/              # Core generation logic
│   ├── generateStory.ts          # Main generation function
│   ├── selfHealingLoop.ts        # Error correction utilities
│   ├── validateStory.ts          # TypeScript AST validation
│   ├── storyValidator.ts         # Pattern validation
│   ├── componentDiscovery.ts     # Component discovery
│   ├── configLoader.ts           # Configuration loading (30s cache)
│   ├── promptGenerator.ts        # Prompt building
│   ├── llm-providers/
│   │   ├── base-provider.ts      # Base class
│   │   ├── claude-provider.ts    # Claude/Anthropic
│   │   ├── openai-provider.ts    # OpenAI/GPT
│   │   └── gemini-provider.ts    # Google Gemini
│   └── framework-adapters/
│       ├── base-adapter.ts       # Base adapter
│       ├── react-adapter.ts      # React stories format
│       ├── vue-adapter.ts        # Vue stories format
│       ├── angular-adapter.ts    # Angular stories format
│       ├── svelte-adapter.ts     # Svelte stories format
│       └── web-components-adapter.ts # Web Components format
│
├── templates/                    # Storybook integration
│   └── StoryUI/
│       ├── StoryUIPanel.tsx      # Main panel component (~2900 lines)
│       ├── StoryUIPanel.mdx      # Cross-framework wrapper
│       ├── manager.tsx           # Addon registration
│       └── index.tsx             # Panel registration
│
├── dist/                         # Compiled output
└── test-storybooks/              # NOT IN THIS REPO - separate directory
```

---

## Cross-Framework Support

### The MDX Wrapper Solution

**Problem**: React component (`StoryUIPanel.tsx`) can't render in Vue/Angular/Svelte Preview iframes.

**Solution**: `StoryUIPanel.mdx` wrapper processed by `@storybook/addon-docs` which always uses React.

```mdx
<!-- StoryUIPanel.mdx -->
<Meta title="Story UI/Story Generator" />
<StoryUIPanel mcpPort={...} />
```

### Framework-Specific Configurations

**Angular**: Requires TypeScript config for TSX:
```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": ["src/**/*.tsx"]
}
```

---

## Environment Variables

### Local Development (.env)

```bash
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...      # optional
GEMINI_API_KEY=...         # optional
VITE_STORY_UI_PORT=4001
```

### Railway Production

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (auto-set by Railway) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `GEMINI_API_KEY` | Gemini API key (optional) |
| `STORYBOOK_PROXY_ENABLED` | Enable Storybook proxy mode |
| `STORYBOOK_PROXY_PORT` | Internal Storybook port (default: 6006) |

---

## Development Workflow

### Making Changes to Backend

1. Edit files in `mcp-server/` or `story-generator/`
2. Run `npm run build`
3. Test in test environment: `PORT=4101 node dist/mcp-server/index.js`

### Making Changes to StoryUIPanel

**Important**: Test environments import from npm package, not source files.

```bash
# From story-ui root:
npm run build  # or npm run dev for watch mode

# In test environment:
cd /path/to/test-storybooks/react-mantine
rm -rf node_modules/.vite  # Clear cache
npm run storybook
```

### If Changes Don't Appear

1. Ensure `npm run build` was run
2. Clear Vite cache: `rm -rf node_modules/.vite`
3. Restart Storybook
4. Hard refresh browser (Cmd+Shift+R)

---

## Common Pitfalls to Avoid

1. **Don't hardcode design systems** - Use `considerations.ts` for design-system-specific rules
2. **Don't forget CORS** - All API endpoints need CORS headers
3. **Don't skip prefill** - Always prefill with `<` to ensure JSX output
4. **Don't use .stories.tsx for panel in non-React** - Use MDX wrapper
5. **Don't forget Angular tsconfig for TSX** - Needs `"jsx": "react-jsx"`
6. **Don't use --port flag** - Use `PORT=4101` environment variable instead
7. **Don't expect changes without rebuild** - Always run `npm run build` after edits

---

## Issue History & Resolutions

### December 2025

| Issue | Root Cause | Resolution |
|-------|------------|------------|
| StoryUIPanel not rendering in non-React | React can't render in Vue/Angular/Svelte iframe | MDX wrapper processed by addon-docs |
| Angular TSX compilation error | @ngtools/webpack can't compile TSX | Added jsx config to tsconfig.json |
| Cloudflare Edge dead code | Unused ~150MB | Removed cloudflare-edge directory |
| Self-healing not working | Missing validation integration | Implemented full self-healing loop |

### November 2025

| Issue | Root Cause | Resolution |
|-------|------------|------------|
| White text on light background | LLM generating incorrect colors | Added universal best practices to prompt |
| LLM returning markdown | Missing assistant prefill | Added `<` prefill |

---

## LLM Provider Models

### Claude (Anthropic)
- `claude-opus-4-5-20251101` - Most capable (default)
- `claude-sonnet-4-5-20250929` - Recommended balance
- `claude-haiku-4-5-20251001` - Fast, economical
- `claude-sonnet-4-20250514` - Previous generation

### OpenAI
- `gpt-5.2` - Most capable (default)
- `gpt-5.1` - Previous generation
- `gpt-4o` - Fast multimodal
- `gpt-4o-mini` - Economical

### Gemini
- `gemini-2.5-pro` - Most capable (default)
- `gemini-2.5-flash` - Fast, efficient
- `gemini-2.0-flash` - Recommended for speed
- `gemini-1.5-pro` - Large context (2M tokens)

---

## Resources

- **Repository**: https://github.com/southleft/story-ui
- **NPM Package**: @tpitre/story-ui
- **Production Demo**: https://app-production-16de.up.railway.app
- **Deployment Repo**: https://github.com/tpitre/story-ui-mantine-live

---

*This document should be updated whenever significant changes are made to the codebase, architecture, or deployment process.*
