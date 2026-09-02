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
import { editProp, readProps, occurrencesInSource, occurrencesWithinOwner, topLevelDeclarations, STORYBOOK_RENDER_WRAPPERS } from '../../story-generator/editing/propEditor.js';
import { extractProps, extractPropsForPackages, type PropFact, type ComponentFacts } from '../../story-generator/knowledge/propExtractor.js';
import { mergePropFactsFromSource, readSourceFacts } from '../../story-generator/knowledge/sourceFacts.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import { storybookComponentDirs } from '../../story-generator/knowledge/storybookCatalog.js';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { readDesignTokens } from '../../story-generator/knowledge/stylingFacts.js';
import { StoryHistoryManager } from '../../story-generator/storyHistory.js';
import { upsertPin } from '../../story-generator/editing/pins.js';
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
 * of wrapper names could cover every design system. The FILE knows. Shared by
 * GET /mcp/editable-props and POST /mcp/edit-prop so the props offered are
 * the props of the element the edit will actually target.
 *
 * When the browser also reports each candidate's OWNER — the component whose
 * render authored it, from the fiber — the file settles a harder question
 * first: which candidates are elements the STORY wrote at all. An authored
 * element's owner is a component the file DECLARES (`PricingPage`,
 * `PromoBanner`); a library internal's owner is imported (`Button`,
 * `UnstyledButton`). Measured live: clicking the label inside a Mantine
 * Button puts an internal Box (owner `Button`, a different DOM node) at the
 * head of the chain, where no ordering rule can demote it — but its owner is
 * not declared in the file, and `<Button>`'s owner is. Preferring the first
 * candidate that appears in the file AND has a declared owner picks the
 * element the user meant; the plain first-appears rule remains the fallback,
 * so requests without owner facts behave exactly as before.
 */
export function resolveComponentInSource(
  source: string,
  ordered: string[],
  owners?: Record<string, string | undefined>,
): string | undefined {
  if (owners) {
    const declared = topLevelDeclarations(source);
    const authored = ordered.filter(name => {
      const owner = name ? owners[name] : undefined;
      return name && owner && declared.has(owner) && occurrencesInSource(source, name) > 0;
    });
    // The same demotion as below: an authored Box beside an authored Button
    // is still the wrapper, not the thing that was clicked. A helper the
    // story DECLARES (`function SmallCard() { … }`) is a wrapper too: it has
    // no props to edit, and the design-system component inside it is what
    // the click landed on — measured as an inspector that said "declares no
    // directly editable properties" for a click on a Button.
    const pick = authored.find(name => !GENERIC_WRAPPERS.has(name) && !declared.has(name))
      ?? authored.find(name => !GENERIC_WRAPPERS.has(name))
      ?? authored[0];
    if (pick) return pick;
  }
  /**
   * A layout primitive is the last resort, not the first hit. A click on a
   * Mantine <Button> in a story with an anonymous `render` arrived as
   * [Box, Button, …] (Box is Button's own internal), the file also used
   * <Box p="xl">, and first-appears picked the Box: the inspector offered
   * hiddenFrom/visibleFrom for a button. Prefer any candidate that is not a
   * generic wrapper when one appears in the file.
   */
  const present = ordered.filter(name => name && occurrencesInSource(source, name) > 0);
  const local = topLevelDeclarations(source);
  return present.find(name => !GENERIC_WRAPPERS.has(name) && !local.has(name))
    ?? present.find(name => !GENERIC_WRAPPERS.has(name))
    ?? present[0];
}

/** Names that wrap anything and therefore identify nothing. */
const GENERIC_WRAPPERS = new Set(['Box', 'div', 'span', 'Fragment', 'Group', 'Stack', 'Flex', 'Center', 'Container', 'Grid', 'SimpleGrid', 'Paper']);

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

/** The catalog fields this route needs from discovery. */
interface CatalogEntry {
  name: string;
  /** Absolute path of a locally-defined component's source file, when known. */
  filePath?: string;
  /** Declared or discovered import specifier — the package a component lives in. */
  __componentPath?: string;
}

