/**
 * Voice Canvas Render Endpoint
 *
 * Lightweight SSE endpoint for ephemeral voice-to-UI generation.
 * Returns self-contained HTML instead of full .stories.tsx files.
 * Designed for sub-2-second streaming response times.
 *
 * Key differences from generateStoryStream:
 * - No file I/O (ephemeral, in-memory only)
 * - No self-healing/validation loop
 * - No story boilerplate (imports, meta, decorators)
 * - Compact system prompt (~500 tokens vs ~3000)
 * - Defaults to fast models (Haiku, 4o-mini, Flash)
 * - Streams HTML chunks directly for live canvas rendering
 * - Section-tagged HTML for targeted edits (edit one section without regenerating all)
 */

import { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { logger } from '../../story-generator/logger.js';
import {
  getProviderRegistry,
  initializeFromEnv,
  ChatMessage,
  ProviderType,
} from '../../story-generator/llm-providers/index.js';

// Fast model defaults per provider
const FAST_MODELS: Record<string, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
};

interface VoiceRenderRequest {
  prompt: string;
  currentHtml?: string;
  designSystem?: string;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  provider?: string;
  model?: string;
  useFastModel?: boolean;
}

// --- Section utilities ---

/** Check if HTML contains data-section attributes */
function hasSections(html: string): boolean {
  return /data-section="[^"]+"/i.test(html);
}

/** Extract list of section IDs from HTML */
function extractSections(html: string): string[] {
  const $ = cheerio.load(html, { xml: false });
  const sections: string[] = [];
  $('[data-section]').each((_, el) => {
    const id = $(el).attr('data-section');
    if (id) sections.push(id);
  });
  return sections;
}

/** Replace a single section in the full HTML by its data-section ID */
function spliceSection(fullHtml: string, sectionId: string, newSectionHtml: string): string {
  const $ = cheerio.load(fullHtml, { xml: false });
  const target = $(`[data-section="${sectionId}"]`);
  if (target.length === 0) {
    // Section not found — append the new section at the end
    $('body').append(newSectionHtml);
  } else {
    target.replaceWith(newSectionHtml);
  }
  return $('body').html() || fullHtml;
}

/** Extract the data-section ID from a returned HTML fragment */
function extractReturnedSectionId(html: string): string | null {
  const match = html.match(/data-section="([^"]+)"/i);
  return match ? match[1] : null;
}

// --- Prompt builders ---

function buildVoiceSystemPrompt(designSystem: string, editMode: boolean = false): string {
  const baseRules = `You are a rapid UI prototyping engine. You generate self-contained HTML that visually represents UI components.

DESIGN SYSTEM: ${designSystem}

RULES:
- Return ONLY the HTML content for the <body>. No doctype, html, head, or body tags.
- Use inline styles that match the ${designSystem} design system aesthetic (colors, spacing, typography, border-radius, shadows).
- Make it look polished and production-ready — proper padding, margins, font sizes.
- Use modern CSS: flexbox, grid, gap, border-radius, box-shadow, transitions.
- Use placeholder images from https://placehold.co/ when images are needed.
- Use a dark theme if the design system supports it, otherwise light theme.
- Keep HTML compact. No comments, no unnecessary wrappers.
- Respond to spatial commands: "move X above Y", "add X next to Y", "remove X", "make X bigger".
- Never include <script> tags or JavaScript.
- Never wrap your response in markdown code fences.`;

  if (editMode) {
    return `${baseRules}

EDIT MODE — CRITICAL RULES:
- You are editing an EXISTING layout. The current HTML has sections tagged with data-section attributes.
- Return ONLY the single <div data-section="..."> that needs to change. Nothing else.
- Keep the same data-section attribute value on the returned div.
- Do NOT return sections that are unchanged.
- If the user asks to remove a section, return an empty string.
- If the user asks to add a new section, return a new <div data-section="new-descriptive-name"> with the content.
- Preserve exact styling of unchanged elements within the section you return.`;
  }

  return `${baseRules}

SECTION TAGGING:
- Wrap each logical section of the UI in a container div with a data-section attribute.
- Use semantic names: header, hero, content, media, actions, footer, form, pricing, features, stats, testimonials, navigation, sidebar, etc.
- Example: <div data-section="header" style="...">...</div>
- Each top-level section MUST have a unique data-section value.
- This enables targeted edits — users can modify one section without regenerating the entire layout.`;
}

function getProvider(providerType?: string) {
  let initialized = false;
  if (!initialized) {
    initializeFromEnv();
    initialized = true;
  }

  const registry = getProviderRegistry();

  if (providerType) {
    const provider = registry.get(providerType as ProviderType);
    if (provider?.isConfigured()) return provider;
  }

  const configured = registry.getConfiguredProviders();
  if (configured.length > 0) return configured[0];

  throw new Error('No LLM provider configured');
}

