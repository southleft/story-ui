/**
 * Canvas Save Endpoint
 *
 * Converts a canvas component tree (JSON) into a proper .stories.tsx file
 * using deterministic codegen (no LLM). Phase 1 approach.
 *
 * POST /mcp/canvas-save
 * Body: { tree, title, importPath, framework }
 * Returns: { fileName, filePath, code }
 */

import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { logger } from '../../story-generator/logger.js';
import { getManifestManager } from '../../story-generator/manifestManager.js';

interface ComponentNodeInput {
  id?: string;
  component: string;
  props?: Record<string, unknown>;
  children?: ComponentNodeInput[];
  textContent?: string;
}

interface CanvasTree {
  root: ComponentNodeInput[];
}

// ── Deterministic JSX codegen ───────────────────────────────

function indent(depth: number): string {
  return '  '.repeat(depth);
}

function serializePropValue(value: unknown): string {
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (typeof value === 'boolean') return `{${value}}`;
  if (typeof value === 'number') return `{${value}}`;
  if (value === null || value === undefined) return '{undefined}';
  if (Array.isArray(value)) return `{${JSON.stringify(value)}}`;
  if (typeof value === 'object') return `{${JSON.stringify(value)}}`;
  return `{${String(value)}}`;
}

function nodeToJsx(node: ComponentNodeInput, depth: number): string {
  const pad = indent(depth);
  const tag = node.component;
  const props = node.props || {};
  const propEntries = Object.entries(props).filter(([, v]) => v !== undefined && v !== null);

  // Build prop string
  let propStr = '';
  if (propEntries.length > 0) {
    if (propEntries.length <= 3) {
      propStr = ' ' + propEntries.map(([k, v]) => {
        if (typeof v === 'boolean' && v === true) return k;
        return `${k}=${serializePropValue(v)}`;
      }).join(' ');
    } else {
      // Multi-line props
      propStr = '\n' + propEntries.map(([k, v]) => {
        if (typeof v === 'boolean' && v === true) return `${pad}  ${k}`;
        return `${pad}  ${k}=${serializePropValue(v)}`;
      }).join('\n') + '\n' + pad;
    }
  }

  // Self-closing if no children and no text
  const hasChildren = (node.children && node.children.length > 0);
  const hasText = node.textContent !== undefined && node.textContent !== '';

  if (!hasChildren && !hasText) {
    return `${pad}<${tag}${propStr} />`;
  }

  // Text-only leaf
  if (!hasChildren && hasText) {
    const text = node.textContent!;
    if (text.length < 60 && propEntries.length <= 3) {
      return `${pad}<${tag}${propStr}>${text}</${tag}>`;
    }
    return `${pad}<${tag}${propStr}>\n${pad}  ${text}\n${pad}</${tag}>`;
  }

  // Children
  const childrenJsx = (node.children || []).map(c => nodeToJsx(c, depth + 1)).join('\n');
  if (hasText) {
    return `${pad}<${tag}${propStr}>\n${pad}  ${node.textContent}\n${childrenJsx}\n${pad}</${tag}>`;
  }
  return `${pad}<${tag}${propStr}>\n${childrenJsx}\n${pad}</${tag}>`;
}

function collectComponents(nodes: ComponentNodeInput[]): Set<string> {
  const components = new Set<string>();
  for (const node of nodes) {
    // For dot-notation like "Card.Section", only add the parent "Card"
    const baseName = node.component.split('.')[0];
    components.add(baseName);
    if (node.children) {
      for (const name of collectComponents(node.children)) {
        components.add(name);
      }
    }
  }
  return components;
}

function treeToStoryCode(
  tree: CanvasTree,
  title: string,
  importPath: string,
  framework: string,
): string {
  const components = collectComponents(tree.root);
  const sortedComponents = Array.from(components).sort();
  const importLine = `import { ${sortedComponents.join(', ')} } from '${importPath}';`;

  const jsx = tree.root.map(n => nodeToJsx(n, 2)).join('\n');

  if (framework === 'vue' || framework === 'angular' || framework === 'svelte') {
    // For non-React frameworks, generate a simpler template
    // Phase 1: React-only. Other frameworks get JSX that their adapters handle.
    logger.warn(`Canvas save for ${framework} — generating React JSX format (Phase 1)`);
  }

  return `${importLine}
import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'Generated/${title}',
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <>
${jsx}
    </>
  ),
};
`;
}

// ── JSX save (react-live canvas) ─────────────────────────────

/**
 * Convert a react-live canvas component (JSX string) to a proper .stories.tsx file.
 * The input is in the format: `const Canvas = () => { ... }; render(<Canvas />);`
 */
