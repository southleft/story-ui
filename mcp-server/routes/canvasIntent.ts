/**
 * Canvas Intent Endpoint
 *
 * Translates natural language voice/text input into structured canvas operations
 * using Claude tool_use. Designed for speed — uses Haiku with a compact prompt.
 *
 * POST /mcp/canvas-intent
 * Body: { transcript, currentState, conversationHistory, availableComponents, provider, model }
 * Returns: { operations, explanation }
 */

import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import { DocumentationLoader } from '../../story-generator/documentationLoader.js';
import { loadConsiderations, considerationsToPrompt } from '../../story-generator/considerationsLoader.js';
import { logger } from '../../story-generator/logger.js';

// ── Tool definitions for canvas operations ──────────────────

const CANVAS_TOOLS = [
  {
    name: 'replace_tree',
    description: 'Replace the entire component tree. Use for initial creation or major restructuring. Build the FULL tree — do not leave placeholders.',
    input_schema: {
      type: 'object' as const,
      properties: {
        root: {
          type: 'array' as const,
          description: 'Complete array of root-level component nodes',
          items: {
            type: 'object' as const,
            additionalProperties: true,
            properties: {
              component: { type: 'string' as const, description: 'Component name (e.g. "Card", "Button", "Card.Section")' },
              props: { type: 'object' as const, additionalProperties: true, description: 'Component props as key-value pairs. Use design system tokens (e.g. color="blue", size="lg") not raw CSS.' },
              children: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: true }, description: 'Nested child component nodes' },
              textContent: { type: 'string' as const, description: 'Text content for leaf nodes' },
            },
            required: ['component'],
          },
        },
      },
      required: ['root'],
    },
  },
  {
    name: 'add_component',
    description: 'Add a single component to the existing tree.',
    input_schema: {
      type: 'object' as const,
      properties: {
        parentId: { type: 'string' as const, description: 'ID of parent node. Omit for root level.' },
        position: { type: 'string' as const, description: 'Position among siblings (number as string, or "end")' },
        component: { type: 'string' as const, description: 'Component name' },
        props: { type: 'object' as const, additionalProperties: true, description: 'Component props' },
        children: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: true }, description: 'Nested children' },
        textContent: { type: 'string' as const, description: 'Text content for leaf nodes' },
      },
      required: ['component'],
    },
  },
  {
    name: 'remove_component',
    description: 'Remove a component from the tree by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        targetId: { type: 'string' as const, description: 'ID of the node to remove' },
      },
      required: ['targetId'],
    },
  },
  {
    name: 'update_props',
    description: 'Update props on an existing component. Merged with existing props.',
    input_schema: {
      type: 'object' as const,
      properties: {
        targetId: { type: 'string' as const, description: 'ID of the node to update' },
        props: { type: 'object' as const, additionalProperties: true, description: 'Props to set or update' },
        removeProps: { type: 'array' as const, items: { type: 'string' as const }, description: 'Prop names to remove' },
      },
      required: ['targetId', 'props'],
    },
  },
  {
    name: 'move_component',
    description: 'Move a component to a new parent or position.',
    input_schema: {
      type: 'object' as const,
      properties: {
        targetId: { type: 'string' as const, description: 'ID of the node to move' },
        newParentId: { type: 'string' as const, description: 'New parent ID. Omit for root level.' },
        position: { type: 'string' as const, description: 'Position among new siblings (number as string, or "end")' },
      },
      required: ['targetId'],
    },
  },
  {
    name: 'set_text',
    description: 'Set the text content of a component.',
    input_schema: {
      type: 'object' as const,
      properties: {
        targetId: { type: 'string' as const, description: 'ID of the node' },
        textContent: { type: 'string' as const, description: 'New text content' },
      },
      required: ['targetId', 'textContent'],
    },
  },
];

// ── Design considerations cache ──────────────────────────────

let _cachedConsiderations: string | null = null;
let _cachedConsiderationsTime = 0;
const CONSIDERATIONS_CACHE_TTL = 300_000; // 5 min

/**
 * Load design system considerations/documentation using the same sources
 * as the standard story generator (DocumentationLoader + legacy considerations).
 * Result is truncated to keep the canvas-intent prompt compact.
 */
