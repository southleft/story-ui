# Story UI - AI Assistant Project Guide

> **Last Updated**: July 28, 2026
> **Current Version**: 4.17.0
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
| Generation Pipeline (shared core) | `mcp-server/routes/generationCore.ts` |
| Story Generation (JSON transport) | `mcp-server/routes/generateStory.ts` |
| Streaming Generation (SSE transport) | `mcp-server/routes/generateStoryStream.ts` |
| Import Isolation | `validateImportIsolation` in `generationCore.ts` |
| Documentation Loader | `story-generator/documentationLoader.ts` |
| Self-Healing Loop | `story-generator/selfHealingLoop.ts` |
| Component Discovery | `story-generator/componentDiscovery.ts` |
| LLM Providers | `story-generator/llm-providers/` |
| Framework Adapters | `story-generator/framework-adapters/` |
| Storybook Panel (V1) | `templates/StoryUI/StoryUIPanel.tsx` |
| MDX Wrapper | `templates/StoryUI/StoryUIPanel.mdx` |
| V2 Workspace | `templates/StoryUIV2/Workspace.tsx` |
| V2 Element targeting (React fiber) | `templates/StoryUIV2/elementTargeting.ts` |
| V2 Property panel (direct manipulation) | `templates/StoryUIV2/PropertyPanel.tsx` |
| Verification orchestrator | `story-generator/verify/verifyStory.ts` |
| DOM census probe | `story-generator/verify/probes/domCensus.ts` |
| Layout probe (grid/alignment arithmetic) | `story-generator/verify/probes/layout.ts` |
| Visual critique (vision model) | `story-generator/verify/probes/visualCritic.ts` |
| Prop AST editor (no LLM) | `story-generator/editing/propEditor.ts` |
| Prop edit endpoints | `mcp-server/routes/editProp.ts` |
| Prop/type knowledge | `story-generator/knowledge/propExtractor.ts` |
| Token + styling idiom | `story-generator/knowledge/stylingFacts.ts` |
| Description quality predicate | `story-generator/knowledge/descriptionQuality.ts` |
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
| `college-town` | React | Radix + Tailwind (local source) | 6006 | 4106 |
| `mui-material` | React | MUI (npm subpath) | 6107 | 4107 |
| `atlaskit` | React | Atlassian (one package per component) | 6108 | 4108 |
| `carbon` | React | IBM Carbon (barrel + SCSS) | 6109 | 4109 |

**The four React architectures all behave differently and each hid a distinct
bug.** npm barrel (Mantine, Carbon), npm subpath (MUI), package-per-component
(Atlassian), and local source (college-town, `src/housekit`). A change that
works on one is not a change that works.

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
  // Import style: 'barrel' (default) or 'individual'
  // Use 'individual' for libraries without barrel exports (shadcn/ui, Radix Vue, Angular Material)
  // Use 'barrel' for libraries with index.ts barrel exports (Mantine, Chakra, Vuetify)
  importStyle: "barrel",
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
3. **Don't use assistant prefill** - Claude 4.6+ models reject the `<` prefill with a 400; code-only output is enforced by prompt contract instead. Sonnet 5 / Opus 4.7+ also reject temperature/top_p/top_k
4. **Don't use .stories.tsx for panel in non-React** - Use MDX wrapper
5. **Don't forget Angular tsconfig for TSX** - Needs `"jsx": "react-jsx"`
6. **Don't use --port flag** - Use `PORT=4101` environment variable instead
7. **Don't expect changes without rebuild** - Always run `npm run build` after edits
8. **Don't develop against react-mantine alone** - it is a barrel-exported npm package the model has memorised, and it hides bugs in discovery, import resolution and provider handling. Verify against `college-town` (Radix/Tailwind, local source) and `src/housekit` (unknown design system) before believing a result
9. **Don't measure knowledge with an LLM bench** - dead imports, missing components and wrong names are deterministic. Use `bench/resolution.mjs`; it is free and catches in seconds what a generation bench cannot distinguish from noise
10. **Don't pattern-match a name when the value is in hand** - judging exports by `/Provider$/` deleted Polaris's mandatory application root

