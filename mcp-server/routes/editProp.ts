/**
 * Direct property editing endpoint.
 *
 * Two operations, both deterministic and neither involving a model:
 *
 *   GET  /mcp/editable-props?component=Button&candidates=UnstyledButton,Button&fileName=…
 *        What can be changed on this component, with the values it accepts —
 *        read from the installed package's own type declarations. Optional
 *        `candidates` (comma-separated, innermost-first) resolves the clicked
 *        fiber name to the element the story file actually contains, the same
 *        way the POST below does.
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
import { StoryHistoryManager } from '../../story-generator/storyHistory.js';
import { getManifestManager } from '../../story-generator/manifestManager.js';
import { logger } from '../../story-generator/logger.js';

/** A prop the panel can render a control for. */
export interface EditableProp {
  name: string;
  /** `enum` when the type is a union of string literals; else the raw type. */
  kind: 'enum' | 'boolean' | 'number' | 'string' | 'other';
  /** Legal values, when the type declares them. */
  options?: string[];
  /**
   * True when `options` are SUGGESTIONS rather than a closed set — the
   * declared type also admits arbitrary values (Mantine's `MantineSize |
   * (string & {})` idiom). A control should offer the options AND accept free
   * input; rejecting everything else would claim a restriction the library
   * does not make.
   */
  open?: boolean;
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

  /**
   * Values resolved by the extractor win over anything parsed from the type
   * TEXT. Carbon writes `kind?: hasIconOnly extends true ? IconButtonKind :
   * ButtonKind`, which no amount of string matching turns into eight options —
   * following the type to its const tuple does.
   */
  if (p.options && p.options.length > 1) {
    return {
      name: p.name,
      kind: 'enum',
      options: p.options,
      ...(p.optionsOpen ? { open: true } : {}),
      doc: p.doc, defaultValue: p.defaultValue, deprecated: p.deprecated,
    };
  }

