/**
 * Convert Voice Canvas HTML to Storybook Story
 *
 * Takes ephemeral HTML from VoiceCanvas and converts it into a proper
 * .stories.tsx file using the project's design system components.
 *
 * Unlike dumping HTML into the prompt field, this endpoint:
 * - Parses the HTML structure and extracts semantic intent
 * - Maps inline styles to design system tokens/props
 * - Generates component-based code using actual imports
 * - Preserves visual fidelity through structural constraints
 */

import { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { generateStory as saveStory } from '../../story-generator/generateStory.js';
import { logger } from '../../story-generator/logger.js';
import {
  getProviderRegistry,
  initializeFromEnv,
  ChatMessage,
  ProviderType,
} from '../../story-generator/llm-providers/index.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import {
  detectProjectFramework,
} from '../../story-generator/promptGenerator.js';

interface ConvertRequest {
  html: string;
  designSystem?: string;
  provider?: string;
  model?: string;
  title?: string;
}

interface HtmlAnalysis {
  sections: string[];
  elements: string[];
  layout: string;
  colors: string[];
  spacing: string[];
  typography: string[];
}

/** Analyze the HTML structure to build conversion constraints */
function analyzeHtml(html: string): HtmlAnalysis {
  const $ = cheerio.load(html, { xml: false });

  // Extract sections
  const sections: string[] = [];
  $('[data-section]').each((_, el) => {
    sections.push($(el).attr('data-section') || 'unknown');
  });

  // Extract unique element types
  const elements = new Set<string>();
  $('*').each((_, el) => {
    const tag = (el as any).tagName;
    if (tag && !['html', 'head', 'body', 'div', 'span'].includes(tag)) {
      elements.add(tag);
    }
  });

  // Extract inline style patterns
  const colors = new Set<string>();
  const spacing = new Set<string>();
  const typography = new Set<string>();

  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    // Colors
    const colorMatches = style.match(/#[0-9a-f]{3,8}|rgb[a]?\([^)]+\)/gi);
    if (colorMatches) colorMatches.forEach(c => colors.add(c));
    // Spacing
    const spacingMatches = style.match(/(?:padding|margin|gap):\s*[^;]+/gi);
    if (spacingMatches) spacingMatches.forEach(s => spacing.add(s.trim()));
    // Typography
    const fontMatches = style.match(/font-(?:size|weight|family):\s*[^;]+/gi);
    if (fontMatches) fontMatches.forEach(f => typography.add(f.trim()));
  });

  // Detect layout type
  let layout = 'vertical';
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    if (style.includes('grid')) layout = 'grid';
    else if (style.includes('flex-direction: row') || style.includes('flex-direction:row')) layout = 'horizontal';
  });

  return {
    sections,
    elements: Array.from(elements),
    layout,
    colors: Array.from(colors).slice(0, 10),
    spacing: Array.from(spacing).slice(0, 10),
    typography: Array.from(typography).slice(0, 5),
  };
}

