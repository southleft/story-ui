# Story UI - Claude Code Project Guide

> **Last Updated**: December 3, 2025
> **Current Version**: 3.6.2
> **Production URL**: https://story-ui-demo.up.railway.app
> **Backend URL**: Railway with file-based story persistence

This document provides context for AI assistants working on the Story UI codebase. It captures project history, architecture decisions, resolved issues, and remaining work to prevent repeating past mistakes.

---

## Quick Reference

### Important Files

| Purpose | Location |
|---------|----------|
| MCP Server | `mcp-server/index.ts` |
| Story Generator | `story-generator/generateStory.ts` |
| Component Discovery | `story-generator/componentDiscovery.ts` |
| LLM Providers | `story-generator/llm-providers/` |
| Framework Adapters | `story-generator/framework-adapters/` |
| Storybook Panel (React) | `templates/StoryUI/StoryUIPanel.tsx` |
| MDX Wrapper (Cross-framework) | `templates/StoryUI/StoryUIPanel.mdx` |
| Production App Template | `templates/production-app/` |
| Detailed Roadmap | `ROADMAP.md` |
| Deployment Guide | `DEPLOYMENT.md` |

### Deployment Commands

```bash
# Build main package
npm run build

# Deploy to Railway (automatic via git push to deployment repo)
# Deployment repo: https://github.com/tpitre/story-ui-mantine-live
```

### Environment Variables (Railway)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (required for Claude provider) |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `GEMINI_API_KEY` | Gemini API key (optional) |
| `DEFAULT_MODEL` | Default Claude model |
| `PORT` | Server port (Railway sets automatically) |
| `STORYBOOK_PROXY_ENABLED` | Enable Storybook proxy mode |
| `STORYBOOK_PROXY_PORT` | Internal Storybook port (default: 6006) |

---

## Project Overview

### What is Story UI?

Story UI is an AI-powered Storybook story generator that works with ANY component library. Users describe components in natural language, and the AI generates working Storybook stories using their design system's actual components.

### Two Environments

#### 1. Local Storybook Environment (The Gold Standard)

The original implementation runs as a Storybook addon panel:
- **Location**: `templates/StoryUI/StoryUIPanel.tsx`
- **How it works**: Embedded panel in Storybook's addon area
- **Features**: Full MCP integration, file-based story generation, component discovery
- **Status**: Mature and working

#### 2. Production Web Environment

A deployed Storybook instance with Story UI:
- **Live URL**: https://story-ui-demo.up.railway.app
- **Deployment Repo**: https://github.com/tpitre/story-ui-mantine-live
- **Backend**: Express MCP server proxying Storybook dev server
- **Status**: Actively developed (December 2025)

---

## Architecture

### Production Environment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Railway Deployment                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Express MCP Server (Node.js)                ││
│  │  ┌───────────────────────────────────────────────────┐  ││
│  │  │  Storybook Dev Server (proxied, port 6006)        │  ││
│  │  │  - Story UI Addon Panel                            │  ││
│  │  │  - Chat Interface                                  │  ││
│  │  │  - Provider/Model Selection                        │  ││
│  │  │  - LocalStorage Persistence                        │  ││
│  │  └───────────────────────────────────────────────────┘  ││
│  │                                                          ││
│  │  API Routes:                                             ││
│  │  - GET  /story-ui/providers → Available providers/models ││
│  │  - POST /story-ui/generate  → Story generation           ││
│  │  - POST /story-ui/generate-stream → Streaming generation ││
│  │  - POST /mcp-remote/mcp → Claude Desktop MCP endpoint    ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │         File-based Story Persistence                     ││
│  │  - Stories saved to generated-stories/ directory         ││
│  │  - Chat history in localStorage                          ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
      ┌─────────┐    ┌─────────┐    ┌─────────┐
      │ Claude  │    │ OpenAI  │    │ Gemini  │
      │   API   │    │   API   │    │   API   │
      └─────────┘    └─────────┘    └─────────┘