  // Inline unions still handled, for libraries that write them out.
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

/**
 * Which candidate does the source actually contain?
 *
 * The browser can only offer a hypothesis: the fiber chain includes names that
 * are not JSX elements at all — clicking a Mantine Button yields
 * `UnstyledButton`, the component that authored the DOM node, while the story
 * says `<Button>`; Carbon wraps components in a `hookified` HOC — and no list
 * of wrapper names could cover every design system. The FILE knows, so the
 * first candidate that appears in it wins. Innermost-first order means the
 * most specific real element is chosen. Shared by GET /mcp/editable-props and
 * POST /mcp/edit-prop so the props offered are the props of the element the
 * edit will actually target.
 */
export function resolveComponentInSource(source: string, ordered: string[]): string | undefined {
  return ordered.find(name => name && occurrencesInSource(source, name) > 0);
}

/**
 * The absolute path of a story file, confined to the generated stories
 * directory. `fileName` arrives from a browser, and a path that escapes the
 * directory would let a request read or rewrite anything the server can reach.
 */
function storyFilePath(config: { generatedStoriesPath?: string }, fileName: string): string | null {
  if (!fileName) return null;
  const generatedDir = path.resolve(process.cwd(), config.generatedStoriesPath || './src/stories/generated');
  const filePath = path.resolve(generatedDir, fileName);
  if (!filePath.startsWith(generatedDir + path.sep)) return null;
  return filePath;
}

export async function editablePropsHandler(req: Request, res: Response): Promise<void> {
  try {
    const component = String(req.query.component || '').trim();
    if (!component) {
      res.status(400).json({ error: 'component is required' });
      return;
    }

    const config = await loadUserConfig();

    /**
     * Resolve the clicked name against the story file, exactly as the edit
     * will.
     *
     * Without this the two halves of the panel disagreed: POST /mcp/edit-prop
     * resolved `UnstyledButton` to the `<Button>` the file contains and edited
     * it, while this route looked up `UnstyledButton` verbatim, found no
     * props, and presented a dead end. `candidates` is comma-separated,
     * innermost-first; the first name that appears as a JSX element in
     * `fileName` wins, and the response reports it as `component` so the panel
     * and the subsequent edit speak about the same element. Without
     * `candidates` (or when nothing matches) behaviour is unchanged.
     */
    let resolved = component;
    const candidatesRaw = String(req.query.candidates || '').trim();
    if (candidatesRaw) {
      const ordered = [...new Set([
        component,
        ...candidatesRaw.split(',').map(s => s.trim()).filter(Boolean),
      ])];
      const filePath = storyFilePath(config, String(req.query.fileName || '').trim());
      if (filePath && fs.existsSync(filePath)) {
        const hit = resolveComponentInSource(fs.readFileSync(filePath, 'utf-8'), ordered);
        if (hit) resolved = hit;
      }
    }

    const extracted = await extractProps(config.importPath, process.cwd());
    const facts = extracted?.components?.[resolved];

    /**
     * Most-actionable first, because a panel is scanned, not read.
     *
     * A picker with the component's real variants is the reason someone opened
     * this; a boolean flag is second; free text is last and rarely what anyone
     * came for. Alphabetical order buried `kind` and `size` below
     * `dangerDescription` and `iconDescription`.
     */
    const RANK: Record<EditableProp['kind'], number> = { enum: 0, boolean: 1, number: 2, string: 3, other: 4 };
    const classified = (facts?.props ?? [])
      .map(classifyProp)
      .filter(panelWorthy);

    /**
     * `variant`, when the library states it beside the component rather than
     * in it.
     *
     * Mantine's ButtonProps has no `variant` member — the prop arrives through
     * `StylesApiProps<ButtonFactory>`, a factory type in another file — but
     * `type ButtonVariant = 'filled' | 'light' | ...` sits right next to the
     * component, and the extractor already records it as `facts.variants`.
     * Offering nothing while the library spells out the values is the same
     * dead end as the candidates bug. Marked open because the set's provenance
     * is the alias, not a declared prop: Mantine's factory admits
     * `(string & {})` beside it, and claiming closure would reject custom
     * variants the theme legitimately defines.
     */
    if (
      facts?.variants && facts.variants.length > 1
      && !classified.some(p => p.name === 'variant')
    ) {
      classified.push({ name: 'variant', kind: 'enum', options: facts.variants, open: true });
    }

    const props = classified
      .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.name.localeCompare(b.name));

    // Design tokens travel with the response so a colour or spacing control
    // can offer the project's OWN scale rather than a colour wheel — picking
    // #ff0000 in a Carbon app is exactly the raw-value habit this codebase
    // spends so much effort removing.
    const tokens = readDesignTokens(process.cwd(), config.importPath);

    res.json({ component: resolved, props, tokens });
  } catch (error) {
    logger.warn(`[edit-prop] editable props failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Could not read props for that component' });
  }
}

export async function editPropHandler(req: Request, res: Response): Promise<void> {
  try {
    const { fileName, component, candidates, occurrence, prop, value } = req.body ?? {};
    if (!fileName || (!component && !Array.isArray(candidates)) || !prop) {
      res.status(400).json({ error: 'fileName, component and prop are required' });
      return;
    }

    const config = await loadUserConfig();

    // Confine writes to the generated stories directory.
    const filePath = storyFilePath(config, String(fileName));
    if (!filePath) {
      res.status(400).json({ error: 'fileName must name a story in the generated stories directory' });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `No such story: ${fileName}` });
      return;
    }

    const before = fs.readFileSync(filePath, 'utf-8');

    // The fiber chain is a hypothesis; the file is authoritative — see
    // resolveComponentInSource.
    const ordered: string[] = [
      ...(component ? [String(component)] : []),
      ...(Array.isArray(candidates) ? candidates.map(String) : []),
    ];
    const resolved = resolveComponentInSource(before, ordered);
    if (!resolved) {
      res.status(409).json({
        error: `None of these appear in the story: ${ordered.join(', ') || '(nothing offered)'}`,
      });
      return;
    }

    const result = editProp(before, {
      component: resolved,
      occurrence: Number(occurrence) || 0,
      prop: String(prop),
      value: value === null ? null : value,
    });

    if (!result.changed) {
      res.status(409).json({ error: result.reason || 'Nothing changed' });
      return;
    }

    fs.writeFileSync(filePath, result.code, 'utf-8');
    logger.log(`✏️ ${resolved}[${occurrence ?? 0}].${prop} = ${JSON.stringify(value)} in ${fileName}`);

    /**
     * Record the edit as a version, exactly as a generation would.
     *
     * Without this, history's "current version" is the PRE-edit code, and the
     * next conversational update regenerates from it — the change the user just
     * made, and can see on screen, silently vanishes. The manifest is kept in
     * step the same way restore does, so the conversation the workspace
     * rebuilds agrees with the canvas.
     */
    const editDescription = value === null
      ? `Reset ${resolved}[${Number(occurrence) || 0}].${prop} to its default`
      : `Set ${resolved}[${Number(occurrence) || 0}].${prop} = ${JSON.stringify(value)}`;
    try {
      const historyManager = new StoryHistoryManager(process.cwd());
      const currentVersion = historyManager.getCurrentVersion(String(fileName));
      historyManager.addVersion(String(fileName), editDescription, result.code, currentVersion?.id);
    } catch (historyError) {
      logger.warn('[edit-prop] version record failed (non-fatal):', historyError);
    }
    try {
      getManifestManager().upsert(String(fileName), {
        source: 'panel',
        metadata: { prompt: editDescription },
      });
    } catch (manifestError) {
      logger.warn('[edit-prop] manifest update failed (non-fatal):', manifestError);
    }

    res.json({
      ok: true,
      previous: result.previous ?? null,
      code: result.code,
      /**
       * How many of this component exist in the source, so the panel can say
       * "this changes all 4" when one JSX element renders a list via .map()
       * and the DOM occurrence cannot be mapped one-to-one.
       */
      component: resolved,
      occurrencesInSource: occurrencesInSource(result.code, resolved),
    });
  } catch (error) {
    logger.warn(`[edit-prop] failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Could not apply that change' });
  }
}
