/**
 * Canvas Generate Endpoint
 *
 * Generates a JSX component for the Voice Canvas preview.
 * Uses the same quality pipeline as standard story generation.
 * Writes a voice-canvas.stories.tsx file so the iframe renders with
 * the full Storybook decorator chain (Provider, themes, etc.).
 *
 * Voice Canvas requires a React-based Storybook framework.
 * Components come from window.__STORY_UI_DESIGN_SYSTEM__ set in .storybook/preview.tsx.
 *
 * POST /mcp/canvas-generate
 * Body: { prompt, canvasCode?, provider, model, conversationHistory? }
 * Returns: { canvasCode: string, storyId: string }
 */

import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import { buildClaudePrompt } from '../../story-generator/promptGenerator.js';
import { chatCompletion } from '../../story-generator/llm-providers/story-llm-service.js';
import { logger } from '../../story-generator/logger.js';

// ── Constants ─────────────────────────────────────────────────
export const VOICE_CANVAS_STORY_ID = 'generated-voice-canvas--default';
const VOICE_CANVAS_STORY_FILE = 'voice-canvas.stories.tsx';
const LS_KEY = '__voice_canvas_code__';

// ── Canvas-mode output format instructions ────────────────────
const CANVAS_MODE_SUFFIX = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CANVAS MODE — OUTPUT FORMAT (REQUIRED)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are generating a live preview component for react-live.

OUTPUT EXACTLY this structure — nothing else:

\`\`\`jsx
const Canvas = () => {
  // useState / useEffect hooks if the UI needs interactivity
  return (
    <ComponentFromDesignSystem>
      ...
    </ComponentFromDesignSystem>
  );
};
render(<Canvas />);
\`\`\`

STRICT RULES:
• Do NOT include import statements — all components are in scope
• Do NOT include TypeScript types or type annotations
• Do NOT include export statements or Storybook boilerplate (Meta, StoryObj, etc.)
• The component MUST be named exactly "Canvas"
• The last line MUST be: render(<Canvas />);
• Use REAL design system component names — avoid raw HTML elements (<div>, <p>, <span>)
• Use proper design system variants, sizes, and color schemes
• Use realistic content (not placeholder text / lorem ipsum)
• For multi-step or interactive UIs, use useState hooks inside Canvas
• Do NOT use any icon libraries (Tabler, Heroicons, FontAwesome, Lucide, etc.) — icons are NOT in scope
• For images, use STABLE picsum.photos seed URLs: https://picsum.photos/seed/{word}/{width}/{height}
  Example: https://picsum.photos/seed/mountain/400/250
  NEVER use ?random=N — that returns a different image on every request
`;

// ── Static story template ─────────────────────────────────────
//
// This template is written ONCE (the first time a user generates).
// It never changes on subsequent generations or undo/redo, which means
// Vite HMR is never triggered after the initial write — eliminating the
// cascade that reset the outer StoryUIPanel.
//
// Code updates are delivered via:
//   1. localStorage (persists across iframe reloads)
//   2. window.postMessage (instant in-place updates)
//
const VOICE_CANVAS_TEMPLATE = `import React, { useState, useEffect } from 'react';
import { LiveProvider, LivePreview, LiveError } from 'react-live';
import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = { title: 'Generated/Voice Canvas' };
export default meta;

// Design system components set by .storybook/preview.tsx via:
//   (window as any).__STORY_UI_DESIGN_SYSTEM__ = YourDesignSystemModule;
// Works with any React component library (Mantine, Chakra, MUI, shadcn, etc.)
const designSystem = (window as any).__STORY_UI_DESIGN_SYSTEM__ || {};

// Module-level scope — created once, never recreated, so react-live
// does not re-transpile on every parent re-render.
const scope = {
  React,
  useState: React.useState,
  useEffect: React.useEffect,
  useCallback: React.useCallback,
  useMemo: React.useMemo,
  useRef: React.useRef,
  useReducer: React.useReducer,
  useContext: React.useContext,
  ...designSystem,
};

// Optional themed provider set in preview.tsx via:
//   (window as any).__STORY_UI_CANVAS_PROVIDER__ = ({ children }) => <Provider>{children}</Provider>;
// Falls back to a passthrough if not configured.
const CanvasProvider: React.ComponentType<{ children: React.ReactNode }> =
  (window as any).__STORY_UI_CANVAS_PROVIDER__ ||
  (({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children));

const PLACEHOLDER = \`const Canvas = () => (
  <div style={{ padding: '24px', textAlign: 'center', color: '#868e96' }}>
    Voice Canvas is ready — describe what you want to build
  </div>
);
render(<Canvas />);\`;

export const Default: StoryObj = {
  render: () => {
    const [code, setCode] = useState(() => {
      try { return localStorage.getItem('${LS_KEY}') || PLACEHOLDER; }
      catch { return PLACEHOLDER; }
    });

    useEffect(() => {
      const handler = (e: MessageEvent) => {
        if (e.data?.type === 'VOICE_CANVAS_UPDATE' && typeof e.data.code === 'string') {
          setCode(e.data.code);
          try { localStorage.setItem('${LS_KEY}', e.data.code); } catch {}
        }
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    }, []);

    return (
      <CanvasProvider>
        <LiveProvider code={code} scope={scope} noInline>
          <LivePreview />
          <LiveError style={{ color: 'red', fontFamily: 'monospace', fontSize: '12px', padding: '8px', whiteSpace: 'pre-wrap' }} />
        </LiveProvider>
      </CanvasProvider>
    );
  },
};
`;