let catalogCache: { components: CatalogEntry[]; at: number } | null = null;
const CATALOG_TTL = 60_000; // same as /mcp/components

/**
 * The discovered component catalog, cached briefly.
 *
 * Discovery is the same plumbing the generation pipeline runs, and it is what
 * knows a LOCAL component's source file — the field that decides whether this
 * route can read a cva() map at all. A panel opens this route on every click,
 * so the scan is cached the same way /mcp/components caches it.
 */
async function discoveredCatalog(config: ReturnType<typeof loadUserConfig>): Promise<CatalogEntry[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL) return catalogCache.components;
  const discovery = new EnhancedComponentDiscovery(config);
  // Where Storybook says the components are — the same widening generation
  // applies, so a design system outside conventional directories resolves
  // here too. Enhancement only: discovery still works without it.
  try {
    if (config.storybookMcpUrl) {
      const dirs = await storybookComponentDirs({ storybookUrl: config.storybookMcpUrl, projectRoot: process.cwd() });
      if (dirs.length) discovery.setStorybookComponentDirs(dirs);
    }
  } catch { /* widening only */ }
  const components = await discovery.discoverAll();
  catalogCache = { components: components as unknown as CatalogEntry[], at: now };
  return catalogCache.components;
}

/**
 * Everything knowable about one component's props, resolved the way the
 * GENERATION pipeline resolves it — not the way this route used to.
 *
 * The route read `extractProps(config.importPath)` alone: the npm-declarations
 * channel. For a local-source design system (college-town: `importPath:
 * '@/components'`, components in `src/`) that path names no installable
 * package, extraction resolves nothing, and the route answered `props: []`
 * for a Button whose cva() map declares 9 variants and 6 sizes — the exact
 * audience the branch exists to serve got the dead end. Meanwhile
 * generationCore already merged BOTH channels: package declarations (via the
 * homes each component actually lives in) AND `sourceFacts` read from the
 * component's own file. This resolver reuses those channels and merges
 * field-wise, so the panel offers what the pipeline already knows.
 */
async function resolveComponentKnowledge(
  config: ReturnType<typeof loadUserConfig>,
  componentName: string,
): Promise<{ facts: ComponentFacts | undefined; props: PropFact[]; sources: string[] }> {
  const sources: string[] = [];

  let catalog: CatalogEntry[] = [];
  try {
    catalog = await discoveredCatalog(config);
  } catch (error) {
    logger.warn(`[edit-prop] discovery failed, falling back to importPath only: ${error instanceof Error ? error.message : String(error)}`);
  }
  const entry = catalog.find(c => c.name === componentName);

  // Channel 1: package declarations — read from every package the components
  // actually live in, exactly as generationCore does for package-per-component
  // systems. For a barrel library homes collapse to the configured path.
  const homes = [...new Set(
    catalog.map(c => c.__componentPath).filter((p): p is string => typeof p === 'string' && p.length > 0),
  )];
  const extracted = homes.length > 1
    ? await extractPropsForPackages([config.importPath, ...homes], process.cwd())
    : await extractProps(config.importPath, process.cwd());
  const facts = extracted?.components?.[componentName];
  let props: PropFact[] = facts?.props ? [...facts.props] : [];
  if (props.length > 0) sources.push(`declarations(${props.length})`);

  // Channel 2: the component's own source — its exported interface or type
  // alias (read with the AST, the only statement of a LOCAL component's API),
  // cva()/tv() variant maps, and story argTypes docs.
  //
  // Without the interface channel a local design system answered `props: []`
  // for every component that declares its API the ordinary way — `export
  // interface ArticleCardProps extends …` — and the panel presented a dead
  // end to exactly the audience this route exists for.
  const sourceFile = entry?.filePath && !entry.filePath.includes('node_modules') ? entry.filePath : null;
  if (sourceFile) {
    const sourceFacts = readSourceFacts(sourceFile, componentName);
    if (sourceFacts.variants || sourceFacts.propDocs || sourceFacts.declaredProps) {
      props = mergePropFactsFromSource(props, sourceFacts);
      const variantProps = Object.keys(sourceFacts.variants?.options ?? {});
      const parts = [
        sourceFacts.declaredProps?.length ? `interface(${sourceFacts.declaredProps.length})` : '',
        variantProps.length ? `variants(${variantProps.join(',')})` : '',
      ].filter(Boolean);
      sources.push(`source:${path.basename(sourceFile)}${parts.length ? `[${parts.join(' ')}]` : ''}`);
    }
  }

  return { facts, props, sources };
}