---

## The Governing Principle

**Derive from the codebase; never infer from convention.**

Every serious defect found on the `feat/v2-fidelity-and-verification` branch had
one shape: the engine inferred a fact the project already stated. Every fix
applied the same correction.

| Was inferred from | Truth was in |
|---|---|
| a hardcoded list of 8 folder names | `.storybook/main.ts` `stories` globs, and Storybook's index |
| CSS class patterns (`mantine-*`, `Mui*`) | React's fiber, which names the component the source used |
| kebab-casing a component name | the file on disk, and `config.components[].importPath` |
| npm `.d.ts` only | the component's own source: `cva()` maps, JSDoc, story prose |
| an export's NAME (`/Provider$/`) | the imported runtime value |
| a grid's column count | the rendered `grid-template-columns` track list |
| which component a defect belongs to | React's fiber owner, not the CSS class shape |
| a component's legal prop values | the library's own `const` tuple behind its type alias |
| which JSX element a click maps to | the source file — the fiber chain is only a hypothesis |
| that a scope (`@atlaskit`) is importable | `node_modules/<name>/package.json` |

When adding knowledge, ask what file already states the answer. If the code is
pattern-matching a name, it is probably wrong for some design system.

### The other recurring shape: a silent no-op that looks like success

Distinct from inference, and it cost more time than any single bug. A check
that cannot run reports the same thing as a check that found nothing.

| Looked like | Actually was |
|---|---|
| "all specifiers resolve" | the bench had stopped parsing 19 of 31 components |
| "no visual findings" | the image payload was malformed and the call never ran |
| "story is broken" | Storybook's watcher had died; the file was fine |
| "the model ignores instructions" | our own post-processing rewrote its correct imports |
| props/descriptions at 0% | a disk cache keyed only on the LIBRARY version |
| "0/3 selection" | the bench could not see default imports |

Rule: when a measurement can be absent, make absent and zero look different in
the log. Three separate diagnoses on this branch were wrong because they did
not.

### The two classes of change (V2)

Changes to a generated story are not one thing, and treating them as one is
how a request to change a background colour returned a different page.

| | Example | Right tool |
|---|---|---|
| **Compositional** | "add a filters panel", "make this three columns" | the model |
| **Parametric** | "make this button red", "use the secondary variant" | `propEditor` — an AST edit, no model |

A parametric change has exactly ONE correct edit to one attribute of one
element. Sending it to a model adds latency, cost and risk and nothing else.
`GET /mcp/editable-props` reports what a component accepts (read from its own
types, deprecated props withheld); `POST /mcp/edit-prop` applies it.

Targeting note: React 19 removed `_debugSource`, so there is no file:line.
`_debugOwner` survives and names the authoring component. The browser sends
CANDIDATES innermost-first and the SERVER picks the first that appears in the
file — the fiber chain contains HOC wrappers (`hookified`) and library
internals (`ListBox`) that are not JSX elements in the source.

### Verification stack, in order

Each layer only runs on what the previous one passed, cheapest first.

1. **AST + pattern + import validation** — free, before anything renders.
2. **Render harness** — Playwright; waits for the DOM to STOP changing, not merely to be non-empty.
3. **DOM census** — fake fields, unnamed icon controls, invisible icons, keyboard reachability.
4. **Layout probe** — grid coverage and left-edge alignment. Arithmetic, not taste.
5. **axe** — accessibility rules that indicate the GENERATOR produced wrong markup.
6. **Visual critique** — a vision model, last, only on something that already rendered.

Findings are ATTRIBUTED via React fiber: a defect in markup the library
rendered is reported but never blocks and never triggers repair, because the
only repair available to a model told to fix it is to stop using the
component. When ownership cannot be determined the finding blocks, exactly as
before — silently suppressing what cannot be explained is worse than a false
blocker.

The critique's PARSER enforces the contract, not the prompt: suggestions are
dropped ("consider", "might", "improve the look"), unknown severity degrades
to warning, six findings maximum, and an empty list is the expected answer for
well-formed output. A critic that always finds something is noise, and noise
costs a regeneration of correct code.

