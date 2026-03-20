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
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import { buildClaudePrompt } from '../../story-generator/promptGenerator.js';
import { chatCompletion } from '../../story-generator/llm-providers/story-llm-service.js';
import { logger } from '../../story-generator/logger.js';

// ── Component discovery cache ─────────────────────────────────
let _componentCache: { components: any[]; timestamp: number } | null = null;
const COMPONENT_CACHE_TTL = 300_000; // 5 minutes

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

const meta: Meta = { title: 'Generated/Voice Canvas', tags: ['voice-canvas-internal'] };
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
    // Always start with the placeholder — no localStorage restore.
    // Code updates arrive exclusively via postMessage from the parent panel.
    // This prevents stale code from a previous session causing errors.
    const [code, setCode] = useState(PLACEHOLDER);

    useEffect(() => {
      // Clear any stale code left in localStorage from older versions
      try { localStorage.removeItem('${LS_KEY}'); } catch {}

      const handler = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        if (e.data?.type === 'VOICE_CANVAS_UPDATE' && typeof e.data.code === 'string') {
          setCode(e.data.code);
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
let reactLiveInstalling: Promise<void> | null = null;

export async function ensureReactLive(): Promise<void> {
  if (reactLiveChecked) return;
  // If another request is already installing, wait for it
  if (reactLiveInstalling) return reactLiveInstalling;

  const cwd = process.cwd();
  const reactLiveDir = path.join(cwd, 'node_modules', 'react-live');
  if (fs.existsSync(reactLiveDir)) {
    reactLiveChecked = true;
    return;
  }

  logger.log('[canvas-generate] react-live not found — installing...');

  reactLiveInstalling = (async () => {
    try {
      let cmd = 'npm install react-live --save';
      if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
        cmd = 'pnpm add react-live';
      } else if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
        cmd = 'yarn add react-live';
      }
      await execAsync(cmd, { cwd });
      reactLiveChecked = true;
      logger.log('[canvas-generate] react-live installed successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[canvas-generate] Could not auto-install react-live', { error: msg });
      logger.log('[canvas-generate] Run manually: npm install react-live');
    } finally {
      reactLiveInstalling = null;
    }
  })();

  return reactLiveInstalling;
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
 * If the LLM forgot to add a render() call (required by react-live noInline mode),
 * detect the last defined PascalCase component and append render(<ComponentName />).
 * This prevents the "No-Inline evaluations must call render" error when voice input
 * is ambiguous or short and the LLM skips the final line.
 */
export function ensureRenderCall(code: string): string {
  if (/\brender\s*\(/.test(code)) return code;

  // Find the last PascalCase component/const defined in the code
  const matches = [...code.matchAll(/(?:const|function)\s+([A-Z][A-Za-z0-9]*)/g)];
  const componentName = matches.at(-1)?.[1] ?? 'Canvas';
  return `${code}\nrender(<${componentName} />);`;
}

/**
 * Extract the canvas component code from the LLM response.
 * Handles markdown code fences and stray text.
 */
export function extractCanvasCode(response: string): string {
  let code: string;

  // Prefer explicit code fence
  const fenceMatch = response.match(/```(?:jsx|tsx|js|ts)?\n([\s\S]+?)\n```/);
  if (fenceMatch) {
    code = fenceMatch[1].trim();
  } else {
    // Fall back: find the Canvas component block
    const canvasMatch = response.match(/(const Canvas\s*=[\s\S]+?render\s*\(<Canvas\s*\/>?\);?\s*$)/m);
    code = canvasMatch ? canvasMatch[1].trim() : response.trim();
  }

  return ensureRenderCall(code);
}

// ── Security sanitization ─────────────────────────────────────

/**
 * Dangerous patterns that must be neutralized in LLM-generated canvas code.
 *
 * Each entry defines a regex (applied with the global flag) and a replacement
 * string.  The replacement comments out the dangerous call so the surrounding
 * code still parses — this avoids rejecting an entire response because the LLM
 * happened to mention one of these tokens inside a string literal or comment.
 *
 * Categories covered:
 *   - Arbitrary code execution (eval, Function constructor)
 *   - Cookie / domain access
 *   - Storage APIs (localStorage, sessionStorage)
 *   - Network requests (fetch, XMLHttpRequest, WebSocket)
 *   - Location manipulation
 *   - Script injection
 *   - Unsafe React patterns (dangerouslySetInnerHTML)
 *   - Prototype pollution (__proto__, constructor.prototype)
 *   - Dynamic / CommonJS imports
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string; replacement: string }> = [
  // Arbitrary code execution
  { pattern: /\beval\s*\(/g,             label: 'eval()',               replacement: '/* [sanitized: eval] */void(' },
  { pattern: /\bnew\s+Function\s*\(/g,   label: 'new Function()',       replacement: '/* [sanitized: new Function] */void(' },
  { pattern: /\bFunction\s*\(/g,         label: 'Function()',           replacement: '/* [sanitized: Function] */void(' },

  // Cookie / domain access
  { pattern: /\bdocument\.cookie\b/g,    label: 'document.cookie',      replacement: '/* [sanitized: document.cookie] */undefined' },
  { pattern: /\bdocument\.domain\b/g,    label: 'document.domain',      replacement: '/* [sanitized: document.domain] */undefined' },

  // Storage APIs
  { pattern: /\blocalStorage\b/g,        label: 'localStorage',         replacement: '/* [sanitized: localStorage] */undefined' },
  { pattern: /\bsessionStorage\b/g,      label: 'sessionStorage',       replacement: '/* [sanitized: sessionStorage] */undefined' },

  // Network requests
  { pattern: /\bfetch\s*\(/g,           label: 'fetch()',              replacement: '/* [sanitized: fetch] */void(' },
  { pattern: /\bnew\s+XMLHttpRequest\b/g, label: 'XMLHttpRequest',     replacement: '/* [sanitized: XMLHttpRequest] */undefined' },
  { pattern: /\bXMLHttpRequest\b/g,      label: 'XMLHttpRequest',      replacement: '/* [sanitized: XMLHttpRequest] */undefined' },
  { pattern: /\bnew\s+WebSocket\s*\(/g,  label: 'WebSocket',           replacement: '/* [sanitized: WebSocket] */void(' },
  { pattern: /\bWebSocket\s*\(/g,        label: 'WebSocket',           replacement: '/* [sanitized: WebSocket] */void(' },

  // Location manipulation
  { pattern: /\bwindow\.location\b/g,    label: 'window.location',      replacement: '/* [sanitized: window.location] */undefined' },

  // Script injection
  { pattern: /<script\b/gi,             label: '<script>',             replacement: '/* [sanitized: script tag] */undefined' },

  // Unsafe React patterns
  { pattern: /\bdangerouslySetInnerHTML\b/g, label: 'dangerouslySetInnerHTML', replacement: '/* [sanitized: dangerouslySetInnerHTML] */undefined' },

  // Prototype pollution
  { pattern: /__proto__/g,              label: '__proto__',            replacement: '/* [sanitized: __proto__] */undefined' },
  { pattern: /\bconstructor\.prototype\b/g, label: 'constructor.prototype', replacement: '/* [sanitized: constructor.prototype] */undefined' },

  // Dynamic imports
  { pattern: /\bimport\s*\(/g,          label: 'dynamic import()',     replacement: '/* [sanitized: dynamic import] */void(' },

  // CommonJS require
  { pattern: /\brequire\s*\(/g,         label: 'require()',            replacement: '/* [sanitized: require] */void(' },
];

/**
 * Scan LLM-generated canvas code for dangerous patterns and neutralize them.
 *
 * Instead of rejecting the entire response, each dangerous token is replaced
 * with a safe alternative (typically a comment + `undefined` or `void(`) so
 * the rest of the generated JSX remains functional.
 *
 * Returns the sanitized code string.  Logs a warning for every pattern found.
 */
export function sanitizeCanvasCode(code: string): string {
  let sanitized = code;
  const found: string[] = [];

  for (const { pattern, label, replacement } of DANGEROUS_PATTERNS) {
    // Reset lastIndex in case the regex was used before (global flag)
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      found.push(label);
      // Reset again before replace — .test() advances lastIndex
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, replacement);
    }
  }

  if (found.length > 0) {
    logger.warn(
      `[canvas-generate] Sanitized ${found.length} dangerous pattern(s) from LLM output: ${found.join(', ')}`
    );
  }

  return sanitized;
}

// ── Handler ───────────────────────────────────────────────────

export async function canvasGenerateHandler(req: Request, res: Response) {
  try {
    let {
      prompt,
      canvasCode,
      provider,
      model,
      conversationHistory = [],
    } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // ── Request body size limits (truncate, don't reject) ──────
    const MAX_PROMPT = 5_000;
    const MAX_CANVAS_CODE = 50_000;
    const MAX_HISTORY_ENTRIES = 50;
    const MAX_HISTORY_CONTENT = 10_000;

    if (prompt.length > MAX_PROMPT) {
      prompt = prompt.slice(0, MAX_PROMPT);
    }
    if (canvasCode && typeof canvasCode === 'string' && canvasCode.length > MAX_CANVAS_CODE) {
      canvasCode = canvasCode.slice(0, MAX_CANVAS_CODE);
    }
    if (Array.isArray(conversationHistory)) {
      if (conversationHistory.length > MAX_HISTORY_ENTRIES) {
        conversationHistory = conversationHistory.slice(-MAX_HISTORY_ENTRIES);
      }
      for (const entry of conversationHistory) {
        if (entry && typeof entry.content === 'string' && entry.content.length > MAX_HISTORY_CONTENT) {
          entry.content = entry.content.slice(0, MAX_HISTORY_CONTENT);
        }
      }
    }

    // Load config + discover components — same quality context as standard generation
    const config = loadUserConfig();

    // Voice Canvas requires React — it uses react-live to render JSX in the browser.
    if (config.componentFramework && config.componentFramework !== 'react') {
      return res.status(400).json({
        error: `Voice Canvas is only available for React-based Storybook projects. Current framework: ${config.componentFramework}`,
      });
    }
    let components: any[];
    const now = Date.now();
    if (_componentCache && now - _componentCache.timestamp < COMPONENT_CACHE_TTL) {
      components = _componentCache.components;
    } else {
      const discovery = new EnhancedComponentDiscovery(config);
      components = await discovery.discoverAll();
      _componentCache = { components, timestamp: now };
    }

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

    // Extract the canvas code from the LLM response and sanitize it.
    // sanitizeCanvasCode neutralizes dangerous patterns (eval, fetch, script
    // injection, prototype pollution, etc.) before the code reaches the
    // client where react-live would execute it as arbitrary JS.
    const rawCode = extractCanvasCode(response);
    const result = sanitizeCanvasCode(rawCode);

    // Ensure react-live is installed and story template exists (no-ops after first run)
    await ensureReactLive();
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
