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
import type { DiscoveredComponent } from '../../story-generator/componentDiscovery.js';
import type { StoryUIConfig } from '../../story-ui.config.js';
import { importSpecifierFor } from '../../story-generator/knowledge/importSpecifier.js';
import { buildFrameworkAwarePrompt } from '../../story-generator/promptGenerator.js';
import { chatCompletionDetailed, chatCompletionStream } from '../../story-generator/llm-providers/story-llm-service.js';
import { logger } from '../../story-generator/logger.js';

// ── Component discovery cache ─────────────────────────────────
let _componentCache: { components: DiscoveredComponent[]; timestamp: number } | null = null;
const COMPONENT_CACHE_TTL = 300_000; // 5 minutes

/** The design-system catalog the canvas draws from, shared with canvas save. */
export async function getCanvasComponents(config: StoryUIConfig): Promise<DiscoveredComponent[]> {
  const now = Date.now();
  if (_componentCache && now - _componentCache.timestamp < COMPONENT_CACHE_TTL) {
    return _componentCache.components;
  }
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();
  _componentCache = { components, timestamp: now };
  return components;
}

// ── Scope check ───────────────────────────────────────────────

/**
 * JSX tags the canvas uses that neither the design system nor the code itself
 * defines. The canvas scope is exactly the design-system module plus React,
 * so any other capitalised tag is a ReferenceError at render — observed as
 * `BrandBadge is not defined`, painted red where the preview should be, and
 * then saved as a story importing `BrandBadge` from a package that has no
 * such export. The sanitizer only ever looked for dangerous APIs; nothing
 * asked whether the components exist.
 */
export function unknownCanvasComponents(code: string, known: Iterable<string>): string[] {
  const available = new Set(known);
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Z][A-Za-z0-9_]*)/g)) available.add(m[1]);
  for (const m of code.matchAll(/\bimport\s+(?:\{([^}]*)\}|([A-Z][A-Za-z0-9_]*))/g)) {
    for (const n of (m[1] ?? m[2] ?? '').split(',')) {
      const local = n.trim().split(/\s+as\s+/).pop()?.trim();
      if (local) available.add(local);
    }
  }
  for (const builtin of ['React', 'Fragment', 'Canvas', 'Suspense', 'Profiler', 'StrictMode']) available.add(builtin);
  const unknown = new Set<string>();
  for (const m of code.matchAll(/<([A-Z][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)*[\s/>]/g)) {
    if (!available.has(m[1])) unknown.add(m[1]);
  }
  return [...unknown];
}

const describeUnknown = (names: string[], importPath: string): string =>
  `${names.join(', ')} ${names.length === 1 ? 'is not a component' : 'are not components'} in ${importPath || 'your design system'}.`;

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

// '!dev' keeps this out of the Storybook sidebar: it is the canvas's render
// surface, not a generated story, and a sidebar entry that shows only
// "Voice Canvas is ready" was a link that did nothing. It stays in the index,
// so the panel's iframe can still load it by id.
const meta: Meta = { title: 'Generated/Voice Canvas', tags: ['voice-canvas-internal', '!dev'] };
export default meta;

__STORY_UI_CATALOG_IMPORTS__