async function loadDesignConsiderations(config: { considerationsPath?: string }): Promise<string> {
  const now = Date.now();
  if (_cachedConsiderations && now - _cachedConsiderationsTime < CONSIDERATIONS_CACHE_TTL) {
    return _cachedConsiderations;
  }

  const MAX_CHARS = 2000;

  try {
    // 1. Try directory-based documentation (story-ui-docs/) — same as standard generator
    const projectRoot = config.considerationsPath
      ? config.considerationsPath.replace(/\/story-ui-considerations\.(md|json)$/, '')
      : process.cwd();

    const docLoader = new DocumentationLoader(projectRoot);
    if (docLoader.hasDocumentation()) {
      const docs = await docLoader.loadDocumentation();
      if (docs.sources.length > 0) {
        let content = docLoader.formatForPrompt(docs);
        if (content) {
          if (content.length > MAX_CHARS) {
            content = content.substring(0, MAX_CHARS) + '\n...(truncated)';
          }
          _cachedConsiderations = content;
          _cachedConsiderationsTime = now;
          return _cachedConsiderations;
        }
      }
    }

    // 2. Fall back to legacy considerations file
    const considerations = loadConsiderations(config.considerationsPath);
    if (considerations) {
      let content = considerationsToPrompt(considerations);
      if (content) {
        if (content.length > MAX_CHARS) {
          content = content.substring(0, MAX_CHARS) + '\n...(truncated)';
        }
        _cachedConsiderations = content;
        _cachedConsiderationsTime = now;
        return _cachedConsiderations;
      }
    }
  } catch (err) {
    logger.warn('Failed to load design considerations:', err);
  }

  _cachedConsiderations = '';
  _cachedConsiderationsTime = now;
  return '';
}

// ── Build system prompt ─────────────────────────────────────

function buildSystemPrompt(
  componentNames: string[],
  designSystem: string,
  considerations: string,
  iconPackage: string | null
): string {
  const parts: string[] = [];

  parts.push(`You are an expert UI architect. You compose high-fidelity interfaces using the "${designSystem}" design system. You have deep knowledge of this design system's components, props, variants, and best practices.`);

  // Design system guidelines from project documentation
  if (considerations) {
    parts.push(`
DESIGN SYSTEM GUIDELINES:
${considerations}`);
  }

  // Icon guidance
  if (iconPackage) {
    parts.push(`
ICONS: Import icons from "${iconPackage}". Use icon components directly as children (e.g. { "component": "IconHeart", "props": { "size": 16 } }). Icon components are valid even if not in the AVAILABLE COMPONENTS list.`);
  }

  parts.push(`
AVAILABLE COMPONENTS:
${componentNames.join(', ')}

COMPOSITION RULES:
- Use ONLY components from the list above (plus icon components if an icon package is available). Never invent component names.
- Use the design system's native prop API — you know the correct prop names, values, and conventions for "${designSystem}".
- NEVER use raw CSS, inline styles, or hex colors. Always use the design system's prop tokens and theme values.
- Sub-components use dot notation: e.g., "Card.Section", "Tabs.Tab", "List.Item" — if the design system uses this pattern.
- textContent is for text leaf nodes. Use the design system's Text/Typography component for styled text.
- When modifying an existing tree, reference nodes by their "id" field.
- For EDITS to an existing tree: ALWAYS use incremental operations (update_props, add_component, remove_component, set_text, move_component). NEVER use replace_tree for edits — it destroys the existing tree and causes visual flicker. Only use replace_tree for the INITIAL creation when the canvas is empty.
- Respond ONLY with tool calls. No prose.

LAYOUT INTELLIGENCE:
- For SMALL components (card, button, alert, badge, switch, input): Center on the canvas. Use the design system's centering/flex component. Constrain width to ~420px for cards, ~500px for forms.
- For FULL-WIDTH layouts (header, footer, hero, navbar, page, dashboard): Use full width with proper layout components from the design system.
- For GRIDS/LISTS (product grid, pricing table, team members): Use the design system's grid component. Each item should be a complete component with realistic content.

NESTING RULES:
- Sub-components MUST be nested inside their parent. Never place a sub-component (like Card.Section) outside its parent (Card).
- Always verify parent-child constraints before placing sub-components.

QUALITY STANDARDS:
- Generate REALISTIC placeholder content — real names, addresses, prices, descriptions. Never use "Lorem ipsum" or generic placeholder text.
- Use STRONG visual hierarchy: bold headings, clear secondary text, prominent prices and status indicators.
- Main body text must be dark and readable — avoid making everything dimmed or light.
- Use the design system's color tokens for emphasis: green for prices/success, red for errors/urgent, blue for primary actions.
- Add visual polish: shadows, borders, proper padding/spacing, rounded corners — using the design system's tokens.
- For images: use src="https://picsum.photos/600/400" for realistic photo placeholders. Vary dimensions to match context (e.g. "https://picsum.photos/300/200" for thumbnails, "https://picsum.photos/800/400" for hero banners). Add ?random=N for unique images in lists.
- Make it look like a POLISHED, PRODUCTION-READY component — not a wireframe or prototype.`);

  return parts.join('\n');
}