export function jsxCodeToStory(jsxCode: string, title: string, importPath: string): string {
  // Remove the render(<Canvas />) call at the end
  const cleanCode = jsxCode.replace(/\nrender\s*\(<Canvas\s*\/>\);?\s*$/, '').trim();

  // Extract component names used in JSX (uppercase identifiers after '<')
  const tagMatches = cleanCode.match(/(?<=<)([A-Z][a-zA-Z.]*)/g) ?? [];
  const componentSet = new Set<string>();
  for (const tag of tagMatches) {
    const base = tag.split('.')[0];
    if (base !== 'Canvas') componentSet.add(base);
  }
  const sortedComponents = Array.from(componentSet).sort();

  // Detect React hooks used
  const hookNames = ['useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'useReducer', 'useContext'];
  const usedHooks = hookNames.filter(h => new RegExp(`\\b${h}\\b`).test(cleanCode));

  const lines: string[] = [];
  if (sortedComponents.length > 0) {
    lines.push(`import { ${sortedComponents.join(', ')} } from '${importPath}';`);
  }
  if (usedHooks.length > 0) {
    lines.push(`import { ${usedHooks.join(', ')} } from 'react';`);
  }
  lines.push(`import type { Meta, StoryObj } from '@storybook/react';`);
  lines.push('');
  lines.push(`const meta: Meta = {`);
  lines.push(`  title: 'Generated/${title}',`);
  lines.push(`};`);
  lines.push(`export default meta;`);
  lines.push('');
  // Indent canvas component code inside the render function
  const indented = cleanCode.split('\n').map(l => `    ${l}`).join('\n');
  lines.push(`export const Default: StoryObj = {`);
  lines.push(`  render: () => {`);
  lines.push(indented);
  lines.push(`    return <Canvas />;`);
  lines.push(`  },`);
  lines.push(`};`);
  return lines.join('\n') + '\n';
}

// ── Express handler ─────────────────────────────────────────

/** Derive a readable title from the last voice/text prompt. */
export function titleFromPrompt(prompt: string): string {
  // Strip filler words, take first ~6 meaningful words, title-case
  const stop = new Set(['a', 'an', 'the', 'with', 'and', 'for', 'of', 'to', 'in', 'on', 'at', 'by']);
  const words = prompt
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !stop.has(w.toLowerCase()))
    .slice(0, 6)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  if (words.length > 0) return words.join(' ');
  // Avoid 'Voice Canvas' — that title belongs to the live scratchpad
  const now = new Date();
  return `Canvas ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export async function canvasSaveHandler(req: Request, res: Response) {
  try {
    const { tree, jsxCode, title: rawTitle, lastPrompt: rawLastPrompt } = req.body;

    // ── Request body size limits ───────────────────────────────
    const MAX_JSX_CODE = 100_000;
    const MAX_TITLE = 200;
    const MAX_LAST_PROMPT = 5_000;

    if (jsxCode && typeof jsxCode === 'string' && jsxCode.length > MAX_JSX_CODE) {
      return res.status(400).json({ error: `jsxCode exceeds maximum length of ${MAX_JSX_CODE} characters` });
    }

    // Truncate title and lastPrompt if needed (safe to trim these)
    const safeTitle = (rawTitle && typeof rawTitle === 'string')
      ? rawTitle.slice(0, MAX_TITLE)
      : rawTitle;
    const lastPrompt = (rawLastPrompt && typeof rawLastPrompt === 'string' && rawLastPrompt.length > MAX_LAST_PROMPT)
      ? rawLastPrompt.slice(0, MAX_LAST_PROMPT)
      : rawLastPrompt;

    // Auto-generate title from last prompt if not provided
    const title = (safeTitle && typeof safeTitle === 'string' && safeTitle.trim())
      ? safeTitle.trim()
      : (lastPrompt && typeof lastPrompt === 'string' && lastPrompt.trim())
        ? titleFromPrompt(lastPrompt.trim())
        : `Canvas ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;

    const config = loadUserConfig();
    const importPath = config.importPath || '';
    const storiesDir = config.generatedStoriesPath || './src/stories/generated/';

    let code: string;

    if (jsxCode && typeof jsxCode === 'string' && jsxCode.trim()) {
      // New path: save from react-live canvas JSX
      code = jsxCodeToStory(jsxCode, title, importPath);
    } else if (tree?.root && Array.isArray(tree.root)) {
      // Legacy path: save from JSON component tree
      const framework = config.componentFramework || 'react';
      code = treeToStoryCode(tree, title, importPath, framework);
    } else {
      return res.status(400).json({ error: 'jsxCode or tree.root is required' });
    }

    // Build a safe filename — slug only (no hash) so re-saving the same title
    // overwrites the same file and avoids Storybook duplicate story ID errors.
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fileName = `${slug}.stories.tsx`;

    // Resolve output directory safely
    const resolvedDir = path.resolve(process.cwd(), storiesDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    const filePath = path.resolve(resolvedDir, fileName);
    // Path traversal check
    if (!filePath.startsWith(resolvedDir)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Remove any stale hashed versions of the same slug (e.g. slug-a1b2c3d4.stories.tsx)
    // that may have been created by a previous version of canvas save.
    try {
      const stalePattern = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9a-f]{8}\\.stories\\.tsx$`);
      for (const f of fs.readdirSync(resolvedDir)) {
        if (stalePattern.test(f)) {
          const stalePath = path.resolve(resolvedDir, f);
          if (stalePath.startsWith(resolvedDir)) {
            fs.unlinkSync(stalePath);
            getManifestManager().delete(f);
            logger.log(`Canvas save: removed stale file ${f}`);
          }
        }
      }
    } catch (cleanupErr) {
      logger.warn('[canvasSave] stale file cleanup error (non-fatal):', cleanupErr);
    }

    fs.writeFileSync(filePath, code, 'utf-8');

    // Register with manifest
    try {
      const voicePrompt = lastPrompt ?? title;
      getManifestManager().upsert(fileName, {
        id: slug,
        title,
        source: 'voice-save',
        // Seed a conversation so users can continue iterating via the chat UI
        conversation: [
          { role: 'user', content: voicePrompt },
          { role: 'ai', content: `Story generated: "${title}"` },
        ],
        metadata: { prompt: voicePrompt },
      });
    } catch (manifestErr) {
      logger.warn('[manifest] canvasSave upsert error (non-fatal):', manifestErr);
    }

    logger.log(`Canvas saved: ${fileName}`);

    return res.json({
      fileName,
      filePath: path.relative(process.cwd(), filePath),
      code,
      title,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Canvas save error', { error: message });
    return res.status(500).json({ error: message });
  }
}