// Design system components set by .storybook/preview.tsx via:
//   (window as any).__STORY_UI_DESIGN_SYSTEM__ = YourDesignSystemModule;
// Optional: the catalog above already covers every discovered component;
// this hook adds anything discovery does not know, and wins on a name clash.
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
  ...catalog,
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
    // Read from localStorage on mount for the initial code delivery.
    // The parent panel writes code to localStorage just before mounting
    // the iframe, since postMessage can't work until our listener is ready.
    const [code, setCode] = useState(() => {
      try {
        const saved = localStorage.getItem('${LS_KEY}');
        if (saved && saved.trim()) return saved;
      } catch {}
      return PLACEHOLDER;
    });

    useEffect(() => {
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

/**
 * Is react-live present right now?
 *
 * Distinct from ensureReactLive, which INSTALLS it. Startup must not install
 * anything into a user's project uninvited, and must not write a file that
 * needs a dependency the project does not have — so it asks instead.
 */
export function reactLiveIsInstalled(): boolean {
  try {
    return fs.existsSync(path.join(process.cwd(), 'node_modules', 'react-live'));
  } catch {
    return false;
  }
}

export async function ensureReactLive(): Promise<void> {
  /**
   * This used to shell out to `npm install react-live --save` from inside an
   * HTTP request handler, mutating package.json and the lockfile as a side
   * effect of a POST any local page could send. A server must not install
   * packages into a user's project. `story-ui init` adds react-live for React
   * projects; if it is missing, say so and stop.
   */
  if (reactLiveChecked || reactLiveIsInstalled()) {
    reactLiveChecked = true;
    return;
  }
  throw new ReactLiveMissingError();
}

export class ReactLiveMissingError extends Error {
  constructor() {
    super('The voice canvas needs the react-live package, which is not installed in this project. Run: npm install react-live');
    this.name = 'ReactLiveMissingError';
  }
}

// ── Write story to disk (once) ────────────────────────────────

/**
 * Write the static voice-canvas story template if it doesn't exist yet.
 * Subsequent calls are no-ops — the file never changes after initial creation.
 */
export function ensureVoiceCanvasStory(storiesDir: string, source: string): void {
  const resolvedDir = path.resolve(process.cwd(), storiesDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }
  const filePath = path.resolve(resolvedDir, VOICE_CANVAS_STORY_FILE);
  // Rewritten whenever the catalog changes, so a component added to the
  // project is in scope on the next command — not on the next fresh install.
  let current: string | null = null;
  try { current = fs.readFileSync(filePath, 'utf-8'); } catch { /* absent */ }
  if (current === source) return;
  fs.writeFileSync(filePath, source, 'utf-8');
  logger.log(`[canvas-generate] ${current === null ? 'Created' : 'Updated'} voice-canvas story (${source.split('\n').length} lines)`);
}

/**
 * The voice-canvas story, with the catalog in scope.
 *
 * The scope used to be whatever `.storybook/preview.tsx` put on
 * `window.__STORY_UI_DESIGN_SYSTEM__` — the npm module and nothing else —
 * while the prompt offered every discovered component, local ones included.
 * A project's own `BrandBadge` was in the catalog, chosen by the model, and
 * a ReferenceError on the canvas. Now the story imports each discovered
 * component from where the project says it lives (the same rule the prompt
 * and the story pipeline use), so what the model is offered is what renders.
 *
 * Namespace imports, not named ones: a name discovery got wrong would make a
 * named import fail at build time and take the whole canvas with it. Through
 * a namespace a missing export is simply absent from scope, and the scope
 * check names it.
 */
export function voiceCanvasStorySource(config: StoryUIConfig, components: DiscoveredComponent[]): string {
  const byModule = new Map<string, { named: string[]; defaults: string[] }>();
  const seen = new Set<string>();
  for (const component of components) {
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(component.name) || seen.has(component.name)) continue;
    if (/\.(vue|svelte)$/.test(component.filePath || '')) continue;
    const specifier = importSpecifierFor(component, config);
    if ((component as any).__importPathUnknown === true) continue;
    if (!specifier || specifier === 'unknown' || /['"\\\n\r]/.test(specifier)) continue;
    seen.add(component.name);
    const group = byModule.get(specifier) ?? { named: [], defaults: [] };
    ((component as any).__defaultExport === true ? group.defaults : group.named).push(component.name);
    byModule.set(specifier, group);
  }
  const modules = [...byModule.entries()];
  const imports = modules.map(([specifier], i) => `import * as __sui${i} from '${specifier}';`);
  const picks = modules.map(([, g], i) => `  ...pick(__sui${i}, ${JSON.stringify(g.named)}, ${JSON.stringify(g.defaults)}),`);
  const block = [
    '// The component catalog, imported from where the project says each one',
    '// lives — generated from discovery by Story UI; edits are overwritten.',
    ...imports,
    'const pick = (ns: Record<string, unknown>, named: string[], defaults: string[]): Record<string, unknown> => ({',
    '  ...Object.fromEntries(named.filter(n => ns[n] !== undefined).map(n => [n, ns[n]])),',
    "  ...Object.fromEntries(defaults.filter(() => ns.default !== undefined).map(n => [n, ns.default])),",
    '});',
    'const catalog: Record<string, unknown> = {',
    ...picks,
    '};',
  ].join('\n');
  return VOICE_CANVAS_TEMPLATE.replace('__STORY_UI_CATALOG_IMPORTS__', block);
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

/**
 * One correction round when the canvas names components that do not exist —
 * the same shape as the story pipeline's healing loop, with the catalog as
 * the instruction. Returns the code and whatever is STILL unknown; the caller
 * refuses to ship a canvas that will not render rather than let react-live
 * report the ReferenceError.
 */
async function healUnknownComponents(
  code: string,
  rawResponse: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  known: string[],
  importPath: string,
  llm: { provider: any; model: any },
): Promise<{ code: string; unknown: string[] }> {
  const unknown = unknownCanvasComponents(code, known);
  if (unknown.length === 0 || known.length === 0) return { code, unknown: [] };
  logger.warn(`[canvas-generate] Unknown components ${unknown.join(', ')} — asking for a correction`);
  const correction = `${describeUnknown(unknown, importPath)} The canvas can only use the components listed ` +
    `in "Available Components" above, plus plain HTML elements. Rewrite the canvas without ${unknown.join(', ')}: ` +
    `build the same thing from components that exist. Return the complete corrected code only.`;
  const retry = await chatCompletionDetailed(
    [...messages, { role: 'assistant', content: rawResponse }, { role: 'user', content: correction }],
    { provider: llm.provider, model: llm.model, maxTokens: 4096, temperature: 0.3 },
  );
  const healed = sanitizeCanvasCode(extractCanvasCode(retry.content));
  return { code: healed, unknown: unknownCanvasComponents(healed, known) };
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
    const components = await getCanvasComponents(config);

    // Build the system prompt through the SAME adapter-driven pipeline as
    // standard generation (component reference, docs, considerations, custom
    // local components) — the canvas suffix then overrides the output format.
    const baseSystemPrompt = await buildFrameworkAwarePrompt(prompt, config, components, { framework: 'react' });
    const systemPrompt = baseSystemPrompt + '\n' + CANVAS_MODE_SUFFIX;
    const knownNames = components.map(c => c.name);

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

    // react-live must already be present; the server never installs it.
    try {
      await ensureReactLive();
    } catch (err) {
      if (err instanceof ReactLiveMissingError) {
        res.status(424).json({ success: false, error: err.message, code: 'REACT_LIVE_MISSING' });
        return;
      }
      throw err;
    }
    const storiesDir = config.generatedStoriesPath || './src/stories/generated/';
    ensureVoiceCanvasStory(storiesDir, voiceCanvasStorySource(config, components));

    // Streaming mode: emit raw LLM text deltas over SSE so the canvas can show
    // the code being written in real time, then a final `complete` event with
    // the extracted + sanitized code that actually gets rendered.
    if (req.body.stream === true) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let fullResponse = '';
      try {
        for await (const delta of chatCompletionStream(messages, {
          provider: provider as any,
          model,
          maxTokens: 4096,
          temperature: 0.3,
        })) {
          fullResponse += delta;
          res.write(`event: chunk\ndata: ${JSON.stringify({ delta })}\n\n`);
        }

        const rawCode = extractCanvasCode(fullResponse);
        const healed = await healUnknownComponents(sanitizeCanvasCode(rawCode), fullResponse, messages, knownNames, config.importPath || '', { provider, model });
        if (healed.unknown.length > 0) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: `${describeUnknown(healed.unknown, config.importPath || '')} Try naming a component that exists, or describe the element instead.`, code: 'UNKNOWN_COMPONENTS', components: healed.unknown })}\n\n`);
          res.end();
          return;
        }
        const result = healed.code;
        logger.log(`[canvas-generate] Streamed ${result.split('\n').length} lines for: "${prompt.slice(0, 60)}"`);
        res.write(`event: complete\ndata: ${JSON.stringify({ canvasCode: result, storyId: VOICE_CANVAS_STORY_ID })}\n\n`);
      } catch (streamError) {
        const message = streamError instanceof Error ? streamError.message : String(streamError);
        logger.error('[canvas-generate] Stream error', { error: message });
        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      }
      res.end();
      return;
    }

    // Non-streaming mode (legacy clients)
    const response = await chatCompletionDetailed(messages, {
      provider: provider as any,
      model,
      maxTokens: 4096,
      temperature: 0.3,
    });

    if (response.truncated) {
      logger.warn('[canvas-generate] LLM response truncated at token limit');
    }

    // Extract the canvas code from the LLM response and sanitize it.
    // sanitizeCanvasCode neutralizes dangerous patterns (eval, fetch, script
    // injection, prototype pollution, etc.) before the code reaches the
    // client where react-live would execute it as arbitrary JS.
    const rawCode = extractCanvasCode(response.content);
    const healed = await healUnknownComponents(sanitizeCanvasCode(rawCode), response.content, messages, knownNames, config.importPath || '', { provider, model });
    if (healed.unknown.length > 0) {
      return res.status(422).json({
        error: `${describeUnknown(healed.unknown, config.importPath || '')} Try naming a component that exists, or describe the element instead.`,
        code: 'UNKNOWN_COMPONENTS',
        components: healed.unknown,
      });
    }
    const result = healed.code;

    logger.log(`[canvas-generate] Generated ${result.split('\n').length} lines for: "${prompt.slice(0, 60)}"`);

    return res.json({
      canvasCode: result,
      storyId: VOICE_CANVAS_STORY_ID,
      truncated: response.truncated || undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[canvas-generate] Error', { error: message });
    return res.status(500).json({ error: message });
  }
}
