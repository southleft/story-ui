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
  tokenMappings: TokenMapping[];
}

interface TokenMapping {
  cssValue: string;
  tokenType: 'color' | 'spacing' | 'fontSize' | 'fontWeight' | 'radius' | 'shadow';
  suggestedToken: string;
  confidence: 'high' | 'medium' | 'low';
}

// --- Design system token mappings ---

/** Common design system spacing scales (px → token name) */
const SPACING_MAP: Record<number, string> = {
  2: 'xxs', 4: 'xs', 8: 'sm', 12: 'md', 16: 'md', 20: 'lg', 24: 'lg',
  32: 'xl', 40: 'xl', 48: '2xl', 64: '3xl', 80: '4xl', 96: '5xl',
};

/** Common font sizes (px → token name) */
const FONT_SIZE_MAP: Record<number, string> = {
  10: 'xs', 11: 'xs', 12: 'sm', 13: 'sm', 14: 'md', 15: 'md', 16: 'md',
  18: 'lg', 20: 'xl', 24: '2xl', 28: '2xl', 30: '3xl', 32: '3xl',
  36: '4xl', 40: '4xl', 48: '5xl',
};

/** Common border radii (px → token name) */
const RADIUS_MAP: Record<number, string> = {
  0: 'none', 2: 'xs', 4: 'sm', 6: 'md', 8: 'md', 10: 'lg', 12: 'lg',
  16: 'xl', 20: 'xl', 24: '2xl', 9999: 'full',
};

/** Font weight names */
const WEIGHT_MAP: Record<number, string> = {
  100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal',
  500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black',
};

/** Parse a hex color to RGB values */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  } else {
    return null;
  }
  return { r, g, b };
}

/** Map a hex color to the nearest design system semantic color */
function mapColorToToken(hex: string): { token: string; confidence: 'high' | 'medium' | 'low' } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { token: hex, confidence: 'low' };

  const { r, g, b } = rgb;

  // Detect common color categories
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const saturation = Math.max(r, g, b) - Math.min(r, g, b);

  // Near-white
  if (brightness > 240 && saturation < 20) return { token: 'white', confidence: 'high' };
  // Near-black
  if (brightness < 30 && saturation < 20) return { token: 'dark.9', confidence: 'high' };

  // Grays (low saturation)
  if (saturation < 30) {
    if (brightness > 200) return { token: 'gray.1', confidence: 'high' };
    if (brightness > 160) return { token: 'gray.3', confidence: 'high' };
    if (brightness > 120) return { token: 'gray.5', confidence: 'high' };
    if (brightness > 80) return { token: 'gray.7', confidence: 'high' };
    return { token: 'gray.9', confidence: 'high' };
  }

  // Blues (common for primary)
  if (b > r && b > g && b > 120) {
    if (b > 200 && r < 100) return { token: 'blue.5 (primary)', confidence: 'medium' };
    if (b > 150) return { token: 'blue.7', confidence: 'medium' };
    return { token: 'blue.9', confidence: 'medium' };
  }

  // Greens (common for success)
  if (g > r && g > b && g > 120) {
    return { token: 'green.6 (success)', confidence: 'medium' };
  }

  // Reds (common for error/danger)
  if (r > g && r > b && r > 150) {
    return { token: 'red.6 (error)', confidence: 'medium' };
  }

  // Yellows/oranges (common for warning)
  if (r > 180 && g > 120 && b < 100) {
    return { token: 'yellow.6 (warning)', confidence: 'medium' };
  }

  // Purple
  if (r > 100 && b > 100 && g < 100) {
    return { token: 'violet.6', confidence: 'medium' };
  }

  return { token: hex, confidence: 'low' };
}

/** Parse CSS value to pixel number */
function parsePx(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*px/);
  return match ? parseFloat(match[1]) : null;
}

