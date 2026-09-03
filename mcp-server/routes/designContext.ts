/**
 * Design Context routes.
 *
 * The design context is the highest-authority guidance a project can give the
 * generator: files under `story-ui-docs/` are ingested verbatim (code fences
 * intact) and injected immediately above the user's request, framed as rules
 * that override generic guidance.
 *
 * The legacy single-file `story-ui-considerations.md` is deliberately NOT the
 * write target here — it is parsed with a four-heading regex that discards code
 * blocks and several whole fields, so anything authored in it loses fidelity on
 * the way to the model.
 *
 * These routes let the panel read, author, and scaffold that context directly,
 * so a design system team never has to know the file layout.
 */

import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { logger } from '../../story-generator/logger.js';
import { INTERACTION_FIDELITY_DOC, COMPOSITION_DOC, starterDocFor } from '../../story-generator/designContextTemplates.js';

const DOCS_DIRNAME = 'story-ui-docs';
/** Matches DocumentationLoader's ingestion set. */
const ALLOWED_EXT = ['.md', '.mdx', '.json', '.yaml', '.yml', '.xml', '.html', '.txt'];
/** DocumentationLoader truncates a single file past this. */
const PER_FILE_CHAR_BUDGET = 8000;
/** DocumentationLoader's total guidelines budget across all files. */
const TOTAL_CHAR_BUDGET = 24000;

function docsDir(): string {
  return path.join(process.cwd(), DOCS_DIRNAME);
}

/** Reject anything that escapes the docs directory or uses an uningested extension. */
function resolveDocPath(name: string): string | null {
  if (!name || typeof name !== 'string') return null;
  const base = path.basename(name);
  if (base !== name) return null;
  if (base.startsWith('.')) return null;
  if (!ALLOWED_EXT.includes(path.extname(base).toLowerCase())) return null;
  const full = path.join(docsDir(), base);
  if (!full.startsWith(docsDir() + path.sep)) return null;
  return full;
}

interface DocFile {
  name: string;
  chars: number;
  overBudget: boolean;
  updatedAt: string;
  /** A README: read by people, skipped by the loader, not counted. */
  instructional?: boolean;
}

function listDocs(): DocFile[] {
  const dir = docsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => ALLOWED_EXT.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      const chars = stat.size;
      return {
        name: f,
        chars,
        overBudget: chars > PER_FILE_CHAR_BUDGET,
        // The loader skips READMEs (they instruct the author, not the model),
        // so the panel must not count one toward the budget — the scaffold's
        // README alone read as "2.0k / 24k used" of guidance that was never sent.
        instructional: /^readme\.(md|mdx|txt)$/i.test(f),
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * GET /story-ui/design-context
 * Directory state plus the budget accounting, so the panel can warn before the
 * loader silently truncates.
 */
export function getDesignContext(_req: Request, res: Response): void {
  try {
    const files = listDocs();
    const totalChars = files.reduce((sum, f) => sum + (f.instructional ? 0 : f.chars), 0);
    res.json({
      exists: fs.existsSync(docsDir()),
      dir: DOCS_DIRNAME,
      files,
      budget: {
        perFile: PER_FILE_CHAR_BUDGET,
        total: TOTAL_CHAR_BUDGET,
        used: totalChars,
        overBudget: totalChars > TOTAL_CHAR_BUDGET,
      },
    });
  } catch (error) {
    logger.error('Failed to read design context', { error });
    res.status(500).json({ error: 'Failed to read design context' });
  }
}

/** GET /story-ui/design-context/:name — raw contents for the editor. */
export function getDesignContextFile(req: Request, res: Response): void {
  const full = resolveDocPath(req.params.name);
  if (!full) {
    res.status(400).json({ error: 'Invalid document name' });
    return;
  }
  if (!fs.existsSync(full)) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  try {
    const content = fs.readFileSync(full, 'utf-8');
    res.json({ name: path.basename(full), content, chars: content.length, overBudget: content.length > PER_FILE_CHAR_BUDGET });
  } catch (error) {
    logger.error('Failed to read design context file', { error });
    res.status(500).json({ error: 'Failed to read document' });
  }
}

/** PUT /story-ui/design-context/:name — create or replace a context document. */
export function putDesignContextFile(req: Request, res: Response): void {
  const full = resolveDocPath(req.params.name);
  if (!full) {
    res.status(400).json({ error: 'Invalid document name — use a plain filename ending in .md, .mdx, .json, .yaml, .yml, .xml, .html or .txt' });
    return;
  }
  const { content } = req.body || {};
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }
  try {
    fs.mkdirSync(docsDir(), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    logger.log(`📝 Design context saved: ${path.basename(full)} (${content.length} chars)`);
    res.json({
      success: true,
      name: path.basename(full),
      chars: content.length,
      overBudget: content.length > PER_FILE_CHAR_BUDGET,
    });
  } catch (error) {
    logger.error('Failed to write design context file', { error });
    res.status(500).json({ error: 'Failed to save document' });
  }
}

/** DELETE /story-ui/design-context/:name */
export function deleteDesignContextFile(req: Request, res: Response): void {
  const full = resolveDocPath(req.params.name);
  if (!full) {
    res.status(400).json({ error: 'Invalid document name' });
    return;
  }
  if (!fs.existsSync(full)) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  try {
    fs.unlinkSync(full);
    logger.log(`🗑️ Design context removed: ${path.basename(full)}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete design context file', { error });
    res.status(500).json({ error: 'Failed to delete document' });
  }
}

/**
 * POST /story-ui/design-context/scaffold
 * Write the starter interaction-fidelity and composition documents. Existing
 * files are never overwritten — a team's own authored rules outrank our defaults.
 */
export function scaffoldDesignContext(req: Request, res: Response): void {
  try {
    // Prefer the caller's hint, but fall back to the server's own loaded config —
    // it already knows the design system, so the panel shouldn't have to.
    const importPath: string | undefined =
      req.body?.importPath || (res.app?.get?.('storyUiImportPath') as string | undefined);
    const dir = docsDir();
    fs.mkdirSync(dir, { recursive: true });

    const planned: Array<{ name: string; content: string }> = [
      { name: 'interaction-fidelity.md', content: INTERACTION_FIDELITY_DOC },
      { name: 'composition-patterns.md', content: COMPOSITION_DOC },
    ];
    const starter = starterDocFor(importPath);
    if (starter) planned.push(starter);

    const created: string[] = [];
    const skipped: string[] = [];
    for (const doc of planned) {
      const full = path.join(dir, doc.name);
      if (fs.existsSync(full)) {
        skipped.push(doc.name);
        continue;
      }
      fs.writeFileSync(full, doc.content, 'utf-8');
      created.push(doc.name);
    }

    logger.log(`📐 Design context scaffolded: ${created.length} created, ${skipped.length} kept`);
    res.json({ success: true, created, skipped, files: listDocs() });
  } catch (error) {
    logger.error('Failed to scaffold design context', { error });
    res.status(500).json({ error: 'Failed to scaffold design context' });
  }
}