```

### Key Components

1. **MCP Server (index.ts)**
   - Express server handling API routes
   - Storybook proxy for production deployment
   - MCP remote endpoint for Claude Desktop integration

2. **Story Generator**
   - Core generation logic with LLM providers
   - Framework adapters (React, Vue, Angular, Svelte, Web Components)
   - Component discovery and validation

3. **Considerations System**
   - Design-system-specific AI guidelines
   - Loaded from `considerations.ts` or config
   - Prevents wrong components/colors/patterns

---

## Feature Status

### Completed Features (Production)

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-provider LLM (Claude, OpenAI, Gemini) | ✅ | Provider selector in sidebar |
| Model selection | ✅ | Multiple models per provider |
| Component generation | ✅ | Live preview in Storybook |
| Conversation history | ✅ | LocalStorage persistence |
| Smart chat titles | ✅ | LLM-generated from first message |
| Image attachments | ✅ | Vision support for screenshots |
| Design considerations | ✅ | Loaded from config |
| Multi-framework support | ✅ | React, Vue, Angular, Svelte, Web Components |
| MCP Remote endpoint | ✅ | Claude Desktop integration via Streamable HTTP |
| Model/provider persistence | ✅ | User preferences saved to localStorage |

### Pending Features

| Feature | Priority | Notes |
|---------|----------|-------|
| Delete chat functionality | MEDIUM | UI exists, needs implementation |
| SSE streaming | MEDIUM | Backend ready, frontend needs integration |
| Two-way conversational AI | LOW | Intent preview, progress updates |
| PDF upload | LOW | For design specs |

---

## Issue History & Resolutions

### Resolved Issues (December 2025)

| Issue | Root Cause | Resolution |
|-------|------------|------------|
| StoryUIPanel not rendering in non-React Storybooks | React component can't render in Vue/Angular/Svelte Preview iframe | Created MDX wrapper (`StoryUIPanel.mdx`) processed by addon-docs which always uses React. Reference: Steve Dodier-Lazaro (Storybook team) |
| Angular Storybook TypeScript error | Angular @ngtools/webpack couldn't compile TSX files | Added `"jsx": "react-jsx"` to compilerOptions and `"src/**/*.tsx"` to include array in tsconfig.json |
| Model/provider not persisting | localStorage not properly syncing state | Fixed useLocalStorage hook with proper useEffect |
| Broken image preview | FileReader errors not handled gracefully | Added validation and error handling for file reading |
| Cloudflare Edge dead code | Unused ~150MB of Cloudflare Worker code | Removed cloudflare-edge directory completely |
| Test environment MDX importing local files | MDX files imported from `./StoryUIPanel` instead of npm package | Updated all test environment MDX files to import from `@tpitre/story-ui/panel` |
| Inconsistent port configurations in test environments | Angular MDX hardcoded port 4102, manager-head files had wrong ports | Standardized all MDX to use env variable, updated manager-head files to match .env |
| MCP server --port flag not working | Server reads PORT from env, not CLI args | Use `PORT=4101 node dist/mcp-server/index.js` instead of `--port 4101` |

### Resolved Issues (November 2025)

| Issue | Root Cause | Resolution |
|-------|------------|------------|
| White text on light background | LLM generating incorrect colors | Added universal best practices to system prompt + design considerations |
| LLM returning markdown | Missing assistant prefill | Added `<` prefill to force JSX output |
| Iteration showing `<budget>` tags | LLM returning metadata | Improved system prompt instructions |
| Mantine hardcoded in App.tsx | Design-system-specific code | Moved to considerations.ts |
| Provider dropdown showing one option | No conditional rendering | Show text if single provider, dropdown if multiple |
| Stale closure in useLocalStorage | React state closure issue | Fixed hook to use functional updates |
| Chat titles not updating | Missing LLM call for title generation | Added `generateChatTitle` function |
| Model not passed to API | Missing parameter in request | Added `model` to request body |

### Common Pitfalls to Avoid

1. **Don't hardcode design systems** - Use `considerations.ts` for design-system-specific rules
2. **Don't forget CORS** - All API endpoints need CORS headers
3. **Don't use deprecated models** - Update model lists when providers release new versions
4. **Don't skip prefill** - Always prefill with `<` to ensure JSX output
5. **Don't ignore localStorage** - It's the primary persistence mechanism for user preferences
6. **Don't use .stories.tsx for the panel in non-React projects** - Use MDX wrapper (`StoryUIPanel.mdx`) which is processed by addon-docs (always React)
7. **Don't forget Angular tsconfig for TSX** - Angular projects need `"jsx": "react-jsx"` and `.tsx` in includes

---

## Codebase Structure

```
story-ui/
├── cli/                          # CLI commands (init, start, deploy)
│   ├── index.ts                  # Main CLI entry
│   ├── setup.ts                  # Project setup utilities
│   └── deploy.ts                 # Deployment commands
├── mcp-server/                   # Express MCP server (production backend)
│   ├── index.ts                  # Express server with routes
│   ├── mcp-stdio-server.ts       # STDIO MCP server for CLI
│   └── routes/                   # API route handlers
│       ├── generateStory.ts      # Non-streaming story generation
│       ├── generateStoryStream.ts # Streaming story generation
│       ├── providers.ts          # LLM provider management
│       ├── components.ts         # Component discovery endpoints
│       ├── frameworks.ts         # Framework detection endpoints
│       └── mcpRemote.ts          # Claude Desktop MCP endpoint
├── story-generator/              # Core story generation logic
│   ├── generateStory.ts          # Main generation function
│   ├── componentDiscovery.ts     # Component discovery
│   ├── promptGenerator.ts        # Prompt building utilities
│   ├── configLoader.ts           # Configuration loading
│   ├── llm-providers/            # LLM provider implementations
│   │   ├── base-provider.ts      # Base class
│   │   ├── claude-provider.ts    # Claude/Anthropic
│   │   ├── openai-provider.ts    # OpenAI/GPT
│   │   ├── gemini-provider.ts    # Google Gemini
│   │   └── story-llm-service.ts  # Unified LLM service
│   └── framework-adapters/       # Framework support
│       ├── base-adapter.ts       # Base adapter class
│       ├── react-adapter.ts      # React adapter
│       ├── vue-adapter.ts        # Vue adapter
│       ├── angular-adapter.ts    # Angular adapter
│       ├── svelte-adapter.ts     # Svelte adapter
│       └── web-components-adapter.ts # Web Components adapter
├── templates/                    # Storybook integration templates
│   ├── StoryUI/                  # Storybook addon
│   │   ├── StoryUIPanel.tsx      # Main panel component
│   │   ├── manager.tsx           # Addon registration
│   │   └── index.tsx             # Panel registration
│   └── production-app/           # Production app template
├── test-storybooks/              # Test environments (development only)
├── docs/                         # Documentation
├── ROADMAP.md                    # Detailed task tracking
└── DEPLOYMENT.md                 # Deployment guide
```

---

## Development Workflow

### Making Changes to Backend/MCP Server

1. **Edit** files in `mcp-server/` or `story-generator/`
2. **Build**: `npm run build` (from repo root)
3. **Test locally**: `npm run story-ui`
4. **Deploy**: Push to deployment repo for Railway auto-deploy

### Making Changes to StoryUIPanel

**Important**: Changes to `templates/StoryUI/StoryUIPanel.tsx` require compilation because test environments import from the npm package (`@tpitre/story-ui/panel`), not the source files.

**Change Propagation Flow**:
```
templates/StoryUI/StoryUIPanel.tsx (SOURCE)
        ↓ npm run build
