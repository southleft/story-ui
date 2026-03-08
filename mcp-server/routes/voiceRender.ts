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
 */

import { Request, Response } from 'express';
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

function buildVoiceSystemPrompt(designSystem: string): string {
  return `You are a rapid UI prototyping engine. You generate self-contained HTML that visually represents UI components.

DESIGN SYSTEM: ${designSystem}

RULES:
- Return ONLY the HTML content for the <body>. No doctype, html, head, or body tags.
- Use inline styles that match the ${designSystem} design system aesthetic (colors, spacing, typography, border-radius, shadows).
- Make it look polished and production-ready — proper padding, margins, font sizes.
- Use modern CSS: flexbox, grid, gap, border-radius, box-shadow, transitions.
- Use placeholder images from https://placehold.co/ when images are needed.
- Use a dark theme if the design system supports it, otherwise light theme.
- Keep HTML compact. No comments, no unnecessary wrappers.
- For modifications: return the COMPLETE updated HTML, not a diff.
- Respond to spatial commands: "move X above Y", "add X next to Y", "remove X", "make X bigger".
- Never include <script> tags or JavaScript.
- Never wrap your response in markdown code fences.`;
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

    sendEvent('status', { phase: 'starting', message: 'Generating UI...' });

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

    // Build messages
    const systemPrompt = buildVoiceSystemPrompt(ds);
    const messages: ChatMessage[] = [];

    // Add conversation history for incremental updates
    if (conversation && conversation.length > 0) {
      for (const msg of conversation) {
        messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
    }

    // Build the user message
    let userMessage = prompt;
    if (currentHtml) {
      userMessage = `Current UI HTML:\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nModification request: ${prompt}\n\nReturn the complete updated HTML.`;
    }
    messages.push({ role: 'user', content: userMessage });

    sendEvent('status', { phase: 'streaming', message: 'AI is rendering...' });

    // Stream the response
    let fullHtml = '';
    const startTime = Date.now();

    if (!provider.chatStream) {
      // Fallback for providers without streaming
      const response = await provider.chat(messages, {
        model,
        maxTokens: 4096,
        temperature: 0.3,
        systemPrompt,
      });
      fullHtml = response.content;
      sendEvent('html_chunk', { content: fullHtml });
    } else {
    const stream = provider.chatStream(messages, {
      model,
      maxTokens: 4096,
      temperature: 0.3,
      systemPrompt,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'text' && chunk.content) {
        fullHtml += chunk.content;
        sendEvent('html_chunk', { content: chunk.content });
      } else if (chunk.type === 'error') {
        sendEvent('error', { message: chunk.error });
        break;
      } else if (chunk.type === 'done') {
        // Stream complete
      }
    }
    } // end else (streaming)

    const elapsed = Date.now() - startTime;

    // Clean up the HTML — strip any markdown fences the LLM might add
    let cleanHtml = fullHtml.trim();
    if (cleanHtml.startsWith('```html')) {
      cleanHtml = cleanHtml.slice(7);
    } else if (cleanHtml.startsWith('```')) {
      cleanHtml = cleanHtml.slice(3);
    }
    if (cleanHtml.endsWith('```')) {
      cleanHtml = cleanHtml.slice(0, -3);
    }
    cleanHtml = cleanHtml.trim();

    sendEvent('complete', {
      html: cleanHtml,
      metrics: {
        timeMs: elapsed,
        model,
        provider: provider.type,
      },
    });

    logger.log(`Voice render complete: ${elapsed}ms using ${provider.type}/${model}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Voice render error:', message);
    sendEvent('error', { message });
  } finally {
    res.end();
  }
}