// ── Dependency check ──────────────────────────────────────────

/**
 * Ensure react-live is installed in the user's project.
 * Runs once on first canvas-generate call and is a no-op thereafter.
 * Detects pnpm / yarn / npm automatically.
 */
let reactLiveChecked = false;
export function ensureReactLive(): void {
  if (reactLiveChecked) return;
  reactLiveChecked = true;

  const cwd = process.cwd();
  const reactLiveDir = path.join(cwd, 'node_modules', 'react-live');
  if (fs.existsSync(reactLiveDir)) return;

  logger.log('[canvas-generate] react-live not found — installing...');
  try {
    let cmd = 'npm install react-live --save';
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
      cmd = 'pnpm add react-live';
    } else if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
      cmd = 'yarn add react-live';
    }
    execSync(cmd, { cwd, stdio: 'pipe' });
    logger.log('[canvas-generate] react-live installed successfully');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[canvas-generate] Could not auto-install react-live', { error: msg });
    logger.log('[canvas-generate] Run manually: npm install react-live');
  }
}

// ── Write story to disk (once) ────────────────────────────────

/**
 * Write the static voice-canvas story template if it doesn't exist yet.
 * Subsequent calls are no-ops — the file never changes after initial creation.
 */
export function ensureVoiceCanvasStory(storiesDir: string): void {
  const resolvedDir = path.resolve(process.cwd(), storiesDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }
  const filePath = path.resolve(resolvedDir, VOICE_CANVAS_STORY_FILE);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, VOICE_CANVAS_TEMPLATE, 'utf-8');
    logger.log('[canvas-generate] Created voice-canvas story template');
  }
}

// ── Code extraction ───────────────────────────────────────────

/**
 * Extract the canvas component code from the LLM response.
 * Handles markdown code fences and stray text.
 */
function extractCanvasCode(response: string): string {
  // Prefer explicit code fence
  const fenceMatch = response.match(/```(?:jsx|tsx|js|ts)?\n([\s\S]+?)\n```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Fall back: find the Canvas component block
  const canvasMatch = response.match(/(const Canvas\s*=[\s\S]+?render\s*\(<Canvas\s*\/>?\);?\s*$)/m);
  if (canvasMatch) return canvasMatch[1].trim();

  // Last resort: return the whole response trimmed
  return response.trim();
}

// ── Handler ───────────────────────────────────────────────────

export async function canvasGenerateHandler(req: Request, res: Response) {
  try {
    const {
      prompt,
      canvasCode,
      provider,
      model,
      conversationHistory = [],
    } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Load config + discover components — same quality context as standard generation
    const config = loadUserConfig();

    // Voice Canvas requires React — it uses react-live to render JSX in the browser.
    if (config.componentFramework && config.componentFramework !== 'react') {
      return res.status(400).json({
        error: `Voice Canvas is only available for React-based Storybook projects. Current framework: ${config.componentFramework}`,
      });
    }
    const discovery = new EnhancedComponentDiscovery(config);
    const components = await discovery.discoverAll();

    // Build the system prompt using the standard prompt pipeline
    const baseSystemPrompt = await buildClaudePrompt(prompt, config, components);
    const systemPrompt = baseSystemPrompt + '\n' + CANVAS_MODE_SUFFIX;

    // Build the user message — include current canvas code for edit requests
    let userMessage = prompt;
    if (canvasCode && typeof canvasCode === 'string' && canvasCode.trim()) {
      userMessage = `Current canvas:\n\`\`\`jsx\n${canvasCode}\n\`\`\`\n\nInstruction: ${prompt}`;
    }

    // Build message array with conversation history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: userMessage },
    ];

    // Call the LLM
    const response = await chatCompletion(messages, {
      provider: provider as any,
      model,
      maxTokens: 4096,
      temperature: 0.3,
    });

    // Extract the canvas code from the LLM response
    const result = extractCanvasCode(response);

    // Ensure react-live is installed and story template exists (no-ops after first run)
    ensureReactLive();
    const storiesDir = config.generatedStoriesPath || './src/stories/generated/';
    ensureVoiceCanvasStory(storiesDir);

    logger.log(`[canvas-generate] Generated ${result.split('\n').length} lines for: "${prompt.slice(0, 60)}"`);

    return res.json({
      canvasCode: result,
      storyId: VOICE_CANVAS_STORY_ID,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[canvas-generate] Error', { error: message });
    return res.status(500).json({ error: message });
  }
}