export async function voiceRenderStream(req: Request, res: Response): Promise<void> {
  const {
    prompt,
    currentHtml,
    designSystem,
    conversation,
    provider: providerType,
    model: requestedModel,
    useFastModel = true,
  } = req.body as VoiceRenderRequest;

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Detect design system from config if not provided
    let ds = designSystem || 'Mantine';
    if (!designSystem) {
      try {
        const config = loadUserConfig();
        if (config?.importPath) {
          if (config.importPath.includes('mantine')) ds = 'Mantine';
          else if (config.importPath.includes('vuetify')) ds = 'Vuetify';
          else if (config.importPath.includes('chakra')) ds = 'Chakra UI';
          else if (config.importPath.includes('mui') || config.importPath.includes('material')) ds = 'Material UI';
          else if (config.importPath.includes('flowbite')) ds = 'Flowbite';
          else if (config.importPath.includes('shoelace')) ds = 'Shoelace';
        }
      } catch {
        // Use default
      }
    }

    // Determine if this is a section-aware edit
    const isEditMode = !!currentHtml && hasSections(currentHtml);
    const sectionList = isEditMode ? extractSections(currentHtml!) : [];

    sendEvent('status', {
      phase: 'starting',
      message: isEditMode ? 'Editing section...' : 'Generating UI...',
    });

    const provider = getProvider(providerType);

    // Select model: explicit > fast default > provider default
    let model: string;
    if (requestedModel) {
      model = requestedModel;
    } else if (useFastModel && FAST_MODELS[provider.type]) {
      model = FAST_MODELS[provider.type];
    } else {
      model = provider.getConfig().model;
    }

    // Build system prompt with edit mode awareness
    const systemPrompt = buildVoiceSystemPrompt(ds, isEditMode);
    const messages: ChatMessage[] = [];

    // Add conversation history for incremental updates
    if (conversation && conversation.length > 0) {
      for (const msg of conversation) {
        messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
    }

    // Build the user message
    let userMessage: string;
    if (isEditMode) {
      // Section-aware edit: show full HTML as context, list available sections
      userMessage = `Current UI HTML (with sections: ${sectionList.join(', ')}):\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nModification request: ${prompt}\n\nReturn ONLY the single <div data-section="..."> that needs to change. Do NOT return unchanged sections.`;
    } else if (currentHtml) {
      // Non-sectioned edit (legacy fallback): return complete HTML
      userMessage = `Current UI HTML:\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nModification request: ${prompt}\n\nReturn the complete updated HTML with data-section attributes on each top-level section.`;
    } else {
      userMessage = prompt;
    }
    messages.push({ role: 'user', content: userMessage });

    sendEvent('status', {
      phase: 'streaming',
      message: isEditMode ? 'AI is editing section...' : 'AI is rendering...',
    });

    // Stream the response
    let fullResponse = '';
    const startTime = Date.now();

    if (!provider.chatStream) {
      // Fallback for providers without streaming
      const response = await provider.chat(messages, {
        model,
        maxTokens: isEditMode ? 2048 : 4096,
        temperature: 0.3,
        systemPrompt,
      });
      fullResponse = response.content;
      sendEvent('html_chunk', { content: fullResponse });
    } else {
      const stream = provider.chatStream(messages, {
        model,
        maxTokens: isEditMode ? 2048 : 4096,
        temperature: 0.3,
        systemPrompt,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'text' && chunk.content) {
          fullResponse += chunk.content;
          sendEvent('html_chunk', { content: chunk.content });
        } else if (chunk.type === 'error') {
          sendEvent('error', { message: chunk.error });
          break;
        } else if (chunk.type === 'done') {
          // Stream complete
        }
      }
    }

    const elapsed = Date.now() - startTime;

    // Clean up the response — strip any markdown fences the LLM might add
    let cleanHtml = fullResponse.trim();
    if (cleanHtml.startsWith('```html')) {
      cleanHtml = cleanHtml.slice(7);
    } else if (cleanHtml.startsWith('```')) {
      cleanHtml = cleanHtml.slice(3);
    }
    if (cleanHtml.endsWith('```')) {
      cleanHtml = cleanHtml.slice(0, -3);
    }
    cleanHtml = cleanHtml.trim();

    // If edit mode: splice the returned section back into the full HTML
    let finalHtml = cleanHtml;
    let editedSection: string | null = null;

    if (isEditMode && currentHtml) {
      if (cleanHtml === '' || cleanHtml.toLowerCase() === 'removed') {
        // Section removal — try to detect which section from the prompt
        // The LLM should return empty string for removals
        finalHtml = currentHtml;
        editedSection = 'removed';
      } else {
        const returnedSectionId = extractReturnedSectionId(cleanHtml);
        if (returnedSectionId) {
          finalHtml = spliceSection(currentHtml, returnedSectionId, cleanHtml);
          editedSection = returnedSectionId;
          logger.log(`Section edit: spliced section "${returnedSectionId}" (${cleanHtml.length} chars)`);
        } else {
          // LLM didn't return a sectioned div — treat as full replacement (fallback)
          finalHtml = cleanHtml;
          logger.log('Section edit fallback: LLM returned unsectioned HTML, using as full replacement');
        }
      }
    }

    sendEvent('complete', {
      html: finalHtml,
      editedSection,
      metrics: {
        timeMs: elapsed,
        model,
        provider: provider.type,
        editMode: isEditMode,
        sectionsInLayout: sectionList.length,
      },
    });

    logger.log(`Voice render complete: ${elapsed}ms using ${provider.type}/${model}${isEditMode ? ` (section edit)` : ''}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Voice render error:', message);
    sendEvent('error', { message });
  } finally {
    res.end();
  }
}