### Testing discipline

Two benches, deliberately separate — conflating them meant paying LLM prices to
measure a filesystem property, badly:

- **`bench/resolution.mjs`** — deterministic, free, seconds. Can we find the
  components, does the import specifier resolve, do we know props/descriptions/
  examples? Run on **every** change. Each environment runs in its own process:
  config loading and discovery hold module state, and `process.chdir` undoes
  neither, so a single-process run reported one project importing another's
  components.
- **`bench/componentSelection.mjs`** — LLM, slow, noisy. Judgement only. Run
  rarely.
- **`bench/firstAttempt.mjs`** — LLM, minutes. The pipeline's own recovery
  hides its failure rate: validation self-heals, verification repairs, the gate
  regenerates, and all three report "Verified". This one records what happened
  BEFORE any of that, and prints one number —
  `first-attempt clean: N/20 (X%) · median model calls M · median Ns`.
  Run it either side of a PREVENTION change (knowledge, prompt), never on every
  commit. A run it could not judge is counted in neither column and said out
  loud; the percentage is over what was judged.

### Test environments, and a warning

**Never develop against react-mantine alone.** It is the least representative
case available — an npm package, with types, with a barrel export, that the
model has memorised. It makes four separate subsystems look correct:

| Environment | Bug it exposed | Why Mantine cannot show it |
|---|---|---|
| vue-vuetify | prefix-stripping bias | stripping *happens* to yield Mantine's real names |
| `src/housekit` (react-mantine) | discovery scanned only conventional dirs | Mantine is a package, not a directory |
| college-town | import resolution; ~3/4 of stories rendered blank | Mantine is a barrel — one path, always right |

`college-town` (Radix + Tailwind + local source, Storybook 10) is the most
valuable environment. `src/housekit` is a synthetic design system the model has
no training data for — the only way to test an unknown library.

## Issue History & Resolutions

### July 28, 2026 (knowledge, verification and direct manipulation)

| Issue | Root cause | Resolution |
|-------|------------|------------|
| Descriptions 0% on every npm design system | a props cache keyed only on the LIBRARY version, so new extractor fields never appeared; `@default`/`@deprecated` deliberately discarded; discovery's `"X component from Y"` placeholder blocking real prose | schema-versioned cache; tags kept; one shared `saysMoreThanName` predicate used by pipeline AND bench |
| Carbon measured as undocumented | its prose is in `Component.propTypes` in `.js`, not in `.d.ts` (Tile.js has 49 JSDoc blocks, Tile.d.ts none) | read both and merge FIELD-wise — declarations hold the type, propTypes the prose |
| Atlassian missing its entire layout primitive set | export scraper required the braced list to begin with a capital, so `export { default as Box }` was invisible | parse braced exports; the exported name is the ALIAS |
| Atlassian generation returned no code at all | catalog and validator were separate sets that diverged — the model was told to use `Box`, rejected for it, told again | anything the catalog offers is valid, by construction |
| Correct imports rewritten into packages that do not exist | `fixBarrelImports` kebab-cased a component name onto the import path when discovery could not place it | leave unplaceable imports exactly as written |
| Model "ignoring" the catalog and importing from `@atlaskit` | it genuinely emits that; the prompt also taught a path FORMULA | repair deterministically from discovery as the LAST transform; prompt points at the catalog instead |
| Ragged layouts, content not on the grid | nothing checked layout arithmetic; the model was never told the column count | layout probe reads the rendered `grid-template-columns`; layout prop docs added to the catalog |
| A targeted edit replaced the whole page | `previousCode` came only from history, so a missing version silently became a fresh generation | fall back to the file on disk; measure structural divergence and reject a rewrite |
| A failed generation broke the whole Storybook | fallback stories had no `id`, so Storybook derived one from the truncated prompt and two failures collided | explicit id hashed from prompt + time, in all five framework templates |
| Voice-canvas template broke Vite for any project without react-live | guard checked the FRAMEWORK, not the dependency | check for react-live itself |