// ── Provider-agnostic API call with tool_use ────────────────

async function callWithTools(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  provider: string,
  model: string
): Promise<{ toolCalls: Array<{ name: string; arguments: Record<string, any> }>; explanation: string }> {
  // Currently supports Claude — extend for OpenAI/Gemini as needed
  if (provider === 'openai') {
    return callOpenAIWithTools(systemPrompt, messages, model);
  }
  if (provider === 'gemini') {
    return callGeminiWithTools(systemPrompt, messages, model);
  }
  // Default: Claude
  return callClaudeWithTools(systemPrompt, messages, model);
}

async function callClaudeWithTools(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  model: string
): Promise<{ toolCalls: Array<{ name: string; arguments: Record<string, any> }>; explanation: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      tools: CANVAS_TOOLS,
      tool_choice: { type: 'any' }, // Force tool use
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(30000), // 30s timeout
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} — ${err}`);
  }

  const data = await response.json() as any;

  const toolCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
  let explanation = '';

  for (const block of data.content || []) {
    if (block.type === 'tool_use') {
      toolCalls.push({ name: block.name, arguments: block.input });
    }
    if (block.type === 'text') {
      explanation += block.text;
    }
  }

  return { toolCalls, explanation };
}

async function callOpenAIWithTools(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  model: string
): Promise<{ toolCalls: Array<{ name: string; arguments: Record<string, any> }>; explanation: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  // Convert tool format for OpenAI
  const tools = CANVAS_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      tools,
      tool_choice: 'required',
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json() as any;
  const choice = data.choices?.[0];

  const toolCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
  let explanation = choice?.message?.content || '';

  for (const tc of choice?.message?.tool_calls || []) {
    if (tc.type === 'function') {
      try {
        toolCalls.push({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        });
      } catch (parseErr) { logger.warn('Failed to parse tool call arguments:', parseErr); }
    }
  }

  return { toolCalls, explanation };
}

async function callGeminiWithTools(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  model: string
): Promise<{ toolCalls: Array<{ name: string; arguments: Record<string, any> }>; explanation: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const geminiModel = model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

  // Convert tools for Gemini format — strip additionalProperties (unsupported)
  function stripAdditionalProperties(obj: any): any {
    if (Array.isArray(obj)) return obj.map(stripAdditionalProperties);
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'additionalProperties') continue;
        result[k] = stripAdditionalProperties(v);
      }
      return result;
    }
    return obj;
  }

  const functionDeclarations = CANVAS_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: stripAdditionalProperties(t.input_schema),
  }));

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations }],
      tool_config: { function_calling_config: { mode: 'ANY' } },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} — ${err}`);
  }

  const data = await response.json() as any;
  const parts = data.candidates?.[0]?.content?.parts || [];

  const toolCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
  let explanation = '';

  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({
        name: part.functionCall.name,
        arguments: part.functionCall.args || {},
      });
    }
    if (part.text) {
      explanation += part.text;
    }
  }

  return { toolCalls, explanation };
}

// ── Convert tool calls to CanvasOperations ──────────────────

function toolCallToOperation(tc: { name: string; arguments: Record<string, any> }): any {
  switch (tc.name) {
    case 'replace_tree':
      return { type: 'replace_tree', root: tc.arguments.root || [] };
    case 'add_component':
      return {
        type: 'add_component',
        parentId: tc.arguments.parentId ?? null,
        position: tc.arguments.position ?? 'end',
        node: {
          component: tc.arguments.component,
          props: tc.arguments.props || {},
          children: tc.arguments.children || [],
          textContent: tc.arguments.textContent,
        },
      };
    case 'remove_component':
      return { type: 'remove_component', targetId: tc.arguments.targetId };
    case 'update_props':
      return {
        type: 'update_props',
        targetId: tc.arguments.targetId,
        props: tc.arguments.props || {},
        removeProps: tc.arguments.removeProps,
      };
    case 'move_component':
      return {
        type: 'move_component',
        targetId: tc.arguments.targetId,
        newParentId: tc.arguments.newParentId ?? null,
        position: tc.arguments.position ?? 'end',
      };
    case 'set_text':
      return {
        type: 'set_text',
        targetId: tc.arguments.targetId,
        textContent: tc.arguments.textContent || '',
      };
    default:
      return null;
  }
}

// ── Component discovery cache ───────────────────────────────

let componentCache: { names: string[]; designSystem: string; timestamp: number } | null = null;
const CACHE_TTL = 300_000; // 5 minutes (discovery is expensive)

