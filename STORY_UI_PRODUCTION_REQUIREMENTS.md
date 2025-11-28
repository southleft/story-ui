# Story UI Production Environment Requirements

## Overview

This document captures the critical requirements and goals for the Story UI production environment deployment. It serves as a reference to ensure all development work stays aligned with the ultimate vision.

## Core Architecture Comparison

### Local Storybook Environment (Reference Implementation)

The local Story UI in Storybook is the **gold standard** - everything there works correctly. Key features:

1. **Design System Agnostic**: Works with any component library (Mantine, ShadCN, Material-UI, custom, etc.)
2. **Component Discovery**: Story UI MCP automatically discovers available components
3. **Documentation Integration**: Leverages Storybook's documentation for AI context
4. **Story Generation**: Creates actual Storybook story files in the left rail navigation
5. **Iteration Support**: Users can refine generated components ("add a date field", "add a buy button")
6. **Chat/Story Management**: Delete chats to remove associated story files
7. **Multi-Provider LLM**: Supports Claude, Gemini, OpenAI, etc.
8. **Multi-Framework**: Works with React, Vue, Web Components, Angular

### Production Environment (Target)

The production environment should **mimic the local Storybook functionality** with acceptable exceptions for technical limitations:

**MUST HAVE:**
- [x] Component discovery (know what components are available) ✅ 225 Mantine components
- [x] Multi-provider LLM support (Claude, Gemini, OpenAI) ✅ Provider selector in sidebar
- [ ] Multi-framework support (React, Vue, Angular, Web Components)
- [x] Story generation with live, interactive preview ✅ Live Babel transform
- [x] Iteration support (refine/modify generated components) ✅ Conversation history
- [x] Design system considerations loaded from config ✅ considerations.ts
- [x] Components rendered from user's custom design system ✅ Mantine components
- [x] Smart chat titles via LLM ✅ Auto-generated from first message

**ACCEPTABLE DIFFERENCES:**
- Does not need to use actual Storybook infrastructure
- Can use an alternative preview mechanism
- Story persistence can differ from file-based approach

## Critical User Requirements (Documented from Feedback)

### From User Feedback Session:

> "The production environment should be able to accommodate any language model provider. It should be open to use Claude or Gemini or OpenAI."

> "It should be open to any frameworks like React or Vue or Web Components or Angular just like the story UI does when used within the local environment."

> "Users should be able to generate a story and iterate on that story, and have them produce a live and interactive interface that they can click on and scroll through."

> "Those components that are creating that layout should be from their custom design system."

> "When in doubt, reference how the local story UI operates. Everything right there works great."

## Testing Requirements

**CRITICAL**: Before declaring any deployment "complete", the following must be verified:

1. [x] Navigate to production URL
2. [x] Enter a component prompt (e.g., "Create a login form")
3. [x] Verify component generation succeeds (no errors)
4. [x] Verify live preview renders correctly
5. [x] Verify iteration works (modify the generated component)
6. [x] Verify chat history persists ✅ localStorage persistence
7. [x] Verify smart title generation ✅ LLM-generated titles
8. [ ] Verify delete chat functionality works

**Verified on November 28, 2025:**
- Production URL: `https://a8a6405e.story-ui-storybook.pages.dev/`
- Backend API: `https://story-ui-mcp-edge.southleft-llc.workers.dev`
- Component generation tested with e-commerce product card prompt
- Smart title generation: "E-commerce Product Card"
- Provider selector: Claude (Anthropic) with 225 components available

## Technical Architecture Notes

### Current Issues to Resolve

1. **"Failed to fetch" Error**: The production app is failing when trying to generate components
   - Likely cause: Missing or misconfigured API endpoint
   - The app needs a backend service to proxy LLM requests (can't call LLM APIs directly from browser due to CORS)

### Required Components

1. **Frontend**: React app with component preview (Vite build)
2. **Backend**: API proxy for LLM calls (handles CORS, API keys)
3. **Component Registry**: Auto-generated from user's design system
4. **Considerations**: Design-system-specific AI guidelines

### Configuration Sources

- `story-ui.config.js` - Provider configuration (OpenAI, Claude, etc.)
- `story-ui-considerations.md` - Design system-specific AI rules
- Component registry - Auto-discovered from npm packages

## Debugging Checklist

When issues occur, systematically check:

1. [ ] Console errors in browser DevTools
2. [ ] Network tab for failed requests
3. [ ] API endpoint configuration
4. [ ] CORS configuration
5. [ ] LLM API key availability
6. [ ] Component registry loaded correctly
7. [ ] Considerations loaded correctly

## History of Issues and Resolutions

| Date | Issue | Root Cause | Resolution |
|------|-------|------------|------------|
| 2024-11-28 | LLM returning markdown | Missing assistant prefill | Added `<` prefill |
| 2024-11-28 | Iteration showing metadata | LLM returning `<budget>` tags | Improved system prompt |
| 2024-11-28 | Mantine hardcoded in App.tsx | Design-system-specific code | Moved to considerations.ts |
| 2024-11-28 | Failed to fetch | Missing `/story-ui/claude` endpoint in Cloudflare worker; `.env` pointed to non-working Railway URL | Added `/story-ui/claude` endpoint to `cloudflare-edge/src/worker.ts`; Set `ANTHROPIC_API_KEY` as worker secret; Updated `.env` to use Cloudflare worker URL |
| 2024-11-28 | White text on light background | LLM generating components with white text colors | Added universal best practices to core system prompt (theming, accessibility, responsive design) + updated design-system-specific considerations with text color guidance |

---

**Last Updated**: November 28, 2024
