/**
 * Direct property editing endpoint.
 *
 * Two operations, both deterministic and neither involving a model:
 *
 *   GET  /mcp/editable-props?component=Button
 *        What can be changed on this component, with the values it accepts —
 *        read from the installed package's own type declarations.
 *
 *   POST /mcp/edit-prop
 *        Apply one change to one element and write the file.
 *
 * This is the safe path for the class of change that has exactly one correct
 * answer. Asking a model to "make this button red" costs 20 seconds, real
 * money, and — measured — the whole page.
 */

import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { editProp, occurrencesInSource } from '../../story-generator/editing/propEditor.js';
import { extractProps, type PropFact } from '../../story-generator/knowledge/propExtractor.js';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { readDesignTokens } from '../../story-generator/knowledge/stylingFacts.js';
import { logger } from '../../story-generator/logger.js';

/** A prop the panel can render a control for. */
export interface EditableProp {
  name: string;
  /** `enum` when the type is a union of string literals; else the raw type. */
  kind: 'enum' | 'boolean' | 'number' | 'string' | 'other';
  /** Legal values, when the type declares them. */
  options?: string[];
  doc?: string;
  defaultValue?: string;
  deprecated?: string;
}

/**
 * Turn a declared type into something a control can be built from.
 *
 * Only the shapes a panel can honestly offer. Anything else is reported as
 * `other` and rendered as free text rather than guessed at — offering a
 * dropdown of values a component does not accept would be worse than offering
 * nothing.
 */
export function classifyProp(p: PropFact): EditableProp {
  const type = (p.type || '').trim();

  // `'sm' | 'md' | 'lg'` — the case worth having, and the one a design system
  // uses for every variant, size and appearance prop.
  const literals = type.match(/'[^']+'/g);
  if (literals && literals.length > 1 && /^(\s*'[^']*'\s*\|?)+$/.test(type)) {
    return {
      name: p.name,
      kind: 'enum',
      options: literals.map(l => l.slice(1, -1)),
      doc: p.doc, defaultValue: p.defaultValue, deprecated: p.deprecated,
    };
  }
  if (type === 'boolean') {
    return { name: p.name, kind: 'boolean', doc: p.doc, defaultValue: p.defaultValue, deprecated: p.deprecated };
  }
  if (type === 'number') {
    return { name: p.name, kind: 'number', doc: p.doc, defaultValue: p.defaultValue, deprecated: p.deprecated };
  }
  if (type === 'string') {
    return { name: p.name, kind: 'string', doc: p.doc, defaultValue: p.defaultValue, deprecated: p.deprecated };
  }
  return { name: p.name, kind: 'other', doc: p.doc, defaultValue: p.defaultValue, deprecated: p.deprecated };
}

/**
 * Props worth putting in a panel.
 *
 * Handlers cannot be edited from a UI, children are the composition itself,
 * and a deprecated prop should never be offered as a choice — surfacing it in
 * a picker actively invites the mistake the deprecation exists to prevent.
 */
function panelWorthy(p: EditableProp): boolean {
  if (/^(children|key|ref|className|id)$/.test(p.name)) return false;
  if (/^on[A-Z]/.test(p.name)) return false;
  if (p.deprecated) return false;
  return p.kind !== 'other';
}

export async function editablePropsHandler(req: Request, res: Response): Promise<void> {
  try {
    const component = String(req.query.component || '').trim();
    if (!component) {
      res.status(400).json({ error: 'component is required' });
      return;
    }

    const config = await loadUserConfig();
    const extracted = await extractProps(config.importPath, process.cwd());
    const facts = extracted?.components?.[component];

    const props = (facts?.props ?? []).map(classifyProp).filter(panelWorthy);

    // Design tokens travel with the response so a colour or spacing control
    // can offer the project's OWN scale rather than a colour wheel — picking
    // #ff0000 in a Carbon app is exactly the raw-value habit this codebase
    // spends so much effort removing.
    const tokens = readDesignTokens(process.cwd(), config.importPath);

    res.json({ component, props, tokens });
  } catch (error) {
    logger.warn(`[edit-prop] editable props failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Could not read props for that component' });
  }
}

export async function editPropHandler(req: Request, res: Response): Promise<void> {
  try {
    const { fileName, component, occurrence, prop, value } = req.body ?? {};
    if (!fileName || !component || !prop) {
      res.status(400).json({ error: 'fileName, component and prop are required' });
      return;
    }

    const config = await loadUserConfig();
    const filePath = path.resolve(
      process.cwd(),
      config.generatedStoriesPath || './src/stories/generated',
      String(fileName),
    );

    // Confine writes to the generated stories directory. `fileName` arrives
    // from a browser, and a path that escapes the directory would let a
    // request rewrite anything the server can reach.
    const generatedDir = path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated');
    if (!filePath.startsWith(generatedDir + path.sep)) {
      res.status(400).json({ error: 'fileName must name a story in the generated stories directory' });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `No such story: ${fileName}` });
      return;
    }

    const before = fs.readFileSync(filePath, 'utf-8');
    const result = editProp(before, {
      component: String(component),
      occurrence: Number(occurrence) || 0,
      prop: String(prop),
      value: value === null ? null : value,
    });

    if (!result.changed) {
      res.status(409).json({ error: result.reason || 'Nothing changed' });
      return;
    }

    fs.writeFileSync(filePath, result.code, 'utf-8');
    logger.log(`✏️ ${component}[${occurrence ?? 0}].${prop} = ${JSON.stringify(value)} in ${fileName}`);

    res.json({
      ok: true,
      previous: result.previous ?? null,
      code: result.code,
      /**
       * How many of this component exist in the source, so the panel can say
       * "this changes all 4" when one JSX element renders a list via .map()
       * and the DOM occurrence cannot be mapped one-to-one.
       */
      occurrencesInSource: occurrencesInSource(result.code, String(component)),
    });
  } catch (error) {
    logger.warn(`[edit-prop] failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Could not apply that change' });
  }
}
