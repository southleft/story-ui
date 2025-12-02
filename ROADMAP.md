# Story UI v3 Roadmap & Task List

> **Last Updated**: 2025-12-01
> **Current Version**: 3.6.2
> **Target Version**: 3.7.0

This document tracks all pending tasks, enhancements, and bugs for the Story UI v3 overhaul. It serves as a persistent reference across conversation sessions.

---

## Table of Contents

1. [Completed Work (v3 Overhaul)](#completed-work-v3-overhaul)
2. [Priority 1: Chat Interface Enhancements](#priority-1-chat-interface-enhancements)
3. [Priority 2: NPX Command Validation](#priority-2-npx-command-validation)
4. [Priority 3: Codebase Cleanup](#priority-3-codebase-cleanup)
5. [Priority 4: Multi-Provider Testing](#priority-4-multi-provider-testing)
6. [DEFERRED: Visual Builder](#deferred-visual-builder)
7. [Future Enhancements](#future-enhancements)
8. [Known Issues](#known-issues)

---

## Completed Work (v3 Overhaul)

### Multi-LLM Provider System
- [x] Base provider architecture (`story-generator/llm-providers/base-provider.ts`)
- [x] Claude provider with latest models (Sonnet 4.5, Opus 4.5, Haiku 4.5)
- [x] OpenAI provider (GPT-4o, GPT-5.1, o1 models)
- [x] Gemini provider (Gemini 2.0/3.0 models)
- [x] Settings manager for provider switching
- [x] Unified LLM service interface
- [x] Provider API endpoints (`/story-ui/providers`)

### Multi-Framework Support
- [x] React adapter
- [x] Angular adapter
- [x] Vue adapter
- [x] Svelte adapter
- [x] Web Components adapter
- [x] Framework auto-detection
- [x] Framework API endpoints (`/story-ui/frameworks`)

### Vision Support
- [x] Image processor for base64 encoding
- [x] Vision prompts for screenshot-to-story
- [x] Multi-modal message support

### Test Environments
- [x] Mantine (React) - Port 4001, Claude provider
- [x] Angular Material - Port 4002, Gemini provider
- [x] Web Components Shoelace - Port 4003, OpenAI provider
- [x] Chakra UI (React) - Existing

---

## Priority 1: Chat Interface Enhancements

### 1.1 Two-Way Conversational Chat
**Status**: IN PROGRESS (Backend Complete)
**Priority**: HIGH

The current chat is one-way - user prompts, AI returns success/fail. Need to implement:

- [x] **Intent Preview**: AI explains what it intends to do before executing (Backend)
  - Show component selection reasoning
  - Display layout decisions
  - List props/variants being used
  - No additional confirmation required - just informational

- [x] **Execution Feedback**: AI provides detailed completion status (Backend)
  - What components were used
  - How they were composed together
  - Any fallbacks or alternatives chosen
  - Warnings about potential issues

- [x] **Progress Streaming**: Real-time updates via SSE (Backend)
  - Step-by-step status: config_loaded, components_discovered, prompt_built, llm_thinking, validating, post_processing, saving
  - Retry attempt notifications
  - Validation feedback in real-time

- [ ] **Frontend Integration**: Connect chat UI to streaming endpoint
  - Use EventSource to consume `/story-ui/generate-stream`
  - Display intent preview before generation starts
  - Show progress bar/steps during generation
  - Render completion feedback with component/layout explanations

- [ ] **Contextual Awareness**: AI maintains conversation context
  - Remember previous stories in session
  - Reference earlier decisions
  - Suggest improvements based on patterns

- [ ] **Decision Explanations**: AI explains WHY it made certain choices
  - Why specific components were selected
  - Why certain layout patterns were used
  - Helps users understand component library gaps

#### Implementation Details (2025-11-26)

**New Files Created:**
- `mcp-server/routes/streamTypes.ts` - Type definitions for SSE events
- `mcp-server/routes/generateStoryStream.ts` - Streaming endpoint handler

**New Endpoints:**
- `POST /mcp/generate-story-stream` - SSE streaming generation
- `POST /story-ui/generate-stream` - Frontend proxy route

**Event Types:**
```typescript
type StreamEventType =
  | 'intent'      // Initial plan before execution
  | 'progress'    // Step-by-step updates
  | 'validation'  // Validation results
  | 'retry'       // Retry attempt info
  | 'completion'  // Final detailed feedback
  | 'error';      // Error events
```

**Intent Preview Structure:**
```typescript
interface IntentPreview {
  requestType: 'new' | 'modification';
  framework: string;
  detectedDesignSystem: string | null;
  strategy: string;
  estimatedComponents: string[];
  promptAnalysis: {
    hasVisionInput: boolean;
    hasConversationContext: boolean;
    hasPreviousCode: boolean;
  };
}
```

**Completion Feedback Structure:**
```typescript
interface CompletionFeedback {
  success: boolean;
  title: string;
  fileName: string;
  storyId: string;
  summary: { action: 'created' | 'updated' | 'failed'; description: string };
  componentsUsed: { name: string; reason?: string }[];
  layoutChoices: { pattern: string; reason: string }[];
  styleChoices: { property: string; value: string; reason?: string }[];
  suggestions?: string[];
  validation: ValidationFeedback;
  code: string;
  metrics: { totalTimeMs: number; llmCallsCount: number };
}
```

### 1.2 Image & Asset Upload Support
**Status**: Frontend Complete (2025-11-26)
**Priority**: HIGH

Enable users to upload files for AI reference:

- [x] **Image Upload** (Frontend Complete)
  - Accept PNG, JPG, WebP, GIF (max 20MB each, 4 images)
  - Preview uploaded images in chat with removal option
  - Send to vision-capable models (Claude, GPT-4o, Gemini)
  - Use for visual reference when generating components
  - Drag-and-drop support with visual overlay
  - Base64 conversion for API transport

- [ ] **PDF Upload**
  - Extract text from PDFs for context
  - Support design specs, brand guidelines
  - Parse multi-page documents

- [x] **File Type Validation** (Complete)
  - Validate file types (image/*)
  - Max file size limit: 20MB
  - Max files: 4 images
  - Clear error feedback

- [x] **UI Components Implemented**
  - File upload button in chat input area
  - Image preview thumbnails with remove buttons
  - File attachment indicators in user messages
  - Drag-and-drop overlay
  - Integration with vision mode (`screenshot_to_story`)

### 1.3 Chat UI Improvements
**Status**: Not Started
**Priority**: MEDIUM

- [ ] Message bubbles with clear AI/User distinction
- [ ] Streaming response display
- [ ] Code syntax highlighting in responses
- [ ] Copy code button for generated stories
- [ ] Conversation history persistence (session-based)

---

## DEFERRED: Visual Builder

> **Decision (2025-11-26)**: Visual Builder is **fundamentally broken** for Story UI's core value proposition. It only works with hardcoded Mantine components, making it useless for users with custom design systems or any other component library.

### The Core Problem

**Story UI's value proposition**: Works with YOUR design system - any components, any library

**Visual Builder's reality**: Hardcoded Mantine components only
- `componentRegistry.tsx` contains fixed list: Button, Card, Stack, etc.
- Cannot render user's custom `<MyButton>`, `<ProductCard>`, `<HeroSection>`
- Useless for Chakra, Ant Design, Shoelace, custom libraries
- **This defeats the entire purpose of Story UI**

### Status
**Status**: HIDDEN/DISABLED
**Priority**: LOW
**Recommendation**: Hide completely until proper rebuild

### Options Considered

| Option | Effort | Outcome |
|--------|--------|---------|
| A. Remove entirely | 2h | Clean codebase, no confusion |
| **B. Hide completely** | 1h | Keep code, hide button everywhere |
| C. Proper rebuild | 100-150h | Actually useful for all users |

**Decision**: Option B - Hide the button everywhere so no users encounter a broken experience.

### Immediate Action (1 hour) - COMPLETED 2025-11-26
- [x] Hide "Edit in Visual Builder" button for ALL projects
  - Removed decorator from `mantine-storybook/.storybook/preview.tsx`
  - Removed `./visual-builder` export from `package.json`
- [x] Keep code for future reference
  - Decorator file remains at `test-storybooks/mantine-storybook/src/stories/decorators/`
  - `dist/visual-builder/` directory preserved for reference

### What a Proper Rebuild Would Require
If we ever rebuild Visual Builder to be useful:
1. **Dynamic component discovery** - Read from `story-ui.config.js`
2. **No hardcoded component registry** - Use discovered components
3. **Generic JSX parsing** - Work with any component names
4. **Runtime component loading** - Render user's actual components
5. **Framework-agnostic** - React, Vue, Angular, Svelte, Web Components

**Estimated effort for proper rebuild**: 100-150 hours

### Original Analysis (for future reference)
**Recommendation**: SALVAGEABLE - Do NOT Rebuild

#### Analysis Summary
- **Total Codebase**: ~6,400 LOC across 33 compiled files
- **Architecture**: Solid foundation (Zustand store + React + @dnd-kit)
- **Core Features**: 80% working
- **Main Issues**: Integration gaps and parsing bugs

#### Key Findings

| Aspect | Status | Notes |
|--------|--------|-------|
| Architecture | ✅ Good | Zustand + React is solid |
| Core Features | ✅ Mostly Working | Drag-drop, save, render work |
| Integration | ⚠️ Incomplete | Missing MCP endpoint |
| Code Quality | ⚠️ Average | Debug spam, no tests |
| UX | ⚠️ Needs Polish | Silent failures, limited property editor |
| Documentation | ❌ Missing | No API docs |

### 2.2 Critical Bugs Identified

1. **Missing MCP Endpoint** (CRITICAL)
   - Decorator tries `/story-ui/visual-builder/load` - endpoint doesn't exist
   - Fix: Add endpoint to mcp-server/index.ts
   - Effort: 1-2 hours

2. **Silent Fallback to Empty Template** (HIGH)
   - If source fetching fails, shows blank canvas with no error
   - Fix: Show error dialog instead
   - Effort: 1 hour

3. **Array Props Become Strings** (HIGH)
   - Select/MultiSelect data props break with `data.map is not a function`
   - Partially fixed for Select, needs generalization
   - Effort: 2-3 hours

4. **Excessive Debug Logging** (MEDIUM)
   - Console flooded with emoji logs on every render
   - Effort: 15 minutes

5. **Hard-Coded Mantine Components** (ARCHITECTURAL)
   - Only works with Mantine - blocks multi-framework use
   - Would need major refactor for other design systems
   - Effort: 40+ hours (defer for now)

### 2.3 Fix Priority List

**Phase 1: Critical Fixes (40-50 hours total)**
- [ ] Add `/story-ui/visual-builder/load` MCP endpoint (2h)
- [ ] Fix array prop parsing - generalize from Select fix (3h)
- [ ] Fix silent fallback - show error dialog (1h)
- [ ] Remove/condition debug logging (0.5h)
- [ ] Test on all Mantine components (4h)
- [ ] Improve styling preservation (4h)

**Phase 2: Polish (20 hours)**
- [ ] Better drag-drop UX (2h)
- [ ] Form-based property editor (4h)
- [ ] Basic validation on load/save (2h)
- [ ] Error handling improvements (2h)

**Phase 3: Quality (20 hours)**
- [ ] Unit tests for parsers (8h)
- [ ] Integration tests (6h)
- [ ] Documentation (4h)

**Phase 4: Future (Optional)**
- [ ] Undo/redo support
- [ ] Component templates
- [ ] Real-time preview sync with Storybook
- [ ] Multi-framework abstraction (60+ hours)

### 2.4 Architecture Overview
```
Storybook Story
    ↓
[VisualBuilderDecorator] (Button in top-right)
    ↓ (fetches source via 3 fallback methods)
sessionStorage.setItem('visualBuilderInitialCode')
    ↓
window.open('/story/visualbuilder--default')
    ↓
[VisualBuilder] component mounts
    ↓
parseAIGeneratedCode() | parseStoryUIToBuilder()
    ↓
useVisualBuilderStore.loadFromCode()
    ↓
[ComponentRenderer tree] with drag-drop
    ↓
updateStoryFile() → MCP server
    ↓
Files written to generated/ or edited/
```

### 2.5 Files Summary
```
dist/visual-builder/           # 33 files, 6.4k LOC
├── components/                # 9 files (~1,700 LOC)
│   ├── VisualBuilder.js      # Main container (256 LOC)
│   └── Canvas/ComponentRenderer.js  # Largest (545 LOC)
├── store/visualBuilderStore.js  # Zustand state (305 LOC)
├── hooks/                     # 2 files (164 LOC)
├── utils/                     # 8 files (~2,400 LOC)
│   └── storyToBuilder.js     # JSX parser (~400 LOC)
└── config/componentRegistry.js  # Mantine components

templates/decorators/
└── VisualBuilderDecorator.tsx  # Button + story loader (355 LOC)
```

---

## Priority 2: NPX Command Validation

### 3.1 Command Testing Matrix
**Status**: Core Commands Complete (2025-11-26)
**Priority**: MEDIUM

Test all npx commands in fresh environments:

- [x] `npx story-ui init` - Basic initialization (verified templates exist)
  - [ ] Fresh project (no Storybook)
  - [ ] Existing Storybook project
  - [ ] With React detected
  - [ ] With Angular detected
  - [ ] With Vue detected

- [ ] `npx story-ui init --design-system mantine`
  - [ ] Installs Mantine packages
  - [ ] Creates correct preview.ts
  - [ ] Configures theme properly

- [ ] `npx story-ui init --design-system chakra`
  - [ ] Installs Chakra packages
  - [ ] Creates ChakraProvider wrapper
  - [ ] Handles dependencies

- [ ] `npx story-ui init --design-system mui`
  - [ ] Installs MUI packages
  - [ ] Configures theme provider

- [ ] `npx story-ui init --design-system material`
  - [ ] Installs MUI packages
  - [ ] Sets up theme provider

- [x] `npx story-ui start` - Server startup (Tested 2025-11-26)
  - [x] Default port selection (4001)
  - [x] Custom port via `--port`
  - [x] Config file detection
  - [x] Auto port increment when port in use

- [x] `npx story-ui start --port 4005`
  - [x] Uses specified port
  - [x] Handles port conflicts (auto-increments)

- [x] `npx story-ui config --generate` - Config generation (Tested 2025-11-26)
  - [x] JS format (default)
  - [x] JSON format (--type json)

- [x] `npx story-ui cleanup` - Cleanup command (Tested 2025-11-26)
  - [x] Removes default Storybook template files

- [x] `npx story-ui mcp` - MCP server mode (Tested 2025-11-26)
  - [x] Help displays correctly
  - [ ] STDIO communication works (requires Claude Desktop)
  - [ ] Claude Desktop integration

### 3.2 Error Handling
- [ ] Graceful handling of missing dependencies
- [ ] Clear error messages for configuration issues
- [ ] Recovery suggestions in error output

---

## Priority 3: Codebase Cleanup

### 4.1 Remove Design System Specific Language
**Status**: Not Started
**Priority**: HIGH

The codebase should be design-system agnostic except for installation helpers.

**Files to Audit:**
- [ ] `story-generator/promptGenerator.ts` - Remove any hardcoded design system references
- [ ] `story-generator/systemPrompts.ts` - Ensure generic component language
- [ ] `cli/setup.ts` - Only design system code should be for installation
- [ ] `templates/` - Check for design system bias

**Allowed Design System References:**
- Installation instructions in `cli/setup.ts`
- Package names in `package.json` devDependencies
- Template files for `npx story-ui init --design-system X`
- Documentation in `docs/` and `README.md`

**NOT Allowed:**
- Hardcoded component names in prompts
- Design system assumptions in story generation
- Biased examples in considerations files

### 4.2 Package.json Audit
- [ ] Remove unused dependencies
- [ ] Verify all dependencies are necessary
- [ ] Check for design-system specific packages that shouldn't be in core
- [ ] Ensure peer dependencies are correct

### 4.3 Considerations Files Audit
- [ ] Review `templates/story-ui-docs/` for bias
- [ ] Check example considerations files
- [ ] Ensure AI-generated content hasn't leaked in
- [ ] Validate documentation is framework-agnostic

---

## Priority 4: Multi-Provider Testing

### 5.1 Provider-Specific Testing
**Status**: Partially Complete
**Priority**: MEDIUM

- [x] Claude (Sonnet 4.5) - Tested in Mantine environment
- [ ] OpenAI (GPT-4o) - Test in web-components-shoelace
- [ ] Gemini (2.0 Flash) - Test in angular-material-storybook

### 5.2 Cross-Provider Validation
- [ ] Same prompt produces similar quality across providers
- [ ] Vision features work on all vision-capable models
- [ ] Streaming works correctly for all providers
- [ ] Error handling is consistent

### 5.3 Provider Switching
- [ ] Test runtime provider switching via API
- [ ] Verify settings persistence
- [ ] Test fallback behavior on API errors

---

## Future Enhancements

### Phase 2 (Post v3.0)
- [ ] Provider fallback (auto-retry with different provider on failure)
- [ ] Cost tracking per provider
- [ ] Model comparison mode
- [ ] Usage analytics dashboard
- [ ] Batch story generation
- [ ] Story templates/presets

### Phase 3
- [ ] Real-time collaboration
- [ ] Version control integration
- [ ] Design token extraction
- [ ] Figma plugin integration
- [ ] Component playground

---

## Known Issues

### Critical
1. Visual Builder has multiple UX bugs (DEFERRED - see Visual Builder section)

2. **StoryUIPanel Only Works in React Storybooks** (ARCHITECTURE BUG - 2025-12-01)

   **Problem**: StoryUIPanel is a React component that renders as a Storybook story in the preview iframe. Non-React Storybooks (Vue, Svelte, Angular, Web Components) cannot render React components in their preview iframe.

   **Symptoms**:
   - **Vue Storybook**: Blank/white preview, no errors in console
   - **Svelte Storybook**: Error "Component_1 is not a function" with stack trace through MockProvider.svelte → DecoratorHandler.svelte → PreviewRender.svelte
   - **Angular/Web Components**: Expected to show similar failures (not yet tested)
   - **React Storybook**: Works correctly ✅

   **Root Cause**:
   Storybook has two distinct rendering contexts:
   - **Manager**: Always React, regardless of project framework (addon panels live here)
   - **Preview iframe**: Uses the project's framework renderer

   StoryUIPanel.tsx is imported as a story (`StoryUIPanel.stories.tsx`) which renders in the preview iframe. When a Vue/Svelte/Angular project tries to render it, their framework-specific renderer fails because it cannot interpret React components.

   **Current Workaround**: None. Story UI Panel is unusable in non-React Storybooks.

   **Proposed Fix - Option A: MDX Wrapper (RECOMMENDED)**

   Per suggestion from Steve Dodier-Lazaro (Storybook team): Use MDX instead of a story file.
   MDX pages are processed by `@storybook/addon-docs` which always uses React, regardless of the project's framework.

   Reference: https://storybook.js.org/docs/api/main-config/main-config-indexers#examples

   **Why MDX works across all frameworks:**
   - MDX is compiled by Storybook's build system, not the project's framework renderer
   - Creates a "freeform React page without the whole story controls thing"
   - Appears in sidebar as standalone entry (not story-specific)
   - React components render directly in MDX regardless of project framework

   **Files Affected**:
   - `templates/StoryUI/StoryUIPanel.mdx` - New MDX wrapper (replaces .stories.tsx)
   - `templates/StoryUI/StoryUIPanel.tsx` - Keep as-is, imported by MDX
   - `templates/StoryUI/StoryUIPanel.stories.tsx` - Remove once MDX approach works

   **Estimated Effort**: 4-8 hours

   **Implementation Plan**:

   **Phase 1: Create MDX Wrapper (2h)**
   - [ ] Create `StoryUIPanel.mdx` that imports and renders the React component
   - [ ] Configure proper meta/title for sidebar placement
   - [ ] Ensure no story controls appear (pure React page)

   **Phase 2: Test Across Frameworks (2-4h)**
   - [ ] Test in React+Mantine environment (baseline)
   - [ ] Test in Vue+Vuetify environment (critical test)
   - [ ] Test in Svelte+Skeleton environment (critical test)
   - [ ] Test in Angular+Material environment
   - [ ] Test in Web Components+Shoelace environment

   **Phase 3: Update Installation (1-2h)**
   - [ ] Update `npx story-ui init` to copy MDX file instead of stories file
   - [ ] Update documentation
   - [ ] Test fresh installation flow

   **Key Technical Considerations**:
   - MDX requires `@storybook/addon-docs` (usually already installed)
   - The MDX file acts as a wrapper that renders our React component
   - No framework-specific code needed - MDX handles the React rendering
   - Port configuration (VITE_STORY_UI_PORT) should work via import.meta.env

   ---

   **Alternative Fix - Option B: Manager Addon Panel**

   Move StoryUIPanel to manager.tsx as an addon panel. Less recommended because:
   - Manager panels are story-specific (only show when viewing a story)
   - More complex refactoring required for addon context
   - Requires addon channel for preview communication

### High
1. No image upload capability in chat UI (backend supports vision)
2. Frontend needs to integrate with new streaming endpoint

### Medium
1. NPX commands need comprehensive testing
2. Some design system bias may exist in prompts

### Low
1. Documentation needs updating for v3 features

---

## Session Notes

### 2025-12-01 (E2E Multi-Framework Testing - CRITICAL BUG FOUND)
- **E2E Testing of Story UI Installation**: Tested Story UI Panel across 5 framework environments
  - React+Mantine (port 6101/4101): ✅ **WORKS** - Chat interface renders correctly
  - Vue+Vuetify (port 6102/4102): ❌ **FAILS** - Blank white preview, no errors
  - Svelte+Skeleton (port 6104/4104): ❌ **FAILS** - Error "Component_1 is not a function"
  - Angular+Material (port 6103/4103): ⚠️ Expected to fail (not tested)
  - Web Components+Shoelace (port 6105/4105): ⚠️ Expected to fail (not tested)

- **CRITICAL BUG DISCOVERED**: StoryUIPanel is a React component that only works in React Storybooks
  - **Root Cause**: StoryUIPanel renders as a Storybook story in the preview iframe
  - Preview iframe uses the project's framework renderer (Vue, Svelte, Angular, etc.)
  - Non-React frameworks cannot render React components in their preview
  - The manager.tsx only registers "Source Code" panel, not the main chat interface

- **Expert Input from Steve Dodier-Lazaro (Storybook team)**:
  - Suggested using **MDX wrapper** instead of story file
  - MDX pages are processed by `@storybook/addon-docs` which always uses React
  - Creates a "freeform React page without the whole story controls thing"
  - Reference: https://storybook.js.org/docs/api/main-config/main-config-indexers#examples
  - Manager addon panels are story-specific (not ideal for Story UI)

- **RECOMMENDED FIX**: MDX Wrapper approach (4-8 hours)
  - Create `StoryUIPanel.mdx` that imports and renders the React component
  - MDX is compiled by Storybook's build system, not the project's framework renderer
  - Works across all frameworks without modification to StoryUIPanel.tsx

- **Test Environment Setup**:
  - Created `.env` files for all 5 environments with `VITE_STORY_UI_PORT` values
  - Copied StoryUIPanel.tsx from node_modules to each environment's stories folder
  - All Story UI MCP servers responding correctly on ports 4101-4105

### 2025-12-01 (Codebase Integrity Audit)
- **Codebase Cleanup**:
  - Created `.dockerignore` to exclude 1.9GB `test-storybooks/` directory from Docker builds
  - Updated `CLAUDE.md` to reflect actual codebase state:
    - Removed all PostgreSQL references (feature was tried and removed)
    - Fixed architecture diagram to show file-based persistence
    - Removed references to non-existent files (postgresStoryService.ts, etc.)
    - Corrected model lists to match actual provider implementations
    - Added correct production URL and deployment repo info
  - Removed dead code from `story-generator/generateStory.ts`
  - Created shared `mcp-server/routes/storyHelpers.ts` for code deduplication (available for future refactoring)
- **Production Verification**:
  - Verified Railway deployment at https://story-ui-demo.up.railway.app is working
  - Confirmed all Claude, OpenAI, and Gemini models are available in UI
  - Chat history persistence working
  - Provider/model selection functional
- **Documentation**:
  - Updated version to 3.4.2
  - Corrected model lists in CLAUDE.md to include latest models (gpt-5.1, gpt-5.1-thinking, gemini-3-pro)
- **Build Verification**:
  - Confirmed `npm run build` succeeds with all changes

### 2025-11-26 (Session 3)
- **NPX Command Validation Complete**:
  - Tested `story-ui --help`, `start`, `config --generate`, `cleanup`, `mcp`
  - Verified auto-port allocation when port is in use
  - All provider endpoints respond correctly (Claude, OpenAI, Gemini)
  - All framework endpoints respond correctly (React, Angular, Vue, Svelte, Web Components)
  - Updated .env.sample with multi-provider documentation
- **Image Upload Frontend Implementation Complete** (in mantine-storybook test env):
  - File picker with multiple image support (up to 4 images, 20MB each)
  - Drag-and-drop support with visual overlay
  - Image previews with remove buttons
  - Base64 conversion for API transport
  - Integration with vision mode (`screenshot_to_story`)
  - Note: test-storybooks/ is gitignored, changes are local development only

### 2025-11-26 (Session 2)
- **Two-Way Chat Backend Complete**:
  - Created `mcp-server/routes/streamTypes.ts` with SSE event types
  - Created `mcp-server/routes/generateStoryStream.ts` with streaming handler
  - Added `/mcp/generate-story-stream` and `/story-ui/generate-stream` endpoints
  - Implemented intent preview, progress updates, validation feedback, completion feedback
- Hid Visual Builder completely (commented out decorator, removed export from package.json)
- Updated ROADMAP.md with implementation details

### 2025-11-26 (Session 1)
- Completed multi-LLM provider implementation
- Updated Claude models to latest (Sonnet 4.5, Opus 4.5, Haiku 4.5)
- Successfully tested story generation with Claude Sonnet 4.5
- Generated pricing card component in Mantine environment
- All three providers (Claude, OpenAI, Gemini) configured and responding
- Created this roadmap document for task tracking

### Previous Sessions (Summary)
- Implemented framework adapters for React, Angular, Vue, Svelte, Web Components
- Added vision support with image processing
- Set up test environments with different provider configurations
- Fixed visual-builder import/export issues in package.json

---

## How to Use This Document

1. **Starting a new session**: Read this document first to understand current state
2. **Completing a task**: Mark with [x] and add date in session notes
3. **Finding issues**: Add to Known Issues with severity
4. **Adding tasks**: Add to appropriate priority section
5. **Context preservation**: Update Session Notes with key decisions

---

*This document is the source of truth for Story UI v3 development progress.*