export async function editablePropsHandler(req: Request, res: Response): Promise<void> {
  try {
    const component = String(req.query.component || '').trim();
    if (!component) {
      res.status(400).json({ error: 'component is required' });
      return;
    }

    const config = await loadUserConfig();
    if (config.componentFramework && config.componentFramework !== 'react') {
      // The editor parses JSX and targets React fibers. For any other
      // framework it answered 409 "none of these appear in the story", which
      // reads as a bug in the story rather than a limit of the tool.
      res.status(501).json({
        error: `Direct prop editing is React-only today (the editor works on JSX). For ${config.componentFramework}, describe the change in chat instead.`,
        code: 'UNSUPPORTED_FRAMEWORK',
        framework: config.componentFramework,
      });
      return;
    }

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
    /** The story's source, read once and reused to report current values. */
    let storySource: string | null = null;
    const candidatesRaw = String(req.query.candidates || '').trim();
    if (candidatesRaw) {
      const names = candidatesRaw.split(',').map(s => s.trim());
      const ordered = [...new Set([component, ...names.filter(Boolean)])];
      /**
       * `owners` is positional with `candidates`: the fiber-reported author
       * of each candidate, empty when unknown. It lets resolution prefer the
       * candidate the STORY authored — see resolveComponentInSource.
       */
      const ownersRaw = String(req.query.owners || '').trim();
      let owners: Record<string, string | undefined> | undefined;
      if (ownersRaw) {
        const ownerList = ownersRaw.split(',').map(s => s.trim());
        owners = {};
        names.forEach((n, i) => { if (n && ownerList[i]) owners![n] = ownerList[i]; });
      }
      const filePath = storyFilePath(config, String(req.query.fileName || '').trim());
      if (filePath && fs.existsSync(filePath)) {
        storySource = fs.readFileSync(filePath, 'utf-8');
        const hit = resolveComponentInSource(storySource, ordered, owners);
        if (hit) resolved = hit;
      }
    }

    // Read the file even when no candidates were sent, so current values are
    // available on the simple path too.
    if (!storySource) {
      const filePath = storyFilePath(config, String(req.query.fileName || '').trim());
      if (filePath && fs.existsSync(filePath)) storySource = fs.readFileSync(filePath, 'utf-8');
    }

    /**
     * What the element ALREADY has, so the panel can show it.
     *
     * Without this every control is uncontrolled and shows its placeholder
     * regardless of what the source says, which makes a landed edit and a
     * dropped one look identical. Same occurrence semantics as the edit, so
     * what is displayed and what will be changed cannot disagree.
     */
    const occurrenceRaw = String(req.query.occurrence || '').trim();
    const currentValues = storySource
      ? readProps(storySource, resolved, occurrenceRaw === '' ? 0 : Number(occurrenceRaw) || 0)
      : null;

    const { facts, props: propFacts, sources } = await resolveComponentKnowledge(config, resolved);

    /**
     * Most-actionable first, because a panel is scanned, not read.
     *
     * A picker with the component's real variants is the reason someone opened
     * this; a boolean flag is second; free text is last and rarely what anyone
     * came for. Alphabetical order buried `kind` and `size` below
     * `dangerDescription` and `iconDescription`.
     */
    const RANK: Record<EditableProp['kind'], number> = { enum: 0, boolean: 1, number: 2, string: 3, other: 4 };
    const classified = propFacts
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

    /**
     * Log every answer, and make ABSENT and EMPTY read differently.
     *
     * The live failure produced no server log line at all, so `props: []`
     * could not be told apart from "the request never ran" — and a knowledge
     * layer that found nothing could not be told apart from one that was
     * never consulted. Name the resolved component, where the facts came
     * from, and how many props survived classification.
     */
    logger.log(
      `🎛️ [edit-prop] editable-props: ${resolved}` +
      `${resolved !== component ? ` (clicked ${component})` : ''}` +
      ` → ${props.length} editable prop(s); knowledge: ` +
      (sources.length ? sources.join(' + ') : 'NONE — no package declarations resolved and no local source file on record'),
    );

    res.json({ component: resolved, props, tokens, current: currentValues ?? {} });
  } catch (error) {
    logger.warn(`[edit-prop] editable props failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Could not read props for that component' });
  }
}

export async function editPropHandler(req: Request, res: Response): Promise<void> {
  try {
    const { fileName, component, candidates, owners, occurrence, owner, prop, value, storyExport } = req.body ?? {};
    if (!fileName || (!component && !Array.isArray(candidates)) || !prop) {
      res.status(400).json({ error: 'fileName, component and prop are required' });
      return;
    }

    const config = await loadUserConfig();
    if (config.componentFramework && config.componentFramework !== 'react') {
      // The editor parses JSX and targets React fibers. For any other
      // framework it answered 409 "none of these appear in the story", which
      // reads as a bug in the story rather than a limit of the tool.
      res.status(501).json({
        error: `Direct prop editing is React-only today (the editor works on JSX). For ${config.componentFramework}, describe the change in chat instead.`,
        code: 'UNSUPPORTED_FRAMEWORK',
        framework: config.componentFramework,
      });
      return;
    }

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
    /** name → fiber-reported author, for authored-element preference. */
    const ownersMap: Record<string, string | undefined> | undefined =
      owners && typeof owners === 'object' && !Array.isArray(owners)
        ? Object.fromEntries(
            Object.entries(owners as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string' && (v as string).trim())
              .map(([k, v]) => [k, String(v)]),
          )
        : undefined;
    const resolved = resolveComponentInSource(before, ordered, ownersMap);
    if (!resolved) {
      res.status(409).json({
        error: `None of these appear in the story: ${ordered.join(', ') || '(nothing offered)'}`,
      });
      return;
    }

    /**
     * Which of the file's `<resolved>` elements the edit lands on.
     *
     * `occurrence` is 0-BASED everywhere on this route and on the GET above:
     * 0 is the first `<X>` in source order. Every refusal below says so, so
     * a caller reading "appears 2 times" never sends 2.
     *
     * The request's `occurrence` is scoped: when `owner` accompanies it, it
     * counts positions INSIDE that component's declaration — the only region
     * where the browser's DOM order and the file's JSX order are known to
     * correspond (measured: a banner defined first but rendered last put its
     * Button at whole-page position 8 in a file holding 3). Without `owner`
     * it is a whole-file position, the pre-owner contract.
     *
     * THE RULE THAT MUST HOLD: a missing occurrence never silently edits
     * element[0] when the file holds more than one. That default is exactly
     * how clicking a Register button inside a list edited the Alert's button
     * instead — the browser withheld the position it could not compute, and
     * the server treated absence as zero. Absent and zero must not look
     * alike: ambiguity is answered with a 409 carrying the count.
     */
    const total = occurrencesInSource(before, resolved);
    const hasOccurrence = occurrence !== undefined && occurrence !== null && occurrence !== '';
    const requested = hasOccurrence ? Number(occurrence) : undefined;
    if (requested !== undefined && !Number.isInteger(requested)) {
      res.status(400).json({ error: `occurrence must be an integer, got ${JSON.stringify(occurrence)}` });
      return;
    }
    // The RESOLVED candidate's author wins: the panel's standalone `owner`
    // field describes its top candidate, which is not always the element the
    // file resolution just chose (a label click resolves past an internal).
    const ownerName = ownersMap?.[resolved]
      ?? (typeof owner === 'string' && owner.trim() ? owner.trim() : undefined);

    let targetOccurrence: number;
    if (total <= 1) {
      targetOccurrence = 0;
    } else if (ownerName) {
      const scoped = occurrencesWithinOwner(before, resolved, ownerName, typeof storyExport === 'string' ? storyExport : undefined);
      if (!scoped.length) {
        // The client counted within this owner; reading its number as a
        // whole-file position would be a guess at a different question.
        res.status(409).json({
          error: STORYBOOK_RENDER_WRAPPERS.has(ownerName)
            ? `Cannot place this <${resolved}>: the file has ${total} of them across more than one story, and the preview did not say which story it shows.`
            : `Cannot place this <${resolved}>: the file has ${total} of them and no top-level component named ${ownerName} to narrow by.`,
          occurrencesInSource: total,
        });
        return;
      }
      if (requested === undefined) {
        if (scoped.length !== 1) {
          res.status(409).json({
            error: `<${resolved}> appears ${scoped.length} times inside ${ownerName} (${total} in the file) and no occurrence was given — refusing to guess. Pass occurrence, 0-based: 0 is the first <${resolved}> inside ${ownerName}, ${scoped.length - 1} the last.`,
            occurrencesInSource: total,
          });
          return;
        }
        targetOccurrence = scoped[0];
      } else if (requested >= 0 && requested < scoped.length) {
        targetOccurrence = scoped[requested];
      } else {
        res.status(409).json({
          error: `No <${resolved}> at occurrence ${requested} inside ${ownerName} — it contains ${scoped.length}, so occurrence must be 0..${scoped.length - 1} (0-based).`,
          occurrencesInSource: total,
        });
        return;
      }
    } else if (requested !== undefined) {
      if (requested < 0 || requested >= total) {
        res.status(409).json({
          error: `No <${resolved}> at occurrence ${requested} in ${fileName} — it contains ${total}, so occurrence must be 0..${total - 1} (0-based).`,
          occurrencesInSource: total,
        });
        return;
      }
      targetOccurrence = requested;
    } else {
      res.status(409).json({
        error: `<${resolved}> appears ${total} times in ${fileName} and no occurrence was given — refusing to guess which one. Pass occurrence, 0-based: 0 is the first <${resolved}> in the file, ${total - 1} the last.`,
        occurrencesInSource: total,
      });
      return;
    }

    if (!(value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
      // An object or array would render as null, which is the REMOVE branch —
      // a malformed edit deleting the attribute and reporting success.
      res.status(400).json({ error: `A prop value must be a string, number, boolean, or null to reset; got ${Array.isArray(value) ? 'array' : typeof value}` });
      return;
    }

    const result = editProp(before, {
      component: resolved,
      occurrence: targetOccurrence,
      prop: String(prop),
      value: value === null ? null : value,
    });

    if (!result.changed) {
      res.status(409).json({ error: result.reason || 'Nothing changed' });
      return;
    }

    fs.writeFileSync(filePath, result.code, 'utf-8');
    logger.log(
      `✏️ ${resolved}[${targetOccurrence}].${prop} = ${JSON.stringify(value)} in ${fileName}` +
      (ownerName ? ` (position ${requested ?? 0} inside ${ownerName})` : ''),
    );

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
      ? `Reset ${resolved}[${targetOccurrence}].${prop} to its default`
      : `Set ${resolved}[${targetOccurrence}].${prop} = ${JSON.stringify(value)}`;
    try {
      const historyManager = new StoryHistoryManager(process.cwd());
      const currentVersion = historyManager.getCurrentVersion(String(fileName));
      historyManager.addVersion(String(fileName), editDescription, result.code, currentVersion?.id);
    } catch (historyError) {
      logger.warn('[edit-prop] version record failed (non-fatal):', historyError);
    }
    // The pin is what lets this edit survive the next chat rewrite.
    let pins: ReturnType<typeof upsertPin> | undefined;
    try {
      const existing = getManifestManager().get(String(fileName))?.metadata?.pins;
      pins = upsertPin(existing, {
        component: resolved, occurrence: targetOccurrence, prop: String(prop),
        value: value as string | number | boolean | null,
      });
      getManifestManager().upsert(String(fileName), {
        source: 'panel',
        metadata: { prompt: editDescription, pins },
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
      /** Every prop the panel has pinned on this story, after this edit. */
      pins,
      occurrencesInSource: occurrencesInSource(result.code, resolved),
    });
  } catch (error) {
    logger.warn(`[edit-prop] failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Could not apply that change' });
  }
}