/** Build a constraint document that guides the story generation LLM */
function buildConstraintDocument(html: string, analysis: HtmlAnalysis, designSystem: string): string {
  const $ = cheerio.load(html, { xml: false });

  // Extract text content for each section to preserve copy
  const sectionContents: string[] = [];
  if (analysis.sections.length > 0) {
    $('[data-section]').each((_, el) => {
      const name = $(el).attr('data-section');
      const texts: string[] = [];
      $(el).find('h1, h2, h3, h4, h5, h6, p, span, a, button, label, li').each((_, textEl) => {
        const text = $(textEl).text().trim();
        if (text) texts.push(text);
      });
      if (name && texts.length > 0) {
        sectionContents.push(`  - ${name}: ${texts.join(' | ')}`);
      }
    });
  }

  return `VOICE CANVAS CONVERSION — STRICT FIDELITY RULES

SOURCE HTML (the user created this via voice, it MUST be preserved exactly):
\`\`\`html
${html}
\`\`\`

STRUCTURAL ANALYSIS:
- Layout: ${analysis.layout}
- Sections: ${analysis.sections.length > 0 ? analysis.sections.join(', ') : 'unsectioned'}
- Element types: ${analysis.elements.join(', ')}
- Color palette: ${analysis.colors.join(', ') || 'default theme'}

TEXT CONTENT (must appear exactly as shown):
${sectionContents.length > 0 ? sectionContents.join('\n') : '  (extract all text from the HTML above)'}

CONVERSION RULES:
1. PRESERVE EXACT TEXT — every heading, paragraph, label, and button text must match the source HTML character-for-character.
2. PRESERVE LAYOUT STRUCTURE — if the source has 3 columns, the story must have 3 columns. If it has a header above content, keep that order.
3. USE ${designSystem.toUpperCase()} COMPONENTS — map HTML elements to the closest design system component:
   - <button> → Button component
   - <input> → TextInput/Input component
   - <img> → Image component
   - <h1-h6> → Title/Heading component with appropriate level
   - <p> → Text component
   - Cards, containers → Card/Paper component
   - Grid layouts → Grid/SimpleGrid component
4. MAP COLORS TO THEME — instead of hardcoded hex values, use the design system's theme colors (primary, secondary, etc.)
5. MAP SPACING TO SCALE — instead of pixel values, use the design system's spacing scale (sm, md, lg, xl)
6. DO NOT ADD ELEMENTS — do not add content, sections, or UI elements that aren't in the source HTML.
7. DO NOT REMOVE ELEMENTS — every visible element in the source must appear in the story.
8. DO NOT CHANGE COPY — the text content is final. Do not rephrase, shorten, or "improve" any text.`;
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

export async function convertToStory(req: Request, res: Response): Promise<void> {
  const {
    html,
    designSystem: requestedDs,
    provider: providerType,
    model: requestedModel,
    title: requestedTitle,
  } = req.body as ConvertRequest;

  if (!html) {
    res.status(400).json({ error: 'html is required' });
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
    // Detect design system
    let ds = requestedDs || 'Mantine';
    let config: any = null;
    try {
      config = loadUserConfig();
      if (!requestedDs && config?.importPath) {
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

    sendEvent('status', { phase: 'analyzing', message: 'Analyzing voice canvas HTML...' });

    // Analyze the HTML structure
    const analysis = analyzeHtml(html);

    // Build constraint document
    const constraintDoc = buildConstraintDocument(html, analysis, ds);

    sendEvent('status', { phase: 'discovering', message: 'Discovering components...' });

    // Discover available components
    let componentList = '';
    try {
      if (config) {
        const discovery = new EnhancedComponentDiscovery(config);
        const components = await discovery.discoverAll();
        if (components.length > 0) {
          componentList = components.map((c: any) => c.name).join(', ');
        }
      }
    } catch {
      componentList = '';
    }

    // Detect framework
    const framework = config?.componentFramework || detectProjectFramework() || 'react';
    const importPath = config?.importPath || '@mantine/core';
    const importStyle = config?.importStyle || 'barrel';
    const storyPrefix = config?.storyPrefix || 'Generated/';

    sendEvent('status', { phase: 'converting', message: 'Converting to Storybook story...' });

    const provider = getProvider(providerType);
    const model = requestedModel || provider.getConfig().model;

    // Generate a title from the HTML content
    const titleFromHtml = requestedTitle || generateTitleFromHtml(html);

    const systemPrompt = `You are a Storybook story generator. Convert the provided HTML into a working Storybook story using ${ds} components.

FRAMEWORK: ${framework}
IMPORT PATH: ${importPath}
IMPORT STYLE: ${importStyle}
AVAILABLE COMPONENTS: ${componentList || 'Use standard ' + ds + ' components'}

OUTPUT FORMAT:
- Return a complete .stories.tsx file
- Use CSF3 format (Component Story Format 3)
- Include proper Meta and Story type imports from @storybook/${framework}
- Import components from ${importPath}
- Story title should be "${storyPrefix}${titleFromHtml}"
- Export a Default story that renders the component
- Use TypeScript
- Do NOT wrap your response in markdown code fences

${constraintDoc}`;

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: `Convert this voice-generated HTML into a proper Storybook story. Follow the constraint document in the system prompt exactly.`,
      },
    ];

    // Stream the response
    let fullResponse = '';
    const startTime = Date.now();

    if (!provider.chatStream) {
      const response = await provider.chat(messages, {
        model,
        maxTokens: 8192,
        temperature: 0.2,
        systemPrompt,
      });
      fullResponse = response.content;
      sendEvent('story_chunk', { content: fullResponse });
    } else {
      const stream = provider.chatStream(messages, {
        model,
        maxTokens: 8192,
        temperature: 0.2,
        systemPrompt,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'text' && chunk.content) {
          fullResponse += chunk.content;
          sendEvent('story_chunk', { content: chunk.content });
        } else if (chunk.type === 'error') {
          sendEvent('error', { message: chunk.error });
          break;
        } else if (chunk.type === 'done') {
          // done
        }
      }
    }

    const elapsed = Date.now() - startTime;

    // Clean up markdown fences
    let cleanStory = fullResponse.trim();
    if (cleanStory.startsWith('```tsx') || cleanStory.startsWith('```typescript')) {
      cleanStory = cleanStory.replace(/^```\w*\n?/, '');
    } else if (cleanStory.startsWith('```')) {
      cleanStory = cleanStory.slice(3);
    }
    if (cleanStory.endsWith('```')) {
      cleanStory = cleanStory.slice(0, -3);
    }
    cleanStory = cleanStory.trim();

    // Save the story to disk
    const storyId = `voice-${crypto.randomBytes(4).toString('hex')}`;
    const safeTitle = titleFromHtml.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
    const fileName = `${safeTitle}-${storyId}.stories.tsx`;
    let savedPath = '';

    try {
      if (config) {
        savedPath = saveStory({ fileContents: cleanStory, fileName, config });
        sendEvent('status', { phase: 'saved', message: `Story saved: ${fileName}` });
        logger.log(`Voice story saved to: ${savedPath}`);
      }
    } catch (saveErr) {
      logger.error('Failed to save voice story:', saveErr instanceof Error ? saveErr.message : String(saveErr));
      // Don't fail the whole request — still return the story code
    }

    sendEvent('complete', {
      story: cleanStory,
      title: titleFromHtml,
      fileName,
      storyId,
      savedPath,
      sourceHtml: html,
      analysis: {
        sections: analysis.sections,
        layout: analysis.layout,
        elementCount: analysis.elements.length,
      },
      metrics: {
        timeMs: elapsed,
        model,
        provider: provider.type,
      },
    });

    logger.log(`Voice-to-story conversion: ${elapsed}ms using ${provider.type}/${model}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Convert-to-story error:', message);
    sendEvent('error', { message });
  } finally {
    res.end();
  }
}

/** Generate a human-readable title from HTML content */
function generateTitleFromHtml(html: string): string {
  const $ = cheerio.load(html, { xml: false });

  // Try to find a heading
  const h1 = $('h1').first().text().trim();
  if (h1) return sanitizeTitle(h1);

  const h2 = $('h2').first().text().trim();
  if (h2) return sanitizeTitle(h2);

  // Try data-section attributes
  const sections = $('[data-section]').map((_, el) => $(el).attr('data-section')).get();
  if (sections.length > 0) {
    return sections.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  }

  return 'Voice Generated';
}

function sanitizeTitle(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(' ');
}