/** Map inline CSS values to design system tokens */
function mapStylesToTokens(html: string): TokenMapping[] {
  const $ = cheerio.load(html, { xml: false });
  const mappings: TokenMapping[] = [];
  const seen = new Set<string>();

  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';

    // Colors
    const colorMatches = style.match(/#[0-9a-f]{3,8}/gi) || [];
    for (const color of colorMatches) {
      if (seen.has(`color:${color}`)) continue;
      seen.add(`color:${color}`);
      const mapped = mapColorToToken(color);
      mappings.push({
        cssValue: color,
        tokenType: 'color',
        suggestedToken: mapped.token,
        confidence: mapped.confidence,
      });
    }

    // Spacing (padding, margin, gap)
    const spacingProps = style.match(/(?:padding|margin|gap)(?:-(?:top|right|bottom|left))?:\s*([^;]+)/gi) || [];
    for (const prop of spacingProps) {
      const px = parsePx(prop);
      if (px !== null && !seen.has(`spacing:${px}`)) {
        seen.add(`spacing:${px}`);
        const nearest = Object.keys(SPACING_MAP).map(Number).sort((a, b) => Math.abs(a - px) - Math.abs(b - px))[0];
        if (nearest !== undefined) {
          mappings.push({
            cssValue: `${px}px`,
            tokenType: 'spacing',
            suggestedToken: SPACING_MAP[nearest],
            confidence: px === nearest ? 'high' : 'medium',
          });
        }
      }
    }

    // Font sizes
    const fontSizeMatch = style.match(/font-size:\s*([^;]+)/i);
    if (fontSizeMatch) {
      const px = parsePx(fontSizeMatch[1]);
      if (px !== null && !seen.has(`fontSize:${px}`)) {
        seen.add(`fontSize:${px}`);
        const nearest = Object.keys(FONT_SIZE_MAP).map(Number).sort((a, b) => Math.abs(a - px) - Math.abs(b - px))[0];
        if (nearest !== undefined) {
          mappings.push({
            cssValue: `${px}px`,
            tokenType: 'fontSize',
            suggestedToken: FONT_SIZE_MAP[nearest],
            confidence: px === nearest ? 'high' : 'medium',
          });
        }
      }
    }

    // Font weight
    const weightMatch = style.match(/font-weight:\s*(\d+)/i);
    if (weightMatch) {
      const w = parseInt(weightMatch[1]);
      if (!seen.has(`weight:${w}`)) {
        seen.add(`weight:${w}`);
        if (WEIGHT_MAP[w]) {
          mappings.push({
            cssValue: String(w),
            tokenType: 'fontWeight',
            suggestedToken: WEIGHT_MAP[w],
            confidence: 'high',
          });
        }
      }
    }

    // Border radius
    const radiusMatch = style.match(/border-radius:\s*([^;]+)/i);
    if (radiusMatch) {
      const px = parsePx(radiusMatch[1]);
      if (px !== null && !seen.has(`radius:${px}`)) {
        seen.add(`radius:${px}`);
        const nearest = Object.keys(RADIUS_MAP).map(Number).sort((a, b) => Math.abs(a - px) - Math.abs(b - px))[0];
        if (nearest !== undefined) {
          mappings.push({
            cssValue: `${px}px`,
            tokenType: 'radius',
            suggestedToken: RADIUS_MAP[nearest],
            confidence: px === nearest ? 'high' : 'medium',
          });
        }
      }
    }
  });

  return mappings;
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

  // Map inline styles to design system tokens
  const tokenMappings = mapStylesToTokens(html);

  return {
    sections,
    elements: Array.from(elements),
    layout,
    colors: Array.from(colors).slice(0, 10),
    spacing: Array.from(spacing).slice(0, 10),
    typography: Array.from(typography).slice(0, 5),
    tokenMappings,
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

TOKEN MAPPING TABLE (use these exact mappings):
${analysis.tokenMappings.length > 0 ? analysis.tokenMappings.map(m => `  ${m.cssValue} → ${m.suggestedToken} (${m.tokenType}, ${m.confidence} confidence)`).join('\n') : '  (no mappings — use design system defaults)'}

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
4. USE TOKEN MAPPINGS — apply the token mapping table above. For "high confidence" mappings, use the token directly. For "medium" or "low", use your best judgment to match the design system's palette.
5. MAP SPACING TO SCALE — use the spacing tokens from the mapping table instead of pixel values.
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