dist/templates/StoryUI/StoryUIPanel.js (COMPILED)
        ↓ npm link
test-storybooks/*/node_modules/@tpitre/story-ui/
        ↓ MDX imports from '@tpitre/story-ui/panel'
Storybook renders compiled version
```

**Development Workflow**:
```bash
# From story-ui root directory:

# Option 1: Single build
npm run build

# Option 2: Watch mode (recommended for active development)
npm run dev  # Runs tsc --watch

# Then in test environment (e.g., react-mantine):
cd /path/to/test-storybooks/react-mantine
rm -rf node_modules/.vite node_modules/.cache  # Clear Vite cache
PORT=4101 node /path/to/story-ui/dist/mcp-server/index.js &  # Start MCP server
npm run storybook  # Start Storybook
```

**Port Configuration**:
- Each test environment has its own port in `.env` (`VITE_STORY_UI_PORT`)
- react-mantine: 4101
- angular-material: 4102
- vue-vuetify: 4103
- svelte-flowbite: 4104
- web-components-shoelace: 4105

**If changes don't appear**:
1. Ensure `npm run build` was run (or `npm run dev` is running)
2. Clear Vite cache: `rm -rf node_modules/.vite`
3. Restart Storybook
4. Hard refresh browser (Cmd+Shift+R)

### Railway Deployment

Railway is the primary deployment platform for the full-stack Story UI application:

1. **Deployment Platform**: Railway provides containerized deployment with automatic builds
2. **Deployment Repository**: https://github.com/tpitre/story-ui-mantine-live
3. **Environment**: All LLM provider API keys are configured as Railway environment variables
4. **Auto-deploy**: Connected to git repository for automatic deployments on push

To deploy to Railway:
```bash
# Railway CLI deployment
railway up

# Or push to deployment repo for auto-deployment
```

### Testing

Use Chrome DevTools MCP for automated browser testing:
```
- Navigate to production URL: https://story-ui-demo.up.railway.app
- Take snapshots/screenshots
- Click elements
- Verify UI changes
```

---

## Provider Configuration

### Claude Models (Anthropic)

```typescript
models: [
  'claude-opus-4-5-20251101',      // Claude Opus 4.5 - Most capable
  'claude-sonnet-4-5-20250929',    // Claude Sonnet 4.5 - Recommended default
  'claude-haiku-4-5-20251001',     // Claude Haiku 4.5 - Fast, economical
  'claude-sonnet-4-20250514',      // Claude Sonnet 4
  'claude-opus-4-20250514',        // Claude Opus 4
  'claude-3-7-sonnet-20250219',    // Claude 3.7 Sonnet
  'claude-3-5-sonnet-20241022',    // Claude 3.5 Sonnet
  'claude-3-5-haiku-20241022'      // Claude 3.5 Haiku
]
```

### OpenAI Models

```typescript
models: [
  'gpt-5.1',                       // GPT-5.1 - Latest with adaptive reasoning
  'gpt-5.1-thinking',              // GPT-5.1 Thinking - Extended reasoning
  'gpt-5',                         // GPT-5 - Multimodal foundation model
  'gpt-4o',                        // GPT-4o - Fast multimodal, recommended default
  'gpt-4o-mini',                   // GPT-4o Mini - Economical
  'o1',                            // o1 - Advanced reasoning model
  'o1-mini'                        // o1 Mini - Compact reasoning
]
```

### Gemini Models

```typescript
models: [
  'gemini-3-pro',                  // Gemini 3 Pro - Most intelligent, PhD-level reasoning
  'gemini-3-pro-preview',          // Gemini 3 Pro Preview - Experimental features
  'gemini-2.0-flash-exp',          // Gemini 2.0 Flash Experimental
  'gemini-2.0-flash',              // Gemini 2.0 Flash - Recommended default
  'gemini-1.5-pro',                // Gemini 1.5 Pro - Large context (2M tokens)
  'gemini-1.5-flash'               // Gemini 1.5 Flash - Fast and economical
]
```

---

## System Prompt Structure

The production app sends prompts with this structure:

```
1. Universal best practices (theming, accessibility, responsive design)
2. Design-system-specific considerations (from considerations.ts)
3. Available components list (auto-discovered)
4. User's request
5. Conversation history (for iterations)
6. Previous code (for modifications)
```

**Important**: Always prefill the assistant response with `<` to ensure the LLM outputs JSX directly without markdown.

---

## LocalStorage Keys

| Key | Purpose |
|-----|---------|
| `storyui_chats` | All chat conversations |
| `storyui_activeChat` | Currently active chat ID |
| `storyui_provider` | Selected LLM provider |
| `storyui_model` | Selected model |
| `storyui_sidebar_collapsed` | Sidebar state |

---

## Debugging Checklist

When issues occur, check in order:

1. **Console errors** - Browser DevTools Console tab
2. **Network requests** - Browser DevTools Network tab (look for failed requests)
3. **Server logs** - Railway deployment logs or local `npm run story-ui` output
4. **API response** - Check if LLM is returning expected format
5. **CORS headers** - Ensure OPTIONS requests return correct headers
6. **API keys** - Verify environment variables are set in Railway dashboard

---

## Roadmap

### Immediate (This Sprint)

- [ ] Implement delete chat functionality
- [ ] Add conversation export feature
- [ ] Improve error handling and user feedback

### Short Term

- [ ] SSE streaming for real-time generation feedback
- [ ] User authentication for personalized experience

### Long Term

- [ ] Visual Builder revival (proper implementation)
- [ ] Figma plugin integration
- [ ] Team collaboration features
- [ ] Design token extraction

---

## Visual Builder Status

**DEFERRED** - The Visual Builder is fundamentally broken for Story UI's value proposition:

- Only works with hardcoded Mantine components
- Cannot render user's custom design system components
- Hidden from UI (button removed)
- Code preserved in `dist/visual-builder/` for future reference

See `ROADMAP.md` section "DEFERRED: Visual Builder" for full analysis.

---

## Contact & Resources

- **Repository**: https://github.com/tpitre/story-ui
- **NPM Package**: @tpitre/story-ui
- **Production Demo**: https://story-ui-demo.up.railway.app
- **Deployment Repo**: https://github.com/tpitre/story-ui-mantine-live

---

*This document should be updated whenever significant changes are made to the codebase, architecture, or deployment process.*