// Internal/utility components that don't belong in voice-assembled UIs
const EXCLUDED_PATTERNS = [
  /^RemoveScroll$/,
  /^ColorSchemeScript$/,
  /^InlineStyles$/,
  /^VisuallyHidden$/,
  /^FocusTrap/,
  /^Portal$/,
  /^OptionalPortal$/,
  /^NativeScrollArea$/,
  /^FloatingArrow$/,
  /^FloatingIndicator$/,
  /^ModalBase/,
  /^ComboboxChevron$/,
  /^ComboboxEventsTarget$/,
  /^ComboboxDropdownTarget$/,
  /^ComboboxHiddenInput$/,
  /^OptionsDropdown$/,
  /^CloseIcon$/,
  /^CheckIcon$/,
  /^RadioIcon$/,
  /^Transition$/,
  /^Typography$/,
];

function filterComponentNames(names: string[]): string[] {
  return names.filter(name => {
    // Exclude internal/utility components
    if (EXCLUDED_PATTERNS.some(p => p.test(name))) return false;
    return true;
  });
}

async function getAvailableComponents(): Promise<{ names: string[]; designSystem: string }> {
  if (componentCache && Date.now() - componentCache.timestamp < CACHE_TTL) {
    return { names: componentCache.names, designSystem: componentCache.designSystem };
  }

  try {
    const config = loadUserConfig();
    const discovery = new EnhancedComponentDiscovery(config);
    const components = await discovery.discoverAll();
    const allNames = components.map(c => c.name).sort();
    const names = filterComponentNames(allNames);
    const designSystem = config.importPath || 'unknown';

    componentCache = { names, designSystem, timestamp: Date.now() };
    logger.log(`Canvas: ${names.length} components available (filtered from ${allNames.length})`);
    return { names, designSystem };
  } catch (err) {
    logger.warn('Component discovery failed, using empty list', err);
    return { names: [], designSystem: 'unknown' };
  }
}

/** Pre-warm the component cache at server startup */
export async function warmCanvasComponentCache(): Promise<void> {
  try {
    await getAvailableComponents();
  } catch { /* non-fatal */ }
}

// ── Express handler ─────────────────────────────────────────

export async function canvasIntentHandler(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const {
      transcript,
      currentState,
      conversationHistory = [],
      provider = 'claude',
      model,
    } = req.body;

    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const validProviders = ['claude', 'openai', 'gemini'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider: ${provider}. Use: ${validProviders.join(', ')}` });
    }

    // Discover available components and load project context in parallel
    const [{ names: componentNames, designSystem }, config] = await Promise.all([
      getAvailableComponents(),
      Promise.resolve(loadUserConfig()),
    ]);

    // Load design considerations and detect icon package
    const considerations = await loadDesignConsiderations(config);
    const iconPackage = config.iconImports?.importPath || null;

    // Build messages for the LLM
    const systemPrompt = buildSystemPrompt(componentNames, designSystem, considerations, iconPackage);

    const messages: Array<{ role: string; content: string }> = [];

    // Add conversation history
    for (const msg of conversationHistory) {
      messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
    }

    // Add current state context if tree is non-empty
    if (currentState && currentState.root && currentState.root.length > 0) {
      messages.push({
        role: 'user',
        content: `Current canvas state (reference node IDs for modifications):\n${JSON.stringify(currentState)}`,
      });
      messages.push({
        role: 'assistant',
        content: 'I see the current canvas. What changes would you like?',
      });
    }

    // Add the user's voice/text input
    messages.push({ role: 'user', content: transcript });

    // Select fast model defaults per provider
    const intentModel = model || (
      provider === 'claude' ? 'claude-haiku-4-5-20251001' :
      provider === 'openai' ? 'gpt-4o-mini' :
      provider === 'gemini' ? 'gemini-2.0-flash' :
      'claude-haiku-4-5-20251001'
    );

    // Call LLM with tool_use
    const { toolCalls, explanation } = await callWithTools(
      systemPrompt,
      messages,
      provider,
      intentModel
    );

    // Convert tool calls to canvas operations
    const operations = toolCalls
      .map(toolCallToOperation)
      .filter(Boolean);

    const elapsed = Date.now() - startTime;
    logger.log(`Canvas intent: ${operations.length} operations in ${elapsed}ms (${provider}/${intentModel})`);

    return res.json({
      operations,
      explanation: explanation || `Applied ${operations.length} operation(s)`,
      metrics: {
        totalTimeMs: elapsed,
        provider,
        model: intentModel,
        toolCallCount: toolCalls.length,
      },
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Canvas intent error', { error: message, elapsed });
    return res.status(500).json({ error: message });
  }
}