### July 2026 (fidelity and verification, V2 branch)

| Issue | Root cause | Resolution |
|-------|------------|------------|
| ~3/4 of generated stories rendered blank on a Radix/Tailwind project | `applyManualConfigurations` merged every declared field EXCEPT `importPath`, and blanked `filePath` — destroying the field import rewriting needs | Declared specifiers honoured; `filePath` preserved; `buildComponentToImportMap` prefers a declared path |
| A design system in `src/housekit` was invisible | discovery scanned 8 hardcoded folder names | Read `.storybook/main.ts` globs (no server needed) + Storybook's live index |
| Polaris `AppProvider` and Radix `*.Provider` dropped from the catalog | exports rejected by name shape (`/Provider$/`), statics stripped as "plumbing" | Judge the imported runtime value, not the name |
| Local design systems had 7% description coverage, no variant values | nothing read component source or story docs | `knowledge/sourceFacts.ts` reads `cva()`/`tv()` maps, story prose, `argTypes` docs → 100% |
| Verification blind to menus, modals, popovers | census scoped to `#storybook-root`; overlays portal to `document.body` | Census covers portalled roots, excluding Storybook chrome by name |
| Handoff failed on every CLI-initialised project | `init` gitignores the stories dir; handoff ran `git add` without `-f` | Force-add the one named file; stage the sibling stylesheet too |
| Conversations, story versions, and the components manifest all existed but were never read | V2 was missing readers for working infrastructure — four separate times | Check what exists before building it |

### July 2026 (major modernization)

| Issue | Root Cause | Resolution |
|-------|------------|------------|
| Generation routes drifted (~700 duplicated lines) | Copy-paste between JSON/SSE routes | Extracted `mcp-server/routes/generationCore.ts`; both routes are thin transports |
| Post-generation full-page reload | Legacy assumption; Storybook ≥9 indexes live | Removed reload; panel polls /index.json, "Open in Storybook" navigates via addons channel |
| Panel chat lost mid-generation | New story file makes Vite reload the preview iframe (kills SSE) | Server persists AI reply to manifest; panel stashes in-flight state in sessionStorage and recovers |
| AI imported packages not in the design system | No deterministic guard | `validateImportIsolation` in generationCore; considerations file is the only escape hatch |
| Storybook MCP toggle was a double no-op | Stale tool names + unset config | Panel sends its origin as `storybookUrl`; client uses `get-storybook-story-instructions` + components manifest |
| Custom local components avoided by AI | Both prompt paths claimed local components import from the npm library path | `base-adapter.getImportPath` now emits real relative paths + "CUSTOM PROJECT COMPONENT" labeling. NOTE: framework adapters are the LIVE prompt path, not promptGenerator's legacy `generateComponentReference` |
| Claude prefill 400s | Claude 4.6+ rejects assistant prefill | Prefill removed; prompt-contract enforcement |
| Docs folder only read Markdown | Limited glob | documentationLoader ingests md/mdx/json/yaml/yml/xml/html/txt with char budgets |

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
- `claude-opus-4-8` - Most capable (Opus 4.8)
- `claude-sonnet-5` - Recommended balance (default)
- `claude-haiku-4-5` - Fast, economical

### OpenAI
- `gpt-5.5` - Frontier flagship, 1M context (default)
- `gpt-5.4-mini` - Fast, economical 1M context
- `gpt-5.4-nano` - Fastest, high-volume tasks

### Gemini
- `gemini-3.1-pro` - Most capable, 1M context (default)
- `gemini-3.5-flash` - Fast frontier (GA)
- `gemini-3.1-flash-lite` - Most cost-efficient

---

## Resources

- **Repository**: https://github.com/southleft/story-ui
- **NPM Package**: @tpitre/story-ui
- **Production Demo**: https://app-production-16de.up.railway.app
- **Deployment Repo**: https://github.com/tpitre/story-ui-mantine-live

---

*This document should be updated whenever significant changes are made to the codebase, architecture, or deployment process.*
